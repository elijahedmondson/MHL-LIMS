// Bloodwork for the pilot: hematology from the Genesis analyzer (exported by the Hemavet DMS program as an Excel
// sheet), chemistry from the Abaxis VetScan VS2 and Piccolo (printouts captured as text by PuTTY), and cytology
// entered by hand.
//
// The file layouts follow Zaphod's importers (ReadChemistryFiles.vb, ReadHematologyFiles.vb), which MHL has used
// for years, but the chemistry parser reads analytes by name rather than by line position, so it also reads
// Piccolo panels and VetScan rotors other than the Comprehensive Diagnostic Profile.
// Used by the core and by the browser (/lib/bloodwork.mjs).

// [code, name, unit, aliases]. Units are as the analyzers print them for mice.
const A = (code, name, unit, aliases = []) => ({ code, name, unit, aliases });
export const CHEMISTRY = [
  A('ALB', 'Albumin', 'g/dL'), A('ALP', 'Alkaline phosphatase', 'U/L'), A('ALT', 'Alanine aminotransferase', 'U/L', ['GPT']), A('AST', 'Aspartate aminotransferase', 'U/L', ['GOT']),
  A('AMY', 'Amylase', 'U/L', ['AMYL']), A('TBIL', 'Total bilirubin', 'mg/dL', ['T-BIL', 'TBILI', 'BILI']), A('BUN', 'Urea nitrogen', 'mg/dL', ['UREA']),
  A('CA', 'Calcium', 'mg/dL', ['CA++', 'CA2+']), A('PHOS', 'Phosphorus', 'mg/dL', ['PHO', 'IP']), A('CRE', 'Creatinine', 'mg/dL', ['CREA', 'CREAT']),
  A('GLU', 'Glucose', 'mg/dL', ['GLUC']), A('NA+', 'Sodium', 'mmol/L', ['NA']), A('K+', 'Potassium', 'mmol/L', ['K']), A('CL-', 'Chloride', 'mmol/L', ['CL']),
  A('TCO2', 'Total CO2', 'mmol/L', ['CO2']), A('TP', 'Total protein', 'g/dL'), A('GLOB', 'Globulin', 'g/dL', ['GLO']), A('CHOL', 'Cholesterol', 'mg/dL'),
  A('TRIG', 'Triglycerides', 'mg/dL'), A('GGT', 'Gamma-glutamyltransferase', 'U/L'), A('CK', 'Creatine kinase', 'U/L', ['CPK']), A('MG', 'Magnesium', 'mg/dL'),
  A('UA', 'Uric acid', 'mg/dL'), A('HDL', 'HDL cholesterol', 'mg/dL'), A('LDL', 'LDL cholesterol', 'mg/dL'), A('VLDL', 'VLDL cholesterol', 'mg/dL'),
  A('CRP', 'C-reactive protein', 'mg/L'), A('LD', 'Lactate dehydrogenase', 'U/L', ['LDH']), A('EGFR', 'Estimated GFR', 'mL/min'),
  A('TBA', 'Bile acids', 'µmol/L', ['BA']),
];
export const HEMATOLOGY = [
  A('WBC', 'White blood cells', 'K/µL'), A('NE', 'Neutrophils', 'K/µL', ['NE#', 'NEUT']), A('LY', 'Lymphocytes', 'K/µL', ['LY#', 'LYM']),
  A('MO', 'Monocytes', 'K/µL', ['MO#', 'MONO']), A('EO', 'Eosinophils', 'K/µL', ['EO#', 'EOS']), A('BA', 'Basophils', 'K/µL', ['BA#', 'BASO']),
  A('NE%', 'Neutrophils', '%'), A('LY%', 'Lymphocytes', '%'), A('MO%', 'Monocytes', '%'), A('EO%', 'Eosinophils', '%'), A('BA%', 'Basophils', '%'),
  A('RBC', 'Red blood cells', 'M/µL'), A('HB', 'Hemoglobin', 'g/dL', ['HGB']), A('HCT', 'Hematocrit', '%'), A('MCV', 'Mean cell volume', 'fL'),
  A('MCH', 'Mean cell hemoglobin', 'pg'), A('MCHC', 'Mean cell hemoglobin concentration', 'g/dL'), A('RDW', 'Red cell distribution width', '%', ['RDW-CV']),
  A('RSD', 'Red cell distribution width (SD)', 'fL', ['RDW-SD']), A('RET', 'Reticulocytes', 'K/µL', ['RETIC', 'RETICS', 'RET#']),
  A('RET%', 'Reticulocytes', '%', ['RETIC%', 'RETICS%']), A('PLT', 'Platelets', 'K/µL'), A('MPV', 'Mean platelet volume', 'fL'),
  A('PDW', 'Platelet distribution width', '%'), A('PCT', 'Plateletcrit', '%'),
];
// Chemistry and hematology labels are looked up separately: "BA" is bile acids on a VetScan liver profile but
// basophils on a hematology sheet.
const aliasMap = (list) => { const m = new Map(); for (const a of list) for (const k of [a.code, ...a.aliases]) m.set(k.toUpperCase(), a.code); return m; };
const CHEM_ALIAS = aliasMap(CHEMISTRY); const HEME_ALIAS = aliasMap(HEMATOLOGY);
const clean = (label) => String(label || '').toUpperCase().replace(/:$/, '').replace(/\s+/g, '');
export const chemCode = (label) => CHEM_ALIAS.get(clean(label)) || null;
export const hemeCode = (label) => HEME_ALIAS.get(clean(label)) || null;
export const analyteCode = (label) => chemCode(label) || hemeCode(label);
// Whether two unit spellings mean the same unit (µ, u and mc are the same; case and spaces do not matter).
export const sameUnit = (a, b) => { const n = (u) => String(u || '').toLowerCase().replace(/\s+/g, '').replace(/^mc|µ|μ/g, 'u'); return n(a) === n(b); };
export const analyteInfo = (code) => CHEMISTRY.find((a) => a.code === code) || HEMATOLOGY.find((a) => a.code === code) || null;

