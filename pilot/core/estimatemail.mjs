// Emailing a cost estimate. The pilot never sends mail itself: it builds the email and hands it to the user's email
// program, where they check it and click Send (so a copy stays in their Sent Items). Three ways:
//   an .eml file marked unsent (X-Unsent: 1), which classic Outlook opens as a new message, addressed and ready, with
//   the formatted estimate in the body and the lines attached as a spreadsheet;
//   the formatted email copied to the clipboard, to paste into any new message (Outlook on the web, new Outlook);
//   a mailto: link, which opens the default email program with a plain-text version (no formatting, no attachment).
// Pure functions: the core builds what it records, and the browser builds the preview with the same code. The HTML is
// made of tables and inline styles only, because Outlook draws email with Word's layout engine.

import { estimateLabel, validUntilFor, termsOf, fmtDay, fmtMoney } from './estimates.mjs';

export const LAB = 'Molecular Histopathology Laboratory (MHL)';
export const LAB2 = 'Laboratory Animal Sciences Program, NCI at Frederick';
export const MAX_RECIPIENTS = 10;
export const MAX_MESSAGE = 5000;
export const MAX_SIGNOFF = 500;
// Longer mailto: links are cut short or refused by some email programs (classic Outlook among them).
export const MAILTO_MAX = 2000;
export const METHODS = { outlook: 'opened in Outlook', copy: 'copied to paste into an email', mailto: 'opened in the email program' };

const ATOM = "[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+";
const LABEL = '[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?';
const ADDRESS = new RegExp(`^${ATOM}(?:\\.${ATOM})*@${LABEL}(?:\\.${LABEL})+$`);
export const isAddress = (a) => typeof a === 'string' && a.length <= 254 && ADDRESS.test(a);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// Half of a surrogate pair (from text cut in the wrong place) would break URL encoding; replace it.
export const wellFormed = (s) => String(s ?? '').replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '\uFFFD');
const oneLine = (s) => wellFormed(s).replace(/[\r\n\t]+/g, ' ').trim();
// Cut to n characters without splitting an emoji or other character outside the basic plane.
export const cut = (s, n) => Array.from(String(s ?? '')).slice(0, n).join('');

// ---------- addresses ----------
// What is typed or pasted in To or Cc. Entries are separated by semicolons or new lines, as Outlook separates them.
// An entry with <address> in it is a name and an address, as Outlook copies them ("Doe, Jane (NIH/NCI) [E]
// <jane.doe@nih.gov>"), so the commas in the name do not matter; otherwise commas and spaces also separate addresses.
// Duplicates are dropped.
export function parseAddresses(input) {
  const raw = Array.isArray(input) ? input.join(';') : String(input ?? '');
  const addresses = []; const bad = [];
  for (const entry of raw.split(/[;\n]+/).map((x) => x.trim()).filter(Boolean)) {
    const named = [...entry.matchAll(/<([^<>]*)>/g)].map((m) => m[1].trim());
    // Beside named addresses, any other word with an @ in it is an address too; the rest is the name.
    const rest = entry.replace(/<[^<>]*>/g, ' ').replace(/"[^"]*"/g, ' ').split(/[\s,]+/).filter(Boolean);
    for (const a of named.length ? [...named, ...rest.filter((w) => w.includes('@'))] : rest) {
      if (!a) continue;
      if (!isAddress(a)) { bad.push(a); continue; }
      if (!addresses.some((x) => x.toLowerCase() === a.toLowerCase())) addresses.push(a);
    }
  }
  return { addresses, bad };
}

// ---------- what the email says ----------
// kind: 'send' (the estimate, to the investigator), 'review' (a draft, to a colleague before it goes out),
// 'copy' (an accepted estimate, for the investigator's records).
export function emailKinds(e) {
  if (e.status === 'DRAFT') return ['send', 'review'];
  if (e.status === 'SENT') return ['send'];
  if (e.status === 'ACCEPTED') return ['copy'];
  return [];
}

export function defaultSubject(e, kind) {
  const label = estimateLabel(e);
  const s = kind === 'review' ? `Draft for review: MHL cost estimate ${label}: ${e.title}`
    : kind === 'copy' ? `MHL cost estimate ${label} (accepted): ${e.title}` : `MHL cost estimate ${label}: ${e.title}`;
  return cut(oneLine(s), 200);
}

const investigatorName = (e) => (e.investigator.first ? `${e.investigator.first} ${e.investigator.last}` : `Dr. ${e.investigator.last}`);

