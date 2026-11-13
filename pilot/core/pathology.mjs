// Pathology rules for the pilot: dictionaries, how a diagnosis reads, what must be done before sign-out,
// how many slides were read, and the study summaries (incidence, severity, neoplasms, individual animal table).
//
// Modeled on Zaphod's pathology tables (tblPathologyHeaders, tblPathologyOrgans, tblPathologyDiagnoses with
// severity, distribution, neoplasm and paired-organ fields, tblPathologyCorrelation for gross-to-micro correlation).
// The diagnosis list is a starter set in INHAND style; replace it with Zaphod's tblDiagnosis during migration.
// Used by the core and by the browser (/lib/pathology.mjs).

export const RESULTS = [
  ['PENDING', 'Not read yet'], ['NSL', 'No significant lesions'], ['LESIONS', 'Lesions'],
  ['NOT_EXAMINED', 'Not examined'], ['NOT_PRESENT', 'Tissue not present'],
];
export const SEVERITY = [['1', 'Minimal'], ['2', 'Mild'], ['3', 'Moderate'], ['4', 'Marked'], ['5', 'Severe'], ['P', 'Present (not graded)']];
export const DISTRIBUTION = ['Focal', 'Multifocal', 'Focally extensive', 'Diffuse'];
export const LATERALITY = ['Left', 'Right', 'Bilateral', 'Unilateral'];
export const BEHAVIOR = ['Benign', 'Malignant', 'Uncertain'];
export const ORIGIN = ['Primary', 'Metastatic'];

export const ORGANS = [
  'Brain', 'Spinal cord', 'Pituitary gland', 'Eyes', 'Harderian glands', 'Nasal cavity', 'Salivary glands', 'Thyroid glands', 'Parathyroid glands',
  'Trachea', 'Esophagus', 'Lungs', 'Heart', 'Aorta', 'Thymus', 'Lymph nodes', 'Spleen', 'Liver', 'Gallbladder', 'Pancreas', 'Stomach',
  'Small intestine', 'Cecum', 'Large intestine', 'Kidneys', 'Adrenal glands', 'Urinary bladder', 'Skin', 'Mammary gland', 'Skeletal muscle',
  'Femur and bone marrow', 'Sternum', 'Testes', 'Epididymides', 'Prostate', 'Seminal vesicles', 'Ovaries', 'Uterus', 'Vagina',
  'Reproductive tract', 'Tumor', 'Other',
];
export const PAIRED = new Set(['Eyes', 'Harderian glands', 'Salivary glands', 'Thyroid glands', 'Parathyroid glands', 'Lungs', 'Kidneys', 'Adrenal glands',
  'Mammary gland', 'Femur and bone marrow', 'Testes', 'Epididymides', 'Ovaries', 'Seminal vesicles']);

