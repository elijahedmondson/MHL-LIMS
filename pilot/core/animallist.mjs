// Animal lists from investigators: a spreadsheet with one line per animal (ID, group, sex, strain, genotype, date of
// birth, cage, treatment, priority, notes) that fills in a new request's MHL numbers. Pure, shared by the browser
// (reading the file and showing what will happen) and the core (which checks the animals again when the request is
// created). Also lays out the template investigators fill in.
//
// The header row is found by its wording, anywhere in the first rows of any sheet, so a customer's own spreadsheet
// works as long as it has an animal ID column ("Animal ID", "Mouse #", "Ear tag" and so on).

export const MAX_ANIMALS = 500;
// Material whose dates of birth and great ages identify a person (HIPAA): human samples, and organoid lines made from them.
export const phiSpecies = (code) => code === 'HUMAN' || code === 'ORGANOID';

export const COLUMNS = [
  { key: 'label', title: 'Animal ID', max: 40, help: 'The animal\'s ID as on its cage card or ear tag. Needed on every line, and different on every line.', example: '1042',
    aliases: ['animal id', 'animal', 'animal no', 'animal number', 'animal #', 'mouse id', 'mouse', 'mouse no', 'mouse number', 'rat id', 'rat', 'ear tag', 'eartag', 'tag', 'tag no', 'id', 'subject', 'subject id', 'sample id', 'sample', 'case', 'case id', 'specimen id', 'animal identifier'] },
  { key: 'groupCode', title: 'Group', max: 20, help: 'The animal\'s group, such as G1 or Vehicle. The groups become the study\'s groups.', example: 'G1',
    aliases: ['group', 'group code', 'grp', 'group no', 'group number', 'cohort', 'arm', 'study group', 'treatment group', 'dose group'] },
  { key: 'sex', title: 'Sex', max: 10, help: 'F, M, or U if not known. Organ lists at necropsy follow the sex.', example: 'F',
    aliases: ['sex', 'gender', 'm f', 'f m'] },
  { key: 'strain', title: 'Strain', max: 100, help: 'Strain or stock.', example: 'C57BL/6J', aliases: ['strain', 'strain stock', 'stock', 'line', 'mouse line', 'background', 'strain background'] },
  { key: 'genotype', title: 'Genotype', max: 100, help: 'Genotype or model.', example: 'KrasG12D/+; Trp53fl/fl', aliases: ['genotype', 'geno', 'genotypes', 'allele', 'alleles', 'model'] },
  { key: 'dob', title: 'Date of birth', max: 30, help: 'Year-month-day, for example 2026-05-04. Leave blank for human samples.', example: '2026-05-04',
    aliases: ['date of birth', 'dob', 'birth date', 'birthdate', 'born', 'birthday', 'd o b'] },
  { key: 'age', title: 'Age', max: 30, help: 'If there is no date of birth, for example 12 weeks.', example: '12 weeks', aliases: ['age', 'age weeks', 'age wk', 'age wks', 'age days', 'age at necropsy'] },
  { key: 'cage', title: 'Cage', max: 30, help: 'Cage card number.', example: 'C-118', aliases: ['cage', 'cage id', 'cage card', 'cage no', 'cage number', 'cage #', 'cage card no', 'cage card number'] },
  { key: 'treatment', title: 'Treatment', max: 200, help: 'The treatment or dose of the animal\'s group.', example: 'Vehicle, daily oral gavage',
    aliases: ['treatment', 'treatments', 'dose', 'dosing', 'compound', 'test article', 'regimen', 'drug'] },
  { key: 'priority', title: 'Priority', max: 20, help: 'Routine, or STAT if MHL should do it first.', example: 'Routine', aliases: ['priority', 'stat', 'urgent', 'urgency'] },
  { key: 'notes', title: 'Notes', max: 300, help: 'Anything MHL should know about this animal.', example: 'Tumor ulcerated', aliases: ['notes', 'note', 'comments', 'comment', 'remarks', 'observations', 'other'] },
];
// Header words that can start a longer header ("Sex (M/F)", "Date of birth (yyyy-mm-dd)"); generic words such as
// "animal" or "id" match only on their own.
const PREFIXES = ['animal id', 'mouse id', 'ear tag', 'group', 'sex', 'gender', 'strain', 'genotype', 'date of birth', 'dob', 'birth date', 'age', 'cage', 'treatment', 'priority', 'notes', 'comments'];
// IDs that could head any table (an instrument export has "Sample ID"): enough for a header only beside another column.
const GENERIC_ID = ['id', 'sample', 'sample id', 'subject', 'subject id', 'case', 'case id', 'specimen id', 'tag', 'tag no'];

