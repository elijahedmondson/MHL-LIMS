// Tests for the pilot core: seed integrity, intake, tracking, charges, billing, necropsy, studies, rollback.
//   node --test test/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import { describe as stats } from '../core/stats.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const priceList = JSON.parse(readFileSync(path.join(here, '..', '..', 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(here, '..', '..', 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-03';

function setup() {
  const state = seedState({ priceList, ihcCatalog, today: TODAY });
  const clock = { day: TODAY, today: () => clock.day, now: () => `${clock.day}T10:00:00` };
  let saves = 0;
  const core = createCore({ state, priceList, ihcCatalog, clock, save: () => { saves++; }, reseed: () => seedState({ priceList, ihcCatalog, today: clock.day }) });
  state.settings.initials = 'TE';
  const call = (method, p, body = null, query = {}) => core.handle(method, p, query, body);
  const ok = (method, p, body, query) => { const r = call(method, p, body, query); assert.equal(r.status, 200, `${method} ${p}: ${r.json?.error}`); return r.json ?? r.file; };
  const err = (method, p, body, query) => { const r = call(method, p, body, query); assert.notEqual(r.status, 200, `${method} ${p} should fail`); return r.json.error; };
  return { state, core, clock, call, ok, err, saves: () => saves };
}

test('seed data is consistent', () => {
  const { state } = setup();
  assert.equal(state.requests.length, 8);   // 7 from NAS intake, 1 accepted from the IHC request form
  assert.equal(state.studies.length, 2);
  assert.equal(state.batches.length, 1);
  const b = state.batches[0];
  const released = state.charges.filter((c) => c.status === 'RELEASED');
  assert.equal(released.length, b.lineCount);
  assert.ok(released.every((c) => c.batchId === b.id));
  assert.equal(Math.round(released.reduce((a, c) => a + c.amount, 0) * 100) / 100, b.total);
  const phls = state.subjects.map((s) => s.phl);
  assert.equal(new Set(phls).size, phls.length, 'MHL numbers are unique');
  assert.ok(phls.every((p) => /^\d{8}[A-Z]$/.test(p)));
  assert.equal(Object.values(state.necropsies).filter((n) => n.status === 'APPROVED').length, 12);
  assert.equal(state.nas.filter((n) => !n.requestId).length, 3);
});

test('search finds requests by every identifier', () => {
  const { ok, state } = setup();
  const oka = state.requests.find((r) => r.pi.last === 'Okafor');
  const phl = state.subjects.find((s) => s.requestId === oka.id).phl;
  const nas = state.nas.find((n) => n.id === oka.nasId).number;
  for (const q of [oka.number, phl, 'ZAP2215', 'zap 2215', nas, `NAS# ${nas}`, 'okaf']) {
    const { hits } = ok('GET', '/api/search', null, { q });
    assert.ok(hits.some((h) => h.id === oka.id), `search "${q}"`);
  }
  assert.deepEqual(ok('GET', '/api/search', null, { q: 'x' }).hits, []);
});

