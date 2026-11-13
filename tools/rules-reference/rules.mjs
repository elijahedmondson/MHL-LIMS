// MHL LIMS business rules: JavaScript reference implementation.
//
// Mirrors src/MhlLims.Domain (C#) rule for rule, so the rules can be executed and tested
// anywhere Node.js runs, and so the browser pilot prices things exactly like the real
// application will. Money is computed in integer cents (half away from zero), matching
// C# Math.Round(..., MidpointRounding.AwayFromZero) and SQL Server ROUND().
//
// Keep this file free of DOM and Node APIs; the standalone pilot inlines it unchanged.

export class DomainError extends Error {}

// ---------- money ----------
const toHundredths = (x) => Math.round(Number(x) * 100);
export function amount(units, unitPrice) {
  const product = toHundredths(units) * toHundredths(unitPrice); // scaled by 10^4
  const sign = product < 0 ? -1 : 1;
  const cents = Math.floor((Math.abs(product) + 50) / 100);
  return (sign * cents) / 100;
}
export const sumMoney = (values) => values.reduce((a, v) => Math.round((a + v) * 100) / 100, 0);
const hasAtMostTwoDecimals = (x) => Math.abs(Math.round(x * 100) - x * 100) < 1e-9;

// ---------- price catalog ----------
export function loadCatalog(json, { status = 'APPROVED', id = 27, effectiveFrom } = {}) {
  const codes = new Map(json.items.map((i) => [i.code, { ...i, isActive: true }]));
  const list = {
    id, name: json.name, status,
    effectiveFrom: effectiveFrom ?? json.effectiveFrom, effectiveTo: null,
    items: new Map(json.items.map((i) => [i.code, i.price])),
  };
  return { codes, lists: [list] };
}

const isEffective = (list, date) => date >= list.effectiveFrom && (list.effectiveTo == null || date < list.effectiveTo);

export function quote(catalog, code, date) {
  const c = catalog.codes.get(code);
  if (!c) throw new DomainError(`Unknown charge code ${code}.`);
  if (!c.isActive) throw new DomainError(`Charge code ${code} is inactive.`);
  const list = catalog.lists.find((l) => l.status === 'APPROVED' && isEffective(l, date));
  if (!list) throw new DomainError(`No approved price list is in effect on ${date}.`);
  if (!list.items.has(code)) throw new DomainError(`Charge code ${code} is not on price list ${list.name}.`);
  const price = list.items.get(code);
  if (price == null) throw new DomainError(`Charge code ${code} (${c.description}) has no price on price list ${list.name}.`);
  return { priceListId: list.id, priceListName: list.name, code: c, unitPrice: price };
}

export const unpricedCodes = (json) => json.items.filter((i) => i.price == null).map((i) => i.code).sort();

// ---------- charges ----------
export function validateUnits(units) {
  if (!(units > 0)) throw new DomainError('Units must be greater than zero.');
  if (!hasAtMostTwoDecimals(units)) throw new DomainError('Units can have at most two decimal places.');
}

export function createCharge(catalog, { requestId = 1, chargeType = 'C', projectActive = true, projectAllowsCharges = true },
                             { section, code, date, units, description = null, subjectId = null }) {
  if (chargeType === 'N') throw new DomainError('This request is marked no charge; charges cannot be added.');
  if (chargeType === 'L') throw new DomainError('This request is cancelled; charges cannot be added.');
  if (!projectActive || !projectAllowsCharges) throw new DomainError("The request's project is inactive or closed to charges.");
  validateUnits(units);
  const q = quote(catalog, code, date);
  if (q.code.sections.length && !q.code.sections.includes(section.toUpperCase()))
    throw new DomainError(`Charge code ${code} is not part of the ${section} section of the price list.`);
  if (q.code.requiresDescription && !(description && description.trim()))
    throw new DomainError(`Charge code ${code} (${q.code.description}) needs a description of the work.`);
  return {
    requestId, subjectId, section: section.toUpperCase(), code, priceListId: q.priceListId, date, units,
    unitPrice: q.unitPrice, amount: amount(units, q.unitPrice), description, status: 'PENDING', sourceType: 'MANUAL',
  };
}

// ---------- estimates ----------
export function estimateLine(catalog, { section, code, units, date }) {
  validateUnits(units);
  const q = quote(catalog, code, date);
  if (q.code.sections.length && !q.code.sections.includes(section.toUpperCase()))
    throw new DomainError(`Charge code ${code} is not part of the ${section} section of the price list.`);
  return { section: section.toUpperCase(), code, units, unitPrice: q.unitPrice, amount: amount(units, q.unitPrice), description: q.code.description };
}

export function summarizeEstimate(lines, authorized, charges = []) {
  const bySection = new Map();
  for (const l of lines) bySection.set(l.section, sumMoney([bySection.get(l.section) ?? 0, amount(l.units, l.unitPrice)]));
  const sections = [...bySection].map(([section, amt]) => ({ section, amount: amt }));
  const total = sumMoney(sections.map((s) => s.amount));
  const charged = sumMoney(charges.filter((c) => c.status !== 'VOID').map((c) => amount(c.units, c.unitPrice)));
  const remaining = authorized == null ? null : Math.round((authorized - charged) * 100) / 100;
  return {
    sections, total, authorized, charged, remaining,
    estimateExceeds: authorized != null && total > authorized,
    chargesExceed: authorized != null && charged > authorized,
  };
}

// ---------- billing batches ----------
export const isEligible = (batch, line) =>
  line.status === 'APPROVED' && line.date >= batch.periodStart && line.date <= batch.periodEnd && line.code.startsWith(batch.lab);

