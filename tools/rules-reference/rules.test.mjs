// Runs the same cases as tests/MhlLims.Domain.Tests against the JavaScript reference rules.
//   node --test tools/rules-reference/rules.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import * as R from './rules.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const json = JSON.parse(readFileSync(path.join(here, '..', '..', 'src', 'SeedData', 'price-list-CY2027.json'), 'utf8'));
const catalog = () => R.loadCatalog(json);
const ctx = { requestId: 1 };
const charge = (section, code, units, description = null, c = ctx, date = '2027-03-15') =>
  R.createCharge(catalog(), c, { section, code, date, units, description });

test('CY2027 list has 55 codes and 3 unpriced', () => {
  assert.equal(json.items.length, 55);
  assert.deepEqual(R.unpricedCodes(json), ['HP002017', 'HP002018', 'HP003007']);
});

test('quotes match the worksheet', () => {
  for (const [code, price] of [['HP002001', 41.06], ['HP006017', 179.25], ['HP006014', 262.94], ['HP001009', 34.59], ['PA001004', 51.1]])
    assert.equal(R.quote(catalog(), code, '2027-06-01').unitPrice, price);
});

test('quote refusals', () => {
  assert.throws(() => R.quote(catalog(), 'HP002018', '2027-06-01'), /no price/);
  assert.throws(() => R.quote(catalog(), 'HP999999', '2027-06-01'), /Unknown/);
  assert.throws(() => R.quote(catalog(), 'HP002001', '2026-12-31'), /No approved price list/);
  assert.throws(() => R.quote(R.loadCatalog(json, { status: 'DRAFT' }), 'HP002001', '2027-06-01'), /No approved/);
});

test('charges are priced and rounded half away from zero', () => {
  assert.equal(charge('NECRO', 'HP002001', 12).amount, 492.72);
  assert.equal(charge('STAIN', 'HP009002', 0.5, 'Antigen retrieval optimization').amount, 12.48);
  assert.equal(charge('NECRO', 'HP009002', 2, 'Perfusion setup').amount, 49.9);
  assert.equal(R.amount(-2, 12.45), -24.9);
});

test('charge validations', () => {
  assert.throws(() => charge('NECRO', 'HP009002', 2), /description/);
  assert.throws(() => charge('NECRO', 'HP005003', 10), /NECRO section/);
  assert.equal(charge('NECRO', 'HP003005', 1).amount, 12.08);
  assert.equal(charge('TRIM_EMBED', 'HP003005', 1).amount, 12.08);
  for (const u of [0, -1, 1.005]) assert.throws(() => charge('STAIN', 'HP005003', u));
  assert.throws(() => charge('NECRO', 'HP002001', 1, null, { chargeType: 'N' }), /no charge/);
  assert.throws(() => charge('NECRO', 'HP002001', 1, null, { chargeType: 'L' }), /cancelled/);
  assert.throws(() => charge('NECRO', 'HP002001', 1, null, { projectActive: false }), /project/);
  assert.throws(() => charge('NECRO', 'HP002001', 1, null, { projectAllowsCharges: false }), /project/);
});

test('estimate for a small necropsy study', () => {
  const c = catalog();
  const date = '2027-02-01';
  const lines = [
    ['NECRO', 'HP002001', 10], ['TRIM_EMBED', 'HP003003', 30], ['MICROTOMY', 'HP004001', 30],
    ['STAIN', 'HP005003', 30], ['IMAGE', 'HP001006', 30], ['PATH', 'PA001002', 30],
  ].map(([section, code, units]) => R.estimateLine(c, { section, code, units, date }));
  const s = R.summarizeEstimate(lines, 2500, []);
  assert.equal(s.total, 2464.4);
  assert.equal(s.sections.length, 6);
  assert.equal(s.sections.find((x) => x.section === 'PATH').amount, 715.2);
  assert.equal(s.estimateExceeds, false);
  assert.equal(s.remaining, 2500);
});

test('charges to date reduce authorization; void lines ignored', () => {
  const c1 = charge('NECRO', 'HP002001', 10, null, ctx, '2027-02-01');
  const c2 = charge('NECRO', 'HP002007', 10, null, ctx, '2027-02-01');
  c2.status = 'VOID';
  const plan = [R.estimateLine(catalog(), { section: 'NECRO', code: 'HP002001', units: 10, date: '2027-02-01' })];
  const s = R.summarizeEstimate(plan, 400, [c1, c2]);
  assert.equal(s.charged, 410.6);
  assert.equal(s.remaining, -10.6);
  assert.equal(s.chargesExceed, true);
});

test('billing batch eligibility and release', () => {
  const mk = (id, section, code, units, date) => ({ ...charge(section, code, units, null, ctx, date), id, status: 'APPROVED' });
  const a = mk(1, 'NECRO', 'HP002001', 4, '2027-03-10');
  const april = mk(2, 'NECRO', 'HP002001', 4, '2027-04-01');
  const path = mk(3, 'PATH', 'PA001002', 10, '2027-03-12');
  const b = mk(4, 'STAIN', 'HP006017', 2, '2027-03-20');
  const batch = { id: 12, lab: 'HP', periodStart: '2027-03-01', periodEnd: '2027-03-31', status: 'OPEN' };
  assert.deepEqual([a, april, path, b].filter((l) => R.isEligible(batch, l)).map((l) => l.id), [1, 4]);
  assert.throws(() => R.releaseBatch(batch, [april]), /does not belong/);
  const released = R.releaseBatch(batch, [a, b]);
  assert.equal(released.total, 522.74);
  assert.equal(a.status, 'RELEASED');
  assert.throws(() => R.releaseBatch(released, [a]), /already/);
});

