// Tests for version 7 of the pilot: cost estimates for possible new projects (the Estimates tab).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createCore, upgradeToV6, emptyState } from '../core/core.mjs';
import { seedState } from '../core/seed.mjs';
import { REQUEST_TYPES } from '../core/defs.mjs';
import * as ESTX from '../core/estimates.mjs';
import * as R from '../../tools/rules-reference/rules.mjs';
import { bundleModules, LOADER } from '../build-standalone.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const lims = path.resolve(here, '..', '..');
const priceList = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const ihcCatalog = JSON.parse(readFileSync(path.join(lims, 'src', 'SeedData', 'ihc-assays.json'), 'utf8'));
const TODAY = '2026-11-09';
const MONEY = { amount: R.amount, sumMoney: R.sumMoney };
const items = priceList.items;
const seeded = seedState({ priceList, ihcCatalog, today: TODAY });

// A core on a copy of the seed, with a clock the test can move and a price list the test may change.
function fresh({ list = priceList } = {}) {
  const state = structuredClone(seeded);
  state.settings.initials = 'TT';
  const day = { today: TODAY };
  const core = createCore({ state, priceList: list, ihcCatalog, clock: { today: () => day.today, now: () => `${day.today}T10:00:00` } });
  const call = (method, p, body = null, query = {}) => { const r = core.handle(method, p, query, body); if (r.status !== 200) throw new Error(`${method} ${p}: ${r.json?.error}`); return r.file || r.json; };
  const fails = (method, p, body = null) => { const r = core.handle(method, p, {}, body); assert.notEqual(r.status, 200, `${p} should fail`); return r.json.error; };
  return { state, core, call, fails, day };
}
const draftBody = (extra = {}) => ({
  investigator: { last: 'Okoro', first: 'Femi', inst: 'NCI/CCR, Test Branch', email: 'femi.okoro@example.org' }, title: 'Liver histology for a diet study',
  species: 'MOUSE', type: 'HISTO', n: 12,
  phases: [{ name: 'Histology', lines: [{ section: 'TRIM_EMBED', code: 'HP003003', units: 12 }, { section: 'STAIN', code: 'HP005003', units: 12 },
    { section: 'STAIN', code: '', description: 'Oil Red O on frozen sections', unit: 'slide', units: 12, unitPrice: 18.5 },
    { section: 'IMAGE', code: 'HP001006', units: 12, optional: true }] }],
  ...extra,
});
const est = (t, id) => t.state.estimates.find((e) => e.id === id);

// ---------- pricing (the module shared by the browser and the core) ----------
test('a line is priced at the list price, at a price typed for an unpriced code, or as a line not on the list', () => {
  const p = (line) => ESTX.priceLine(line, items, MONEY);
  const listed = p({ section: 'NECRO', code: 'HP002001', units: 8 });
  assert.deepEqual([listed.unitPrice, listed.amount, listed.description, listed.custom, listed.problem], [41.06, R.amount(8, 41.06), 'Necropsy', false, '']);
  assert.equal(p({ section: 'NECRO', code: 'HP002001', units: 8, unitPrice: 1 }).unitPrice, 41.06, 'a typed price never overrides the list');
  assert.equal(p({ section: 'STAIN', code: 'HP002001', units: 1 }).section, 'NECRO', 'a code goes in its own section');
  const unpriced = p({ section: 'NECRO', code: 'HP002018', units: 4 });   // Tissue Touch Prep has no CY2027 price
  assert.match(unpriced.problem, /no price on the list/); assert.equal(unpriced.amount, null);
  const typed = p({ section: 'NECRO', code: 'HP002018', units: 4, unitPrice: 6.255 });
  assert.deepEqual([typed.unitPrice, typed.amount, typed.priceByHand], [6.26, 25.04, true]);
  const custom = p({ section: 'STAIN', code: '', description: 'Xenium run', unit: 'slide', units: 3, unitPrice: 0 });
  assert.deepEqual([custom.custom, custom.amount, custom.problem], [true, 0, '']);
  assert.match(p({ section: 'STAIN', code: '', units: 3, unitPrice: 5 }).problem, /needs a description/);
  assert.match(p({ section: 'STAIN', code: '', description: 'x', units: 3 }).problem, /needs a unit price/);
  assert.match(p({ section: 'NECRO', code: 'HP002001', units: 0 }).problem, /more than zero/);
  assert.match(p({ section: 'NECRO', code: 'HP002001', units: 1.255 }).problem, /two decimal places/);
  assert.match(p({ section: 'NECRO', code: 'ZZ000000', units: 1 }).problem, /not on the price list/);
  assert.equal(p({ section: 'NECRO', code: 'HP009002', units: 4 }).needsNote, true, 'labor (DEFINE) needs a note');
  assert.equal(p({ section: 'NECRO', code: 'HP009002', units: 4, note: 'Embryo dissection' }).needsNote, false);
});