export function releaseBatch(batch, lines) {
  if (batch.status !== 'OPEN') throw new DomainError('This billing batch has already been released.');
  if (!lines.length) throw new DomainError('There are no approved charge lines in this lab and period to release.');
  const bad = lines.find((l) => !isEligible(batch, l));
  if (bad) throw new DomainError(`Charge line ${bad.id} does not belong in this batch.`);
  for (const l of lines) { l.status = 'RELEASED'; l.batchId = batch.id; }
  return { ...batch, status: 'RELEASED', lineCount: lines.length, total: sumMoney(lines.map((l) => amount(l.units, l.unitPrice))) };
}

// ---------- automatic rules ----------
export function laborUnits(images, { laborUnitsPerBlock = 4, imagesPerBlock = 6, rounding = 'ProportionalRoundUp' } = {}) {
  if (images < 0) throw new DomainError('The image count cannot be negative.');
  if (images === 0) return 0;
  const exact = (images * laborUnitsPerBlock) / imagesPerBlock;
  if (rounding === 'ProportionalRoundUp') return Math.ceil(exact - 1e-12);
  if (rounding === 'WholeBlocksRoundUp') return Math.ceil(images / imagesPerBlock - 1e-12) * laborUnitsPerBlock;
  if (rounding === 'ProportionalExact') return Math.round(exact * 100) / 100;
  throw new DomainError(`Unknown rounding ${rounding}`);
}
export const countImages = (groups) => groups.reduce((n, g) => n + g.slides * Math.max(1, g.targets ?? 1), 0);

export function statSurcharges({ enabled, code, section, unitsPerSubject = 1 }, subjects, lines, date) {
  if (!enabled) return [];
  if (!code) throw new DomainError('The STAT surcharge rule is enabled but has no charge code.');
  const live = lines.filter((l) => l.status !== 'VOID');
  return subjects
    .filter((s) => s.priority === 'S')
    .filter((s) => live.some((l) => l.subjectId === s.id && l.ruleCode !== 'STAT_SURCHARGE'))
    .filter((s) => !live.some((l) => l.subjectId === s.id && l.ruleCode === 'STAT_SURCHARGE'))
    .map((s) => ({ section, code, date, units: unitsPerSubject, description: `STAT surcharge for ${s.phl}`, subjectId: s.id }));
}

// ---------- Rpt080 extract ----------
export const transId = (lab, req) => lab.slice(0, 1).toUpperCase() + (req.length <= 5 ? req : req.slice(-5));
export const centerNo = (p) => (!p || p.length <= 2 ? '' : p.slice(2, 12));
const clean = (s) => s.replace(/,/g, ' ').replace(/[\r\n]/g, ' ').trim();
const yymmdd = (iso) => iso.slice(2, 4) + iso.slice(5, 7) + iso.slice(8, 10);

export function rpt080Records(lines, transDate) {
  const groups = new Map();
  for (const l of lines) {
    const key = `${l.requestNumber}\u0000${l.code}`;
    const g = groups.get(key);
    if (g) g.units = Math.round((g.units + l.units) * 100) / 100; else groups.set(key, { ...l });
  }
  return [...groups.values()]
    .filter((g) => g.units !== 0)
    .sort((a, b) => (a.requestNumber < b.requestNumber ? -1 : a.requestNumber > b.requestNumber ? 1 : a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .map((g) => ({
      transId: transId(g.lab, g.requestNumber), transDate: yymmdd(transDate), centerNo: centerNo(g.project),
      requestor: clean(g.investigator), units: g.units, code: g.code, csasNo: g.nas ? `CS-${g.nas.trim()}` : '',
    }));
}
export const rpt080Write = (records) =>
  records.map((r) => [r.transId, r.transDate, r.centerNo, r.requestor, String(r.units), r.code, r.csasNo].join(',') + '\r\n').join('');

// ---------- identifiers ----------
export function parsePhl(text) {
  const t = String(text ?? '').trim().toUpperCase();
  return /^(\d{8}|\d{6})[A-Z]$/.test(t) ? t : null;
}
export function formatPhlNumbers(firstValue, count, format, receivedIso, suffix = 'A') {
  const yy = receivedIso.slice(2, 4);
  return Array.from({ length: count }, (_, i) => {
    const n = firstValue + i;
    if (format === 'Sequential') {
      if (n > 99_999_999) throw new DomainError('The PHL number counter has exceeded eight digits.');
      return String(n).padStart(8, '0') + suffix;
    }
    if (n > 999_999) throw new DomainError('More than 999,999 PHL numbers were requested in one year.');
    return yy + String(n).padStart(6, '0') + suffix;
  });
}
export const formatRequestNumber = (lab, receivedIso, n) => lab.toUpperCase() + receivedIso.slice(2, 4) + String(n).padStart(4, '0');
export const blockBarcode = (phl, b) => `${phl}-B${b}`;
export const slideBarcode = (phl, b, s) => `${phl}-B${b}-S${String(s).padStart(2, '0')}`;
export const zplSmall = (barcode, l1, l2, l3) => {
  const c = (s) => String(s).replace(/[\^~]/g, ' ');
  return `^XA^CI28^FO15,15^BXN,4,200^FD${c(barcode)}^FS^FO110,12^A0N,24,24^FD${c(l1)}^FS^FO110,42^A0N,20,20^FD${c(l2)}^FS^FO110,68^A0N,20,20^FD${c(l3)}^FS^XZ`;
};
