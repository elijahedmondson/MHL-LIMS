// Cost estimates for possible new projects: priced from the price list before there is a NAS request or a LIMS request.
// Pure functions, shared by the core (which saves, sends and links estimates) and the browser (which prices as you type).
// The money arithmetic is passed in (amount and sumMoney from rules.mjs), so an estimate rounds exactly as charges do.

export const VALID_DAYS = 90;
export const MAX_PHASES = 12;
export const MAX_LINES = 300;
export const MAX_UNITS = 100000;
export const MAX_PRICE = 1000000;
export const STATUS_LABEL = {
  DRAFT: 'Draft', SENT: 'Sent', ACCEPTED: 'Accepted', DECLINED: 'Declined', EXPIRED: 'Expired', SUPERSEDED: 'Revised', DISCARDED: 'Discarded',
};
// Units that scale with the number of blocks or slides per animal, rather than with the number of animals.
const PER_BLOCK_UNITS = ['block', 'slide'];

export const estimateLabel = (e) => (e.rev > 1 ? `${e.number} rev ${e.rev}` : e.number);
// The IHC pricing rules word their assumptions for a request; on an estimate they read better this way.
export const forEstimate = (text) => String(text).replace('cut from blocks this request already makes', 'cut from blocks this estimate already includes');

// A sent estimate past its valid-until date is expired; it can still be declined or revised, but not accepted.
export const displayStatus = (e, today) => (e.status === 'SENT' && e.validUntil && e.validUntil < today ? 'EXPIRED' : e.status);

const round2 = (x) => Math.round(x * 100) / 100;
const hasPrice = (v) => v !== '' && v != null && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= MAX_PRICE;

// One line, in one of three forms:
//   a price list code at its list price;
//   a code the list has no price for, at a price typed by hand;
//   a line not on the price list at all (no code), with its own description, unit and price (0 means "to be confirmed").
// frozen: the estimate has been sent, so it keeps the prices and wording it was sent with.
export function priceLine(line, items, money, { frozen = false } = {}) {
  const units = Number(line.units);
  const out = {
    section: line.section || '', code: line.code || '', description: line.description || '', unit: line.unit || '', units,
    unitPrice: null, amount: null, optional: !!line.optional, note: line.note || '', custom: !line.code, priceByHand: !!line.priceByHand,
    needsNote: false, problem: '',
  };
  if (!(units > 0) || !(units <= MAX_UNITS) || Math.abs(Math.round(units * 100) - units * 100) > 1e-6) out.problem = `Units must be more than zero and at most ${MAX_UNITS.toLocaleString('en-US')}, with at most two decimal places.`;
  const item = out.code ? items.find((i) => i.code === out.code) : null;
  if (frozen) {
    out.unitPrice = hasPrice(line.unitPrice) ? round2(Number(line.unitPrice)) : null;
    if (out.unitPrice == null) out.problem ||= 'No price was recorded for this line.';
  } else if (out.code) {
    if (!item) { out.problem ||= `${out.code} is not on the price list.`; return out; }
    out.description = item.description; out.unit = item.unit;
    if (!item.sections.includes(out.section)) out.section = item.sections[0] || out.section;
    if (item.price == null) {
      out.priceByHand = true;
      if (hasPrice(line.unitPrice)) out.unitPrice = round2(Number(line.unitPrice));
      else out.problem ||= `${out.code} has no price on the list; type the price to use.`;
    } else { out.unitPrice = item.price; out.priceByHand = false; }
  } else {
    out.priceByHand = false;
    if (!out.description.trim()) out.problem ||= 'A line that is not on the price list needs a description.';
    if (hasPrice(line.unitPrice)) out.unitPrice = round2(Number(line.unitPrice));
    else out.problem ||= `A line that is not on the price list needs a unit price from 0 (to be confirmed) to $${MAX_PRICE.toLocaleString('en-US')}.`;
  }
  // Codes such as labor or reagents "(DEFINE)" need a note saying what the work is before the estimate goes out.
  if (item?.requiresDescription && !out.note.trim()) out.needsNote = true;
  if (!out.problem && out.unitPrice != null) out.amount = money.amount(units, out.unitPrice);
  return out;
}