test('optional lines are shown but not counted, phases have subtotals, and sending needs every line sorted out', () => {
  const e = { investigator: { last: 'X' }, title: 'T', phases: [
    { name: 'Pilot', lines: [{ section: 'NECRO', code: 'HP002001', units: 8 }, { section: 'BLOOD', code: 'HP002204', units: 8, optional: true }] },
    { name: 'Main', lines: [{ section: 'NECRO', code: 'HP002001', units: 32 }, { section: 'NECRO', code: 'HP009002', units: 2 }] }] };
  const p = ESTX.priceEstimate(e, items, MONEY);
  assert.equal(p.phases[0].subtotal, R.amount(8, 41.06));
  assert.equal(p.phases[0].optionalTotal, R.amount(8, 69.06));
  assert.equal(p.total, R.sumMoney([R.amount(8, 41.06), R.amount(32, 41.06), R.amount(2, 24.95)]));
  assert.deepEqual(p.bySection.map((s) => s.section), ['NECRO']);
  assert.match(ESTX.sendProblems(e, p).join(' '), /Main, line 2 \(HP009002\): say what the HP009002 work is/);
  e.phases[1].lines[1].note = 'Embryo dissection';
  assert.deepEqual(ESTX.sendProblems(e, ESTX.priceEstimate(e, items, MONEY)), []);
  assert.match(ESTX.sendProblems({ investigator: { last: '' }, title: '', phases: [{ lines: [{ section: 'NECRO', code: 'HP002001', units: 1, optional: true }] }] },
    ESTX.priceEstimate({ phases: [{ lines: [{ section: 'NECRO', code: 'HP002001', units: 1, optional: true }] }] }, items, MONEY)).join(' '), /last name.*title.*not optional/);
});

test('a kind of work fills in its usual lines, with blocks or slides per animal applied to the per-block and per-slide codes', () => {
  const def = REQUEST_TYPES['NECRO-FULL'];
  assert.equal(ESTX.planPerBlock(def, items), 3);
  const units = (lines) => Object.fromEntries(lines.map((l) => [l.code, l.units]));
  assert.deepEqual(units(ESTX.planLines(def, 8, null, items)), { HP002001: 8, HP002021: 8, HP003003: 24, HP004001: 24, HP005003: 24, HP001006: 24, PA001002: 24 });
  assert.deepEqual(units(ESTX.planLines(def, 8, 5, items)), { HP002001: 8, HP002021: 8, HP003003: 40, HP004001: 40, HP005003: 40, HP001006: 40, PA001002: 40 });
  assert.equal(ESTX.planPerBlock(REQUEST_TYPES.HISTO, items), 1);
});