// term, organs ('*' = any tissue), neoplasm. Organ-specific terms are offered first for that organ.
const d = (term, organs, neoplasm = false) => ({ term, organs, neoplasm });
const ANY = ['*'];
export const DIAGNOSES = [
  // general, any tissue
  d('Inflammation', ANY), d('Inflammation, acute', ANY), d('Inflammation, chronic', ANY), d('Inflammation, granulomatous', ANY),
  d('Infiltrate, mononuclear cell', ANY), d('Infiltrate, neutrophilic', ANY), d('Necrosis', ANY), d('Hemorrhage', ANY), d('Fibrosis', ANY),
  d('Mineralization', ANY), d('Edema', ANY), d('Congestion', ANY), d('Thrombus', ANY), d('Atrophy', ANY), d('Hyperplasia', ANY),
  d('Degeneration', ANY), d('Cyst', ANY), d('Abscess', ANY), d('Pigment', ANY), d('Autolysis', ANY), d('Angiectasis', ANY),
  d('Lymphoma, malignant', ANY, true), d('Histiocytic sarcoma', ANY, true), d('Hemangiosarcoma', ANY, true), d('Hemangioma', ANY, true),
  d('Leukemia', ANY, true), d('Neoplasm, metastatic', ANY, true),
  // organ-specific
  d('Hyperplasia, bronchiolo-alveolar', ['Lungs']), d('Adenoma, bronchiolo-alveolar', ['Lungs'], true), d('Carcinoma, bronchiolo-alveolar', ['Lungs'], true),
  d('Accumulation, alveolar macrophage', ['Lungs']), d('Infiltrate, perivascular, mononuclear cell', ['Lungs']), d('Hemorrhage, alveolar', ['Lungs']),
  d('Vacuolation, hepatocellular', ['Liver']), d('Hypertrophy, hepatocellular', ['Liver']), d('Hematopoiesis, extramedullary', ['Liver', 'Spleen']),
  d('Necrosis, hepatocellular', ['Liver']), d('Focus of cellular alteration, basophilic', ['Liver']), d('Focus of cellular alteration, eosinophilic', ['Liver']),
  d('Focus of cellular alteration, clear cell', ['Liver']), d('Adenoma, hepatocellular', ['Liver'], true), d('Carcinoma, hepatocellular', ['Liver'], true),
  d('Hepatoblastoma', ['Liver'], true), d('Cholangiocarcinoma', ['Liver'], true),
  d('Hematopoiesis, extramedullary, increased', ['Spleen']), d('Hyperplasia, lymphoid', ['Spleen', 'Lymph nodes', 'Thymus']),
  d('Depletion, lymphoid', ['Spleen', 'Lymph nodes', 'Thymus']), d('Pigment, hemosiderin', ['Spleen', 'Liver', 'Lungs']),
  d('Nephropathy, chronic progressive', ['Kidneys']), d('Basophilia, tubular', ['Kidneys']), d('Dilation, tubular', ['Kidneys']), d('Hydronephrosis', ['Kidneys']),
  d('Cast, hyaline', ['Kidneys']), d('Glomerulopathy', ['Kidneys']), d('Adenoma, renal tubule', ['Kidneys'], true), d('Carcinoma, renal tubule', ['Kidneys'], true),
  d('Cardiomyopathy', ['Heart']), d('Mineralization, epicardial', ['Heart']), d('Thrombus, atrial', ['Heart']),
  d('Gliosis', ['Brain', 'Spinal cord']), d('Hydrocephalus', ['Brain']), d('Vacuolation, neuropil', ['Brain', 'Spinal cord']), d('Glioma, malignant', ['Brain'], true),
  d('Thymoma', ['Thymus'], true), d('Plasmacytosis', ['Lymph nodes']), d('Histiocytosis, sinus', ['Lymph nodes']),
  d('Hyperplasia, squamous cell', ['Stomach', 'Esophagus', 'Skin']), d('Papilloma, squamous cell', ['Stomach', 'Esophagus', 'Skin'], true),
  d('Carcinoma, squamous cell', ['Stomach', 'Esophagus', 'Skin', 'Tumor'], true), d('Erosion', ['Stomach', 'Small intestine', 'Large intestine', 'Skin']),
  d('Ulcer', ['Stomach', 'Small intestine', 'Large intestine', 'Skin']),
  d('Hyperplasia, epithelial', ['Small intestine', 'Large intestine', 'Cecum']), d('Adenoma', ['Small intestine', 'Large intestine', 'Cecum', 'Mammary gland', 'Pituitary gland'], true),
  d('Adenocarcinoma', ['Small intestine', 'Large intestine', 'Cecum', 'Mammary gland', 'Uterus', 'Tumor'], true),
  d('Hyperkeratosis', ['Skin']), d('Hyperplasia, alveolar', ['Mammary gland']),
  d('Atrophy, acinar', ['Pancreas']), d('Hyperplasia, islet cell', ['Pancreas']), d('Adenoma, islet cell', ['Pancreas'], true), d('Carcinoma, acinar cell', ['Pancreas'], true),
  d('Hyperplasia, subcapsular cell', ['Adrenal glands']), d('Vacuolation, cortical', ['Adrenal glands']), d('Adenoma, cortical', ['Adrenal glands'], true),
  d('Pheochromocytoma, benign', ['Adrenal glands'], true), d('Pheochromocytoma, malignant', ['Adrenal glands'], true),
  d('Hypercellularity, bone marrow', ['Femur and bone marrow', 'Sternum']), d('Hypocellularity, bone marrow', ['Femur and bone marrow', 'Sternum']),
  d('Hyperostosis', ['Femur and bone marrow', 'Sternum']), d('Osteosarcoma', ['Femur and bone marrow', 'Sternum', 'Tumor'], true),
  d('Degeneration, germ cell', ['Testes']), d('Atrophy, seminiferous tubule', ['Testes']), d('Hypospermia', ['Epididymides']),
  d('Granulosa cell tumor', ['Ovaries'], true), d('Hyperplasia, endometrial, cystic', ['Uterus']), d('Hyperplasia, urothelial', ['Urinary bladder']),
  d('Carcinoma, urothelial', ['Urinary bladder'], true), d('Degeneration, myofiber', ['Skeletal muscle']), d('Regeneration, myofiber', ['Skeletal muscle']),
  d('Adenoma, Harderian gland', ['Harderian glands'], true), d('Adenoma, follicular cell', ['Thyroid glands'], true),
  d('Carcinoma', ['Tumor'], true), d('Sarcoma', ['Tumor'], true), d('Melanoma, malignant', ['Tumor', 'Skin'], true), d('Neuroblastoma', ['Tumor'], true),
  d('Necrosis, tumor', ['Tumor']), d('Invasion, local', ['Tumor']),
];

