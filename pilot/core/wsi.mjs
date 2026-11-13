// Whole-slide imaging for the pilot: the four scanners, reading what they write (image file headers, never the
// pixels), finding the MHL number and block or slide in a file's barcode or name, and the scan charge.
//
// The scanners do not take orders from a LIMS. What they share is that each reads the slide's barcode label and saves
// an image file to an output folder: Aperio AT2 and GT 450 write .svs (TIFF with an "Aperio" ImageDescription:
// AppMag, MPP, ScanScope ID, Date, Time, sometimes Barcode), the Aperio FL writes an .afi (XML listing one .svs per
// channel), and the Akoya PhenoImager HT writes .qptiff (BigTIFF with a PerkinElmer/Akoya XML description per
// channel). Reading a few kilobytes from the start of each file is enough to register it.
// Used by the core, the server (folder reading) and the browser (/lib/wsi.mjs).

export const SCANNERS = [
  { id: 'AT2', name: 'Aperio AT2', vendor: 'Leica Biosystems', modes: ['Brightfield'], mags: [20, 40], formats: ['.svs'],
    about: 'Brightfield, 400-slide capacity. Writes .svs files.' },
  { id: 'GT450', name: 'Aperio GT 450', vendor: 'Leica Biosystems', modes: ['Brightfield'], mags: [40], formats: ['.svs'],
    about: 'High-throughput brightfield, scans at 40x. Writes .svs files.' },
  { id: 'FL', name: 'Aperio FL', vendor: 'Leica Biosystems', modes: ['Fluorescence'], mags: [20, 40], formats: ['.afi', '.svs'],
    about: 'Fluorescence. Writes an .afi file that lists one .svs file per channel.' },
  { id: 'PHENOHT', name: 'Akoya PhenoImager HT', vendor: 'Akoya Biosciences', modes: ['Multispectral fluorescence', 'Brightfield'], mags: [10, 20, 40], formats: ['.qptiff'],
    about: 'Opal multiplex and brightfield whole-slide scans. Writes .qptiff files (multispectral fields as .im3, not read here).' },
];
export const IMAGE_EXTENSIONS = ['.svs', '.afi', '.qptiff', '.tif', '.tiff'];
// Folders are read for the scanners' own formats only: exported TIFFs (thumbnails, analysis output) are left alone.
export const FOLDER_EXTENSIONS = ['.svs', '.afi', '.qptiff'];
// The channel files an Aperio FL .afi lists (file names only); they are part of that image, not images of their own.
export const afiChannelFiles = (xml) => [...String(xml || '').matchAll(/<Path>([^<]*)<\/Path>/gi)].map((m) => m[1].trim().split(/[\\/]/).pop()).filter(Boolean);
export const RESCAN_REASONS = ['Out of focus', 'Tissue missed (scan area)', 'Bubbles or debris', 'Stitching or striping artifact', 'Barcode unreadable',
  'Wrong magnification', 'Fluorescence too dim or saturated', 'Wrong slide', 'Other'];

// ---------- TIFF and BigTIFF, read through readAt(offset, length) -> Uint8Array ----------
const TYPE_SIZE = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8, 13: 4, 16: 8, 17: 8, 18: 8 };
const WANT = new Set([256, 257, 259, 262, 270, 277, 282, 283, 296, 305, 306, 322, 323]);
const MAX_TEXT = 512 * 1024;

function decodeText(bytes) {
  let end = bytes.indexOf(0);
  // UTF-16 text has a zero in every other byte.
  if (end === 1 && bytes.length > 3 && bytes[3] === 0) return new TextDecoder('utf-16le').decode(bytes).replace(/\0+$/, '');
  if (end < 0) end = bytes.length;
  return new TextDecoder('utf-8').decode(bytes.subarray(0, end));
}

