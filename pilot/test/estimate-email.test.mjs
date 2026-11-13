// Tests for emailing cost estimates: the email form, what is recorded, the .eml file Outlook opens, the mailto: link.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import * as ESTX from '../core/estimates.mjs';
import * as MAIL from '../core/estimatemail.mjs';
import * as R from '../../tools/rules-reference/rules.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-10';
const seeded = seedState({ priceList, ihcCatalog, today: TODAY });

function fresh({ list = priceList } = {}) {
  const state = structuredClone(seeded);
  state.settings.initials = 'TT';
  const day = { today: TODAY };
  const core = createCore({ state, priceList: list, ihcCatalog, clock: { today: () => day.today, now: () => `${day.today}T10:00:00` } });
  const call = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`); return r.file || r.json; };
  const fails = (method, p, body = null) => { const r = core.handle(method, p, {}, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { state, core, call, fails, day };
}
const byLast = (t, last) => t.state.estimates.filter((e) => e.investigator.last === last).at(-1);
const send = (t, id, extra = {}) => {
  const f = t.call('GET', `/api/estimates/${id}/email`);
  const kind = extra.markSent === false ? 'review' : f.kinds[0];
  return t.call('POST', `/api/estimates/${id}/email`, { to: f.to, subject: f.defaults[kind].subject, message: f.defaults[kind].message, signOff: f.signOff, markSent: true, method: 'outlook', ...extra });
};

// A small MIME reader for the tests: headers, and each part's decoded body.
function readEml(eml) {
  const [head] = eml.split('\r\n\r\n');
  const headers = Object.fromEntries(head.split('\r\n').reduce((acc, line) => { if (/^\s/.test(line)) acc[acc.length - 1] += line.trim(); else acc.push(line); return acc; }, [])
    .map((l) => [l.slice(0, l.indexOf(':')).toLowerCase(), l.slice(l.indexOf(':') + 1).trim()]));
  const parts = [];
  for (const m of eml.matchAll(/Content-Type: ([^;\r\n]+)[^\r\n]*(?:\r\nContent-Disposition: attachment; filename="([^"]+)")?\r\nContent-Transfer-Encoding: base64\r\n\r\n([A-Za-z0-9+/=\r\n]+?)\r\n(?=--)/g)) {
    parts.push({ type: m[1], name: m[2] || null, body: Buffer.from(m[3].replace(/\r\n/g, ''), 'base64').toString('utf8') });
  }
  return { headers, parts, lines: eml.split('\r\n') };
}
const decodeHeader = (v) => v.replace(/=\?UTF-8\?B\?([^?]+)\?=\s*/g, (_, b) => Buffer.from(b, 'base64').toString('utf8'));

// ---------- the form ----------
test('the email form suggests the investigator, a subject and message, and says what a draft needs before it can be sent', () => {
  const t = fresh();
  const h = byLast(t, 'Halvorsen');
  const f = t.call('GET', `/api/estimates/${h.id}/email`);
  assert.deepEqual([f.problem, f.kinds, f.to], ['', ['send', 'review'], ['ingrid.halvorsen@example.org']]);
  assert.equal(f.defaults.send.subject, 'MHL cost estimate EST26-0005: Anti-PD-1 efficacy study in MC38 tumors');
  assert.match(f.defaults.send.message, /^Dear Ingrid Halvorsen,/);
  assert.match(f.defaults.send.message, /comes to \$14,885\.68, plus \$2,209\.92 for optional work.*valid until 8 Feb 2027/s);
  assert.match(f.defaults.review.subject, /^Draft for review: /);
  assert.match(f.defaults.review.message, /has not been sent to the investigator/);
  assert.match(f.signOff, /^Best regards,\nTT\nMolecular Histopathology Laboratory/);
  assert.equal(f.validUntil, '2027-02-08');
  assert.deepEqual(f.sendProblems, []);
  // Sent and accepted estimates can be emailed again; declined, expired, revised and discarded ones cannot.
  assert.deepEqual(t.call('GET', `/api/estimates/${byLast(t, 'Castellanos').id}/email`).kinds, ['send']);
  assert.deepEqual(t.call('GET', `/api/estimates/${byLast(t, 'Moreau').id}/email`).kinds, ['copy']);
  assert.match(t.call('GET', `/api/estimates/${byLast(t, 'Brennan').id}/email`).problem, /declined/);
  assert.match(t.call('GET', `/api/estimates/${byLast(t, 'Iverson').id}/email`).problem, /expired on \d{1,2} [A-Z][a-z]{2} 2026/);
  const rev1 = t.state.estimates.find((e) => e.investigator.last === 'Castellanos' && e.rev === 1);
  assert.match(t.call('GET', `/api/estimates/${rev1.id}/email`).problem, /replaced by a later revision/);
  assert.match(t.fails('POST', `/api/estimates/${rev1.id}/email`, { to: 'a@example.org', subject: 'x', method: 'outlook' }), /replaced/);
});

// ---------- emailing a draft ----------
test('emailing a draft to the investigator sends it: prices fixed, valid 90 days, the email recorded and audited', () => {
  const list = structuredClone(priceList);
  const t = fresh({ list });
  const h = byLast(t, 'Halvorsen');
  const r = send(t, h.id, { cc: 'mhl-estimates@example.org; Lab Manager <manager@example.org>', attachCsv: true });
  assert.deepEqual([r.kind, r.sent.validUntil, r.to, r.cc, r.emlName], ['send', '2027-02-08', ['ingrid.halvorsen@example.org'], ['mhl-estimates@example.org', 'manager@example.org'], 'EST26-0005.eml']);
  const e = t.state.estimates.find((x) => x.id === h.id);
  assert.deepEqual([e.status, e.sentOn, e.validUntil], ['SENT', TODAY, '2027-02-08']);
  assert.deepEqual(e.emails.map((m) => [m.kind, m.method, m.to, m.by]), [['send', 'outlook', ['ingrid.halvorsen@example.org'], 'TT']]);
  assert.deepEqual(t.state.audit.slice(-2).map((a) => a.action), ['ESTIMATE_SENT', 'ESTIMATE_EMAILED']);
  assert.match(t.state.audit.at(-1).detail, /the estimate emailed to ingrid\.halvorsen@example\.org, copy to mhl-estimates@example\.org, manager@example\.org \(opened in Outlook\)/);
  // The email shows the prices it was sent with, even if the list changes later.
  const total = t.call('GET', `/api/estimates/${h.id}`).priced.total;
  list.items.find((i) => i.code === 'HP002001').price = 999;
  const again = send(t, h.id);
  assert.equal(again.kind, 'send'); assert.equal(again.sent, null);
  assert.ok(again.html.includes(ESTX.fmtMoney(total)));
  assert.ok(!again.html.includes('$999.00'));
  assert.equal(t.state.estimates.find((x) => x.id === h.id).emails.length, 2);
});

test('a draft emailed for review stays a draft and says so; one that is not ready cannot be sent by email, and nothing changes', () => {
  const t = fresh();
  const h = byLast(t, 'Halvorsen');
  const r = send(t, h.id, { to: 'colleague@example.org', markSent: false });
  assert.deepEqual([r.kind, r.sent, t.state.estimates.find((x) => x.id === h.id).status], ['review', null, 'DRAFT']);
  assert.match(r.subject, /^Draft for review/);
  assert.match(r.html, /Draft for review, not sent to the investigator/);
  assert.equal(t.state.estimates.find((x) => x.id === h.id).investigator.email, 'ingrid.halvorsen@example.org', 'a colleague\'s address is not saved as the investigator\'s');
  // A draft with a line that has no price.
  const { id } = t.call('POST', '/api/estimates', { investigator: { last: 'Okoro' }, title: 'Touch preps', phases: [{ name: 'A', lines: [{ section: 'NECRO', code: 'HP002018', units: 4 }] }] });
  assert.match(t.call('GET', `/api/estimates/${id}/email`).sendProblems.join(' '), /HP002018 has no price/);
  const before = t.state.audit.length;
  assert.match(t.fails('POST', `/api/estimates/${id}/email`, { to: 'femi.okoro@example.org', subject: 'x', markSent: true, method: 'outlook' }), /Not ready to send: .*HP002018/);
  const e = t.state.estimates.find((x) => x.id === id);
  assert.deepEqual([e.status, e.emails, e.investigator.email, t.state.audit.length], ['DRAFT', undefined, '', before], 'a failed email leaves no trace');
  // Emailing it to the investigator for the first time keeps their address on the estimate.
  t.call('PUT', `/api/estimates/${id}`, { investigator: { last: 'Okoro' }, title: 'Touch preps', phases: [{ name: 'A', lines: [{ section: 'NECRO', code: 'HP002018', units: 4, unitPrice: 6 }] }] });
  t.call('POST', `/api/estimates/${id}/email`, { to: 'femi.okoro@example.org', subject: 'Estimate', markSent: true, method: 'copy' });
  assert.deepEqual([t.state.estimates.find((x) => x.id === id).investigator.email, t.state.estimates.find((x) => x.id === id).status], ['femi.okoro@example.org', 'SENT']);
});

test('addresses, subject and message are checked', () => {
  const t = fresh();
  const id = byLast(t, 'Castellanos').id;
  const post = (body) => t.fails('POST', `/api/estimates/${id}/email`, { subject: 'x', method: 'outlook', ...body });
  assert.match(post({ to: '' }), /address to send it to/);
  assert.match(post({ to: 'not an address' }), /These are not an email address: not, an, address/);
  assert.match(post({ to: 'a@example.org', cc: 'b@example' }), /This is not an email address: b@example/);
  assert.match(post({ to: 'a@example.org\r\nBcc: evil@example.org' }), /not an email address/);
  assert.match(post({ to: Array.from({ length: 11 }, (_, i) => `p${i}@example.org`) }), /at most 10 addresses/);
  assert.match(post({ to: 'a@example.org', subject: '  ' }), /Enter a subject/);
  assert.match(post({ to: 'a@example.org', message: 'x'.repeat(5001) }), /at most 5,000 characters/);
  assert.deepEqual(MAIL.parseAddresses('A <a@example.org>; b@example.org, B@EXAMPLE.ORG\nc@example.org d@example.org'), { addresses: ['a@example.org', 'b@example.org', 'c@example.org', 'd@example.org'], bad: [] });
  // A line break typed into the subject cannot start a new header.
  const r = t.call('POST', `/api/estimates/${id}/email`, { to: 'a@example.org', subject: 'Hello\r\nBcc: evil@example.org', method: 'outlook' });
  assert.equal(r.subject, 'Hello Bcc: evil@example.org');
  assert.ok(!/^Bcc:/m.test(r.eml));
});

// ---------- the .eml file ----------
test('the .eml opens as an unsent message, with the formatted estimate, a plain-text copy and the CSV', () => {
  const t = fresh();
  const h = byLast(t, 'Halvorsen');
  const r = send(t, h.id, { cc: 'mhl-estimates@example.org', subject: 'Cost estimate – Ünïcode ✓ for the MC38 anti-PD-1 study, with a long subject line that needs several encoded words', attachCsv: true });
  const m = readEml(r.eml);
  assert.deepEqual([m.headers.to, m.headers.cc, m.headers['x-unsent'], m.headers['mime-version']], ['ingrid.halvorsen@example.org', 'mhl-estimates@example.org', '1', '1.0']);
  assert.equal(m.headers.from, undefined, 'Outlook fills in From with the account that sends it');
  assert.equal(decodeHeader(m.headers.subject), 'Cost estimate – Ünïcode ✓ for the MC38 anti-PD-1 study, with a long subject line that needs several encoded words');
  assert.ok(m.lines.every((l) => l.length <= 998), 'no line is longer than email allows');
  assert.ok(m.lines.filter((l) => /^[A-Za-z0-9+/=]+$/.test(l)).every((l) => l.length <= 76));
  assert.deepEqual(m.parts.map((p) => [p.type, p.name]), [['text/plain', null], ['text/html', null], ['text/csv', 'EST26-0005.csv']]);
  const [text, html, csv] = m.parts.map((p) => p.body);
  const total = t.call('GET', `/api/estimates/${h.id}`).priced.total;
  assert.match(text, /^Dear Ingrid Halvorsen,/);
  assert.ok(text.includes(`TOTAL ESTIMATE: ${ESTX.fmtMoney(total)}`));
  assert.match(text, /MHL LIMS PILOT WITH TEST DATA: NOT A VALID ESTIMATE/);
  assert.match(text, /HP006004  IHC, Est\. Assay, per slide \(IHC on the tumor blocks: CD8 and Ki-67\): 64 x \$55\.79 = \$3,570\.56/);
  assert.equal(html, r.html.replace(/\r?\n/g, '\r\n'), 'the HTML part is the email shown, with CRLF line ends');
  assert.ok(!/[^\r]\n/.test(text), 'the text part has CRLF line ends');
  for (const s of ['Pilot (8 mice) subtotal', 'Main study (32 mice) subtotal', 'Optional, not included in the total', 'Assumptions and terms', 'valid until 8 Feb 2027', 'MHL LIMS pilot with test data']) assert.ok(html.includes(s), s);
  assert.ok(csv.startsWith('\ufeffEstimate,Revision,Phase'), 'Excel reads the CSV as UTF-8');
  assert.equal(csv.trim().split('\r\n').length, ESTX.csvRows(t.state.estimates.find((x) => x.id === h.id), t.call('GET', `/api/estimates/${h.id}`).priced).length);
  // Without the attachment it is a two-part message.
  const plain = readEml(send(t, h.id, { attachCsv: false }).eml);
  assert.match(plain.headers['content-type'], /^multipart\/alternative/);
  assert.deepEqual(plain.parts.map((p) => p.type), ['text/plain', 'text/html']);
});

test('everything typed into an estimate is escaped in the email', () => {
  const t = fresh();
  const X = '<img src=x onerror=alert(1)>"\'&';
  const { id } = t.call('POST', '/api/estimates', { investigator: { last: `Q${X}`, first: X, inst: X, email: 'q@example.org' }, title: X, description: X, assumptions: [X],
    phases: [{ name: X, lines: [{ section: 'STAIN', code: 'HP005003', units: 2, note: X }, { section: 'STAIN', code: '', description: X, unit: X, units: 1, unitPrice: 5 }] }, { name: 'B', lines: [{ section: 'STAIN', code: 'HP005003', units: 1, optional: true, note: X }] }] });
  const r = t.call('POST', `/api/estimates/${id}/email`, { to: 'q@example.org', subject: X, message: X, signOff: X, markSent: true, method: 'outlook' });
  assert.ok(!r.html.includes('<img'), 'no tag from the estimate survives');
  assert.ok(r.html.includes('&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;'));
});

// ---------- mailto: and copy ----------
test('the mailto: link carries the whole estimate when it fits, a summary when it does not, and refuses one that is too long', () => {
  const t = fresh();
  const c = byLast(t, 'Castellanos');
  const { id: smallId } = t.call('POST', '/api/estimates', { investigator: { last: 'Okoro', first: 'Femi' }, title: 'Scans', phases: [{ name: 'A', lines: [{ section: 'IMAGE', code: 'HP001007', units: 10 }] }] });
  t.call('POST', `/api/estimates/${smallId}/send`);
  const small = t.call('POST', `/api/estimates/${smallId}/email`, { to: 'ruth.castellanos@example.org', cc: 'mhl@example.org', subject: 'Estimate & terms', message: 'Hello', method: 'mailto' });
  assert.equal(small.mailtoShort, false);
  assert.ok(small.mailto.startsWith('mailto:ruth.castellanos@example.org?cc=mhl@example.org&subject=Estimate%20%26%20terms&body=Hello%0D%0A%0D%0ACOST%20ESTIMATE'));
  assert.ok(small.mailto.length <= MAIL.MAILTO_MAX);
  assert.equal(small.eml, null);
  const h = byLast(t, 'Halvorsen');
  const big = t.call('POST', `/api/estimates/${h.id}/email`, { to: 'ingrid.halvorsen@example.org', subject: 'Estimate', message: 'Dear Ingrid,', markSent: true, method: 'mailto' });
  assert.equal(big.mailtoShort, true);
  const body = decodeURIComponent(big.mailto.split('&body=')[1]);
  assert.match(body, /Pilot \(8 mice\): \$2,016\.24\r\n  Main study \(32 mice\): \$12,869\.44\r\n  Total: \$14,885\.68/);
  assert.match(body, /itemized estimate is in the attached PDF/);
  assert.match(t.fails('POST', `/api/estimates/${h.id}/email`, { to: 'ingrid.halvorsen@example.org', subject: 'Estimate', message: 'x '.repeat(1500), method: 'mailto' }), /too long for an email link/);
  const copied = t.call('POST', `/api/estimates/${c.id}/email`, { to: 'ruth.castellanos@example.org', subject: 'Estimate', message: 'Hello', method: 'copy' });
  assert.deepEqual([copied.eml, copied.mailto], [null, null]);
  assert.ok(MAIL.htmlBody(copied.html).startsWith('\n<p') && !MAIL.htmlBody(copied.html).includes('<body'));
  assert.deepEqual(t.state.estimates.find((x) => x.id === c.id).emails.map((m) => m.method), ['outlook', 'copy']);
});

test('the Cc and sign-off can be remembered for the next email', () => {
  const t = fresh();
  const c = byLast(t, 'Castellanos');
  t.call('POST', `/api/estimates/${c.id}/email`, { to: 'ruth.castellanos@example.org', cc: 'mhl-estimates@example.org', subject: 'x', signOff: 'Thanks,\nTT for MHL', method: 'copy', remember: true });
  const f = t.call('GET', `/api/estimates/${byLast(t, 'Moreau').id}/email`);
  assert.deepEqual([f.cc, f.signOff, f.remembered], ['mhl-estimates@example.org', 'Thanks,\nTT for MHL', true]);
  t.call('POST', `/api/estimates/${c.id}/email`, { to: 'ruth.castellanos@example.org', subject: 'x', method: 'copy' });
  assert.equal(t.call('GET', `/api/estimates/${c.id}/email`).cc, 'mhl-estimates@example.org', 'not remembering leaves the saved values alone');
});

// ---------- shared code ----------
test('the seed emails two estimates, and the browser builds the same email as the core', () => {
  assert.deepEqual(seeded.estimates.filter((e) => e.emails?.length).map((e) => [e.investigator.last, e.emails[0].cc[0]]), [['Castellanos', 'mhl-estimates@example.org'], ['Moreau', 'mhl-estimates@example.org']]);
  const src = bundleModules();
  assert.ok(src.includes("__define('estimatemail'"));
  const require = new Function(`${LOADER}\n${src}\nreturn __require;`)();
  const e = seeded.estimates.find((x) => x.investigator.last === 'Halvorsen');
  const money = { amount: R.amount, sumMoney: R.sumMoney };
  const p = ESTX.priceEstimate(e, priceList.items, money);
  const opts = { kind: 'send', subject: 'S', message: 'M', signOff: 'B', today: TODAY, preparedBy: 'TT', speciesName: 'Mouse', listName: 'CY2027', listStatus: 'DRAFT' };
  assert.deepEqual(require('estimatemail').estimateEmail(e, p, opts), MAIL.estimateEmail(e, p, opts));
  const eml = MAIL.buildEml({ to: ['a@example.org'], subject: 'Ü', text: 't', html: '<p>h</p>' });
  assert.equal(require('estimatemail').buildEml({ to: ['a@example.org'], subject: 'Ü', text: 't', html: '<p>h</p>' }), eml);
  assert.equal(MAIL.base64(new TextEncoder().encode('Ünïcode ✓ ab')), Buffer.from('Ünïcode ✓ ab').toString('base64'));
});

// ---------- regressions found in review ----------
test('addresses pasted from Outlook (names with commas, brackets) are understood; malformed ones are not', () => {
  const p = MAIL.parseAddresses('Doe, Jane (NIH/NCI) [E] <jane.doe@nih.gov>; "Smith, Al" <al.smith@nih.gov>, x@nih.gov\nJANE.DOE@nih.gov');
  assert.deepEqual(p, { addresses: ['jane.doe@nih.gov', 'al.smith@nih.gov', 'x@nih.gov'], bad: [] });
  assert.deepEqual(MAIL.parseAddresses('.x@nih.gov; x..y@nih.gov; x@nih.gov.; x@nih').bad, ['.x@nih.gov', 'x..y@nih.gov', 'x@nih.gov.', 'x@nih']);
  assert.equal(MAIL.isAddress(`${'a'.repeat(250)}@b.org`), false, 'at most 254 characters');
  const t = fresh();
  // The editor and the email page agree on what an address is.
  assert.match(t.fails('POST', '/api/estimates', { investigator: { last: 'x', email: 'x@nih.gov.' }, title: 't' }), /does not look right/);
  const r = t.call('POST', `/api/estimates/${byLast(t, 'Castellanos').id}/email`, { to: 'Castellanos, Ruth (NIH/NCI) [E] <ruth.castellanos@example.org>', subject: 'x', method: 'copy' });
  assert.deepEqual(r.to, ['ruth.castellanos@example.org']);
});

test('the saved Cc and sign-off can be forgotten, and a review email does not start addressed to the investigator', () => {
  const t = fresh();
  const c = byLast(t, 'Castellanos');
  t.call('POST', `/api/estimates/${c.id}/email`, { to: 'ruth.castellanos@example.org', cc: 'boss@example.org', subject: 'x', signOff: 'Thanks', method: 'copy', remember: true });
  t.call('PUT', '/api/settings', { estimateEmail: null });
  const f = t.call('GET', `/api/estimates/${c.id}/email`);
  assert.deepEqual([f.cc, f.remembered, f.signOff === f.defaultSignOff], ['', false, true]);
  assert.match(t.fails('PUT', '/api/settings', { estimateEmail: { cc: 'nope', signOff: '' } }), /Not an email address/);
  t.call('PUT', '/api/settings', { estimateEmail: { cc: 'Lab <lab@example.org>', signOff: 'S' } });
  assert.equal(t.call('GET', `/api/estimates/${c.id}/email`).cc, 'lab@example.org');
  // The browser leaves To empty for a review email (the form still names the investigator for the estimate itself).
  const src = readFileSync(path.join(here, '..', 'web', 'views', 'estimateviews.js'), 'utf8');
  assert.match(src, /const toFor = \(k\) => \(k === 'review' \? '' : investigatorTo\);/);
});

test('emoji in a subject survive the 200-character cut, lines without a price say so, and headers stay within email line limits', () => {
  const t = fresh();
  const c = byLast(t, 'Castellanos');
  const subject = `${'x'.repeat(199)}😀 and more`;
  const r = t.call('POST', `/api/estimates/${c.id}/email`, { to: 'ruth.castellanos@example.org', subject, method: 'mailto', message: 'Hi' });
  assert.equal(r.subject, `${'x'.repeat(199)}😀`);
  assert.ok(decodeURIComponent(r.mailto).includes('😀'));
  assert.equal(MAIL.wellFormed('a\uD83D'), 'a\uFFFD');
  const long = t.call('POST', `/api/estimates/${c.id}/email`, { to: Array.from({ length: 8 }, (_, i) => `investigator.number.${i}@example.org`), cc: 'lab@example.org',
    subject: 'Ünïcode ✓ '.repeat(12), method: 'outlook' });
  const head = long.eml.split('\r\n\r\n')[0].split('\r\n');
  assert.ok(head.every((l) => l.length <= 76), head.find((l) => l.length > 76));
  assert.equal(decodeHeader(readEml(long.eml).headers.subject), MAIL.cut('Ünïcode ✓ '.repeat(12).trim(), 200));
  // A review email of a draft with an unpriced line.
  const { id } = t.call('POST', '/api/estimates', { investigator: { last: 'Okoro' }, title: 'Touch preps', phases: [{ name: 'A', lines: [{ section: 'NECRO', code: 'HP002018', units: 4 }] }] });
  const rv = t.call('POST', `/api/estimates/${id}/email`, { to: 'colleague@example.org', subject: 'Draft', method: 'copy' });
  assert.match(rv.text, /HP002018  Tissue Touch Prep, per slide: 4 x no price yet/);
  assert.match(rv.html, /no price yet/);
});

