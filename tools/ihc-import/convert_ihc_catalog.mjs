#!/usr/bin/env node
// Converts the IHC department's assay database export (CSV) into:
//   1. src/SeedData/ihc-assays.json   the assay catalog the pilot loads
//   2. docs/ihc-catalog-review.md     what was repaired or looks wrong, for the IHC team to check
//
//   node tools/ihc-import/convert_ihc_catalog.mjs "MHL IHC database.csv"
//   node tools/ihc-import/convert_ihc_catalog.mjs "MHL IHC database.csv" --out-json x.json --out-report y.md
//
// The export this expects (as of November 2026): a two-row header (Antibody, Dilution & Time, Antigen Retrieval,
// Proteolytic Digestion, 2° AB Kit, Fixative, Species, Control Tissue, Manufacturer, Catalog Num), one protocol per row,
// and rows that say only "DOUBLE STAIN", which mark the next two protocols as the first and second stain of a pair.
// Needs Node.js 18 or later and nothing else.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseCsv, decodeExcelDilution, fixExcelDateName, deriveAssay, kindLabel, ASSAY_FIELDS, FLAG_TEXT } from '../../pilot/core/ihc.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : fallback; };
const input = args.find((a, i) => !a.startsWith('--') && !args[i - 1]?.startsWith('--'));
if (!input) { console.error('Usage: node convert_ihc_catalog.mjs "<export>.csv" [--out-json file] [--out-report file]'); process.exit(1); }
const outJson = opt('--out-json', path.join(lims, 'src', 'SeedData', 'ihc-assays.json'));
const outReport = opt('--out-report', path.join(lims, 'docs', 'ihc-catalog-review.md'));

const rows = parseCsv(readFileSync(input, 'utf8').replace(/^﻿/, ''));
const header = rows[0].slice(0, 10).map((h, i) => `${h} ${rows[1][i] || ''}`.replace(/\s+/g, ' ').trim());
const expected = ['Antibody', 'Dilution & Time', 'Antigen Retrieval', 'Proteolytic Digestion', '2° AB Kit', 'Fixative', 'Species', 'Control Tissue', 'Manufacturer', 'Catalog Num'];
if (header.join('|') !== expected.join('|')) { console.error(`Unexpected columns:\n  ${header.join(' | ')}\nExpected:\n  ${expected.join(' | ')}`); process.exit(1); }
const keys = ASSAY_FIELDS.map(([k]) => k);

// ---- 1. records, double-stain markers, Excel repairs ----
const assays = []; const groups = []; let open = null;
for (let i = 2; i < rows.length; i++) {
  const r = rows[i].slice(0, 10).map((x) => x.trim());
  const line = i + 1;
  if (!r.some(Boolean)) continue;
  if (r[0].toUpperCase() === 'DOUBLE STAIN' && !r.slice(1).some(Boolean)) { open = { line, members: [] }; groups.push(open); continue; }
  const fields = Object.fromEntries(keys.map((k, j) => [k, r[j]]));
  const flags = []; const repairs = {};
  const dil = decodeExcelDilution(fields.dilution);
  if (dil.recovered) { fields.dilution = dil.value; flags.push('dilution-recovered'); repairs.dilution = dil.stored; }
  const nm = fixExcelDateName(fields.name);
  if (nm.recovered) { fields.name = nm.value; flags.push('name-recovered'); repairs.name = nm.stored; }
  const a = { id: assays.length + 1, ...fields, ...deriveAssay(fields), status: 'Active', list: null, sourceLine: line, flags, repairs, doubleStain: null, components: null, notes: '' };
  if (!a.species) a.flags.push('species-blank');
  else if (a.speciesOther.length) a.flags.push('species-unrecognized');
  if (!a.retrieval) a.flags.push('retrieval-blank');
  if (open && open.members.length < 2) { open.members.push(a.id); a.doubleStain = { order: open.members.length, line: open.line }; if (open.members.length === 2) open = null; }
  else open = null;
  assays.push(a);
}

