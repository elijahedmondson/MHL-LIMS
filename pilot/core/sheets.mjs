// Reads a spreadsheet file into a grid of strings, with no outside libraries, so instrument exports can be
// imported in the browser and in Node alike. Handles Excel 97-2003 .xls (BIFF8, as the Hemavet DMS program
// writes), .xlsx, CSV, tab-separated text, and HTML tables saved with an .xls name.
// Used by the core's server and by the browser (/lib/sheets.mjs).

const td = (bytes, enc = 'utf-8') => new TextDecoder(enc).decode(bytes);
// Text files: UTF-8 if they are valid UTF-8, otherwise Windows-1252 (what Excel's "CSV (Comma delimited)" writes).
const textOf = (bytes) => { try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch { return td(bytes, 'windows-1252'); } };

export function sniff(bytes, name = '') {
  if (bytes.length >= 8 && bytes[0] === 0xD0 && bytes[1] === 0xCF && bytes[2] === 0x11 && bytes[3] === 0xE0) return 'xls';
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4B && bytes[2] === 0x03 && bytes[3] === 0x04) return 'xlsx';
  const head = td(bytes.slice(0, 2000)).toLowerCase();
  if (head.includes('<table') || head.includes('<html')) return 'html';
  return /\.csv$/i.test(name) && !head.includes('\t') ? 'csv' : (head.includes('\t') ? 'tsv' : 'csv');
}

// ---------- text ----------
export function textToGrid(text, delimiter = null) {
  const t = String(text || '').replace(/^﻿/, '');
  const first = t.split(/\r?\n/, 5);
  const count = (ch) => (first.find((l) => l.trim()) || '').split(ch).length - 1;
  const d = delimiter || (first.some((l) => l.includes('\t')) ? '\t' : count(';') > count(',') ? ';' : ',');
  const rows = []; let row = []; let cur = ''; let q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
    if (ch === '"' && cur === '') q = true;
    else if (ch === d) { row.push(cur.trim()); cur = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur.trim()); rows.push(row); row = []; cur = ''; }
    else cur += ch;
  }
  if (cur || row.length) { row.push(cur.trim()); rows.push(row); }
  return rows;
}