export const INSTRUMENTS = {
  GENESIS: { name: 'Genesis hematology analyzer (Hemavet DMS export)', kind: 'HEMATOLOGY', charge: 'HP002101' },
  VS2: { name: 'Abaxis VetScan VS2', kind: 'CHEMISTRY', charge: 'HP002204' },
  PICCOLO: { name: 'Abaxis Piccolo Xpress', kind: 'CHEMISTRY', charge: 'HP002205' },
  ABAXIS: { name: 'Abaxis analyzer (the printout does not say VS2 or Piccolo)', kind: 'CHEMISTRY', charge: null },
};

const MONTHS = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
const pad = (n) => String(n).padStart(2, '0');
function findDate(line) {
  let m = line.match(/\b(\d{1,2})[\s-]+([A-Za-z]{3})[a-z]*[\s-]+(\d{4})\b/);
  if (m && MONTHS[m[2].toUpperCase()]) return `${m[3]}-${pad(MONTHS[m[2].toUpperCase()])}-${pad(m[1])}`;
  m = line.match(/\b([A-Za-z]{3})[a-z]*\.?\s+(\d{1,2}),?\s+(\d{4})\b/);
  if (m && MONTHS[m[1].toUpperCase()]) return `${m[3]}-${pad(MONTHS[m[1].toUpperCase()])}-${pad(m[2])}`;
  m = line.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})\b/);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = line.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : '';
}
function findTime(line) {
  const m = line.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\s*([AaPp][Mm])?/);
  if (!m) return '';
  let h = Number(m[1]);
  if (m[3]) { const pm = /p/i.test(m[3]); if (pm && h < 12) h += 12; if (!pm && h === 12) h = 0; }
  return `${pad(h)}:${m[2]}`;
}

// ---------- Abaxis chemistry printouts ----------
const PUTTY = /=~=~=~=~/;
const HEADER = /\b(VETSCAN|VS2|PICCOLO)\b/i;
const analyteLine = (l) => { const tok = l.trim().split(/\s+/)[0]; return !!chemCode(tok) && /\d|~|\*/.test(l.slice(l.indexOf(tok) + tok.length)); };

// A PuTTY log can hold several printouts. Splits on PuTTY's log header and on each analyzer header that follows results.
export function splitPrintouts(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const out = []; let cur = [];
  const push = () => { if (cur.some(analyteLine)) out.push(cur.join('\n')); cur = []; };
  for (const l of lines) {
    if (PUTTY.test(l)) { push(); continue; }
    if (HEADER.test(l) && cur.some(analyteLine)) push();
    cur.push(l);
  }
  push();
  return out;
}

