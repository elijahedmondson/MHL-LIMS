// Antibody dilution arithmetic for the IHC dilution calculator: C1V1 = C2V2 solved for any one value, dilution ratios
// (1:X means one part antibody in X parts total), volumes for a run of slides, and an intermediate dilution when the
// antibody volume is too small to pipette. Also reads the dilutions written in the IHC catalog ("1:200 ON 4C",
// "1st: 1:100 | 2nd: 1:500", "5ug/ml", "RTU"). Used by the core tests and the browser (/lib/dilution.mjs).

export const VOLUME_UNITS = { L: 1e6, mL: 1000, 'µL': 1, nL: 0.001 };
// Mass per volume, in µg/mL. µg/µL equals mg/mL and ng/µL equals µg/mL.
export const CONC_UNITS = { 'mg/mL': 1000, 'µg/µL': 1000, 'µg/mL': 1, 'ng/µL': 1, 'ng/mL': 0.001, 'pg/µL': 0.001, 'pg/mL': 1e-6 };

const unitKey = (u, table) => {
  const k = String(u || '').replace(/u(?=[gLl])/g, 'µ').replace(/μ/g, 'µ').replace(/ml\b/, 'mL').replace(/ul\b/i, 'µL').replace(/µl\b/, 'µL');
  return table[k] != null ? k : Object.keys(table).find((x) => x.toLowerCase() === k.toLowerCase()) || null;
};
export const toUl = (v, unit) => { const k = unitKey(unit, VOLUME_UNITS); if (!k) throw new Error(`Unknown volume unit ${unit}.`); return Number(v) * VOLUME_UNITS[k]; };
export const fromUl = (ul, unit) => ul / VOLUME_UNITS[unitKey(unit, VOLUME_UNITS)];
export const toUgMl = (c, unit) => { const k = unitKey(unit, CONC_UNITS); if (!k) throw new Error(`Unknown concentration unit ${unit}.`); return Number(c) * CONC_UNITS[k]; };
export const fromUgMl = (c, unit) => c / CONC_UNITS[unitKey(unit, CONC_UNITS)];

const positive = (x, label) => { if (!(Number.isFinite(x) && x > 0)) throw new Error(`Enter ${label} greater than zero.`); return x; };

// Rounded for showing: 3 significant figures, at most 2 decimals for volumes of 10 or more.
export function nice(x) {
  if (!Number.isFinite(x)) return '';
  if (x === 0) return '0';
  const a = Math.abs(x);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : a >= 1 ? 2 : Math.min(8, 2 - Math.floor(Math.log10(a)));
  return String(Number(x.toFixed(d)));
}
// A volume in µL shown in the unit that reads best.
export function showVolume(ul) {
  if (!Number.isFinite(ul)) return '';
  if (Math.abs(ul) >= 1000) return `${nice(ul / 1000)} mL`;
  if (Math.abs(ul) < 0.1 && ul !== 0) return `${nice(ul * 1000)} nL`;
  return `${nice(ul)} µL`;
}
export const showRatio = (factor) => `1:${factor >= 100 ? Math.round(factor).toLocaleString('en-US') : nice(factor)}`;

// ---------- C1V1 = C2V2 ----------
// Give three of { c1, v1, c2, v2 } (concentrations in µg/mL, volumes in µL) and name the one to solve for.
export function solveC1V1({ c1, v1, c2, v2, solveFor }) {
  let r;
  if (solveFor === 'v1') {
    positive(c1, 'the stock concentration'); positive(c2, 'the working concentration'); positive(v2, 'the final volume');
    if (c2 > c1) throw new Error('The working concentration is higher than the stock: a dilution cannot concentrate an antibody.');
    r = { c1, c2, v2, v1: (c2 * v2) / c1 };
  } else if (solveFor === 'v2') {
    positive(c1, 'the stock concentration'); positive(v1, 'the stock volume'); positive(c2, 'the working concentration');
    if (c2 > c1) throw new Error('The working concentration is higher than the stock: a dilution cannot concentrate an antibody.');
    r = { c1, v1, c2, v2: (c1 * v1) / c2 };
  } else if (solveFor === 'c2') {
    positive(c1, 'the stock concentration'); positive(v1, 'the stock volume'); positive(v2, 'the final volume');
    if (v1 > v2) throw new Error('The stock volume is larger than the final volume.');
    r = { c1, v1, v2, c2: (c1 * v1) / v2 };
  } else if (solveFor === 'c1') {
    positive(v1, 'the stock volume'); positive(c2, 'the working concentration'); positive(v2, 'the final volume');
    if (v1 > v2) throw new Error('The stock volume is larger than the final volume.');
    r = { v1, c2, v2, c1: (c2 * v2) / v1 };
  } else throw new Error('Choose what to calculate.');
  return { ...r, diluent: r.v2 - r.v1, factor: r.c1 / r.c2 };
}

// 1:X with a final volume. With a stock concentration, also the working concentration.
export function byRatio({ factor, v2, c1 = null }) {
  positive(factor, 'the dilution (the X in 1:X)'); positive(v2, 'the final volume');
  if (factor < 1) throw new Error('A dilution of 1:X needs X of 1 or more.');
  const v1 = v2 / factor;
  return { factor, v1, v2, diluent: v2 - v1, c1, c2: c1 ? c1 / factor : null };
}

