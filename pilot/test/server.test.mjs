// Starts the real server on a spare port with a temporary data folder and exercises it over HTTP.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync, copyFileSync, mkdirSync, readdirSync, utimesSync, writeFileSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = mkdtempSync(path.join(tmpdir(), 'mhl-pilot-'));
const port = 30000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}`;
let proc;

before(async () => {
  proc = spawn(process.execPath, [path.join(here, '..', 'server.mjs')], { env: { ...process.env, PORT: String(port), MHL_PILOT_DATA: dataDir }, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start')), 10000);
    proc.stdout.on('data', (d) => { if (String(d).includes('running at')) { clearTimeout(t); resolve(); } });
    proc.stderr.on('data', (d) => process.stderr.write(d));
    proc.on('exit', (code) => reject(new Error(`server exited with ${code}`)));
  });
});

after(() => { proc?.kill(); rmSync(dataDir, { recursive: true, force: true }); });

const get = (p) => fetch(base + p);
const send = (method, p, body) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('serves the app and the shared modules', async () => {
  const home = await get('/');
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /MHL LIMS/);
  for (const p of ['/app.js', '/ui.js', '/views/request.js', '/views/pathviews.js', '/views/reports.js', '/views/bloodviews.js', '/views/protocolviews.js', '/views/terms.js', '/views/calculator.js', '/views/wsiviews.js', '/lib/dilution.mjs', '/lib/wsi.mjs',
    '/lib/rules.mjs', '/lib/stats.mjs', '/lib/pathology.mjs', '/lib/ihc.mjs', '/lib/terminology.mjs', '/lib/protocols.mjs', '/lib/bloodwork.mjs', '/lib/sheets.mjs', '/app.css']) {
    const r = await get(p);
    assert.equal(r.status, 200, p);
  }
  assert.match((await get('/lib/rules.mjs')).headers.get('content-type'), /javascript/);
});

test('blocks path traversal and unknown files', async () => {
  assert.equal((await get('/../server.mjs')).status, 404);
  assert.equal((await get('/views/../../server.mjs')).status, 404);
  assert.equal((await get('/nope.js')).status, 404);
});

test('API answers JSON, reports rule errors as 400, and saves to disk', async () => {
  const meta = await (await get('/api/meta')).json();
  assert.equal(meta.priceList.codes, 55);
  const set = await send('PUT', '/api/settings', { initials: 'Q' });
  assert.equal(set.status, 400);
  assert.match((await set.json()).error, /two to four letters/);
  assert.equal((await send('PUT', '/api/settings', { initials: 'HT' })).status, 200);
  const file = path.join(dataDir, 'mhl-lims-pilot.json');
  assert.ok(existsSync(file));
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).settings.initials, 'HT');
  assert.equal((await get('/api/nothing')).status, 404);
  const badJson = await fetch(base + '/api/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{not json' });
  assert.equal(badJson.status, 400);
});

test('downloads come back as attachments', async () => {
  const { batches } = await (await get('/api/billing/batches')).json();
  const r = await get(`/api/billing/batches/${batches[0].id}/file`);
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-disposition'), /attachment; filename="HP\d{6}\.txt"/);
  assert.match(await r.text(), /^H\d{5},/);
});

test('reads the instrument folders like Zaphod: imports each file and moves it to Processed', async () => {
  const chem = path.join(dataDir, 'chem'); const hema = path.join(dataDir, 'hema');
  mkdirSync(chem); mkdirSync(hema);
  const samples = path.join(here, '..', 'samples', 'instruments');
  copyFileSync(path.join(samples, 'VS2-26000327A.txt'), path.join(chem, 'VS2-26000327A.txt'));
  copyFileSync(path.join(samples, 'Hemavet-export-2026-11-05.xls'), path.join(hema, 'Hemavet.xls'));
  const old = new Date(Date.now() - 5 * 60_000);
  utimesSync(path.join(chem, 'VS2-26000327A.txt'), old, old); utimesSync(path.join(hema, 'Hemavet.xls'), old, old);
  writeFileSync(path.join(chem, 'putty-still-writing.log'), 'VETSCAN VS2\n');   // just changed: left for the next read
  assert.equal((await send('PUT', '/api/settings', { instrumentFolders: { chemistry: chem, hematology: hema } })).status, 200);
  const res = await (await send('POST', '/api/bloodwork/read-folder', {})).json();
  assert.deepEqual(res.files.map((f) => [f.name, f.imported ?? 'skipped']), [['VS2-26000327A.txt', 1], ['putty-still-writing.log', 'skipped'], ['Hemavet.xls', 3]]);
  assert.deepEqual(readdirSync(chem).sort(), ['Processed', 'putty-still-writing.log']);
  assert.deepEqual(readdirSync(path.join(hema, 'Processed')), ['Hemavet.xls']);
  const again = await (await send('POST', '/api/bloodwork/read-folder', {})).json();
  assert.deepEqual(again.files.map((f) => f.name), ['putty-still-writing.log']);
});

test('reads the scanner folders: registers new slide images in place, an .afi with its channels as one image', async () => {
  const gt = path.join(dataDir, 'gt450'); const fl = path.join(dataDir, 'fl', '2026-11-06');
  mkdirSync(gt, { recursive: true }); mkdirSync(fl, { recursive: true });
  const scans = path.join(here, '..', 'samples', 'scanners');
  const old = new Date(Date.now() - 10 * 60_000);
  const put = (dir, name) => { copyFileSync(path.join(scans, name), path.join(dir, name)); utimesSync(path.join(dir, name), old, old); };
  put(gt, '26000326A-S01.svs'); put(gt, '26000326A-S02.svs');
  for (const n of ['26000306A-B2-IF.afi', '26000306A-B2-IF_DAPI.svs', '26000306A-B2-IF_FITC.svs', '26000306A-B2-IF_TRITC.svs']) put(fl, n);
  assert.equal((await send('PUT', '/api/wsi/scanners/GT450', { folder: gt })).status, 200);
  assert.equal((await send('PUT', '/api/wsi/scanners/FL', { folder: path.dirname(fl) })).status, 200);
  const res = await (await send('POST', '/api/wsi/read-folders', {})).json();
  const by = Object.fromEntries(res.scanners.map((r) => [r.scanner, r]));
  assert.equal(by['Aperio GT 450'].imported, 2);
  assert.equal(by['Aperio FL'].imported, 1, 'the channel .svs files belong to the .afi');
  assert.deepEqual(readdirSync(gt).sort(), ['26000326A-S01.svs', '26000326A-S02.svs'], 'images are not moved');
  const again = await (await send('POST', '/api/wsi/read-folders', {})).json();
  assert.ok(again.scanners.every((r) => !r.imported));
  const home = await (await get('/api/wsi')).json();
  const afi = home.toReview.find((x) => x.format === 'AFI');
  assert.deepEqual([afi.phl, afi.scannerId, afi.channels], ['26000306A', 'FL', 3]);
});

test('an unreadable file in a scanner folder is counted and skipped; exported TIFFs are left alone', async () => {
  const dir = path.join(dataDir, 'at2');
  mkdirSync(dir, { recursive: true });
  const scans = path.join(here, '..', 'samples', 'scanners');
  const old = new Date(Date.now() - 10 * 60_000);
  for (const n of ['26000307A-B4-HE.svs', 'Slide_0042.svs']) { copyFileSync(path.join(scans, n), path.join(dir, n)); utimesSync(path.join(dir, n), old, old); }
  copyFileSync(path.join(scans, '26000307A-B4-HE.svs'), path.join(dir, '26000307A-B4-HE_thumbnail.tif')); utimesSync(path.join(dir, '26000307A-B4-HE_thumbnail.tif'), old, old);
  chmodSync(path.join(dir, 'Slide_0042.svs'), 0o000);
  // On Windows, or as root, the file stays readable; then both are registered and nothing is skipped.
  const blocked = (() => { try { readFileSync(path.join(dir, 'Slide_0042.svs')); return false; } catch { return true; } })();
  assert.equal((await send('PUT', '/api/wsi/scanners/AT2', { folder: dir })).status, 200);
  const res = await (await send('POST', '/api/wsi/read-folders', {})).json();
  const at2 = res.scanners.find((r) => r.scanner === 'Aperio AT2');
  chmodSync(path.join(dir, 'Slide_0042.svs'), 0o644);
  assert.deepEqual([at2.imported, at2.errors], blocked ? [1, 1] : [2, 0], 'the .tif thumbnail is never read');
});
