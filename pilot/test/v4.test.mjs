// Tests for version 4 of the pilot: protocols from Zaphod, the terminology library (INHAND / SEND), bloodwork
// (VS2 / Piccolo / Hemavet imports, review, cytology) and IHC ordered from New request. Also checks that the
// standalone bundle runs the same core (a name clash once left it without the necropsy rules).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore, upgradeToV4 } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as PROT from '../core/protocols.mjs';
import * as TERM from '../core/terminology.mjs';
import * as BW from '../core/bloodwork.mjs';
import { readSheet } from '../core/sheets.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const samples = path.join(here, '..', 'samples');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-06';

function fresh() {
  const state = seedState({ priceList, ihcCatalog, today: TODAY });
  state.settings.initials = 'TT';
  const core = createCore({ state, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  const call = (method, p, body = null, query = {}) => {
    const r = core.handle(method, p, query, body);
    if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`);
    return r.file || r.json;
  };
  const fails = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { state, core, call, fails };
}
const sample = (...p) => readFileSync(path.join(samples, ...p));

// ---------- protocols ----------
test('a necropsy protocol and a trim protocol combine into the animal\'s organ list, by sex', () => {
  const nec = { id: 1, name: 'N', weighAnimal: true, steps: [{ seq: 2, organ: 'Lungs', weigh: true }, { seq: 1, organ: 'Brain', weigh: true }, { seq: 3, organ: 'Testes', weigh: true }, { seq: 4, organ: 'Ovaries' }] };
  const trim = { id: 9, name: 'T', organs: [{ block: '1', organ: 'Brain', sex: 'N' }, { block: '2', organ: 'lungs', sex: 'N' }, { block: '7', organ: 'Testes', sex: 'M' }, { block: '7', organ: 'Ovaries', sex: 'F' }, { block: '9', organ: 'Skin', sex: 'N' }] };
  const sexOf = (o) => ({ Testes: 'M', Ovaries: 'F' }[o] || 'N');
  const female = PROT.resolveProtocol(nec, trim, 'F', sexOf);
  assert.deepEqual(female.organs.map((o) => `${o.organ}:${o.block}`), ['Brain:1', 'Lungs:2', 'Ovaries:7', 'Skin:9']);
  assert.deepEqual(PROT.resolveProtocol(nec, trim, 'M', sexOf).organs.map((o) => o.organ), ['Brain', 'Lungs', 'Testes', 'Skin']);
  assert.equal(PROT.resolveProtocol(nec, trim, '', sexOf).organs.length, 5);   // sex unknown: everything
  assert.equal(PROT.resolveProtocol(nec, null, 'F', sexOf).organs.find((o) => o.organ === 'Lungs').block, '');
});

test('protocol tables pasted from Excel or saved as CSV are read by their column names', () => {
  const tsv = 'Necropsy Protocol Report\n\nSequence\tOrgan\tFixative\tFreeze\tWeigh Organ\tMeasure Organ\tTextbox25\n1\tBrain\t10% NBF\t\tYes\t\tWhole\n2\tLiver\t10% NBF\tSnap freeze\tYes\t\t\n\nFooter';
  const n = PROT.parseProtocolTable(tsv, 'My panel');
  assert.equal(n.name, 'My panel');
  assert.deepEqual(n.steps.map((s) => [s.organ, s.weigh, s.freeze, s.description]), [['Brain', true, '', 'Whole'], ['Liver', true, 'Snap freeze', '']]);
  assert.equal(n.organs.length, 0);
  const csv = 'ProtocolName,Block No.,Organ,Sex,Description\n"Trim A",1,Brain,,"Coronal, three levels"\n"Trim A",7,Testes,M,\n';
  const t = PROT.parseProtocolTable(csv);
  assert.equal(t.name, 'Trim A');
  assert.deepEqual(t.organs, [{ block: '1', organ: 'Brain', sex: 'N', description: 'Coronal, three levels' }, { block: '7', organ: 'Testes', sex: 'M', description: '' }]);
  assert.throws(() => PROT.parseProtocolTable('just some text'), /Organ/);
});

test('the Zaphod export previews, then imports protocols, study links, dictionaries and reference ranges', () => {
  const { state, call } = fresh();
  const text = sample('zaphod', 'zaphod-export-sample.json').toString('utf8');
  const before = JSON.stringify(state.protocols);
  const { plan } = call('POST', '/api/protocols/import', { format: 'zaphod', text }, { preview: '1' });
  assert.equal(JSON.stringify(state.protocols), before, 'a preview changes nothing');
  assert.deepEqual(plan.necropsy.map((p) => p.action), ['add', 'add', 'add']);
  assert.equal(plan.studies.find((s) => s.zap === 'ZAP2215').inPilot, true);
  assert.equal(plan.dictionaries.newDiagnoses, 3);   // "Inflammation" is already in the library

  const res = call('POST', '/api/protocols/import', { format: 'zaphod', text, options: { linkStudies: true, dictionaries: true, ranges: true } });
  assert.equal(res.linked, 1);
  const lung = state.protocols.necropsy.find((p) => p.name === 'Sample - lung tumor model');
  assert.equal(lung.source, 'zaphod'); assert.equal(lung.zaphodId, 42); assert.equal(lung.steps.length, 5);
  assert.equal(state.protocols.necropsy.find((p) => p.name === 'Sample - old panel').obsolete, true);
  const zap = state.studies.find((s) => s.zap === 'ZAP2215');
  assert.equal(zap.necropsyProtocolId, lung.id);
  assert.equal(state.protocols.trim.find((p) => p.id === zap.trimProtocolId).name, 'Sample - lung tumor trim');
  assert.ok(state.library.organs.some((o) => o.name === 'Lymph node, mediastinal'), 'organs named in protocols join the library');
  const ha = state.library.diagnoses.find((d) => d.term === 'Hepatocellular adenoma');
  assert.equal(ha.neoplasm, true); assert.deepEqual(ha.organs, ['Liver']); assert.equal(ha.source, 'zaphod');
  assert.deepEqual(state.library.lists.fates, ['Scheduled euthanasia', 'Moribund euthanasia', 'Found dead']);
  assert.deepEqual(state.bloodwork.ranges.MOUSE['NA+'], { low: 140, high: 160 });
  assert.deepEqual(state.bloodwork.ranges.MOUSE['NE%'], { low: 6.6, high: 38.9 });
  // Importing again updates the same protocols instead of adding copies.
  call('POST', '/api/protocols/import', { format: 'zaphod', text });
  assert.equal(state.protocols.necropsy.filter((p) => p.name === 'Sample - lung tumor model').length, 1);
});

test('protocols are created, edited (which takes away approval), approved, copied and made obsolete', () => {
  const { state, call, fails } = fresh();
  const { id } = call('POST', '/api/protocols/necropsy', { name: 'Kidney study', steps: [{ organ: 'Kidneys', weigh: true }, { organ: 'Urinary bladder' }] });
  const empty = call('POST', '/api/protocols/trim', { name: 'Empty trim' });
  assert.match(fails('POST', `/api/protocols/trim/${empty.id}/approve`), /Before approving: List at least one organ/);
  call('POST', `/api/protocols/necropsy/${id}/approve`);
  const p = state.protocols.necropsy.find((x) => x.id === id);
  assert.equal(p.approved, true);
  call('PUT', `/api/protocols/necropsy/${id}`, { steps: [...p.steps, { organ: 'Ureters' }] });
  assert.equal(p.approved, false, 'editing takes the approval away');
  assert.ok(state.library.organs.some((o) => o.name === 'Ureters'));
  assert.match(fails('POST', '/api/protocols/necropsy', { name: 'kidney STUDY' }), /already/);
  const copy = call('POST', '/api/protocols/necropsy', { copyFrom: id, name: 'Kidney study v2' });
  assert.equal(state.protocols.necropsy.find((x) => x.id === copy.id).steps.length, 3);
  call('POST', `/api/protocols/necropsy/${id}/obsolete`, { reason: 'Replaced' });
  assert.match(fails('POST', '/api/studies', { title: 'x', necropsyProtocolId: id }), /obsolete/);
  assert.equal(call('POST', `/api/protocols/necropsy/${copy.id}/approve`).protocol.approved, true);
  assert.match(fails('PUT', `/api/protocols/necropsy/${id}`, { name: 'x' }), /obsolete/);
});

test('a necropsy uses the study\'s necropsy and trim protocols for the animal\'s sex', () => {
  const { state, call } = fresh();
  call('POST', '/api/protocols/import', { format: 'zaphod', text: sample('zaphod', 'zaphod-export-sample.json').toString('utf8') });
  const full = state.protocols.necropsy.find((p) => p.name === 'Sample - mouse full necropsy');
  const trim = state.protocols.trim.find((p) => p.name === 'Sample - mouse full trim');
  const brennan = state.studies.find((s) => s.zap === 'ZAP2231');
  call('PATCH', `/api/studies/${brennan.id}`, { necropsyProtocolId: full.id, trimProtocolId: trim.id });
  const male = state.subjects.find((s) => s.studyId === brennan.id && !state.necropsies[s.id]);
  assert.equal(male.sex, 'M');
  const n = call('GET', `/api/necropsy/${male.id}`);
  const organs = n.necropsy.organs.map((o) => o.organ);
  assert.ok(organs.includes('Testes') && !organs.includes('Ovaries') && !organs.includes('Uterus'));
  const liver = n.necropsy.organs.find((o) => o.organ === 'Liver');
  assert.equal(liver.block, 3); assert.equal(liver.freeze, 'Snap freeze'); assert.match(liver.instructions, /left lateral lobe/);
  assert.equal(n.protocol.trimName, 'Sample - mouse full trim');
});

test('saved data from version 3 upgrades: protocols split, studies and necropsies keep their protocol', () => {
  const { state } = fresh();
  const old = structuredClone(state);
  delete old.library; delete old.protocols; delete old.bloodwork; delete old.sendCt;
  for (const s of old.studies) { s.protocolId = s.necropsyProtocolId; delete s.necropsyProtocolId; delete s.trimProtocolId; }
  for (const n of Object.values(old.necropsies)) { delete n.necropsyProtocolId; delete n.trimProtocolId; }
  old.version = 3;
  const core = createCore({ state: old, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  assert.equal(old.version, 7);   // versions 5 (slide imaging), 6 (estimates) and 7 run after it
  const zap = old.studies.find((s) => s.zap === 'ZAP2231');
  assert.equal(zap.necropsyProtocolId, 3); assert.equal(zap.trimProtocolId, 3);
  const study = core.handle('GET', `/api/studies/${zap.id}`).json;
  assert.equal(study.study.protocolName, 'Lung perfusion');
  assert.equal(upgradeToV4(old), false, 'upgrading twice does nothing');
});

// ---------- terminology ----------
const EVS = [
  'Code\tCodelist Code\tCodelist Extensible (Yes/No)\tCodelist Name\tCDISC Submission Value\tCDISC Synonym(s)\tCDISC Definition\tNCI Preferred Term',
  'C1001\t\tYes\tSpecimen\tSPEC\tSpecimen\tSynthetic test codelist\tSpecimen',
  'C2001\tC1001\t\tSpecimen\tLUNG\tLungs\tSynthetic\tLung',
  'C2002\tC1001\t\tSpecimen\tGLAND, ADRENAL\tAdrenal Gland\tSynthetic\tAdrenal Gland',
  'C1002\t\tYes\tNon-Neoplastic Finding Type\tNONNEO\t\tSynthetic\tNon-neoplastic',
  'C3001\tC1002\t\tNon-Neoplastic Finding Type\tHYPERPLASIA, BRONCHIOLOALVEOLAR\t\tSynthetic\tHyperplasia',
  'C3002\tC1002\t\tNon-Neoplastic Finding Type\tINFLAMMATION\t\tSynthetic\tInflammation',
  'C1003\t\tYes\tNeoplasm Type\tNEOPLASM\t\tSynthetic\tNeoplasm',
  'C4001\tC1003\t\tNeoplasm Type\tADENOMA, BRONCHIOLOALVEOLAR, BENIGN\t\tSynthetic\tAdenoma',
  'C1004\t\tNo\tOther\tFOO\t\tSynthetic\tFoo',
].join('\n');

test('the starter library has INHAND systems and an unverified SEND mapping for every term', () => {
  const lib = TERM.starterLibrary();
  assert.ok(lib.diagnoses.length > 180 && lib.organs.length > 55);
  assert.ok(lib.diagnoses.every((d) => d.send.term && d.send.verified === false && TERM.INHAND_SYSTEMS.some((s) => s.key === d.system)));
  assert.equal(lib.organs.find((o) => o.name === 'Adrenal glands').send.spec, 'GLAND, ADRENAL');
  assert.equal(lib.organs.find((o) => o.name === 'Testes').sex, 'M');
  assert.equal(lib.diagnoses.find((d) => d.term === 'Adenoma, hepatocellular').system, 'hepatobiliary');
  assert.equal(new Set(lib.diagnoses.map((d) => d.term.toLowerCase())).size, lib.diagnoses.length, 'no duplicate terms');
});

test('the NCI EVS SEND terminology file is parsed, and matching ignores hyphens and tries the neoplasm behavior', () => {
  const parsed = TERM.parseEvsTerminology(EVS);
  assert.deepEqual(Object.keys(parsed.codelists).sort(), ['NEOPLASM', 'NONNEO', 'SPEC']);
  assert.equal(parsed.totalCodelists, 4);
  assert.equal(TERM.findSendTerm(parsed.codelists.NONNEO, 'Hyperplasia, bronchiolo-alveolar').code, 'C3001');
  assert.equal(TERM.findSendTerm(parsed.codelists.SPEC, 'lungs').code, 'C2001', 'synonyms match too');
  const { library, verified } = TERM.verifyLibrary(TERM.starterLibrary(), parsed.codelists);
  assert.equal(library.diagnoses.find((d) => d.term === 'Adenoma, bronchiolo-alveolar').send.code, 'C4001');
  assert.equal(library.organs.find((o) => o.name === 'Lungs').send.verified, true);
  assert.ok(verified >= 5);
  assert.throws(() => TERM.parseEvsTerminology('a\tb\n1\t2'), /NCI EVS/);
});

test('loading SEND CT, adding a term, and the SEND-style microscopic findings table', () => {
  const { state, call } = fresh();
  const parsed = TERM.parseEvsTerminology(EVS);
  const res = call('POST', '/api/library/send-ct', { fileName: 'SEND Terminology.txt', codelists: parsed.codelists });
  assert.ok(res.verified >= 5);
  assert.equal(call('GET', '/api/library/send-search', null, { list: 'NONNEO', q: 'inflam' }).terms[0].value, 'INFLAMMATION');
  const saved = call('POST', '/api/library/diagnoses', { term: 'Bronchiolo-alveolar hyperplasia, atypical', organs: ['Lungs'], system: 'respiratory', sendTerm: 'hyperplasia, bronchiolo-alveolar' });
  assert.equal(saved.diagnosis.send.verified, true); assert.equal(saved.diagnosis.send.code, 'C3001');
  assert.ok(state.library.diagnoses.some((d) => d.term === 'Bronchiolo-alveolar hyperplasia, atypical'));
  const zap = state.studies.find((s) => s.zap === 'ZAP2215');
  const csv = call('GET', `/api/studies/${zap.id}/send-mi.csv`).content.split('\r\n');
  assert.match(csv[0], /^STUDYID,USUBJID,PHL,GROUP,SEX,MISEQ,MISPEC,MIORRES,MISTRESC,MIRESCAT,MISEV/);
  assert.ok(csv.some((l) => l.includes('LUNG') && l.includes('"ADENOMA, BRONCHIOLOALVEOLAR, BENIGN"') && l.endsWith(',Yes')), 'neoplasms coded with the verified SEND value');
  assert.ok(csv.some((l) => l.includes('MINIMAL') || l.includes('MILD') || l.includes('MODERATE')), 'severity in SEND words');
  const lib = call('GET', '/api/library');
  assert.equal(lib.sendCt.fileName, 'SEND Terminology.txt');
});

test('pathology entry uses the library: a lab term counts as known, with its neoplasm setting', () => {
  const { state, call } = fresh();
  call('POST', '/api/library/diagnoses', { term: 'Lymphoma, B-cell', organs: ['*'], neoplasm: true, system: 'hematolymphoid' });
  const subj = state.subjects.find((s) => state.pathology[s.id]?.status === 'DRAFT' && state.pathology[s.id].tissues.length);
  const c = call('GET', `/api/pathology/${subj.id}`).case;
  const t = c.tissues[0];
  t.diagnoses = [{ term: 'lymphoma, b-cell', behavior: 'Malignant' }];
  const saved = call('PUT', `/api/pathology/${subj.id}`, { ...c, tissues: [t, ...c.tissues.slice(1)] }).case;
  const dx = saved.tissues[0].diagnoses[0];
  assert.equal(dx.term, 'Lymphoma, B-cell'); assert.equal(dx.inDictionary, true); assert.equal(dx.neoplasm, true);
});

// ---------- bloodwork ----------
// Zaphod's VS2 reader (ReadChemistryFiles.vb), ported line for line, to show the new parser reads the same values.
function zaphodVs2(text) {
  const lines = text.replace(/\r\n?/g, '\n').split('\n'); let i = 0;
  const next = () => lines[i++] ?? '';
  const mid = (s, start, len) => s.substr(start - 1, len ?? undefined);
  next(); const header = next(); const vs2 = header.includes('VS2'); if (vs2) next();
  next(); next(); const phl = mid(next(), 12).trim();
  for (let k = 0; k < (vs2 ? 3 : 5); k++) next();
  const out = {};
  for (const code of ['ALB', 'ALP', 'ALT', 'AMY', 'TBIL', 'BUN', 'CA', 'PHOS', 'CRE', 'GLU', 'NA+', 'K+', 'TP', 'GLOB']) {
    const l = next();
    let prefix = mid(l, 7, 1); let value = mid(l, 8, 4);
    if (!/^\s*-?\d+(\.\d+)?\s*$/.test(value)) { prefix = value.trim()[0]; value = '-1'; }
    out[code] = { prefix: prefix.trim(), value: Number(value), flag: mid(l, 13, 1).trim() };
  }
  return { phl, out };
}

test('the chemistry parser reads VS2 printouts exactly as Zaphod did, and Piccolo panels by name', () => {
  for (const f of ['VS2-26000327A.txt', 'VS2-26000328A.txt', 'VS2-26000329A.txt']) {
    const text = sample('instruments', f).toString('utf8');
    const z = zaphodVs2(text);
    const [one] = BW.splitPrintouts(text).map(BW.parseAbaxis);
    assert.equal(one.sampleId, z.phl);
    assert.equal(one.instrument, 'VS2');
    for (const [code, v] of Object.entries(z.out)) {
      const a = one.analytes.find((x) => x.code === code);
      if (v.value === -1) assert.equal(a.value, null, `${f} ${code} is not a number`);
      else assert.equal(a.value, v.value, `${f} ${code}`);
      assert.equal(a.flag, v.flag, `${f} ${code} flag`);
      if (v.value !== -1) assert.equal(a.prefix, v.prefix, `${f} ${code} prefix`);
    }
  }
  const pic = BW.splitPrintouts(sample('instruments', 'Piccolo-session-2026-11-05.txt').toString('utf8')).map(BW.parseAbaxis);
  assert.equal(pic.length, 2);
  assert.equal(pic[0].instrument, 'PICCOLO'); assert.equal(pic[0].panel, 'Comprehensive Metabolic Panel');
  assert.deepEqual(pic[0].analytes.map((a) => a.code), ['ALB', 'ALP', 'ALT', 'AST', 'BUN', 'CA', 'CL-', 'CRE', 'GLU', 'K+', 'NA+', 'TBIL', 'TCO2', 'TP']);
  assert.deepEqual(pic[0].analytes.find((a) => a.code === 'AST'), { code: 'AST', value: 121, text: '', prefix: '', unit: 'U/L', flag: 'H', range: { low: 11, high: 38 } });
});

test('the Hemavet DMS export is read from a real .xls (BIFF8) and from CSV, with Zaphod\'s layouts', async () => {
  const xls = await readSheet(sample('instruments', 'Hemavet-export-2026-11-05.xls'), 'h.xls');
  assert.equal(xls.format, 'xls');
  const csv = await readSheet(sample('instruments', 'Hemavet-export-2026-11-05.csv'), 'h.csv');
  const a = BW.parseHemavetGrid(xls.grid); const b = BW.parseHemavetGrid(csv.grid);
  assert.equal(a.results.length, 3);
  assert.deepEqual(a.results.map((r) => r.analytes.map((x) => `${x.code}=${x.value}${x.flag}`)), b.results.map((r) => r.analytes.map((x) => `${x.code}=${x.value}${x.flag}`)));
  const r = a.results[1];
  assert.equal(r.sampleId, '26000328A'); assert.equal(r.testedOn, '2026-11-05'); assert.equal(r.testedAt, '09:18');
  assert.deepEqual(r.analytes.find((x) => x.code === 'WBC'), { code: 'WBC', value: 11.92, text: '', prefix: '', unit: '', flag: 'H', range: null });
  // Without labels in column A, the layout is chosen from the rows used: the newer format reaches row 31 (PDW).
  const bare = Array.from({ length: 32 }, () => ['', '', '', '']);
  bare[0][3] = '26000330A';
  Object.entries(BW.HEMAVET_LAYOUTS.extended).forEach(([, row], k) => { bare[row - 1][2] = String(k + 1); });
  const ext = BW.parseHemavetGrid(bare);
  assert.equal(ext.layout, 'extended');
  assert.equal(ext.results[0].analytes.find((x) => x.code === 'HCT').value, 12);   // HCT is on row 19 in the newer layout
});

test('bloodwork imports match PHL numbers, skip repeats, and are reviewed, released (with the charge), reopened and rejected', () => {
  const { state, call, fails } = fresh();
  const res = call('POST', '/api/bloodwork/import', { fileName: 'Piccolo.txt', text: sample('instruments', 'Piccolo-session-2026-11-05.txt').toString('utf8') });
  assert.deepEqual([res.imported, res.matched, res.unmatched], [2, 1, 1]);
  assert.equal(call('POST', '/api/bloodwork/import', { fileName: 'again.txt', text: sample('instruments', 'Piccolo-session-2026-11-05.txt').toString('utf8') }).duplicates, 2);
  const unmatched = state.bloodwork.results.find((r) => r.status === 'UNMATCHED');
  assert.equal(unmatched.sampleId, '2600331A');
  assert.match(fails('POST', `/api/bloodwork/results/${unmatched.id}/release`, {}), /Assign/);
  assert.match(fails('POST', `/api/bloodwork/results/${unmatched.id}/assign`, { phl: '99999999Z' }), /not a PHL number/);
  call('POST', `/api/bloodwork/results/${unmatched.id}/assign`, { phl: '26000331a' });
  const d = call('POST', `/api/bloodwork/results/${unmatched.id}/release`, { comment: 'Sample ID mistyped on the analyzer.' });
  assert.equal(d.result.status, 'RELEASED');
  assert.equal(d.charge.code, 'HP002205'); assert.equal(d.charge.status, 'PENDING'); assert.equal(d.charge.section, 'BLOOD');
  assert.equal(d.analytes.find((a) => a.code === 'ALT').labFlag, '', 'ALT 44 is inside the printed 10-47');
  call('POST', `/api/bloodwork/results/${unmatched.id}/reopen`, { reason: 'Wrong animal' });
  assert.equal(state.charges.find((c) => c.id === d.charge.id).status, 'VOID');
  call('POST', `/api/bloodwork/results/${unmatched.id}/reject`, { reason: 'Rerun' });
  // The lab's own range wins over the printed one.
  call('PUT', '/api/bloodwork/ranges', { species: 'MOUSE', ranges: { ALT: { low: 20, high: 40 } } });
  const other = state.bloodwork.results.find((r) => r.status === 'TO_REVIEW' && r.instrument === 'PICCOLO');
  const alt = call('GET', `/api/bloodwork/results/${other.id}`).analytes.find((a) => a.code === 'ALT');
  assert.deepEqual([alt.range.source, alt.labFlag], ['lab', 'H']);
  assert.match(fails('PUT', '/api/bloodwork/ranges', { species: 'MOUSE', ranges: { ALT: { low: 50, high: 40 } } }), /low end/);
});

test('hematology grids import as one result per sample column; the study summary averages by group', () => {
  const { state, call } = fresh();
  assert.equal(BW.parseHemavetGrid([[]]).results.length, 0);
  const zap = state.studies.find((s) => s.zap === 'ZAP2215');
  const sum = call('GET', `/api/studies/${zap.id}/bloodwork`);
  const heme = sum.tables.find((t) => t.kind === 'HEMATOLOGY');
  assert.equal(heme.animals, 12);
  const wbc = heme.analytes.find((a) => a.code === 'WBC');
  assert.ok(wbc.groups.find((g) => g.code === 'G1').mean > wbc.groups.find((g) => g.code === 'G2').mean, 'tumor-bearing controls have the higher WBC in the seed data');
  const csv = call('GET', `/api/studies/${zap.id}/bloodwork.csv`).content;
  assert.match(csv.split('\r\n')[0], /^ZAP,PHL,Animal,Group,Sex,Kind,Instrument,Date,Time,Analyte,Value/);
  const report = call('GET', `/api/subjects/${state.subjects.find((s) => s.studyId === zap.id).id}/bloodwork`);
  assert.ok(report.results.length >= 1);
});

test('cytology: differential with percentages and M:E ratio, sign-out lock and amendment', () => {
  const { call, fails } = fresh();
  const s = BW.differentialSummary({ Myelocytes: 30, 'Segmented neutrophils': 30, Rubricytes: 20, Metarubricytes: 10, Lymphocytes: 10 }, 'Bone marrow smear');
  assert.deepEqual([s.kind, s.total, s.me, s.pct.Lymphocytes], ['marrow', 100, 2, 10]);
  const { id } = call('POST', '/api/bloodwork/cytology', { phl: '26000327A', specimen: 'Blood smear' });
  assert.match(fails('POST', `/api/bloodwork/cytology/${id}/sign`), /interpretation/);
  call('PUT', `/api/bloodwork/cytology/${id}`, { counts: { 'Segmented neutrophils': 22, Lymphocytes: 74, Monocytes: 4 }, rbc: { Polychromasia: '1+', Bogus: '4+' }, nrbc: 2,
    platelets: 'Adequate', interpretation: 'No significant abnormalities.' });
  const signed = call('POST', `/api/bloodwork/cytology/${id}/sign`);
  assert.equal(signed.cytology.status, 'SIGNED'); assert.deepEqual(signed.cytology.rbc, { Polychromasia: '1+' }); assert.equal(signed.summary.total, 100);
  assert.match(fails('PUT', `/api/bloodwork/cytology/${id}`, { interpretation: 'x' }), /signed/);
  assert.match(fails('POST', `/api/bloodwork/cytology/${id}/amend`, { reason: '' }), /reason/);
  assert.equal(call('POST', `/api/bloodwork/cytology/${id}/amend`, { reason: 'Platelet clumps missed' }).cytology.version, 2);
});

// ---------- IHC from New request ----------
test('New request can order catalog stains: the estimate adds them, and the request gets an IHC worksheet', () => {
  const { state, call } = fresh();
  const nas = state.nas.find((n) => !n.requestId && n.type === 'NECRO-FULL');
  const cd8 = state.assays.find((a) => a.status === 'Active' && a.name === 'CD8' && a.speciesTags.includes('Mouse')) || state.assays.find((a) => a.status === 'Active' && a.speciesTags.includes('Mouse'));
  const ihc = { tissue: 'Lungs', sampleType: 'BLOCK', addOn: true, he: { on: false, perBlock: 1 }, unstained: { on: true, perBlock: 2 }, scan: { x20: true, x40: false }, stains: [{ assayId: cd8.id, chromogen: 'DAB' }] };
  const est = call('POST', '/api/requests/ihc-estimate', { n: 4, species: 'MOUSE', fixative: '10%NBF', ihc });
  const codes = Object.fromEntries(est.estimate.lines.map((l) => [l.code, l.units]));
  assert.equal(codes.HP003003, undefined, 'no trimming for an add-on');
  assert.equal(codes.HP004002, 12, 'two unstained plus one stained slide per block, as extra sections');
  assert.equal(codes.HP006004, 4); assert.equal(codes.HP001006, 4);
  const lines = [{ section: 'NECRO', code: 'HP002001', units: 4 }, ...est.estimate.lines.map((l) => ({ section: l.section, code: l.code, units: l.units }))];
  const res = call('POST', '/api/requests', { nasId: nas.id, type: 'NECRO-FULL', n: 4, species: 'MOUSE', lines, study: { mode: 'none' }, ihc });
  assert.match(res.ihcNumber, /^MH\d{2}-\d{4}$/);
  const w = state.ihcRequests.find((x) => x.number === res.ihcNumber);
  assert.deepEqual([w.status, w.source, w.requestId, w.samples.length], ['Accepted', 'NEW_REQUEST', res.id, 4]);
  assert.equal(w.stains[0].snapshot.name, cd8.name);
  const ws = call('GET', `/api/requests/${res.id}/ihc`);
  assert.deepEqual(ws.blocks.map((b) => b.phl), res.phls);
  // An IHC request (MOLEC) without stains gets no IHC order.
  const nas2 = state.nas.find((n) => !n.requestId);
  const plain = call('POST', '/api/requests', { nasId: nas2.id, type: 'HISTO', n: 1, species: 'MOUSE', lines: [{ section: 'TRIM_EMBED', code: 'HP003003', units: 1 }], ihc: { ...ihc, stains: [], unstained: { on: false, perBlock: 1 } } });
  assert.equal(plain.ihcNumber, null);
});

test('antibody details are read from the catalog text', async () => {
  const { antibodyInfo } = await import('../core/ihc.mjs');
  assert.deepEqual(antibodyInfo({ name: '2A Peptide (3H4)', catalog: 'NBP2-59627B (biotin ms IgG1)', plex: 1 }), { clone: '3H4', host: 'Mouse', isotype: 'IgG1', clonality: 'Monoclonal', conjugate: 'Biotin' });
  assert.equal(antibodyInfo({ name: 'CD34 (RAM34)', catalog: '14-0341 (rat IgG2a)', plex: 1 }).clone, 'RAM34');
  assert.equal(antibodyInfo({ name: 'CD56 (NCAM1)', catalog: 'ab1 (rabb mAb)', plex: 1 }).clone, '', 'gene aliases are not clones');
  assert.deepEqual(antibodyInfo({ name: 'Iba1', catalog: '019-19741 (rabb pAb)', plex: 1 }), { clone: '', host: 'Rabbit', isotype: '', clonality: 'Polyclonal', conjugate: '' });
  assert.equal(antibodyInfo({ name: '6-plex x', catalog: 'a (rabb mAb), b (ms IgG1)', plex: 6 }).several, true);
});

// ---------- the standalone file runs the same core ----------
test('the standalone bundle loads every core module and approves a necropsy', () => {
  const require = new Function(`${LOADER}\n${bundleModules()}\nreturn __require;`)();
  const { createCore: bundledCore } = require('core');
  const { seedState: bundledSeed } = require('seed');
  assert.equal(typeof require('necrules').approvalProblems, 'function');
  const state = bundledSeed({ priceList, ihcCatalog, today: TODAY });
  state.settings.initials = 'TT';
  const core = bundledCore({ state, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  const animal = state.subjects.find((s) => state.necropsies[s.id] === undefined && state.requests.find((r) => r.id === s.requestId)?.areas.includes('NECRO'));
  const n = core.handle('GET', `/api/necropsy/${animal.id}`).json.necropsy;
  const filled = { ...n, matchesCageCard: true, bodyWeight: 24.1, organs: n.organs.map((o) => ({ ...o, weight: o.weigh ? 0.2 : null })) };
  const res = core.handle('POST', `/api/necropsy/${animal.id}/approve`, {}, filled);
  assert.equal(res.status, 200, res.json?.error);
  assert.equal(res.json.necropsy.status, 'APPROVED');
  assert.equal(core.handle('GET', '/api/bloodwork').status, 200);
});

// ---------- regressions found in review ----------
function tinyXlsx(sheetXml, strings) {
  const enc = new TextEncoder();
  const files = { 'xl/sharedStrings.xml': `<sst>${strings.map((t) => `<si><t>${t}</t></si>`).join('')}</sst>`, 'xl/worksheets/sheet1.xml': sheetXml };
  const crc32 = (b) => { let crc = 0xFFFFFFFF; for (let n = 0; n < b.length; n++) { let c = (crc ^ b[n]) & 0xFF; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xEDB88320 : c >>> 1; crc = (crc >>> 8) ^ c; } return (crc ^ 0xFFFFFFFF) >>> 0; };
  const parts = []; const central = []; let off = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = enc.encode(text); const nm = enc.encode(name); const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
    parts.push(new Uint8Array(lh.buffer), nm, data);
    const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, off, true);
    central.push(new Uint8Array(ch.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const size = central.reduce((n, p) => n + p.length, 0);
  const eocd = new DataView(new ArrayBuffer(22)); eocd.setUint32(0, 0x06054b50, true); eocd.setUint16(8, 2, true); eocd.setUint16(10, 2, true); eocd.setUint32(12, size, true); eocd.setUint32(16, off, true);
  return Uint8Array.from([...parts, ...central, new Uint8Array(eocd.buffer)].flatMap((p) => [...p]));
}

test('xlsx cells written as <c .../> and empty rows written as <row .../> keep everything in place', async () => {
  const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" s="1"/><c r="D1" t="s"><v>1</v></c></row><row r="2"/><row r="3"><c r="C3"><v>11.92</v></c><c r="D3" t="inlineStr"><is><t>H</t></is></c></row></sheetData></worksheet>';
  const { format, grid } = await readSheet(tinyXlsx(xml, ['ID', '26000327A']), 'x.xlsx');
  assert.equal(format, 'xlsx');
  assert.deepEqual(grid, [['ID', '', '', '26000327A'], [], ['', '', '11.92', 'H']]);
});

test('a blank sample column in a Hemavet sheet is skipped, not the end of the import', () => {
  const grid = Array.from({ length: 29 }, () => Array(10).fill(''));
  grid[0][3] = '26000327A'; grid[0][7] = '26000329A';   // sample 2 (columns E/F) has no ID
  grid[5][2] = '6.1'; grid[5][4] = '7.0'; grid[5][6] = '8.2';
  const r = BW.parseHemavetGrid(grid, 'original').results;
  assert.deepEqual(r.map((x) => [x.sampleId, x.analytes.find((a) => a.code === 'WBC').value]), [['26000327A', 6.1], ['26000329A', 8.2]]);
});

test('Zaphod protocols that share a name stay separate; protocol tables that import nothing fail', () => {
  const { state, call, fails } = fresh();
  const j = JSON.parse(sample('zaphod', 'zaphod-export-sample.json').toString('utf8'));
  j.necropsyProtocols.push({ ...j.necropsyProtocols[1], ProtocolID: 99, steps: [{ Sequence: 1, Organ: 'Heart', WeighOrgan: true }] });
  call('POST', '/api/protocols/import', { format: 'zaphod', text: JSON.stringify(j) });
  const same = state.protocols.necropsy.filter((p) => p.name === 'Sample - lung tumor model');
  assert.deepEqual(same.map((p) => [p.zaphodId, p.steps.length]).sort(), [[42, 5], [99, 1]]);
  assert.match(fails('POST', '/api/protocols/import', { format: 'table', kind: 'trim', name: 'T', text: 'Organ\tWeigh\nBrain\tYes' }), /Block column/);
});

test('a study keeps an obsolete protocol when other details are edited; organs in two blocks get two rows', () => {
  const { state, call } = fresh();
  const zap = state.studies.find((s) => s.zap === 'ZAP2231');
  call('POST', `/api/protocols/necropsy/${zap.necropsyProtocolId}/obsolete`, {});
  call('PATCH', `/api/studies/${zap.id}`, { title: 'Renamed', necropsyProtocolId: zap.necropsyProtocolId });
  assert.equal(state.studies.find((s) => s.id === zap.id).title, 'Renamed');
  const rows = PROT.resolveProtocol({ steps: [{ seq: 1, organ: 'Spinal cord', weigh: true }] }, { organs: [{ block: '10', organ: 'Spinal cord', sex: 'N' }, { block: '11', organ: 'Spinal cord', sex: 'N' }] }).organs;
  assert.deepEqual(rows.map((o) => [o.block, o.weigh]), [['10', true], ['11', false]]);
});

test('neoplasm SEND values that depend on behavior follow the recorded behavior', () => {
  const evs = `${EVS}\nC4002\tC1003\t\tNeoplasm Type\tTHYMOMA, BENIGN\t\tSynthetic\tThymoma\nC4003\tC1003\t\tNeoplasm Type\tTHYMOMA, MALIGNANT\t\tSynthetic\tThymoma`;
  const { library } = TERM.verifyLibrary(TERM.starterLibrary(), TERM.parseEvsTerminology(evs).codelists);
  const thymoma = library.diagnoses.find((d) => d.term === 'Thymoma');
  assert.equal(thymoma.send.verified, true);
  assert.deepEqual(Object.keys(thymoma.send.byBehavior).sort(), ['BENIGN', 'MALIGNANT']);
  const m = TERM.miRow({ organ: 'Thymus', dx: { term: 'Thymoma', neoplasm: true, behavior: 'Malignant' }, library });
  assert.deepEqual([m.MISTRESC, m.MIRESCAT, m.CODED], ['THYMOMA, MALIGNANT', 'MALIGNANT', 'Yes']);
  assert.equal(library.diagnoses.find((d) => d.term === 'Adenoma, bronchiolo-alveolar').send.term, 'ADENOMA, BRONCHIOLOALVEOLAR, BENIGN', 'only one version exists, so it is used');
});

test('bloodwork edge cases: printed units, bile acids, a printout with no header, a same-day rerun', () => {
  const { state, call } = fresh();
  const text = ['Patient ID: 26000327A', '05 Nov 2026', 'GLU   9.8   mmol/L  5.0-10.7', 'BA    12    umol/L  0-35', 'ALT   41    U/L    28-132'].join('\n');
  const res = call('POST', '/api/bloodwork/import', { fileName: 'mid-print capture.txt', text });
  const r = state.bloodwork.results.find((x) => x.id === res.results[0].id);
  assert.equal(r.instrument, 'ABAXIS', 'no header: the analyzer is unknown');
  assert.deepEqual(r.analytes.map((a) => a.code), ['GLU', 'TBA', 'ALT']);
  call('PUT', '/api/bloodwork/ranges', { species: 'MOUSE', ranges: { GLU: { low: 90, high: 192 } } });
  const glu = call('GET', `/api/bloodwork/results/${r.id}`).analytes.find((a) => a.code === 'GLU');
  assert.deepEqual([glu.unit, glu.range.source, glu.labFlag], ['mmol/L', 'instrument', ''], 'the mg/dL lab range is not applied to mmol/L');
  assert.match(glu.unitNote, /mmol\/L/);
  call('POST', `/api/bloodwork/results/${r.id}/instrument`, { instrument: 'PICCOLO' });
  assert.equal(call('POST', `/api/bloodwork/results/${r.id}/release`, {}).charge.code, 'HP002205');
  const rerun = call('POST', '/api/bloodwork/import', { fileName: 'rerun.txt', text: text.replace('ALT   41', 'ALT   44') });
  assert.equal(rerun.imported, 1, 'same animal, same day, no time, different values: a rerun, not a duplicate');
  assert.equal(call('POST', '/api/bloodwork/import', { fileName: 'again.txt', text }).duplicates, 1);
});