export const normHeader = (v) => String(v ?? '').toLowerCase().replace(/#/g, ' # ').replace(/[^a-z0-9#]+/g, ' ').replace(/\s+/g, ' ').trim().replace(/ #$/, '').trim();
// The column a heading names, and how sure that is: an exact alias early in its list beats a later one, and any exact
// alias beats a heading that only starts with one ("Group description" loses to "Group").
export function headerMatch(v) {
  const h = normHeader(v);
  if (!h) return null;
  const tries = [h, h.endsWith('s') ? h.slice(0, -1) : null].filter(Boolean);
  for (const t of tries) for (const c of COLUMNS) { const i = c.aliases.indexOf(t); if (i >= 0) return { key: c.key, rank: 1000 - i - (t === h ? 0 : 1), generic: c.key === 'label' && GENERIC_ID.includes(t) }; }
  for (const p of PREFIXES) if (h.startsWith(`${p} `)) return { key: COLUMNS.find((c) => c.aliases.includes(p)).key, rank: 100, generic: false };
  return null;
}
export const matchHeader = (v) => headerMatch(v)?.key || null;

// The header row: the row in the first 25 that names the most columns, and names the animal ID (with a generic ID
// heading, at least one more column too).
export function findHeader(grid) {
  let best = null;
  for (let r = 0; r < Math.min(25, grid.length); r++) {
    const pick = {}; const unknown = [];
    (grid[r] || []).forEach((cell, c) => {
      const m = headerMatch(cell);
      if (!m) { if (String(cell ?? '').trim()) unknown.push(String(cell).trim()); return; }
      const had = pick[m.key];
      if (!had || m.rank > had.rank) { if (had) unknown.push(had.header); pick[m.key] = { ...m, col: c, header: String(cell).trim() }; } else unknown.push(String(cell).trim());
    });
    if (!pick.label) continue;
    const score = Object.keys(pick).length;
    if (pick.label.generic && score < 2) continue;
    if (!best || score > best.score) {
      best = { row: r, map: Object.fromEntries(Object.entries(pick).map(([k, v]) => [k, v.col])), headers: Object.fromEntries(Object.entries(pick).map(([k, v]) => [k, v.header])), unknown, score };
    }
  }
  return best;
}

// The sheets that hold an animal list, best first: hidden sheets are left out, and on a tie the first tab wins.
export function sheetCandidates(sheets) {
  return sheets.map((s, i) => ({ sheet: s, header: s.hidden ? null : findHeader(s.grid), i })).filter((x) => x.header)
    .sort((a, b) => b.header.score - a.header.score || a.i - b.i).map(({ sheet, header }) => ({ sheet, header }));
}
export const pickSheet = (sheets) => sheetCandidates(sheets)[0] || null;

// ---------- values ----------
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y, m, d) => {
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d ? t.toISOString().slice(0, 10) : null;
};
const fullYear = (y, today) => (y >= 100 ? y : y + (2000 + y <= Number(today.slice(0, 4)) ? 2000 : 1900));