function parseValueTokens(rest) {
  const toks = rest.replace(/(\d)\s*-\s*(\d)/g, '$1-$2').trim().split(/\s+/).filter(Boolean);
  const r = { value: null, text: '', prefix: '', unit: '', flag: '', range: null };
  for (const tok of toks) {
    let m;
    if (/^[<>]$/.test(tok) && r.value == null) r.prefix = tok;
    else if (r.value == null && !r.text && (m = tok.match(/^([<>])?(-?\d+(?:\.\d+)?)([HL*])?$/))) { r.prefix = m[1] || r.prefix; r.value = Number(m[2]); r.flag = m[3] || ''; }
    else if (r.value == null && !r.text && /^(~+|\*+|-{2,}|HEM|LIP|ICT|RRR|HHH|LLL|N\/A|INS)$/i.test(tok)) r.text = tok;
    else if ((m = tok.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/))) r.range = { low: Number(m[1]), high: Number(m[2]) };
    else if (/^[HL*]$/.test(tok) && (r.value != null || r.text) && !r.flag) r.flag = tok;
    else if (!r.unit && /[A-Za-z%µ/]/.test(tok) && (r.value != null || r.text)) r.unit = tok.replace(/^u/, 'µ');
  }
  return r;
}

export function parseAbaxis(text) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  const header = lines.find((l) => HEADER.test(l)) || '';
  const instrument = /PICCOLO/i.test(header) ? 'PICCOLO' : header ? 'VS2' : 'ABAXIS';
  const res = { instrument, instrumentStated: !!header, kind: 'CHEMISTRY', panel: '', sampleId: '', testedOn: '', testedAt: '', rotorLot: '', serial: '', qc: '', indices: null, analytes: [], raw: String(text || '').slice(0, 6000) };
  for (const l of lines) {
    const s = l.trim();
    if (!s) continue;
    let m;
    if (!res.sampleId && (m = s.match(/^(?:patient|sample|animal|pt\.?)\s*id\s*[:#]?\s*(.*)$/i))) res.sampleId = m[1].trim();
    else if (!res.rotorLot && (m = s.match(/rotor\s*lot(?:\s*(?:number|no\.?))?\s*[:#]?\s*(\S+)/i))) res.rotorLot = m[1];
    else if (!res.serial && (m = s.match(/serial\s*(?:number|no\.?)?\s*[:#]?\s*(\S+)/i))) res.serial = m[1];
    else if ((m = s.match(/^QC\s+(.+)$/i))) res.qc = m[1].trim();
    else if ((m = s.match(/HEM\s+(\S+)\s+LIP\s+(\S+)\s+ICT\s+(\S+)/i))) res.indices = { hem: m[1], lip: m[2], ict: m[3] };
    else if (analyteLine(s)) {
      const tok = s.split(/\s+/)[0];
      const code = chemCode(tok);
      if (!res.analytes.some((a) => a.code === code)) res.analytes.push({ code, ...parseValueTokens(s.slice(tok.length)) });
    } else {
      if (!res.testedOn) res.testedOn = findDate(s);
      if (!res.testedAt && res.testedOn) res.testedAt = findTime(s);
      if (!res.panel && !HEADER.test(s) && /(profile|panel|metlyte|lipid|chemistry|prep|plus|electrolyte)/i.test(s) && !/:/.test(s)) res.panel = s;
    }
  }
  return res;
}

// ---------- Hemavet DMS hematology sheet ----------
// One sample per pair of columns starting at C/D: value in the left column, flag in the right. Row 1 holds the sample
// ID (in the flag column), row 2 the test number, row 4 the date and row 5 the time. Two layouts, from Zaphod's
// two import buttons; rows are 1-based as in Excel.
export const HEMAVET_LAYOUTS = {
  original: { WBC: 6, NE: 7, LY: 8, MO: 9, EO: 10, BA: 11, 'NE%': 13, 'LY%': 14, 'MO%': 15, 'EO%': 16, 'BA%': 17, RBC: 19, HB: 20, HCT: 21, MCV: 22, MCH: 23, MCHC: 24, RDW: 25, RET: 26, 'RET%': 27, PLT: 28, MPV: 29 },
  extended: { WBC: 6, NE: 7, LY: 8, MO: 9, EO: 10, BA: 11, 'NE%': 13, 'LY%': 14, 'MO%': 15, 'EO%': 16, 'BA%': 17, HCT: 19, RBC: 20, HB: 21, MCV: 22, MCH: 23, MCHC: 24, RDW: 25, RSD: 26, RET: 27, 'RET%': 28, PLT: 29, MPV: 30, PDW: 31, PCT: 32 },
};

const cell = (grid, row, col) => { const v = grid[row - 1]?.[col - 1]; return v == null ? '' : String(v).trim(); };
const numOrNull = (v) => { const s = String(v ?? '').trim(); return s !== '' && Number.isFinite(Number(s)) ? Number(s) : null; };
function excelDate(v) {
  const n = numOrNull(v);
  if (n != null && n > 20000 && n < 80000) { const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(n) * 86400000); return d.toISOString().slice(0, 10); }
  return findDate(String(v || ''));
}
function excelTime(v) {
  const n = numOrNull(v);
  if (n != null && n >= 0 && n < 1) { const mins = Math.round(n * 1440); return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
  if (n != null && n > 20000) { const mins = Math.round((n % 1) * 1440); return `${pad(Math.floor(mins / 60) % 24)}:${pad(mins % 60)}`; }
  return findTime(String(v || ''));
}

// Labels in the first two columns, if the export has them, decide the rows; otherwise a layout does.
function rowMap(grid, layout) {
  const found = {};
  for (let r = 1; r <= Math.min(grid.length, 60); r++) {
    for (const c of [1, 2]) {
      const code = hemeCode(cell(grid, r, c));
      if (code && !found[code]) found[code] = r;
    }
  }
  if (Object.keys(found).length >= 6) return { rows: found, layout: 'labels' };
  if (layout && HEMAVET_LAYOUTS[layout]) return { rows: HEMAVET_LAYOUTS[layout], layout };
  const extended = [31, 32].some((r) => numOrNull(cell(grid, r, 3)) != null);
  return { rows: HEMAVET_LAYOUTS[extended ? 'extended' : 'original'], layout: extended ? 'extended' : 'original' };
}

// A CSV or sheet with one sample per row and a header row of labels.
function parseRowWise(grid) {
  const hi = grid.findIndex((r) => r.filter((c) => hemeCode(c)).length >= 6);
  if (hi < 0) return null;
  const head = grid[hi].map((c) => String(c || '').trim());
  const idCol = head.findIndex((h) => /^(sample|patient|animal)?\s*id$|^sample$|^id$/i.test(h));
  const dateCol = head.findIndex((h) => /date/i.test(h)); const timeCol = head.findIndex((h) => /time/i.test(h));
  const out = [];
  for (const r of grid.slice(hi + 1)) {
    const id = idCol >= 0 ? String(r[idCol] || '').trim() : '';
    if (!id) continue;
    const analytes = [];
    head.forEach((h, i) => {
      const code = hemeCode(h);
      if (!code || analytes.some((a) => a.code === code)) return;
      const raw = String(r[i] ?? '').trim();
      const m = raw.match(/^([<>])?(-?\d+(?:\.\d+)?)\s*([HL*])?$/);
      if (raw) analytes.push({ code, value: m ? Number(m[2]) : null, text: m ? '' : raw, prefix: m?.[1] || '', unit: '', flag: m?.[3] || '', range: null });
    });
    out.push({ instrument: 'GENESIS', kind: 'HEMATOLOGY', sampleId: id, testNumber: '', testedOn: dateCol >= 0 ? excelDate(r[dateCol]) : '', testedAt: timeCol >= 0 ? excelTime(r[timeCol]) : '', analytes });
  }
  return { layout: 'rows', results: out };
}

export function parseHemavetGrid(grid, layout = '') {
  const rowWise = parseRowWise(grid);
  if (rowWise && rowWise.results.length) return rowWise;
  const { rows, layout: used } = rowMap(grid, layout);
  const results = [];
  const width = Math.max(0, ...grid.map((r) => r.length));
  // Zaphod stopped at the first empty sample ID; a blank column here is skipped so later samples are not lost.
  for (let k = 0; 3 + 2 * k <= width; k++) {
    const valCol = 3 + 2 * k; const flagCol = valCol + 1;
    const id = cell(grid, 1, flagCol);
    if (!id) continue;
    const analytes = [];
    for (const [code, r] of Object.entries(rows)) {
      const raw = cell(grid, r, valCol);
      if (raw === '') continue;
      const value = numOrNull(raw);
      analytes.push({ code, value, text: value == null ? raw : '', prefix: '', unit: '', flag: cell(grid, r, flagCol).toUpperCase(), range: null });
    }
    results.push({ instrument: 'GENESIS', kind: 'HEMATOLOGY', sampleId: id, testNumber: cell(grid, 2, flagCol), testedOn: excelDate(cell(grid, 4, flagCol)),
      testedAt: excelTime(cell(grid, 5, flagCol)), analytes });
  }
  return { layout: used, results };
}

// ---------- flags and reference ranges ----------
export function parseRange(v) {
  if (v && typeof v === 'object') return Number.isFinite(v.low) || Number.isFinite(v.high) ? v : null;
  const m = String(v || '').match(/(-?\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(-?\d+(?:\.\d+)?)/);
  return m ? { low: Number(m[1]), high: Number(m[2]) } : null;
}
export function flagFor(value, range) {
  if (value == null || !range) return '';
  if (Number.isFinite(range.low) && value < range.low) return 'L';
  if (Number.isFinite(range.high) && value > range.high) return 'H';
  return '';
}

// The range to judge a value by: the lab's own range for the species if it has one, else the range on the printout.
export function rangeFor(code, species, ranges, printed) {
  const lab = ranges?.[species]?.[code];
  if (lab && (Number.isFinite(lab.low) || Number.isFinite(lab.high))) return { ...lab, source: 'lab' };
  return printed ? { ...printed, source: 'instrument' } : null;
}

// Normalizes an MHL number the way staff key it on the analyzer: upper case, no spaces.
export const normalizeSampleId = (s) => String(s || '').toUpperCase().replace(/\s+/g, '').replace(/^(?:PHL|MHL)#?/, '');   // labels may still carry the old PHL prefix

// ---------- cytology ----------
export const CYTOLOGY_SPECIMENS = ['Blood smear', 'Bone marrow smear', 'Bone marrow cytospin', 'Bronchoalveolar lavage', 'Pleural effusion', 'Peritoneal effusion',
  'Fine-needle aspirate', 'Impression smear', 'Urine sediment', 'Cerebrospinal fluid', 'Other'];
export const CYTOLOGY_STAINS = ['Wright-Giemsa', 'Modified Wright (Diff-Quik)', 'New methylene blue', 'Prussian blue', 'Other'];
export const DIFFERENTIALS = {
  blood: ['Segmented neutrophils', 'Band neutrophils', 'Lymphocytes', 'Monocytes', 'Eosinophils', 'Basophils', 'Other'],
  marrow: ['Myeloblasts', 'Promyelocytes', 'Myelocytes', 'Metamyelocytes', 'Band neutrophils', 'Segmented neutrophils', 'Eosinophils', 'Basophils',
    'Rubriblasts', 'Prorubricytes', 'Rubricytes', 'Metarubricytes', 'Lymphocytes', 'Plasma cells', 'Monocytes', 'Macrophages', 'Megakaryocytes', 'Mitotic figures', 'Other'],
  fluid: ['Macrophages', 'Neutrophils', 'Lymphocytes', 'Eosinophils', 'Mast cells', 'Epithelial cells', 'Other'],
};
export const MYELOID = ['Myeloblasts', 'Promyelocytes', 'Myelocytes', 'Metamyelocytes', 'Band neutrophils', 'Segmented neutrophils', 'Eosinophils', 'Basophils'];
export const ERYTHROID = ['Rubriblasts', 'Prorubricytes', 'Rubricytes', 'Metarubricytes'];
export const RBC_MORPHOLOGY = ['Anisocytosis', 'Polychromasia', 'Poikilocytosis', 'Spherocytes', 'Schistocytes', 'Target cells', 'Howell-Jolly bodies', 'Heinz bodies', 'Agglutination'];
export const GRADES = ['', '1+', '2+', '3+', '4+'];
export const PLATELET_ESTIMATES = ['', 'Adequate', 'Decreased', 'Increased', 'Clumped, cannot estimate'];
export const differentialKind = (specimen) => (/marrow/i.test(specimen) ? 'marrow' : /blood/i.test(specimen) ? 'blood' : 'fluid');

// Percentages from counts, and the M:E ratio for marrow.
export function differentialSummary(counts, specimen) {
  const kind = differentialKind(specimen);
  const cells = DIFFERENTIALS[kind];
  const total = cells.reduce((n, c) => n + (Number(counts?.[c]) || 0), 0);
  const pct = Object.fromEntries(cells.map((c) => [c, total ? Math.round(((Number(counts?.[c]) || 0) / total) * 1000) / 10 : 0]));
  let me = null;
  if (kind === 'marrow') {
    const m = MYELOID.reduce((n, c) => n + (Number(counts?.[c]) || 0), 0);
    const e = ERYTHROID.reduce((n, c) => n + (Number(counts?.[c]) || 0), 0);
    me = e ? Math.round((m / e) * 100) / 100 : null;
  }
  return { kind, total, pct, me };
}
