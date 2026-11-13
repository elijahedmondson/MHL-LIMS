// Necropsy and trim protocols, modeled on Zaphod (tblNecropsyProtocols + tblNecropsyProtocolSteps,
// tblTrimProtocols + tblTrimOrgans). A study names one of each. When a necropsy starts, the stored procedure
// CreateNecropsyFromProtocol builds the animal's organ list from the necropsy steps and takes each organ's
// block number from the trim protocol, for the animal's sex. resolveProtocol() does the same here.
//
// Also reads protocols from outside: the JSON written by tools/zaphod-export/export_zaphod_reference.sql, or a
// table pasted from Excel or saved as CSV (for example Zaphod's "Necropsy Protocol" or "Trim Protocol" report).
// Used by the core and by the browser (/lib/protocols.mjs).

import { PROTOCOLS } from './defs.mjs';

const str = (v, max = 300) => (v == null ? '' : String(v).trim().slice(0, max));
const yes = (v) => v === true || v === 1 || /^(y|yes|true|1|x|✓)$/i.test(String(v ?? '').trim());
const isoDay = (v) => { const m = String(v || '').match(/^(\d{4}-\d{2}-\d{2})/); if (m) return m[1]; const u = String(v || '').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/); return u ? `${u[3]}-${u[1].padStart(2, '0')}-${u[2].padStart(2, '0')}` : ''; };
const sexOf = (v) => { const s = String(v || '').trim().toUpperCase(); return s.startsWith('M') ? 'M' : s.startsWith('F') ? 'F' : 'N'; };

export const FIXATIVES = ['10% NBF', '4% PFA', "Bouin's", 'Davidson\'s', 'Zinc formalin', '70% ethanol', 'None'];
export const FREEZES = ['', 'Snap freeze (LN2)', 'OCT block', 'Dry ice', 'RNAlater'];

// The pilot's three placeholder protocols, split the Zaphod way into a necropsy protocol and a trim protocol each.
export function starterProtocols() {
  const base = { description: '', date: '2026-01-01', approved: true, obsolete: false, approvedBy: 'PILOT', dateApproved: '2026-01-01', instructions: '', source: 'starter', zaphodId: null };
  const necropsy = PROTOCOLS.map((p) => ({
    ...base, id: p.id, name: p.name, weighAnimal: !!p.bodyWeight, perfusion: p.perfusion || '',
    steps: p.organs.map((o, i) => ({ seq: i + 1, organ: o.organ, fixative: '10% NBF', freeze: '', weigh: !!o.weigh, measure: false, description: '' })),
  }));
  const trim = PROTOCOLS.map((p) => ({ ...base, id: p.id, name: p.name, organs: p.organs.map((o) => ({ block: String(o.block), organ: o.organ, sex: 'N', description: '' })) }));
  return { necropsy, trim };
}

const sameOrgan = (a, b) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase();

// The animal's organ list: necropsy steps in order, each with its block from the trim protocol; trim-protocol organs
// that have no necropsy step are added at the end. Organs for the other sex are left out when the sex is known.
// organSex(name) gives an organ's sex from the library (N, M or F).
export function resolveProtocol(nec, trim, sex = '', organSex = () => 'N') {
  const s = sexOf(sex);
  const known = s === 'M' || s === 'F';
  const forSex = (entrySex, organ) => !known || ((entrySex || 'N') === 'N' || entrySex === s) && ['N', s].includes(organSex(organ) || 'N');
  const trimRows = (trim?.organs || []).filter((o) => forSex(o.sex, o.organ));
  // An organ the trim protocol puts in several blocks (spinal cord in 10 and 11, say) gets a row per block, as in
  // Zaphod; it is weighed once.
  const organs = (nec?.steps || []).slice().sort((a, b) => a.seq - b.seq).filter((st) => forSex('N', st.organ)).flatMap((st) => {
    const blocks = trimRows.filter((o) => sameOrgan(o.organ, st.organ)).map((o) => o.block);
    return (blocks.length ? blocks : ['']).map((block, i) => ({ organ: st.organ, weigh: !!st.weigh && i === 0, measure: !!st.measure && i === 0, fixative: st.fixative || '',
      freeze: st.freeze || '', block, description: st.description || '' }));
  });
  const stepped = new Set((nec?.steps || []).map((st) => st.organ.trim().toLowerCase()));
  for (const o of trimRows) {
    if (!stepped.has(o.organ.trim().toLowerCase())) organs.push({ organ: o.organ, weigh: false, measure: false, fixative: '', freeze: '', block: o.block, description: o.description || '' });
  }
  return {
    necropsyId: nec?.id ?? null, trimId: trim?.id ?? null, name: nec?.name || trim?.name || 'No protocol',
    trimName: trim?.name || '', bodyWeight: nec ? !!nec.weighAnimal : true, perfusion: nec?.perfusion || '',
    instructions: [nec?.instructions, trim?.instructions].filter(Boolean).join('\n'), organs,
  };
}

