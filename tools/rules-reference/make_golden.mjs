#!/usr/bin/env node
// Writes tools/rules-reference/golden/ihc-pathology-golden.json: inputs and expected outputs produced by the pilot's
// working JavaScript rules (pilot/core/ihc.mjs, pathology.mjs, necrules.mjs). The C# tests in
// tests/MhlLims.Domain.Tests/Golden load this file and check MhlLims.Domain gives the same answers, case for case,
// so the C# port is verified on its first build.
//
//   node tools/rules-reference/make_golden.mjs
//
// Shapes are written for C# (hePerBlock instead of he: { on, perBlock }, and so on). Re-run after changing a rule.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as IHC from '../../pilot/core/ihc.mjs';
import * as PATH from '../../pilot/core/pathology.mjs';
import * as NEC from '../../pilot/core/necrules.mjs';
import { PROTOCOLS } from '../../pilot/core/defs.mjs';
import { seedState } from '../../pilot/core/seed.mjs';
import { loadAssays } from '../../pilot/core/core.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const rawCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const catalog = { ...rawCatalog, assays: loadAssays(rawCatalog) };   // fill in the fields the compact JSON leaves out
const TODAY = '2026-11-04';
const state = seedState({ priceList, ihcCatalog: rawCatalog, today: TODAY });
const protocols = catalog.assays.filter((a) => !a.components);
const uniq = (xs) => [...new Set(xs)];
const view = (a) => ({ id: a.id, name: a.name, kind: a.kind, plex: a.plex, status: a.status, speciesTags: a.speciesTags, fixTags: a.fixTags, chromogen: a.chromogen });

const g = { generatedFrom: 'pilot/core/ihc.mjs, pathology.mjs, necrules.mjs', generatedOn: TODAY };

// ---------- IHC: reading the export ----------
const dilutionInputs = uniq([...catalog.assays.filter((a) => a.repairs?.dilution).map((a) => a.repairs.dilution),
  '1:50 ON4C', '1:100 60\'', 'N/A', '', '0.5', '0.01', '12', '2.819444444', 'RTU 30\'', '1:10,000']);
g.excelDilution = dilutionInputs.map((input) => ({ input, ...IHC.decodeExcelDilution(input) })).map(({ input, value, recovered }) => ({ input, value, recovered }));
g.excelDateName = ['4-Oct', 'Bcl-2', '12-Mar', 'Mac-3', 'Oct-4', '1-Abc', '31-Dec', 'Rsk-3'].map((input) => { const r = IHC.fixExcelDateName(input); return { input, value: r.value, recovered: r.recovered }; });
g.speciesTags = uniq([...catalog.assays.map((a) => a.species || ''), 'Hu in Rabbit', 'mouse (pdx)', 'Dog; marmoset', ''])
  .map((input) => ({ input, ...IHC.speciesTags(input) }));
g.fixativeTags = uniq([...catalog.assays.map((a) => a.fixative || ''), 'OCT', 'Formalin', 'Fresh frozen, acetone', ''])
  .map((input) => ({ input, tags: IHC.fixativeTags(input) }));
// The whole catalog, plus the cases the IHC department reported in November 2026 (fluorophores such as "anti-HRP 594",
// a fluorescent ApopTag, BOND reagents used by hand overnight) and a few more of each kind.
const extraClassify = [
  { name: 'test 11-11 11:59', kit: 'NGS, 2Ab Goat anti-Rabbit HRP, anti-HRP 594', dilution: '1:2000 ONRT' },
  { name: 'test 11-11 11:59', kit: 'Bond Polymer Reagent from kit DS9800', dilution: '1:2000 ONRT' },
  { name: 'test 11.11 12:33', kit: 'ApopTag kit anti-DIG 647', dilution: 'N/A' }, { name: 'ApopTag', kit: 'ApopTag kit', dilution: '' },
  { name: 'X', kit: 'Goat anti-rabbit 488', dilution: '1:500 60\'' }, { name: 'X', kit: 'AF647 streptavidin', dilution: '' }, { name: 'X', kit: 'CF 568', dilution: '' },
  { name: 'X', kit: 'Bond Polymer Refine', dilution: '1:500 ON 4C' }, { name: 'X', kit: 'Bond Polymer Refine', dilution: '1:100 o/n' }, { name: 'X', kit: 'Bond Polymer Refine', dilution: '1:50 ON4C' },
  { name: 'X', kit: 'Bond Polymer Refine', dilution: '1:200, on Bond' }, { name: 'X', kit: 'Bond Polymer Refine (manual)', dilution: '1:200 30\'' },
  { name: 'X', kit: 'ultraView DAB', dilution: '1:50 overnight' }, { name: '6-plex A+B+C+D+E+F', kit: 'Bond', dilution: 'ON RT' },
];
g.classify = [...protocols.map((a) => ({ name: a.name, kit: a.kit || '', dilution: a.dilution || '' })), ...extraClassify]
  .map((c) => ({ ...c, ...IHC.classify(c) }));
