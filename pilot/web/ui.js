// Shared UI helpers for the pilot views.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const money = (v) => (v == null ? '' : (v < 0 ? '−' : '') + '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDate = (iso) => (iso ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '');
export const fmtDateTime = (iso) => (iso ? `${fmtDate(iso.slice(0, 10))}, ${iso.slice(11, 16)}` : '');
export const addDays = (iso, d) => { const t = new Date(iso + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + d); return t.toISOString().slice(0, 10); };
export const titleCase = (s) => (s ? s[0] + s.slice(1).toLowerCase() : '');

export function statusBadge(status) {
  const cls = { Open: 'open', Complete: 'complete', PENDING: 'warn', APPROVED: 'info', RELEASED: 'complete', VOID: 'muted', DRAFT: 'warn', APPROVED_N: 'complete' }[status] || '';
  return `<span class="badge ${cls}">${esc(status === status.toUpperCase() ? titleCase(status) : status)}</span>`;
}

// ---------- API ----------
// In the server build this calls the Node server; in the standalone build it calls the same core in the browser.
export async function api(method, path, body = null) {
  if (window.MHL_LOCAL) {
    const [p, q] = path.split('?');
    const res = window.MHL_LOCAL.handle(method, p, Object.fromEntries(new URLSearchParams(q || '')), body);
    if (res.status !== 200) throw Object.assign(new Error(res.json?.error || 'Something went wrong.'), { status: res.status });
    return res.file ? res.file : res.json;
  }
  const res = await fetch(path, { method, headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
  const type = res.headers.get('Content-Type') || '';
  const disposition = res.headers.get('Content-Disposition') || '';
  if (disposition.includes('attachment') || !type.includes('application/json')) {
    if (!res.ok) throw new Error(`The server answered ${res.status}.`);
    const name = disposition.match(/filename="([^"]+)"/)?.[1] || 'download';
    return { name, type, content: await res.text() };
  }
  const json = await res.json();
  if (!res.ok) throw Object.assign(new Error(json.error || `The server answered ${res.status}.`), { status: res.status });
  return json;
}

// Saves text the page made (a CSV, an email file) through the browser's downloads.
export function saveFile(name, type, content) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function download(path) {
  const file = await api('GET', path);
  saveFile(file.name, file.type, file.content);
  return file;
}

let metaPromise = null;
export const getMeta = (refresh = false) => { if (refresh || !metaPromise) metaPromise = api('GET', '/api/meta'); return metaPromise; };
export async function refreshWho() {
  const meta = await getMeta();
  const el = document.querySelector('#who');
  if (el) el.textContent = meta.settings.initials ? `You: ${meta.settings.initials}` : 'Set initials';
}
let priceListPromise = null;
export const getPriceList = () => { if (!priceListPromise) priceListPromise = api('GET', '/api/price-list'); return priceListPromise; };
export const areaName = (meta, code) => meta.areas.find((a) => a.code === code)?.name || code || '';
export const sectionName = (meta, code) => meta.sections.find((s) => s.code === code)?.name || code;
// "Animal 3" for numbered animals; IHC samples and coded human material keep their own label.
// An animal's details from the investigator's animal list: strain, genotype, birth or age, cage.
export const animalDetails = (s) => [s.strain, s.genotype, s.dob ? `born ${fmtDate(s.dob)}` : s.age ? `age ${s.age}` : '', s.cage ? `cage ${s.cage}` : ''].filter(Boolean).join(' · ');
export const subjectLabel = (s) => (s.restricted || !/^\d+$/.test(String(s.label)) ? s.label : `Animal ${s.label}`);
export function kindBadge(a) {
  const cls = a.kind === 'Opal' ? 'k-opal' : a.kind === 'IF' ? 'k-if' : a.kind === 'IHC' ? 'k-ihc' : 'k-other';
  return `<span class="badge ${cls}">${esc(a.kindLabel || a.kind)}</span>`;
}

// ---------- feedback ----------
export function toast(message, kind = 'ok') {
  let box = $('#toasts');
  if (!box) { box = Object.assign(document.createElement('div'), { id: 'toasts' }); box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
  const t = Object.assign(document.createElement('div'), { className: `toast ${kind}`, textContent: message });
  box.appendChild(t);
  setTimeout(() => t.classList.add('out'), kind === 'error' ? 6000 : 3500);
  setTimeout(() => t.remove(), kind === 'error' ? 6600 : 4100);
}

// Runs an async action from a button, shows errors as a toast, and disables the button meanwhile.
export async function act(button, fn, okMessage) {
  if (button) button.disabled = true;
  try {
    const r = await fn();
    const msg = typeof okMessage === 'function' ? okMessage(r) : okMessage;
    if (msg) toast(msg);
    return r;
  } catch (e) {
    toast(e.message, 'error');
    return undefined;
  } finally {
    if (button && button.isConnected) button.disabled = false;
  }
}

export function navigate(hash) {
  if (location.hash === hash) window.dispatchEvent(new HashChangeEvent('hashchange'));
  else location.hash = hash;
}

export function pageTop(app) {
  app.focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

export const options = (list, selected, { blank = null } = {}) =>
  (blank != null ? `<option value="">${esc(blank)}</option>` : '') +
  list.map((o) => {
    const [value, label] = Array.isArray(o) ? o : [o, o];
    return `<option value="${esc(value)}" ${String(value) === String(selected ?? '') ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');

// ---------- Code 128 (set B) for label previews ----------
const C128 = ['212222','222122','222221','121223','121322','131222','122213','122312','132212','221213','221312','231212','112232','122132','122231','113222','123122','123221','223211','221132','221231','213212','223112','312131','311222','321122','321221','312212','322112','322211','212123','212321','232121','111323','131123','131321','112313','132113','132311','211313','231113','231311','112133','112331','132131','113123','113321','133121','313121','211331','231131','213113','213311','213131','311123','311321','331121','312113','312311','332111','314111','221411','431111','111224','111422','121124','121421','141122','141221','112214','112412','122114','122411','142112','142211','241211','221114','413111','241112','134111','111242','121142','121241','114212','124112','124211','411212','421112','421211','212141','214121','412121','111143','111341','131141','114113','114311','411113','411311','113141','114131','311141','411131','211412','211214','211232','2331112'];
export function code128Svg(value, height = 38) {
  const values = [...String(value)].map((ch) => Math.min(94, Math.max(0, ch.charCodeAt(0) - 32)));
  let check = 104;
  values.forEach((v, i) => { check += v * (i + 1); });
  const seq = [104, ...values, check % 103, 106];
  let x = 10; const bars = [];
  for (const sym of seq) [...C128[sym]].forEach((w, i) => { if (i % 2 === 0) bars.push(`<rect x="${x}" y="0" width="${w}" height="${height}"/>`); x += +w; });
  return `<svg viewBox="0 0 ${x + 10} ${height}" preserveAspectRatio="none" aria-hidden="true" fill="#111">${bars.join('')}</svg>`;
}

export function zplJar(barcode, l1, l2, l3) {
  const c = (s) => String(s ?? '').replace(/[\^~]/g, ' ');
  return `^XA^CI28\n^FO20,15^BY2^BCN,60,N,N,N^FD${c(barcode)}^FS\n^FO20,85^A0N,34,34^FD${c(l1)}^FS\n^FO20,125^A0N,22,22^FD${c(l2)}^FS\n^FO20,152^A0N,22,22^FD${c(l3)}^FS\n^XZ`;
}
