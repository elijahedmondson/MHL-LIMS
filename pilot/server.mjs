#!/usr/bin/env node
// MHL LIMS pilot server.
//
//   node server.mjs            start on http://localhost:3080
//   node server.mjs --open     start and open the browser
//   PORT=3090 node server.mjs  use another port
//
// Needs Node.js 18 or later and nothing else (no npm install). Data is kept in data/mhl-lims-pilot.json
// next to this file, with a dated copy in data/backups the first time it changes each day.
// It listens on this computer only (127.0.0.1); colleagues cannot reach it over the network.

import http from 'node:http';
import { readFileSync, writeFileSync, renameSync, existsSync, mkdirSync, statSync, readdirSync, openSync, readSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { exec } from 'node:child_process';
import { createCore } from './core/core.mjs';
import { seedState } from './core/seed.mjs';
import { readSheet } from './core/sheets.mjs';
import { readSlideFile, FOLDER_EXTENSIONS, afiChannelFiles } from './core/wsi.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..');
const PORT = Number(process.env.PORT) || 3080;
const HOST = '127.0.0.1';
const DATA_DIR = process.env.MHL_PILOT_DATA ? path.resolve(process.env.MHL_PILOT_DATA) : path.join(here, 'data');
const DATA_FILE = path.join(DATA_DIR, 'mhl-lims-pilot.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const pad = (n) => String(n).padStart(2, '0');
const clock = {
  today() { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; },
  now() { const d = new Date(); return `${clock.today()}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; },
};

const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
mkdirSync(BACKUP_DIR, { recursive: true });

function save(state) {
  const json = JSON.stringify(state);
  const backup = path.join(BACKUP_DIR, `mhl-lims-pilot-${clock.today()}.json`);
  if (existsSync(DATA_FILE) && !existsSync(backup)) writeFileSync(backup, readFileSync(DATA_FILE));
  const tmp = `${DATA_FILE}.tmp`;
  writeFileSync(tmp, json);
  renameSync(tmp, DATA_FILE);
}

let state;
if (existsSync(DATA_FILE)) {
  state = JSON.parse(readFileSync(DATA_FILE, 'utf8'));
} else {
  state = seedState({ priceList, ihcCatalog, today: clock.today() });
  save(state);
}
const core = createCore({ state, priceList, ihcCatalog, clock, save, reseed: () => seedState({ priceList, ihcCatalog, today: clock.today() }) });

// Static files: the web UI, plus the shared rule modules the browser imports.
const STATIC = {
  '/lib/rules.mjs': path.join(lims, 'tools', 'rules-reference', 'rules.mjs'),
  '/lib/stats.mjs': path.join(here, 'core', 'stats.mjs'),
  '/lib/defs.mjs': path.join(here, 'core', 'defs.mjs'),
  '/lib/ihc.mjs': path.join(here, 'core', 'ihc.mjs'),
  '/lib/pathology.mjs': path.join(here, 'core', 'pathology.mjs'),
  '/lib/terminology.mjs': path.join(here, 'core', 'terminology.mjs'),
  '/lib/protocols.mjs': path.join(here, 'core', 'protocols.mjs'),
  '/lib/bloodwork.mjs': path.join(here, 'core', 'bloodwork.mjs'),
  '/lib/sheets.mjs': path.join(here, 'core', 'sheets.mjs'),
  '/lib/dilution.mjs': path.join(here, 'core', 'dilution.mjs'),
  '/lib/wsi.mjs': path.join(here, 'core', 'wsi.mjs'),
  '/lib/estimates.mjs': path.join(here, 'core', 'estimates.mjs'),
  '/lib/estimatemail.mjs': path.join(here, 'core', 'estimatemail.mjs'),
  '/lib/xenium.mjs': path.join(here, 'core', 'xenium.mjs'),
  '/lib/animallist.mjs': path.join(here, 'core', 'animallist.mjs'),
  '/lib/xlsxwrite.mjs': path.join(here, 'core', 'xlsxwrite.mjs'),
};
const WEB = path.join(here, 'web');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' };

function staticFile(urlPath) {
  if (STATIC[urlPath]) return STATIC[urlPath];
  const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB + path.sep)) return null;            // no path traversal
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > 12_000_000) { reject(new Error('Request too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => {
      if (!chunks.length) return resolve(null);
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('The request body is not valid JSON.')); }
    });
    req.on('error', reject);
  });
}

// Like Zaphod's Read Files buttons: import every file in the instrument folders set in Settings, then move each file
// that was read into a Processed folder inside it. Only the server can do this; the core never touches the disk.
async function readInstrumentFolders() {
  const folders = core.state.settings.instrumentFolders || {};
  const files = [];
  for (const kind of ['chemistry', 'hematology']) {
    const dir = folders[kind];
    if (!dir) continue;
    if (!existsSync(dir) || !statSync(dir).isDirectory()) { files.push({ name: dir, error: `The ${kind} folder was not found.` }); continue; }
    for (const name of readdirSync(dir).sort()) {
      const full = path.join(dir, name);
      const info = statSync(full);
      if (!info.isFile() || name.startsWith('~$')) continue;
      // PuTTY keeps its log open while it captures; leave files changed in the last minute for the next read.
      if (Date.now() - info.mtimeMs < 60_000) { files.push({ name, error: 'Skipped: changed in the last minute, so it may still be being written. Read again shortly.' }); continue; }
      let result;
      try {
        const bytes = readFileSync(full);
        const body = kind === 'chemistry' || /\.(txt|log)$/i.test(name)
          ? { fileName: name, text: bytes.toString('utf8'), source: 'folder' }
          : { fileName: name, grid: (await readSheet(new Uint8Array(bytes), name)).grid, source: 'folder' };
        result = core.handle('POST', '/api/bloodwork/import', {}, body);
      } catch (e) { result = { status: 400, json: { error: e.message } }; }
      if (result.status !== 200) { files.push({ name, error: result.json.error }); continue; }
      // A file that was only partly read stays where it is, so nothing in it is lost.
      if (result.json.truncated) { files.push({ name, ...result.json, error: 'Only part of this file was read (it is larger than the pilot accepts), so it was left in the folder.' }); continue; }
      try {
        const done = path.join(dir, 'Processed');
        mkdirSync(done, { recursive: true });
        let target = path.join(done, name);
        if (existsSync(target)) target = path.join(done, `${path.parse(name).name}-${Date.now()}${path.extname(name)}`);
        renameSync(full, target);
        files.push({ name, ...result.json });
      } catch (e) {
        files.push({ name, ...result.json, error: `Imported, but it could not be moved to Processed (${e.code || e.message}); a second read will skip it as already imported.` });
      }
    }
  }
  return { files };
}

// Reads the scanners' output folders (set on the WSI page): registers every slide image not seen before, reading only
// its header. Images are never moved or copied. Files changed in the last two minutes may still be being written.
async function readScannerFolders() {
  const known = new Set(core.handle('GET', '/api/wsi/known').json.keys);
  const report = [];
  for (const scanner of core.state.wsi.scanners) {
    if (!scanner.folder) continue;
    if (!existsSync(scanner.folder) || !statSync(scanner.folder).isDirectory()) { report.push({ scanner: scanner.name, error: 'The folder was not found.' }); continue; }
    const found = [];
    const walk = (dir, depth) => {
      let entries = [];
      try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory() && depth < 4) walk(full, depth + 1);
        else if (e.isFile() && FOLDER_EXTENSIONS.includes(path.extname(e.name).toLowerCase())) found.push(full);
      }
    };
    walk(scanner.folder, 0);
    const files = []; let recent = 0; let errors = 0;
    const referenced = new Set();
    for (const full of found.filter((f) => /\.afi$/i.test(f))) {
      try { for (const n of afiChannelFiles(readFileSync(full, 'utf8'))) referenced.add(path.join(path.dirname(full), n).toLowerCase()); } catch { /* read below */ }
    }
    const openReader = (full) => {
      const size = statSync(full).size; const fd = openSync(full, 'r');
      return { size, fd, readAt: async (off, len) => { const n = Math.max(0, Math.min(len, size - off)); const b = Buffer.alloc(n); if (n) readSync(fd, b, 0, n, off); return new Uint8Array(b.buffer, b.byteOffset, n); } };
    };
    for (const full of found.sort()) {
      // One locked, moved or unreadable file is counted and skipped; it does not stop the rest.
      const open = [];
      try {
        const st = statSync(full);
        if (known.has(`${full.toLowerCase()}|${st.size}`) || referenced.has(full.toLowerCase())) continue;
        if (Date.now() - st.mtimeMs < 120_000) { recent++; continue; }
        open.push(openReader(full));
        const info = await readSlideFile({ name: path.basename(full), size: open[0].size, readAt: open[0].readAt,
          resolve: async (name) => { const p = path.join(path.dirname(full), path.basename(name)); if (!existsSync(p)) return null; referenced.add(p.toLowerCase()); const x = openReader(p); open.push(x); return x; } });
        for (const n of info.refers || []) referenced.add(path.join(path.dirname(full), path.basename(n)).toLowerCase());
        files.push({ ...info, path: full });
      } catch { errors++; } finally { for (const x of open) closeSync(x.fd); }
    }
    // An Aperio FL channel .svs listed by an .afi is part of that image, not an image of its own.
    const list = files.filter((f) => !referenced.has(f.path.toLowerCase()));
    const res = list.length ? core.handle('POST', '/api/wsi/register', {}, { source: 'server', label: `${scanner.name} folder`, scannerId: scanner.id, files: list }) : null;
    report.push({ scanner: scanner.name, ...(res ? (res.status === 200 ? res.json : { error: res.json.error }) : { imported: 0 }), recent, errors });
  }
  return { scanners: report };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const send = (status, body, headers = {}) => { res.writeHead(status, { 'Cache-Control': 'no-store', ...headers }); res.end(body); };
  try {
    if (url.pathname.startsWith('/api/')) {
      const body = ['POST', 'PUT', 'PATCH'].includes(req.method) ? await readBody(req) : null;
      if (req.method === 'POST' && url.pathname === '/api/wsi/read-folders') {
        return send(200, JSON.stringify(await readScannerFolders()), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      if (req.method === 'POST' && url.pathname === '/api/bloodwork/read-folder') {
        return send(200, JSON.stringify(await readInstrumentFolders()), { 'Content-Type': 'application/json; charset=utf-8' });
      }
      const result = core.handle(req.method, url.pathname, Object.fromEntries(url.searchParams), body);
      if (result.file) {
        return send(200, result.file.content, { 'Content-Type': result.file.type, 'Content-Disposition': `attachment; filename="${result.file.name}"` });
      }
      return send(result.status, JSON.stringify(result.json), { 'Content-Type': 'application/json; charset=utf-8' });
    }
    if (req.method !== 'GET') return send(405, 'Method not allowed');
    const file = staticFile(url.pathname);
    if (!file) return send(404, 'Not found', { 'Content-Type': 'text/plain' });
    return send(200, readFileSync(file), { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  } catch (e) {
    return send(400, JSON.stringify({ error: e.message }), { 'Content-Type': 'application/json; charset=utf-8' });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`Port ${PORT} is already in use. Is the pilot already running? Otherwise start it with another port, e.g. set PORT=3090.`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const url = `http://localhost:${PORT}`;
  console.log(`MHL LIMS pilot is running at ${url}`);
  console.log(`Data file: ${DATA_FILE}`);
  console.log('Keep this window open while you use the pilot. Press Ctrl+C to stop.');
  if (process.argv.includes('--open')) {
    const cmd = process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
    exec(cmd, () => {});
  }
});

export { server };