g.kindLabel = [['IHC', 1], ['IHC', 3], ['Opal', 1], ['Opal', 6], ['IF', 1], ['IF', 2], ['TUNEL', 1], ['β-gal', 1], ['TUNEL', 1, 'Fluorescent'], ['TUNEL', 1, 'DAB']]
  .map(([kind, plex, chromogen = null]) => ({ kind, plex, chromogen, label: IHC.kindLabel({ kind, plex, chromogen }) }));
// Platform and chromogen set by hand (applyDetection).
g.applyDetection = [['IHC', 'DAB', 'Leica Bond', '', 'Fluorescent'], ['IF', 'Fluorescent', 'Manual', 'Leica Bond', 'DAB'], ['Opal', 'Opal', 'Manual', '', 'Fluorescent'],
  ['Opal', 'Opal', 'Manual', 'Ventana', 'Red'], ['TUNEL', 'DAB', 'Manual', '', 'Fluorescent'], ['IHC', 'DAB', 'Manual', 'Robot', 'Purple'], ['IF', 'Fluorescent', 'Manual', '', '']]
  .map(([kind, chromogen, platform, platformSet, chromogenSet]) => ({ kind, chromogen, platform, platformSet, chromogenSet,
    result: (({ kind: k, plex, chromogen: c, platform: p }) => ({ kind: k, plex, chromogen: c, platform: p }))(IHC.applyDetection({ kind, plex: 1, chromogen, platform }, { platformSet, chromogenSet })) }));

// ---------- IHC: matching and pricing requests ----------
const fitRequests = [
  { species: 'Mouse', fixative: '10% NBF', sampleTypes: ['FIXED'] }, { species: 'PDX', fixative: '10% NBF', sampleTypes: ['BLOCK'] },
  { species: 'Human', fixative: 'Fresh frozen (OCT)', sampleTypes: ['FROZEN'] }, { species: 'Rat', fixative: '4% PFA', sampleTypes: ['FIXED'] },
  { species: 'Organoid', fixative: 'Other', sampleTypes: ['BLOCK'] }, { species: 'Canine', fixative: '70% ethanol', sampleTypes: ['SLIDES'] },
  { species: 'Other', fixative: 'Methanol', sampleTypes: ['FIXED', 'FROZEN'] },
];
const fitAssays = protocols.filter((_, i) => i % 9 === 0);
g.assayFit = fitAssays.flatMap((a) => fitRequests.map((r) => ({ assay: view(a), ...r, notes: IHC.assayFit(a, r) })));