// ---------- too little to pipette ----------
// When the antibody volume is below what can be pipetted accurately, make an intermediate dilution first: 1:k of the
// stock, then dilute that to the final 1:X. Picks the smallest usual k that makes both pipetting steps big enough.
export function intermediate({ factor, v2, minUl = 1 }) {
  if (!(factor > 0 && v2 > 0 && minUl > 0)) return null;
  const direct = v2 / factor;
  if (direct >= minUl) return null;
  if (factor <= 5) return { k: null, note: 'The dilution is too weak for an intermediate step; make more working solution so the antibody volume can be pipetted.' };
  for (const k of [5, 10, 20, 25, 50, 100, 200, 500, 1000].filter((x) => x < factor)) {
    const second = v2 / (factor / k);            // volume of the intermediate to use
    if (second < minUl || v2 - second < minUl) continue;
    const prep = Math.max(Math.ceil((second * 1.2) / 10) * 10, k * minUl, 50);   // intermediate made with 20% spare
    const prepStock = prep / k;
    if (prepStock < minUl) continue;
    return { k, intermediateUl: prep, stockUl: prepStock, intermediateDiluentUl: prep - prepStock, useUl: second, finalDiluentUl: v2 - second };
  }
  return { k: null, note: 'Even a 1:1000 intermediate dilution leaves less than the minimum to pipette; make more working solution.' };
}

// ---------- a run of slides ----------
// Working solution for n slides at µL per slide, with a spare percentage and a fixed dead volume (the platform's
// reagent container), then the antibody and diluent volumes.
export function forSlides({ slides, perSlideUl, extraPct = 10, deadUl = 0, factor = null, c1 = null, c2 = null, minUl = 1 }) {
  if (!(Number.isInteger(slides) && slides > 0)) throw new Error('Enter the number of slides as a whole number.');
  positive(perSlideUl, 'the volume per slide');
  if (!(extraPct >= 0 && extraPct <= 200)) throw new Error('Spare must be between 0 and 200%.');
  if (!(deadUl >= 0)) throw new Error('Dead volume cannot be negative.');
  const v2 = slides * perSlideUl * (1 + extraPct / 100) + deadUl;
  const f = factor || (c1 && c2 ? c1 / c2 : null);
  if (!f) throw new Error('Give the dilution, or the stock and working concentrations.');
  if (f < 1) throw new Error('The working concentration is higher than the stock.');
  const r = byRatio({ factor: f, v2, c1 });
  return { ...r, slides, perSlideUl, extraPct, deadUl, intermediate: intermediate({ factor: f, v2, minUl }) };
}

// ---------- dilutions written in the catalog ----------
// Returns a list, one entry per antibody: { factor } or { ugPerMl } (a working concentration), with { label } when the
// text names it ("1st", "2nd"), or [{ rtu: true }] for ready-to-use. Incubation notes (ON 4C, 30') are ignored.
export function parseCatalogDilution(text) {
  const t = String(text || '').trim();
  if (!t || /^n\/?a$/i.test(t)) return [];
  if (/\b(rtu|ready[- ]to[- ]use|prediluted|pre-diluted)\b/i.test(t)) return [{ rtu: true }];
  const parts = t.split(/\s*[|;]\s*|,\s+(?=\d+(?:st|nd|rd|th)?\s*[:]?\s*1\s*[:/])/i).filter(Boolean);
  const out = [];
  for (const part of parts) {
    const label = (part.match(/^\s*(\d+(?:st|nd|rd|th))\s*:/i) || [])[1] || '';
    const body = label ? part.replace(/^\s*\d+(?:st|nd|rd|th)\s*:\s*/i, '') : part;
    if (/^\s*n\/?a\b/i.test(body)) continue;
    // "1:50 to 1:100 (lot dependent)": one antibody with a range; the stronger end is used.
    const range = body.match(/\b1\s*[:/]\s*([\d,]+)\s*(?:to|-|–)\s*1\s*[:/]\s*([\d,]+)/i);
    if (range) { out.push({ factor: Number(range[1].replace(/,/g, '')), range: [Number(range[1].replace(/,/g, '')), Number(range[2].replace(/,/g, ''))], ...(label ? { label } : {}) }); continue; }
    const ratios = [...body.matchAll(/\b1\s*[:/]\s*([\d,]+(?:\.\d+)?)\b(?!\s*(?:ug|µg|μg|mg|ng))/gi)].map((m) => Number(m[1].replace(/,/g, ''))).filter((x) => x >= 1);
    const conc = body.match(/(\d+(?:\.\d+)?)\s*(ug|µg|μg|mg|ng)\s*\/\s*m?l/i);
    if (ratios.length) ratios.forEach((f) => out.push({ factor: f, ...(label ? { label } : {}), ...(conc && ratios.length === 1 ? { ugPerMl: Number(conc[1]) * (conc[2].toLowerCase() === 'mg' ? 1000 : conc[2].toLowerCase() === 'ng' ? 0.001 : 1) } : {}) }));
    else if (conc) out.push({ ugPerMl: Number(conc[1]) * (conc[2].toLowerCase() === 'mg' ? 1000 : conc[2].toLowerCase() === 'ng' ? 0.001 : 1), ...(label ? { label } : {}) });
  }
  // Several antibodies (a panel) without "1st"/"2nd": number them in order.
  if (out.length > 1) out.forEach((e, i) => { if (!e.label) e.label = `#${i + 1}`; });
  return out;
}

// Default dispense volume per slide by platform. Editable on the page: check the instrument's settings.
export const PER_SLIDE_DEFAULT = { 'Leica Bond': 150, Manual: 100, Mixed: 150 };