// A date as typed or as Excel stores it (a day number). US month/day order unless the first number is over 12.
// order: 'MDY' or 'DMY' for numbers like 5/4/2026, decided for the whole column (see dateOrder); otherwise month
// first unless the first number is over 12. date1904: the workbook counts days from 1904 (old Mac Excel).
export function parseDate(v, today, { order = null, date1904 = false } = {}) {
  const s = String(v ?? '').trim().replace(/[ T]\d{1,2}:\d{2}(:\d{2}(\.\d+)?)?(\s?[AP]M)?$/i, '');
  if (!s) return { value: '' };
  let m;
  if (/^\d+(\.\d+)?$/.test(s)) {
    const n = Math.floor(Number(s)) + (date1904 ? 1462 : 0);
    if (n >= 61 && n < 2958466) return { value: new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10), excel: true };
    return { error: `${s} is not a date.` };
  }
  let out = null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/))) out = iso(+m[1], +m[2], +m[3]);
  else if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/))) {
    const a = +m[1], b = +m[2], y = fullYear(+m[3], today);
    out = (order ? order === 'DMY' : a > 12) ? iso(y, b, a) : iso(y, a, b);
  } else if ((m = s.match(/^(\d{1,2})[ -]([A-Za-z]{3,9})\.?[ ,-]*(\d{2}|\d{4})$/))) {
    const mo = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase()) + 1;
    out = mo ? iso(fullYear(+m[3], today), mo, +m[1]) : null;
  } else if ((m = s.match(/^([A-Za-z]{3,9})\.? (\d{1,2}),? (\d{4})$/))) {
    const mo = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
    out = mo ? iso(+m[3], mo, +m[2]) : null;
  }
  return out ? { value: out } : { error: `“${s}” is not a date MHL can read; use year-month-day, for example 2026-05-04.` };
}

// Day first or month first, for a column of dates like 5/4/2026: day first if any first number is over 12, month first
// if any second number is; both means the column mixes them.
export function dateOrder(values) {
  let dmy = false; let mdy = false;
  for (const v of values) {
    const m = String(v ?? '').trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
    if (!m || (+m[1] > 12 && +m[2] > 12)) continue;   // not a date either way: reported on its own line
    if (+m[1] > 12) dmy = true;
    if (+m[2] > 12) mdy = true;
  }
  return dmy && mdy ? 'MIXED' : dmy ? 'DMY' : 'MDY';
}

export function parseSex(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return { value: '' };
  if (['f', 'female', 'fem', '♀'].includes(s)) return { value: 'F' };
  if (['m', 'male', '♂'].includes(s)) return { value: 'M' };
  if (['u', 'unknown', 'unk', '?', 'n/a', 'na', 'nd', 'not known'].includes(s)) return { value: 'U' };
  return { error: `Sex “${String(v).trim()}” should be F, M or U.` };
}

export function parsePriority(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s || ['r', 'routine', 'normal', 'standard', 'no', 'n', 'false', '0'].includes(s)) return { value: '' };
  if (['s', 'stat', 'urgent', 'yes', 'y', 'true', '1', 'asap'].includes(s)) return { value: 'S' };
  if (['p', 'priority', 'high'].includes(s)) return { value: 'P' };
  return { warning: `Priority “${String(v).trim()}” was not understood; it is treated as routine.`, value: '' };
}

// One animal, checked. phi: human material, where a date of birth is not kept. Used for the spreadsheet's lines and
// again by the core for what the browser sends.
export function normalizeAnimal(raw, { phi = false, today, order = null, date1904 = false }) {
  const problems = []; const warnings = [];
  const txt = (k) => String(raw[k] ?? '').replace(/[\r\n\t]+/g, ' ').trim();
  const a = {};
  for (const c of COLUMNS) {
    a[c.key] = txt(c.key);
    if (a[c.key].length > c.max) problems.push(`${c.title} is longer than ${c.max} characters.`);
  }
  a.label = a.label.replace(/^(\d+)\.0+$/, '$1');   // an ID typed as a number and saved as 1042.0
  if (!a.label) problems.push('There is no animal ID.');
  // A value that cannot be read stays as typed, so it shows next to its problem (and the problem stops the list being used).
  const sex = parseSex(a.sex); if (sex.error) problems.push(sex.error); else a.sex = sex.value;
  const pr = parsePriority(a.priority); if (pr.warning) warnings.push(pr.warning); a.priority = pr.value;
  if (a.dob) {
    if (phi) { warnings.push('Dates of birth are not kept for human samples or organoid lines; they were left out.'); a.dob = ''; }
    else {
      const d = parseDate(a.dob, today, { order, date1904 });
      const oldest = `${Number(today.slice(0, 4)) - 30}${today.slice(4)}`;
      if (d.error) problems.push(d.error);
      else if (d.value > today) problems.push(`The date of birth ${d.value} is in the future.`);
      else if (d.value < oldest) problems.push(`The date of birth reads as ${d.value}, more than 30 years ago. Check the column: a year or an ID in it reads as a date.`);
      if (d.value) a.dob = d.value;
    }
  }
  // An age over 89 identifies a person; it is kept as "90 or older".
  if (phi && a.age && /\d/.test(a.age) && Number((a.age.match(/\d+(\.\d+)?/) || [])[0]) > 89 && !/(week|wk|day|month|mo)/i.test(a.age)) {
    a.age = '90 or older'; warnings.push('Ages over 89 are kept as "90 or older".');
  }
  return { animal: a, problems, warnings };
}

