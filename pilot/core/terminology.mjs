// Standard toxicologic pathology terminology for the pilot's pathology library.
//
// INHAND (International Harmonization of Nomenclature and Diagnostic Criteria) publishes the preferred lesion
// names for rats and mice, one guide per organ system; goRENI (goreni.org) is the online version. CDISC SEND
// controlled terminology (published free by NCI EVS) turns those names into submission values: specimens (SPEC),
// non-neoplastic findings (NONNEO), neoplasms (NEOPLASM), severity (SEV), laterality (LAT) and others.
//
// The SEND values below are the pilot's best mapping and are marked unverified. Importing the official
// "SEND Terminology.txt" file from NCI EVS checks every mapping, adds the NCI codes, and flags anything that
// does not match exactly. Used by the core and by the browser (/lib/terminology.mjs).

import { DIAGNOSES, ORGANS, PAIRED } from './pathology.mjs';

export const INHAND_SYSTEMS = [
  { key: 'respiratory', name: 'Respiratory system', guide: 'Renne et al., 2009' },
  { key: 'hepatobiliary', name: 'Hepatobiliary system', guide: 'Thoolen et al., 2010' },
  { key: 'urinary', name: 'Urinary system', guide: 'Frazier et al., 2012' },
  { key: 'male', name: 'Male reproductive system', guide: 'Creasy et al., 2012' },
  { key: 'nervous', name: 'Central and peripheral nervous system', guide: 'Kaufmann et al., 2012' },
  { key: 'integument', name: 'Integument and mammary gland', guide: 'Mecklenburg et al., 2013' },
  { key: 'soft', name: 'Soft tissue, skeletal muscle and mesothelium', guide: 'Greaves et al., 2013' },
  { key: 'female', name: 'Female reproductive system', guide: 'Dixon et al., 2014' },
  { key: 'digestive', name: 'Digestive system', guide: 'Nolte et al., 2016' },
  { key: 'cardiovascular', name: 'Cardiovascular system', guide: 'Berridge et al., 2016' },
  { key: 'skeletal', name: 'Skeletal tissues (bones, joints, teeth)', guide: 'Fossey et al., 2016' },
  { key: 'endocrine', name: 'Endocrine system', guide: 'Brändli-Baiocco et al., 2018' },
  { key: 'senses', name: 'Special senses', guide: 'Ramos et al., 2018' },
  { key: 'hematolymphoid', name: 'Hematolymphoid system', guide: 'Willard-Mack et al., 2019' },
  { key: 'general', name: 'Any tissue', guide: '' },
];
export const systemName = (key) => INHAND_SYSTEMS.find((s) => s.key === key)?.name || 'Any tissue';