test('intake creates a request, MHL numbers and a study from an approved NAS request', () => {
  const { ok, err, state } = setup();
  const nas = ok('POST', '/api/nas', { requesterLast: 'Tester', requesterFirst: 'Ana', authorized: 3000, type: 'NECRO-FULL', n: 5, species: 'MOUSE', description: 'Test' }).nas;
  assert.match(nas.number, /^26-\d{4}$/);
  const before = state.subjects.length;
  const res = ok('POST', '/api/requests', {
    nasId: nas.id, type: 'NECRO-FULL', n: 5, species: 'MOUSE', priority: 'S',
    study: { mode: 'new', title: 'Intake test study', protocolId: 2 },
    lines: [{ section: 'NECRO', code: 'HP002001', units: 5 }, { section: 'PATH', code: 'PA001002', units: 15 }],
  });
  assert.match(res.number, /^HP26\d{4}$/);
  assert.equal(res.phls.length, 5);
  assert.equal(state.subjects.length, before + 5);
  const r = state.requests.find((x) => x.id === res.id);
  assert.equal(r.estimateTotal, 562.9);  // 5 x 41.06 + 15 x 23.84
  assert.equal(r.status, 'Open');
  const study = state.studies.find((s) => s.id === r.studyId);
  assert.match(study.zap, /^ZAP\d+$/);
  assert.equal(study.necropsyProtocolId, 2);   // the placeholder protocol 2 is a necropsy protocol and a trim protocol
  assert.equal(study.trimProtocolId, 2);
  const subjects = state.subjects.filter((s) => s.requestId === r.id);
  assert.ok(subjects.every((s) => s.area === 'ENTRY' && s.priority === 'S' && s.studyId === study.id));
  // consecutive MHL numbers after the seeded ones
  const nums = res.phls.map((p) => Number(p.slice(2, 8)));
  assert.deepEqual(nums, nums.map((_, i) => nums[0] + i));
  // A NAS request can fund another request (say the main study after a pilot) until it is closed.
  const second = ok('POST', '/api/requests', { nasId: nas.id, type: 'HISTO', n: 1, lines: [{ section: 'STAIN', code: 'HP005003', units: 1 }] });
  assert.equal(state.requests.find((x) => x.id === second.id).nasId, nas.id);
  ok('POST', `/api/nas/${nas.id}/close`, {});
  assert.match(err('POST', '/api/requests', { nasId: nas.id, type: 'HISTO', n: 1, lines: [{ section: 'STAIN', code: 'HP005003', units: 1 }] }), /is closed/);
});

test('a failed change leaves the data untouched', () => {
  const { call, state } = setup();
  const nas = state.nas.find((n) => !n.requestId);
  const snapshot = JSON.stringify(state);
  const r = call('POST', '/api/requests', { nasId: nas.id, type: nas.type, n: 3, study: { mode: 'new', title: 'x' }, lines: [{ section: 'NECRO', code: 'HP002018', units: 1 }] });
  assert.equal(r.status, 400);
  assert.match(r.json.error, /no price/);
  assert.equal(JSON.stringify(state), snapshot);
});

// Note: a failed change restores a copy of the data, so tests look records up again after one.
test('moves are tracked and a request completes only when every MHL# is complete', () => {
  const { ok, err, state } = setup();
  const scan = () => state.requests.find((x) => x.type === 'SCAN');
  const r = scan();
  const ids = state.subjects.filter((s) => s.requestId === r.id).map((s) => s.id);
  assert.match(err('POST', `/api/requests/${r.id}/complete`, {}), /cannot be completed/);
  assert.equal(ok('POST', `/api/requests/${r.id}/move`, { to: 'QC-PA', subjectIds: ids }).moved, ids.length);
  assert.equal(ok('POST', `/api/requests/${r.id}/move`, { to: 'QC-PA', subjectIds: ids }).moved, 0);
  ok('POST', `/api/requests/${r.id}/complete`, {});
  assert.equal(scan().status, 'Complete');
  const detail = ok('GET', `/api/requests/${r.id}`);
  assert.ok(detail.events.some((e) => e.to === 'QC-PA' && e.by === 'TE'));
  assert.match(err('POST', `/api/requests/${r.id}/move`, { to: 'NOWHERE', subjectIds: ids }), /Unknown work area/);
});

test('charges: add, describe, edit, approve, void and adjust', () => {
  const { ok, err, state } = setup();
  const r = state.requests.find((x) => x.type === 'MOLEC');
  assert.match(err('POST', `/api/requests/${r.id}/charges`, { section: 'STAIN', code: 'HP009002', units: 2 }), /needs a description/);
  const c = ok('POST', `/api/requests/${r.id}/charges`, { section: 'STAIN', code: 'HP009002', units: 2, note: 'Antibody titration' }).charge;
  assert.equal(c.amount, 49.9);
  assert.equal(c.status, 'PENDING');
  assert.equal(ok('PATCH', `/api/charges/${c.id}`, { units: 3, note: 'Antibody titration' }).charge.amount, 74.85);
  ok('POST', `/api/charges/${c.id}/approve`, {});
  assert.match(err('PATCH', `/api/charges/${c.id}`, { units: 4 }), /Only pending/);
  ok('POST', `/api/charges/${c.id}/return`, {});
  ok('POST', `/api/charges/${c.id}/void`, { reason: 'Entered twice' });
  assert.match(err('POST', `/api/charges/${c.id}/approve`, {}), /Only pending/);
  assert.match(err('POST', `/api/requests/${r.id}/charges`, { section: 'NECRO', code: 'HP005003', units: 1 }), /not part of the NECRO section/);

  const released = state.charges.find((x) => x.status === 'RELEASED' && x.units >= 12);
  assert.match(err('POST', `/api/charges/${released.id}/void`, {}), /Released charges cannot be voided/);
  const adj = ok('POST', `/api/charges/${released.id}/adjust`, { unitsDelta: -2, reason: 'Two animals not necropsied' }).charge;
  assert.equal(adj.sourceType, 'ADJUSTMENT');
  assert.equal(adj.amount, -2 * released.unitPrice);
  assert.match(err('POST', `/api/charges/${released.id}/adjust`, { unitsDelta: -(released.units - 1), reason: 'too much' }), /reverse more units/);
});