// ---------- the life of an estimate ----------
test('an estimate is created and saved as a draft, sent with its prices fixed, then accepted', () => {
  const list = structuredClone(priceList);
  const t = fresh({ list });
  assert.match(t.fails('POST', '/api/estimates', { title: 'x' }), /last name/);
  assert.match(t.fails('POST', '/api/estimates', { investigator: { last: 'x' } }), /title/);
  assert.match(t.fails('POST', '/api/estimates', draftBody({ investigator: { last: 'x', email: 'not-an-email' } })), /email/);
  const { id, number } = t.call('POST', '/api/estimates', draftBody());
  assert.equal(number, 'EST26-0006', 'the seed has five estimates');
  const d = t.call('GET', `/api/estimates/${id}`);
  assert.equal(d.display, 'DRAFT');
  assert.equal(d.priced.total, R.sumMoney([R.amount(12, 15.47), R.amount(12, 3.15), R.amount(12, 18.5)]));
  assert.equal(d.priced.optionalTotal, R.amount(12, 12.45));
  // A draft follows the price list; a sent estimate keeps the prices it was sent with.
  list.items.find((i) => i.code === 'HP003003').price = 20;
  const draftTotal = t.call('GET', `/api/estimates/${id}`).priced.total;
  assert.equal(draftTotal, R.sumMoney([R.amount(12, 20), R.amount(12, 3.15), R.amount(12, 18.5)]));
  const sent = t.call('POST', `/api/estimates/${id}/send`);
  assert.equal(sent.validUntil, '2027-02-07');
  list.items.find((i) => i.code === 'HP003003').price = 99;
  assert.equal(t.call('GET', `/api/estimates/${id}`).priced.total, draftTotal);
  assert.match(t.fails('PUT', `/api/estimates/${id}`, draftBody()), /only a draft can be changed/);
  assert.match(t.fails('POST', `/api/estimates/${id}/send`), /only a draft/);
  assert.match(t.fails('POST', `/api/estimates/${id}/discard`), /only a draft/);
  t.call('POST', `/api/estimates/${id}/accept`);
  assert.equal(est(t, id).status, 'ACCEPTED');
  assert.deepEqual(t.state.audit.filter((a) => a.entity === 'estimate' && a.entityId === id).map((a) => a.action), ['ESTIMATE_CREATED', 'ESTIMATE_SENT', 'ESTIMATE_ACCEPTED']);
});

test('sending is refused until the draft is complete', () => {
  const t = fresh();
  const { id } = t.call('POST', '/api/estimates', draftBody({ phases: [{ name: 'Labor', lines: [{ section: 'NECRO', code: 'HP009002', units: 4 }, { section: 'NECRO', code: 'HP002018', units: 2 }] }] }));
  const err = t.fails('POST', `/api/estimates/${id}/send`);
  assert.match(err, /HP002018 has no price/); assert.match(err, /HP009002 work is/);
  assert.equal(est(t, id).status, 'DRAFT');
  t.call('PUT', `/api/estimates/${id}`, draftBody({ phases: [{ name: 'Labor', lines: [{ section: 'NECRO', code: 'HP009002', units: 4, note: 'Embryo dissection' }, { section: 'NECRO', code: 'HP002018', units: 2, unitPrice: 9 }] }] }));
  const sent = t.call('POST', `/api/estimates/${id}/send`);
  assert.ok(sent.validUntil);
  const line = est(t, id).phases[0].lines[1];
  assert.deepEqual([line.unitPrice, line.priceByHand, line.description], [9, true, 'Tissue Touch Prep, per slide']);
});

test('an expired estimate cannot be accepted; it can be declined (with a reason) or revised', () => {
  const t = fresh();
  const { id } = t.call('POST', '/api/estimates', draftBody({ validDays: 30 }));
  t.call('POST', `/api/estimates/${id}/send`);
  t.day.today = '2026-12-10';
  assert.equal(t.call('GET', `/api/estimates/${id}`).display, 'EXPIRED');
  assert.match(t.fails('POST', `/api/estimates/${id}/accept`), /expired on 2026-12-09/);
  assert.match(t.fails('POST', `/api/estimates/${id}/decline`, {}), /Say why/);
  t.call('POST', `/api/estimates/${id}/decline`, { reason: 'Not funded this year' });
  assert.deepEqual([est(t, id).status, est(t, id).declineReason], ['DECLINED', 'Not funded this year']);
  assert.match(t.fails('POST', `/api/estimates/${id}/accept`), /Only a sent estimate/);
});

