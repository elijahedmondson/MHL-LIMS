// Tests for the pathology module: dictionary and formatting rules, cases from necropsy and from submitted slides,
// sign-out with charges, amendments, reports and study summaries.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as PATH from '../core/pathology.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const seedDir = path.join(here, '..', '..', 'src', 'SeedData');
const priceList = JSON.parse(readFileSync(path.join(seedDir, 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(seedDir, 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-04';

function setup() {
  const state = seedState({ priceList, ihcCatalog, today: TODAY });
  const clock = { day: TODAY, today: () => clock.day, now: () => `${clock.day}T10:00:00` };
  const core = createCore({ state, priceList, ihcCatalog, clock });
  state.settings.initials = 'KM';
  const call = (method, p, body = null, query = {}) => core.handle(method, p, query, body);
  const ok = (method, p, body, query) => { const r = call(method, p, body, query); assert.equal(r.status, 200, `${method} ${p}: ${r.json?.error}`); return r.json ?? r.file; };
  const err = (method, p, body, query) => { const r = call(method, p, body, query); assert.notEqual(r.status, 200, `${method} ${p} should fail`); return r.json.error; };
  const subjectsOf = (last) => { const r = state.requests.find((x) => x.pi.last === last && x.type !== 'MOLEC'); return state.subjects.filter((s) => s.requestId === r.id).sort((a, b) => a.phl.localeCompare(b.phl)); };
  return { state, ok, err, subjectsOf };
}

test('diagnoses read the way a pathologist writes them', () => {
  assert.equal(PATH.dxText({ term: 'Vacuolation, hepatocellular', modifier: 'centrilobular', distribution: 'Diffuse', severity: '2' }), 'Vacuolation, hepatocellular, centrilobular, diffuse, mild (2)');
  assert.equal(PATH.dxText({ term: 'Adenoma, bronchiolo-alveolar', neoplasm: true, behavior: 'Benign', laterality: 'Left' }), 'Adenoma, bronchiolo-alveolar, left [benign]');
  assert.equal(PATH.dxText({ term: 'Neoplasm, metastatic', neoplasm: true, behavior: 'Malignant', origin: 'Metastatic' }), 'Neoplasm, metastatic [malignant, metastatic]');
  assert.equal(PATH.dxText({ term: 'Cyst', severity: 'P' }), 'Cyst, present');
  assert.equal(PATH.dxMark({ neoplasm: true, behavior: 'Malignant', origin: 'Metastatic' }), 'Mm');
  assert.equal(PATH.findDiagnosis('adenoma, hepatocellular').neoplasm, true);
  assert.equal(PATH.diagnosesFor('Liver')[0].organs.includes('Liver'), true, 'organ-specific terms come first');
});

test('slides are counted per block, and sign-out checks are specific', () => {
  const c = { tissues: [
    { organ: 'Lungs', block: '2', result: 'LESIONS', diagnoses: [{ id: 'a', term: 'Hyperplasia, bronchiolo-alveolar', severity: '' }] },
    { organ: 'Heart', block: '2', result: 'NSL', diagnoses: [] },
    { organ: 'Liver', block: '3', result: 'PENDING', diagnoses: [] },
    { organ: 'Tumor', block: null, result: 'LESIONS', diagnoses: [{ id: 'b', term: 'Carcinoma', neoplasm: true, behavior: '' }] },
  ], grossNoCorrelate: {}, causeOfDeath: { kind: '' } };
  assert.equal(PATH.slidesRead(c), 2, 'lungs and heart share block 2; the tumor has no block');
  const p = PATH.signOutProblems(c, { grossFindings: [{ id: 7, organ: 'Liver' }], needCauseOfDeath: true });
  assert.ok(p.some((x) => /result for Liver/.test(x)));
  assert.ok(p.some((x) => /grade Hyperplasia/.test(x)));
  assert.ok(p.some((x) => /benign or malignant/.test(x)));
  assert.ok(p.some((x) => /correlate the gross finding \(Liver\)/.test(x)));
  assert.ok(p.some((x) => /cause of death/.test(x)));
});

test('seed: worklist, waiting cases, signed reports and their charges', () => {
  const { ok, state, subjectsOf } = setup();
  const wl = ok('GET', '/api/pathology/worklist');
  const oka = wl.requests.find((r) => r.zap === 'ZAP2215');
  assert.equal(oka.signed, 6);
  assert.ok(wl.requests.find((r) => r.zap === 'ZAP2231').subjects.every((s) => s.status === 'WAITING'), 'Brennan animals wait for necropsy approval');
  assert.equal(wl.recuts.length, 1);
  assert.equal(ok('GET', '/api/pathology/worklist', null, { mine: '1' }).requests.every((r) => r.subjects.every((s) => s.assigned === 'KM')), true);
  const s0 = subjectsOf('Okafor')[0];
  const c = ok('GET', `/api/pathology/${s0.id}`);
  assert.equal(c.case.status, 'SIGNED');
  assert.equal(c.slides, 3);
  assert.deepEqual(c.charges.map((x) => `${x.code}x${x.units}`), ['PA001002x3']);
  assert.equal(state.subjects.find((s) => s.id === s0.id).area, 'QC-PA');
});

test('a necropsy case from start to sign-out, then an amendment', () => {
  const { ok, err, state, subjectsOf } = setup();
  const s = subjectsOf('Okafor')[6];
  let d = ok('GET', `/api/pathology/${s.id}`);
  assert.equal(d.saved, false);
  assert.ok(d.case.tissues.length > 10 && d.case.tissues.every((t) => t.result === 'PENDING' && t.fromNecropsy));
  assert.match(err('POST', `/api/pathology/${s.id}/signout`, d.case), /give a result for Brain/);
  const lungGross = d.grossFindings.find((g) => g.organ === 'Lungs');
  const tissues = d.case.tissues.map((t) => (t.organ === 'Lungs'
    ? { ...t, diagnoses: [{ term: 'Adenoma, bronchiolo-alveolar', distribution: 'Multifocal', correlates: [lungGross.id] }, { term: 'Hyperplasia, bronchiolo-alveolar', distribution: 'Focal' }] }
    : { ...t, result: ['Liver', 'Spleen'].includes(t.organ) ? 'NSL' : 'NOT_EXAMINED' }));
  d = ok('PUT', `/api/pathology/${s.id}`, { ...d.case, tissues });
  assert.equal(d.saved, true);
  assert.equal(d.case.tissues.find((t) => t.organ === 'Lungs').result, 'LESIONS', 'a tissue with diagnoses is a lesion');
  assert.ok(d.problems.some((p) => /benign or malignant/.test(p)) && d.problems.some((p) => /grade Hyperplasia/.test(p)));
  const fixed = d.case.tissues.map((t) => (t.organ === 'Lungs' ? { ...t, diagnoses: [{ ...t.diagnoses[0], behavior: 'Benign' }, { ...t.diagnoses[1], severity: '1' }] } : t));
  const otherGross = d.grossFindings.filter((g) => g.id !== lungGross.id);
  d = ok('POST', `/api/pathology/${s.id}/signout`, { ...d.case, tissues: fixed, grossNoCorrelate: Object.fromEntries(otherGross.map((g) => [g.id, true])) });
  assert.equal(d.case.status, 'SIGNED');
  assert.equal(d.slides, 3, 'lungs (block 2), liver (3), spleen (4)');
  assert.deepEqual(d.charges.map((x) => `${x.code}x${x.units}:${x.status}`), ['PA001002x3:PENDING']);
  assert.equal(state.subjects.find((x) => x.id === s.id).area, 'QC-PA');
  assert.match(err('PUT', `/api/pathology/${s.id}`, d.case), /Amend it/);

  // Release the charge, amend, read one more block: only the extra slide is charged.
  const chargeId = d.charges[0].id;
  ok('POST', `/api/charges/${chargeId}/approve`, {});
  ok('POST', '/api/billing/batches', { lab: 'PA', start: '2026-10-01', end: TODAY });
  assert.match(err('POST', `/api/pathology/${s.id}/amend`, {}), /reason/);
  d = ok('POST', `/api/pathology/${s.id}/amend`, { reason: 'Adrenal section added' });
  assert.equal(d.case.status, 'DRAFT');
  assert.equal(d.case.version, 2);
  assert.equal(state.subjects.find((x) => x.id === s.id).area, 'PATHO');
  const more = d.case.tissues.map((t) => (t.organ === 'Adrenal glands' ? { ...t, result: 'NSL' } : t));   // block 5; kidneys share block 4 with the spleen
  d = ok('POST', `/api/pathology/${s.id}/signout`, { ...d.case, tissues: more });
  assert.equal(d.slides, 4);
  assert.deepEqual(d.charges.map((x) => `${x.code}x${x.units}:${x.status}`).sort(), ['PA001002x1:PENDING', 'PA001002x3:RELEASED']);
  const rep = ok('GET', `/api/reports/${s.id}`);
  assert.equal(rep.pathology.version, 2);
  assert.equal(rep.pathology.amendments[0].reason, 'Adrenal section added');
  assert.equal(rep.pathology.previous.length, 1);
  assert.ok(rep.pathology.correlation.some((r) => /Adenoma/.test(r.micro)));
  assert.ok(rep.necropsy.organs.some((o) => o.relative > 0));
});

test('submitted slides without necropsy: tissues added by the pathologist, extra time charged', () => {
  const { ok, err, subjectsOf } = setup();
  const s = subjectsOf('Haddad')[4];
  let d = ok('GET', `/api/pathology/${s.id}`);
  assert.equal(d.case.tissues.length, 0);
  assert.equal(d.waiting, null);
  const tissues = [{ organ: 'Liver', block: 'A', result: 'NSL', diagnoses: [] }, { organ: 'Tumor', block: 'B', diagnoses: [{ term: 'Sarcoma', behavior: 'Malignant' }] }];
  assert.match(err('POST', `/api/pathology/${s.id}/signout`, { tissues, extraQuarterHours: 2 }), /describe the additional pathologist time/);
  d = ok('POST', `/api/pathology/${s.id}/signout`, { tissues, extraQuarterHours: 2, extraTimeNote: 'Review of outside slides', comment: 'Soft tissue sarcoma.' });
  assert.deepEqual(d.charges.map((x) => `${x.code}x${x.units}`).sort(), ['PA001002x2', 'PA001004x2']);
  assert.equal(d.case.tissues[1].diagnoses[0].neoplasm, true, 'neoplasm comes from the dictionary');
});

test('pathology can be added to any request; necropsy cannot be unapproved under a signed report', () => {
  const { ok, err, state } = setup();
  const molec = state.requests.find((r) => r.type === 'MOLEC' && !r.areas.includes('PATHO'));
  const s = state.subjects.find((x) => x.requestId === molec.id);
  assert.match(ok('GET', `/api/pathology/${s.id}`).waiting, /does not include pathology/);
  ok('POST', `/api/requests/${molec.id}/add-pathology`, {});
  assert.ok(state.requests.find((r) => r.id === molec.id).areas.includes('PATHO'));
  assert.match(err('POST', `/api/requests/${molec.id}/add-pathology`, {}), /already includes/);
  assert.equal(ok('GET', `/api/pathology/${s.id}`).waiting, null);

  const bre = state.requests.find((r) => r.pi.last === 'Brennan');
  const b = state.subjects.filter((x) => x.requestId === bre.id).sort((x, y) => x.phl.localeCompare(y.phl))[5];
  const n = ok('GET', `/api/necropsy/${b.id}`).necropsy;
  ok('POST', `/api/necropsy/${b.id}/approve`, { ...n, bodyWeight: 25, matchesCageCard: true, organs: n.organs.map((o) => (o.weigh ? { ...o, weight: 0.2 } : o)) });
  const c = ok('GET', `/api/pathology/${b.id}`).case;
  ok('POST', `/api/pathology/${b.id}/signout`, { ...c, tissues: c.tissues.map((t) => ({ ...t, result: 'NSL' })) });
  assert.match(err('POST', `/api/necropsy/${b.id}/unapprove`, { reason: 'test' }), /Amend the pathology report first/);
});

test('assigning cases, and the study and request summaries', () => {
  const { ok, err, state, subjectsOf } = setup();
  const oka = subjectsOf('Okafor');
  assert.match(err('POST', '/api/pathology/assign', { subjectIds: [oka[9].id], pathologist: 'x' }), /two to four letters/);
  ok('POST', '/api/pathology/assign', { subjectIds: [oka[9].id], pathologist: 'na' });
  assert.equal(state.pathAssign[oka[9].id], 'NA');
  const study = state.studies.find((s) => s.zap === 'ZAP2215');
  const sum = ok('GET', `/api/studies/${study.id}/pathology`);
  assert.deepEqual(sum.groupKeys, ['G1', 'G2', 'G3']);
  const hyp = sum.incidence.find((r) => r.term === 'Hyperplasia, bronchiolo-alveolar');
  assert.deepEqual(hyp.byGroup.G1, { affected: 3, examined: 3, meanGrade: 2.7 });
  assert.equal(sum.neoplasms.G1.malignant, 2);
  assert.ok(sum.tabulated.every((row) => Object.values(row.status).some((m) => m === '-' || m === '+')));
  assert.ok(sum.notRead.includes('Brain'));
  const csv = ok('GET', `/api/studies/${study.id}/pathology.csv`);
  assert.match(csv.content, /^MHL,Animal,Group,Sex,Report status/);
  const had = state.requests.find((r) => r.pi.last === 'Haddad');
  const rs = ok('GET', `/api/requests/${had.id}/pathology`);
  assert.deepEqual(rs.groupKeys, ['All']);
  assert.equal(rs.cases.filter((x) => x.status === 'SIGNED').length, 2);
});
