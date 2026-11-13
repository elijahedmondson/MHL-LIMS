// Small SVG charts with no libraries: dot plots by group (organ weights, bloodwork), used by the study page and the
// printable study reports. Each point is an animal (circle female, triangle male, square sex not recorded); the gray point
// and bars beside each group are its mean and 95% confidence interval. A shaded band is a reference range.
import { esc } from '../ui.js';

export const PALETTE = ['#C2457A', '#4A3F86', '#2F7D5B', '#B26A00', '#3A7CA5', '#7A5C3E', '#8E44AD', '#5B6B7D'];
export const groupColors = (keys) => Object.fromEntries(keys.map((g, i) => [g, PALETTE[i % PALETTE.length]]));
export const rangeText = (r) => (!r ? '' : Number.isFinite(r.low) && Number.isFinite(r.high) ? `${fmt(r.low)} to ${fmt(r.high)}` : Number.isFinite(r.low) ? `${fmt(r.low)} or more` : Number.isFinite(r.high) ? `up to ${fmt(r.high)}` : '');
export const fmt = (v) => (v == null ? '' : Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 10 ? v.toFixed(1) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

export function niceTicks(min, max, count = 5) {
  const span = max - min || Math.abs(max) || 1;
  const step0 = span / count;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= step0) || step0;
  const ticks = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t / step) * step);
  return ticks;
}