// Pilot organ name -> [INHAND system, SEND specimen (unverified), sex (N, M or F)].
const O = (system, spec, sex = 'N') => ({ system, spec, sex });
export const ORGAN_TERMS = {
  'Brain': O('nervous', 'BRAIN'), 'Spinal cord': O('nervous', 'SPINAL CORD'), 'Nerve, sciatic': O('nervous', 'NERVE, SCIATIC'),
  'Pituitary gland': O('endocrine', 'GLAND, PITUITARY'), 'Thyroid glands': O('endocrine', 'GLAND, THYROID'),
  'Parathyroid glands': O('endocrine', 'GLAND, PARATHYROID'), 'Adrenal glands': O('endocrine', 'GLAND, ADRENAL'),
  'Eyes': O('senses', 'EYE'), 'Harderian glands': O('senses', 'GLAND, HARDERIAN'), "Zymbal's glands": O('senses', "GLAND, ZYMBAL'S"),
  'Nasal cavity': O('respiratory', 'NASAL CAVITY'), 'Larynx': O('respiratory', 'LARYNX'), 'Trachea': O('respiratory', 'TRACHEA'), 'Lungs': O('respiratory', 'LUNG'),
  'Heart': O('cardiovascular', 'HEART'), 'Aorta': O('cardiovascular', 'AORTA'),
  'Thymus': O('hematolymphoid', 'THYMUS'), 'Lymph nodes': O('hematolymphoid', 'LYMPH NODE'), 'Lymph node, mandibular': O('hematolymphoid', 'LYMPH NODE, MANDIBULAR'),
  'Lymph node, mesenteric': O('hematolymphoid', 'LYMPH NODE, MESENTERIC'), 'Spleen': O('hematolymphoid', 'SPLEEN'),
  'Femur and bone marrow': O('hematolymphoid', 'BONE MARROW, FEMUR'), 'Sternum': O('skeletal', 'BONE, STERNUM'), 'Bone, femur': O('skeletal', 'BONE, FEMUR'),
  'Liver': O('hepatobiliary', 'LIVER'), 'Gallbladder': O('hepatobiliary', 'GALLBLADDER'),
  'Tongue': O('digestive', 'TONGUE'), 'Salivary glands': O('digestive', 'GLAND, SALIVARY'), 'Esophagus': O('digestive', 'ESOPHAGUS'),
  'Stomach': O('digestive', 'STOMACH'), 'Small intestine': O('digestive', 'SMALL INTESTINE'), 'Duodenum': O('digestive', 'DUODENUM'),
  'Jejunum': O('digestive', 'JEJUNUM'), 'Ileum': O('digestive', 'ILEUM'), 'Cecum': O('digestive', 'CECUM'), 'Large intestine': O('digestive', 'LARGE INTESTINE'),
  'Colon': O('digestive', 'COLON'), 'Rectum': O('digestive', 'RECTUM'), 'Pancreas': O('digestive', 'PANCREAS'), 'Mesentery': O('soft', 'MESENTERY'),
  'Kidneys': O('urinary', 'KIDNEY'), 'Ureters': O('urinary', 'URETER'), 'Urinary bladder': O('urinary', 'URINARY BLADDER'), 'Urethra': O('urinary', 'URETHRA'),
  'Skin': O('integument', 'SKIN'), 'Subcutis': O('integument', 'SUBCUTIS'), 'Mammary gland': O('integument', 'GLAND, MAMMARY'),
  'Skeletal muscle': O('soft', 'MUSCLE, SKELETAL'),
  'Testes': O('male', 'TESTIS', 'M'), 'Epididymides': O('male', 'EPIDIDYMIS', 'M'), 'Prostate': O('male', 'GLAND, PROSTATE', 'M'),
  'Seminal vesicles': O('male', 'GLAND, SEMINAL VESICLE', 'M'), 'Coagulating glands': O('male', 'GLAND, COAGULATING', 'M'), 'Preputial glands': O('male', 'GLAND, PREPUTIAL', 'M'),
  'Ovaries': O('female', 'OVARY', 'F'), 'Oviducts': O('female', 'OVIDUCT', 'F'), 'Uterus': O('female', 'UTERUS', 'F'), 'Cervix': O('female', 'CERVIX', 'F'),
  'Vagina': O('female', 'VAGINA', 'F'), 'Clitoral glands': O('female', 'GLAND, CLITORAL', 'F'),
  'Reproductive tract': O('general', ''), 'Tumor': O('general', ''), 'Other': O('general', ''),
};
// Organs the starter library adds to pathology.mjs's list, in display order.
export const ADDED_ORGANS = ['Larynx', 'Tongue', 'Duodenum', 'Jejunum', 'Ileum', 'Colon', 'Rectum', 'Lymph node, mandibular', 'Lymph node, mesenteric',
  'Nerve, sciatic', 'Bone, femur', 'Subcutis', 'Mesentery', 'Ureters', 'Urethra', 'Coagulating glands', 'Preputial glands', 'Oviducts', 'Cervix', 'Clitoral glands', "Zymbal's glands"];
const ADDED_PAIRED = new Set(['Lymph node, mandibular', 'Nerve, sciatic', 'Bone, femur', 'Ureters', 'Coagulating glands', 'Preputial glands', 'Oviducts', 'Clitoral glands', "Zymbal's glands"]);