test('a revision keeps the number, replaces the earlier one, and discarding it puts the earlier one back', () => {
  const t = fresh();
  const { id, number } = t.call('POST', '/api/estimates', draftBody());
  assert.match(t.fails('POST', `/api/estimates/${id}/revise`), /cannot be revised/, 'a draft is simply edited');
  t.call('POST', `/api/estimates/${id}/send`);
  const r2 = t.call('POST', `/api/estimates/${id}/revise`).id;
  assert.deepEqual([est(t, r2).number, est(t, r2).rev, est(t, r2).status, est(t, id).status], [number, 2, 'DRAFT', 'SUPERSEDED']);
  assert.match(t.fails('POST', `/api/estimates/${id}/revise`), /already has a later revision/);
  assert.equal(t.call('GET', `/api/estimates/${r2}`).label, `${number} rev 2`);
  assert.deepEqual(t.call('GET', `/api/estimates/${id}`).revisions.map((x) => x.rev), [1, 2]);
  // The list shows only the latest revision of each estimate.
  assert.equal(t.call('GET', '/api/estimates', null, { status: 'ALL' }).estimates.filter((e) => e.number === number).length, 1);
  const back = t.call('POST', `/api/estimates/${r2}/discard`);
  assert.equal(back.backTo, id);
  assert.deepEqual([est(t, id).status, est(t, id).supersededBy, est(t, r2).status], ['SENT', null, 'DISCARDED']);
  // A copy is a new estimate with a new number.
  const copy = t.call('POST', `/api/estimates/${id}/copy`);
  assert.notEqual(copy.number, number);
  assert.equal(est(t, copy.id).copiedFrom, id);
  assert.equal(est(t, copy.id).status, 'DRAFT');
});

// ---------- NAS ----------
test('an accepted estimate links to a NAS request, whose scope New request then starts from', () => {
  const t = fresh();
  const body = draftBody({ phases: [...draftBody().phases, { name: 'Follow-up', lines: [{ section: 'NECRO', code: 'HP002001', units: 4 }] }] });
  const { id } = t.call('POST', '/api/estimates', body);
  const abernathy = t.state.nas.find((n) => n.requester.last === 'Abernathy');
  assert.match(t.fails('POST', `/api/estimates/${id}/nas`, { nasId: abernathy.id }), /Accept the estimate/);
  t.call('POST', `/api/estimates/${id}/send`); t.call('POST', `/api/estimates/${id}/accept`);
  assert.match(t.fails('POST', `/api/estimates/${id}/nas`, { nasId: 999999 }), /Choose a NAS request/);
  assert.equal(est(t, id).nasId, null, 'a failed link changes nothing');
  const res = t.call('POST', `/api/estimates/${id}/nas`, { nasId: abernathy.id, phases: [0] });
  // Price list lines of the chosen phase only: no optional line, no line that is not on the list, no follow-up phase.
  assert.deepEqual(res.scope, [['TRIM_EMBED', 'HP003003', 12], ['STAIN', 'HP005003', 12]]);
  const nas = t.state.nas.find((n) => n.id === abernathy.id);
  assert.equal(nas.estimateLabel, est(t, id).number);
  assert.deepEqual(nas.scopeLeftOut, ['Oil Red O on frozen sections (12 x $18.50)']);
  assert.match(t.fails('POST', `/api/estimates/${id}/nas`, { nasId: abernathy.id }), /already linked/);
  const d = t.call('GET', `/api/estimates/${id}`);
  assert.equal(d.nas.number, abernathy.number);
  assert.ok(!d.openNas.some((n) => n.id === abernathy.id));
  // The linked estimate can no longer be revised (the NAS request is based on it); a copy can be made.
  assert.match(t.fails('POST', `/api/estimates/${id}/revise`), /linked to a NAS request/);
  // A NAS request that already had a scope keeps it.
  const sato = t.state.nas.find((n) => n.requester.last === 'Sato');
  const before = structuredClone(sato.scope);
  const c = t.call('POST', `/api/estimates/${id}/copy`).id;
  t.call('POST', `/api/estimates/${c}/send`); t.call('POST', `/api/estimates/${c}/accept`);
  t.call('POST', `/api/estimates/${c}/nas`, { nasId: sato.id });
  assert.deepEqual(t.state.nas.find((n) => n.id === sato.id).scope, before);
});

