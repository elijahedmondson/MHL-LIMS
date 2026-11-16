// Tests for outside IHC sources (November 2026): identifiers on each assay (target gene, UniProt, RRID), links to the
// Human Protein Atlas, Antibody Registry, Antibodypedia, CiteAb, NordiQC and ImmunoQuery, saved pages, reading the HPA
// and registry download files in pieces (plain, .zip, .gz), suggestions and accepting them, and the upgrade to version 9.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gzipSync, deflateRawSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore, upgradeToV9, loadAssays } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as O from '../core/outside.mjs';
import * as IHC from '../core/ihc.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const samples = path.join(here, '..', 'samples', 'outside-sources');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-16';
const seeded = seedState({ priceList, ihcCatalog, today: TODAY });

function fresh() {
  const state = structuredClone(seeded);
  state.settings.initials = 'QA';
  const core = createCore({ state, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T12:00:00` } });
  const call = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`); return r.file || r.json; };
  const fails = (method, p, body = null) => { const r = core.handle(method, p, {}, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { state, core, call, fails };
}
const sample = (name) => new File([readFileSync(path.join(samples, name))], name);
const byName = (t, name, catalogStart = '') => t.state.assays.find((a) => a.name === name && a.catalog.startsWith(catalogStart) && a.status === 'Active');

// Reads an HPA file the way the browser does and sends what it keeps to the core.
async function importHpa(t, file, version = '26.0') {
  const w = t.call('GET', '/api/ihc/outside').wants;
  const reader = O.hpaReader({ wanted: w.symbols, wantedTissue: w.tissueSymbols, wantedAntibodies: w.antibodies });
  const lines = O.lineSplitter((l) => reader.line(l));
  const info = await O.readTextChunks(file, (c) => lines.push(c));
  lines.end();
  const out = reader.result();
  return { info, out, res: t.call('POST', '/api/ihc/outside/hpa', { ...out, version, file: file.name }) };
}
async function importRegistry(t, file) {
  const w = t.call('GET', '/api/ihc/outside').wants;
  const reader = O.registryReader({ catalogs: w.catalogs });
  const csv = O.csvSplitter((r) => reader.row(r), 'auto');
  await O.readTextChunks(file, (c) => csv.push(c), { entry: /\.(csv|tsv|txt)$/i });
  csv.end();
  const out = reader.result();
  return { out, res: t.call('POST', '/api/ihc/outside/registry', { ...out, file: file.name }) };
}

// ---------- identifiers ----------
test('RRIDs, UniProt accessions and gene symbols are read in the forms people paste them', () => {
  for (const v of ['AB_2722', 'RRID:AB_2722', 'rrid: ab_2722', 'https://www.antibodyregistry.org/AB_2722', 'https://scicrunch.org/resolver/RRID:AB_2722']) assert.equal(O.readRrid(v).value, 'AB_2722', v);
  assert.equal(O.readRrid('n/a').value, 'N/A');
  assert.match(O.readRrid('RRID:CVCL_0030').error, /not an antibody RRID/);
  assert.match(O.readRrid('https://evil.example/AB_2722').error, /looks like AB_/);
  assert.match(O.readRrid('2722').error, /looks like AB_/);
  assert.equal(O.readUniprot('p46013 q61263').value, 'P46013, Q61263');
  assert.equal(O.readUniprot('A0A024R161').value, 'A0A024R161');
  assert.match(O.readUniprot('P4601').error, /not a UniProt accession/);
  assert.equal(O.readGene('Mki67').value, 'Mki67');
  assert.equal(O.readGene('NKX2-1').value, 'NKX2-1');
  assert.equal(O.readGene('none').value, 'N/A');
  assert.match(O.readGene('CD8 alpha').error, /one word/);
});

test('saved pages must be plain web addresses on the chosen source; notes are short summaries', () => {
  assert.deepEqual(O.readReference({ source: 'citeab', url: 'https://www.citeab.com/antibodies/1896847-ab16667', note: ' Most cited  for IHC-P ' }).value,
    { source: 'citeab', url: 'https://www.citeab.com/antibodies/1896847-ab16667', note: 'Most cited for IHC-P' });
  assert.match(O.readReference({ source: 'citeab', url: 'javascript:alert(1)' }).error, /https/);
  assert.match(O.readReference({ source: 'nordiqc', url: 'https://nordiqc.org.evil.example/x' }).error, /not on NordiQC/);
  assert.ok(O.readReference({ source: 'nordiqc', url: 'https://www.nordiqc.org/protocol_view.php?id=36760' }).value);
  assert.ok(O.readReference({ source: 'other', url: 'https://www.abcam.com/datasheet.pdf' }).value, 'other accepts any https page');
  assert.ok(O.readReference({ source: 'immunoquery', note: 'Checked the panel for PDX lymphoma' }).value, 'a note alone is fine');
  assert.match(O.readReference({ source: 'antibodypedia', note: 'x'.repeat(401) }).error, /400 characters/);
  assert.match(O.readReference({ source: 'wiki', url: 'https://a.b' }).error, /Choose which source/);
});

test('catalog numbers and vendors are compared the way the registry writes them', () => {
  assert.equal(O.catalogRaw('NBP2-59627B (biotin ms IgG1)'), 'NBP2-59627B');
  assert.equal(O.catalogRaw('226 308 (g.pig)'), '226308');
  assert.equal(O.catalogRaw('Cat# ab101500'), 'AB101500');
  assert.equal(O.catalogRaw('ab133616 (rabb mAb), ab101500 (rabb mAb)'), '', 'several antibodies have no single catalog number');
  assert.equal(O.catalogRaw('CP 290 (rabb pAb); MCA1477 (rat IgG1)'), '');
  assert.ok(O.vendorsMatch('PharMingen', 'BD Biosciences'));
  assert.ok(O.vendorsMatch('eBioscience', 'Thermo Fisher Scientific'));
  assert.ok(O.vendorsMatch('Cell Signaling', 'Cell Signaling Technology'));
  assert.ok(!O.vendorsMatch('Abcam', 'Santa Cruz Biotechnology'));
  assert.equal(O.hpaAntibodyId('HPA002198 (rabb pAb)'), 'HPA002198');
});

test('target genes are suggested from common IHC names, never for panels, and N/A for tags', () => {
  const sym = (name) => O.targetCandidates({ name, catalog: 'x', plex: 1 })[0]?.symbol;
  assert.deepEqual(['Ki67', 'F4/80', 'CD45R/ B220', 'Cadherin (E-Cadherin)', 'Actin, α-Smooth Muscle', 'CD79α', 'CD3 (1st of double stain with CD45R)', 'c-myc (a/Hu)', 'CD68 (method for bones)', 'Androgen Receptor'].map(sym),
    ['MKI67', 'ADGRE1', 'PTPRC', 'CDH1', 'ACTA2', 'CD79A', 'CD3E', 'MYC', 'CD68', 'AR']);
  assert.deepEqual(['GFP', 'BrdU', 'ApopTag (Tunel)', '2A Peptide (3H4)'].map(sym), ['N/A', 'N/A', 'N/A', 'N/A']);
  assert.equal(sym('AASS'), 'AASS', 'a name written like a symbol is offered to check');
  assert.equal(sym('Decorin'), 'DCN');
  assert.deepEqual(O.targetCandidates({ name: '6-plex CD4+CD8+FoxP3+PDL1+PD1+CD45', catalog: 'ab133616, ab101500', plex: 6 }), []);
  assert.deepEqual(O.targetCandidates({ name: 'Double stain: CD45 + Ki67', catalog: '13917, 9027', plex: 2, components: [1, 2] }), []);
});

test('links: exact pages when the gene, RRID or HPA antibody is known, searches otherwise, and every source listed', () => {
  const a = { name: 'Ki67', catalog: '9027 (rabb mAb)', manufacturer: 'Cell Signaling Technology', plex: 1, target: '', rrid: '', refs: [] };
  const links = O.sourceLinks(a);
  assert.deepEqual(links.map((s) => s.key), ['hpa', 'registry', 'antibodypedia', 'citeab', 'nordiqc', 'immunoquery']);
  assert.equal(links[0].links[0].url, 'https://www.proteinatlas.org/search/Ki67');
  assert.equal(links[1].links[0].url, 'https://rrid.site/data/source/nif-0000-07730-1/search?q=9027');
  assert.equal(links.find((s) => s.key === 'citeab').search, '9027 Cell Signaling Technology');
  const known = O.sourceLinks({ ...a, target: 'MKI67', rrid: 'AB_2687824', refs: [{ source: 'citeab', url: 'https://www.citeab.com/antibodies/1', note: '' }] }, { hpaGene: { gene: 'MKI67', ensembl: 'ENSG00000148773' } });
  assert.equal(known[0].links[0].url, 'https://www.proteinatlas.org/ENSG00000148773-MKI67');
  assert.equal(known[1].links[0].url, 'https://www.antibodyregistry.org/AB_2687824');
  assert.equal(known.find((s) => s.key === 'antibodypedia').search, 'MKI67');
  assert.equal(known.find((s) => s.key === 'citeab').saved.length, 1);
  assert.equal(O.sourceLinks({ ...a, catalog: 'HPA002198 (rabb pAb)' })[0].links.at(-1).url, 'https://www.proteinatlas.org/search/HPA002198');
  // Antibodypedia, CiteAb, NordiQC and ImmunoQuery are link-only: never imported.
  assert.deepEqual(O.SOURCES.filter((s) => s.use === 'import').map((s) => s.key), ['hpa', 'registry']);
});

// ---------- reading the files ----------
test('text arriving in pieces: lines and quoted CSV fields split across pieces', () => {
  const lines = []; const ls = O.lineSplitter((l) => lines.push(l));
  for (const piece of ['a\tb\r', '\nc', '\td\n', 'e']) ls.push(piece);
  ls.end();
  assert.deepEqual(lines, ['a\tb', 'c\td', 'e']);
  const rows = []; const cs = O.csvSplitter((r) => rows.push(r));
  const text = 'x,y\r\n1,"a, ""b""\nc"\r\n2,plain\r\n';
  for (let i = 0; i < text.length; i += 3) cs.push(text.slice(i, i + 3));   // every quote and comma at a piece boundary somewhere
  cs.end();
  assert.deepEqual(rows, [['x', 'y'], ['1', 'a, "b"\nc'], ['2', 'plain']]);
});

test('the HPA sample is read the same from .tsv, .tsv.zip and .gz; only genes the catalog needs are kept', async () => {
  const wants = O.importWants(loadAssays(ihcCatalog));
  const read = async (file) => {
    const r = O.hpaReader({ wanted: wants.symbols, wantedAntibodies: wants.antibodies });
    const ls = O.lineSplitter((l) => r.line(l));
    const info = await O.readTextChunks(file, (c) => ls.push(c));
    ls.end();
    return { info, out: r.result() };
  };
  const tsv = await read(sample('proteinatlas-sample.tsv'));
  const zip = await read(sample('proteinatlas-sample.tsv.zip'));
  const gz = await read(new File([gzipSync(readFileSync(path.join(samples, 'proteinatlas-sample.tsv')))], 'proteinatlas.tsv.gz'));
  assert.equal(zip.info.name, 'proteinatlas.tsv');
  assert.deepEqual(zip.out, tsv.out); assert.deepEqual(gz.out, tsv.out);
  assert.equal(tsv.out.kind, 'summary');
  assert.equal(tsv.out.rows, 12);
  const genes = tsv.out.genes.map((g) => g.gene);
  assert.ok(genes.includes('MKI67') && genes.includes('ALDOB') && genes.includes('PTPRC'));
  assert.ok(!genes.includes('TTN') && !genes.includes('MIB1'), 'genes no catalog name points to are left out');
  const mki = tsv.out.genes.find((g) => g.gene === 'MKI67');
  assert.deepEqual([mki.ensembl, mki.uniprot, mki.reliabilityIH, mki.antibodies[0]], ['ENSG00000148773', ['P46013'], 'Enhanced', { id: 'HPA999001', rrid: 'AB_9990001' }]);
  assert.deepEqual(tsv.out.missing, []);
});

test('a .zip written by another tool (stored, not compressed) and a damaged file are handled', async () => {
  // A minimal zip with one stored entry, built by hand.
  const data = Buffer.from('Gene\tEnsembl\tGene synonym\nMKI67\tENSG00000148773\tKi-67\n');
  const name = Buffer.from('folder/proteinatlas.tsv');
  const crc = 0;   // not checked by the reader
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(0, 8); local.writeUInt32LE(crc, 14); local.writeUInt32LE(data.length, 18); local.writeUInt32LE(data.length, 22); local.writeUInt16LE(name.length, 26);
  const central = Buffer.alloc(46); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(0, 10); central.writeUInt32LE(data.length, 20); central.writeUInt32LE(data.length, 24); central.writeUInt16LE(name.length, 28); central.writeUInt32LE(0, 42);
  const cdStart = local.length + name.length + data.length;
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(central.length + name.length, 12); eocd.writeUInt32LE(cdStart, 16);
  const zip = Buffer.concat([local, name, data, central, name, eocd]);
  let text = '';
  const info = await O.readTextChunks(new File([zip], 'x.zip'), (c) => { text += c; });
  assert.equal(info.name, 'proteinatlas.tsv');
  assert.equal(text, data.toString());
  // A deflated entry made with zlib reads the same.
  const def = deflateRawSync(data);
  const local2 = Buffer.from(local); local2.writeUInt16LE(8, 8); local2.writeUInt32LE(def.length, 18);
  const central2 = Buffer.from(central); central2.writeUInt16LE(8, 10); central2.writeUInt32LE(def.length, 20);
  const eocd2 = Buffer.from(eocd); eocd2.writeUInt32LE(local.length + name.length + def.length, 16);
  text = '';
  await O.readTextChunks(new File([Buffer.concat([local2, name, def, central2, name, eocd2])], 'y.zip'), (c) => { text += c; });
  assert.equal(text, data.toString());
  await assert.rejects(O.readTextChunks(new File([zip.subarray(0, 40)], 'cut.zip'), () => {}), /damaged or incomplete/);
  const noTsv = Buffer.from(zip); noTsv.write('folder/proteinatlas.xls', local.length); noTsv.write('folder/proteinatlas.xls', cdStart + central.length);
  await assert.rejects(O.readTextChunks(new File([noTsv], 'n.zip'), () => {}), /no \.tsv or \.csv file inside/);
});

test('a file that is not an HPA download, or a registry file without the right columns, says so', () => {
  const r = O.hpaReader({ wanted: ['MKI67'] });
  assert.throws(() => r.line('Name,Value,Other'), /not a tab-separated HPA download/);
  const r2 = O.hpaReader({ wanted: ['MKI67'] });
  assert.throws(() => r2.line('A\tB\tC\tD'), /not those of an HPA download/);
  const g = O.registryReader({ catalogs: ['ab101500'] });
  assert.throws(() => g.row(['name', 'vendor', 'price']), /RRID .*catalog number column/);
  assert.throws(() => O.hpaReader().result(), /empty/);
});

test('the registry reader keeps only rows matching the catalog: same number, sizes ("14-0195" -> "14-0195-82") and letter suffixes', () => {
  const g = O.registryReader({ catalogs: ['14-0195 (rat IgG2a)', '9027', 'ab101500', 'ab1, ab2'] });
  for (const row of [['rrid', 'catalog_num', 'vendor'], ['AB_1', '14-0195-82', 'eBioscience'], ['AB_2', '9027S', 'CST'], ['3', 'AB101500', 'Abcam'], ['AB_4', 'ab1', 'Abcam'], ['AB_5', '14-01955', 'X'], ['', '9027', 'Y']]) g.row(row);
  const out = g.result();
  assert.deepEqual(out.kept.map((r) => r.rrid), ['AB_1', 'AB_2', 'AB_3']);
  assert.equal(out.rows, 6);
});

// ---------- the core ----------
test('importing the sample files: HPA data on the assay, RRIDs suggested on catalog number and vendor, and the HPA antibody', async () => {
  const t = fresh();
  const { res } = await importHpa(t, sample('proteinatlas-sample.tsv.zip'));
  assert.deepEqual(res, { kind: 'summary', kept: 10 });
  const tis = await importHpa(t, sample('normal_tissue-sample.tsv'));
  assert.equal(tis.out.kind, 'tissue');
  assert.ok(!tis.out.tissue.some((x) => x.gene === 'TTN'));
  assert.ok(tis.out.tissue.find((x) => x.gene === 'MKI67').rows.every((r) => r.level !== 'Not detected'), 'Not detected rows are not kept');
  const reg = await importRegistry(t, sample('antibody-registry-sample.csv'));
  assert.equal(reg.out.rows, 47);
  assert.equal(reg.res.kept, 7);
  const ki = byName(t, 'Ki67', '9027');
  let d = t.call('GET', `/api/ihc/assays/${ki.id}`).outside;
  assert.equal(d.targetSuggestions[0].symbol, 'MKI67');
  assert.equal(d.targetSuggestions[0].strength, 3, 'confirmed by the HPA');
  assert.deepEqual(d.rridSuggestions.map((c) => [c.rrid, c.level]), [['AB_9990102', 'variant']], 'CST 9027S matches; the other vendor\'s 9027 does not');
  t.call('PUT', `/api/ihc/assays/${ki.id}/identifiers`, { target: 'MKI67' });
  d = t.call('GET', `/api/ihc/assays/${ki.id}`).outside;
  assert.equal(d.hpa.gene.reliabilityIH, 'Enhanced');
  assert.equal(d.hpa.tissue.rows[0].level, 'High');
  assert.equal(d.hpa.version, '26.0');
  assert.equal(d.hpa.licence, 'CC BY 4.0');
  assert.equal(d.hpa.notHuman, false);
  assert.equal(d.uniprotFromHpa, 'P46013');
  assert.equal(d.links[0].links[0].url, 'https://www.proteinatlas.org/ENSG00000148773-MKI67');
  const cd8 = byName(t, 'CD8', 'ab101500');
  assert.deepEqual(t.call('GET', `/api/ihc/assays/${cd8.id}`).outside.rridSuggestions[0], { rrid: 'AB_9990101', level: 'exact', why: 'same catalog number and vendor', catalog: 'ab101500', vendor: 'Abcam', name: 'Anti-CD8 antibody (sample record)', clone: 'SAMPLE-1' });
  const aldob = byName(t, 'ALDOB');
  assert.match(t.call('GET', `/api/ihc/assays/${aldob.id}`).outside.rridSuggestions[0].why, /HPA antibody HPA002198/);
  // A mouse protocol shows the human data with a caution.
  const mouse = byName(t, 'CD8a', '14-0195-82');
  t.call('PUT', `/api/ihc/assays/${mouse.id}/identifiers`, { target: 'Cd8a' });
  const m = t.call('GET', `/api/ihc/assays/${mouse.id}`).outside;
  assert.equal(m.hpa.gene.gene, 'CD8A', 'the mouse symbol finds the human gene');
  assert.equal(m.hpa.notHuman, true);
  assert.equal(m.rridSuggestions[0].rrid, 'AB_9990103');
  const s = t.call('GET', '/api/ihc/outside');
  assert.equal(s.hpa.genes, 10); assert.equal(s.registry.rows, 7);
  assert.ok(s.storedKb < 50);
});

test('identifiers are checked, audited and searchable; suggestions disappear once a value is saved', () => {
  const t = fresh();
  const ki = byName(t, 'Ki67', '9027');
  assert.match(t.fails('PUT', `/api/ihc/assays/${ki.id}/identifiers`, { rrid: '12345' }), /^RRID: /);
  assert.match(t.fails('PUT', `/api/ihc/assays/${ki.id}/identifiers`, { target: 'two words' }), /^Target gene: /);
  assert.equal(t.state.assays.find((a) => a.id === ki.id).target, '', 'a failed save changes nothing');
  assert.deepEqual(t.call('PUT', `/api/ihc/assays/${ki.id}/identifiers`, { target: 'MKI67', rrid: 'RRID:AB_9990102', uniprot: 'p46013' }), { id: ki.id, changed: 3 });
  assert.deepEqual(t.call('PUT', `/api/ihc/assays/${ki.id}/identifiers`, { target: 'MKI67' }), { id: ki.id, changed: 0 });
  const d = t.call('GET', `/api/ihc/assays/${ki.id}`);
  assert.equal(d.history[0].action, 'ASSAY_IDS');
  assert.equal(d.history[0].by, 'QA');
  assert.match(d.history[0].detail, /Target gene: \(blank\) → MKI67; UniProt: \(blank\) → P46013; RRID: \(blank\) → AB_9990102/);
  assert.deepEqual([d.outside.targetSuggestions, d.outside.rridSuggestions], [[], []]);
  assert.equal(t.call('GET', '/api/ihc/assays', null, { q: 'mki67' }).assays[0].id, ki.id);
  assert.equal(t.call('GET', '/api/ihc/assays', null, { q: 'RRID:AB_9990102' }).total, 1);
  assert.equal(t.call('GET', '/api/search', null, { q: 'AB_9990102' }).assays.top[0].id, ki.id);
  // The Excel download has the new columns.
  const full = t.call('GET', '/api/ihc/assays', null, { q: `#${ki.id}`, full: '1' }).assays[0];
  assert.deepEqual([full.target, full.rrid, full.uniprot], ['MKI67', 'AB_9990102', 'P46013']);
  const rows = IHC.catalogSheets([full])[0].rows;
  const head = rows[0].map((c) => c.v);
  assert.equal(rows[1][head.indexOf('Target gene')], 'MKI67');
  assert.equal(rows[1][head.indexOf('RRID')], 'AB_9990102');
});

test('saved pages: added with who and when, duplicates refused, removed with a history entry', () => {
  const t = fresh();
  const a = byName(t, 'CD3', 'MCA1477');
  const ref = { source: 'nordiqc', url: 'https://www.nordiqc.org/epitope.php?id=3', note: 'Run 63: several clones optimal; see recommended protocols.' };
  const { id } = t.call('POST', `/api/ihc/assays/${a.id}/refs`, ref);
  assert.match(t.fails('POST', `/api/ihc/assays/${a.id}/refs`, ref), /already saved/);
  assert.match(t.fails('POST', `/api/ihc/assays/${a.id}/refs`, { source: 'citeab', url: 'https://www.nordiqc.org/x' }), /not on CiteAb/);
  let d = t.call('GET', `/api/ihc/assays/${a.id}`);
  assert.deepEqual(d.outside.refs, [{ id, ...ref, savedOn: TODAY, by: 'QA' }]);
  assert.equal(d.outside.links.find((s) => s.key === 'nordiqc').saved[0].url, ref.url);
  t.call('POST', `/api/ihc/assays/${a.id}/refs/${id}/remove`, {});
  d = t.call('GET', `/api/ihc/assays/${a.id}`);
  assert.deepEqual(d.outside.refs, []);
  assert.deepEqual(d.history.slice(0, 2).map((h) => h.action), ['ASSAY_REF_REMOVED', 'ASSAY_REF_ADDED']);
  assert.match(t.fails('POST', `/api/ihc/assays/${a.id}/refs/${id}/remove`, {}), /not found/);
});

test('accepting suggestions fills empty fields only, and the review list and coverage follow', async () => {
  const t = fresh();
  await importHpa(t, sample('proteinatlas-sample.tsv'));
  await importRegistry(t, sample('antibody-registry-sample.csv'));
  const s = t.call('GET', '/api/ihc/outside');
  const cd8 = s.review.find((r) => r.name === 'CD8' && r.catalog.startsWith('ab101500'));
  assert.equal(cd8.rridSuggestion.rrid, 'AB_9990101');
  const taken = byName(t, 'CD31 PECAM-1', 'ab28364');
  t.call('PUT', `/api/ihc/assays/${taken.id}/identifiers`, { target: 'PECAM1' });
  const res = t.call('POST', '/api/ihc/outside/accept', { items: [
    { assayId: cd8.id, field: 'rrid', value: cd8.rridSuggestion.rrid }, { assayId: cd8.id, field: 'target', value: 'CD8A' },
    { assayId: taken.id, field: 'target', value: 'CD31' }, { assayId: 99999, field: 'rrid', value: 'AB_1' }, { assayId: cd8.id, field: 'clone', value: 'x' } ] });
  assert.equal(res.accepted, 2);
  assert.equal(res.skipped.length, 3);
  assert.match(res.skipped.join(' | '), /Target gene is already PECAM1/);
  const a = t.state.assays.find((x) => x.id === cd8.id);
  assert.deepEqual([a.rrid, a.target], ['AB_9990101', 'CD8A']);
  assert.match(t.call('GET', `/api/ihc/assays/${a.id}`).history[0].detail, /accepted from the outside sources review/);
  const after = t.call('GET', '/api/ihc/outside');
  assert.ok(!after.review.some((r) => r.id === cd8.id));
  assert.equal(after.coverage.withTarget, 2);
  assert.equal(after.coverage.withRrid, 1);
  assert.match(t.fails('POST', '/api/ihc/outside/accept', { items: [] }), /Tick the suggestions/);
});

test('imports are checked: wrong shapes are refused, sizes are capped, and removing the data keeps saved identifiers', () => {
  const t = fresh();
  assert.match(t.fails('POST', '/api/ihc/outside/hpa', { kind: 'other', genes: [] }), /proteinatlas\.tsv or normal_tissue\.tsv/);
  assert.match(t.fails('POST', '/api/ihc/outside/hpa', { kind: 'summary', genes: [{ gene: '<script>' }] }), /not a gene symbol/);
  assert.match(t.fails('POST', '/api/ihc/outside/hpa', { kind: 'summary', genes: Array.from({ length: 1501 }, (_, i) => ({ gene: `G${i}` })) }), /More than 1,500/);
  assert.match(t.fails('POST', '/api/ihc/outside/registry', { kept: [{ rrid: 'CVCL_1', catalog: 'x' }] }), /not an antibody RRID/);
  t.call('POST', '/api/ihc/outside/hpa', { kind: 'summary', version: '26.0', file: 'p.tsv', rows: 1, genes: [{ gene: 'MKI67', ensembl: 'ENSG00000148773', uniprot: ['P46013', 'bad'], antibodies: [{ id: 'HPA999001', rrid: 'AB_9990001' }, { id: 'x', rrid: 'y' }], synonyms: ['Ki-67'] }] });
  const g = t.state.outside.hpa.genes.MKI67;
  assert.deepEqual([g.uniprot, g.antibodies], [['P46013'], [{ id: 'HPA999001', rrid: 'AB_9990001' }]]);
  const ki = byName(t, 'Ki67', '9027');
  t.call('PUT', `/api/ihc/assays/${ki.id}/identifiers`, { target: 'MKI67' });
  t.call('POST', '/api/ihc/outside/clear', { which: 'hpa' });
  assert.deepEqual(t.state.outside.hpa.genes, {});
  assert.equal(t.state.assays.find((a) => a.id === ki.id).target, 'MKI67');
  assert.equal(t.call('GET', `/api/ihc/assays/${ki.id}`).outside.hpa, null);
  assert.match(t.fails('POST', '/api/ihc/outside/clear', { which: 'all' }), /hpa or registry/);
  assert.equal(t.state.audit.filter((x) => x.action === 'OUTSIDE_IMPORTED' || x.action === 'OUTSIDE_CLEARED').length, 2);
});

test('saved data from version 8 upgrades: assays get empty identifiers and no saved pages; nothing typed changes', () => {
  const old = structuredClone(seeded);
  for (const a of old.assays) { delete a.target; delete a.uniprot; delete a.rrid; delete a.refs; }
  delete old.outside; old.version = 8;
  const fields = old.assays.map((a) => IHC.ASSAY_FIELDS.map(([k]) => a[k]).join('|'));
  createCore({ state: old, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  assert.equal(old.version, 9);
  assert.ok(old.assays.every((a) => a.target === '' && a.uniprot === '' && a.rrid === '' && Array.isArray(a.refs) && !a.refs.length));
  assert.deepEqual(old.outside.registry, { import: null, rows: [] });
  assert.deepEqual(old.assays.map((a) => IHC.ASSAY_FIELDS.map(([k]) => a[k]).join('|')), fields);
  assert.equal(upgradeToV9(old), false);
});

test('a failed import changes nothing (the request rolls back)', () => {
  const t = fresh();
  t.call('POST', '/api/ihc/outside/hpa', { kind: 'summary', version: '25.0', file: 'a.tsv', rows: 1, genes: [{ gene: 'MKI67' }] });
  t.fails('POST', '/api/ihc/outside/hpa', { kind: 'summary', version: '26.0', file: 'b.tsv', rows: 2, genes: [{ gene: 'CD8A' }, { gene: 'bad gene' }] });
  assert.deepEqual([t.state.outside.hpa.version, Object.keys(t.state.outside.hpa.genes)], ['25.0', ['MKI67']]);
});

test('the standalone bundle has the Outside sources page and the shared readers', () => {
  const src = bundleModules();
  for (const s of ['Outside sources', '/api/ihc/outside', 'Saved pages and notes', 'readTextChunks']) assert.ok(src.includes(s), s);
  const require = new Function(`${LOADER}\n${src}\nreturn __require;`)();
  assert.equal(require('outside').readRrid('RRID:AB_1234').value, 'AB_1234');
});

// ---------- regressions found in review ----------
test('review: "N/A" and unclosed brackets are not catalog numbers', () => {
  assert.equal(O.catalogRaw('N/A (ms)'), '');
  assert.equal(O.catalogRaw('64326 (rabb mAb0'), '64326');
  const a = { name: 'GD2', catalog: 'N/A (ms)', manufacturer: 'Precision Biologics', plex: 1, target: '', rrid: '', refs: [] };
  assert.deepEqual(O.rridCandidates(a, [{ rrid: 'AB_1', catalog: 'N/A', vendor: 'Precision Biologics' }]), []);
  assert.equal(O.sourceLinks(a).find((x) => x.key === 'registry').links[0].url, 'https://www.antibodyregistry.org/', 'no search for "NA"');
  assert.ok(!O.importWants(loadAssays(ihcCatalog)).catalogs.includes('NA'));
});

test('review: a label word in the name (biotin, FITC) does not make it a tag, and never outranks a gene', () => {
  const c = (name, genes = null) => O.targetCandidates({ name, catalog: 'x', plex: 1 }, genes);
  assert.ok(!c('I-Ad, biotin').some((x) => x.symbol === 'N/A'));
  assert.ok(!c('MOMA-1 (FITC conj.)').some((x) => x.symbol === 'N/A'));
  assert.equal(c('CD3 FITC', { CD3E: { gene: 'CD3E', synonyms: [] } })[0].symbol, 'CD3E');
  assert.deepEqual(c('constructor'), [], 'object property names are not aliases');
  assert.equal(c('GFP')[0].strength, 3);
});

test('review: a synonym shared by two genes, or one word of a longer name, is only a hint (not ticked as strong)', () => {
  const genes = { HOPX: { gene: 'HOPX', synonyms: ['HOP'] }, STIP1: { gene: 'STIP1', synonyms: ['HOP'] }, GZMB: { gene: 'GZMB', synonyms: ['Granzyme B'] } };
  const hop = O.targetCandidates({ name: 'Hop', catalog: 'x', plex: 1 }, genes);
  assert.deepEqual(hop.map((x) => [x.symbol, x.strength]), [['HOPX', 1], ['STIP1', 1]]);
  assert.match(hop[0].why, /HOPX and STIP1/);
  assert.equal(O.targetCandidates({ name: 'Granzyme B', catalog: 'x', plex: 1 }, genes)[0].strength, 2, 'a synonym of one gene matching the whole name');
});

test('review: tab-separated registry files, blank lines, and a README beside the data file in a zip', async () => {
  const rows = []; const cs = O.csvSplitter((r) => rows.push(r), 'auto');
  cs.push('rrid\tcatalog_num\tvendor\n'); cs.push('AB_1\tab101500\tAbcam\n'); cs.end();
  assert.deepEqual(rows, [['rrid', 'catalog_num', 'vendor'], ['AB_1', 'ab101500', 'Abcam']]);
  const g = O.registryReader({ catalogs: ['ab101500'] });
  for (const r of [[''], ['rrid', 'catalog_num', 'vendor'], [''], ['AB_1', 'ab101500 (100 ul)', 'Abcam']]) g.row(r);
  assert.deepEqual([g.result().rows, g.result().kept.map((r) => r.rrid)], [1, ['AB_1']]);
  // A zip with README.txt listed before the .tsv reads the .tsv.
  const entry = (name, data) => ({ name: Buffer.from(name), data: Buffer.from(data) });
  const files = [entry('README.txt', 'read me'), entry('proteinatlas.tsv', 'Gene\tEnsembl\tX\n')];
  const locals = []; const centrals = []; let offset = 0;
  for (const f of files) {
    const l = Buffer.alloc(30); l.writeUInt32LE(0x04034b50, 0); l.writeUInt32LE(f.data.length, 18); l.writeUInt32LE(f.data.length, 22); l.writeUInt16LE(f.name.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt32LE(f.data.length, 20); c.writeUInt32LE(f.data.length, 24); c.writeUInt16LE(f.name.length, 28); c.writeUInt32LE(offset, 42);
    locals.push(l, f.name, f.data); centrals.push(c, f.name); offset += 30 + f.name.length + f.data.length;
  }
  const cd = Buffer.concat(centrals);
  const e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(2, 8); e.writeUInt16LE(2, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(offset, 16);
  let text = '';
  const info = await O.readTextChunks(new File([Buffer.concat([...locals, cd, e])], 'hpa.zip'), (c) => { text += c; });
  assert.deepEqual([info.name, text], ['proteinatlas.tsv', 'Gene\tEnsembl\tX\n']);
});

test('review: imports are capped in the core too, odd payloads are refused with a message, and panels take no identifiers', () => {
  const t = fresh();
  assert.match(t.fails('POST', '/api/ihc/outside/hpa', { kind: 'summary', genes: [null] }), /not read correctly/);
  assert.match(t.fails('POST', '/api/ihc/outside/registry', { kept: ['x'] }), /not read correctly/);
  assert.match(t.fails('POST', '/api/ihc/outside/hpa', { kind: 'tissue', tissue: Array.from({ length: 601 }, (_, i) => ({ gene: `G${i}` })) }), /More than 600/);
  assert.match(t.fails('POST', '/api/ihc/outside/registry', { kept: Array.from({ length: 3001 }, () => ({ rrid: 'AB_1', catalog: 'x' })) }), /More than 3,000/);
  t.call('POST', '/api/ihc/outside/registry', { file: 'r.csv', kept: [{ rrid: 'AB_12', catalog: { toString: 'x' }, vendor: 'V' }, { rrid: 'AB_13', catalog: 'ab1', vendor: ['V'] }] });
  assert.deepEqual(t.state.outside.registry.rows.map((r) => [r.rrid, r.catalog, r.vendor]), [['AB_13', 'ab1', '']], 'non-text values are not stored as "[object Object]"');
  // The size budget: a huge tissue import is refused and nothing changes.
  const big = Array.from({ length: 600 }, (_, i) => ({ gene: `G${i}`, rows: Array.from({ length: 16 }, () => ({ tissue: 't'.repeat(60), cell: 'c'.repeat(60), level: 'High' })) }));
  t.call('POST', '/api/ihc/outside/hpa', { kind: 'tissue', file: 'n.tsv', tissue: big.slice(0, 100) });
  const summary = Array.from({ length: 1500 }, (_, i) => ({ gene: `S${i}`, description: 'd'.repeat(160), synonyms: Array.from({ length: 15 }, (_, k) => `syn${k}`.padEnd(40, 'x')) }));
  t.call('POST', '/api/ihc/outside/hpa', { kind: 'summary', file: 'p.tsv', genes: summary });
  assert.match(t.fails('POST', '/api/ihc/outside/hpa', { kind: 'tissue', file: 'n2.tsv', tissue: big }), /more than the pilot can keep/);
  assert.equal(t.state.outside.hpa.tissue.file, 'n.tsv');
  const panel = t.state.assays.find((a) => a.plex > 1 && a.status === 'Active');
  assert.match(t.fails('PUT', `/api/ihc/assays/${panel.id}/identifiers`, { rrid: 'AB_1' }), /several antibodies/);
  assert.equal(t.call('POST', '/api/ihc/outside/accept', { items: [{ assayId: panel.id, field: 'target', value: 'CD8A' }] }).accepted, 0);
});

test('review: the summary page stays quick with a full HPA import (synonym index built once)', () => {
  const t = fresh();
  const genes = Array.from({ length: 1500 }, (_, i) => ({ gene: `G${i}`, synonyms: Array.from({ length: 15 }, (_, k) => `S${i}-${k}`) }));
  t.call('POST', '/api/ihc/outside/hpa', { kind: 'summary', file: 'p.tsv', genes });
  const t0 = Date.now();
  t.call('GET', '/api/ihc/outside');
  t.call('GET', '/api/ihc/outside');
  assert.ok(Date.now() - t0 < 3000, `two summary pages took ${Date.now() - t0} ms`);
});

test('review: the UniProt suggested from the HPA can always be saved', () => {
  const t = fresh();
  t.call('POST', '/api/ihc/outside/hpa', { kind: 'summary', file: 'p.tsv', genes: [{ gene: 'MKI67', uniprot: ['P46013', 'Q5VWH2', 'Q5VWH3', 'Q5VWH4'] }] });
  const ki = byName(t, 'Ki67', '9027');
  t.call('PUT', `/api/ihc/assays/${ki.id}/identifiers`, { target: 'MKI67' });
  const u = t.call('GET', `/api/ihc/assays/${ki.id}`).outside.uniprotFromHpa;
  assert.equal(u.split(', ').length, 3);
  t.call('PUT', `/api/ihc/assays/${ki.id}/identifiers`, { uniprot: u });
});
