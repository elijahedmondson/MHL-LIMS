#!/usr/bin/env node
// Writes small, fictional slide image files for trying the pilot's WSI imports: pilot/samples/scanners.
//
//   node tools/wsi-samples/make_wsi_samples.mjs
//
// They have the structure the scanners use (TIFF or BigTIFF directories, an "Aperio" ImageDescription for .svs, a
// PerkinElmer/Akoya XML description per channel for .qptiff, an XML channel list for .afi) but a one-pixel strip
// instead of a real image, so they are a few kilobytes. The header fields follow published descriptions of these
// formats; check them against real files from MHL's scanners (open question 36). PHL numbers match the pilot's test
// data for 2026.

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.resolve(here, '..', '..', 'pilot', 'samples', 'scanners');

// Minimal little-endian TIFF / BigTIFF writer. Each IFD: { width, height, description, xres, resUnit, dateTime }.
function writeTiff(ifds, { big = false } = {}) {
  const buf = new Uint8Array(1 << 20); const dv = new DataView(buf.buffer);
  let pos = 0;
  const align = () => { pos = (pos + 7) & ~7; };
  const ascii = (s) => { const b = new TextEncoder().encode(`${s}\0`); return b; };
  // header
  buf.set([0x49, 0x49]); dv.setUint16(2, big ? 43 : 42, true);
  let nextPtr;
  if (big) { dv.setUint16(4, 8, true); dv.setUint16(6, 0, true); nextPtr = 8; pos = 16; } else { nextPtr = 4; pos = 8; }
  const setOff = (at, v) => (big ? dv.setBigUint64(at, BigInt(v), true) : dv.setUint32(at, v, true));
  for (const d of ifds) {
    align();
    const strip = pos; buf.set([200, 120, 160], pos); pos += 3;   // one pink pixel
    const entries = [];
    const add = (tag, type, count, valueOrBytes) => entries.push({ tag, type, count, v: valueOrBytes });
    add(256, 4, 1, d.width); add(257, 4, 1, d.height);
    add(258, 3, 1, 8); add(259, 3, 1, 1); add(262, 3, 1, 2);
    if (d.description) { const b = ascii(d.description); add(270, 2, b.length, b); }
    add(273, big ? 16 : 4, 1, strip); add(277, 3, 1, 3); add(278, 4, 1, d.height); add(279, 4, 1, 3);
    if (d.xres) {
      add(282, 5, 1, [Math.round(d.xres * 1000), 1000]); add(283, 5, 1, [Math.round(d.xres * 1000), 1000]); add(296, 3, 1, d.resUnit || 3);
    }
    if (d.dateTime) { const b = ascii(d.dateTime); add(306, 2, b.length, b); }
    entries.sort((a, b) => a.tag - b.tag);
    // out-of-line values
    const inlineMax = big ? 8 : 4;
    for (const e of entries) {
      if (e.v instanceof Uint8Array && e.v.length > inlineMax) { align(); e.off = pos; buf.set(e.v, pos); pos += e.v.length; }
      else if (Array.isArray(e.v) && 8 > inlineMax) { align(); e.off = pos; dv.setUint32(pos, e.v[0], true); dv.setUint32(pos + 4, e.v[1], true); pos += 8; }
    }
    align();
    const ifdAt = pos;
    setOff(nextPtr, ifdAt);
    if (big) { dv.setBigUint64(pos, BigInt(entries.length), true); pos += 8; } else { dv.setUint16(pos, entries.length, true); pos += 2; }
    for (const e of entries) {
      dv.setUint16(pos, e.tag, true); dv.setUint16(pos + 2, e.type, true);
      if (big) dv.setBigUint64(pos + 4, BigInt(e.count), true); else dv.setUint32(pos + 4, e.count, true);
      const vp = pos + (big ? 12 : 8);
      if (e.off != null) setOff(vp, e.off);
      else if (e.v instanceof Uint8Array) buf.set(e.v, vp);
      else if (Array.isArray(e.v)) { dv.setUint32(vp, e.v[0], true); dv.setUint32(vp + 4, e.v[1], true); }
      else if (e.type === 3) dv.setUint16(vp, e.v, true);
      else if (e.type === 16) dv.setBigUint64(vp, BigInt(e.v), true);
      else dv.setUint32(vp, e.v, true);
      pos += big ? 20 : 12;
    }
    nextPtr = pos; setOff(pos, 0); pos += big ? 8 : 4;
  }
  return buf.slice(0, pos);
}

const aperio = (header, props) => `${header}\r\n${props.dims}|${Object.entries(props).filter(([k]) => k !== 'dims').map(([k, v]) => `${k} = ${v}`).join('|')}`;
const svs = (file, header, props, { label = true } = {}) => {
  const [w, h] = props.dims.split(' ')[0].split('x').map(Number);
  const ifds = [{ width: w, height: h, description: aperio(header, props) },
    { width: 1024, height: 731, description: `${header}\r\n${w}x${h} -> 1024x731 - |AppMag = ${props.AppMag}|MPP = ${props.MPP}` }];
  if (label) ifds.push({ width: 445, height: 422, description: `${header}\r\nlabel 445x422` }, { width: 1280, height: 431, description: `${header}\r\nmacro 1280x431` });
  writeFileSync(path.join(OUT, file), writeTiff(ifds));
};