// Both take the list to search: the starter list by default, or the lab's library (see terminology.mjs), which
// can change while the pilot runs, so nothing is cached.
export function findDiagnosis(term, list = DIAGNOSES) {
  const t = String(term || '').toLowerCase();
  return list.find((x) => x.term.toLowerCase() === t) || null;
}
export function diagnosesFor(organ, list = DIAGNOSES) {
  const live = list.filter((x) => x.active !== false);
  const own = live.filter((x) => x.organs.includes(organ));
  const any = live.filter((x) => x.organs[0] === '*');
  return [...own, ...any.filter((x) => !own.includes(x))];
}

export const gradeWord = (s) => SEVERITY.find(([k]) => k === String(s))?.[1] || '';

// "Vacuolation, hepatocellular, centrilobular, multifocal, mild (2)"; "Adenoma, bronchiolo-alveolar, left [benign]".
export function dxText(dx) {
  const parts = [dx.term, dx.modifier, dx.distribution && dx.distribution.toLowerCase(), dx.laterality && dx.laterality.toLowerCase()].filter(Boolean);
  let tail = '';
  if (dx.neoplasm) {
    const tags = [dx.behavior && dx.behavior.toLowerCase(), dx.origin === 'Metastatic' ? 'metastatic' : ''].filter(Boolean);
    tail = tags.length ? ` [${tags.join(', ')}]` : '';
  } else if (dx.severity) tail = dx.severity === 'P' ? ', present' : `, ${gradeWord(dx.severity).toLowerCase()} (${dx.severity})`;
  return parts.join(', ') + tail;
}

// Short code for the individual animal table: 1-5, P, B (benign), M (malignant), with "m" for metastatic.
export const dxMark = (dx) => (dx.neoplasm ? `${dx.behavior === 'Malignant' ? 'M' : dx.behavior === 'Benign' ? 'B' : 'U'}${dx.origin === 'Metastatic' ? 'm' : ''}` : String(dx.severity || '+'));

export const isRead = (t) => t.result === 'NSL' || t.result === 'LESIONS';