export function protocolProblems(p, kind) {
  const out = [];
  if (!str(p.name)) out.push('The protocol needs a name.');
  const rows = kind === 'trim' ? p.organs : p.steps;
  if (!rows?.length) out.push(kind === 'trim' ? 'List at least one organ and its block.' : 'List at least one organ.');
  if (rows?.some((r) => !str(r.organ))) out.push('Every row needs an organ.');
  if (kind === 'trim' && rows?.some((r) => !str(r.block))) out.push('Every organ needs a block number.');
  if (kind !== 'trim') {
    const dup = rows?.map((r) => r.organ.toLowerCase()).filter((o, i, a) => a.indexOf(o) !== i);
    if (dup?.length) out.push(`${[...new Set(dup)].join(', ')} appears more than once.`);
  }
  return out;
}

// ---------- Zaphod export (tools/zaphod-export/export_zaphod_reference.sql) ----------
function parseJsonLoose(text) {
  const t = String(text || '').replace(/^﻿/, '').trim();
  try { return JSON.parse(t); } catch { /* sqlcmd may wrap long lines */ }
  try { return JSON.parse(t.replace(/\r?\n/g, '')); } catch { throw new Error('The file is not valid JSON. Save the query result to a file with sqlcmd -y 0 (see the script header) and try again.'); }
}

const pick = (row, ...names) => { for (const n of names) { const k = Object.keys(row || {}).find((x) => x.toLowerCase() === n.toLowerCase()); if (k && row[k] != null) return row[k]; } return null; };
const namesOf = (rows, ...cols) => (Array.isArray(rows) ? rows.map((r) => str(pick(r, ...cols), 200)).filter(Boolean) : []);

export function parseZaphodExport(text) {
  const j = typeof text === 'string' ? parseJsonLoose(text) : text;
  const root = j?.ZaphodExport || j;
  if (!root || (!root.necropsyProtocols && !root.trimProtocols)) throw new Error('This file has no necropsyProtocols or trimProtocols. Is it the output of export_zaphod_reference.sql?');
  const necropsy = (root.necropsyProtocols || []).map((p) => ({
    zaphodId: pick(p, 'ProtocolID'), name: str(pick(p, 'ProtocolName'), 120), description: str(pick(p, 'Description'), 500), date: isoDay(pick(p, 'ProtocolDate')),
    weighAnimal: yes(pick(p, 'WeighAnimal')), approved: yes(pick(p, 'Approved')), obsolete: yes(pick(p, 'Obsolete')), approvedBy: str(pick(p, 'ApprovedBy'), 60),
    dateApproved: isoDay(pick(p, 'DateApproved')), instructions: str(pick(p, 'GeneralInstructions'), 2000), perfusion: '',
    steps: (pick(p, 'steps') || []).map((s, i) => ({ seq: Number(pick(s, 'Sequence')) || i + 1, organ: str(pick(s, 'Organ'), 80), fixative: str(pick(s, 'Fixative'), 60),
      freeze: str(pick(s, 'Freeze'), 60), weigh: yes(pick(s, 'WeighOrgan')), measure: yes(pick(s, 'MeasureOrgan')), description: str(pick(s, 'Description'), 300) })).filter((s) => s.organ),
  })).filter((p) => p.name);
  const trim = (root.trimProtocols || []).map((p) => ({
    zaphodId: pick(p, 'ProtocolID'), name: str(pick(p, 'ProtocolName'), 120), description: str(pick(p, 'Description'), 500), date: isoDay(pick(p, 'ProtocolDate')),
    approved: yes(pick(p, 'Approved')), obsolete: yes(pick(p, 'Obsolete')), approvedBy: str(pick(p, 'ApprovedBy'), 60), dateApproved: isoDay(pick(p, 'DateApproved')),
    instructions: str(pick(p, 'GeneralInstructions'), 2000),
    organs: (pick(p, 'organs') || []).map((o) => ({ block: str(pick(o, 'BlockNbr'), 10), organ: str(pick(o, 'Organ'), 80), sex: sexOf(pick(o, 'Sex')), description: str(pick(o, 'Description'), 300) })).filter((o) => o.organ),
  })).filter((p) => p.name);
  const studies = (root.studies || []).map((s) => ({ zap: str(pick(s, 'ZAPNbr'), 20), title: str(pick(s, 'StudyTitle'), 300), necropsyZaphodId: pick(s, 'NecropsyProtocolID'),
    trimZaphodId: pick(s, 'TrimProtocolID'), obsolete: yes(pick(s, 'Obsolete')) })).filter((s) => s.zap);

  const d = root.dictionaries || {};
  const organRows = Array.isArray(d.organs) ? d.organs : [];
  const organName = new Map(organRows.map((o) => [String(pick(o, 'OrganID')), str(pick(o, 'Organ'), 80)]));
  const species = new Map((d.species || []).map((x) => [String(pick(x, 'SpeciesID')), str(pick(x, 'Species'), 60)]));
  const ranges = (rows) => (Array.isArray(rows) ? rows.map((r) => ({
    species: species.get(String(pick(r, 'SpeciesID', 'SpeciesId'))) || str(pick(r, 'Species'), 60) || `Species ${pick(r, 'SpeciesID', 'SpeciesId')}`,
    values: Object.fromEntries(Object.entries(r).filter(([k, v]) => !/species|id$/i.test(k) && typeof v === 'string' && /\d/.test(v))),
  })) : []);
  const dictionaries = {
    organs: organRows.map((o) => ({ name: str(pick(o, 'Organ'), 80), paired: yes(pick(o, 'PairedOrgan')), sex: sexOf(pick(o, 'Sex')) })).filter((o) => o.name),
    diagnoses: (d.diagnoses || []).map((x) => ({ term: str(pick(x, 'Diagnosis'), 160), organ: organName.get(String(pick(x, 'OrganID'))) || '', code: str(pick(x, 'Code'), 10) })).filter((x) => x.term),
    sites: namesOf(d.sites, 'Site'), morphology: namesOf(d.morphology, 'Morphology'), shapes: namesOf(d.shapes, 'Shape'), colors: namesOf(d.colors, 'Color'),
    consistencies: namesOf(d.consistencies, 'Consistency'), fates: namesOf(d.fates, 'Fate'), conditions: namesOf(d.conditions, 'Condition'),
    physicalIds: namesOf(d.physicalIds, 'Description'), fixatives: namesOf(d.fixatives, 'Fixative'), freezes: namesOf(d.freezes, 'Freeze'),
    severity: namesOf(d.severities, 'Severity'), distribution: namesOf(d.distributions, 'Distribution'), neoplasm: namesOf(d.neoplasms, 'Neoplasm'), hn: namesOf(d.hn, 'HN'),
    chemistryRanges: ranges(d.chemistryRanges), hematologyRanges: ranges(d.hematologyRanges),
  };
  return { source: 'zaphod', exportedAt: str(root.exportedAt, 30), database: str(root.database, 60), necropsy, trim, studies, dictionaries };
}

