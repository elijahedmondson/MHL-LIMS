// Tests for version 5 of the pilot: the billing column in Lookup, the antibody dilution calculator, and whole-slide
// imaging (reading scanner files, registering and matching images, review, scan charges, the scan queue).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore, upgradeToV5 } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as D from '../core/dilution.mjs';
import * as W from '../core/wsi.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const scans = path.join(here, '..', 'samples', 'scanners');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-09';

function fresh() {
  const state = seedState({ priceList, ihcCatalog, today: TODAY });
  state.settings.initials = 'TT';
  const core = createCore({ state, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  const call = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`); return r.file || r.json; };
  const fails = (method, p, body = null) => { const r = core.handle(method, p, {}, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { state, core, call, fails };
}
const reader = (name) => { const b = readFileSync(path.join(scans, name)); return { size: b.length, readAt: async (o, l) => new Uint8Array(b.buffer, b.byteOffset + Math.min(o, b.length), Math.max(0, Math.min(l, b.length - o))) }; };
async function readSample(name) {
  const r = reader(name);
  return { ...(await W.readSlideFile({ name, size: r.size, readAt: r.readAt, resolve: async (n) => { try { return reader(n); } catch { return null; } } })), path: `samples\\scanners\\${name}` };
}

// ---------- Lookup billing ----------
test('Lookup lists show charged so far against the NAS estimate, and flag overruns', () => {
  const { state, call } = fresh();
  const { requests } = call('GET', '/api/requests', null, { status: 'Open' });
  const oka = requests.find((r) => r.zap === 'ZAP2215');
  const req = state.requests.find((r) => r.id === oka.id);
  const live = state.charges.filter((c) => c.requestId === req.id && c.status !== 'VOID').reduce((n, c) => n + c.amount, 0);
  assert.equal(oka.billing.charged, Math.round(live * 100) / 100);
  assert.equal(oka.billing.estimate, req.estimateTotal);
  assert.equal(oka.billing.authorized, state.nas.find((n) => n.id === req.nasId).authorized);
  assert.equal(oka.billing.state, oka.billing.charged > oka.billing.authorized ? 'OVER_AUTHORIZED' : oka.billing.charged > oka.billing.estimate ? 'OVER_ESTIMATE' : 'OK');
  const hit = call('GET', '/api/search', null, { q: 'ZAP2215' }).hits[0];
  assert.deepEqual(hit.billing, oka.billing);
  const fresh2 = requests.find((r) => r.billing.charged === 0);
  assert.deepEqual([fresh2.billing.pctOfEstimate, fresh2.billing.state], [0, 'OK']);
});

// ---------- dilution calculator ----------
test('C1V1 = C2V2 solves for any one value, and 1:X means one part in X', () => {
  const v1 = D.solveC1V1({ c1: 6500, c2: 2000, v2: 1000, solveFor: 'v1' });   // 1 mL at 2 mg/mL from 6.5 mg/mL
  assert.equal(Math.round(v1.v1), 308); assert.equal(Math.round(v1.diluent), 692);
  const c = { c1: 1000, v1: 5, c2: 5, v2: 1000 };   // 1 mg/mL, 5 µL, 5 µg/mL, 1 mL
  for (const k of ['v1', 'v2', 'c1', 'c2']) {
    const given = { ...c }; delete given[k];
    assert.ok(Math.abs(D.solveC1V1({ ...given, solveFor: k })[k] - c[k]) < 1e-9, k);
  }
  assert.throws(() => D.solveC1V1({ c1: 1, c2: 5, v2: 100, solveFor: 'v1' }), /higher than the stock/);
  const r = D.byRatio({ factor: 1000, v2: 10000, c1: 1000 });   // 1:1000 in 10 mL from 1 mg/mL
  assert.deepEqual([r.v1, r.diluent, r.c2], [10, 9990, 1]);
  assert.equal(D.toUgMl(1, 'mg/mL'), 1000); assert.equal(D.toUgMl(1, 'ug/ml'), 1); assert.equal(D.toUl(1.5, 'mL'), 1500);
  assert.equal(D.showVolume(1980), '1.98 mL'); assert.equal(D.showRatio(2000), '1:2,000');
});

test('a run of slides adds spare and dead volume, and suggests an intermediate dilution below the pipetting minimum', () => {
  const r = D.forSlides({ slides: 10, perSlideUl: 150, extraPct: 10, deadUl: 100, factor: 200 });
  assert.equal(Math.round(r.v2 * 1e6) / 1e6, 1750); assert.equal(Math.round(r.v1 * 1e6) / 1e6, 8.75);
  assert.equal(r.intermediate, null);
  const tiny = D.forSlides({ slides: 4, perSlideUl: 100, extraPct: 0, factor: 2000, minUl: 1 });   // 0.2 µL of stock
  assert.equal(tiny.v1, 0.2);
  const im = tiny.intermediate;
  assert.ok(im.k && im.stockUl >= 1 && im.useUl >= 1);
  assert.ok(Math.abs((im.stockUl / im.intermediateUl) * (im.useUl / 400) - 1 / 2000) < 1e-12, 'the two steps give 1:2000');
  assert.throws(() => D.forSlides({ slides: 0, perSlideUl: 150, factor: 100 }), /whole number/);
});

test('catalog dilutions are read, including panels, double stains, concentrations, ranges and ready-to-use', () => {
  assert.deepEqual(D.parseCatalogDilution("1:200 ON 4C"), [{ factor: 200 }]);
  assert.deepEqual(D.parseCatalogDilution('1st: 1:100 | 2nd: 1:500'), [{ factor: 100, label: '1st' }, { factor: 500, label: '2nd' }]);
  assert.deepEqual(D.parseCatalogDilution('1:100 1:200 1:500').map((x) => x.factor), [100, 200, 500]);
  assert.deepEqual(D.parseCatalogDilution("5ug/ml 30'"), [{ ugPerMl: 5 }]);
  assert.deepEqual(D.parseCatalogDilution('1:100 (2ug/ml)'), [{ factor: 100, ugPerMl: 2 }]);
  assert.deepEqual(D.parseCatalogDilution('1:50 to 1:100 (lot dependent)'), [{ factor: 50, range: [50, 100] }]);
  assert.deepEqual(D.parseCatalogDilution("RTU 30'"), [{ rtu: true }]);
  assert.deepEqual(D.parseCatalogDilution('N/A'), []);
  const parsed = ihcCatalog.assays.filter((a) => a.dilution && !/^n\/?a$/i.test(a.dilution.trim())).filter((a) => D.parseCatalogDilution(a.dilution).length);
  assert.ok(parsed.length >= ihcCatalog.assays.filter((a) => a.dilution && !/^n\/?a$/i.test(a.dilution.trim())).length - 2, 'almost every catalog dilution is understood');
});

// ---------- reading scanner files ----------
test('Aperio .svs headers from the AT2 and GT 450 are read: magnification, MPP, date, instrument, barcode, label', async () => {
  const gt = await readSample('26000326A-S01.svs');
  assert.deepEqual([gt.format, gt.model, gt.modelStated, gt.mag, gt.mpp, gt.serial, gt.barcode, gt.scannedOn, gt.scannedAt, gt.hasLabel, gt.hasMacro],
    ['SVS', 'GT450', true, 40, 0.263, 'SS45001', '26000326A-S01', '2026-11-06', '10:02', true, true]);
  assert.deepEqual([gt.width, gt.height], [98304, 61440]);
  const at = await readSample('26000307A-B4-HE.svs');
  assert.deepEqual([at.model, at.modelStated, at.mag, at.barcode, at.internalName], ['AT2', false, 20, '', '26000307A-B4-HE']);
  assert.deepEqual(W.slideIdOf(at), { phl: '26000307A', digits: '26000307', hasLetter: true, block: '4', slide: '', stain: 'H&E', from: 'internal name', text: '26000307A-B4-HE' });
  assert.equal(W.slideIdOf(await readSample('Slide_0042.svs')), null);
});

test('Aperio FL .afi lists its channels; PhenoImager HT .qptiff (BigTIFF) gives Opal channels and markers', async () => {
  const fl = await readSample('26000306A-B2-IF.afi');
  assert.deepEqual([fl.format, fl.model, fl.mag, fl.serial], ['AFI', 'FL', 20, 'FL1234']);
  assert.deepEqual(fl.channels.map((c) => c.name), ['DAPI', 'GFP', 'Ki-67']);
  assert.deepEqual(fl.refers, ['26000306A-B2-IF_DAPI.svs', '26000306A-B2-IF_FITC.svs', '26000306A-B2-IF_TRITC.svs']);
  assert.equal(W.slideIdOf(fl).stain, 'IF', 'named from the .afi, not a channel file');
  const q = await readSample('26000313A_Scan1.qptiff');
  assert.deepEqual([q.format, q.model, q.mag, q.barcode, q.slideId, q.serial], ['QPTIFF', 'PHENOHT', 20, '26000313A', '26000313A', 'PHENO-HT-01']);
  assert.equal(Math.round(q.mpp * 1000) / 1000, 0.497);
  assert.deepEqual(q.channels.map((c) => `${c.name}${c.biomarker ? `=${c.biomarker}` : ''}`), ['DAPI', 'Opal 480=CD8', 'Opal 520=PD-L1', 'Opal 570=CD68', 'Opal 620=FoxP3', 'Opal 690=PanCK', 'Opal 780=Ki-67']);
  const junk = await W.readSlideFile({ name: 'x.svs', size: 10, readAt: async () => new Uint8Array(10) });
  assert.equal(junk.format, 'UNREADABLE');
});

test('slide IDs are found in barcodes and file names; scan charges follow scanner and magnification', () => {
  const p = (t) => { const x = W.parseSlideId(t); return x && [x.phl, x.block, x.slide, x.stain].join('|'); };
  assert.equal(p('26000305A-B2-S01'), '26000305A|2|1|');
  assert.equal(p('26000305A_B12_SL3_CD8.svs'), '26000305A|12|3|CD8');
  assert.equal(p('scan 26000305A HE 20261106'), '26000305A|||H&E');
  assert.equal(p('26000305-S2'), '26000305||2|');
  assert.equal(p('Slide_0042'), null);
  assert.equal(W.scanCharge('GT450', { mag: 40 }).code, 'HP001007');
  assert.equal(W.scanCharge('AT2', { mag: 20 }).code, 'HP001006');
  assert.equal(W.scanCharge('PHENOHT', { mag: 20, channels: [1, 2, 3] }).code, 'HP001009');
  assert.match(W.scanCharge('FL', { mag: 20 }).assumption, /no fluorescence code/);
  assert.deepEqual(['AT2', 'GT450', 'PHENOHT', 'FL'], [W.suggestScanner({ mag: 20 }), W.suggestScanner({ mag: 40 }), W.suggestScanner({ fluorescent: true, opal: true }), W.suggestScanner({ fluorescent: true })]);
});

// ---------- registering and reviewing ----------
test('sample files register against MHL numbers, skip repeats, and pick the scanner from its instrument ID', async () => {
  const { state, call } = fresh();
  const files = [];
  for (const n of ['26000326A-S01.svs', '26000326A-S02.svs', '26000307A-B4-HE.svs', 'Slide_0042.svs', '26000306A-B2-IF.afi', '26000313A_Scan1.qptiff']) files.push(await readSample(n));
  const res = call('POST', '/api/wsi/register', { source: 'files', label: 'samples', files });
  assert.deepEqual([res.imported, res.matched, res.unmatched], [6, 5, 1]);
  const byName = (n) => state.wsi.images.find((x) => x.fileName === n);
  assert.deepEqual([byName('26000326A-S02.svs').slide, byName('26000326A-S02.svs').scannerId], ['2', 'GT450']);
  assert.equal(byName('26000306A-B2-IF.afi').scannerId, 'FL');
  assert.equal(byName('26000307A-B4-HE.svs').scannerStated, true, 'SS7201 is set as the AT2\'s instrument ID in the test data');
  assert.equal(byName('26000313A_Scan1.qptiff').channels.length, 7);
  assert.equal(call('POST', '/api/wsi/register', { files }).duplicates, 6);
  assert.ok(call('GET', '/api/wsi/known').keys.includes(byName('Slide_0042.svs').fileKey));
});

test('review: pass creates the scan charge, rescan needs a reason, reopen voids an unbilled charge, assign fixes an unreadable barcode', () => {
  const { state, call, fails } = fresh();
  const home = call('GET', '/api/wsi');
  const qptiff = home.toReview.find((x) => x.format === 'QPTIFF');
  const passed = call('POST', `/api/wsi/images/${qptiff.id}/pass`, { note: 'All channels in focus' });
  assert.deepEqual([passed.image.status, passed.charge.code, passed.charge.section], ['PASSED', 'HP001009', 'IMAGE']);
  const reopened = call('POST', `/api/wsi/images/${qptiff.id}/reopen`, { reason: 'DAPI too dim' });
  assert.equal(reopened.image.status, 'TO_REVIEW');
  assert.equal(state.charges.find((c) => c.id === passed.charge.id).status, 'VOID');
  assert.match(fails('POST', `/api/wsi/images/${qptiff.id}/rescan`, { reasons: [] }), /why/);
  assert.match(fails('POST', `/api/wsi/images/${qptiff.id}/rescan`, { reasons: ['Other'] }), /Describe/);
  assert.equal(call('POST', `/api/wsi/images/${qptiff.id}/rescan`, { reasons: ['Fluorescence too dim or saturated'] }).image.status, 'RESCAN');
  const lost = home.unmatched[0];
  assert.match(fails('POST', `/api/wsi/images/${lost.id}/pass`, {}), /Assign/);
  const a = call('POST', `/api/wsi/images/${lost.id}/assign`, { phl: '26000325A-S04' });
  assert.deepEqual([a.image.status, a.subject.phl, a.image.slide], ['TO_REVIEW', '26000325A', '4']);
  assert.match(fails('POST', `/api/wsi/images/${lost.id}/link`, { link: 'javascript:alert(1)' }), /http/);
  assert.equal(call('POST', `/api/wsi/images/${lost.id}/link`, { link: 'https://halolink.example.org/image/123' }).image.link, 'https://halolink.example.org/image/123');
});

test('the scan queue suggests the scanner; scanning done moves MHL numbers on once their images are reviewed', () => {
  const { state, call, fails } = fresh();
  const q = call('GET', '/api/wsi').queue;
  const zap = q.find((x) => x.zap === 'ZAP2215'); const pdx = q.find((x) => x.fluorescent); const box = q.find((x) => x.mag === 40);
  assert.deepEqual([zap.scanner, pdx.scanner, box.scanner], ['AT2', 'PHENOHT', 'GT450']);
  // A failed call restores the data from a copy, so records are looked up again after each call.
  const subject = (phl) => state.subjects.find((s) => s.phl === phl);
  assert.match(fails('POST', '/api/wsi/complete', { subjectIds: [subject('26000307A').id] }), /waiting for review/);
  call('POST', '/api/wsi/complete', { subjectIds: [subject('26000306A').id] });
  assert.equal(subject('26000306A').area, 'PATHO');
  assert.match(fails('POST', '/api/wsi/complete', { subjectIds: [subject('26000326A').id] }), /no passed slide image/);
  call('POST', '/api/wsi/complete', { subjectIds: [subject('26000326A').id], force: true, note: 'Scanned elsewhere' });
  assert.equal(subject('26000326A').area, 'QC-PA');
  assert.match(state.events.filter((e) => e.subjectId === subject('26000326A').id).at(-1).note, /without a registered image/);
});

test('an image of a slide still in staining moves its MHL number to Scan; scanners are edited with checks', async () => {
  const { state, call, fails } = fresh();
  const s314 = state.subjects.find((s) => s.phl === '26000314A');
  assert.equal(s314.area, 'STAIN');
  const info = { ...(await readSample('26000313A_Scan1.qptiff')), fileName: '26000314A_Scan1.qptiff', barcode: '26000314A', slideId: '26000314A', path: '' };
  call('POST', '/api/wsi/register', { files: [info] });
  assert.equal(s314.area, 'IMAGE');
  assert.match(fails('PUT', '/api/wsi/scanners/GT450', { status: 'Broken' }), /Unknown scanner status/);
  const s = call('PUT', '/api/wsi/scanners/GT450', { status: 'Maintenance', serials: 'SS45001, SS45002', folder: 'S:\\Scans\\GT450' }).scanner;
  assert.deepEqual([s.status, s.serials, s.folder], ['Maintenance', ['SS45001', 'SS45002'], 'S:\\Scans\\GT450']);
  assert.equal(state.requests.find((r) => r.id === s314.requestId) && call('GET', `/api/requests/${s314.requestId}`).images.length >= 1, true);
});

test('saved data from version 4 gets whole-slide imaging', () => {
  const { state } = fresh();
  const old = structuredClone(state);
  delete old.wsi; old.version = 4;
  createCore({ state: old, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  assert.equal(old.version, 8);   // versions 6 (estimates), 7 and 8 run after it
  assert.deepEqual(old.wsi.scanners.map((s) => s.id), ['AT2', 'GT450', 'FL', 'PHENOHT']);
  assert.equal(upgradeToV5(old), false);
});

test('the standalone bundle includes the calculator and WSI modules and the investigator form is gone', () => {
  const src = bundleModules();
  for (const m of ['dilution', 'wsi', 'calculator', 'wsiviews']) assert.ok(src.includes(`__define('${m}'`), m);
  assert.ok(!src.includes("__define('ihcform'"));
  const require = new Function(`${LOADER}\n${src}\nreturn __require;`)();
  assert.equal(typeof require('wsi').readSlideFile, 'function');
  assert.equal(require('dilution').byRatio({ factor: 100, v2: 1000 }).v1, 10);
  assert.ok(readdirSync(scans).length >= 9);
});

// ---------- regressions found in review ----------
test('the file\'s own scanner wins over the folder or page choice, with a warning; one file by two routes registers once', async () => {
  const { state, call } = fresh();
  const q = await readSample('26000313A_Scan1.qptiff');
  call('POST', '/api/wsi/register', { scannerId: 'AT2', files: [q] });
  const img = state.wsi.images.find((x) => x.fileName === '26000313A_Scan1.qptiff');
  assert.equal(img.scannerId, 'PHENOHT');
  assert.match(img.warnings.join(' '), /file says Akoya PhenoImager HT/);
  const again = call('POST', '/api/wsi/register', { files: [{ ...q, path: 'C:\\Other\\route\\26000313A_Scan1.qptiff' }] });
  assert.equal(again.duplicates, 1);
  // An unstated model takes the page's choice.
  const svs = { ...(await readSample('Slide_0042.svs')), serial: '' };
  call('POST', '/api/wsi/register', { scannerId: 'FL', files: [svs] });
  assert.equal(state.wsi.images.find((x) => x.fileName === 'Slide_0042.svs').scannerId, 'FL');
});

test('a slide waiting for rescanning holds its MHL number in Scan until the new scan is registered', async () => {
  const { state, call, fails } = fresh();
  const subject = (phl) => state.subjects.find((s) => s.phl === phl);
  assert.match(fails('POST', '/api/wsi/complete', { subjectIds: [subject('26000325A').id] }), /waiting to be rescanned \(26000325A-S03\.svs\)/);
  assert.equal(call('GET', '/api/wsi').queue.find((x) => x.mag === 40).subjects.find((s) => s.phl === '26000325A').rescan, 1);
  const s03 = { ...(await readSample('26000326A-S01.svs')), fileName: '26000325A-S03_rescan.svs', barcode: '26000325A-S03', internalName: '26000325A-S03', path: 'S:\\Scans\\GT450\\26000325A-S03_rescan.svs', sizeBytes: 123456 };
  const res = call('POST', '/api/wsi/register', { files: [s03] });
  assert.equal(res.matched, 1);
  assert.equal(call('GET', '/api/wsi').queue.find((x) => x.mag === 40).subjects.find((s) => s.phl === '26000325A').rescan, 0, 'the rescan is settled by the new image');
  call('POST', `/api/wsi/images/${res.results[0].id}/pass`, {});
  call('POST', '/api/wsi/complete', { subjectIds: [subject('26000325A').id] });
  assert.equal(subject('26000325A').area, 'QC-PA');
});

test('slide IDs: markers are not blocks or slides, dates lose to MHL numbers, and a stray barcode number does not hide the file name', () => {
  const p = (t) => { const x = W.parseSlideId(t); return x && [x.phl, x.block, x.slide, x.stain].join('|'); };
  assert.equal(p('26000305A-B2-S100.svs'), '26000305A|2||S100');
  assert.equal(p('26000305A-B220'), '26000305A|||B220');
  assert.equal(p('26000305A-B004-S012'), '26000305A|4|12|');
  assert.equal(p('20261105_26000305A.svs'), '26000305A|||');
  assert.equal(p('20261105_26000305.svs'), '26000305|||');
  const known = (id) => id.phl === '26000307A';
  assert.equal(W.slideIdOf({ barcode: '12345678', fileName: '26000307A-B4-HE.svs' }, known).from, 'file name');
  assert.equal(W.slideIdOf({ barcode: '12345678', fileName: 'x.svs' }, known).phl, '12345678', 'with nothing known, the first ID is kept to show');
});

test('assign takes block and slide from a typed slide ID; a scan date before the price list is charged today', () => {
  const { state, call } = fresh();
  const lost = state.wsi.images.find((x) => x.status === 'UNMATCHED');
  const a = call('POST', `/api/wsi/images/${lost.id}/assign`, { phl: '26000325A-B2-S04', block: '', slide: '' });
  assert.deepEqual([a.image.block, a.image.slide], ['2', '4']);
  state.wsi.images.find((x) => x.id === lost.id).scannedOn = '2009-12-29';
  const passed = call('POST', `/api/wsi/images/${lost.id}/pass`, {});
  assert.equal(passed.charge.date, TODAY);
});

test('intermediate dilutions keep both pipetting steps above the minimum, and weak dilutions are not split', () => {
  for (const factor of [6, 8, 12, 50, 200, 2000, 10000]) {
    for (const v2 of [100, 440, 2000]) {
      const im = D.intermediate({ factor, v2, minUl: 2 });
      if (!im || im.k == null) continue;
      assert.ok(im.stockUl >= 2 && im.useUl >= 2 && im.finalDiluentUl >= 2 && im.intermediateDiluentUl >= 0, `${factor} ${v2}`);
      assert.ok(Math.abs((im.stockUl / im.intermediateUl) * (im.useUl / v2) - 1 / factor) < 1e-12);
    }
  }
  assert.match(D.intermediate({ factor: 4, v2: 2, minUl: 1 }).note, /too weak/);
  assert.equal(D.intermediate({ factor: NaN, v2: 100 }), null);
  assert.equal(D.nice(0.000125), '0.000125');
});
