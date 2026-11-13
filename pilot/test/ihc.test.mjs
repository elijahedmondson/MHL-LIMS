// Tests for the IHC module: reading the export, the converted catalog, pricing rules, the request form and the catalog.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore, emptyState } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as IHC from '../core/ihc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'src', 'SeedData');
const priceList = JSON.parse(readFileSync(path.join(seedDir, 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(seedDir, 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-04';

function setup() {
  const state = seedState({ priceList, ihcCatalog, today: TODAY });
  const clock = { day: TODAY, today: () => clock.day, now: () => `${clock.day}T10:00:00` };
  const core = createCore({ state, priceList, ihcCatalog, clock });
  state.settings.initials = 'TE';
  const call = (method, p, body = null, query = {}) => core.handle(method, p, query, body);
  const ok = (method, p, body, query) => { const r = call(method, p, body, query); assert.equal(r.status, 200, `${method} ${p}: ${r.json?.error}`); return r.json ?? r.file; };
  const err = (method, p, body, query) => { const r = call(method, p, body, query); assert.notEqual(r.status, 200, `${method} ${p} should fail`); return r.json.error; };
  const find = (pred) => state.assays.find((a) => a.status === 'Active' && pred(a));
  return { state, core, clock, call, ok, err, find };
}

const draft = (extra = {}) => ({
  requester: { last: 'Tester', first: 'Ana', email: 'ana.tester@example.org', phone: '301-555-0100' }, billTo: 'Tester', projectId: '25X0000001.01',
  species: 'Mouse', fixativeUsed: '10% NBF', samples: [{ tissue: 'Liver', blockNo: 'A1', type: 'FIXED' }], he: { on: true, perBlock: 1 }, scan: { x20: true }, ...extra,
});

test('Excel repairs: dilutions stored as times, names stored as dates', () => {
  assert.deepEqual(IHC.decodeExcelDilution('0.111111111'), { value: '1:100', recovered: true, stored: '0.111111111' });
  assert.equal(IHC.decodeExcelDilution('0.736111111').value, '1:1000');
  assert.equal(IHC.decodeExcelDilution('2.819444444').value, '1:4000');
  assert.deepEqual(IHC.decodeExcelDilution('1:50 ON4C'), { value: '1:50 ON4C', recovered: false });
  assert.equal(IHC.decodeExcelDilution('N/A').recovered, false);
  assert.equal(IHC.fixExcelDateName('4-Oct').value, 'Oct-4');
  assert.equal(IHC.fixExcelDateName('Bcl-2').recovered, false);
});

test('CSV parsing handles quotes, doubled quotes and CRLF', () => {
  assert.deepEqual(IHC.parseCsv('a,"b, c","say ""hi"""\r\nd,,e\r\n'), [['a', 'b, c', 'say "hi"'], ['d', '', 'e']]);
});

test('species, fixative and kind are read from free text', () => {
  assert.deepEqual(IHC.speciesTags('Human, Hu Xg in Mice').tags, ['Human', 'Human xenograft']);
  assert.deepEqual(IHC.speciesTags('Mouse; Hu Xg in mice').tags, ['Mouse', 'Human xenograft']);
  assert.deepEqual(IHC.speciesTags('Hu in Rabbit'), { tags: [], other: ['hu in rabbit'] });
  assert.deepEqual(IHC.fixativeTags('FRESH/ FROZEN/ ACETONE'), ['Frozen']);
  assert.deepEqual(IHC.fixativeTags('4% PFA to Sucrose to OCT'), ['PFA', 'Frozen']);
  assert.deepEqual(IHC.fixativeTags('Methanol'), ['Methanol']);
  assert.deepEqual(IHC.fixativeTags('10% NBF, ETOH'), ['NBF', 'Ethanol']);
  assert.equal(IHC.classify({ name: 'Triplex CK19 + CD8 + CD4', kit: 'Bond Polymer Refine, OPALs 690, 520, 570' }).plex, 3);
  assert.deepEqual(IHC.classify({ name: '6-plex CD4+CD8+FOXP3+PDL1+PD1+CD45', kit: 'Bond Polymer Refine Detection Kit' }).kind, 'Opal');
  assert.equal(IHC.classify({ name: 'GFAP', kit: 'NGS/ 2Ab Goat a/Rabbit Alexa 488' }).kind, 'IF');
  assert.equal(IHC.classify({ name: 'ApopTag (Tunel)', kit: 'ApopTag Kit' }).kind, 'TUNEL');
  assert.deepEqual(IHC.classify({ name: 'CD8', kit: 'Bond Polymer Refine Kit' }), { kind: 'IHC', plex: 1, chromogen: 'DAB', platform: 'Leica Bond' });
});

test('the converted catalog keeps every protocol and records what was repaired', () => {
  const a = ihcCatalog.assays;
  assert.equal(ihcCatalog.counts.protocols, 756);
  assert.equal(a.filter((x) => !x.components).length, 756);
  assert.equal(a.filter((x) => x.components).length, ihcCatalog.counts.doubleStainEntries);
  // The saved request form shows CD8, Abcam ab101500, at 1:100; the export had stored 0.111111111.
  const cd8 = a.find((x) => x.name === 'CD8' && x.catalog.startsWith('ab101500') && x.kind === 'IHC' && x.fixative === '10% NBF');
  assert.equal(cd8.dilution, '1:100');
  assert.equal(cd8.repairs.dilution, '0.111111111');
  assert.ok(a.some((x) => x.name === 'Oct-4' && x.flags.includes('name-recovered')));
  assert.equal(a.filter((x) => x.status === 'Duplicate').length, ihcCatalog.counts.duplicates);
  const pair = a.find((x) => x.name === 'Double stain: CD3 + CD45R/B220');
  assert.ok(pair, 'the CD3 / CD45R double stain becomes one entry');
  assert.equal(pair.components.length, 2);
  assert.ok(a.every((x) => typeof x.id === 'number' && x.name));
  assert.equal(new Set(a.map((x) => x.id)).size, a.length);
});

test('pricing an IHC request', () => {
  const ihc = { kind: 'IHC', plex: 1 }; const opal3 = { kind: 'Opal', plex: 3 };
  const lookup = (id) => ({ 1: ihc, 2: opal3 }[id]);
  const est = IHC.estimateIhc({
    samples: [{ type: 'FIXED' }, { type: 'BLOCK' }, { type: 'SLIDES' }], he: { on: true, perBlock: 1 }, unstained: { on: true, perBlock: 2 },
    stains: [{ assayId: 1 }, { assayId: 2 }], scan: { x20: true },
  }, lookup);
  const units = Object.fromEntries(est.lines.map((l) => [l.code, l.units]));
  // FIXED and BLOCK: 1 H&E + 2 unstained + 2 stains = 5 slides each; SLIDES: 3 slides (no unstained), no cutting.
  assert.deepEqual(units, { HP003003: 1, HP004001: 2, HP004002: 8, HP005003: 3, HP006004: 3, HP006011: 3, HP001006: 6, HP001009: 3 });
  assert.ok(est.assumptions.some((a) => /Unstained slides cannot be cut/.test(a)));
  const neu = IHC.estimateIhc({ samples: [{ type: 'FROZEN' }], stains: [{ newAntibody: { name: 'X', supplied: true } }] }, lookup);
  assert.deepEqual(Object.fromEntries(neu.lines.map((l) => [l.code, l.units])), { HP003005: 1, HP004001: 1, HP006005: 1, HP009002: 8 });
  assert.deepEqual(IHC.ihcAreas({ samples: [{ type: 'BLOCK' }], scan: {} }), ['MICRO', 'STAIN']);
});

test('the request form: validation, estimate, warnings and submission', () => {
  const { ok, err, find, state } = setup();
  assert.match(err('POST', '/api/ihc/requests', {}), /last name.*bill.*email.*project ID.*species.*fixative.*at least one organ.*at least one thing/);
  const cd8 = find((a) => a.name === 'CD8' && a.kind === 'IHC' && a.catalog.startsWith('ab101500'));
  const body = draft({ stains: [{ assayId: cd8.id }], fixDate: '2026-10-01' });
  const est = ok('POST', '/api/ihc/estimate', body);
  assert.ok(est.estimate.total > 0);
  assert.ok(est.warnings.some((w) => /listed for Human, not mouse/.test(w)));
  assert.ok(est.warnings.some((w) => /34 days/.test(w)));
  const before = state.ihcRequests.length;
  const res = ok('POST', '/api/ihc/requests', body);
  assert.match(res.number, /^MH26-\d{4}$/);
  assert.equal(state.ihcRequests.length, before + 1);
  const w = state.ihcRequests.at(-1);
  assert.equal(w.stains[0].snapshot.dilution, cd8.dilution, 'the protocol is kept as requested');
  assert.equal(state.audit.at(-1).by, 'WEB');
  const dup = find((a) => a.status === 'Active');
  ok('POST', `/api/ihc/assays/${dup.id}/retire`, { reason: 'test' });
  assert.match(err('POST', '/api/ihc/requests', draft({ stains: [{ assayId: dup.id }] })), /retired/);
  assert.match(err('POST', '/api/ihc/requests', draft({ stains: [{ newAntibody: { name: 'XYZ' } }] })), /manufacturer/);
});

test('accepting a request creates a LIMS request with PHL numbers; declining needs a reason', () => {
  const { ok, err, state, call } = setup();
  const okafor = state.ihcRequests.find((w) => w.requester.last === 'Okafor');
  const detail = ok('GET', `/api/ihc/requests/${okafor.id}`);
  assert.equal(detail.matches.length, 4, 'the lung blocks are already PHL numbers from ZAP2215');
  assert.ok(detail.matches.every((m) => m.studyZap === 'ZAP2215'));

  // A closed NAS request makes the whole accept fail and change nothing.
  const used = state.nas.find((n) => n.requestId);
  used.closed = true;
  const snapshot = JSON.stringify(state);
  assert.match(err('POST', `/api/ihc/requests/${okafor.id}/accept`, { nasId: used.id }), /is closed/);
  assert.equal(JSON.stringify(state), snapshot);
  used.closed = false;

  const res = ok('POST', `/api/ihc/requests/${okafor.id}/accept`, {});
  const r = state.requests.find((x) => x.id === res.id);
  assert.equal(r.type, 'MOLEC');
  assert.equal(r.nasId, null);
  assert.equal(r.webRequestId, okafor.id);
  assert.deepEqual(r.areas, ['MICRO', 'STAIN', 'IMAGE']);
  assert.equal(r.estimateTotal, detail.estimate.total);
  const subjects = state.subjects.filter((s) => s.requestId === r.id);
  assert.equal(subjects.length, 4);
  assert.match(subjects[0].label, /^Lungs, 26000300A$/);
  assert.equal(state.ihcRequests.find((w) => w.id === okafor.id).status, 'Accepted');
  assert.match(err('POST', `/api/ihc/requests/${okafor.id}/accept`, {}), /accepted/);

  // Link a NAS request afterwards.
  const nas = state.nas.find((n) => !n.requestId);
  ok('POST', `/api/requests/${r.id}/nas`, { nasId: nas.id });
  assert.equal(state.requests.find((x) => x.id === r.id).nasId, nas.id);
  assert.match(err('POST', `/api/requests/${r.id}/nas`, { nasId: nas.id }), /already has a NAS request/);

  const sheet = ok('GET', `/api/requests/${r.id}/ihc`);
  assert.deepEqual(sheet.blocks.map((b) => b.phl), subjects.map((s) => s.phl).sort());
  assert.equal(sheet.stains.length, 2);

  const other = state.ihcRequests.find((w) => w.status === 'Submitted');
  assert.match(err('POST', `/api/ihc/requests/${other.id}/decline`, {}), /reason/);
  ok('POST', `/api/ihc/requests/${other.id}/decline`, { reason: 'Please send fixed tissue instead.' });
  assert.equal(state.ihcRequests.find((w) => w.id === other.id).status, 'Declined');
});

test('catalog: search with fit, edit, check, retire and add', () => {
  const { ok, err, state, find } = setup();
  const res = ok('GET', '/api/ihc/assays', null, { q: 'cd8', fitSpecies: 'Mouse', fitFixative: '10% NBF', fitTypes: 'FIXED' });
  assert.ok(res.total > 5);
  assert.deepEqual(res.assays[0].fit, [], 'assays that fit a mouse NBF sample come first');
  assert.notEqual(res.assays[0].name, 'CD86');
  assert.ok(res.assays.some((a) => a.fit.length));

  const flagged = find((a) => a.flags.includes('dilution-recovered'));
  ok('PATCH', `/api/ihc/assays/${flagged.id}`, { dilution: `${flagged.dilution} 60'` });
  const a1 = state.assays.find((a) => a.id === flagged.id);
  assert.ok(!a1.flags.includes('dilution-recovered'), 'editing the dilution counts as checking it');
  assert.match(state.audit.at(-1).detail, /Dilution and time: .* → .*60'/);

  const other = find((a) => a.flags.includes('dilution-recovered'));
  ok('POST', `/api/ihc/assays/${other.id}/check`, {});
  assert.deepEqual(state.assays.find((a) => a.id === other.id).flags, []);
  assert.match(err('POST', `/api/ihc/assays/${other.id}/check`, {}), /Nothing/);

  assert.match(err('POST', `/api/ihc/assays/${other.id}/retire`, {}), /reason/);
  ok('POST', `/api/ihc/assays/${other.id}/retire`, { reason: 'Replaced by a new clone' });
  assert.equal(ok('GET', '/api/ihc/assays', null, { q: `#${other.id}` }).total, 0, 'retired assays are hidden by default');
  ok('POST', `/api/ihc/assays/${other.id}/restore`, {});

  const added = ok('POST', '/api/ihc/assays', { name: 'Duplex FOO + BAR', kit: 'Bond Polymer Refine, OPAL 520; OPAL 690', species: 'Mouse', fixative: '10% NBF' });
  const a2 = state.assays.find((a) => a.id === added.id);
  assert.equal(a2.kind, 'Opal');
  assert.equal(a2.plex, 2);
  assert.deepEqual(a2.speciesTags, ['Mouse']);
  assert.match(err('POST', '/api/ihc/assays', { name: '' }), /antibody name/);
  const detail = ok('GET', `/api/ihc/assays/${a1.id}`);
  assert.ok(detail.history.length >= 1);
});

test('search finds IHC requests, blocks and antibodies', () => {
  const { ok, state } = setup();
  const sub = state.ihcRequests.find((w) => w.status === 'Submitted');
  assert.ok(ok('GET', '/api/search', null, { q: sub.number }).hits.some((h) => h.href === `#/molecular/request/${sub.id}`));
  const accepted = state.ihcRequests.find((w) => w.status === 'Accepted');
  assert.ok(ok('GET', '/api/search', null, { q: accepted.number }).hits.some((h) => h.id === accepted.requestId && h.href.startsWith('#/request/')));
  const s = ok('GET', '/api/search', null, { q: 'ab101500' });
  assert.ok(s.assays.count >= 2);
  const ferreira = state.ihcRequests.find((w) => w.requester.last === 'Ferreira');
  assert.ok(ok('GET', '/api/search', null, { q: 'LF-22' }).hits.some((h) => h.id === ferreira.id && /Block LF-22/.test(h.matched)));
});

test('data saved before the IHC module gets the catalog on start-up', () => {
  const old = emptyState(TODAY);
  delete old.assays; delete old.ihcRequests; delete old.pathology; delete old.pathAssign; old.version = 1;
  let saved = 0;
  const core = createCore({ state: old, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T09:00:00` }, save: () => { saved++; } });
  assert.equal(old.assays.length, ihcCatalog.assays.length);
  assert.deepEqual(old.ihcRequests, []);
  assert.equal(old.version, 7);   // every later upgrade runs too
  assert.deepEqual(old.pathology, {});
  assert.equal(saved, 5);   // the catalog, the pathology module, and the version-5, 6 and 7 stamps
  assert.equal(core.handle('GET', '/api/meta').json.ihc.catalog.entries, ihcCatalog.assays.length);
});

test('blocks already at MHL keep a link to their original PHL number', () => {
  const { ok, state } = setup();
  const okafor = state.ihcRequests.find((w) => w.requester.last === 'Okafor');
  const res = ok('POST', `/api/ihc/requests/${okafor.id}/accept`, {});
  const subjects = state.subjects.filter((s) => s.requestId === res.id).sort((a, b) => a.sampleIndex - b.sampleIndex);
  const sources = subjects.map((s) => state.subjects.find((x) => x.id === s.sourceSubjectId)?.phl);
  assert.deepEqual(sources, okafor.samples.map((s) => s.blockNo));
  const sheet = ok('GET', `/api/requests/${res.id}/ihc`);
  assert.ok(sheet.blocks.every((b) => b.source && b.source.requestNumber));
});