// ---------- a table pasted from Excel, or a CSV ----------
export function splitTable(text) {
  const lines = String(text || '').replace(/^﻿/, '').split(/\r?\n/);
  const tabbed = lines.some((l) => l.includes('\t'));
  const parseLine = (l) => {
    if (tabbed) return l.split('\t').map((c) => c.trim());
    const out = []; let cur = ''; let q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"' && l[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; }
      else if (ch === '"') q = true; else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  };
  return lines.map(parseLine);
}

const HEAD = {
  seq: /^(seq|sequence|step|order|#)$/, organ: /^(organ|tissue|organ name)$/, fixative: /^(fix|fixative)$/, freeze: /^(freeze|frozen)$/,
  weigh: /^(weigh|weighorgan|weigh organ|weight)$/, measure: /^(measure|measureorgan|measure organ)$/, block: /^(block|blocknbr|block no\.?|block number|cassette)$/,
  sex: /^(sex)$/, description: /^(description|instructions|notes|comment|textbox\d+|description\d*)$/, name: /^(protocolname|protocol name|protocol)$/,
};

// Returns { name, steps, organs }: necropsy steps if the table has weigh or fixative columns, trim organs if it has
// a block column (a table can give both).
export function parseProtocolTable(text, fallbackName = '') {
  const rows = splitTable(text);
  const hi = rows.findIndex((r) => r.some((c) => HEAD.organ.test(c.toLowerCase())));
  if (hi < 0) throw new Error('No header row with an "Organ" column was found. Copy the table with its header row.');
  const head = rows[hi].map((c) => c.toLowerCase().replace(/\s+/g, ' ').trim());
  const at = (key) => head.findIndex((h) => HEAD[key].test(h));
  const c = Object.fromEntries(Object.keys(HEAD).map((k) => [k, at(k)]));
  const body = [];
  for (const r of rows.slice(hi + 1)) { if (!r.some((x) => x)) { if (body.length) break; continue; } body.push(r); }
  const get = (r, k) => (c[k] >= 0 ? r[c[k]] || '' : '');
  const name = str(body.map((r) => get(r, 'name')).find(Boolean) || fallbackName, 120);
  const hasSteps = c.weigh >= 0 || c.fixative >= 0 || c.measure >= 0 || c.seq >= 0 || c.block < 0;
  const steps = hasSteps ? body.filter((r) => str(get(r, 'organ'))).map((r, i) => ({ seq: Number(get(r, 'seq')) || i + 1, organ: str(get(r, 'organ'), 80), fixative: str(get(r, 'fixative'), 60),
    freeze: str(get(r, 'freeze'), 60), weigh: yes(get(r, 'weigh')), measure: yes(get(r, 'measure')), description: str(get(r, 'description'), 300) })) : [];
  const organs = c.block >= 0 ? body.filter((r) => str(get(r, 'organ'))).map((r) => ({ block: str(get(r, 'block'), 10), organ: str(get(r, 'organ'), 80), sex: sexOf(get(r, 'sex')), description: c.weigh >= 0 ? '' : str(get(r, 'description'), 300) })) : [];
  if (!steps.length && !organs.length) throw new Error('The table has a header but no organ rows under it.');
  return { name, steps, organs };
}