const toDraft = (w) => ({
  species: w.species, fixativeUsed: w.fixativeUsed, dateIntoFixative: w.fixDate || null, importance: w.importance || 'Routine',
  hePerBlock: w.he?.on ? w.he.perBlock : 0, unstainedPerBlock: w.unstained?.on ? w.unstained.perBlock : 0,
  scan20x: !!w.scan?.x20, scan40x: !!w.scan?.x40,
  samples: w.samples.map((s) => ({ tissue: s.tissue, type: s.type })),
  stains: w.stains.map((s) => ({ assayId: s.assayId || null, newAntibody: s.newAntibody ? { name: s.newAntibody.name, supplied: !!s.newAntibody.supplied } : null })),
});
const byId = (id) => catalog.assays.find((a) => a.id === Number(id)) || null;
const find = (pred) => catalog.assays.find((a) => a.status === 'Active' && pred(a));
const synth = [
  { name: 'Mixed sample types with TUNEL, beta-gal and a triplex', w: { species: 'Mouse', fixativeUsed: '10% NBF', importance: 'STAT', he: { on: true, perBlock: 2 }, unstained: { on: true, perBlock: 3 },
    samples: [{ tissue: 'Liver', type: 'FIXED' }, { tissue: 'Spleen', type: 'BLOCK' }, { tissue: 'Kidney', type: 'SLIDES' }, { tissue: 'Brain', type: 'FROZEN' }],
    stains: [{ assayId: find((a) => a.kind === 'TUNEL').id }, { assayId: find((a) => a.kind === 'β-gal').id }, { assayId: find((a) => a.kind === 'Opal' && a.plex === 3).id }], scan: { x20: true, x40: true } } },
  { name: 'Chromogenic double stain and immunofluorescence', w: { species: 'Mouse', fixativeUsed: '10% NBF', samples: [{ tissue: 'Spleen', type: 'BLOCK' }],
    stains: [{ assayId: find((a) => a.components && a.kind === 'IHC').id }, { assayId: find((a) => !a.components && a.kind === 'IF').id }], scan: { x40: true } } },
  { name: 'Retired assay and a new antibody MHL buys', w: { species: 'Rat', fixativeUsed: '4% PFA', fixDate: '2026-10-01', samples: [{ tissue: 'Lung', type: 'FIXED' }],
    stains: [{ assayId: find((a) => a.speciesTags.includes('Human') && !a.speciesTags.includes('Rat') && a.kind === 'IHC').id }, { newAntibody: { name: 'Novel-1', supplied: false } }], scan: {} } },
];
// A fluorescent TUNEL (the ApopTag kit with an anti-DIG 647 secondary): scanned on the Akoya system, no chromogen choice.
const tunels = catalog.assays.filter((a) => a.status === 'Active' && a.kind === 'TUNEL');
const fluorTunelId = (tunels[1] || tunels[0]).id;
synth.push({ name: 'Fluorescent TUNEL scanned', w: { species: 'Mouse', fixativeUsed: '10% NBF', samples: [{ tissue: 'Testis', type: 'BLOCK' }, { tissue: 'Liver', type: 'FIXED' }],
  stains: [{ assayId: fluorTunelId }], scan: { x20: true } } });
const retiredId = g.assayFit.length ? synth[2].w.stains[0].assayId : null;
const assayFor = (id) => { const a = byId(id); return a && a.id === retiredId ? { ...a, status: 'Retired' } : a && a.id === fluorTunelId ? { ...a, chromogen: 'Fluorescent' } : a; };
const requests = [
  ...state.ihcRequests.map((w) => ({ name: `Seed ${w.number}`, w, today: w.submittedOn })),
  ...synth.map((s) => ({ name: s.name, w: { ...s.w, unstained: s.w.unstained || { on: false, perBlock: 1 }, he: s.w.he || { on: false, perBlock: 1 } }, today: TODAY })),
];
g.ihcRequests = requests.map(({ name, w, today }) => {
  const est = IHC.estimateIhc(w, assayFor);
  return {
    name, today, draft: toDraft(w),
    assays: uniq(w.stains.filter((s) => s.assayId).map((s) => s.assayId)).map((id) => view(assayFor(id))),
    lines: est.lines, assumptions: est.assumptions, blocks: est.blocks, areas: IHC.ihcAreas(w),
    warnings: IHC.requestWarnings(w, assayFor, today), summary: IHC.summarize(w, assayFor),
  };
});