test('in the pilot an accepted estimate can make its own NAS request, authorized for the phases chosen', () => {
  const t = fresh();
  const { id } = t.call('POST', '/api/estimates', draftBody({ type: '', n: null }));
  t.call('POST', `/api/estimates/${id}/send`); t.call('POST', `/api/estimates/${id}/accept`);
  assert.match(t.fails('POST', `/api/estimates/${id}/nas`, { create: true }), /request type/);
  assert.match(t.fails('POST', `/api/estimates/${id}/nas`, { create: true, type: 'HISTO' }), /whole number/);
  const before = t.state.nas.length;
  const r = t.call('POST', `/api/estimates/${id}/nas`, { create: true, type: 'HISTO', n: 12, project: '25X0099999.01' });
  assert.equal(t.state.nas.length, before + 1);
  const nas = t.state.nas.find((n) => n.id === r.nasId);
  assert.deepEqual([nas.type, nas.n, nas.requester.last, nas.project, nas.authorized], ['HISTO', 12, 'Okoro', '25X0099999.01', t.call('GET', `/api/estimates/${id}`).priced.total]);
  assert.deepEqual(nas.scope, [['TRIM_EMBED', 'HP003003', 12], ['STAIN', 'HP005003', 12]]);
  assert.ok(t.call('GET', '/api/nas').nas.some((n) => n.id === nas.id && n.estimateId === id), 'New request lists it with its estimate');
});

// ---------- lists, search, CSV ----------
test('the list filters by status and text, Lookup finds estimates, and the CSV has every line', () => {
  const t = fresh();
  const all = t.call('GET', '/api/estimates', null, { status: 'ALL' });
  assert.deepEqual(all.counts, { EXPIRED: 1, DECLINED: 1, SENT: 1, ACCEPTED: 1, DRAFT: 1 });
  assert.deepEqual(t.call('GET', '/api/estimates').estimates.map((e) => e.display).sort(), ['DRAFT', 'SENT'], 'open by default');
  assert.deepEqual(t.call('GET', '/api/estimates', null, { status: 'ALL', q: 'organoid' }).estimates.map((e) => e.label), ['EST26-0003 rev 2']);
  assert.deepEqual(t.call('GET', '/api/estimates', null, { status: 'ALL', q: 'est26-0004' }).estimates.map((e) => e.investigator), ['Moreau, Claire']);
  const hit = t.call('GET', '/api/search', null, { q: 'EST26-0003' }).hits;
  assert.deepEqual(hit.map((h) => [h.number, h.href.startsWith('#/estimates/')]), [['EST26-0003 rev 2', true]]);
  assert.ok(t.call('GET', '/api/search', null, { q: 'Halvorsen' }).hits.some((h) => /estimate/.test(h.matched)));
  const h = t.state.estimates.find((e) => e.investigator.last === 'Halvorsen');
  const file = t.call('GET', `/api/estimates/${h.id}/csv`);
  const rows = file.content.trim().split('\r\n');
  assert.equal(file.name, `${h.number}.csv`);
  assert.match(rows[0], /^Estimate,Revision,Phase,Section,Code/);
  assert.equal(rows.length, 1 + h.phases.reduce((n, ph) => n + ph.lines.length, 0) + 2, 'header, lines, total and optional total');
  assert.match(rows.at(-2), new RegExp(`Total \\(not counting optional lines\\),,,,,${t.call('GET', `/api/estimates/${h.id}`).priced.total.toFixed(2)}`));
  t.call('POST', `/api/estimates/${h.id}/discard`);
  assert.ok(!t.call('GET', '/api/search', null, { q: 'Halvorsen' }).hits.some((x) => /estimate/.test(x.matched)), 'discarded drafts are not found');
});