// ---------- the whole list ----------
// grid: the sheet's rows (strings). opts: species code, phi, groups (codes of an existing study), expected (MHL numbers
// on the NAS request), today, necropsy (the request includes necropsy, where sex decides the organ list).
// groups: the existing study's groups, as codes or { code, sex }. study: false when the request has no study (groups are
// then only noted on each animal). date1904: from the workbook.
export function parseAnimalList(grid, { phi = false, groups = null, study = true, expected = null, today, necropsy = false, header = null, date1904 = false } = {}) {
  const h = header || findHeader(grid);
  const problems = []; const warnings = []; const animals = [];
  if (!h) return { header: null, columns: [], used: [], ignored: [], animals, problems: [`No header row with an animal ID column was found. The template's headings are: ${COLUMNS.map((c) => c.title).join(', ')}.`], warnings, summary: summarize([]) };
  const cell = (r, k) => (h.map[k] != null ? String((grid[r] || [])[h.map[k]] ?? '').trim() : '');
  const blank = (r) => !Object.keys(h.map).some((k) => cell(r, k));
  // The list ends at the first empty line after it, or at a totals line; anything further down is said, not read.
  let end = grid.length; let stoppedAt = null;
  for (let r = h.row + 1; r < grid.length; r++) {
    if (blank(r)) { if (animals.length) { end = r; break; } continue; }
    if (/^(total|totals|sum|count|mean|average|n)\b[\s:=]*\d*\s*$/i.test(cell(r, 'label')) || /^(submitted|signed|prepared|approved) by\b/i.test(cell(r, 'label'))) { end = r; stoppedAt = r; break; }
    if (animals.length > MAX_ANIMALS) { end = r; break; }
    animals.push({ row: r + 1 });
  }
  const below = [];
  for (let r = end; r < grid.length; r++) if (!blank(r)) below.push(r + 1);
  if (below.length) warnings.push(`Line${below.length === 1 ? '' : 's'} ${below.length === 1 ? below[0] : `${below[0]} to ${below.at(-1)}`}, below ${stoppedAt ? 'a totals or signature line' : 'an empty line'}, ${below.length === 1 ? 'was' : 'were'} not read. If ${below.length === 1 ? 'it is an animal' : 'they are animals'}, ${stoppedAt ? 'move them above it' : 'remove the empty line'} and read the file again.`);
  const order = h.map.dob != null ? dateOrder(animals.map((a) => cell(a.row - 1, 'dob'))) : 'MDY';
  if (order === 'MIXED') problems.push('The dates of birth mix day-first and month-first (some read as 16/7, others as 7/16). Write them as year-month-day, for example 2026-05-04.');
  for (const a of animals) {
    const raw = Object.fromEntries(Object.keys(h.map).map((k) => [k, cell(a.row - 1, k)]));
    const { animal, problems: p, warnings: w } = normalizeAnimal(raw, { phi, today, order: order === 'MIXED' ? null : order, date1904 });
    Object.assign(a, animal, { problems: p, warnings: w });
  }
  if (!animals.length) problems.push('The sheet has a header row but no animals under it.');
  if (animals.length > MAX_ANIMALS) problems.push(`A request can have at most ${MAX_ANIMALS} MHL numbers; the list has more than that.`);
  // The same ID twice.
  const seen = new Map();
  for (const a of animals) {
    if (!a.label) continue;
    const k = a.label.toLowerCase();
    if (seen.has(k)) a.problems.push(`Animal ID ${a.label} is also on line ${seen.get(k)}.`); else seen.set(k, a.row);
  }
  // Groups: use an existing study's spelling of a code; note codes the study does not have yet.
  if (groups) {
    const list = groups.map((g) => (typeof g === 'string' ? { code: g, sex: '' } : g));
    const known = new Map(list.map((g) => [g.code.toLowerCase(), g]));
    const added = new Set(); const clash = [];
    for (const a of animals) {
      if (!a.groupCode) continue;
      const k = known.get(a.groupCode.toLowerCase());
      if (!k) { added.add(a.groupCode); continue; }
      a.groupCode = k.code;
      if (k.sex && ['F', 'M'].includes(k.sex) && ['F', 'M'].includes(a.sex) && a.sex !== k.sex) clash.push(`line ${a.row} (${a.label}) is ${a.sex === 'F' ? 'female' : 'male'} in ${k.code}, a ${k.sex === 'F' ? 'female' : 'male'} group`);
    }
    if (added.size) warnings.push(`Group${added.size === 1 ? '' : 's'} ${[...added].join(', ')} ${added.size === 1 ? 'is' : 'are'} not in the study yet and will be added to it.`);
    if (clash.length) warnings.push(`Check the sex: ${clash.slice(0, 5).join('; ')}${clash.length > 5 ? `; and ${clash.length - 5} more` : ''}.`);
  }
  if (!study && animals.some((a) => a.groupCode)) warnings.push('There is no study, so the groups are only noted on each animal. Choose New study or Existing study to keep them as study groups.');
  const s = summarize(animals);
  if (expected != null && animals.length && animals.length !== expected) warnings.push(`The NAS request is for ${expected} MHL number${expected === 1 ? '' : 's'}; the list has ${animals.length} animals, so the request will have ${animals.length}.`);
  if (phi && animals.some((a) => a.notes)) warnings.push('Human-derived material: check that the notes hold no names, record numbers or dates.');
  if (necropsy && s.noSex) warnings.push(`${s.noSex} animal${s.noSex === 1 ? ' has' : 's have'} no sex given, so ${s.noSex === 1 ? 'its' : 'their'} necropsy organ list will not be sex-specific.`);
  for (const g of s.groups) if (g.treatments.length > 1) warnings.push(`Group ${g.code} lists ${g.treatments.length} treatments (${g.treatments.join('; ')}); the study keeps the first, and each animal's own treatment goes in its notes.`);
  if (animals.some((a) => !a.groupCode) && animals.some((a) => a.groupCode)) warnings.push('Some animals have no group.');
  const rowWarnings = [...new Set(animals.flatMap((a) => a.warnings))];
  warnings.push(...rowWarnings);
  for (const a of animals) for (const p of a.problems) problems.push(`Line ${a.row}: ${p}`);
  const ignored = h.unknown.filter((u) => !/^\s*$/.test(u));
  if (ignored.length) warnings.push(`Not read: the column${ignored.length === 1 ? '' : 's'} ${ignored.map((u) => `“${u}”`).join(', ')}.`);
  const used = COLUMNS.filter((c) => h.map[c.key] != null).map((c) => ({ key: c.key, title: c.title, header: h.headers?.[c.key] || c.title }));
  return { header: { row: h.row + 1, columns: Object.keys(h.map) }, columns: used.map((u) => u.key), used, ignored, animals, problems, warnings, summary: s };
}

