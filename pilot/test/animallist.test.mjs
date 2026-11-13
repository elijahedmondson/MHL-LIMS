// Tests for animal lists: an investigator's spreadsheet, one line per animal, filling in a new request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as A from '../core/animallist.mjs';
import { writeXlsx } from '../core/xlsxwrite.mjs';
import { readSheets } from '../core/sheets.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const samples = path.join(here, '..', 'samples', 'animal-lists');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-10';
const seeded = seedState({ priceList, ihcCatalog, today: TODAY });
const canInflate = (() => { try { new DecompressionStream('deflate-raw'); return true; } catch { return false; } })();

function fresh() {
  const state = structuredClone(seeded);
  state.settings.initials = 'TT';
  const core = createCore({ state, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  const call = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`); return r.file || r.json; };
  const fails = (method, p, body = null) => { const r = core.handle(method, p, {}, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { state, core, call, fails };
}

// ---------- reading the spreadsheet ----------
test('headings are recognized however the investigator words them, and the header row can be anywhere near the top', () => {
  const m = (h) => A.matchHeader(h);
  assert.deepEqual(['Animal ID*', 'Mouse #', 'Ear Tag #', 'ID', 'Treatment Group', 'Gender', 'Sex (M/F)', 'DOB', 'Date of Birth (yyyy-mm-dd)', 'Cage #', 'Comments', 'Weight (g)', 'Animal weight'].map(m),
    ['label', 'label', 'label', 'label', 'groupCode', 'sex', 'sex', 'dob', 'dob', 'cage', 'notes', null, null]);
  const grid = [['Abernathy lab, necropsy submission'], ['NAS 26-0471', 'Investigator'], [], ['Mouse #', 'Group', 'Gender', 'Weight (g)'], ['4101', 'G1', 'Female', '21.5']];
  const h = A.findHeader(grid);
  assert.deepEqual([h.row, h.map, h.unknown], [3, { label: 0, groupCode: 1, sex: 2 }, ['Weight (g)']]);
  assert.equal(A.findHeader([['Group', 'Sex'], ['G1', 'F']]), null, 'no animal ID column, no header');
  const pick = A.pickSheet([{ name: 'Dosing log', grid: [['Date', 'Note']] }, { name: 'Animals', grid }]);
  assert.equal(pick.sheet.name, 'Animals');
});

test('dates, sex and priority are read as people type them', () => {
  const d = (v) => A.parseDate(v, TODAY);
  assert.equal(d('46209').value, '2026-07-06', 'an Excel day number');
  assert.equal(d('2026-07-06').value, '2026-07-06');
  assert.equal(d('7/6/2026').value, '2026-07-06', 'month first, as in the US');
  assert.equal(d('16/7/2026').value, '2026-07-16', 'day first when the first number is over 12');
  assert.equal(d('6-Jul-2026').value, '2026-07-06');
  assert.equal(d('Jul 6, 2026').value, '2026-07-06');
  assert.equal(d('7/6/26').value, '2026-07-06');
  assert.equal(d('7/6/98').value, '1998-07-06');
  assert.match(d('13/45/2026').error, /not a date/);
  assert.match(d('2026-02-30').error, /not a date/);
  assert.deepEqual(['F', 'female', 'Male', 'm', 'U', 'unknown', ''].map((v) => A.parseSex(v).value), ['F', 'F', 'M', 'M', 'U', 'U', '']);
  assert.match(A.parseSex('X').error, /F, M or U/);
  assert.deepEqual(['STAT', 'yes', 'Routine', '', 'Priority'].map((v) => A.parsePriority(v).value), ['S', 'S', '', '', 'P']);
  assert.match(A.parsePriority('maybe').warning, /treated as routine/);
});

test('the list is checked: IDs needed and different, values readable, and what will happen is said', () => {
  const grid = [['Animal ID', 'Group', 'Sex', 'Treatment', 'Date of birth', 'Weight'],
    ['1', 'g1', 'F', 'Vehicle', '2026-05-01', '20'], ['2', 'G1', 'F', 'Vehicle (corn oil)', '', ''], ['3', 'G9', 'M', 'Drug', '2026-05-01', ''],
    ['3', 'G9', 'Q', 'Drug', '2030-01-01', ''], ['', 'G9', 'M', '', '', ''], ['', '', '', '', '', '']];
  const r = A.parseAnimalList(grid, { groups: ['G1', 'G2'], expected: 4, today: TODAY, necropsy: true });
  assert.deepEqual(r.problems, ['Line 5: Sex “Q” should be F, M or U.', 'Line 5: The date of birth 2030-01-01 is in the future.', 'Line 5: Animal ID 3 is also on line 4.', 'Line 6: There is no animal ID.']);
  assert.equal(r.animals[0].groupCode, 'G1', 'the study\'s spelling of a group code');
  assert.ok(r.warnings.includes('Group G9 is not in the study yet and will be added to it.'));
  assert.ok(r.warnings.includes('The NAS request is for 4 MHL numbers; the list has 5 animals, so the request will have 5.'));
  assert.ok(r.warnings.some((w) => /Group G1 lists 2 treatments/.test(w)));
  assert.ok(r.warnings.includes('Not read: the column “Weight”.'));
  assert.equal(r.animals.length, 5);
  // Human samples: no dates of birth.
  const h = A.parseAnimalList([['Case ID', 'Date of birth'], ['C-001', '1961-04-02']], { phi: true, today: TODAY });
  assert.deepEqual([h.problems, h.animals[0].dob], [[], '']);
  assert.ok(h.warnings.some((w) => /not kept for human samples/.test(w)));
});

test('a customer\'s own workbook is read from the right tab, and the sample with mistakes shows each one', { skip: !canInflate && 'this Node cannot inflate .xlsx files' }, async () => {
  const { sheets } = await readSheets(readFileSync(path.join(samples, 'Abernathy-animal-list.xlsx')), 'Abernathy-animal-list.xlsx');
  assert.deepEqual(sheets.map((s) => s.name), ['Necropsy submission', 'Dosing log']);
  const pick = A.pickSheet(sheets);
  const r = A.parseAnimalList(pick.sheet.grid, { header: pick.header, expected: 16, today: TODAY, necropsy: true });
  assert.deepEqual([r.header.row, r.animals.length, r.problems, r.summary.female, r.summary.groups.map((g) => g.n)], [4, 16, [], 16, [4, 4, 4, 4]]);
  assert.deepEqual([r.animals[0].label, r.animals[0].dob, r.animals[0].cage, r.animals[0].treatment], ['4101', '2026-07-06', 'C-210', 'Vehicle, daily IP']);
  const bad = await readSheets(readFileSync(path.join(samples, 'animal-list-with-problems.csv')), 'animal-list-with-problems.csv');
  const rb = A.parseAnimalList(bad.sheets[0].grid, { today: TODAY });
  assert.equal(rb.problems.length, 5);
});

// ---------- the template ----------
test('the template is a real workbook: request details on top, the headings, drop-downs, and it reads back', async () => {
  const sheetsIn = A.templateSheets({ investigator: 'Abernathy, Grace', nasNumber: '26-0471', study: 'ZAP2215', speciesName: 'Mouse', expected: 16, groups: ['G1', 'G2'] });
  const bytes = writeXlsx(sheetsIn);
  assert.deepEqual([...bytes.slice(0, 4)], [0x50, 0x4B, 0x03, 0x04]);
  assert.deepEqual(writeXlsx(sheetsIn), bytes, 'the same input gives the same file');
  const { format, sheets } = await readSheets(bytes, 'template.xlsx');
  assert.deepEqual([format, sheets.map((s) => s.name)], ['xlsx', ['Animals', 'Instructions']]);
  const pick = A.pickSheet(sheets);
  assert.deepEqual([pick.sheet.name, pick.header.row, Object.keys(pick.header.map).length], ['Animals', 6, 11]);
  assert.equal(sheets[0].grid[1][1], 'Abernathy, Grace');
  const xml = new TextDecoder().decode(bytes);
  assert.match(xml, /<dataValidation type="list"[^>]*sqref="C8:C/);
  assert.match(xml, /<formula1>"G1,G2"<\/formula1>/);
  assert.match(xml, /<pane ySplit="7"/);
  // Human material: no date of birth column, and a warning about identifiers.
  const human = A.templateSheets({ phi: true, expected: 4 });
  assert.ok(!human[0].rows[6].some((c) => c.v === 'Date of birth'));
  assert.match(human[0].rows[4][0].v, /coded IDs only/);
});

// ---------- creating the request ----------
const animalsFor = (n, extra = (i) => ({})) => Array.from({ length: n }, (_, i) => ({ label: `M${100 + i}`, groupCode: i < n / 2 ? 'Ctl' : 'Tx', sex: i % 2 ? 'M' : 'F',
  strain: 'C57BL/6J', genotype: 'Kras', dob: '2026-06-01', age: '', cage: `C${i}`, treatment: i < n / 2 ? 'Vehicle' : 'Drug 10 mg/kg', priority: '', notes: '', ...extra(i) }));

test('a request made from an animal list has one MHL number per animal, with its details, and the study gets the groups', () => {
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const animals = animalsFor(4, (i) => (i === 1 ? { priority: 'S', notes: 'Moribund' } : i === 3 ? { treatment: 'Drug 30 mg/kg' } : {}));
  const res = t.call('POST', '/api/requests', { nasId: nas.id, type: 'NECRO-FULL', n: 4, species: 'MOUSE', study: { mode: 'new', title: 'List study' },
    lines: [{ section: 'NECRO', code: 'HP002001', units: 4 }], animals, animalFile: 'list.xlsx' });
  const req = t.state.requests.find((r) => r.id === res.id);
  const subs = t.state.subjects.filter((s) => s.requestId === req.id).sort((a, b) => a.phl.localeCompare(b.phl));
  assert.deepEqual(subs.map((s) => [s.label, s.groupCode, s.sex, s.strain, s.dob, s.cage, s.priority]),
    [['M100', 'Ctl', 'F', 'C57BL/6J', '2026-06-01', 'C0', 'R'], ['M101', 'Ctl', 'M', 'C57BL/6J', '2026-06-01', 'C1', 'S'], ['M102', 'Tx', 'F', 'C57BL/6J', '2026-06-01', 'C2', 'R'], ['M103', 'Tx', 'M', 'C57BL/6J', '2026-06-01', 'C3', 'R']]);
  assert.equal(subs[1].notes, 'Moribund');
  assert.equal(subs[3].notes, 'Treatment: Drug 30 mg/kg', 'a treatment different from its group\'s is kept in the notes');
  const study = t.state.studies.find((s) => s.id === req.studyId);
  assert.deepEqual(study.groups.map((g) => [g.code, g.treatment, g.sex]), [['Ctl', 'Vehicle', ''], ['Tx', 'Drug 10 mg/kg', '']]);
  assert.deepEqual([req.animalList.fileName, req.animalList.animals], ['list.xlsx', 4]);
  assert.match(t.state.audit.find((a) => a.action === 'REQUEST_CREATED' && a.entityId === req.id).detail, /from the animal list list\.xlsx/);
  // The necropsy organ list follows each animal's sex.
  const organs = (id) => t.call('GET', `/api/necropsy/${id}`).necropsy.organs.map((o) => o.organ).join(' ');
  assert.equal(t.call('GET', `/api/necropsy/${subs[1].id}`).subject.sex, 'M');
  assert.ok(organs(subs[0].id).length > 0);
  // The request page and report carry the details.
  assert.equal(t.call('GET', `/api/requests/${req.id}`).subjects[0].strain, 'C57BL/6J');
  assert.equal(t.call('GET', `/api/reports/${subs[0].id}`).subject.genotype, 'Kras');
});

test('an existing study only gains the groups it lacks; codes follow its spelling', () => {
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const study = t.state.studies.find((s) => s.zap === 'ZAP2215');
  const before = study.groups.map((g) => g.code);
  t.call('POST', '/api/requests', { nasId: nas.id, type: 'HISTO', n: 2, species: 'MOUSE', study: { mode: 'existing', studyId: study.id },
    lines: [{ section: 'TRIM_EMBED', code: 'HP003003', units: 2 }], animals: animalsFor(2, (i) => ({ groupCode: i ? 'g1' : 'G7' })) });
  assert.deepEqual(study.groups.map((g) => g.code), [...before, 'G7']);
  assert.ok(t.state.subjects.some((s) => s.label === 'M101' && s.groupCode === 'G1'));
});

test('the core checks the animals again: count, IDs, values; human samples keep no date of birth', () => {
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const body = (animals, extra = {}) => ({ nasId: nas.id, type: 'HISTO', n: animals.length, species: 'MOUSE', study: { mode: 'none' }, lines: [{ section: 'TRIM_EMBED', code: 'HP003003', units: 2 }], animals, ...extra });
  assert.match(t.fails('POST', '/api/requests', body(animalsFor(2), { n: 3 })), /3 MHL numbers but the animal list has 2/);
  assert.match(t.fails('POST', '/api/requests', body([...animalsFor(2), { label: 'm100' }])), /M100|m100.*twice/);
  assert.match(t.fails('POST', '/api/requests', body(animalsFor(2, () => ({ sex: 'X' })))), /Sex “X”/);
  assert.match(t.fails('POST', '/api/requests', body(animalsFor(1, () => ({ label: '' })))), /no animal ID/);
  assert.match(t.fails('POST', '/api/requests', body(animalsFor(1, () => ({ dob: '2031-01-01' })))), /in the future/);
  assert.match(t.fails('POST', '/api/requests', body([])), /empty/);
  assert.match(t.fails('POST', '/api/requests', body([null])), /no animal ID/);
  assert.equal(nas.requestId, t.state.nas.find((n) => n.id === nas.id).requestId, 'nothing was created');
  const res = t.call('POST', '/api/requests', body(animalsFor(2, (i) => ({ label: `CASE-${i}` })), { species: 'HUMAN' }));
  const subs = t.state.subjects.filter((s) => s.requestId === res.id);
  assert.deepEqual(subs.map((s) => [s.label, s.dob, s.restricted]), [['CASE-0', null, true], ['CASE-1', null, true]]);
  // Without a list, nothing changes.
  const plain = t.call('POST', '/api/requests', { ...body(animalsFor(1)), animals: undefined, n: 2 });
  assert.equal(t.state.requests.find((r) => r.id === plain.id).animalList, undefined);
});

test('the standalone bundle has the animal list and template modules', () => {
  const src = bundleModules();
  for (const m of ['animallist', 'xlsxwrite']) assert.ok(src.includes(`__define('${m}'`), m);
  const require = new Function(`${LOADER}\n${src}\nreturn __require;`)();
  assert.equal(require('animallist').matchHeader('Mouse #'), 'label');
  assert.ok(require('xlsxwrite').writeXlsx([{ name: 'x', rows: [['a']] }]).length > 500);
});

// ---------- regressions found in review ----------
test('the list ends at an empty line or a totals line; what is below is said, not read', () => {
  const grid = [['Animal ID', 'Group', 'Sex'], ['1', 'G1', 'F'], ['2', 'G1', 'F'], [], ['Total', '', '2'], ['Submitted by: J. Smith'], ['Group', 'Treatment'], ['G1', 'Vehicle']];
  const r = A.parseAnimalList(grid, { today: TODAY });
  assert.deepEqual([r.animals.map((a) => a.label), r.problems], [['1', '2'], []]);
  assert.match(r.warnings.join(' '), /Lines 5 to 8, below an empty line, were not read/);
  const t = A.parseAnimalList([['Animal ID', 'Sex'], ['1', 'F'], ['Total: 1', '']], { today: TODAY });
  assert.deepEqual(t.animals.map((a) => a.label), ['1']);
});

test('hidden sheets are passed over, and headings are ranked: the ID column, the exact group, # and plurals', () => {
  const visible = { name: 'List', hidden: false, grid: [['Animal ID', 'Sex'], ['1', 'F']] };
  const hidden = { name: 'Old', hidden: true, grid: [['Animal ID', 'Group', 'Sex', 'Strain', 'Cage'], ['9', 'G1', 'F', 'x', 'y']] };
  assert.equal(A.pickSheet([hidden, visible]).sheet.name, 'List');
  assert.deepEqual(A.sheetCandidates([visible, { ...visible, name: 'Copy' }]).map((c) => c.sheet.name), ['List', 'Copy'], 'on a tie the first tab');
  const h = A.findHeader([['Ear tag', 'Animal ID', 'Group description', 'Group', 'Mouse#']]);
  assert.deepEqual([h.map.label, h.map.groupCode, h.headers.label], [1, 3, 'Animal ID']);
  assert.deepEqual(['Animal ID#', 'Mouse#', 'Cage#', 'Animal IDs'].map(A.matchHeader), ['label', 'label', 'cage', 'label']);
  assert.equal(A.findHeader([['Sample ID', 'Test #', 'WBC'], ['P1', '1', '7.2']]), null, 'a generic ID heading alone is not an animal list');
  assert.ok(A.findHeader([['Sample ID', 'Sex'], ['P1', 'F']]), 'with another column it is');
});

test('merged cells, semicolons, Windows-1252, <br> headings and numbers saved as 1042.0 are read as meant', async () => {
  const bytes = writeXlsx([{ name: 'A', rows: [['Animal ID', 'Group', 'Sex'], ['1', 'G1', 'F'], ['2', '', 'F'], ['3', '', 'F']], merges: ['B2:B4'] }]);
  const merged = (await readSheets(bytes, 'm.xlsx', { fillMerged: true })).sheets[0].grid;
  assert.deepEqual(merged.slice(1).map((r) => r[1]), ['G1', 'G1', 'G1']);
  assert.deepEqual((await readSheets(bytes, 'm.xlsx')).sheets[0].grid.slice(1).map((r) => r[1] ?? ''), ['G1', '', ''], 'only when asked (instrument files are read as they are)');
  const semi = (await readSheets(new TextEncoder().encode('Animal ID;Group;Sex\n101;G1;F\n'), 'x.csv')).sheets[0].grid;
  assert.deepEqual(semi[1], ['101', 'G1', 'F']);
  const cp1252 = Uint8Array.from([...new TextEncoder().encode('Animal ID,Notes\n1,10 '), 0xB5, ...new TextEncoder().encode('g/kg\n')]);
  assert.equal((await readSheets(cp1252, 'x.csv')).sheets[0].grid[1][1], '10 µg/kg');
  const html = (await readSheets(new TextEncoder().encode('<table><tr><td>Animal<br>ID</td><td>Sex</td></tr><tr><td>7</td><td>M</td></tr></table>'), 'x.xls')).sheets[0].grid;
  assert.ok(A.findHeader(html));
  assert.equal(A.parseAnimalList([['Animal ID'], ['1042.0']], { today: TODAY }).animals[0].label, '1042');
});

test('dates: a year or ID read as a date is caught, the day/month order is the column\'s, times and 1904 workbooks are handled', () => {
  const one = (v, extra = {}) => A.parseAnimalList([['Animal ID', 'Date of birth'], ['1', v]], { today: TODAY, ...extra });
  assert.match(one('2025').problems.join(' '), /more than 30 years ago/);
  const col = A.parseAnimalList([['Animal ID', 'DOB'], ['1', '16/7/2026'], ['2', '7/6/2026']], { today: TODAY });
  assert.deepEqual(col.animals.map((a) => a.dob), ['2026-07-16', '2026-06-07'], 'day first for the whole column');
  assert.match(A.parseAnimalList([['Animal ID', 'DOB'], ['1', '16/7/2026'], ['2', '7/16/2026']], { today: TODAY }).problems[0], /mix day-first and month-first/);
  assert.equal(one('5/4/2026 0:00').animals[0].dob, '2026-05-04');
  assert.equal(one('44747', { date1904: true }).animals[0].dob, A.parseDate('46209', TODAY).value, 'the same day counted from 1904');
});

test('groups: a sex that differs from its study group is flagged; without a study, groups go into the notes', () => {
  const r = A.parseAnimalList([['Animal ID', 'Group', 'Sex'], ['1', 'G1', 'M'], ['2', 'G1', 'F']], { groups: [{ code: 'G1', sex: 'F' }], today: TODAY });
  assert.match(r.warnings.join(' '), /line 2 \(1\) is male in G1, a female group/);
  assert.match(A.parseAnimalList([['Animal ID', 'Group'], ['1', 'G1']], { study: false, today: TODAY }).warnings.join(' '), /no study, so the groups are only noted/);
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const res = t.call('POST', '/api/requests', { nasId: nas.id, type: 'HISTO', n: 1, species: 'MOUSE', study: { mode: 'none' }, lines: [{ section: 'TRIM_EMBED', code: 'HP003003', units: 1 }],
    animals: [{ label: 'X1', groupCode: 'G1', notes: 'ok' }] });
  const s = t.state.subjects.find((x) => x.requestId === res.id);
  assert.deepEqual([s.groupCode, s.notes], [null, 'ok. Group: G1']);
});

test('human samples and organoid lines: no dates of birth, ages over 89 kept as 90 or older', () => {
  assert.equal(A.phiSpecies('ORGANOID'), true); assert.equal(A.phiSpecies('PDX'), false);
  const r = A.parseAnimalList([['Case ID', 'Age', 'Date of birth', 'Notes'], ['C1', '93 years', '1933-01-01', 'x'], ['C2', '12 weeks', '', '']], { phi: true, today: TODAY });
  assert.deepEqual(r.animals.map((a) => [a.age, a.dob]), [['90 or older', ''], ['12 weeks', '']]);
  assert.match(r.warnings.join(' '), /check that the notes hold no names/);
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const res = t.call('POST', '/api/requests', { nasId: nas.id, type: 'HISTO', n: 1, species: 'ORGANOID', study: { mode: 'none' }, lines: [{ section: 'TRIM_EMBED', code: 'HP003003', units: 1 }],
    animals: [{ label: 'ORG-9', dob: '1950-01-01', age: '96' }] });
  const s = t.state.subjects.find((x) => x.requestId === res.id);
  assert.deepEqual([s.dob, s.age], [null, '90 or older']);
});

test('the template keeps IDs as text and drops a group list Excel could not hold; odd characters do not break the file', () => {
  const sheets = A.templateSheets({ groups: ['Veh, oral', 'Drug "A"'], expected: 2 });
  assert.ok(!sheets[0].validations.some((v) => v.title === 'Group'));
  const xml = new TextDecoder().decode(writeXlsx(sheets));
  assert.match(xml, /<c r="A8" s="7"\/>/, 'Animal ID cells formatted as text');
  assert.match(xml, /numFmtId="49"/);
  const quoted = new TextDecoder().decode(writeXlsx([{ name: 'x', rows: [['a￾b']], validations: [{ sqref: 'A1:A2', list: ['say "hi"'] }] }]));
  assert.ok(!quoted.includes('￾'));
  assert.match(quoted, /<formula1>"say &quot;&quot;hi&quot;&quot;"<\/formula1>/);
});

test('text from spreadsheets cannot become a formula in the LIMS\'s CSV files', () => {
  const t = fresh();
  const nas = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  const res = t.call('POST', '/api/requests', { nasId: nas.id, type: 'NECRO-FULL', n: 1, species: 'MOUSE', study: { mode: 'new', title: 'CSV' }, lines: [{ section: 'NECRO', code: 'HP002001', units: 1 }],
    animals: [{ label: '=HYPERLINK("http://example.org")', groupCode: '@G1' }] });
  const study = t.state.requests.find((r) => r.id === res.id).studyId;
  const csv = t.call('GET', `/api/studies/${study}/export.csv`).content;
  assert.ok(csv.includes(`"'=HYPERLINK(""http://example.org"")"`));
  assert.ok(csv.includes("'@G1"));
});

test('an instrument export is not taken for an animal list', { skip: !canInflate && 'this Node cannot inflate .xlsx files' }, async () => {
  const f = 'Hemavet-export-2026-11-05.xls';
  const { sheets } = await readSheets(readFileSync(path.join(here, '..', 'samples', 'instruments', f)), f);
  assert.equal(A.pickSheet(sheets), null);
});