export function defaultMessage(e, p, { kind, today }) {
  const label = estimateLabel(e);
  const until = validUntilFor(e, today);
  const total = `${fmtMoney(p.total)}${p.optionalTotal ? `, plus ${fmtMoney(p.optionalTotal)} for optional work` : ''}`;
  if (kind === 'review') {
    return `Hello,\n\nHere is a draft of cost estimate ${label} for ${investigatorName(e).replace(/^Dr\. /, '')}: "${e.title}". It comes to ${total}.\n\nIt has not been sent to the investigator yet. Please let me know of any changes before it goes out.`;
  }
  if (kind === 'copy') {
    return `Dear ${investigatorName(e)},\n\nFor your records, here is a copy of MHL cost estimate ${label} for "${e.title}", which you accepted${e.decidedOn ? ` on ${fmtDay(e.decidedOn)}` : ''}. It comes to ${total}.\n\nIf you have not done so already, please submit a NAS request quoting estimate ${label} so that we can schedule the work.`;
  }
  return `Dear ${investigatorName(e)},\n\nThank you for considering the Molecular Histopathology Laboratory (MHL) for your project. Our cost estimate ${label} for "${e.title}" comes to ${total}. The details are below, and the estimate is valid until ${fmtDay(until)}.\n\nTo go ahead, please submit a NAS request for ${fmtMoney(p.total)} quoting estimate ${label}. If the work should change, reply to this email and we will revise the estimate.`;
}

export const defaultSignOff = (initials) => ['Best regards,', initials || '', LAB, LAB2].filter(Boolean).join('\n');

// ---------- the estimate, laid out for the email ----------
const lineText = (l) => `${l.code || 'Not on the price list'}  ${l.description}${l.note ? ` (${l.note})` : ''}: ${l.units} x ${l.unitPrice == null ? 'no price yet'
  : l.custom && l.unitPrice === 0 ? 'price to be confirmed' : `${fmtMoney(l.unitPrice)} = ${fmtMoney(l.amount)}`}`;

function parts(e, p) {
  const many = p.phases.length > 1;
  const phases = p.phases.map((ph) => ({ ...ph, counted: ph.lines.filter((l) => !l.optional) }));
  const optional = p.phases.flatMap((ph) => ph.lines.filter((l) => l.optional).map((l) => ({ ...l, note: [many ? ph.name : '', l.note].filter(Boolean).join(' · ') })));
  return { many, phases, optional };
}