// More INHAND-style lesion names, by system, added to the starter list in pathology.mjs (which the C# code mirrors).
const t = (term, organs, system, neoplasm = false) => ({ term, organs, system, neoplasm });
const ANY = ['*'];
export const INHAND_ADDITIONS = [
  t('Apoptosis', ANY, 'general'), t('Amyloid', ANY, 'general'), t('Granuloma', ANY, 'general'), t('Hypertrophy', ANY, 'general'), t('Metaplasia, osseous', ANY, 'general'),
  t('Polyarteritis', ANY, 'cardiovascular'), t('Fibrosarcoma', ANY, 'soft', true), t('Lipoma', ['Subcutis', 'Mesentery', 'Tumor'], 'soft', true),
  t('Leiomyosarcoma', ANY, 'soft', true), t('Mesothelioma', ['Mesentery', 'Tumor', 'Testes'], 'soft', true), t('Leukemia, granulocytic', ANY, 'hematolymphoid', true),
  // respiratory
  t('Metaplasia, squamous cell', ['Nasal cavity', 'Larynx', 'Trachea', 'Lungs'], 'respiratory'), t('Degeneration, olfactory epithelium', ['Nasal cavity'], 'respiratory'),
  t('Hyperplasia, goblet cell', ['Nasal cavity', 'Trachea'], 'respiratory'), t('Exudate', ['Nasal cavity'], 'respiratory'),
  t('Crystals, eosinophilic', ['Lungs', 'Nasal cavity'], 'respiratory'), t('Metaplasia, bronchiolar', ['Lungs'], 'respiratory'),
  // hepatobiliary
  t('Necrosis, single cell', ['Liver'], 'hepatobiliary'), t('Hyperplasia, bile duct', ['Liver'], 'hepatobiliary'), t('Cholangiofibrosis', ['Liver'], 'hepatobiliary'),
  t('Karyomegaly', ['Liver', 'Kidneys'], 'hepatobiliary'), t('Mitotic figures, increased', ['Liver'], 'hepatobiliary'),
  t('Focus of cellular alteration, mixed cell', ['Liver'], 'hepatobiliary'), t('Pigment, Kupffer cell', ['Liver'], 'hepatobiliary'),
  t('Cholangioma', ['Liver'], 'hepatobiliary', true),
  // urinary
  t('Degeneration, tubular', ['Kidneys'], 'urinary'), t('Regeneration, tubular', ['Kidneys'], 'urinary'), t('Necrosis, tubular', ['Kidneys'], 'urinary'),
  t('Pigment, tubular', ['Kidneys'], 'urinary'), t('Accumulation, hyaline droplet', ['Kidneys'], 'urinary'), t('Pyelonephritis', ['Kidneys'], 'urinary'),
  t('Glomerulonephritis', ['Kidneys'], 'urinary'), t('Calculus', ['Kidneys', 'Urinary bladder'], 'urinary'), t('Papilloma, urothelial', ['Urinary bladder'], 'urinary', true),
  // hematolymphoid
  t('Increased cellularity, lymphocytes', ['Spleen', 'Lymph nodes', 'Lymph node, mandibular', 'Lymph node, mesenteric', 'Thymus'], 'hematolymphoid'),
  t('Decreased cellularity, lymphocytes', ['Spleen', 'Lymph nodes', 'Lymph node, mandibular', 'Lymph node, mesenteric', 'Thymus'], 'hematolymphoid'),
  t('Increased cellularity, germinal center', ['Spleen', 'Lymph nodes', 'Lymph node, mandibular', 'Lymph node, mesenteric'], 'hematolymphoid'),
  t('Increased cellularity, megakaryocytes', ['Spleen', 'Femur and bone marrow', 'Sternum'], 'hematolymphoid'),
  // cardiovascular
  t('Necrosis, cardiomyocyte', ['Heart'], 'cardiovascular'), t('Hypertrophy, cardiomyocyte', ['Heart'], 'cardiovascular'), t('Vacuolation, cardiomyocyte', ['Heart'], 'cardiovascular'),
  // digestive
  t('Atrophy, glandular', ['Stomach'], 'digestive'), t('Dilation, gland', ['Stomach', 'Small intestine', 'Large intestine', 'Colon'], 'digestive'),
  t('Hyperplasia, crypt', ['Small intestine', 'Duodenum', 'Jejunum', 'Ileum', 'Large intestine', 'Colon', 'Cecum'], 'digestive'),
  t('Atrophy, villous', ['Small intestine', 'Duodenum', 'Jejunum', 'Ileum'], 'digestive'), t('Vacuolation, acinar cell', ['Pancreas'], 'digestive'),
  t('Adenoma, acinar cell', ['Pancreas'], 'digestive', true), t('Carcinoma, islet cell', ['Pancreas'], 'endocrine', true),
  // endocrine
  t('Hyperplasia, follicular cell', ['Thyroid glands'], 'endocrine'), t('Hypertrophy, follicular cell', ['Thyroid glands'], 'endocrine'),
  t('Cyst, ultimobranchial', ['Thyroid glands'], 'endocrine'), t('Hyperplasia, C-cell', ['Thyroid glands'], 'endocrine'),
  t('Carcinoma, follicular cell', ['Thyroid glands'], 'endocrine', true), t('Adenoma, C-cell', ['Thyroid glands'], 'endocrine', true),
  t('Hyperplasia, pars distalis', ['Pituitary gland'], 'endocrine'), t('Adenoma, pars distalis', ['Pituitary gland'], 'endocrine', true),
  t('Adenoma, pars intermedia', ['Pituitary gland'], 'endocrine', true), t('Hypertrophy, cortical', ['Adrenal glands'], 'endocrine'),
  t('Hyperplasia, medullary', ['Adrenal glands'], 'endocrine'), t('Carcinoma, cortical', ['Adrenal glands'], 'endocrine', true),
  // male reproductive
  t('Giant cells, multinucleated', ['Testes'], 'male'), t('Retention, spermatid', ['Testes'], 'male'), t('Hyperplasia, interstitial cell', ['Testes'], 'male'),
  t('Adenoma, Leydig cell', ['Testes'], 'male', true), t('Cell debris, luminal', ['Epididymides'], 'male'), t('Granuloma, sperm', ['Epididymides'], 'male'),
  t('Aspermia', ['Epididymides'], 'male'),
  // female reproductive
  t('Cyst, follicle', ['Ovaries'], 'female'), t('Dilation, luminal', ['Uterus'], 'female'), t('Mucification', ['Vagina'], 'female'),
  t('Cystadenoma', ['Ovaries'], 'female', true), t('Adenoma, tubulostromal', ['Ovaries'], 'female', true), t('Teratoma', ['Ovaries'], 'female', true),
  t('Polyp, endometrial stromal', ['Uterus'], 'female', true), t('Sarcoma, endometrial stromal', ['Uterus'], 'female', true),
  t('Leiomyoma', ['Uterus', 'Cervix', 'Vagina'], 'female', true), t('Fibroadenoma', ['Mammary gland'], 'integument', true),
  // nervous
  t('Necrosis, neuronal', ['Brain', 'Spinal cord'], 'nervous'), t('Degeneration, axonal', ['Brain', 'Spinal cord', 'Nerve, sciatic'], 'nervous'),
  t('Demyelination', ['Brain', 'Spinal cord', 'Nerve, sciatic'], 'nervous'), t('Malacia', ['Brain', 'Spinal cord'], 'nervous'),
  t('Astrocytoma, malignant', ['Brain', 'Spinal cord'], 'nervous', true), t('Meningioma, benign', ['Brain', 'Spinal cord'], 'nervous', true),
  t('Oligodendroglioma, malignant', ['Brain'], 'nervous', true),
  // integument
  t('Acanthosis', ['Skin'], 'integument'), t('Hyperplasia, sebaceous gland', ['Skin'], 'integument'), t('Alopecia', ['Skin'], 'integument'),
  t('Keratoacanthoma', ['Skin'], 'integument', true), t('Fibroma', ['Skin', 'Subcutis'], 'integument', true),
  // musculoskeletal
  t('Necrosis, myofiber', ['Skeletal muscle'], 'soft'), t('Atrophy, myofiber', ['Skeletal muscle'], 'soft'),
  t('Rhabdomyosarcoma', ['Skeletal muscle', 'Tumor'], 'soft', true), t('Fibro-osseous lesion', ['Femur and bone marrow', 'Sternum', 'Bone, femur'], 'skeletal'),
  t('Osteoma', ['Femur and bone marrow', 'Sternum', 'Bone, femur'], 'skeletal', true),
  // special senses
  t('Cataract', ['Eyes'], 'senses'), t('Degeneration, retinal', ['Eyes'], 'senses'), t('Mineralization, corneal', ['Eyes'], 'senses'),
  t('Adenocarcinoma, Harderian gland', ['Harderian glands'], 'senses', true),
];