// One glass slide per block read; tissues without a block count as a slide each.
export function slidesRead(c) {
  const blocks = new Set();
  let loose = 0;
  for (const t of c.tissues) if (isRead(t)) { if (t.block != null && t.block !== '') blocks.add(String(t.block)); else loose++; }
  return blocks.size + loose;
}

// Everything that must be true before a pathologist can sign the case out.
export function signOutProblems(c, { grossFindings = [], needCauseOfDeath = false } = {}) {
  const p = [];
  if (!c.tissues.length) p.push('add at least one tissue');
  const pending = c.tissues.filter((t) => t.result === 'PENDING').map((t) => t.organ);
  if (pending.length) p.push(`give a result for ${pending.join(', ')}`);
  const lesionNoDx = c.tissues.filter((t) => t.result === 'LESIONS' && !t.diagnoses.length).map((t) => t.organ);
  if (lesionNoDx.length) p.push(`add a diagnosis for ${lesionNoDx.join(', ')} or change the result`);
  for (const t of c.tissues) for (const dx of t.diagnoses) {
    if (!dx.term) p.push(`choose the diagnosis in ${t.organ}`);
    else if (dx.neoplasm && !dx.behavior) p.push(`say whether ${dx.term} in ${t.organ} is benign or malignant`);
    else if (!dx.neoplasm && !dx.severity) p.push(`grade ${dx.term} in ${t.organ}`);
  }
  if (!c.tissues.some(isRead)) p.push('read at least one tissue');
  const correlated = new Set(c.tissues.flatMap((t) => t.diagnoses.flatMap((dx) => dx.correlates || [])));
  const open = grossFindings.filter((g) => !correlated.has(g.id) && c.grossNoCorrelate?.[g.id] !== true);
  if (open.length) p.push(`correlate ${open.length === 1 ? 'the gross finding' : `${open.length} gross findings`} (${open.map((g) => g.organ).join(', ')}) with a diagnosis, or mark no microscopic correlate`);
  if (needCauseOfDeath && !c.causeOfDeath?.kind) p.push('record the cause of death (the animal was found dead or euthanized moribund)');
  if (c.causeOfDeath?.kind === 'DIAGNOSIS' && !c.causeOfDeath.dxId) p.push('choose the diagnosis that caused death');
  if (c.extraQuarterHours > 0 && !String(c.extraTimeNote || '').trim()) p.push('describe the additional pathologist time');
  return p;
}

// Charges a sign-out creates: PA001002 per glass slide read and PA001004 per quarter hour of extra pathologist time.
// After an amendment only what goes beyond what was already billed (released, plus adjustments) is charged.
export function signOutCharges({ slides, extraQuarterHours = 0, extraTimeNote = '', billedSlides = 0, billedQuarterHours = 0, version = 1 }) {
  const out = [];
  const s = slides - billedSlides;
  if (s > 0) out.push({ section: 'PATH', code: 'PA001002', units: s, note: `Pathology, ${slides} slide${slides === 1 ? '' : 's'} read${version > 1 ? ` (amended report v${version})` : ''}` });
  const t = extraQuarterHours - billedQuarterHours;
  if (t > 0) out.push({ section: 'PATH', code: 'PA001004', units: t, note: extraTimeNote });
  return out;
}

