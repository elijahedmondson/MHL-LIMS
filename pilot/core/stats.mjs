// Descriptive statistics for study summaries (organ weights, clinical pathology).
// Pure functions: used by the server and by the standalone browser build.

const T975 = [null, 12.706, 4.303, 3.182, 2.776, 2.571, 2.447, 2.365, 2.306, 2.262, 2.228, 2.201, 2.179, 2.16, 2.145, 2.131,
  2.12, 2.11, 2.101, 2.093, 2.086, 2.08, 2.074, 2.069, 2.064, 2.06, 2.056, 2.052, 2.048, 2.045, 2.042];

// Two-sided 95% critical value of Student's t for the given degrees of freedom.
export function tCritical95(df) {
  if (df < 1) return null;
  if (df <= 30) return T975[df];
  if (df <= 40) return 2.021;
  if (df <= 60) return 2.0;
  if (df <= 120) return 1.98;
  return 1.96;
}

// n, mean, SD and 95% confidence interval of the mean. Ignores null/NaN values.
export function describe(values) {
  const xs = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  const n = xs.length;
  if (n === 0) return { n: 0, mean: null, sd: null, ciLow: null, ciHigh: null };
  const mean = xs.reduce((a, b) => a + b, 0) / n;
  if (n === 1) return { n, mean, sd: null, ciLow: null, ciHigh: null };
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1));
  const half = tCritical95(n - 1) * (sd / Math.sqrt(n));
  return { n, mean, sd, ciLow: mean - half, ciHigh: mean + half };
}

// Rounds for display without trailing noise (e.g. 0.12345 -> 0.1235 with 4 significant digits).
export function sig(value, digits = 4) {
  if (value == null || !Number.isFinite(value)) return null;
  if (value === 0) return 0;
  return Number(value.toPrecision(digits));
}

// Two-sided Fisher's exact test for the 2x2 table [[a, b], [c, d]] (for incidence: affected and unaffected animals in a
// group, then in the reference group). The p value is the total probability, with the margins fixed, of the tables no
// more likely than the one observed. Returns null if a row or column is empty.
export function fisherExact(a, b, c, d) {
  const cells = [a, b, c, d];
  if (cells.some((x) => !Number.isInteger(x) || x < 0)) return null;
  const n = a + b + c + d;
  const row1 = a + b; const col1 = a + c;
  if (!row1 || !col1 || row1 === n || col1 === n) return null;
  const lf = [0];
  for (let i = 1; i <= n; i++) lf[i] = lf[i - 1] + Math.log(i);
  const logP = (x) => lf[row1] + lf[n - row1] + lf[col1] + lf[n - col1] - lf[n] - lf[x] - lf[row1 - x] - lf[col1 - x] - lf[n - row1 - col1 + x];
  const observed = logP(a);
  let p = 0;
  for (let x = Math.max(0, row1 + col1 - n); x <= Math.min(row1, col1); x++) {
    const lp = logP(x);
    if (lp <= observed + 1e-7) p += Math.exp(lp);
  }
  return Math.min(1, Math.round(p * 1e12) / 1e12);   // rounding noise from adding the terms
}