export async function readTiff(readAt, size, { maxIfds = 200, stop = null } = {}) {
  const head = await readAt(0, 16);
  if (head.length < 8) return null;
  const le = head[0] === 0x49 && head[1] === 0x49;
  if (!le && !(head[0] === 0x4D && head[1] === 0x4D)) return null;
  const hv = new DataView(head.buffer, head.byteOffset, head.byteLength);
  const magic = hv.getUint16(2, le);
  let big = false; let off;
  if (magic === 42) off = hv.getUint32(4, le);
  else if (magic === 43 && head.length >= 16) { big = true; off = Number(hv.getBigUint64(8, le)); }
  else return null;
  const ifds = []; const seen = new Set();
  while (off > 0 && (!size || off < size) && ifds.length < maxIfds && !seen.has(off)) {
    seen.add(off);
    const cb = await readAt(off, big ? 8 : 2);
    if (cb.length < (big ? 8 : 2)) break;
    const cv = new DataView(cb.buffer, cb.byteOffset, cb.byteLength);
    const n = big ? Number(cv.getBigUint64(0, le)) : cv.getUint16(0, le);
    if (n === 0 || n > 2000) break;
    const es = big ? 20 : 12;
    const block = await readAt(off + (big ? 8 : 2), n * es + (big ? 8 : 4));
    if (block.length < n * es) break;
    const bv = new DataView(block.buffer, block.byteOffset, block.byteLength);
    const tags = {};
    for (let i = 0; i < n; i++) {
      const p = i * es;
      const tag = bv.getUint16(p, le); const type = bv.getUint16(p + 2, le);
      if (!WANT.has(tag) || !TYPE_SIZE[type]) continue;
      const count = big ? Number(bv.getBigUint64(p + 4, le)) : bv.getUint32(p + 4, le);
      const bytes = count * TYPE_SIZE[type];
      const inline = bytes <= (big ? 8 : 4);
      const vpos = p + (big ? 12 : 8);
      let data;
      if (inline) data = block.subarray(vpos, vpos + bytes);
      else {
        const at = big ? Number(bv.getBigUint64(vpos, le)) : bv.getUint32(vpos, le);
        data = await readAt(at, Math.min(bytes, type === 2 ? MAX_TEXT : 64));
      }
      const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
      if (type === 2) tags[tag] = decodeText(data);
      else if (type === 3 || type === 8) tags[tag] = data.length >= 2 ? dv.getUint16(0, le) : null;
      else if (type === 4 || type === 9 || type === 13) tags[tag] = data.length >= 4 ? dv.getUint32(0, le) : null;
      else if (type === 16 || type === 17 || type === 18) tags[tag] = data.length >= 8 ? Number(dv.getBigUint64(0, le)) : null;
      else if (type === 5 || type === 10) tags[tag] = data.length >= 8 && dv.getUint32(4, le) ? dv.getUint32(0, le) / dv.getUint32(4, le) : null;
      else if (type === 1 || type === 7) tags[tag] = data[0];
    }
    const ifd = { width: tags[256] ?? null, height: tags[257] ?? null, compression: tags[259] ?? null, photometric: tags[262] ?? null, samples: tags[277] ?? null,
      description: tags[270] || '', xres: tags[282] ?? null, yres: tags[283] ?? null, resUnit: tags[296] ?? null, software: tags[305] || '', dateTime: tags[306] || '',
      tiled: tags[322] != null };
    ifds.push(ifd);
    if (stop && stop(ifd, ifds.length - 1)) break;
    const np = n * es;
    off = big ? (block.length >= np + 8 ? Number(bv.getBigUint64(np, le)) : 0) : (block.length >= np + 4 ? bv.getUint32(np, le) : 0);
  }
  return { big, littleEndian: le, ifds };
}

// ---------- what the descriptions say ----------
export function parseAperio(desc) {
  const parts = String(desc || '').split('|');
  const props = {};
  for (const p of parts.slice(1)) { const i = p.indexOf('='); if (i > 0) props[p.slice(0, i).trim()] = p.slice(i + 1).trim(); }
  return { header: parts[0].trim(), props };
}