// ---------- necropsy ----------
const necInput = (n) => ({
  bodyWeight: n.bodyWeight, fate: n.fate, partial: !!n.partial, matchesCageCard: !!n.matchesCageCard, perfusion: n.perfusion || '',
  extras: n.extras, organs: n.organs.map((o) => ({ organ: o.organ, weigh: !!o.weigh, weight: o.weight, notCollected: !!o.notCollected, findings: o.findings.map((f) => ({ morphology: f.morphology || '' })) })),
});
const baseNec = Object.values(state.necropsies)[0];
const variants = [
  ['Approved seed necropsy', baseNec],
  ['No body weight, not found dead', { ...baseNec, bodyWeight: null }],
  ['No body weight, found dead', { ...baseNec, bodyWeight: null, fate: 'Found dead' }],
  ['Partial necropsy skips weights', { ...baseNec, partial: true, bodyWeight: null, organs: baseNec.organs.map((o) => ({ ...o, weight: null })) }],
  ['Unweighed organs and an incomplete finding', { ...baseNec, matchesCageCard: false, organs: baseNec.organs.map((o, i) => ({ ...o, weight: i < 2 ? null : o.weight, notCollected: i === 1, findings: i === 3 ? [{ morphology: '' }] : o.findings })) }],
  ['Perfusion and every procedure', { ...baseNec, perfusion: 'lung', extras: { terminalBleed: true, bloodCollection: true, boneMarrowSmear: true, biohazard: true, snapFreezeTubes: 3, bloodSmearPairs: 2 } }],
];
g.necropsy = variants.map(([name, n]) => ({ name, protocolWeighsAnimal: true, necropsy: necInput(n), problems: NEC.approvalProblems(n, { bodyWeight: true }), charges: NEC.approvalCharges(n) }));
g.necropsy.push({ name: 'Protocol does not weigh the animal', protocolWeighsAnimal: false, necropsy: necInput({ ...baseNec, bodyWeight: null }), problems: NEC.approvalProblems({ ...baseNec, bodyWeight: null }, { bodyWeight: false }), charges: NEC.approvalCharges({ ...baseNec, bodyWeight: null }) });

// ---------- pathology ----------
const dxs = [
  { term: 'Vacuolation, hepatocellular', modifier: 'centrilobular', distribution: 'Diffuse', severity: '2' },
  { term: 'Adenoma, bronchiolo-alveolar', neoplasm: true, behavior: 'Benign', laterality: 'Left' },
  { term: 'Neoplasm, metastatic', neoplasm: true, behavior: 'Malignant', origin: 'Metastatic' },
  { term: 'Cyst', severity: 'P' }, { term: 'Inflammation', severity: '' }, { term: 'Carcinoma', neoplasm: true, behavior: '' },
  { term: 'Fibrosis', distribution: 'Focally extensive', laterality: 'Bilateral', severity: '5' },
  { term: 'Lymphoma, malignant', neoplasm: true, behavior: 'Uncertain', origin: 'Primary' },
];
g.dxText = dxs.map((dx) => ({ dx: { neoplasm: false, modifier: '', distribution: '', laterality: '', severity: '', behavior: '', origin: '', ...dx }, text: PATH.dxText(dx), mark: PATH.dxMark(dx) }));
g.diagnosesFor = ['Liver', 'Tumor', 'Kidneys', 'Other'].map((organ) => ({ organ, terms: PATH.diagnosesFor(organ).map((x) => x.term) }));