// System for each starter term in pathology.mjs: from the term's own organs, or "general" for any-tissue terms.
function systemFor(entry) {
  if (entry.system) return entry.system;
  if (entry.organs[0] === '*') return 'general';
  return ORGAN_TERMS[entry.organs[0]]?.system || 'general';
}

export const sendList = (neoplasm) => (neoplasm ? 'NEOPLASM' : 'NONNEO');
// The pilot's guess at the SEND submission value: the INHAND term in capitals.
export const guessSendTerm = (term) => String(term || '').toUpperCase().trim();

// The library the pilot starts with: pathology.mjs's starter list plus the INHAND additions, each with its
// INHAND system and an unverified SEND mapping.
export function starterLibrary() {
  const organs = [...ORGANS.filter((o) => !['Reproductive tract', 'Tumor', 'Other'].includes(o)), ...ADDED_ORGANS, 'Reproductive tract', 'Tumor', 'Other'].map((name) => {
    const m = ORGAN_TERMS[name] || O('general', '');
    return { name, paired: PAIRED.has(name) || ADDED_PAIRED.has(name), sex: m.sex, system: m.system, send: { spec: m.spec, code: '', verified: false }, active: true, source: 'starter' };
  });
  const seen = new Set();
  const diagnoses = [...DIAGNOSES.map((d) => ({ ...d, source: 'starter' })), ...INHAND_ADDITIONS.map((d) => ({ ...d, source: 'inhand' }))]
    .filter((d) => { const k = d.term.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .map((d) => ({ term: d.term, organs: [...d.organs], neoplasm: !!d.neoplasm, system: systemFor(d), active: true, source: d.source,
      send: { list: sendList(d.neoplasm), term: guessSendTerm(d.term), code: '', verified: false } }));
  return { source: 'Pilot starter list (INHAND style)', updatedAt: null, organs, diagnoses };
}

// ---------- SEND controlled terminology (NCI EVS "SEND Terminology.txt") ----------
// Tab-delimited, one row per codelist and per term: Code, Codelist Code, Codelist Extensible (Yes/No), Codelist Name,
// CDISC Submission Value, CDISC Synonym(s), CDISC Definition, NCI Preferred Term. Codelist rows have no Codelist Code.
export const SEND_LISTS = ['SPEC', 'NONNEO', 'NEOPLASM', 'SEV', 'LAT', 'DIR', 'LBTESTCD', 'UNIT'];

export function parseEvsTerminology(text, wanted = SEND_LISTS) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('The file is empty.');
  const header = lines[0].split('\t').map((h) => h.trim().toLowerCase());
  const col = (name) => header.findIndex((h) => h === name || h.startsWith(name));
  const idx = { code: col('code'), list: col('codelist code'), ext: col('codelist extensible'), listName: col('codelist name'), value: col('cdisc submission value'),
    syn: col('cdisc synonym'), def: col('cdisc definition'), pt: col('nci preferred term') };
  if (idx.code < 0 || idx.list < 0 || idx.value < 0) throw new Error('This does not look like an NCI EVS terminology file: it needs the Code, Codelist Code and CDISC Submission Value columns.');
  const rows = lines.slice(1).map((l) => l.split('\t').map((c) => c.trim().replace(/^"(.*)"$/, '$1')));
  const lists = new Map();
  for (const r of rows) if (!r[idx.list]) lists.set(r[idx.code], { code: r[idx.code], short: r[idx.value], name: r[idx.listName] || '', extensible: /^y/i.test(r[idx.ext] || ''), terms: [] });
  for (const r of rows) {
    if (!r[idx.list]) continue;
    const list = lists.get(r[idx.list]);
    if (list) list.terms.push({ code: r[idx.code], value: r[idx.value], synonyms: (r[idx.syn] || '').split(';').map((s) => s.trim()).filter(Boolean), definition: idx.def >= 0 ? (r[idx.def] || '').slice(0, 400) : '', preferred: idx.pt >= 0 ? r[idx.pt] || '' : '' });
  }
  const codelists = {};
  for (const l of lists.values()) if (wanted.includes(l.short)) codelists[l.short] = l;
  return { codelists, totalCodelists: lists.size, terms: Object.values(codelists).reduce((n, l) => n + l.terms.length, 0) };
}

const norm = (s) => String(s || '').toUpperCase().replace(/[‐-–—]/g, '-').replace(/[^A-Z0-9,'/ -]/g, '').replace(/-/g, '').replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();

// Finds a term in a SEND codelist: exact value, then the same value ignoring hyphens and punctuation, then synonyms.
export function findSendTerm(codelist, value) {
  if (!codelist || !value) return null;
  const want = norm(value);
  return codelist.terms.find((x) => x.value.toUpperCase() === String(value).toUpperCase())
    || codelist.terms.find((x) => norm(x.value) === want)
    || codelist.terms.find((x) => x.synonyms.some((s) => norm(s) === want)) || null;
}

export function searchSend(codelist, q, limit = 25) {
  const words = norm(q).split(' ').filter(Boolean);
  if (!codelist || !words.length) return [];
  return codelist.terms.filter((x) => words.every((w) => norm(`${x.value} ${x.synonyms.join(' ')}`).includes(w)))
    .sort((a, b) => a.value.length - b.value.length || a.value.localeCompare(b.value)).slice(0, limit);
}

// Checks every organ and diagnosis in the library against imported SEND codelists. Neoplasms are also tried with the
// behavior appended, because some SEND neoplasm values carry it. Returns the updated library and a count.
export function verifyLibrary(library, codelists) {
  let verified = 0; let unmatched = 0;
  const organs = library.organs.map((o) => {
    if (!o.send?.spec) return { ...o, send: { ...o.send, code: '', verified: false } };
    const hit = findSendTerm(codelists.SPEC, o.send.spec);
    hit ? verified++ : unmatched++;
    return { ...o, send: { spec: hit ? hit.value : o.send.spec, code: hit?.code || '', verified: !!hit } };
  });
  const diagnoses = library.diagnoses.map((d) => {
    const listKey = d.send?.list || sendList(d.neoplasm);
    const list = codelists[listKey];
    const base = String(d.send?.term || guessSendTerm(d.term)).replace(/, (BENIGN|MALIGNANT)$/, '');
    // Some SEND neoplasm values carry the behavior ("..., BENIGN" and "..., MALIGNANT"). Then the value depends on the
    // behavior the pathologist records, so both are kept and miRow picks one.
    const exact = findSendTerm(list, base);
    const byBehavior = d.neoplasm ? Object.fromEntries(['BENIGN', 'MALIGNANT'].map((b) => [b, findSendTerm(list, `${base}, ${b}`)]).filter(([, hit]) => hit)
      .map(([b, hit]) => [b, { term: hit.value, code: hit.code }])) : {};
    const only = !exact && Object.keys(byBehavior).length === 1 ? Object.values(byBehavior)[0] : null;
    const ok = !!(exact || Object.keys(byBehavior).length);
    ok ? verified++ : unmatched++;
    return { ...d, send: { list: listKey, term: exact ? exact.value : only ? only.term : base, code: exact?.code || only?.code || '', verified: ok,
      ...(Object.keys(byBehavior).length ? { byBehavior } : {}) } };
  });
  return { library: { ...library, organs, diagnoses }, verified, unmatched };
}

// ---------- coding a diagnosis ----------
export const SEV_SEND = { 1: 'MINIMAL', 2: 'MILD', 3: 'MODERATE', 4: 'MARKED', 5: 'SEVERE' };
export const LAT_SEND = { Left: 'LEFT', Right: 'RIGHT', Bilateral: 'BILATERAL', Unilateral: 'UNILATERAL' };

// One SEND-style microscopic-findings row for a diagnosis (not a validated SEND dataset).
export function miRow({ organ, dx, library }) {
  const o = library.organs.find((x) => x.name === organ);
  const term = library.diagnoses.find((x) => x.term.toLowerCase() === String(dx.term || '').toLowerCase());
  const byB = term?.send?.byBehavior?.[String(dx.behavior || '').toUpperCase()];
  return {
    MISPEC: o?.send?.spec || String(organ || '').toUpperCase(),
    MIORRES: dx.text || dx.term,
    MISTRESC: byB?.term || term?.send?.term || guessSendTerm(dx.term),
    MIRESCAT: dx.neoplasm ? (dx.behavior || '').toUpperCase() : 'NON-NEOPLASTIC',
    MISEV: SEV_SEND[dx.severity] || '',
    MILAT: LAT_SEND[dx.laterality] || '',
    MIDISTR: (dx.distribution || '').toUpperCase(),
    CODED: term?.send?.verified && (byB || !term.send.byBehavior || term.send.code) ? 'Yes' : 'No',
  };
}