// ---- 2. the export holds two alphabetical lists; record which one each protocol came from ----
const sortKey = (s) => s.normalize('NFD').replace(/[^\w]/g, '').toLowerCase();
let list = 1; let prev = null; let listTwoStart = null;
for (const a of assays) {
  if (a.doubleStain) { a.list = list; continue; }
  const k = sortKey(a.name);
  if (list === 1 && prev && /^[a-c0-9]/.test(k) && (/^[u-z]/.test(prev) || prev === '')) { list = 2; listTwoStart = a; }
  a.list = list; prev = k;
}

// ---- 3. exact duplicates ----
const seen = new Map();
for (const a of assays) {
  const sig = keys.map((k) => a[k]).join('\u0001');
  if (seen.has(sig)) { a.status = 'Duplicate'; a.flags.push('duplicate'); a.duplicateOf = seen.get(sig); } else seen.set(sig, a.id);
}

// ---- 4. each complete double-stain pair becomes one requestable entry, like the "Duplex" panels ----
const byId = (id) => assays.find((x) => x.id === id);
const incomplete = []; const same = []; const pairs = [];
for (const g of groups) {
  if (g.members.length < 2) { incomplete.push(g); g.members.forEach((id) => byId(id).flags.push('double-incomplete')); continue; }
  const [x, y] = g.members.map(byId);
  const sameProtocol = keys.every((k) => x[k] === y[k]);
  if (sameProtocol) { same.push(g); x.flags.push('double-same'); y.flags.push('double-same'); continue; }
  pairs.push([x, y, g]);
}
for (const [x, y, g] of pairs) {
  const both = (k) => (x[k] === y[k] ? x[k] : `1st: ${x[k] || '-'} | 2nd: ${y[k] || '-'}`);
  const fields = Object.fromEntries(keys.map((k) => [k, both(k)]));
  const short = (n) => n.replace(/\s*\((1st|2nd)\b[^)]*\)/i, '');
  fields.name = `Double stain: ${short(x.name)} + ${short(y.name)}`;
  const fluor = [x, y].some((a) => a.kind === 'Opal') ? { kind: 'Opal', chromogen: 'Opal' } : [x, y].some((a) => a.kind === 'IF') ? { kind: 'IF', chromogen: 'Fluorescent' } : { kind: 'IHC', chromogen: [x.chromogen, y.chromogen].join(' + ') };
  const d = deriveAssay({ ...fields, kit: `${x.kit} ${y.kit}` });
  const tagsBoth = (k) => x[k].filter((t) => y[k].includes(t));
  const entry = {
    id: assays.length + 1, ...fields, ...d, ...fluor, plex: 2, platform: x.platform === y.platform ? x.platform : 'Mixed',
    speciesTags: tagsBoth('speciesTags'), speciesOther: [], fixTags: tagsBoth('fixTags'),
    status: 'Active', list: x.list, sourceLine: g.line, flags: [], repairs: {}, doubleStain: null, components: [x.id, y.id], notes: '',
  };
  assays.push(entry);
  for (const a of [x, y]) a.partOf = [...(a.partOf || []), entry.id];
}

// ---- write the catalog ----
const counts = {
  rows: rows.length - 2, protocols: assays.filter((a) => !a.components).length, doubleStainEntries: pairs.length,
  antibodies: new Set(assays.filter((a) => !a.components).map((a) => a.name.toLowerCase())).size,
  duplicates: assays.filter((a) => a.status === 'Duplicate').length,
  dilutionsRecovered: assays.filter((a) => a.flags.includes('dilution-recovered')).length,
};
const catalog = {
  name: 'MHL IHC assay database', source: path.basename(input), convertedOn: new Date().toISOString().slice(0, 10),
  columns: ASSAY_FIELDS.map(([k, label], i) => ({ key: k, label, sourceColumn: expected[i] })), counts,
  // Compact: leave out empty fields; the pilot fills in defaults when it loads the catalog.
  assays: assays.map(({ speciesOther, ...a }) => Object.fromEntries(Object.entries(a).filter(([, v]) => v !== null && v !== '' && !(Array.isArray(v) && !v.length) && !(typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length)))),
};
writeFileSync(outJson, JSON.stringify(catalog).replace(/\},\{"id"/g, '},\n{"id"') + '\n');