export function htmlToGrid(html) {
  const rows = [];
  const decode = (s) => s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).trim();
  for (const tr of String(html).match(/<tr[\s\S]*?<\/tr>/gi) || []) {
    const row = [];
    for (const m of tr.matchAll(/<t[dh]([^>]*)>([\s\S]*?)<\/t[dh]>/gi)) {
      row.push(decode(m[2]));
      const span = Number((m[1].match(/colspan\s*=\s*"?(\d+)/i) || [])[1] || 1);
      for (let i = 1; i < span; i++) row.push('');
    }
    rows.push(row);
  }
  return rows;
}

// ---------- .xls: compound file, then BIFF8 records ----------
function cfbStream(bytes, wanted = ['Workbook', 'Book']) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = (o) => dv.getUint16(o, true); const u32 = (o) => dv.getUint32(o, true);
  const secSize = 1 << u16(0x1E); const miniSize = 1 << u16(0x20);
  const nFat = u32(0x2C); const firstDir = u32(0x30); const cutoff = u32(0x38); const firstMiniFat = u32(0x3C); const nMiniFat = u32(0x40);
  let difatNext = u32(0x44);
  const secOff = (s) => (s + 1) * secSize;
  const difat = [];
  for (let i = 0; i < 109; i++) difat.push(u32(0x4C + i * 4));
  for (let guard = 0; difatNext !== 0xFFFFFFFE && difatNext !== 0xFFFFFFFF && guard < 1000; guard++) {
    const o = secOff(difatNext);
    for (let i = 0; i < secSize / 4 - 1; i++) difat.push(u32(o + i * 4));
    difatNext = u32(o + secSize - 4);
  }
  const fat = [];
  for (const s of difat.slice(0, nFat)) { if (s >= 0xFFFFFFFA) continue; const o = secOff(s); for (let i = 0; i < secSize / 4; i++) fat.push(u32(o + i * 4)); }
  const chain = (start, table) => { const out = []; let s = start; for (let guard = 0; s < 0xFFFFFFFA && guard < 1e6; guard++) { out.push(s); s = table[s]; } return out; };
  const readChain = (start, size) => {
    const out = new Uint8Array(size); let pos = 0;
    for (const s of chain(start, fat)) { const n = Math.min(secSize, size - pos); if (n <= 0) break; out.set(bytes.subarray(secOff(s), secOff(s) + n), pos); pos += n; }
    return out;
  };
  const dirBytes = (() => { const secs = chain(firstDir, fat); const out = new Uint8Array(secs.length * secSize); secs.forEach((s, i) => out.set(bytes.subarray(secOff(s), secOff(s) + secSize), i * secSize)); return out; })();
  const ddv = new DataView(dirBytes.buffer);
  const entries = [];
  for (let o = 0; o + 128 <= dirBytes.length; o += 128) {
    const nameLen = ddv.getUint16(o + 0x40, true);
    let name = ''; for (let i = 0; i < Math.max(0, nameLen / 2 - 1); i++) name += String.fromCharCode(ddv.getUint16(o + i * 2, true));
    entries.push({ name, type: dirBytes[o + 0x42], start: ddv.getUint32(o + 0x74, true), size: ddv.getUint32(o + 0x78, true) });
  }
  const root = entries.find((e) => e.type === 5);
  const entry = entries.find((e) => e.type === 2 && wanted.includes(e.name));
  if (!entry) {
    if (entries.some((e) => /EncryptedPackage|EncryptionInfo/.test(e.name))) throw new Error('This workbook is password-protected or encrypted by a sensitivity label. Save an unprotected copy and read that.');
    throw new Error('This .xls file has no workbook inside it.');
  }
  if (entry.size >= cutoff || !root) return readChain(entry.start, entry.size);
  // Small streams live in the mini stream.
  const miniStream = readChain(root.start, root.size);
  const miniFat = []; for (const s of chain(firstMiniFat, fat).slice(0, nMiniFat)) { const o = secOff(s); for (let i = 0; i < secSize / 4; i++) miniFat.push(u32(o + i * 4)); }
  const out = new Uint8Array(entry.size); let pos = 0;
  for (const s of chain(entry.start, miniFat)) { const n = Math.min(miniSize, entry.size - pos); if (n <= 0) break; out.set(miniStream.subarray(s * miniSize, s * miniSize + n), pos); pos += n; }
  return out;
}

function rkValue(rk) {
  let v;
  if (rk & 0x02) v = rk >> 2;
  else { const b = new DataView(new ArrayBuffer(8)); b.setUint32(4, rk & 0xFFFFFFFC, true); b.setUint32(0, 0, true); v = b.getFloat64(0, true); }
  return rk & 0x01 ? v / 100 : v;
}
const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 1e10) / 1e10));