function summarize(animals) {
  const groups = new Map();
  for (const a of animals) {
    const k = a.groupCode || '';
    if (!groups.has(k)) groups.set(k, { code: k, n: 0, female: 0, male: 0, treatments: [] });
    const g = groups.get(k); g.n++;
    if (a.sex === 'F') g.female++; if (a.sex === 'M') g.male++;
    if (a.treatment && !g.treatments.includes(a.treatment)) g.treatments.push(a.treatment);
  }
  return { count: animals.length, female: animals.filter((a) => a.sex === 'F').length, male: animals.filter((a) => a.sex === 'M').length,
    noSex: animals.filter((a) => !a.problems?.length && (!a.sex || a.sex === 'U')).length, stat: animals.filter((a) => a.priority === 'S').length,
    groups: [...groups.values()].filter((g) => g.code) };
}

// What the browser sends for each animal.
export const forRequest = (animals) => animals.map(({ row, problems, warnings, ...a }) => a);

// The study groups a list implies: one per code, its sex if every animal shares it, and the first treatment given.
export function groupsFromAnimals(animals) {
  return summarize(animals).groups.map((g) => ({ code: g.code, name: '', sex: g.female && !g.male ? 'F' : g.male && !g.female ? 'M' : '', genotype: '', treatment: g.treatments[0] || '' }));
}