// Every phase priced, with subtotals; optional lines are shown but not counted in the total.
export function priceEstimate(est, items, money, { frozen = false } = {}) {
  const sum = (lines) => money.sumMoney(lines.filter((l) => l.amount != null).map((l) => l.amount));
  const problems = []; const notes = [];
  const phases = (est.phases || []).map((ph, pi) => {
    const lines = (ph.lines || []).map((l) => priceLine(l, items, money, { frozen }));
    const name = ph.name || `Phase ${pi + 1}`;
    lines.forEach((l, li) => {
      const what = `${name}, line ${li + 1} (${l.code || l.description || 'not on the price list'})`;
      if (l.problem) problems.push(`${what}: ${l.problem}`);
      if (l.needsNote) notes.push(`${what}: say what the ${l.code} work is, in the line's note.`);
    });
    const counted = lines.filter((l) => !l.optional);
    return { name, lines, subtotal: sum(counted), optionalTotal: sum(lines.filter((l) => l.optional)) };
  });
  const all = phases.flatMap((p) => p.lines);
  const counted = all.filter((l) => !l.optional && l.amount != null);
  const bySection = new Map();
  for (const l of counted) bySection.set(l.section, money.sumMoney([bySection.get(l.section) || 0, l.amount]));
  return {
    phases, total: money.sumMoney(phases.map((p) => p.subtotal)), optionalTotal: money.sumMoney(phases.map((p) => p.optionalTotal)),
    bySection: [...bySection].map(([section, amount]) => ({ section, amount })), lineCount: all.length,
    custom: all.some((l) => l.custom), byHand: all.some((l) => l.priceByHand), toConfirm: all.some((l) => l.custom && l.unitPrice === 0),
    problems, notes,
  };
}

// What has to be put right before an estimate can be sent to the investigator.
export function sendProblems(est, p) {
  const out = [];
  if (!est.investigator?.last?.trim()) out.push('Enter the investigator\'s last name.');
  if (!est.title?.trim()) out.push('Give the project a title.');
  if (!p.phases.some((ph) => ph.lines.some((l) => !l.optional))) out.push('Add at least one line that is not optional.');
  if (!(p.total > 0) && !p.toConfirm) out.push('The total is zero.');
  return [...out, ...p.problems, ...p.notes];
}

// Lines suggested by a request type's plan (as New request does), for n animals or samples. perBlock, if given,
// replaces the plan's blocks or slides per animal for the lines charged per block or per slide.
export function planLines(def, n, perBlock, items) {
  const count = Math.max(1, Math.min(5000, Math.round(Number(n) || 1)));
  return (def?.plan || []).map(([section, code, per]) => {
    const item = items.find((i) => i.code === code);
    const k = perBlock > 0 && item && PER_BLOCK_UNITS.includes(item.unit) ? perBlock : per;
    return { section, code, units: round2(k * count) };
  });
}
export function planPerBlock(def, items) {
  const per = (def?.plan || []).filter(([, code]) => PER_BLOCK_UNITS.includes(items.find((i) => i.code === code)?.unit)).map(([, , p]) => p);
  return per.length ? Math.max(...per) : 1;
}

// The price list lines of the chosen phases, added up by code: the scope a NAS request (and then New request) starts
// from. Optional lines, lines not on the price list and codes the list has no price for are left out, because they
// cannot be charged as they are.
export function scopeOf(est, phaseIndexes = null) {
  const pick = phaseIndexes == null ? null : new Set(phaseIndexes.map(Number));
  const units = new Map();
  (est.phases || []).forEach((ph, i) => {
    if (pick && !pick.has(i)) return;
    for (const l of ph.lines || []) {
      if (l.optional || !l.code || l.priceByHand || !(Number(l.units) > 0)) continue;
      const k = `${l.section}|${l.code}`;
      units.set(k, round2((units.get(k) || 0) + Number(l.units)));
    }
  });
  return [...units].map(([k, u]) => { const [section, code] = k.split('|'); return [section, code, u]; });
}