export function xlsToGrid(bytes, sheetIndex = 0, { fillMerged = false } = {}) {
  const wb = cfbStream(bytes);
  const dv = new DataView(wb.buffer, wb.byteOffset, wb.byteLength);
  // Records, with CONTINUE records kept as separate pieces (strings can break across them).
  const recs = [];
  for (let p = 0; p + 4 <= wb.length;) {
    const type = dv.getUint16(p, true); const len = dv.getUint16(p + 2, true);
    recs.push({ type, pos: p, data: wb.subarray(p + 4, p + 4 + len) });
    p += 4 + len;
  }
  const sst = []; const sheets = []; let biff8 = true;
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 0x0809 && sheets.length === 0 && r.data.length >= 2) biff8 = (r.data[0] | (r.data[1] << 8)) === 0x0600;
    if (r.type === 0x0085) {
      const d = r.data; const off = d[0] | (d[1] << 8) | (d[2] << 16) | (d[3] << 24);
      // The sheet's name: a short string, one byte or two per character.
      const cch = d[6] || 0; const wide = biff8 && (d[7] & 1); const at = biff8 ? 8 : 7;
      let name = '';
      for (let c = 0; c < cch && at + c * (wide ? 2 : 1) < d.length; c++) name += String.fromCharCode(wide ? d[at + c * 2] | (d[at + c * 2 + 1] << 8) : d[at + c]);
      sheets.push({ offset: off >>> 0, kind: d[5], name, hidden: (d[4] & 0x03) !== 0 });
    }
    if (r.type === 0x00FC) {
      // Shared strings, spread over this record and any CONTINUE records after it.
      const pieces = [r.data]; let j = i + 1;
      while (recs[j]?.type === 0x003C) pieces.push(recs[j++].data);
      let pi = 0; let pos = 8;
      const total = pieces[0][4] | (pieces[0][5] << 8) | (pieces[0][6] << 16) | (pieces[0][7] << 24);
      const need = () => { if (pos >= pieces[pi].length && pi < pieces.length - 1) { pi++; pos = 0; } };
      const byte = () => { need(); return pieces[pi][pos++]; };
      const u16 = () => byte() | (byte() << 8);
      const u32 = () => (byte() | (byte() << 8) | (byte() << 16) | (byte() << 24)) >>> 0;
      for (let k = 0; k < total && pi < pieces.length; k++) {
        const cch = u16(); let flags = byte();
        const rich = flags & 0x08 ? u16() : 0; const ext = flags & 0x04 ? u32() : 0;
        let s = '';
        for (let c = 0; c < cch; c++) {
          if (pos >= pieces[pi].length && pi < pieces.length - 1) { pi++; pos = 0; flags = pieces[pi][pos++]; }
          s += String.fromCharCode(flags & 0x01 ? u16() : byte());
        }
        for (let x = 0; x < rich * 4 + ext; x++) byte();
        sst.push(s);
      }
    }
  }
  if (sheetIndex === 'names') return sheets.filter((s) => s.kind === 0).map((s) => ({ name: s.name, hidden: s.hidden }));
  const sheet = sheets.filter((s) => s.kind === 0)[sheetIndex] || sheets[0];
  const grid = [];
  const set = (row, col, v) => { (grid[row] ||= [])[col] = v; };
  const start = sheet ? recs.findIndex((r) => r.pos === sheet.offset) : 0;
  let pendingFormula = null;
  const merged = [];
  for (let i = Math.max(0, start) + 1; i < recs.length; i++) {
    const { type, data: d } = recs[i];
    if (type === 0x000A) break;
    if (type === 0x00E5) { const k = d[0] | (d[1] << 8); for (let j = 0; j < k; j++) { const o = 2 + j * 8; merged.push([d[o] | (d[o + 1] << 8), d[o + 2] | (d[o + 3] << 8), d[o + 4] | (d[o + 5] << 8), d[o + 6] | (d[o + 7] << 8)]); } continue; }
    const rdv = new DataView(d.buffer, d.byteOffset, d.byteLength);
    const row = d.length >= 4 ? rdv.getUint16(0, true) : 0; const col = d.length >= 4 ? rdv.getUint16(2, true) : 0;
    if (type === 0x00FD) set(row, col, sst[rdv.getUint32(6, true)] ?? '');
    else if (type === 0x0203) set(row, col, fmtNum(rdv.getFloat64(6, true)));
    else if (type === 0x027E) set(row, col, fmtNum(rkValue(rdv.getUint32(6, true))));
    else if (type === 0x00BD) { const last = rdv.getUint16(d.length - 2, true); for (let c = col, o = 4; c <= last; c++, o += 6) set(row, c, fmtNum(rkValue(rdv.getUint32(o + 2, true)))); }
    else if (type === 0x0204) {
      const cch = rdv.getUint16(6, true);
      if (biff8) { const hi = d[8] & 1; let s = ''; for (let c = 0; c < cch; c++) s += String.fromCharCode(hi ? rdv.getUint16(9 + c * 2, true) : d[9 + c]); set(row, col, s); }
      else set(row, col, td(d.subarray(8, 8 + cch), 'latin1'));
    } else if (type === 0x0006) {
      if (d[12] === 0xFF && d[13] === 0xFF) { if (d[6] === 0) pendingFormula = { row, col }; else if (d[6] === 1) set(row, col, d[8] ? 'TRUE' : 'FALSE'); }
      else set(row, col, fmtNum(rdv.getFloat64(6, true)));
    } else if (type === 0x0207 && pendingFormula) {
      const cch = rdv.getUint16(0, true); const hi = d[2] & 1; let s = '';
      for (let c = 0; c < cch; c++) s += String.fromCharCode(hi ? rdv.getUint16(3 + c * 2, true) : d[3 + c]);
      set(pendingFormula.row, pendingFormula.col, s); pendingFormula = null;
    } else if (type === 0x0205) set(row, col, d[7] ? '' : (d[6] ? 'TRUE' : 'FALSE'));
  }
  if (fillMerged) for (const [r1, r2, c1, c2] of merged) { const v = grid[r1]?.[c1] ?? ''; for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) set(r, c, v); }
  return Array.from({ length: grid.length }, (_, r) => Array.from({ length: (grid[r] || []).length }, (__, c) => grid[r]?.[c] ?? ''));
}