// ---------- the template ----------
// The sheets for xlsxwrite.writeXlsx: the list itself (request details at the top, the header row, drop-downs) and
// the instructions. phi leaves out the date of birth.
export function templateSheets({ investigator = '', nasNumber = '', study = '', speciesName = '', expected = null, groups = [], phi = false }) {
  const cols = COLUMNS.filter((c) => !(phi && c.key === 'dob'));
  const HEADER_ROW = 6;   // zero-based: the seventh row
  const lastRow = HEADER_ROW + Math.max(expected || 0, 50) + 50;
  const at = (key) => cols.findIndex((c) => c.key === key);
  const letter = (i) => String.fromCharCode(65 + i);
  const range = (key) => `${letter(at(key))}${HEADER_ROW + 2}:${letter(at(key))}${lastRow + 1}`;
  const animals = {
    name: 'Animals',
    rows: [
      [{ v: 'MHL animal list', style: 'title' }],
      [{ v: 'Investigator', style: 'label' }, investigator, '', { v: 'NAS#', style: 'label' }, nasNumber],
      [{ v: 'Study or ZAP#', style: 'label' }, study, '', { v: 'Species', style: 'label' }, speciesName],
      [{ v: 'Animals expected', style: 'label' }, expected ?? ''],
      [{ v: `One line per animal, starting on line ${HEADER_ROW + 2}. Animal ID is needed on every line; Sex decides the necropsy organ list. See the Instructions sheet.${phi ? ' Human samples: coded IDs only, with no names, record numbers or dates.' : ''}`, style: 'note' }],
      [],
      cols.map((c) => ({ v: c.title, style: 'header' })),
    ],
    cols: cols.map((c) => ({ label: 14, groupCode: 10, sex: 7, strain: 18, genotype: 24, dob: 14, age: 10, cage: 10, treatment: 28, priority: 10, notes: 34 }[c.key])),
    freezeRows: HEADER_ROW + 1,
    merges: [`A5:${letter(cols.length - 1)}5`],
    validations: [
      { sqref: range('sex'), list: ['F', 'M', 'U'], title: 'Sex', prompt: 'F, M, or U if not known' },
      { sqref: range('priority'), list: ['Routine', 'STAT'], title: 'Priority', prompt: 'Routine or STAT' },
      // Excel's list drop-down cannot hold a comma or quote inside an item.
      ...(groups.length && groups.join(',').length < 250 && !groups.some((g) => /[,"]/.test(g)) ? [{ sqref: range('groupCode'), list: groups, title: 'Group', prompt: 'A group of the study' }] : []),
    ],
    // IDs and cage numbers as text, so 0042 stays 0042; dates in year-month-day.
    styledColumns: [...(at('dob') >= 0 ? [{ col: at('dob'), fromRow: HEADER_ROW + 1, toRow: lastRow, style: 'date' }] : []),
      { col: at('label'), fromRow: HEADER_ROW + 1, toRow: lastRow, style: 'text' }, { col: at('cage'), fromRow: HEADER_ROW + 1, toRow: lastRow, style: 'text' }],
  };
  const instructions = {
    name: 'Instructions',
    rows: [
      [{ v: 'How to fill in the animal list', style: 'title' }],
      [{ v: 'Fill in the Animals sheet, one line per animal, and send it back with the NAS request number. MHL reads it into the LIMS: each line becomes an MHL number, in the order of the lines.', style: 'note' }],
      [],
      [{ v: 'Column', style: 'header' }, { v: 'What to enter', style: 'header' }, { v: 'Example', style: 'header' }],
      ...cols.map((c) => [{ v: c.title, style: 'bold' }, c.help, c.example]),
      [],
      [{ v: 'Other columns are fine: MHL reads the ones above and lists any it does not use. Headings can be worded differently (Mouse ID, Gender, DOB, Cage #, Comments).', style: 'note' }],
      ...(phi ? [[{ v: 'Human samples: use coded IDs only. Do not include names, medical record numbers, dates of birth or any other identifier.', style: 'note' }]] : []),
    ],
    cols: [16, 70, 26],
  };
  return [animals, instructions];
}
