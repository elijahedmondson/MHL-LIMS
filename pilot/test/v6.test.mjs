// Tests for version 6 of the pilot: a request number entered by hand at New request step 5, and the printable
// MHL Request Tracking Form (the paper sheet that follows the samples through the lab).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as R from '../../tools/rules-reference/rules.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-09';

function fresh() {
  const state = seedState({ priceList, ihcCatalog, today: TODAY });
  state.settings.initials = 'TT';
  const core = createCore({ state, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  const call = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`); return r.file || r.json; };
  const fails = (method, p, body = null) => { const r = core.handle(method, p, {}, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { raw: state, core, call, fails };
}
const openNas = (state, type) => state.nas.find((n) => !n.requestId && (!type || n.type === type));
const body = (nas, extra = {}) => ({ nasId: nas.id, type: 'HISTO', n: 2, species: 'MOUSE', study: { mode: 'none' },
  lines: [{ section: 'TRIM_EMBED', code: 'HP003003', units: 2 }], ...extra });
const live = (t) => t.core.handle('GET', '/api/requests', {}, null).json.requests;

// ---------- request number by hand ----------
test('a request number entered by hand is used as given, upper-cased, flagged and audited', () => {
  const t = fresh();
  const nas = openNas(t.raw, 'NECRO-FULL');
  const before = structuredClone(t.raw.counters['REQ-HP']);
  const res = t.call('POST', '/api/requests', body(nas, { requestNumber: ' 270333a ', tissueDisp: 'rtrn' }));
  assert.equal(res.number, '270333A');
  const req = t.raw.requests.find((r) => r.id === res.id);
  assert.equal(req.numberEnteredByHand, true);
  assert.equal(req.tissueDisp, 'RTRN');
  assert.deepEqual(t.raw.counters['REQ-HP'], before, 'a number by hand does not use up an automatic number');
  assert.match(t.raw.audit.at(-1).detail, /270333A \(number entered by hand\)/);
  assert.ok(live(t).some((r) => r.number === '270333A'));
});

test('a number by hand is refused when it is malformed, already used, or ends like another request of the same lab', () => {
  const t = fresh();
  const nas = openNas(t.raw);
  for (const bad of ['12', 'ABCD', '27 0333', '27/0333', '-27033', 'X1234567890123', '1---', '0000', '27--0333', '27-0333', '2703-3']) {
    assert.match(t.fails('POST', '/api/requests', body(nas, { requestNumber: bad })), /4 to 12 letters and digits/, bad);
  }
  // Hyphens between parts are fine while the billing trans ID (last five) stays letters and digits.
  assert.equal(t.call('GET', '/api/requests/check-number', null, { type: 'HISTO', number: '2026-00123' }).transId, 'H00123');
  // The other lab's automatic format is refused, so an HP request cannot be called PA260009 (or the reverse).
  assert.match(t.fails('POST', '/api/requests', body(nas, { requestNumber: 'PA260009' })), /looks like a PA request number/);
  assert.match(t.call('GET', '/api/requests/check-number', null, { type: 'PATH-ONLY', number: 'HP260150' }).problem, /belongs to the PA lab/);
  assert.equal(t.call('GET', '/api/requests/check-number', null, { type: 'HISTO', number: 'HP260150' }).ok, true);
  assert.match(t.fails('POST', '/api/requests', body(nas, { requestNumber: 'hp260097' })), /already exists/);
  // Rpt080 knows HP260097 as H60097, so 260097 (and X60097) would be the same request on the billing extract.
  assert.match(t.fails('POST', '/api/requests', body(nas, { requestNumber: '260097' })), /last five characters.*HP260097/);
  assert.match(t.fails('POST', '/api/requests', body(nas, { requestNumber: 'X60097' })), /HP260097/);
  // The same last five in another lab is a different trans ID, so a pathology-only request may use it.
  assert.equal(R.transId('PA', '260097'), 'P60097');
  assert.equal(openNas(t.raw).requestId, null, 'nothing was created by the refused calls');
  assert.equal(t.raw.requests.length, 8);
});

test('next-number shows the next automatic number without taking it; check-number explains the answer', () => {
  const t = fresh();
  const peek = (type) => t.call('GET', '/api/requests/next-number', null, { type });
  assert.deepEqual(peek('HISTO'), { number: 'HP260103', lab: 'HP' });
  assert.deepEqual(peek('PATH-ONLY'), { number: 'PA260009', lab: 'PA' });
  assert.equal(peek('HISTO').number, 'HP260103', 'peeking twice does not allocate');
  const saved = t.raw.counters['REQ-HP'];
  t.raw.counters['REQ-HP'] = undefined; delete t.raw.counters['REQ-HP'];
  assert.equal(peek('HISTO').number, 'HP260001', 'with no counter it starts at one');
  assert.equal(t.raw.counters['REQ-HP'], undefined, 'a GET writes nothing, not even an empty counter');
  t.raw.counters['REQ-HP'] = { 26: 96 };
  assert.equal(peek('HISTO').number, 'HP260103', 'a counter behind the numbers in use steps over them (HP260096 to HP260102)');
  t.raw.counters['REQ-HP'] = saved;
  const ok = t.call('GET', '/api/requests/check-number', null, { type: 'HISTO', number: '270333' });
  assert.deepEqual(ok, { number: '270333', ok: true, problem: '', transId: 'H70333' });
  const clash = t.call('GET', '/api/requests/check-number', null, { type: 'HISTO', number: '260097' });
  assert.equal(clash.ok, false); assert.match(clash.problem, /HP260097/); assert.equal(clash.transId, '');
  // Unknown or missing types fall back to the histopathology lab rather than failing.
  assert.equal(t.call('GET', '/api/requests/check-number', null, { number: '270333' }).ok, true);
  // Then the automatic number is the one that was shown.
  const res = t.call('POST', '/api/requests', body(openNas(t.raw)));
  assert.equal(res.number, 'HP260103');
  assert.equal(peek('HISTO').number, 'HP260104');
});

test('automatic numbering steps over a number already taken by hand, or one that would clash on the billing extract', () => {
  const t = fresh();
  const [a, b, c] = t.raw.nas.filter((n) => !n.requestId);
  t.call('POST', '/api/requests', body(a, { requestNumber: 'HP260103' }));
  t.call('POST', '/api/requests', body(b, { requestNumber: '60104' }));    // H60104, the same trans ID as HP260104
  assert.equal(t.call('GET', '/api/requests/next-number', null, { type: 'HISTO' }).number, 'HP260105');
  assert.equal(t.call('POST', '/api/requests', body(c)).number, 'HP260105');
  const transIds = t.raw.requests.filter((r) => r.lab === 'HP').map((r) => R.transId('HP', r.number));
  assert.equal(new Set(transIds).size, transIds.length, 'every HP request has its own billing trans ID');
});

test('a failed create leaves the request counter and NAS request untouched', () => {
  const t = fresh();
  const nas = openNas(t.raw);
  t.fails('POST', '/api/requests', body(nas, { lines: [] }));
  t.fails('POST', '/api/requests', body(nas, { requestNumber: '260097' }));
  assert.equal(t.call('GET', '/api/requests/next-number', null, { type: 'HISTO' }).number, 'HP260103');
});

// ---------- tracking sheet ----------
test('the tracking sheet has the legacy columns, shades the work areas the request does not include, and groups by priority', () => {
  const t = fresh();
  const req = t.raw.requests.find((r) => r.number === 'HP260101');
  const sheet = t.call('GET', `/api/requests/${req.id}/tracking-sheet`);
  assert.deepEqual(sheet.columns.map((c) => c.label), ['Hema/Blood Chem', 'Necro', 'Trimm', 'Embed', 'Micro', 'Stain', 'Image', 'Path', 'Other', 'QC']);
  assert.ok(sheet.columns.every((c) => c.inRequest), 'a full necropsy uses every column');
  assert.deepEqual(sheet.groups.map((g) => g.label), sheet.groups.map((g) => ({ S: 'STAT', P: 'Priority', R: 'Routine' })[g.priority]));
  const order = sheet.groups.map((g) => 'SPR'.indexOf(g.priority));
  assert.deepEqual(order, [...order].sort((x, y) => x - y), 'STAT first, then Priority, then Routine');
  assert.equal(sheet.groups.reduce((n, g) => n + g.rows.length, 0), sheet.count);
  assert.equal(sheet.count, t.raw.subjects.filter((s) => s.requestId === req.id).length);
  const h = sheet.header;
  assert.equal(h.number, 'HP260101'); assert.equal(h.lab, 'HP'); assert.equal(h.typeCode, 'NECRO-FULL');
  assert.equal(h.estimatedCost, req.estimateTotal);
  assert.equal(h.approvedBudget, t.raw.nas.find((n) => n.id === req.nasId)?.authorized ?? null);
  assert.equal(h.printedOn, TODAY);

  const histo = t.raw.requests.find((r) => r.number === 'HP260096');
  const hs = t.call('GET', `/api/requests/${histo.id}/tracking-sheet`);
  const shaded = hs.columns.filter((c) => !c.inRequest).map((c) => c.code);
  assert.deepEqual(shaded, ['BLOOD', 'NECRO', 'IMAGE', 'PATHO']);
  assert.ok(!hs.columns.some((c) => c.code === 'SPATL'), 'the Xenium column appears only on Xenium requests');
  const xen = t.raw.requests.find((r) => r.number === 'HP260099');
  assert.ok(t.call('GET', `/api/requests/${xen.id}/tracking-sheet`).columns.some((c) => c.code === 'SPATL' && c.inRequest));
});

test('the tracking sheet can show who finished each work area, from the recorded moves', () => {
  const t = fresh();
  const nas = openNas(t.raw);
  const res = t.call('POST', '/api/requests', body(nas, { requestNumber: '270333', tissueDisp: 'RTRN' }));
  let sheet = t.call('GET', `/api/requests/${res.id}/tracking-sheet`);
  assert.equal(sheet.header.number, '270333');
  assert.equal(sheet.header.tissueDisp, 'RTRN');
  assert.equal(sheet.header.contact, 'TT');
  assert.ok(sheet.groups.flatMap((g) => g.rows).every((r) => Object.keys(r.done).length === 0), 'a new request has nothing done');
  const ids = t.raw.subjects.filter((s) => s.requestId === res.id).map((s) => s.id);
  t.call('POST', `/api/requests/${res.id}/move`, { to: 'TRIMM', subjectIds: ids });
  t.call('POST', `/api/requests/${res.id}/move`, { to: 'EMBED', subjectIds: [ids[0]] });
  sheet = t.call('GET', `/api/requests/${res.id}/tracking-sheet`);
  const rows = sheet.groups.flatMap((g) => g.rows);
  const first = rows.find((r) => r.id === ids[0]);
  assert.deepEqual(first.done.TRIMM, { by: 'TT', date: TODAY });
  assert.equal(first.done.ENTRY, undefined, 'accessioning is not a work area on the sheet');
  assert.deepEqual(rows.find((r) => r.id === ids[1]).done, {});
  // A move back for a recut does not mark the later area done; the real forward move does, by whoever made it.
  t.call('POST', `/api/requests/${res.id}/move`, { to: 'TRIMM', subjectIds: [ids[0]] });
  t.raw.settings.initials = 'QB';
  t.call('POST', `/api/requests/${res.id}/move`, { to: 'EMBED', subjectIds: [ids[0]] });
  t.call('POST', `/api/requests/${res.id}/move`, { to: 'MICRO', subjectIds: [ids[0]] });
  const again = t.call('GET', `/api/requests/${res.id}/tracking-sheet`).groups.flatMap((g) => g.rows).find((r) => r.id === ids[0]);
  assert.deepEqual(again.done.TRIMM, { by: 'TT', date: TODAY }, 'the first time trimming finished');
  assert.deepEqual(again.done.EMBED, { by: 'QB', date: TODAY }, 'embedding finished when it moved on to microtomy, not when it was sent back');
});

test('the sheet names the pathologist assigned in the LIMS ahead of the one asked for on an IHC web request', () => {
  const t = fresh();
  const req = t.raw.requests.find((r) => r.webRequestId);
  if (!req) return;   // the seed has no request from the IHC web form
  const web = t.raw.ihcRequests.find((w) => w.id === req.webRequestId);
  web.pathologist = 'Dr. Asked For';
  const subs = t.raw.subjects.filter((s) => s.requestId === req.id);
  for (const s of subs) { delete t.raw.pathAssign[s.id]; delete t.raw.pathology[s.id]; }
  assert.equal(t.call('GET', `/api/requests/${req.id}/tracking-sheet`).header.pathologist, 'Dr. Asked For');
  t.raw.pathAssign[subs[0].id] = 'ZZ';
  assert.equal(t.call('GET', `/api/requests/${req.id}/tracking-sheet`).header.pathologist, 'ZZ');
});

test('the tracking sheet of a seeded request in progress has work filled in, and an unknown request fails', () => {
  const t = fresh();
  const req = t.raw.requests.find((r) => r.number === 'HP260097');
  const rows = t.call('GET', `/api/requests/${req.id}/tracking-sheet`).groups.flatMap((g) => g.rows);
  assert.ok(rows.some((r) => Object.keys(r.done).length > 0));
  for (const r of rows) for (const [area, d] of Object.entries(r.done)) {
    assert.ok(['BLOOD', 'NECRO', 'TRIMM', 'EMBED', 'MICRO', 'STAIN', 'SPATL', 'IMAGE', 'PATHO', 'OTHER', 'QC-PA'].includes(area), area);
    assert.match(d.date, /^\d{4}-\d\d-\d\d$/);
  }
  t.fails('GET', '/api/requests/999999/tracking-sheet');
});

test('the standalone bundle includes the tracking sheet view', () => {
  const src = bundleModules();
  assert.ok(src.includes("__define('tracking'"));
  const require = new Function(`${LOADER}\n${src}\nreturn __require;`)();
  assert.equal(typeof require('core').createCore, 'function');
});
