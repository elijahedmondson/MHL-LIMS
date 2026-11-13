// Tests for the IHC department's comments on the pilot (November 2026): coding each protocol (public, preferred,
// works or not), clone / host / clonality fields, platform and chromogen detection and setting them by hand, drop-down
// lists, the Excel download of the catalog, changing the stains on an IHC request, and MHL numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore, upgradeToV8, loadAssays } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as IHC from '../core/ihc.mjs';
import { writeXlsx } from '../core/xlsxwrite.mjs';
import { readSheets } from '../core/sheets.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-13';
const seeded = seedState({ priceList, ihcCatalog, today: TODAY });

function fresh() {
  const state = structuredClone(seeded);
  state.settings.initials = 'DOB';
  const core = createCore({ state, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T12:00:00` } });
  const call = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`); return r.file || r.json; };
  const fails = (method, p, body = null) => { const r = core.handle(method, p, {}, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { state, core, call, fails };
}
// The test record the IHC team made, as typed into the form.
const testAssay = (extra = {}) => ({ name: 'test 11-11 11:59', dilution: '1:2000 ONRT', retrieval: 'S2367 20\' 97C', digestion: 'Not used', kit: 'NGS, 2Ab Goat anti-Rabbit HRP',
  fixative: '10% NBF', species: 'Human', control: 'Tonsil', manufacturer: 'DAKO', catalog: 'Mabcd', ...extra });

// ---------- comments 7, 8 and 9: platform and chromogen ----------
test('fluorophores such as "anti-HRP 594" make a stain fluorescent; a fluorescent ApopTag is a fluorescent TUNEL', () => {
  const fl = IHC.deriveAssay(testAssay({ kit: 'NGS, 2Ab Goat anti-Rabbit HRP, anti-HRP 594' }));
  assert.deepEqual([fl.kind, fl.chromogen, IHC.isFluorescent(fl), IHC.kindLabel(fl)], ['IF', 'Fluorescent', true, 'Immunofluorescence']);
  for (const kit of ['Goat anti-rabbit 488', 'AF647 streptavidin', 'CF 568', 'anti-DIG 647']) assert.equal(IHC.classify({ name: 'X', kit }).chromogen, 'Fluorescent', kit);
  for (const kit of ['Bond Polymer Refine DS9800', 'ImmPRESS HRP MP-7401', 'Vectastain ABC PK-6100']) assert.equal(IHC.classify({ name: 'X', kit }).chromogen, 'DAB', kit);
  const tunel = IHC.deriveAssay({ name: 'test 11.11 12:33', kit: 'ApopTag kit anti-DIG 647', species: 'Mouse', fixative: '10% NBF' });
  assert.deepEqual([tunel.kind, tunel.chromogen, IHC.isFluorescent(tunel), IHC.kindLabel(tunel)], ['TUNEL', 'Fluorescent', true, 'TUNEL (fluorescent)']);
  assert.equal(IHC.deriveAssay({ name: 'ApopTag', kit: 'ApopTag kit' }).chromogen, 'DAB', 'the peroxidase kit stays DAB');
});

test('BOND reagents used by hand with an overnight incubation stay a manual stain; a BOND protocol stays Leica Bond', () => {
  assert.equal(IHC.classify({ name: 'X', kit: 'Bond Polymer Reagent from kit DS9800', dilution: '1:2000 ONRT' }).platform, 'Manual');
  for (const dilution of ['1:500 ON 4C', '1:50 ON4C', '1:100 o/n', '1:200 overnight', '1:50 ON RT']) assert.equal(IHC.classify({ name: 'X', kit: 'Bond Polymer Refine', dilution }).platform, 'Manual', dilution);
  assert.equal(IHC.classify({ name: 'X', kit: 'Bond Polymer Refine', dilution: '1:200 15 min' }).platform, 'Leica Bond');
  assert.equal(IHC.classify({ name: 'X', kit: 'Bond Polymer Refine (manual)', dilution: '1:200 30\'' }).platform, 'Manual');
  assert.equal(IHC.classify({ name: 'X', kit: 'Bond Polymer Refine', dilution: '1:200, on Bond' }).platform, 'Leica Bond', 'lower-case "on" is not overnight');
});

test('the catalog file and the rules agree; BOND-reagent protocols with an overnight 4 °C incubation are Manual', () => {
  const now = loadAssays(ihcCatalog);
  const dflt = { kind: 'IHC', plex: 1, chromogen: 'DAB', platform: 'Manual' };
  const drift = ihcCatalog.assays.filter((a, i) => ['kind', 'plex', 'chromogen', 'platform'].some((k) => (a[k] ?? dflt[k]) !== now[i][k]));
  assert.deepEqual(drift.map((a) => a.id), [], 'regenerate src/SeedData/ihc-assays.json with tools/ihc-import when a detection rule changes');
  const overnightBond = now.filter((a) => !a.components && /bond/i.test(a.kit) && /ON4C/.test(a.dilution));
  assert.equal(overnightBond.length, 8);
  assert.ok(overnightBond.every((a) => a.platform === 'Manual'));
});

test('platform and chromogen set by hand win, are shown as set by hand, and change how the stain is priced and scanned', () => {
  const t = fresh();
  const { id } = t.call('POST', '/api/ihc/assays', testAssay({ kit: 'NGS, 2Ab Goat anti-Rabbit HRP, anti-HRP 594' }));
  let a = t.call('GET', `/api/ihc/assays/${id}`).assay;
  assert.deepEqual([a.kind, a.platform, a.chromogen, a.platformSet, a.chromogenSet], ['IF', 'Manual', 'Fluorescent', '', '']);
  t.call('PATCH', `/api/ihc/assays/${id}`, { platformSet: 'Leica Bond', chromogenSet: 'DAB' });
  a = t.call('GET', `/api/ihc/assays/${id}`).assay;
  assert.deepEqual([a.kind, a.platform, a.chromogen, a.auto.chromogen], ['IHC', 'Leica Bond', 'DAB', 'Fluorescent']);
  assert.match(t.call('GET', `/api/ihc/assays/${id}`).history[0].detail, /Platform: worked out from the text → Leica Bond; Chromogen: worked out from the text → DAB/);
  // Back to "work out from the text".
  t.call('PATCH', `/api/ihc/assays/${id}`, { platformSet: '', chromogenSet: '' });
  a = t.call('GET', `/api/ihc/assays/${id}`).assay;
  assert.deepEqual([a.kind, a.platform, a.chromogen], ['IF', 'Manual', 'Fluorescent']);
  // A fluorescent IHC stain is scanned on the Akoya system.
  const w = t.state.ihcRequests.find((x) => x.requester.last === 'Whitcombe');
  const est = IHC.estimateIhc({ ...w, stains: [{ assayId: id }] }, (x) => t.state.assays.find((y) => y.id === x));
  assert.ok(est.lines.some((l) => l.code === 'HP001009'));
  assert.match(t.fails('PATCH', `/api/ihc/assays/${id}`, { platformSet: 'Robot' }), /Platform: choose one of Manual, Leica Bond, Ventana/);
});

// ---------- comments 4, 5, 6 and 9: clone, host, clonality ----------
test('clone, host and clonality are fields of their own; N/A means not applicable and nothing is guessed', () => {
  const t = fresh();
  const { id } = t.call('POST', '/api/ihc/assays', testAssay({ clone: '45', host: 'Rabbit', clonality: 'Monoclonal' }));
  let ab = t.call('GET', `/api/ihc/assays/${id}`).assay.antibody;
  assert.deepEqual([ab.clone, ab.host, ab.clonality, ab.from], ['45', 'Rabbit', 'Monoclonal', { clone: 'entered', host: 'entered', clonality: 'entered' }]);
  // The polyclonal case from comment 6: no "monoclonal" any more.
  t.call('PATCH', `/api/ihc/assays/${id}`, { clone: 'N/A', clonality: 'Polyclonal' });
  ab = t.call('GET', `/api/ihc/assays/${id}`).assay.antibody;
  assert.deepEqual([ab.clone, ab.cloneNotApplicable, ab.host, ab.clonality], ['', true, 'Rabbit', 'Polyclonal']);
  t.call('PATCH', `/api/ihc/assays/${id}`, { clonality: '' });
  assert.equal(t.call('GET', `/api/ihc/assays/${id}`).assay.antibody.clonality, '', 'a clone of N/A is never read as monoclonal');
  // Searching finds the clone.
  t.call('PATCH', `/api/ihc/assays/${id}`, { clone: 'ZX9Q7' });
  assert.deepEqual(t.call('GET', '/api/ihc/assays', null, { q: 'zx9q7' }).assays.map((a) => a.id), [id]);
  assert.match(t.fails('PATCH', `/api/ihc/assays/${id}`, { host: 'Llama' }), /Antibody host: choose one of/);
  assert.match(t.fails('PATCH', `/api/ihc/assays/${id}`, { clonality: 'Mono' }), /Clonality: choose one of Monoclonal, Polyclonal, Not applicable/);
});

test('notes are not read for a clone: "Kit does not have a clone or host" no longer gives "Clone or, monoclonal"', () => {
  const ab = IHC.antibodyInfo({ name: 'test 11.11 12:33', catalog: 'S7100', notes: 'Kit does not have a clone or host.', plex: 1 });
  assert.deepEqual([ab.clone, ab.host, ab.clonality], ['', '', '']);
  assert.equal(IHC.antibodyInfo({ name: 'X', catalog: 'clone N/A', plex: 1 }).clone, '', 'N/A is not a clone');
  assert.equal(IHC.antibodyInfo({ name: 'CD3 (clone SP7)', catalog: 'ab16669', plex: 1 }).clone, 'SP7');
  const kit = IHC.antibodyInfo({ name: 'ApopTag', catalog: 'S7100', clone: 'N/A', host: 'Not applicable', clonality: 'Not applicable', plex: 1 });
  assert.deepEqual([kit.clone, kit.host, kit.clonality], ['', 'Not applicable', 'Not applicable']);
});

// ---------- comments 1 and 3: coding and drop-down lists ----------
test('each protocol is coded public or not, preferred or not, and works / being optimized / did not work', () => {
  const t = fresh();
  const cd8 = t.call('GET', '/api/ihc/assays', null, { q: 'cd8', limit: 'all' }).assays.filter((a) => a.name === 'CD8');
  assert.ok(cd8.length >= 2);
  const [first, second] = cd8;
  assert.deepEqual([first.visibility, first.preferred, first.result], ['Public', false, ''], 'imported protocols start public, not preferred, result not recorded');
  t.call('PATCH', `/api/ihc/assays/${second.id}`, { preferred: true, result: 'Works' });
  t.call('PATCH', `/api/ihc/assays/${first.id}`, { visibility: 'Internal', result: 'Failed' });
  const hist = t.call('GET', `/api/ihc/assays/${first.id}`).history[0].detail;
  assert.equal(hist, 'Public: Public → Not public; Result: Not recorded → Did not work');
  // In a search the preferred protocol comes first and the one that did not work comes last.
  const order = t.call('GET', '/api/ihc/assays', null, { q: 'cd8', limit: 'all' }).assays.filter((a) => a.name === 'CD8').map((a) => a.id);
  assert.equal(order[0], second.id);
  assert.equal(order.at(-1), first.id);
  // Browsing without a search stays alphabetical.
  const browse = t.call('GET', '/api/ihc/assays', null, { limit: 'all' }).assays.map((a) => a.name.toLowerCase());
  assert.deepEqual(browse, [...browse].sort((x, y) => x.localeCompare(y, 'en', { sensitivity: 'base' })));
  // Filters.
  assert.deepEqual(t.call('GET', '/api/ihc/assays', null, { pref: '1' }).assays.map((a) => a.id), [second.id]);
  assert.deepEqual(t.call('GET', '/api/ihc/assays', null, { vis: 'Internal' }).assays.map((a) => a.id), [first.id]);
  assert.deepEqual(t.call('GET', '/api/ihc/assays', null, { result: 'Failed' }).assays.map((a) => a.id), [first.id]);
  assert.equal(t.call('GET', '/api/ihc/assays', null, { result: 'none', limit: 'all' }).total, t.state.assays.filter((a) => a.status === 'Active').length - 2);
  // Choosing a protocol marked "did not work" warns.
  const w = t.state.ihcRequests.find((x) => x.requester.last === 'Whitcombe');
  const warnings = IHC.requestWarnings({ ...w, stains: [{ assayId: first.id }] }, (x) => t.state.assays.find((y) => y.id === x), TODAY);
  assert.ok(warnings.some((x) => /marked "Did not work"/.test(x)));
  assert.match(t.fails('PATCH', `/api/ihc/assays/${first.id}`, { result: 'Maybe' }), /Result: choose one of Works, Optimizing, Failed/);
});

test('the assay form gets its drop-down lists from the catalog, most used first', () => {
  const t = fresh();
  const c = t.call('GET', '/api/ihc/choices');
  assert.ok(c.manufacturer.length > 10 && c.control.length > 10 && c.kit.length > 5 && c.name.length > 100);
  assert.deepEqual(c.hosts.at(-1), 'Not applicable');
  assert.deepEqual(c.platforms, ['Manual', 'Leica Bond', 'Ventana']);
  assert.ok(c.chromogens.includes('Fluorescent'));
  assert.deepEqual(c.results.map(([k]) => k), ['', 'Works', 'Optimizing', 'Failed']);
  const counts = (k) => c[k].map((v) => t.state.assays.filter((a) => String(a[k]).trim().toLowerCase() === v.toLowerCase()).length);
  const kit = counts('kit');
  assert.deepEqual(kit, [...kit].sort((x, y) => y - x), 'kits are listed most used first');
  assert.ok(new Set(c.manufacturer.map((x) => x.toLowerCase())).size === c.manufacturer.length, 'no duplicates that differ only in case');
});

// ---------- comment 2: Excel ----------
test('the whole catalog downloads as an Excel workbook with every column, readable back', async () => {
  const t = fresh();
  const cd8 = t.state.assays.find((a) => a.name === 'CD8');
  t.call('PATCH', `/api/ihc/assays/${cd8.id}`, { clone: 'C8/144B', host: 'Mouse', preferred: true, result: 'Works' });
  const all = t.call('GET', '/api/ihc/assays', null, { status: 'all', limit: 'all', full: '1' }).assays;
  assert.equal(all.length, t.state.assays.length);
  const bytes = writeXlsx(IHC.catalogSheets(all, { today: TODAY, source: 'MHL IHC database.csv' }));
  const { sheets } = await readSheets(bytes, 'catalog.xlsx');
  const rows = sheets[0].grid;
  assert.deepEqual(rows[0], IHC.CATALOG_COLUMNS.map(([h]) => h));
  assert.equal(rows.length, all.length + 1);
  const col = (h) => rows[0].indexOf(h);
  const row = rows.find((r) => String(r[col('#')]) === String(cd8.id));
  assert.deepEqual([row[col('Antibody')], row[col('Antibody clone')], row[col('Antibody host')], row[col('Preferred')], row[col('Result')], row[col('Public')]],
    ['CD8', 'C8/144B', 'Mouse', 'Yes', 'Works', 'Public']);
  assert.equal(sheets[1].name, 'About');
});

// ---------- the two questions: change stains on an IHC request ----------
test('a wrong antibody is replaced before accepting: Whitcombe\'s human CD8 becomes a mouse CD8, with the reason in the history', () => {
  const t = fresh();
  const w = t.state.ihcRequests.find((x) => x.requester.last === 'Whitcombe');
  let d = t.call('GET', `/api/ihc/requests/${w.id}`);
  assert.ok(d.warnings.some((x) => /listed for Human, not mouse/.test(x)));
  const human = w.stains[0];
  const mouse = t.state.assays.find((a) => a.status === 'Active' && /^CD8/.test(a.name) && a.kind === 'IHC' && a.speciesTags.includes('Mouse') && !a.speciesTags.includes('Human') && a.fixTags.includes('NBF'));
  assert.ok(mouse, 'the catalog has a mouse CD8 protocol for NBF');
  const res = t.call('PUT', `/api/ihc/requests/${w.id}/stains`, { stains: [{ assayId: mouse.id, chromogen: 'DAB' }], reason: 'Wrong species: mouse CD8' });
  assert.match(res.change, new RegExp(`^Replaced CD8 #${human.assayId} \\(Human.*\\) with ${mouse.name.replace(/[()]/g, '\\$&')} #${mouse.id} \\(`));
  d = t.call('GET', `/api/ihc/requests/${w.id}`);
  assert.deepEqual(d.request.stains.map((s) => s.assayId), [mouse.id]);
  assert.ok(!d.warnings.some((x) => /listed for Human/.test(x)), 'the species warning is gone');
  assert.equal(d.history[0].action, 'IHC_STAINS_CHANGED');
  assert.match(d.history[0].detail, /Reason: Wrong species: mouse CD8$/);
  assert.equal(d.request.stains[0].snapshot.id, mouse.id);
  assert.match(t.fails('PUT', `/api/ihc/requests/${w.id}/stains`, { stains: [{ assayId: mouse.id, chromogen: 'DAB' }] }), /Nothing changed/);
});

test('a stain is added to an IHC request in progress: the estimate grows by the difference and the worksheet shows it', () => {
  const t = fresh();
  // A failed call rolls the whole state back to a copy, so objects are looked up again after one.
  const W = () => t.state.ihcRequests.find((x) => x.status === 'Accepted' && x.requester.last === 'Varga');
  let w = W();
  const ki67 = t.state.assays.find((a) => a.status === 'Active' && a.name === 'Ki-67' && a.kind === 'IHC' && a.plex === 1);
  const stains = [...w.stains.map((s) => ({ assayId: s.assayId, chromogen: s.chromogen })), { assayId: ki67.id, chromogen: 'DAB' }];
  assert.match(t.fails('PUT', `/api/ihc/requests/${w.id}/stains`, { stains }), /Give a reason/);
  w = W();
  const r = t.state.requests.find((x) => x.id === w.requestId);
  assert.equal(w.workStatus, 'In progress');
  const before = r.estimateTotal;
  const keptLines = structuredClone(r.estimateLines);
  const res = t.call('PUT', `/api/ihc/requests/${w.id}/stains`, { stains, reason: 'Investigator asked for Ki-67 too' });
  assert.match(res.change, /^Added Ki-67 #/);
  // Three blocks: one more section each, three more IHC slides, and three more 20x scans.
  const units = (lines, code) => lines.filter((l) => l.code === code).reduce((n, l) => n + l.units, 0);
  assert.equal(units(r.estimateLines, 'HP006004') - units(keptLines, 'HP006004'), 3);
  assert.equal(units(r.estimateLines, 'HP001006') - units(keptLines, 'HP001006'), 3);
  assert.ok(res.estimateAfter > before && res.estimateBefore === before && r.estimateTotal === res.estimateAfter);
  // Lines the change did not touch keep their price.
  const untouched = keptLines.filter((l) => !['HP006004', 'HP001006', 'HP004001', 'HP004002'].includes(l.code));
  for (const l of untouched) assert.deepEqual(r.estimateLines.find((x) => x.code === l.code && x.section === l.section), l);
  assert.ok(t.state.audit.some((a) => a.action === 'REQUEST_ESTIMATE_CHANGED' && a.entityId === r.id));
  // The kept panel keeps the protocol as it was requested; the new stain is on the worksheet.
  const ws = t.call('GET', `/api/requests/${r.id}/ihc`);
  assert.deepEqual(ws.stains.map((s) => s.assayId), stains.map((s) => s.assayId));
  assert.equal(ws.stains[0].snapshot, w.stains[0].snapshot);
  // Removing it again brings the estimate back.
  t.call('PUT', `/api/ihc/requests/${w.id}/stains`, { stains: stains.slice(0, -1), reason: 'Not needed after all' });
  assert.equal(r.estimateTotal, before);
  // Done work is closed to changes; a request with nothing left to do is refused.
  t.call('POST', `/api/ihc/requests/${w.id}/work`, { status: 'Done' });
  assert.match(t.fails('PUT', `/api/ihc/requests/${w.id}/stains`, { stains, reason: 'x' }), /marked done/);
  const f = t.state.ihcRequests.find((x) => x.requester.last === 'Ferreira');
  assert.match(t.fails('PUT', `/api/ihc/requests/${f.id}/stains`, { stains: [] }), /Keep at least one stain/);
  const declined = t.state.ihcRequests.find((x) => x.status === 'Declined');
  assert.match(t.fails('PUT', `/api/ihc/requests/${declined.id}/stains`, { stains }), /was declined/);
});

// ---------- upgrade, MHL numbers, bundle ----------
test('saved data from version 7 upgrades: assays get the new fields, and nothing typed changes', () => {
  const old = structuredClone(seeded);
  for (const a of old.assays) for (const k of ['clone', 'host', 'clonality', 'platformSet', 'chromogenSet', 'visibility', 'preferred', 'result']) delete a[k];
  old.version = 7;
  const fields = old.assays.map((a) => IHC.ASSAY_FIELDS.map(([k]) => a[k]).join('|'));
  createCore({ state: old, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  assert.equal(old.version, 8);
  assert.ok(old.assays.every((a) => a.visibility === 'Public' && a.preferred === false && a.result === '' && a.clone === '' && a.platformSet === ''));
  assert.deepEqual(old.assays.map((a) => IHC.ASSAY_FIELDS.map(([k]) => a[k]).join('|')), fields);
  assert.equal(upgradeToV8(old), false);
});

test('the lab\'s numbers are called MHL numbers on screens, exports and messages', () => {
  const t = fresh();
  const st = t.state.studies.find((s) => s.zap === 'ZAP2215');
  assert.match(t.call('GET', `/api/studies/${st.id}/export.csv`).content.split('\r\n')[0], /^MHL,Animal/);
  assert.match(t.fails('POST', `/api/bloodwork/results/1/assign`, { phl: '99999999Z' }), /MHL number|not found/);
  const src = bundleModules();
  assert.ok(!/PHL number|PHL#/.test(src), 'no screen or message in the bundle says PHL number');
});

test('the standalone bundle has the new assay form, stain editor and catalog download', () => {
  const src = bundleModules();
  for (const s of ['stainEditor', 'catalogSheets', 'Antibody clone', 'Download the whole catalog (Excel)', 'Change stains…', '/api/ihc/choices']) assert.ok(src.includes(s), s);
  const require = new Function(`${LOADER}\n${src}\nreturn __require;`)();
  assert.equal(require('ihc').classify({ name: 'X', kit: 'anti-HRP 594' }).chromogen, 'Fluorescent');
});

// ---------- regressions found in review ----------
test('analyzer sample IDs printed with the old PHL# prefix still match', async () => {
  const { normalizeSampleId } = await import('../core/bloodwork.mjs');
  assert.deepEqual(['PHL#26000305A', 'MHL# 26000305a', '26000305A'].map(normalizeSampleId), ['26000305A', '26000305A', '26000305A']);
});

test('changing stains only checks the new ones: a kept stain whose assay was retired or re-coded since is left as requested', () => {
  const t = fresh();
  const W = () => t.state.ihcRequests.find((x) => x.requester.last === 'Okafor');
  const kept = W().stains.map((s) => ({ assayId: s.assayId, chromogen: s.chromogen }));
  t.call('POST', `/api/ihc/assays/${kept[0].assayId}/retire`, { reason: 'replaced by a new clone' });
  t.call('PATCH', `/api/ihc/assays/${kept[1].assayId}`, { chromogenSet: 'Fluorescent' });
  assert.match(t.fails('PUT', `/api/ihc/requests/${W().id}/stains`, { stains: kept }), /Nothing changed/, 'no false chromogen change for a stain re-coded in the catalog');
  const ki = t.state.assays.find((a) => a.status === 'Active' && a.name === 'Ki-67' && a.kind === 'IHC' && a.id !== kept[0].assayId);
  const res = t.call('PUT', `/api/ihc/requests/${W().id}/stains`, { stains: [...kept, { assayId: ki.id, chromogen: 'Red' }] });
  assert.match(res.change, /^Added Ki-67/);
  assert.deepEqual(W().stains.slice(0, 2).map((s) => [s.snapshot.status, s.snapshot.chromogen]), [['Active', 'DAB'], ['Active', 'DAB']]);
  assert.equal(W().stains[2].chromogen, 'Red');
  // A retired assay cannot be added as a new stain.
  const w2 = t.state.ihcRequests.find((x) => x.requester.last === 'Whitcombe');
  assert.match(t.fails('PUT', `/api/ihc/requests/${w2.id}/stains`, { stains: [{ assayId: kept[0].assayId }] }), /retired and can no longer be requested/);
});

test('two stains of one assay, chromogen changes and new-antibody details are compared stain by stain', () => {
  const t = fresh();
  const W = () => t.state.ihcRequests.find((x) => x.requester.last === 'Whitcombe');
  const cd8 = W().stains[0].assayId;
  t.call('PUT', `/api/ihc/requests/${W().id}/stains`, { stains: [{ assayId: cd8, chromogen: 'DAB' }, { assayId: cd8, chromogen: 'Red' }] });
  assert.match(t.fails('PUT', `/api/ihc/requests/${W().id}/stains`, { stains: [{ assayId: cd8, chromogen: 'DAB' }, { assayId: cd8, chromogen: 'Red' }] }), /Nothing changed/);
  assert.match(t.call('PUT', `/api/ihc/requests/${W().id}/stains`, { stains: [{ assayId: cd8, chromogen: 'Red' }, { assayId: cd8, chromogen: 'Red' }] }).change, /chromogen DAB → Red/);
  const F = () => t.state.ihcRequests.find((x) => x.requester.last === 'Ferreira');
  const stains = F().stains.map((s) => (s.newAntibody ? { newAntibody: { ...s.newAntibody, supplied: false }, chromogen: s.chromogen } : { assayId: s.assayId, chromogen: s.chromogen }));
  assert.match(t.call('PUT', `/api/ihc/requests/${F().id}/stains`, { stains }).change, /SLC7A11 \(xCT\) \(not in catalog\): supplied by the investigator: no/);
  const codes = t.call('GET', `/api/ihc/requests/${F().id}`).estimate.lines.map((l) => l.code);
  assert.ok(codes.includes('HP006004') && !codes.includes('HP006005'), 'MHL now buys the antibody, so the slide is priced HP006004');
});

test('a stain change that cannot be priced changes nothing; a completed request is closed to changes; split lines take the difference in turn', () => {
  const t = fresh();
  const W = () => t.state.ihcRequests.find((x) => x.status === 'Accepted' && x.requester.last === 'Varga');
  const R_ = () => t.state.requests.find((x) => x.id === W().requestId);
  const before = structuredClone(R_().estimateLines);
  const ki = t.state.assays.find((a) => a.status === 'Active' && a.name === 'Ki-67' && a.kind === 'IHC' && a.plex === 1);
  const stains = [...W().stains.map((s) => ({ assayId: s.assayId, chromogen: s.chromogen })), { assayId: ki.id, chromogen: 'DAB' }];
  t.state.settings.pricingFrom = '2027-01-01';   // nothing is priced for today
  assert.match(t.fails('PUT', `/api/ihc/requests/${W().id}/stains`, { stains, reason: 'x' }), /could not be updated, so the stains were not changed/);
  assert.deepEqual(R_().estimateLines, before);
  assert.equal(W().stains.length, 1);
  t.state.settings.pricingFrom = '2026-01-01';
  // Split HP004002 over two lines, then add and remove a stain: the total comes back exactly.
  const r = R_();
  const i = r.estimateLines.findIndex((l) => l.code === 'HP004002');
  const l = r.estimateLines[i];
  const one = { ...l, units: 1, amount: Math.round(l.unitPrice * 100) / 100 };
  const rest = { ...l, units: l.units - 1, amount: Math.round(l.unitPrice * (l.units - 1) * 100) / 100 };
  r.estimateLines.splice(i, 1, one, rest);
  const total = r.estimateTotal;
  t.call('PUT', `/api/ihc/requests/${W().id}/stains`, { stains, reason: 'add Ki-67' });
  t.call('PUT', `/api/ihc/requests/${W().id}/stains`, { stains: stains.slice(0, 1), reason: 'remove it again' });
  assert.equal(R_().estimateTotal, total);
  assert.equal(R_().estimateLines.filter((x) => x.code === 'HP004002').reduce((n, x) => n + x.units, 0), l.units);
  // Completed: the request is closed even though the IHC work was never marked done.
  R_().status = 'Complete'; R_().completed = TODAY;
  assert.match(t.fails('PUT', `/api/ihc/requests/${W().id}/stains`, { stains, reason: 'x' }), /is complete; the stains on MH\d\d-\d{4} can no longer be changed/);
});

test('a double stain keeps the platform built from its two protocols, and ignores a chromogen setting', () => {
  const t = fresh();
  const d = t.state.assays.find((a) => a.components && a.status === 'Active' && a.platform === 'Leica Bond');
  t.call('PATCH', `/api/ihc/assays/${d.id}`, { platformSet: 'Manual', chromogenSet: 'Fluorescent' });
  let a = t.call('GET', `/api/ihc/assays/${d.id}`).assay;
  assert.deepEqual([a.platform, a.chromogenSet, a.kind], ['Manual', '', d.kind]);
  t.call('PATCH', `/api/ihc/assays/${d.id}`, { platformSet: '' });
  a = t.call('GET', `/api/ihc/assays/${d.id}`).assay;
  assert.equal(a.platform, 'Leica Bond', 'clearing the choice restores the built platform');
});

test('non-breaking spaces read as spaces; the investigator form refuses protocols that are not public', () => {
  assert.equal(IHC.classify({ name: 'X', kit: 'anti-HRP\u00a0594' }).chromogen, 'Fluorescent');
  assert.equal(IHC.classify({ name: 'X', kit: 'Bond Polymer Refine', dilution: '1:200 ON\u00a0RT' }).platform, 'Manual');
  const t = fresh();
  const cd3 = t.state.assays.find((a) => a.status === 'Active' && a.name === 'CD3');
  t.call('PATCH', `/api/ihc/assays/${cd3.id}`, { visibility: 'Internal' });
  const body = { requester: { last: 'Test', email: 't@example.org' }, billTo: 'Test', projectId: 'P1', species: 'Mouse', fixativeUsed: '10% NBF',
    samples: [{ tissue: 'Liver', blockNo: '1', type: 'BLOCK' }], stains: [{ assayId: cd3.id }] };
  assert.match(t.fails('POST', '/api/ihc/requests', body), /not offered to investigators/);
});