const pad = (n) => String(n).padStart(2, '0');
function isoDate(s) {
  const t = String(s || '').trim();
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/); if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${pad(m[1])}-${pad(m[2])}`;
  m = t.match(/^(\d{4}):(\d{2}):(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;   // TIFF DateTime
  return '';
}
const hhmm = (s) => (String(s || '').match(/\b(\d{1,2}):(\d{2})/) || []).slice(1, 3).map(pad).join(':');
const xmlTag = (xml, name) => { const m = String(xml || '').match(new RegExp(`<${name}>([^<]*)</${name}>`, 'i')); return m ? m[1].trim() : ''; };
export const magFromMpp = (mpp) => (!mpp ? null : mpp < 0.35 ? 40 : mpp < 0.7 ? 20 : mpp < 1.4 ? 10 : 5);
function mppFromRes(ifd) {
  if (!ifd?.xres) return null;
  if (ifd.resUnit === 3) return 10000 / ifd.xres;   // pixels per centimetre
  if (ifd.resUnit === 2) return 25400 / ifd.xres;   // pixels per inch
  return null;
}

// Reads one image file. resolve(name) may return { readAt, size } for files an .afi refers to.
export async function readSlideFile({ name, size, readAt, readText = null, resolve = null }) {
  const ext = (String(name).match(/\.[^.]+$/) || [''])[0].toLowerCase();
  const out = { fileName: name, sizeBytes: size || 0, format: '', model: null, modelStated: false, barcode: '', slideId: '', internalName: '', mag: null, mpp: null,
    width: null, height: null, channels: [], scannedOn: '', scannedAt: '', serial: '', operator: '', hasLabel: false, hasMacro: false, description: '', warnings: [], refers: [] };
  if (ext === '.afi') {
    const xml = readText ? await readText() : decodeText(await readAt(0, Math.min(size || MAX_TEXT, MAX_TEXT)));
    out.format = 'AFI'; out.model = 'FL'; out.modelStated = true; out.description = xml.slice(0, 1200);
    for (const m of xml.matchAll(/<Image>([\s\S]*?)<\/Image>/gi)) {
      const path = xmlTag(m[1], 'Path'); const ch = xmlTag(m[1], 'ChannelName');
      out.channels.push({ name: ch || path, file: path.split(/[\\/]/).pop() });
      if (path) out.refers.push(path.split(/[\\/]/).pop());
    }
    if (!out.channels.length) out.warnings.push('The .afi file lists no channel images.');
    const first = resolve && out.refers[0] ? await resolve(out.refers[0]) : null;
    if (first) {
      const inner = await readSlideFile({ name: out.refers[0], size: first.size, readAt: first.readAt });
      // The channel file's own name is channel-specific, so the .afi's name identifies the slide.
      Object.assign(out, { mag: inner.mag, mpp: inner.mpp, width: inner.width, height: inner.height, scannedOn: inner.scannedOn, scannedAt: inner.scannedAt,
        serial: inner.serial, operator: inner.operator, barcode: inner.barcode, hasLabel: inner.hasLabel, hasMacro: inner.hasMacro });
    } else if (out.refers.length) out.warnings.push('The channel .svs files were not found next to the .afi, so magnification and scan date are not known.');
    return out;
  }
  const qptiff = ext === '.qptiff';
  const tiff = await readTiff(readAt, size, {
    // A .qptiff holds every channel at every resolution; the full-resolution channels come first.
    stop: qptiff ? (ifd, i) => i > 0 && /<ImageType>\s*(Reduced|Thumbnail|Overview|Label)/i.test(ifd.description) : null,
  });
  if (!tiff || !tiff.ifds.length) { out.format = 'UNREADABLE'; out.warnings.push('This is not a TIFF-based slide image, or its header could not be read.'); return out; }
  const first = tiff.ifds[0];
  Object.assign(out, { width: first.width, height: first.height, description: first.description.slice(0, 1200) });
  if (/^Aperio/i.test(first.description)) {
    const { header, props } = parseAperio(first.description);
    out.format = 'SVS';
    const gt = /GT ?450/i.test(header) || /GT ?450/i.test(props.ScannerType || '');
    out.model = gt ? 'GT450' : 'AT2'; out.modelStated = gt;
    out.mag = Number(props.AppMag) || null; out.mpp = Number(props.MPP) || null;
    out.scannedOn = isoDate(props.Date); out.scannedAt = hhmm(props.Time);
    out.serial = props['ScanScope ID'] || props.ScannerID || ''; out.operator = props.User || '';
    out.barcode = props.Barcode || props['Barcode Value'] || props.BarcodeValue || '';
    out.internalName = props.Filename || '';
    out.hasLabel = tiff.ifds.some((d) => /\blabel\b/i.test(d.description)); out.hasMacro = tiff.ifds.some((d) => /\bmacro\b/i.test(d.description));
    if (props.ScannerType && !gt) out.warnings.push(`Scanner type ${props.ScannerType}.`);
  } else if (/QPI-ImageDescription/i.test(first.description) || qptiff) {
    out.format = 'QPTIFF'; out.model = 'PHENOHT'; out.modelStated = /QPI-ImageDescription/i.test(first.description);
    const full = tiff.ifds.filter((d) => /<ImageType>\s*FullResolution/i.test(d.description));
    for (const d of (full.length ? full : [first])) {
      const nm = xmlTag(d.description, 'Name'); const bm = xmlTag(d.description, 'Biomarker');
      if (nm || bm) out.channels.push({ name: nm || bm, biomarker: bm && bm !== nm ? bm : '', exposure: xmlTag(d.description, 'ExposureTime') });
    }
    out.slideId = xmlTag(first.description, 'SlideID'); out.barcode = xmlTag(first.description, 'Barcode');
    out.serial = xmlTag(first.description, 'InstrumentSerial') || xmlTag(first.description, 'ComputerName');
    out.mpp = mppFromRes(first) || null;
    const objective = xmlTag(first.description, 'Objective') || xmlTag(first.description, 'ObjectiveName');
    out.mag = Number((objective.match(/(\d+)\s*x/i) || [])[1]) || magFromMpp(out.mpp);
    out.scannedOn = isoDate(first.dateTime) || isoDate(xmlTag(first.description, 'AcquisitionDate')); out.scannedAt = hhmm(first.dateTime.slice(10));
    out.hasLabel = /<ImageType>\s*Label/i.test(first.description);
    if (!out.channels.length) out.warnings.push('No channel names were found in the .qptiff descriptions.');
  } else {
    out.format = 'TIFF'; out.mpp = mppFromRes(first); out.mag = magFromMpp(out.mpp);
    out.scannedOn = isoDate(first.dateTime); out.scannedAt = hhmm(first.dateTime.slice(10));
    out.warnings.push('A plain TIFF: the scanner is not recorded in the file.');
  }
  if (out.mpp && !out.mag) out.mag = magFromMpp(out.mpp);
  return out;
}

// ---------- which slide is it ----------
// Slide IDs as the LIMS prints them: MHL# then optional block and slide, e.g. 26000305A-B2-S01, 26000305A_B2,
// 26000305A-S03. Anything left after them (HE, CD8, Scan1) is kept as a hint of the stain.
const NOISE = /^(scan\d*|fl|qptiff|svs|copy|\d{4,}|\d{1,2}x|x\d{1,2}|ht|at2|gt450)$/i;
const DATE8 = /^(19|20)\d{2}(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/;
export function parseSlideId(text) {
  const t = String(text || '').toUpperCase().replace(/\.(SVS|AFI|QPTIFF|TIFF?)$/i, '');
  // Every 8-digit run: one with the MHL-number letter wins, and a date (20261105) loses to anything else.
  const found = [...t.matchAll(/(?:^|[^0-9])(\d{8})([A-Z])?(?=$|[^0-9])/g)];
  if (!found.length) return null;
  const m = found.find((x) => x[2]) || found.find((x) => !DATE8.test(x[1])) || found[0];
  const rest = t.slice(m.index + m[0].length).split(/[-_ .]+/).filter(Boolean);
  let block = ''; let slide = ''; const hint = [];
  // Block and slide are at most two digits (or three with a leading zero), so markers like S100 and B220 stay as stains.
  for (const tok of rest) {
    let x;
    if (!block && (x = tok.match(/^B(?:LK|LOCK)?(0\d{2}|\d{1,2})([A-Z]?)$/))) block = `${Number(x[1])}${x[2]}`;
    else if (!slide && (x = tok.match(/^S(?:L|LIDE)?(0\d{2}|\d{1,2})$/))) slide = String(Number(x[1]));
    else if (!NOISE.test(tok)) hint.push(tok);
  }
  return { phl: `${m[1]}${m[2] || ''}`, digits: m[1], hasLetter: !!m[2], block, slide, stain: hint.join(' ').replace(/^H ?& ?E$|^HE$/, 'H&E').slice(0, 40) };
}

// The slide ID in the barcode, slide ID, internal file name or file name, in that order. With exists(id), the first
// that names a known MHL number wins, so a stray number in a barcode does not hide a good file name.
export function slideIdOf(info, exists = null) {
  let first = null;
  for (const [from, v] of [['barcode', info.barcode], ['slide ID', info.slideId], ['internal name', info.internalName], ['file name', info.fileName]]) {
    const id = parseSlideId(v);
    if (!id) continue;
    const hit = { ...id, from, text: v };
    if (!exists || exists(hit)) return hit;
    first ||= hit;
  }
  return first;
}

// ---------- scan charges (CY2027 list) ----------
// HP001006 Aperio 20x, HP001007 Aperio 40x, HP001009 Akoya HT fluorescence 20x. Where the list has no code the rule
// says which it used (open question 35).
export function scanCharge(scannerId, image) {
  const mag = Number(image.mag) || 20;
  const fluor = scannerId === 'FL' || (scannerId === 'PHENOHT' && (image.channels?.length || 0) > 1);
  if (scannerId === 'PHENOHT' && fluor) return { code: 'HP001009', assumption: mag > 20 ? 'The Akoya code is for 20x; a 40x multispectral scan is charged with it too.' : '' };
  if (scannerId === 'PHENOHT') return { code: mag >= 40 ? 'HP001007' : 'HP001006', assumption: 'A brightfield scan on the PhenoImager HT has no code of its own; it is charged as an Aperio scan at the same magnification.' };
  if (scannerId === 'FL') return { code: mag >= 40 ? 'HP001007' : 'HP001006', assumption: 'The Aperio FL has no fluorescence code; it is charged as an Aperio scan at the same magnification.' };
  return { code: mag >= 40 ? 'HP001007' : 'HP001006', assumption: '' };
}

// The scanner a slide should go to: fluorescent stains to the PhenoImager HT (Opal) or the Aperio FL, brightfield at 40x
// to the GT 450, otherwise the AT2.
export function suggestScanner({ fluorescent = false, opal = false, mag = 20 }) {
  if (fluorescent) return opal ? 'PHENOHT' : 'FL';
  return mag >= 40 ? 'GT450' : 'AT2';
}

export const showBytes = (n) => (!n ? '' : n >= 1e9 ? `${(n / 1e9).toFixed(1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`);