test('billing QC and batch release produce the extract file and lock charges', () => {
  const { ok, err, state } = setup();
  const oka = state.requests.find((x) => x.pi.last === 'Okafor');
  assert.ok(ok('POST', `/api/requests/${oka.id}/approve-pending`, {}).approved > 0);
  ok('POST', `/api/requests/${oka.id}/review`, { outcome: 'OK' });
  const q = { lab: 'HP', start: '2026-10-14', end: TODAY };
  const preview = ok('GET', '/api/billing/preview', null, q);
  assert.ok(preview.lines.length > 0);
  assert.ok(preview.lines.every((l) => l.status === 'APPROVED' && l.code.startsWith('HP')));
  assert.match(preview.file, /^H\d{5},261103,/m);
  const res = ok('POST', '/api/billing/batches', q).batch;
  assert.equal(res.fileName, 'HP261103.txt');
  assert.equal(res.lineCount, preview.lines.length);
  assert.ok(state.charges.filter((c) => c.batchId === res.id).every((c) => c.status === 'RELEASED'));
  assert.match(err('POST', '/api/billing/batches', q), /no approved charges/);
  const file = ok('GET', `/api/billing/batches/${res.id}/file`);
  assert.equal(file.name, 'HP261103.txt');
  assert.equal(file.content, preview.file);
  // another batch with the same end date gets its own file name
  const pa = state.requests.find((x) => x.lab === 'PA');
  const pc = ok('POST', `/api/requests/${pa.id}/charges`, { section: 'PATH', code: 'PA001002', units: 18 }).charge;
  ok('POST', `/api/charges/${pc.id}/approve`, {});
  assert.equal(ok('POST', '/api/billing/batches', { lab: 'PA', start: '2026-10-01', end: TODAY }).batch.fileName, 'PA261103.txt');
});

test('necropsy: draft, validation, approval creates charges, unapprove voids them', () => {
  const { ok, err, state } = setup();
  const bre = state.requests.find((x) => x.pi.last === 'Brennan');
  const subjId = state.subjects.filter((s) => s.requestId === bre.id).sort((a, b) => a.phl.localeCompare(b.phl))[4].id;
  const live = () => state.subjects.find((s) => s.id === subjId);
  const subj = { id: subjId, get area() { return live().area; } };
  assert.equal(subj.area, 'ENTRY');
  let d = ok('GET', `/api/necropsy/${subj.id}`);
  assert.equal(d.protocol.name, 'Lung perfusion');
  assert.equal(d.necropsy.perfusion, 'lung');
  d = ok('PUT', `/api/necropsy/${subj.id}`, { ...d.necropsy, bodyWeight: 25.1 });
  assert.equal(subj.area, 'NECRO');
  assert.match(err('POST', `/api/necropsy/${subj.id}/approve`, d.necropsy), /weigh Lungs, Heart, Liver.*cage card/);
  const organs = d.necropsy.organs.map((o) => (o.weigh ? { ...o, weight: 0.2 } : o));
  organs[0].findings = [{ morphology: 'Focus', color: 'Red', site: 'Focal', fixation: ['NBF'] }];
  const body = { ...d.necropsy, organs, matchesCageCard: true, extras: { ...d.necropsy.extras, snapFreezeTubes: 3, terminalBleed: true } };
  d = ok('POST', `/api/necropsy/${subj.id}/approve`, body);
  assert.equal(d.necropsy.status, 'APPROVED');
  assert.deepEqual(d.charges.map((c) => `${c.code}x${c.units}`).sort(), ['HP002001x1', 'HP002005x1', 'HP002008x1', 'HP002016x3']);
  assert.ok(d.charges.every((c) => c.status === 'PENDING' && c.sourceType === 'EVENT' && c.subjectId === subj.id));
  assert.equal(subj.area, 'TRIMM');
  assert.match(err('PUT', `/api/necropsy/${subj.id}`, body), /approved/);
  assert.match(err('POST', `/api/necropsy/${subj.id}/unapprove`, {}), /reason/);
  d = ok('POST', `/api/necropsy/${subj.id}/unapprove`, { reason: 'Wrong animal weighed' });
  assert.equal(d.necropsy.status, 'DRAFT');
  assert.equal(subj.area, 'NECRO');
  assert.ok(state.charges.filter((c) => c.necropsySubjectId === subj.id).every((c) => c.status === 'VOID'));

  // released charges block unapproval
  const okaSubj = state.subjects.find((s) => state.necropsies[s.id]?.status === 'APPROVED');
  assert.match(err('POST', `/api/necropsy/${okaSubj.id}/unapprove`, { reason: 'test' }), /already been released/);
});