// x: { label, unit, groups: [{ code, mean, ciLow, ciHigh, n }], points: [{ phl, label, group, sex, value, flag }] }.
// opts.range: { low, high } shaded; opts.width/height; opts.small for the report grids.
export function dotPlot(x, colors, opts = {}) {
  const groups = x.groups.filter((g) => g.n > 0);
  x = { ...x, points: x.points.filter((p) => Number.isFinite(p.value)) };
  if (!groups.length || !x.points.length) return '';
  const W = opts.width || 340, H = opts.height || 220, L = 52, R = 12, T = 10, B = 30;
  const range = opts.range && (Number.isFinite(opts.range.low) || Number.isFinite(opts.range.high)) ? opts.range : null;
  const values = [...x.points.map((p) => p.value), ...groups.flatMap((g) => [g.ciLow, g.ciHigh].filter((v) => v != null)),
    ...(range ? [range.low, range.high].filter((v) => Number.isFinite(v)) : [])];
  let lo = Math.min(...values), hi = Math.max(...values);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.1 || 1;
  lo -= pad; hi += pad;
  if (lo < 0 && Math.min(...x.points.map((p) => p.value)) >= 0) lo = Math.max(lo, 0 - pad * 0.2);
  const ticks = niceTicks(lo, hi);
  // Values beyond the axis (a confidence limit below zero, say) are drawn at its edge.
  const y = (v) => T + (H - T - B) * (1 - (Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo));
  const cats = groups.map((g) => g.code);
  const bw = (W - L - R) / cats.length;
  const cx = (code) => L + bw * (cats.indexOf(code) + 0.5);
  const jitter = (i) => ((i * 7919) % 13 / 12 - 0.5) * Math.min(28, bw * 0.45);
  const band = range ? (() => {
    const top = y(Number.isFinite(range.high) ? Math.min(range.high, hi) : hi); const bot = y(Number.isFinite(range.low) ? Math.max(range.low, lo) : lo);
    return `<rect x="${L}" y="${top}" width="${W - L - R}" height="${Math.max(0, bot - top)}" fill="#E3F2EA" opacity=".8"><title>Reference range ${rangeText(range)}</title></rect>`;
  })() : '';
  const marks = x.points.filter((p) => cats.includes(p.group)).map((p, i) => {
    const px = cx(p.group) + jitter(i), py = y(p.value), c = colors[p.group] || '#777';
    const ring = p.flag ? ` stroke="#B23B2E" stroke-width="1.6"` : '';
    const title = `<title>${esc(p.label ? `${p.label} (${p.phl})` : p.phl)}: ${fmt(p.value)} ${esc(x.unit)}${p.flag ? ` ${esc(p.flag)}` : ''}</title>`;
    if (p.sex === 'M') return `<path d="M${px} ${py - 5} L${px + 4.6} ${py + 3.5} L${px - 4.6} ${py + 3.5} Z" fill="${c}" opacity=".9"${ring}>${title}</path>`;
    if (p.sex === 'F') return `<circle cx="${px}" cy="${py}" r="3.8" fill="${c}" opacity=".9"${ring}>${title}</circle>`;
    return `<rect x="${px - 3.4}" y="${py - 3.4}" width="6.8" height="6.8" fill="${c}" opacity=".9"${ring}>${title}</rect>`;
  }).join('');
  const means = groups.map((g) => {
    const gx = cx(g.code) + Math.min(34, bw * 0.3);
    const ci = g.ciLow != null ? `<line x1="${gx}" x2="${gx}" y1="${y(g.ciLow)}" y2="${y(g.ciHigh)}" stroke="#9A97AC" stroke-width="2"/>
      <line x1="${gx - 6}" x2="${gx + 6}" y1="${y(g.ciLow)}" y2="${y(g.ciLow)}" stroke="#9A97AC" stroke-width="2"/>
      <line x1="${gx - 6}" x2="${gx + 6}" y1="${y(g.ciHigh)}" y2="${y(g.ciHigh)}" stroke="#9A97AC" stroke-width="2"/>` : '';
    return g.mean == null ? '' : `${ci}<circle cx="${gx}" cy="${y(g.mean)}" r="4.5" fill="#8A879C"><title>${esc(g.code)} mean ${fmt(g.mean)}${g.ciLow != null ? `, 95% CI ${fmt(g.ciLow)} to ${fmt(g.ciHigh)}` : ''} (n=${g.n})</title></circle>`;
  }).join('');
  return `<figure class="chart${opts.small ? ' chart-sm' : ''}" style="margin:0"><h3>${esc(x.label)} <span class="small muted" style="font-family:var(--body);font-weight:400">${esc(x.unit)}</span></h3>
    <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(x.label)} by group">
      ${band}
      ${ticks.map((t) => `<line x1="${L}" x2="${W - R}" y1="${y(t)}" y2="${y(t)}" stroke="#ECEAF2"/><text x="${L - 6}" y="${y(t) + 4}" text-anchor="end" font-size="11" fill="#5E5A73">${fmt(t)}</text>`).join('')}
      <line x1="${L}" x2="${L}" y1="${T}" y2="${H - B}" stroke="#C9C6D8"/>
      ${cats.map((c) => `<text x="${cx(c)}" y="${H - 10}" text-anchor="middle" font-size="12" fill="#2B2350">${esc(c)}</text>`).join('')}
      ${means}${marks}
    </svg></figure>`;
}

// The legend that goes with dotPlot: group colors and the point shapes.
export function legendHtml(keys, colors, groups = [], { range = false, flags = false } = {}) {
  const name = (k) => groups.find((g) => g.code === k)?.name || '';
  return `<div class="legend">${keys.map((g) => `<span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="${colors[g]}"/></svg>${esc(g)}${name(g) ? ` ${esc(name(g))}` : ''}</span>`).join('')}
    <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="#777"/></svg>Female</span><span><svg width="12" height="12"><path d="M6 1 L11 11 L1 11 Z" fill="#777"/></svg>Male</span>
    <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="#8A879C"/></svg>Group mean, 95% CI</span>
    ${range ? '<span><svg width="14" height="12"><rect width="14" height="12" fill="#E3F2EA"/></svg>Reference range</span>' : ''}
    ${flags ? '<span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="#fff" stroke="#B23B2E" stroke-width="1.6"/></svg>Outside the range</span>' : ''}</div>`;
}