// ---- write the review ----
const md = []; const p = (s = '') => md.push(s);
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|');
const tally = (pick) => { const m = new Map(); for (const a of assays.filter((x) => !x.components)) { const v = pick(a); m.set(v, (m.get(v) || 0) + 1); } return [...m].sort((a, b) => b[1] - a[1]); };
p('# IHC assay catalog review');
p();
p(`Generated by \`tools/ihc-import/convert_ihc_catalog.mjs\` from **${esc(path.basename(input))}** on ${catalog.convertedOn}. It lists what the converter repaired and what looks wrong, so the IHC team can confirm or correct it before the catalog is used for real requests.`);
p();
p('## Summary');
p();
p('| | Count |');
p('|---|---|');
p(`| Rows in the export (after the two header rows) | ${counts.rows} |`);
p(`| Protocols | ${counts.protocols} |`);
p(`| Distinct antibody names | ${counts.antibodies} |`);
p(`| "DOUBLE STAIN" markers | ${groups.length} |`);
p(`| Double stains made into requestable entries | ${pairs.length} |`);
p(`| Dilutions recovered from Excel time values | ${counts.dilutionsRecovered} |`);
p(`| Exact duplicate rows (hidden from the request form) | ${counts.duplicates} |`);
p(`| Catalog entries written | ${assays.length} |`);
p();
p('By kind of assay (protocols only):');
p();
p('| Kind | Protocols |');
p('|---|---|');
for (const [k, n] of tally((a) => kindLabel(a))) p(`| ${esc(k)} | ${n} |`);
p();
p('## 1. Dilutions that Excel had turned into times');
p();
p(`Excel reads a dilution such as \`1:100\` as a time of day (1 hour and 100 minutes) and stores it as a fraction of a day, \`0.111111111\`. ${counts.dilutionsRecovered} dilutions were stored this way. Each was converted back with 1:N = (value × 24 − 1) × 60, and every one came out as a whole number, which suggests the conversion is right. Dilutions with text after them (for example \`1:50 ON4C\` or \`1:100 60'\`) were not affected. The recovered dilutions carry **no incubation time**, while most typed ones do; please check a few against the protocol binder and confirm whether a default time applies.`);
p();
p('| Stored value | Restored | Protocols |');
p('|---|---|---|');
const dl = new Map();
for (const a of assays.filter((x) => x.repairs.dilution)) { const k = `${a.repairs.dilution}|${a.dilution}`; dl.set(k, (dl.get(k) || 0) + 1); }
for (const [k, n] of [...dl].sort((a, b) => Number(a[0].split('|')[0]) - Number(b[0].split('|')[0]))) { const [s, v] = k.split('|'); p(`| ${s} | ${v} | ${n} |`); }
p();
p('The example on the saved request form agrees: CD8 (Abcam ab101500) is stored as `0.111111111` in the export and shown as `1:100` on the request.');
p();
p('## 2. Antibody names that Excel had turned into dates');
p();
for (const a of assays.filter((x) => x.repairs.name)) p(`- Line ${a.sourceLine}: \`${esc(a.repairs.name)}\` restored as **${esc(a.name)}** (${esc(a.manufacturer)} ${esc(a.catalog)}).`);
p();
p('Other names that look like dates to Excel (for example Sept or March gene names) were not found, but future exports should be saved as text or straight from the database to avoid this.');
p();
p('## 3. Double stains');
p();
p(`Each "DOUBLE STAIN" row marks the next two protocols as the first and second stain of a pair; for example, line 112 is "CD3 (1st of double stain with CD45R)" and line 113 is "CD45R/B220 (2nd of double stain with CD3)". The converter kept both protocols and added a combined entry for each complete pair (${pairs.length}), so a pair can be requested as one stain, like the "Duplex" panels.`);
p();
p('| Marker line | First stain | Second stain | Entry |');
p('|---|---|---|---|');
for (const [x, y, g] of pairs) p(`| ${g.line} | ${esc(x.name)} (#${x.id}) | ${esc(y.name)} (#${y.id}) | #${x.partOf.at(-1)} |`);
if (incomplete.length || same.length) {
  p();
  p('Markers that could not be paired:');
  p();
  for (const g of incomplete) p(`- Line ${g.line}: only ${g.members.length ? `one protocol (${esc(byId(g.members[0]).name)}, #${g.members[0]})` : 'no protocol'} follows before the next marker.`);
  for (const g of same) p(`- Line ${g.line}: both protocols are identical (${esc(byId(g.members[0]).name)}, #${g.members.join(' and #')}).`);
}
p();
p('**Question for the IHC team:** is this reading of the marker right, and does the database store the pairing anywhere else?');
p();
p('## 4. Exact duplicates');
p();
p(`${counts.duplicates} rows are identical, field for field, to an earlier row. They are kept in the catalog, marked Duplicate, and hidden from the request form.`);
p();
for (const a of assays.filter((x) => x.status === 'Duplicate')) p(`- #${a.id} (line ${a.sourceLine}) ${esc(a.name)} repeats #${a.duplicateOf} (line ${byId(a.duplicateOf).sourceLine}).`);
p();
p(`Separately, ${tally((a) => a.name.toLowerCase()).filter(([, n]) => n > 1).length} antibody names have more than one protocol. That is expected (different species, fixatives or detection systems), but some may be outdated versions worth retiring.`);
p();
p('## 5. Two lists in one export');
p();
p(listTwoStart ? `The rows run A to Z once, then start again at line ${listTwoStart.sourceLine} (${esc(listTwoStart.name)}) and run A to Z a second time. The second run has more frozen-section, ethanol and manually detected protocols. Each entry records which run it came from ("list 1" or "list 2"). **Question:** are these two tables in the database (for example current and archived protocols)?` : 'The export runs A to Z once.');
p();
p('## 6. Species and fixative wording');
p();
p('The request form matches assays to the sample\'s species and fixative, so the free-text values were mapped to standard terms. The original text is kept unchanged.');
p();
p('| Species text in the export | Protocols | Read as |');
p('|---|---|---|');
for (const [v, n] of tally((a) => a.species)) { const a = assays.find((x) => x.species === v && !x.components); p(`| ${esc(v || '(blank)')} | ${n} | ${esc(a.speciesTags.join(', ') || '(none)')}${a.speciesOther.length ? ` + unrecognized: ${esc(a.speciesOther.join(', '))}` : ''} |`); }
p();
p('| Fixative text in the export | Protocols | Read as |');
p('|---|---|---|');
for (const [v, n] of tally((a) => a.fixative)) { const a = assays.find((x) => x.fixative === v && !x.components); p(`| ${esc(v)} | ${n} | ${esc(a.fixTags.join(', ') || '(none)')} |`); }
p();
p('"Hu in Rabbit" and "Hu in Pig" were not recognized. **Question:** what do they mean?');
p();
p('## 7. Other gaps');
p();
p(`- Protocols with no species: ${assays.filter((a) => a.flags.includes('species-blank')).length}.`);
p(`- Protocols with no antigen retrieval: ${assays.filter((a) => a.flags.includes('retrieval-blank')).length}.`);
p('- The export has no assay ID, no active/retired status and no date last validated. The pilot gives each entry a number (#1, #2, ...) in export order; the real database ID should replace it when the database itself is migrated.');
p('- A few control-tissue entries name the person whose blocks are used as controls. That is fine internally, but worth knowing if the catalog is ever shown to investigators.');
p();
p('## What each flag in the pilot means');
p();
for (const [k, v] of Object.entries(FLAG_TEXT)) p(`- **${k}**: ${v}`);
writeFileSync(outReport, md.join('\n') + '\n');

console.log(`Wrote ${outJson}: ${assays.length} entries (${counts.protocols} protocols, ${pairs.length} double stains, ${counts.duplicates} duplicates, ${counts.dilutionsRecovered} dilutions recovered).`);
console.log(`Wrote ${outReport}`);
if (listTwoStart) console.log(`Second alphabetical list starts at line ${listTwoStart.sourceLine} (${listTwoStart.name}).`);