// Everything the email needs. opts: kind, subject, message, signOff, today, preparedBy, speciesName, listName,
// listStatus, pilot (the banner shown on everything the pilot prints).
export function estimateEmail(e, p, opts) {
  const { kind = 'send', subject = defaultSubject(e, kind), message = '', signOff = '', today, preparedBy = '', speciesName = '', listName = '', listStatus = '', pilot = true } = opts;
  const label = estimateLabel(e);
  const until = validUntilFor(e, today);
  const dated = e.sentOn || today;
  const terms = termsOf(e, p, { until, listName, listStatus });
  const { many, phases, optional } = parts(e, p);
  const who = [[e.investigator.first, e.investigator.last].filter(Boolean).join(' '), e.investigator.inst].filter(Boolean).join(', ');
  const draftNote = kind === 'review' ? 'Draft for review, not sent to the investigator' : '';

  // Plain text: the text/plain part of the .eml, and the mailto: body when it fits.
  const head = [message.trim(), signOff.trim()].filter(Boolean).join('\n\n');
  const block = [
    `COST ESTIMATE ${label}${draftNote ? ` (${draftNote.toUpperCase()})` : ''}`,
    pilot ? 'MHL LIMS PILOT WITH TEST DATA: NOT A VALID ESTIMATE' : '',
    `${LAB}, ${LAB2}`,
    `Date: ${fmtDay(dated)}    Valid until: ${fmtDay(until)}`,
    `Prepared for: ${who}`,
    `Project: ${e.title}`,
    e.description ? `\nScope of work:\n${e.description}` : '',
    '\nESTIMATED CHARGES',
    ...phases.flatMap((ph) => [...(many ? [ph.name] : []), ...ph.counted.map((l) => `  ${lineText(l)}`), ...(many ? [`  Subtotal: ${fmtMoney(ph.subtotal)}`] : [])]),
    `TOTAL ESTIMATE: ${fmtMoney(p.total)}`,
    ...(optional.length ? ['\nOptional, not included in the total', ...optional.map((l) => `  ${lineText(l)}`), `  Optional lines: ${fmtMoney(p.optionalTotal)}`] : []),
    p.toConfirm ? '\nLines marked "price to be confirmed" are not priced yet and are not in the total.' : '',
    '\nASSUMPTIONS AND TERMS',
    ...terms.map((t) => `- ${t}`),
  ].filter((x) => x !== '').join('\n');
  const summary = [
    `Estimate ${label}, valid until ${fmtDay(until)}${pilot ? ' (MHL LIMS pilot with test data: not a valid estimate)' : ''}`,
    ...(many ? p.phases.map((ph) => `  ${ph.name}: ${fmtMoney(ph.subtotal)}`) : []),
    `  Total: ${fmtMoney(p.total)}`,
    p.optionalTotal ? `  Optional work, not in the total: ${fmtMoney(p.optionalTotal)}` : '',
    'The itemized estimate is in the attached PDF.',
  ].filter(Boolean).join('\n');
  const text = [head, block].filter(Boolean).join('\n\n');

  // HTML.
  const F = 'font-family:Calibri,Arial,Helvetica,sans-serif;';
  const td = `${F}font-size:10pt;padding:4px 8px;border-bottom:1px solid #dddddd;vertical-align:top;color:#1f1f1f;`;
  const num = `${td}text-align:right;white-space:nowrap;`;
  const th = `${F}font-size:9.5pt;padding:4px 8px;border-bottom:2px solid #2B2350;text-align:left;color:#5E5A73;font-weight:bold;`;
  const sec = `${F}font-size:10.5pt;padding:6px 8px;background:#F2F1F7;color:#2B2350;font-weight:bold;`;
  const tot = `${F}font-size:10.5pt;padding:6px 8px;border-top:2px solid #2B2350;font-weight:bold;color:#1f1f1f;`;
  const h2 = `${F}font-size:12pt;color:#2B2350;font-weight:bold;margin:18px 0 6px 0;padding-bottom:3px;border-bottom:1px solid #dddddd;`;
  const paras = (s) => s.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean).map((x) => `<p style="${F}font-size:11pt;margin:0 0 10px 0;color:#1f1f1f;">${esc(x).replace(/\n/g, '<br>')}</p>`).join('');
  const price = (l) => (l.unitPrice == null ? 'no price yet' : l.custom && l.unitPrice === 0 ? 'to be confirmed' : fmtMoney(l.unitPrice));
  const row = (l) => `<tr><td style="${td}white-space:nowrap;font-weight:bold;">${l.code ? esc(l.code) : 'Not on list'}${l.custom ? ' †' : l.priceByHand ? ' ‡' : ''}</td>
    <td style="${td}">${esc(l.description)}${l.note ? `<br><span style="font-size:9pt;color:#5E5A73;">${esc(l.note)}</span>` : ''}</td>
    <td style="${num}">${esc(l.units)}${l.custom && l.unit ? ` ${esc(l.unit)}` : ''}</td><td style="${num}">${price(l)}</td><td style="${num}">${l.custom && l.unitPrice === 0 ? '' : fmtMoney(l.amount)}</td></tr>`;
  const fact = (k, v) => `<td style="${F}font-size:9.5pt;color:#5E5A73;font-weight:bold;padding:3px 10px 3px 0;vertical-align:top;white-space:nowrap;">${k}</td><td style="${F}font-size:10pt;padding:3px 18px 3px 0;vertical-align:top;color:#1f1f1f;">${v}</td>`;
  const html = `<!DOCTYPE html>
<html><head><meta http-equiv="Content-Type" content="text/html; charset=utf-8"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:12px;background:#ffffff;">
<!--mhl-email-start-->
${paras(message)}${signOff.trim() ? `<p style="${F}font-size:11pt;margin:0 0 18px 0;color:#1f1f1f;">${esc(signOff.trim()).replace(/\n/g, '<br>')}</p>` : ''}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;border-collapse:collapse;border-top:3px solid #2B2350;margin-top:8px;">
<tr><td style="${F}padding:10px 0 4px 0;vertical-align:top;"><span style="font-size:13pt;font-weight:bold;color:#2B2350;">${LAB}</span><br><span style="font-size:9pt;color:#5E5A73;">${LAB2}</span></td>
<td align="right" style="${F}padding:10px 0 4px 0;vertical-align:top;text-align:right;"><span style="font-size:17pt;font-weight:bold;color:#2B2350;">Cost estimate</span>${draftNote ? `<br><span style="font-size:10pt;font-weight:bold;color:#B23B2E;">${draftNote}</span>` : ''}</td></tr>
</table>
${pilot ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;border-collapse:collapse;margin:6px 0 10px 0;"><tr><td style="${F}font-size:9.5pt;font-weight:bold;text-align:center;padding:4px 8px;background:#FFF3DD;color:#6A4100;">MHL LIMS pilot with test data: not a valid estimate</td></tr></table>` : ''}
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:4px 0 6px 0;">
<tr>${fact('Estimate', `<b>${esc(label)}</b>`)}${fact('Date', `<span style="white-space:nowrap;">${fmtDay(dated)}</span>`)}${fact('Valid until', `<span style="white-space:nowrap;">${fmtDay(until)}</span>`)}</tr>
<tr>${fact('Prepared for', esc(who))}${fact('Prepared by', `${esc(preparedBy)}${preparedBy ? ', ' : ''}MHL`)}${fact('Species', esc(speciesName || 'Not stated'))}</tr>
<tr>${fact('Project', `<b>${esc(e.title)}</b>`)}<td></td><td></td><td></td><td></td></tr>
</table>
${e.description ? `<p style="${h2}">Scope of work</p>${paras(e.description)}` : ''}
<p style="${h2}">Estimated charges</p>
<table width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:720px;border-collapse:collapse;">
<tr><th style="${th}">Code</th><th style="${th}">Description</th><th style="${th}text-align:right;">Units</th><th style="${th}text-align:right;">Unit price</th><th style="${th}text-align:right;">Amount</th></tr>
${phases.map((ph) => `${many ? `<tr><td colspan="5" style="${sec}">${esc(ph.name)}</td></tr>` : ''}${ph.counted.map(row).join('')}${many ? `<tr><td colspan="4" style="${td}font-weight:bold;color:#5E5A73;">${esc(ph.name)} subtotal</td><td style="${num}font-weight:bold;color:#5E5A73;">${fmtMoney(ph.subtotal)}</td></tr>` : ''}`).join('')}
<tr><td colspan="4" style="${tot}">Total estimate</td><td style="${tot}text-align:right;white-space:nowrap;">${fmtMoney(p.total)}</td></tr>
${optional.length ? `<tr><td colspan="5" style="padding:8px 0 0 0;"></td></tr><tr><td colspan="5" style="${sec}">Optional, not included in the total</td></tr>${optional.map(row).join('')}<tr><td colspan="4" style="${td}font-weight:bold;color:#5E5A73;">Optional lines</td><td style="${num}font-weight:bold;color:#5E5A73;">${fmtMoney(p.optionalTotal)}</td></tr>` : ''}
</table>
${p.custom || p.byHand || p.toConfirm ? `<p style="${F}font-size:9pt;color:#5E5A73;margin:6px 0 0 0;">${p.custom ? '† Not on the price list; priced by MHL for this estimate. ' : ''}${p.byHand ? '‡ On the price list without a price; priced by MHL for this estimate. ' : ''}${p.toConfirm ? 'Lines marked “to be confirmed” are not priced yet and are not in the total.' : ''}</p>` : ''}
<p style="${h2}">Assumptions and terms</p>
<ul style="${F}font-size:10pt;margin:0 0 0 18px;padding:0;color:#1f1f1f;">${terms.map((t) => `<li style="margin:0 0 4px 0;">${esc(t)}</li>`).join('')}</ul>
<p style="${F}font-size:8.5pt;color:#888888;margin:16px 0 0 0;">${esc(label)} · ${LAB}</p>
<!--mhl-email-end-->
</body></html>`;
  return { label, subject, until, dated, head, block, summary, text, html };
}

// The body of the email (between the markers), for pasting: the clipboard wants a fragment, not a whole page.
export const htmlBody = (html) => { const m = html.match(/<!--mhl-email-start-->([\s\S]*)<!--mhl-email-end-->/); return m ? m[1] : html; };

// ---------- mailto: ----------
const addr = (a) => a.replace(/[^A-Za-z0-9.@_-]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`);
export function mailtoUrl({ to, cc = [], subject, body }) {
  const q = [cc.length ? `cc=${cc.map(addr).join(',')}` : '', `subject=${encodeURIComponent(oneLine(subject))}`, `body=${encodeURIComponent(wellFormed(body).replace(/\r\n|\r|\n/g, '\r\n'))}`].filter(Boolean);
  return `mailto:${to.map(addr).join(',')}?${q.join('&')}`;
}
// The whole estimate if it fits in a link; otherwise the message with a summary (attach the PDF yourself).
export function mailtoFor({ to, cc = [], subject, mail }) {
  const full = mailtoUrl({ to, cc, subject, body: [mail.head, mail.block].filter(Boolean).join('\n\n') });
  if (full.length <= MAILTO_MAX) return { url: full, short: false, tooLong: false };
  const url = mailtoUrl({ to, cc, subject, body: [mail.head, mail.summary].filter(Boolean).join('\n\n') });
  return { url, short: true, tooLong: url.length > MAILTO_MAX };
}