// ---------- .xlsx: zip, then the first worksheet's XML ----------
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open .xlsx files; save the sheet as .xls or CSV.');
  const ds = new DecompressionStream('deflate-raw');
  // Read it in pieces and stop at 64 MB: a small file that inflates without end is not a spreadsheet.
  const reader = new Blob([bytes]).stream().pipeThrough(ds).getReader();
  const parts = []; let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 64 * 1024 * 1024) { await reader.cancel(); throw new Error('This file inflates to more than 64 MB; it is too large to read here.'); }
    parts.push(value);
  }
  const out = new Uint8Array(total); let p = 0;
  for (const part of parts) { out.set(part, p); p += part.length; }
  return out;
}
async function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Not a valid .xlsx file.');
  const count = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const files = {};
  for (let k = 0; k < count; k++) {
    const method = dv.getUint16(p + 10, true); const csize = dv.getUint32(p + 20, true);
    const nlen = dv.getUint16(p + 28, true); const xlen = dv.getUint16(p + 30, true); const clen = dv.getUint16(p + 32, true);
    const local = dv.getUint32(p + 42, true);
    const name = td(bytes.subarray(p + 46, p + 46 + nlen));
    const lnlen = dv.getUint16(local + 26, true); const lxlen = dv.getUint16(local + 28, true);
    const data = bytes.subarray(local + 30 + lnlen + lxlen, local + 30 + lnlen + lxlen + csize);
    files[name] = { method, data };
    p += 46 + nlen + xlen + clen;
  }
  return async (name) => { const f = files[name]; if (!f) return null; return td(f.method === 8 ? await inflateRaw(f.data) : f.data); };
}
const xmlText = (s) => s.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (ref) => { let n = 0; for (const ch of ref.replace(/\d+$/, '')) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };

export async function xlsxToGrid(bytes) {
  const get = await unzip(bytes);
  const shared = await sharedStrings(get);
  const sheet = await get('xl/worksheets/sheet1.xml');
  if (!sheet) throw new Error('The .xlsx file has no first worksheet.');
  return sheetGrid(sheet, shared);
}
const fmtCellNumber = (v) => (/^-?\d+(\.\d+)?(e[+-]?\d+)?$/i.test(v) ? fmtNum(Number(v)) : v);