// ---------- summaries ----------
// cases: [{ subject, groupKey, c }] for signed-out cases. Returns incidence by group, neoplasm counts and the individual animal table.
export function summarizePathology(cases, groupKeys) {
  const examined = {};          // organ -> group -> animals read
  const inc = new Map();        // organ|term -> { organ, term, neoplasm, byGroup: { g: { n, grades: [] } } }
  const neo = Object.fromEntries(groupKeys.map((g) => [g, { animals: 0, any: 0, benign: 0, malignant: 0, metastatic: 0, primaryBenign: 0, primaryMalignant: 0 }]));
  const organOrder = [];
  for (const { groupKey: g, c } of cases) {
    if (!neo[g]) continue;
    neo[g].animals++;
    const flags = { any: false, benign: false, malignant: false, metastatic: false };
    // Counted once per animal: an organ in two blocks of one case is one animal examined, and one animal affected.
    const read = new Set(); const seen = new Set();
    for (const t of c.tissues) {
      if (!organOrder.includes(t.organ)) organOrder.push(t.organ);
      if (isRead(t) && !read.has(t.organ)) { read.add(t.organ); (examined[t.organ] ||= {}); examined[t.organ][g] = (examined[t.organ][g] || 0) + 1; }
      for (const dx of t.diagnoses) {
        const key = `${t.organ}|${dx.term}`;
        if (!inc.has(key)) inc.set(key, { organ: t.organ, term: dx.term, neoplasm: !!dx.neoplasm, byGroup: {} });
        const cell = (inc.get(key).byGroup[g] ||= { n: 0, grades: [], benign: 0, malignant: 0 });
        if (!seen.has(key)) { cell.n++; seen.add(key); }
        if (!dx.neoplasm && /^[1-5]$/.test(String(dx.severity))) cell.grades.push(Number(dx.severity));
        if (dx.neoplasm) {
          flags.any = true;
          if (dx.origin === 'Metastatic') flags.metastatic = true;
          else if (dx.behavior === 'Malignant') { flags.malignant = true; neo[g].primaryMalignant++; cell.malignant++; }
          else if (dx.behavior === 'Benign') { flags.benign = true; neo[g].primaryBenign++; cell.benign++; }
        }
      }
    }
    for (const k of Object.keys(flags)) if (flags[k]) neo[g][k]++;
  }
  const incidence = [...inc.values()].map((r) => ({
    ...r,
    byGroup: Object.fromEntries(groupKeys.map((g) => {
      const cell = r.byGroup[g];
      const mean = cell?.grades.length ? Math.round((cell.grades.reduce((a, x) => a + x, 0) / cell.grades.length) * 10) / 10 : null;
      return [g, { affected: cell?.n || 0, examined: examined[r.organ]?.[g] || 0, meanGrade: mean }];
    })),
  })).sort((a, b) => organOrder.indexOf(a.organ) - organOrder.indexOf(b.organ) || Number(a.neoplasm) - Number(b.neoplasm) || a.term.localeCompare(b.term));

  // Individual animal table: one row per tissue with each animal's status, then a row per diagnosis.
  const animals = cases.map(({ subject, groupKey }) => ({ id: subject.id, phl: subject.phl, label: subject.label, group: groupKey, sex: subject.sex || '' }));
  const statusMark = { NSL: '-', LESIONS: '+', NOT_EXAMINED: 'NE', NOT_PRESENT: 'NP', PENDING: '?' };
  const tabulated = organOrder.map((organ) => {
    const status = {}; const terms = new Map();
    for (const { subject, c } of cases) {
      const ts = c.tissues.filter((t) => t.organ === organ);
      if (!ts.length) continue;
      status[subject.id] = ts.some((t) => t.result === 'LESIONS') ? '+' : statusMark[ts[0].result] || '';
      for (const t of ts) for (const dx of t.diagnoses) {
        if (!terms.has(dx.term)) terms.set(dx.term, {});
        terms.get(dx.term)[subject.id] = dxMark(dx);
      }
    }
    return { organ, status, diagnoses: [...terms].map(([term, cells]) => ({ term, cells })) };
  });
  // Tissues no animal had read would only fill the table with "NE"; list them separately.
  const shown = tabulated.filter((row) => Object.values(row.status).some((m) => m === '-' || m === '+'));
  const notRead = tabulated.filter((row) => !shown.includes(row)).map((row) => row.organ);
  return { examined, incidence, neoplasms: neo, animals, tabulated: shown, notRead };
}