// Lines of the chosen phases that the scope cannot carry: not on the price list, or a code with no list price (optional
// lines are simply not wanted yet).
export function leftOutOfScope(est, phaseIndexes = null) {
  const pick = phaseIndexes == null ? null : new Set(phaseIndexes.map(Number));
  return (est.phases || []).flatMap((ph, i) => (pick && !pick.has(i) ? [] : (ph.lines || []).filter((l) => !l.optional && (!l.code || l.priceByHand))
    .map((l) => `${l.code ? `${l.code} ${l.description || ''}`.trim() : l.description || 'A line not on the price list'} (${l.units} x ${l.unitPrice ? `$${Number(l.unitPrice).toFixed(2)}` : 'price to be confirmed'}${l.code ? ', no list price' : ''})`)));
}

// The total of the chosen phases (all phases if none are named).
export function phasesTotal(p, phaseIndexes, money) {
  const pick = phaseIndexes == null ? null : new Set(phaseIndexes.map(Number));
  return money.sumMoney(p.phases.filter((_, i) => !pick || pick.has(i)).map((ph) => ph.subtotal));
}

// ---------- wording shared by the printed estimate and the email ----------
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const fmtDay = (iso) => (iso ? `${+iso.slice(8, 10)} ${MONTHS[+iso.slice(5, 7) - 1]} ${iso.slice(0, 4)}` : '');
export const fmtMoney = (v) => (v == null ? '' : `${v < 0 ? '−' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
export function addDays(iso, days) {
  const t = new Date(`${iso}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}
// The date an estimate is valid until: as sent, or (for a draft) counted from today, as it would be if sent today.
export const validUntilFor = (e, today) => e.validUntil || addDays(e.sentOn || today, e.validDays || VALID_DAYS);

// The estimate's own assumptions, then the standard terms.
export function termsOf(e, p, { until, listName = '', listStatus = '' }) {
  const label = estimateLabel(e);
  return [
    ...(e.assumptions || []),
    'This is an estimate, not an invoice. Charges are made for the work actually done, at the prices in effect when it is done.',
    `Prices are from the MHL ${e.priceListName} price list${listStatus && listStatus !== 'APPROVED' && e.priceListName === listName ? ` (${listStatus.toLowerCase()})` : ''}. Work done under a later price list is charged at its prices.`,
    `The estimate is valid until ${fmtDay(until)}.`,
    `To go ahead, submit a NAS request for ${fmtMoney(p.total)}${p.optionalTotal ? ' (plus any optional lines you want)' : ''} and quote estimate ${label}.`,
  ];
}

// A cell that starts like a formula gets a leading apostrophe, so Excel shows it rather than running it.
const csvCell = (v) => { let t = v == null ? '' : String(v); if (/^[=+@\t\r]/.test(t) || (/^-/.test(t) && !/^-\d+(\.\d+)?$/.test(t))) t = `'${t}`; return /[",\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
export const csvText = (rows) => `${rows.map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;

// Rows for a spreadsheet: one per line, with the phase and whether it counts in the total.
export function csvRows(est, p) {
  const rows = [['Estimate', 'Revision', 'Phase', 'Section', 'Code', 'Description', 'Note', 'Unit', 'Units', 'Unit price', 'Amount', 'Optional', 'On the price list']];
  p.phases.forEach((ph) => ph.lines.forEach((l) => rows.push([est.number, est.rev, ph.name, l.section, l.code, l.description, l.note, l.unit, l.units,
    l.unitPrice == null ? '' : l.unitPrice.toFixed(2), l.amount == null ? '' : l.amount.toFixed(2), l.optional ? 'yes' : '', l.custom ? 'no' : l.priceByHand ? 'code only (price typed)' : 'yes'])));
  rows.push(['', '', '', '', '', 'Total (not counting optional lines)', '', '', '', '', p.total.toFixed(2), '', '']);
  if (p.optionalTotal) rows.push(['', '', '', '', '', 'Optional lines', '', '', '', '', p.optionalTotal.toFixed(2), 'yes', '']);
  return rows;
}