async function sharedStrings(get) {
  const shared = [];
  const sst = await get('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(xmlText((m[1].match(/<t[^>]*>[\s\S]*?<\/t>/g) || []).join('')));
  return shared;
}

// Every worksheet of an .xlsx, in the order of the workbook's tabs, with its name, whether it is hidden, and whether the
// workbook counts dates from 1904 (old Mac Excel) rather than 1900.
export async function xlsxSheets(bytes, { fillMerged = false } = {}) {
  const get = await unzip(bytes);
  const shared = await sharedStrings(get);
  const wb = (await get('xl/workbook.xml')) || '';
  const rels = (await get('xl/_rels/workbook.xml.rels')) || '';
  const target = (id) => (rels.match(new RegExp(`<Relationship\\b[^>]*\\bId="${id}"[^>]*>`)) || [''])[0].match(/Target="([^"]+)"/)?.[1];
  const out = [];
  for (const m of wb.matchAll(/<sheet\b[^>]*>/g)) {
    const name = xmlText((m[0].match(/\bname="([^"]*)"/) || [])[1] || '');
    const id = (m[0].match(/\br:id="([^"]+)"/) || [])[1];
    const hidden = /\bstate="(hidden|veryHidden)"/.test(m[0]);
    const t = id && target(id);
    if (!t) continue;
    const xml = await get(t.startsWith('/') ? t.slice(1) : `xl/${t.replace(/^\.\//, '')}`);
    if (xml) out.push({ name, hidden, grid: sheetGrid(xml, shared, { fillMerged }) });
  }
  if (!out.length) out.push({ name: 'Sheet1', hidden: false, grid: await xlsxToGrid(bytes) });
  const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(wb);
  return out.map((x) => ({ ...x, date1904 }));
}

function sheetGrid(sheet, shared, { fillMerged = false } = {}) {
  const grid = [];
  // Lazy attributes, and the self-closing form first: <c r="D2" s="1"/> and <row r="3"/> are common.
  for (const rm of sheet.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const rn = (rm[1].match(/\br="(\d+)"/) || [])[1];
    if (!rn || !rm[2]) continue;
    const r = Number(rn) - 1; const row = (grid[r] ||= []);
    for (const cm of rm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = (cm[1].match(/r="([A-Z]+\d+)"/) || [])[1]; if (!ref) continue;
      const t = (cm[1].match(/t="(\w+)"/) || [])[1];
      const v = ((cm[2] || '').match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      const is = ((cm[2] || '').match(/<is>([\s\S]*?)<\/is>/) || [])[1];
      row[colIndex(ref)] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? xmlText(is || '') : v != null ? (t === 'str' || t === 'e' ? xmlText(v) : fmtCellNumber(xmlText(v))) : '';
    }
  }
  // A merged cell's value belongs to every cell it covers (a group written once beside several animals).
  if (fillMerged) {
    for (const m of sheet.matchAll(/<mergeCell\b[^>]*\bref="([A-Z]+\d+):([A-Z]+\d+)"/g)) {
      const r1 = Number(m[1].match(/\d+/)[0]) - 1; const r2 = Number(m[2].match(/\d+/)[0]) - 1; const c1 = colIndex(m[1]); const c2 = colIndex(m[2]);
      const v = grid[r1]?.[c1] ?? '';
      for (let r = r1; r <= r2; r++) for (let c = c1; c <= c2; c++) if (r !== r1 || c !== c1) (grid[r] ||= [])[c] = v;
    }
  }
  return Array.from({ length: grid.length }, (_, r) => Array.from({ length: (grid[r] || []).length }, (__, c) => grid[r]?.[c] ?? ''));
}

// Every sheet of a file (one for CSV, text and HTML). Returns { format, sheets: [{ name, hidden, grid, date1904 }] }.
// opts.fillMerged copies a merged cell's value into every cell it covers.
export async function readSheets(bytes, name = '', opts = {}) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const format = sniff(u8, name);
  if (format === 'xlsx') return { format, sheets: await xlsxSheets(u8, opts) };
  if (format === 'xls') return { format, sheets: xlsToGrid(u8, 'names').map((n, i) => ({ name: n.name || `Sheet${i + 1}`, hidden: n.hidden, date1904: false, grid: xlsToGrid(u8, i, opts) })) };
  const { grid } = await readSheet(u8, name);
  return { format, sheets: [{ name: name.replace(/\.[^.]+$/, '') || 'Sheet1', hidden: false, date1904: false, grid }] };
}

// Any of the above. Returns { format, grid }.
export async function readSheet(bytes, name = '') {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const format = sniff(u8, name);
  if (format === 'xls') return { format, grid: xlsToGrid(u8) };
  if (format === 'xlsx') return { format, grid: await xlsxToGrid(u8) };
  const text = textOf(u8);
  if (format === 'html') return { format, grid: htmlToGrid(text) };
  return { format, grid: textToGrid(text) };
}