// ---------- seed, upgrade, bundle ----------
test('the seed has an estimate in every state, and the accepted one is the scope of Moreau\'s NAS request', () => {
  const t = fresh();
  const by = (last) => t.state.estimates.filter((e) => e.investigator.last === last);
  assert.deepEqual(by('Castellanos').map((e) => [e.rev, e.status]), [[1, 'SUPERSEDED'], [2, 'SENT']]);
  assert.equal(t.call('GET', `/api/estimates/${by('Iverson')[0].id}`).display, 'EXPIRED');
  const moreau = t.state.nas.find((n) => n.requester.last === 'Moreau');
  assert.deepEqual([moreau.estimateId, moreau.scope], [by('Moreau')[0].id, [['IMAGE', 'HP001007', 60]]]);
  assert.ok(moreau.authorized >= t.call('GET', `/api/estimates/${by('Moreau')[0].id}`).priced.total);
  const draft = t.call('GET', `/api/estimates/${by('Halvorsen')[0].id}`);
  assert.deepEqual(draft.sendProblems, []);
  assert.deepEqual(draft.priced.phases.map((p) => p.name), ['Pilot (8 mice)', 'Main study (32 mice)']);
  assert.ok(draft.priced.phases[1].lines.some((l) => l.code === 'HP006004' && l.units === 64), 'CD8 and Ki-67 on 32 tumor blocks');
  assert.ok(draft.estimate.assumptions.some((a) => /this estimate already includes/.test(a)));
  assert.ok(draft.priced.optionalTotal > 0);
});

test('saved data from version 5 gets an empty list of estimates', () => {
  const old = structuredClone(seeded);
  delete old.estimates; old.version = 5;
  createCore({ state: old, priceList, ihcCatalog, clock: { today: () => TODAY, now: () => `${TODAY}T10:00:00` } });
  assert.deepEqual([old.version, old.estimates], [8, []]);
  assert.equal(upgradeToV6(old), false);
  assert.deepEqual(emptyState(TODAY).estimates, []);
});

test('the standalone bundle prices an estimate exactly as the core does', () => {
  const src = bundleModules();
  for (const m of ['estimates', 'estimateviews']) assert.ok(src.includes(`__define('${m}'`), m);
  const require = new Function(`${LOADER}\n${src}\nreturn __require;`)();
  const h = seeded.estimates.find((e) => e.investigator.last === 'Halvorsen');
  const bundled = require('estimates').priceEstimate(h, items, { amount: require('rules').amount, sumMoney: require('rules').sumMoney });
  assert.deepEqual(bundled, ESTX.priceEstimate(h, items, MONEY));
});

// ---------- regressions found in review ----------
test('after a discarded revision the earlier one is current again: listed, found, revisable, and revision numbers are not reused', () => {
  const t = fresh();
  const { id, number } = t.call('POST', '/api/estimates', draftBody());
  t.call('POST', `/api/estimates/${id}/send`);
  const r2 = t.call('POST', `/api/estimates/${id}/revise`).id;
  t.call('POST', `/api/estimates/${r2}/discard`);
  assert.equal(t.call('GET', `/api/estimates/${id}`).latest, true);
  assert.ok(t.call('GET', '/api/estimates', null, { status: 'SENT' }).estimates.some((e) => e.id === id));
  assert.ok(t.call('GET', '/api/search', null, { q: number }).hits.some((h) => h.id === id));
  assert.ok(t.call('GET', '/api/estimates', null, { status: 'DISCARDED' }).estimates.length === 0, 'the discarded revision is not the current one');
  const r3 = t.call('POST', `/api/estimates/${id}/revise`).id;
  assert.equal(est(t, r3).rev, 3, 'rev 2 was discarded, so the next is rev 3');
  // A first draft discarded outright shows under Discarded.
  const lone = t.call('POST', '/api/estimates', draftBody()).id;
  t.call('POST', `/api/estimates/${lone}/discard`);
  assert.deepEqual(t.call('GET', '/api/estimates', null, { status: 'DISCARDED' }).estimates.map((e) => e.id), [lone]);
});