test('study summary: weights, relative weights, incidence and CSV', () => {
  const { ok, state } = setup();
  const study = state.studies.find((s) => s.zap === 'ZAP2215');
  const d = ok('GET', `/api/studies/${study.id}`);
  const bw = d.absolute.find((s) => s.label === 'Body weight');
  assert.deepEqual(bw.groups.map((g) => [g.code, g.n]), [['G1', 4], ['G2', 4], ['G3', 4]]);
  const g1 = bw.points.filter((p) => p.group === 'G1').map((p) => p.value);
  assert.equal(bw.groups[0].mean, Number(stats(g1).mean.toPrecision(4)));
  assert.ok(bw.groups.every((g) => g.ciLow < g.mean && g.mean < g.ciHigh));
  assert.equal(d.relative.length, 6);
  assert.ok(d.incidence.some((r) => r.organ === 'Lungs' && r.morphology === 'Nodule' && r.byGroup.G1 === 4));
  const csv = ok('GET', `/api/studies/${study.id}/export.csv`);
  assert.equal(csv.name, 'ZAP2215-animal-data.csv');
  assert.match(csv.content.split('\r\n')[0], /^MHL,Animal,Group,Sex,Necropsy status,Necropsy date,Body weight \(g\),Brain \(g\)/);
  assert.equal(csv.content.trim().split('\r\n').length, 13);
});

test('groups and subjects can be edited with validation', () => {
  const { ok, err, state } = setup();
  const study = state.studies.find((s) => s.zap === 'ZAP2231');
  assert.match(err('PUT', `/api/studies/${study.id}/groups`, { groups: [{ code: 'C' }] }), /still has animals/);
  ok('PUT', `/api/studies/${study.id}/groups`, { groups: [...study.groups, { code: 'X', name: 'Extra', sex: 'F' }] });
  const subj = state.subjects.find((s) => s.studyId === study.id);
  ok('PATCH', `/api/subjects/${subj.id}`, { groupCode: 'X' });
  assert.equal(subj.groupCode, 'X');
  assert.equal(subj.sex, 'F');
  assert.match(err('PATCH', `/api/subjects/${subj.id}`, { groupCode: 'NOPE' }), /not defined/);
});

test('settings, export and reset', () => {
  const { ok, err, state } = setup();
  assert.match(err('PUT', '/api/settings', { initials: 'x' }), /two to four letters/);
  ok('PUT', '/api/settings', { initials: 'abc' });
  assert.equal(state.settings.initials, 'ABC');
  const backup = ok('GET', '/api/export');
  assert.equal(JSON.parse(backup.content).requests.length, state.requests.length);
});

test('reset restores fresh test data and keeps initials', () => {
  const { ok, state } = setup();
  ok('PUT', '/api/settings', { initials: 'ZZ' });
  state.requests.pop();
  ok('POST', '/api/reset', {});
  assert.equal(state.requests.length, 8);
  assert.equal(state.assays.length, ihcCatalog.assays.length);
  assert.equal(state.settings.initials, 'ZZ');
});
