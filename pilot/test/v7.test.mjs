// Tests for version 7 of the pilot: several requests from one NAS request, the Molecular tab (IHC assignment, Xenium
// runs), the request's Necropsy tab, and the study necropsy and pathology reports.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore, upgradeToV7 } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import { fisherExact } from '../core/stats.mjs';
import * as XEN from '../core/xenium.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-10';
const seeded = seedState({ priceList, ihcCatalog, today: TODAY });

function fresh() {
  const state = structuredClone(seeded);
  state.settings.initials = 'TT';
  const core = createCore({ state, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  const call = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`); return r.file || r.json; };
  const fails = (method, p, body = null) => { const r = core.handle(method, p, {}, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { state, core, call, fails };
}
const histo = (nasId, units = 10, extra = {}) => ({ nasId, type: 'HISTO', n: 2, species: 'MOUSE', study: { mode: 'none' }, lines: [{ section: 'TRIM_EMBED', code: 'HP003003', units }], ...extra });

// ---------- several requests from one NAS request ----------
test('a NAS request funds several requests; each new one is checked against what is left, and closing it stops new ones', () => {
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const first = t.call('POST', '/api/requests', histo(nas.id, 100));   // 100 x $15.47
  let list = t.call('GET', '/api/nas').nas.find((n) => n.id === nas.id);
  assert.deepEqual([list.usage.requests.map((r) => r.number), list.usage.estimated, list.usage.remaining], [[first.number], 1547, 3453]);
  const second = t.call('POST', '/api/requests', histo(nas.id, 10));
  list = t.call('GET', '/api/nas').nas.find((n) => n.id === nas.id);
  assert.deepEqual(list.usage.requests.map((r) => r.number), [first.number, second.number]);
  assert.equal(t.state.nas.find((n) => n.id === nas.id).requestId, first.id, 'requestId stays the first request (each request carries its nasId)');
  assert.match(t.state.audit.find((a) => a.action === 'REQUEST_CREATED' && a.entityId === second.id).detail, /request 2 on it/);
  // Charges on either request count against the shared authorization.
  t.call('POST', `/api/requests/${first.id}/charges`, { section: 'TRIM_EMBED', code: 'HP003003', units: 4, date: TODAY });
  t.call('POST', `/api/requests/${second.id}/charges`, { section: 'TRIM_EMBED', code: 'HP003003', units: 2, date: TODAY });
  const f = t.call('GET', `/api/requests/${second.id}`).financials;
  assert.deepEqual([f.charged, f.nasCharged, f.nasRequests, f.remaining, f.otherRequests.map((x) => x.number)], [30.94, 92.82, 2, 4907.18, [first.number]]);
  const lookup = t.call('GET', '/api/requests', null, { status: 'Open' }).requests.find((r) => r.id === second.id).billing;
  assert.deepEqual([lookup.nasRequests, lookup.nasCharged], [2, 92.82]);
  // Closing it: no more requests, and it leaves the New request list until reopened.
  t.call('POST', `/api/nas/${nas.id}/close`, {});
  assert.match(t.fails('POST', '/api/requests', histo(nas.id)), /is closed/);
  assert.ok(!t.call('GET', '/api/nas').nas.some((n) => n.id === nas.id));
  assert.ok(t.call('GET', '/api/nas', null, { all: '1' }).nas.some((n) => n.id === nas.id && n.closed));
  assert.match(t.fails('POST', `/api/nas/${nas.id}/close`, {}), /already closed/);
  t.call('POST', `/api/nas/${nas.id}/close`, { closed: false });
  t.call('POST', '/api/requests', histo(nas.id));
  // The seed closes Nakamura's NAS request, whose work is complete.
  assert.ok(t.state.nas.find((n) => n.requester.last === 'Nakamura').closed);
});

test('the billing state turns over-authorized when the requests on a NAS request together exceed it', () => {
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Moreau');   // $950 authorized
  const a = t.call('POST', '/api/requests', histo(nas.id, 10));
  const b = t.call('POST', '/api/requests', histo(nas.id, 10));
  t.call('POST', `/api/requests/${a.id}/charges`, { section: 'TRIM_EMBED', code: 'HP003003', units: 40, date: TODAY });   // $618.80
  t.call('POST', `/api/requests/${b.id}/charges`, { section: 'TRIM_EMBED', code: 'HP003003', units: 25, date: TODAY });   // $386.75
  const rows = t.call('GET', '/api/requests', null, { status: 'Open' }).requests;
  assert.equal(rows.find((r) => r.id === b.id).billing.state, 'OVER_AUTHORIZED', 'request b alone is under $950, but the NAS request is over');
  assert.equal(rows.find((r) => r.id === a.id).billing.state, 'OVER_AUTHORIZED');
});

test('an estimate in phases gives its NAS request one scope per phase; each request records the phase it started from', () => {
  const t = fresh();
  const h = t.state.estimates.find((e) => e.investigator.last === 'Halvorsen');
  t.call('POST', `/api/estimates/${h.id}/send`); t.call('POST', `/api/estimates/${h.id}/accept`);
  const r = t.call('POST', `/api/estimates/${h.id}/nas`, { create: true, type: 'NECRO-FULL', n: 8, project: '25X0099999.01' });
  const nas = t.state.nas.find((n) => n.id === r.nasId);
  assert.deepEqual(nas.estimatePhases.map((p) => p.name), ['Pilot (8 mice)', 'Main study (32 mice)']);
  assert.deepEqual(nas.estimatePhases[0].scope.find(([, code]) => code === 'HP002001'), ['NECRO', 'HP002001', 8]);
  assert.ok(!nas.estimatePhases[0].scope.some(([, code]) => code === 'HP006004'), 'the IHC is in the main study only');
  const lines = nas.estimatePhases[0].scope.map(([section, code, units]) => ({ section, code, units }));
  const pilot = t.call('POST', '/api/requests', { nasId: nas.id, type: 'NECRO-FULL', n: 8, species: 'MOUSE', study: { mode: 'none' }, lines, estimatePhase: 'Pilot (8 mice)' });
  assert.equal(t.state.requests.find((x) => x.id === pilot.id).estimatePhase, 'Pilot (8 mice)');
  const odd = t.call('POST', '/api/requests', { ...histo(nas.id), estimatePhase: 'No such phase' });
  assert.equal(t.state.requests.find((x) => x.id === odd.id).estimatePhase, undefined, 'only a phase the NAS request has is recorded');
  const view = t.call('GET', '/api/nas').nas.find((n) => n.id === nas.id);
  assert.deepEqual(view.usage.requests.map((x) => x.estimatePhase), ['Pilot (8 mice)', '']);
  assert.deepEqual(t.call('GET', `/api/estimates/${h.id}`).nas.requests.map((x) => x.estimatePhase), ['Pilot (8 mice)', '']);
});

test('IHC web requests and request links accept a NAS request that already funds other requests', () => {
  const t = fresh();
  const okafor = t.state.ihcRequests.find((w) => w.requester.last === 'Okafor' && w.status === 'Submitted');
  const nas = t.state.nas.find((n) => n.requester.last === 'Okafor');
  assert.ok(t.call('GET', `/api/ihc/requests/${okafor.id}`).openNas.some((n) => n.id === nas.id && n.requests === 1));
  const res = t.call('POST', `/api/ihc/requests/${okafor.id}/accept`, { nasId: nas.id });
  assert.equal(t.state.requests.find((r) => r.id === res.id).nasId, nas.id);
  assert.equal(t.call('GET', `/api/requests/${res.id}`).financials.nasRequests, 2);
});

// ---------- Molecular: IHC assignment ----------
test('accepted IHC requests are assigned and worked; submitted and declined ones are not', () => {
  const t = fresh();
  const varga = t.state.ihcRequests.find((w) => w.requester.last === 'Varga' && w.status === 'Accepted');
  const list = () => t.call('GET', '/api/ihc/requests').requests;
  assert.deepEqual(['LW', 'In progress'], [list().find((r) => r.id === varga.id).assignedTo, list().find((r) => r.id === varga.id).workStatus]);
  const okafor = t.state.ihcRequests.find((w) => w.requester.last === 'Okafor' && w.status === 'Submitted');
  assert.match(t.fails('POST', '/api/ihc/requests/assign', { ids: [okafor.id], to: 'JM' }), /only accepted requests are assigned/);
  assert.match(t.fails('POST', '/api/ihc/requests/assign', { ids: [varga.id], to: 'J1' }), /two to four letters/);
  assert.match(t.fails('POST', '/api/ihc/requests/assign', { ids: [] }), /at least one/);
  const accepted = t.call('POST', `/api/ihc/requests/${okafor.id}/accept`, {});
  const w2 = t.state.ihcRequests.find((w) => w.id === okafor.id);
  assert.deepEqual([list().find((r) => r.id === w2.id).workStatus, w2.assignedTo], ['Not started', undefined]);
  assert.equal(t.call('GET', '/api/meta').ihc.unassigned, 1);
  assert.equal(t.call('POST', '/api/ihc/requests/assign', { ids: [varga.id, w2.id], to: 'jm' }).changed, 2);
  assert.deepEqual([varga, w2].map((w) => t.state.ihcRequests.find((x) => x.id === w.id).assignedTo), ['JM', 'JM']);
  // Starting work nobody was given takes it on; Done records the day.
  t.call('POST', '/api/ihc/requests/assign', { ids: [w2.id], to: '' });
  t.call('POST', `/api/ihc/requests/${w2.id}/work`, { status: 'In progress' });
  assert.equal(t.state.ihcRequests.find((x) => x.id === w2.id).assignedTo, 'TT');
  assert.match(t.fails('POST', `/api/ihc/requests/${w2.id}/work`, { status: 'In progress' }), /already in progress/);
  assert.match(t.fails('POST', `/api/ihc/requests/${w2.id}/work`, { status: 'Shipped' }), /Not started, In progress or Done/);
  t.call('POST', `/api/ihc/requests/${w2.id}/work`, { status: 'Done' });
  assert.equal(t.state.ihcRequests.find((x) => x.id === w2.id).doneOn, TODAY);
  assert.deepEqual(t.state.audit.filter((a) => a.entity === 'ihc' && a.entityId === w2.id).map((a) => a.action).slice(-4), ['IHC_ASSIGNED', 'IHC_UNASSIGNED', 'IHC_WORK', 'IHC_WORK']);
  assert.ok(accepted.id);
  assert.ok(t.call('GET', '/api/meta').staff.includes('LW'));
});

// ---------- Molecular: Xenium ----------
test('a Xenium run is planned from the queue, goes step by step, and on delivery moves its MHL numbers on', () => {
  const t = fresh();
  let x = t.call('GET', '/api/xenium');
  assert.deepEqual(x.queue.map((q) => q.label), ['ORG-3 (passage P10)'], 'two organoid lines are on the seeded run');
  const seededRun = t.state.xenium.runs[0];
  assert.deepEqual([seededRun.number, seededRun.status, seededRun.assignedTo], ['XR26-0001', 'PROBES', 'JM']);
  const org3 = x.queue[0].subjectId;
  const onRun = seededRun.slides[0].sections[0].subjectId;
  assert.match(t.fails('POST', '/api/xenium/runs', { assay: 'PRIME', panelId: 'H-5K', slides: [{ slot: 1, subjectIds: [onRun] }] }), /already on Xenium run XR26-0001/);
  assert.match(t.fails('POST', '/api/xenium/runs', { assay: 'PRIME', panelId: 'H-5K', slides: [] }), /at least one section/);
  assert.match(t.fails('POST', '/api/xenium/runs', { assay: 'PRIME', panelId: 'H-5K', slides: [{ slot: 1, subjectIds: [org3] }, { slot: 2, subjectIds: [org3] }] }), /only one slide/);
  assert.match(t.fails('POST', '/api/xenium/runs', { assay: 'PRIME', panelId: 'NOPE', slides: [{ slot: 1, subjectIds: [org3] }] }), /Choose a panel/);
  const okaSubject = t.state.subjects.find((s) => s.area === 'STAIN');
  assert.match(t.fails('POST', '/api/xenium/runs', { assay: 'V1', panelId: 'M-ATLAS', slides: [{ slot: 1, subjectIds: [okaSubject.id] }] }), /not in the Xenium work area/);
  const run = t.call('POST', '/api/xenium/runs', { assay: 'V1', panelId: 'H-MTC', assignedTo: 'jm', slides: [{ slot: 1, slideSerial: '', subjectIds: [org3] }] });
  assert.equal(run.number, 'XR26-0002');
  assert.deepEqual(t.call('GET', '/api/xenium').queue, []);
  const id = run.id;
  t.call('POST', `/api/xenium/runs/${id}/advance`, {});   // sectioned
  t.call('POST', `/api/xenium/runs/${id}/advance`, {});   // probes
  assert.match(t.fails('PATCH', `/api/xenium/runs/${id}`, { panelId: 'H-IO' }), /panel, custom genes and cell segmentation cannot change/);
  assert.match(t.fails('PATCH', `/api/xenium/runs/${id}`, { assay: 'PRIME' }), /cannot change/);
  assert.match(t.fails('POST', `/api/xenium/runs/${id}/advance`, {}), /slide serial number/);
  t.call('PATCH', `/api/xenium/runs/${id}`, { slideSerials: ['0023499'] });
  t.call('POST', `/api/xenium/runs/${id}/advance`, { note: 'loaded' });   // on the instrument
  t.call('POST', `/api/xenium/runs/${id}/back`);
  assert.equal(t.state.xenium.runs.find((r) => r.id === id).status, 'PROBES');
  for (let i = 0; i < 3; i++) t.call('POST', `/api/xenium/runs/${id}/advance`, {});   // loaded, run done, post-stain
  assert.match(t.fails('POST', `/api/xenium/runs/${id}/advance`, { date: '2099-01-01' }), /not in the future/);
  t.call('PATCH', `/api/xenium/runs/${id}`, { qc: { cells: 41250, transcriptsPerCell: 212, q20: 93.4 }, outputFolder: '\\\\server\\Xenium\\XR26-0002' });
  assert.match(t.fails('PATCH', `/api/xenium/runs/${id}`, { qc: { q20: 140 } }), /at most 100/);
  const done = t.call('POST', `/api/xenium/runs/${id}/advance`, {});
  assert.deepEqual([done.status, done.moved], ['DELIVERED', [t.state.subjects.find((s) => s.id === org3).phl]]);
  assert.equal(t.state.subjects.find((s) => s.id === org3).area, 'IMAGE', 'Xenium is followed by scanning on this request');
  assert.match(t.fails('POST', `/api/xenium/runs/${id}/advance`, {}), /data delivered/i);
  const d = t.call('GET', `/api/xenium/runs/${id}`);
  assert.deepEqual([d.steps.filter((s) => s.on).length, d.run.qc.cells, d.next], [7, 41250, null]);
  assert.ok(t.call('GET', `/api/requests/${d.slides[0].sections[0].requestId}`).xeniumRuns.some((r) => r.number === 'XR26-0002'));
});

test('a failed Xenium run returns its sections to the queue; panels are checked against the material', () => {
  const t = fresh();
  const run = t.state.xenium.runs[0];
  assert.match(t.fails('POST', `/api/xenium/runs/${run.id}/end`, { outcome: 'FAILED' }), /Say why/);
  t.call('POST', `/api/xenium/runs/${run.id}/end`, { outcome: 'FAILED', reason: 'Tissue detached during hybridization' });
  assert.equal(t.call('GET', '/api/xenium').queue.length, 3);
  assert.match(t.fails('POST', `/api/xenium/runs/${run.id}/advance`, {}), /failed/i);
  assert.deepEqual(XEN.panelWarnings({ assay: 'V1', panelId: 'M-BRAIN' }, ['HUMAN']), ['Mouse Brain is designed for mouse tissue; this run has human material.']);
  assert.match(XEN.panelWarnings({ assay: 'PROTEIN', panelId: 'H-5K' }, ['HUMAN']).join(' '), /not available with Xenium Prime 5K/);
  assert.match(XEN.panelWarnings({ assay: 'V1', panelId: 'H-IO' }, ['PDX']).join(' '), /detects the human cells \(tumor\) only/);
  assert.deepEqual(XEN.panelWarnings({ assay: 'V1', panelId: 'CUSTOM' }, ['RAT']), []);
});

// ---------- request tabs ----------
test('every request has a Necropsy tab summary: status, prosector, weights and findings for each MHL number', () => {
  const t = fresh();
  const bre = t.state.requests.find((r) => r.number === 'HP260101');
  const n = t.call('GET', `/api/requests/${bre.id}/necropsy`);
  assert.deepEqual([n.animals.length, n.approved, n.drafts, n.groups], [6, 0, 1, true]);
  assert.deepEqual([n.animals[0].status, n.animals[0].bodyWeight, n.animals[1].status], ['DRAFT', 26.4, null]);
  const oka = t.state.requests.find((r) => r.number === 'HP260097');
  const o = t.call('GET', `/api/requests/${oka.id}/necropsy`);
  assert.equal(o.approved, 12);
  assert.ok(o.animals.some((a) => a.findings > 0));
  const src = readFileSync(path.join(here, '..', 'web', 'views', 'request.js'), 'utf8');
  const order = [...src.match(/const TABS = \[([\s\S]*?)\];/)[1].matchAll(/'(\w+)', '([^']+)'/g)].map((m) => m[2]);
  assert.deepEqual(order, ['Overview', 'Labels', 'Estimate', 'Necropsy', 'Bloodwork', 'Pathology', 'Slide images', 'Charges', 'History']);
  const nav = readFileSync(path.join(here, '..', 'web', 'index.html'), 'utf8');
  assert.deepEqual([...nav.matchAll(/data-tab="\w+"[^>]*>([^<]+)</g)].map((m) => m[1]), ['Look up', 'Estimates', 'New request', 'Necropsy', 'Bloodwork', 'Pathology', 'Molecular', 'WSI', 'Billing']);
});

// ---------- study reports ----------
test('Fisher\'s exact test matches exact values', () => {
  const near = (a, b) => Math.abs(a - b) < 1e-6;
  assert.ok(near(fisherExact(1, 9, 11, 3), 0.002759));
  assert.ok(near(fisherExact(3, 1, 1, 3), 0.485714));
  assert.ok(near(fisherExact(8, 2, 1, 5), 0.034965));
  assert.ok(near(fisherExact(5, 1, 0, 6), 0.015152));
  assert.equal(fisherExact(3, 3, 3, 3), 1);
  assert.equal(fisherExact(0, 4, 0, 4), null, 'no affected animals in either group: no test');
});

test('the study necropsy report has groups, disposition, gross lesions by group, organ weights and every animal\'s bloodwork', () => {
  const t = fresh();
  const zap = t.state.studies.find((s) => s.zap === 'ZAP2215');
  const r = t.call('GET', `/api/studies/${zap.id}/report/necropsy`);
  assert.deepEqual(r.groups.map((g) => [g.code, g.n]), [['G1', 4], ['G2', 4], ['G3', 4]]);
  assert.deepEqual([r.reference, r.approved, r.animals.length], ['G1', 12, 12]);
  for (const row of r.incidence) {
    assert.equal(row.p[0], null);
    row.cells.slice(1).forEach((c, i) => assert.equal(row.p[i + 1], fisherExact(c.affected, c.examined - c.affected, row.cells[0].affected, row.cells[0].examined - row.cells[0].affected)));
  }
  assert.ok(r.animals.some((a) => a.findings.length && a.findings.every((f) => f.organ && f.text)));
  assert.ok(r.absolute.find((x) => x.label === 'Body weight').points.length === 12);
  const chem = r.bloodwork.tables.find((x) => x.kind === 'CHEMISTRY');
  const alb = chem.analytes.find((a) => a.code === 'ALB');
  assert.ok(alb.points.length >= 8 && alb.points.every((p) => ['G1', 'G2', 'G3'].includes(p.group) && Number.isFinite(p.value)));
  assert.deepEqual(alb.range, { low: 2.5, high: 4.8 });
  assert.equal(alb.groups.find((g) => g.code === 'G1').n, alb.points.filter((p) => p.group === 'G1').length);
});

test('the study pathology report has incidence, neoplasms by organ, and each animal\'s findings by group; its summary is saved', () => {
  const t = fresh();
  const zap = t.state.studies.find((s) => s.zap === 'ZAP2215');
  const r = t.call('GET', `/api/studies/${zap.id}/report/pathology`);
  assert.deepEqual([r.signed, r.animals.length, r.keys], [6, 12, ['G1', 'G2', 'G3']]);
  const ad = r.neoplasms.find((x) => x.term === 'Adenoma, bronchiolo-alveolar');
  assert.deepEqual([ad.kind, ad.cells.map((c) => c.affected)], ['Benign', [2, 2, 1]]);
  assert.ok(r.neoplasms.some((x) => x.kind === 'Malignant'));
  const signed = r.animals.filter((a) => a.status === 'SIGNED');
  assert.ok(signed.every((a) => a.signedBy && (a.findings.length || a.nsl.length)));
  assert.ok(r.animals.filter((a) => a.status !== 'SIGNED').every((a) => !a.findings.length));
  assert.ok(r.incidence.every((row) => row.cells.length === 3 && row.p[0] === null));
  t.call('PUT', `/api/studies/${zap.id}/report-notes`, { kind: 'pathology', text: 'Bronchiolo-alveolar proliferative lesions in all groups.' });
  assert.equal(t.call('GET', `/api/studies/${zap.id}/report/pathology`).notes.pathology, 'Bronchiolo-alveolar proliferative lesions in all groups.');
  assert.equal(t.call('GET', `/api/studies/${zap.id}/report/necropsy`).notes.necropsy, '');
});

// ---------- upgrade and bundle ----------
test('saved data from version 6 upgrades: NAS requests open, Xenium runs, study report notes', () => {
  const old = structuredClone(seeded);
  delete old.xenium; old.version = 6;
  for (const n of old.nas) { delete n.closed; delete n.closedBy; delete n.closedOn; }
  for (const s of old.studies) delete s.reportNotes;
  for (const w of old.ihcRequests) { delete w.workStatus; delete w.assignedTo; }
  createCore({ state: old, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  assert.equal(old.version, 8);
  assert.deepEqual(old.xenium, { runs: [] });
  // A NAS request whose requests are all complete has served its purpose and is closed; the rest stay open.
  const done = (n) => { const reqs = old.requests.filter((r) => r.nasId === n.id); return reqs.length > 0 && reqs.every((r) => r.status === 'Complete'); };
  assert.ok(old.nas.every((n) => n.closed === done(n)));
  assert.deepEqual(old.nas.filter((n) => n.closed).map((n) => n.requester.last), ['Nakamura']);
  assert.ok(old.studies.every((s) => s.reportNotes.necropsy === ''));
  assert.equal(upgradeToV7(old), false);
});

test('the standalone bundle has the Molecular, Xenium, chart and study report views, and the old IHC addresses still route', () => {
  const src = bundleModules();
  for (const m of ['xenium', 'xeniumviews', 'charts', 'studyreports']) assert.ok(src.includes(`__define('${m}'`), m);
  const require = new Function(`${LOADER}\n${src}\nreturn __require;`)();
  assert.equal(require('xenium').STEPS.length, 7);
  const app = readFileSync(path.join(here, '..', 'web', 'app.js'), 'utf8');
  assert.match(app, /parts\[0\] === 'molecular' \|\| parts\[0\] === 'ihc'/);
  assert.match(app, /parts\[0\] === 'new' && parts\[1\] === 'ihc'/);
});

// ---------- regressions found in review ----------
test('what is left of a NAS request counts charges beyond a request\'s estimate, and the wizard can fetch the NAS request afresh', () => {
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const a = t.call('POST', '/api/requests', histo(nas.id, 10));   // estimate $154.70
  t.call('POST', `/api/requests/${a.id}/charges`, { section: 'TRIM_EMBED', code: 'HP003003', units: 300, date: TODAY });   // $4,641.00
  const one = t.call('GET', `/api/nas/${nas.id}`).nas;
  assert.deepEqual([one.usage.estimated, one.usage.charged, one.usage.committed, one.usage.remaining], [154.7, 4641, 4641, 359]);
  assert.equal(one.usage.remaining, t.call('GET', `/api/requests/${a.id}`).financials.remaining);
  assert.equal(t.core.handle('GET', '/api/nas/999999', {}, null).status, 404);
});

test('a delivered Xenium run lets its sections go round again; slide slots and serials are checked', () => {
  const t = fresh();
  const run = t.state.xenium.runs[0];
  t.call('PATCH', `/api/xenium/runs/${run.id}`, { slideSerials: ['0023481', '0023482'] });
  for (let i = 0; i < 4; i++) t.call('POST', `/api/xenium/runs/${run.id}/advance`, {});   // loaded, run done, post-stain, delivered
  assert.match(t.fails('PATCH', `/api/xenium/runs/${run.id}`, { slideSerials: ['', ''] }), /serial numbers cannot change/);
  const s = t.state.subjects.find((x) => x.id === run.slides[0].sections[0].subjectId);
  t.call('POST', `/api/requests/${s.requestId}/move`, { to: 'SPATL', subjectIds: [s.id] });
  assert.ok(t.call('GET', '/api/xenium').queue.some((q) => q.subjectId === s.id));
  const again = t.call('POST', '/api/xenium/runs', { assay: 'V1', panelId: 'H-COLON', slides: [{ slot: 1, subjectIds: [s.id] }] });
  assert.ok(again.number);
  const q = t.call('GET', '/api/xenium').queue;
  assert.equal(q.length, 1, 'ORG-3 still waits');
  const other = run.slides[1].sections[0].subjectId;
  t.call('POST', `/api/requests/${s.requestId}/move`, { to: 'SPATL', subjectIds: [other] });
  assert.match(t.fails('POST', '/api/xenium/runs', { assay: 'V1', panelId: 'H-COLON', slides: [{ slot: 1, subjectIds: [q[0].subjectId] }, { slot: 1, subjectIds: [other] }] }), /its own slot/);
  assert.deepEqual(XEN.slidesProblems([{ slot: 1, subjectIds: [1] }, { slot: 2, subjectIds: [2] }]), []);
});

test('incidence counts animals: an organ in two blocks of one case is one animal examined and affected', async () => {
  const PATH = await import('../core/pathology.mjs');
  const lung = (block, dx) => ({ organ: 'Lungs', block, result: dx ? 'LESIONS' : 'NSL', diagnoses: dx ? [{ term: dx, neoplasm: true, behavior: 'Benign', origin: 'Primary' }] : [] });
  const cases = [
    { subject: { id: 1, phl: 'A', label: '1' }, groupKey: 'G1', c: { tissues: [lung('1', 'Adenoma, bronchiolo-alveolar'), lung('2', 'Adenoma, bronchiolo-alveolar')] } },
    { subject: { id: 2, phl: 'B', label: '2' }, groupKey: 'G1', c: { tissues: [lung('1', 'Adenoma, bronchiolo-alveolar')] } },
    { subject: { id: 3, phl: 'C', label: '3' }, groupKey: 'G1', c: { tissues: [lung('1', null)] } },
  ];
  const r = PATH.summarizePathology(cases, ['G1']);
  assert.deepEqual([r.examined.Lungs.G1, r.incidence[0].byGroup.G1.affected], [3, 2]);
});

test('IHC ordered with a new request is priced as ordered (extra sections from the request\'s blocks) on the Molecular pages', () => {
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const cd8 = t.state.assays.find((a) => a.name === 'CD8' && a.kind === 'IHC' && a.status === 'Active');
  const ihc = { tissue: 'Tumor', sampleType: 'BLOCK', addOn: true, he: { on: false, perBlock: 1 }, unstained: { on: false, perBlock: 1 }, scan: { x20: false, x40: false }, stains: [{ assayId: cd8.id, chromogen: 'DAB' }] };
  const est = t.call('POST', '/api/requests/ihc-estimate', { n: 2, species: 'MOUSE', fixative: '10%NBF', ihc });
  const res = t.call('POST', '/api/requests', { ...histo(nas.id), type: 'NECRO-FULL', ihc });
  const w = t.state.ihcRequests.find((x) => x.requestId === res.id);
  assert.equal(t.call('GET', `/api/ihc/requests/${w.id}`).estimate.total, est.estimate.total);
  assert.equal(t.call('GET', '/api/ihc/requests').requests.find((x) => x.id === w.id).estimate, est.estimate.total);
  assert.ok(t.call('GET', `/api/ihc/requests/${w.id}`).estimate.lines.some((l) => l.code === 'HP004002'));
});