// ---------- .eml ----------
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
export function base64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const b = bytes[i + 1]; const c = bytes[i + 2];
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] + (b === undefined ? '=' : B64[(n >> 6) & 63]) + (c === undefined ? '=' : B64[n & 63]);
  }
  return out;
}
const utf8 = (s) => new TextEncoder().encode(String(s));
const b64lines = (s) => (base64(utf8(s)).match(/.{1,76}/g) || ['']).join('\r\n');
const crlf = (s) => wellFormed(s).replace(/\r\n|\r|\n/g, '\r\n');

// A header value: plain if it is printable ASCII, otherwise RFC 2047 encoded words of whole characters, each line at
// most 76 characters (the first shares its line with the header name: `used` characters).
export function encodeHeader(value, used = 9) {
  const v = oneLine(value);
  if (!/[^\x20-\x7e]/.test(v)) return v;
  const words = []; let chunk = '';
  let room = Math.floor((76 - used - 12) / 4) * 3;   // bytes that fit after "=?UTF-8?B?" and "?=", as base64
  for (const ch of v) {
    if (chunk && utf8(chunk + ch).length > room) { words.push(chunk); chunk = ''; room = 45; }
    chunk += ch;
  }
  if (chunk) words.push(chunk);
  return words.map((w) => `=?UTF-8?B?${base64(utf8(w))}?=`).join('\r\n ');
}
// To and Cc, folded after a comma before a line reaches 76 characters.
function addressHeader(name, list) {
  const lines = [`${name}: `];
  list.forEach((a, i) => {
    const piece = `${a}${i < list.length - 1 ? ',' : ''}`;
    if (lines.at(-1).trim().length > name.length + 1 && lines.at(-1).length + piece.length > 76) lines.push(' ');
    lines[lines.length - 1] += `${lines.at(-1).endsWith(' ') ? '' : ' '}${piece}`;
  });
  return lines.join('\r\n');
}
const safeName = (s) => String(s).replace(/[^A-Za-z0-9._ -]/g, '_').replace(/\s+/g, '-');