const caseOut = (c) => ({
  tissues: c.tissues.map((t) => ({ organ: t.organ, block: t.block == null ? null : String(t.block), result: t.result,
    diagnoses: t.diagnoses.map((x) => ({ id: x.id, term: x.term, neoplasm: !!x.neoplasm, modifier: x.modifier || '', distribution: x.distribution || '', laterality: x.laterality || '', severity: x.severity || '', behavior: x.behavior || '', origin: x.origin || '', correlates: x.correlates || [] })) })),
  grossNoCorrelate: Object.keys(c.grossNoCorrelate || {}).filter((k) => c.grossNoCorrelate[k] === true).map(Number),
  causeOfDeathKind: c.causeOfDeath?.kind || '', causeOfDeathDxId: c.causeOfDeath?.dxId || null, extraQuarterHours: c.extraQuarterHours || 0, extraTimeNote: c.extraTimeNote || '',
});
const grossOf = (sid) => { const n = state.necropsies[sid]; return n?.status === 'APPROVED' ? n.organs.flatMap((o) => o.findings.map((f) => ({ id: f.id, organ: o.organ }))) : []; };
const seedCases = Object.entries(state.pathology).map(([sid, c]) => ({ name: `Seed case ${state.subjects.find((s) => s.id === Number(sid)).phl}`, c, gross: grossOf(Number(sid)), needCod: false }));
const one = seedCases[0];
const crafted = [
  { name: 'Empty case', c: { tissues: [], grossNoCorrelate: {}, causeOfDeath: { kind: '' } }, gross: [], needCod: true },
  { name: 'Every problem at once', c: { tissues: [
    { organ: 'Lungs', block: '2', result: 'LESIONS', diagnoses: [{ id: 'a', term: 'Hyperplasia, bronchiolo-alveolar', severity: '' }] },
    { organ: 'Heart', block: '2', result: 'NSL', diagnoses: [] }, { organ: 'Liver', block: '3', result: 'PENDING', diagnoses: [] },
    { organ: 'Spleen', block: '4', result: 'LESIONS', diagnoses: [] },
    { organ: 'Tumor', block: null, result: 'LESIONS', diagnoses: [{ id: 'b', term: 'Carcinoma', neoplasm: true, behavior: '' }, { id: 'c', term: '' }] } ],
    grossNoCorrelate: {}, causeOfDeath: { kind: 'DIAGNOSIS', dxId: null }, extraQuarterHours: 2, extraTimeNote: '' }, gross: [{ id: 7, organ: 'Liver' }, { id: 8, organ: 'Spleen' }], needCod: true },
  { name: 'Seed case with its gross correlation removed', c: { ...one.c, tissues: one.c.tissues.map((t) => ({ ...t, diagnoses: t.diagnoses.map((x) => ({ ...x, correlates: [] })) })), grossNoCorrelate: {} }, gross: one.gross, needCod: false },
];
g.pathologyCases = [...seedCases, ...crafted].map(({ name, c, gross, needCod }) => ({
  name, case: caseOut(c), grossFindings: gross, needCauseOfDeath: needCod,
  slides: PATH.slidesRead(c), problems: PATH.signOutProblems(c, { grossFindings: gross, needCauseOfDeath: needCod }),
}));
g.signOutCharges = [
  { slides: 3 }, { slides: 1 }, { slides: 0 }, { slides: 4, billedSlides: 3, version: 2 }, { slides: 3, billedSlides: 3, version: 2 },
  { slides: 2, extraQuarterHours: 2, extraTimeNote: 'Review of outside slides' }, { slides: 2, extraQuarterHours: 3, extraTimeNote: 'More', billedSlides: 2, billedQuarterHours: 2, version: 3 },
].map((x) => ({ slides: x.slides, extraQuarterHours: x.extraQuarterHours || 0, extraTimeNote: x.extraTimeNote || '', billedSlides: x.billedSlides || 0, billedQuarterHours: x.billedQuarterHours || 0, version: x.version || 1, charges: PATH.signOutCharges(x) }));

// Summary over the seed: ZAP2215 groups, and Haddad's submitted slides as one group.
const summaryFor = (subjects, keyOf, groupKeys) => {
  const signed = subjects.filter((s) => state.pathology[s.id]?.status === 'SIGNED').map((s) => ({ subject: s, groupKey: keyOf(s), c: state.pathology[s.id] }));
  const r = PATH.summarizePathology(signed, groupKeys);
  return {
    cases: signed.map(({ subject, groupKey, c }) => ({ subjectId: subject.id, phl: subject.phl, label: subject.label, groupKey, sex: subject.sex || '', case: caseOut(c) })),
    groupKeys, incidence: r.incidence, neoplasms: r.neoplasms, examined: r.examined,
    animals: r.animals, tabulated: r.tabulated, notRead: r.notRead,
  };
};
const zap = state.studies.find((s) => s.zap === 'ZAP2215');
const had = state.requests.find((r) => r.pi.last === 'Haddad');
g.pathologySummaries = [
  { name: 'ZAP2215 by group', ...summaryFor(state.subjects.filter((s) => s.studyId === zap.id).sort((a, b) => a.phl.localeCompare(b.phl)), (s) => s.groupCode || '(none)', ['G1', 'G2', 'G3']) },
  { name: 'Submitted slides, one group', ...summaryFor(state.subjects.filter((s) => s.requestId === had.id).sort((a, b) => a.phl.localeCompare(b.phl)), () => 'All', ['All']) },
];
g.counts = Object.fromEntries(Object.entries(g).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, v.length]));

mkdirSync(path.join(here, 'golden'), { recursive: true });
const out = path.join(here, 'golden', 'ihc-pathology-golden.json');
writeFileSync(out, JSON.stringify(g, null, 1) + '\n');
console.log(`Wrote ${out}`);
console.log(g.counts);