mkdirSync(OUT, { recursive: true });
const GT = 'Aperio Leica Biosystems GT450 v1.0.1';
const AT = 'Aperio Image Library v12.0.15';
for (const [n, t] of [[1, '10:02:41'], [2, '10:04:13']]) {
  svs(`26000326A-S0${n}.svs`, GT, { dims: '98304x61440 [0,0 98304x61440] (256x256) JPEG/RGB Q=80', AppMag: 40, MPP: 0.2630, 'ScanScope ID': 'SS45001', ScannerType: 'GT450',
    Date: '11/06/2026', Time: t, 'Time Zone': 'GMT-05:00', Filename: `26000326A-S0${n}`, Barcode: `26000326A-S0${n}`, Rack: 2, Slide: n });
}
svs('26000307A-B4-HE.svs', AT, { dims: '46000x32914 [0,100 46000x32814] (240x240) JPEG/RGB Q=70', AppMag: 20, MPP: 0.4990, 'ScanScope ID': 'SS7201', Date: '11/06/26',
  Time: '09:31:07', 'Time Zone': 'GMT-05:00', Filename: '26000307A-B4-HE', User: 'histology', StripeWidth: 2040 });
svs('Slide_0042.svs', AT, { dims: '42000x30500 [0,100 42000x30400] (240x240) JPEG/RGB Q=70', AppMag: 20, MPP: 0.4990, 'ScanScope ID': 'SS7201', Date: '11/06/26',
  Time: '09:44:55', Filename: 'Slide_0042', User: 'histology' });

// Aperio FL: one .svs per channel and an .afi that lists them.
const channels = [['DAPI', 'DAPI'], ['FITC', 'GFP'], ['TRITC', 'Ki-67']];
for (const [filter] of channels) {
  svs(`26000306A-B2-IF_${filter}.svs`, AT, { dims: '40960x30720 [0,0 40960x30720] (256x256) J2K/YUV16 Q=70', AppMag: 20, MPP: 0.4960, 'ScanScope ID': 'FL1234',
    Date: '11/06/26', Time: '11:20:18', Filename: `26000306A-B2-IF_${filter}`, 'Exposure Time': 120, 'Filter': filter }, { label: false });
}
writeFileSync(path.join(OUT, '26000306A-B2-IF.afi'), `<?xml version="1.0" encoding="utf-8"?>\r\n<ImageList>\r\n${channels.map(([filter, name]) =>
  `  <Image>\r\n    <Path>26000306A-B2-IF_${filter}.svs</Path>\r\n    <ChannelName>${name}</ChannelName>\r\n  </Image>`).join('\r\n')}\r\n</ImageList>\r\n`);

// PhenoImager HT: BigTIFF, one full-resolution page per Opal channel, then a reduced-resolution page.
const opal = [['DAPI', ''], ['Opal 480', 'CD8'], ['Opal 520', 'PD-L1'], ['Opal 570', 'CD68'], ['Opal 620', 'FoxP3'], ['Opal 690', 'PanCK'], ['Opal 780', 'Ki-67']];
const qpiXml = (name, biomarker, type) => `<?xml version="1.0" encoding="utf-16"?><PerkinElmer-QPI-ImageDescription><DescriptionVersion>2</DescriptionVersion>`
  + `<AcquisitionSoftware>PhenoImagerHT</AcquisitionSoftware><ImageType>${type}</ImageType><Identifier>3f1c0b6e-0000-0000-0000-000000000000</Identifier>`
  + `<SlideID>26000313A</SlideID><Barcode>26000313A</Barcode><ComputerName>PHENO-HT-01</ComputerName><IsUnmixedComponent>False</IsUnmixedComponent>`
  + `<ExposureTime>${name === 'DAPI' ? 2000 : 15000}</ExposureTime><SignalUnits>64</SignalUnits><Name>${name}</Name>${biomarker ? `<Biomarker>${biomarker}</Biomarker>` : ''}`
  + `<Objective>20x</Objective></PerkinElmer-QPI-ImageDescription>`;
const pxPerCm = 10000 / 0.4972;
writeFileSync(path.join(OUT, '26000313A_Scan1.qptiff'), writeTiff([
  ...opal.map(([n, b]) => ({ width: 52440, height: 38612, description: qpiXml(n, b, 'FullResolution'), xres: pxPerCm, resUnit: 3, dateTime: '2026:11:06 13:05:44' })),
  { width: 13110, height: 9653, description: qpiXml('DAPI', '', 'ReducedResolution'), xres: pxPerCm / 4, resUnit: 3, dateTime: '2026:11:06 13:05:44' },
], { big: true }));
console.log(`Wrote samples to ${OUT}`);