test('a NAS request made from an estimate records what its scope leaves out, and never gets an empty scope', () => {
  const t = fresh();
  const body = draftBody({ phases: [...draftBody().phases, { name: 'Custom only', lines: [{ section: 'STAIN', code: '', description: 'Xenium run', unit: 'slide', units: 2, unitPrice: 0 }] },
    { name: 'Unpriced', lines: [{ section: 'NECRO', code: 'HP002018', units: 3, unitPrice: 7 }, { section: 'NECRO', code: 'HP002001', units: 3 }] }] });
  const make = () => { const { id } = t.call('POST', '/api/estimates', body); t.call('POST', `/api/estimates/${id}/send`); t.call('POST', `/api/estimates/${id}/accept`); return id; };
  const a = make();
  const ra = t.call('POST', `/api/estimates/${a}/nas`, { create: true, type: 'HISTO', n: 12, phases: [0] });
  const na = t.state.nas.find((n) => n.id === ra.nasId);
  assert.deepEqual([na.scopeFromEstimate, na.scopeLeftOut], [true, ['Oil Red O on frozen sections (12 x $18.50)']]);
  const b = make();
  assert.match(t.fails('POST', `/api/estimates/${b}/nas`, { create: true, type: 'HISTO', n: 2, phases: [1] }), /come to \$0\.00.*enter the amount NAS authorized/);
  const rb = t.call('POST', `/api/estimates/${b}/nas`, { create: true, type: 'HISTO', n: 2, phases: [1], authorized: 500 });
  const nb = t.state.nas.find((n) => n.id === rb.nasId);
  assert.deepEqual([nb.scope, nb.scopeFromEstimate], [null, false], 'only a line not on the list: no scope at all');
  assert.deepEqual(nb.scopeLeftOut, ['Xenium run (2 x price to be confirmed)'], 'but New request is still told about it');
  // A code with no list price is priced by hand on the estimate but cannot be charged as it is, so it is left out too.
  const c = make();
  const rc = t.call('POST', `/api/estimates/${c}/nas`, { create: true, type: 'NECRO-FULL', n: 3, phases: [2] });
  const nc = t.state.nas.find((n) => n.id === rc.nasId);
  assert.deepEqual(nc.scope, [['NECRO', 'HP002001', 3]]);
  assert.deepEqual(nc.scopeLeftOut, ['HP002018 Tissue Touch Prep, per slide (3 x $7.00, no list price)']);
  // Linking a NAS request that came with its own scope says so.
  const d = make();
  const sato = t.state.nas.find((n) => n.requester.last === 'Sato');
  assert.equal(t.call('POST', `/api/estimates/${d}/nas`, { nasId: sato.id }).scopeFromEstimate, false);
  assert.equal(t.call('GET', `/api/estimates/${d}`).nas.scopeFromEstimate, false);
});

test('units and prices have limits, odd line data is refused cleanly, and the on-screen label finds the estimate', () => {
  const p = (line) => ESTX.priceLine(line, items, MONEY);
  assert.match(p({ section: 'NECRO', code: 'HP002001', units: 1e15 }).problem, /at most 100,000/);
  assert.match(p({ section: 'NECRO', code: 'HP002001', units: Infinity }).problem, /at most 100,000/);
  assert.match(p({ section: 'STAIN', code: '', description: 'x', units: 1, unitPrice: 5e6 }).problem, /unit price from 0/);
  const t = fresh();
  const r = t.core.handle('POST', '/api/estimates', {}, draftBody({ phases: [{ name: 'x', lines: [null] }] }));
  assert.equal(r.status, 400);
  const { id } = t.call('POST', '/api/estimates', draftBody({ phases: [{ name: 'x', lines: [{ section: 'NECRO', code: 'HP002001', units: 1e9 }] }] }));
  assert.match(t.fails('POST', `/api/estimates/${id}/send`), /at most 100,000/);
  assert.deepEqual(t.call('GET', '/api/search', null, { q: 'EST26-0003 rev 2' }).hits.map((h) => h.number), ['EST26-0003 rev 2']);
  assert.equal(t.call('GET', '/api/estimates', null, { status: 'ALL', q: 'EST26-0003 rev 2' }).estimates.length, 1);
});