// A message for the user's email program to open as a new, unsent message. No From or Date: Outlook fills them in
// from the account that sends it.
export function buildEml({ to, cc = [], subject, text, html, attachments = [] }) {
  const alt = '----=_MHL_alt_7f3a';
  const mix = '----=_MHL_mix_7f3a';
  const altPart = [
    `Content-Type: multipart/alternative; boundary="${alt}"`, '',
    `--${alt}`, 'Content-Type: text/plain; charset="utf-8"', 'Content-Transfer-Encoding: base64', '', b64lines(crlf(text)),
    `--${alt}`, 'Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: base64', '', b64lines(crlf(html)),
    `--${alt}--`, '',
  ];
  const head = [addressHeader('To', to), ...(cc.length ? [addressHeader('Cc', cc)] : []), `Subject: ${encodeHeader(subject)}`, 'X-Unsent: 1', 'MIME-Version: 1.0'];
  if (!attachments.length) return [...head, ...altPart].join('\r\n');
  return [...head, `Content-Type: multipart/mixed; boundary="${mix}"`, '', 'This is a multi-part message in MIME format.', '',
    `--${mix}`, ...altPart,
    ...attachments.flatMap((a) => [`--${mix}`, `Content-Type: ${a.type}; charset="utf-8"; name="${safeName(a.name)}"`, `Content-Disposition: attachment; filename="${safeName(a.name)}"`,
      'Content-Transfer-Encoding: base64', '', b64lines(crlf(a.content))]),
    `--${mix}--`, ''].join('\r\n');
}

export const emlName = (e) => `${safeName(estimateLabel(e))}.eml`;
export const csvName = (e) => `${safeName(estimateLabel(e))}.csv`;
