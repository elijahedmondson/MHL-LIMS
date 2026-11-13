// Necropsy rules for the pilot: what must be recorded before a necropsy is approved, and the charges approval creates.
// Ported to MhlLims.Domain.Necropsy.NecropsyRules; tools/rules-reference/make_golden.mjs checks the two agree.

import { NECROPSY_EXTRAS, PERFUSION_CODES } from './defs.mjs';

// n: the necropsy (bodyWeight, fate, partial, matchesCageCard, organs[{organ, weigh, weight, notCollected, findings[{morphology}]}])
// protocol: { bodyWeight } (whether the protocol weighs the animal)
export function approvalProblems(n, protocol) {
  const problems = [];
  if (!n.partial && protocol.bodyWeight && !(n.bodyWeight > 0) && n.fate !== 'Found dead') problems.push('enter the body weight');
  const missing = n.organs.filter((o) => o.weigh && !o.notCollected && !(o.weight > 0)).map((o) => o.organ);
  if (!n.partial && missing.length) problems.push(`weigh ${missing.join(', ')} (or mark not collected)`);
  const incomplete = n.organs.filter((o) => o.findings.some((f) => !f.morphology)).map((o) => o.organ);
  if (incomplete.length) problems.push(`choose a morphology for each finding in ${incomplete.join(', ')}`);
  if (!n.matchesCageCard) problems.push('confirm the animal matches its cage card');
  return problems;
}

// The work drives billing: the necropsy and each ticked procedure become charges in the NECRO section.
export function approvalCharges(n) {
  const charges = [{ section: 'NECRO', code: n.partial ? 'HP002022' : 'HP002001', units: 1 }];
  if (n.perfusion) charges.push({ section: 'NECRO', code: PERFUSION_CODES[n.perfusion], units: 1 });
  for (const e of NECROPSY_EXTRAS) {
    const v = n.extras?.[e.key];
    if (e.kind === 'check' && v) charges.push({ section: 'NECRO', code: e.code, units: 1 });
    if (e.kind === 'count' && v > 0) charges.push({ section: 'NECRO', code: e.code, units: v });
  }
  return charges;
}