test('WSI analysis labor units', () => {
  for (const [img, u] of [[6, 4], [12, 8], [7, 5], [1, 1], [0, 0]]) assert.equal(R.laborUnits(img), u);
  for (const [img, u] of [[6, 4], [7, 8], [1, 4]]) assert.equal(R.laborUnits(img, { rounding: 'WholeBlocksRoundUp' }), u);
  assert.equal(R.laborUnits(7, { rounding: 'ProportionalExact' }), 4.67);
  const images = R.countImages([{ slides: 3 }, { slides: 2, targets: 4 }]);
  assert.equal(images, 11);
  assert.equal(R.laborUnits(images), 8);
});

test('STAT surcharge rule', () => {
  const settings = { enabled: true, code: 'HP009050', section: 'NECRO' };
  const subjects = [{ id: 1, phl: '27000001A', priority: 'S' }, { id: 2, phl: '27000002A', priority: 'R' }, { id: 3, phl: '27000003A', priority: 'S' }];
  const line = (subjectId, ruleCode = null, status = 'PENDING') => ({ subjectId, ruleCode, status });
  assert.deepEqual(R.statSurcharges({ ...settings, enabled: false }, subjects, [line(1)], '2027-03-01'), []);
  const out = R.statSurcharges(settings, subjects, [line(1), line(2)], '2027-03-01');
  assert.equal(out.length, 1);
  assert.equal(out[0].subjectId, 1);
  assert.deepEqual(R.statSurcharges(settings, subjects, [line(1), line(1, 'STAT_SURCHARGE')], '2027-03-01'), []);
  assert.deepEqual(R.statSurcharges(settings, subjects, [line(3, null, 'VOID')], '2027-03-01'), []);
});

test('Rpt080 extract', () => {
  assert.equal(R.transId('HP', 'HP270123'), 'H70123');
  assert.equal(R.transId('PA', '123'), 'P123');
  assert.equal(R.centerNo('XX1234567890ABC'), '1234567890');
  assert.equal(R.centerNo('12ABC'), 'ABC');
  assert.equal(R.centerNo('12'), '');
  const base = { lab: 'HP', project: '25X0012345.01', investigator: 'Rivera, Jordan', nas: '27-0456' };
  const recs = R.rpt080Records([
    { ...base, requestNumber: 'HP270123', code: 'HP005003', units: 10 },
    { ...base, requestNumber: 'HP270123', code: 'HP005003', units: 5 },
    { ...base, requestNumber: 'HP270123', code: 'HP002001', units: 4 },
    { lab: 'HP', project: '25X0099999.01', investigator: 'Chen, Wei', nas: null, requestNumber: 'HP270124', code: 'HP001006', units: 3 },
    { lab: 'HP', project: '25X0099999.01', investigator: 'Chen, Wei', nas: null, requestNumber: 'HP270124', code: 'HP001006', units: -3 },
  ], '2027-03-31');
  assert.equal(recs.length, 2);
  assert.deepEqual(recs[0], { transId: 'H70123', transDate: '270331', centerNo: 'X0012345.0', requestor: 'Rivera  Jordan', units: 4, code: 'HP002001', csasNo: 'CS-27-0456' });
  assert.equal(R.rpt080Write([recs[1]]), 'H70123,270331,X0012345.0,Rivera  Jordan,15,HP005003,CS-27-0456\r\n');
});

test('identifiers', () => {
  for (const t of ['27000123A', ' 27000123a ', '123456B']) assert.ok(R.parsePhl(t));
  for (const t of ['', '2700012A', '27000123', '27000123AA', '2700O123A', '270001231']) assert.equal(R.parsePhl(t), null);
  assert.deepEqual(R.formatPhlNumbers(41, 3, 'Sequential', '2027-02-01'), ['00000041A', '00000042A', '00000043A']);
  assert.deepEqual(R.formatPhlNumbers(123, 2, 'YearPrefixed', '2027-02-01'), ['27000123A', '27000124A']);
  assert.throws(() => R.formatPhlNumbers(999_999, 2, 'YearPrefixed', '2027-02-01'));
  assert.equal(R.formatRequestNumber('hp', '2027-05-01', 123), 'HP270123');
  assert.equal(R.formatRequestNumber('PA', '2027-05-01', 12345), 'PA2712345');
  assert.equal(R.slideBarcode('27000123A', 3, 2), '27000123A-B3-S02');
  assert.match(R.zplSmall('27000123A-B3-S02', '27000123A-B3-S02', 'H&E', 'Rivera'), /^\^XA.*\^BXN.*\^FD27000123A-B3-S02\^FS.*\^XZ$/);
});
