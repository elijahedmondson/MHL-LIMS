// IHC rules for the pilot: reading the IHC department's assay database export, classifying assays,
// matching them to a sample's species and fixative, and turning an IHC request into estimate lines.
//
// Used by the catalog converter (tools/ihc-import), the pilot core, and the browser (/lib/ihc.mjs).
// When IHC moves into the production system (roadmap Phase 4) these rules go into MhlLims.Domain.

// ---------- reading the export ----------

// RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes.
export function parseCsv(text) {
  const rows = []; let row = []; let field = ''; let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

// Excel reads "1:100" as a time of day (1 hour + 100 minutes) and stores 0.111111111.
// Reverse it: a dilution 1:N was stored as (1 + N/60) / 24.
export function decodeExcelDilution(raw) {
  const v = String(raw ?? '').trim();
  if (!/^\d+(\.\d+)?$/.test(v)) return { value: v, recovered: false };
  const n = (Number(v) * 24 - 1) * 60;
  const rounded = Math.round(n);
  if (rounded > 0 && Math.abs(n - rounded) < 0.01) return { value: `1:${rounded}`, recovered: true, stored: v };
  return { value: v, recovered: false };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Excel turns names such as "Oct-4" into dates and writes them back as "4-Oct".
export function fixExcelDateName(raw) {
  const v = String(raw ?? '').trim();
  const m = v.match(/^(\d{1,2})-([A-Z][a-z]{2})$/);
  if (m && MONTHS.includes(m[2])) return { value: `${m[2]}-${m[1]}`, recovered: true, stored: v };
  return { value: v, recovered: false };
}

// ---------- vocabularies ----------

export const SPECIES_TAGS = ['Mouse', 'Human', 'Human xenograft', 'Humanized mouse', 'Rat', 'Canine', 'Rhesus macaque', 'Marmoset', 'Porcine', 'Woodchuck', 'Zebrafish'];

// "Human, Hu Xg in Mice" -> ['Human', 'Human xenograft']. Unrecognized text is kept in `other`.
export function speciesTags(raw) {
  const tags = new Set(); const other = [];
  for (const part of String(raw ?? '').split(/[,;/]/).map((p) => p.trim().toLowerCase()).filter(Boolean)) {
    if (/\b(xg|xenografts?|pdx)\b|human in mouse|hu in mouse|hu cell line in mouse|human in mice|in mice\b/.test(part) && !/rabbit|pig/.test(part)) tags.add('Human xenograft');
    else if (/humanized/.test(part)) tags.add('Humanized mouse');
    else if (/\b(human|hu)\b/.test(part) && !/\bin\b/.test(part)) tags.add('Human');
    else if (/\b(mouse|mice|ms)\b/.test(part)) tags.add('Mouse');
    else if (/\brats?\b/.test(part)) tags.add('Rat');
    else if (/canine|\bdog\b/.test(part)) tags.add('Canine');
    else if (/rhesus|macaque/.test(part)) tags.add('Rhesus macaque');
    else if (/marmoset/.test(part)) tags.add('Marmoset');
    else if (/porcine|\bpig\b/.test(part) && !/\bin\b/.test(part)) tags.add('Porcine');
    else if (/woodchuck/.test(part)) tags.add('Woodchuck');
    else if (/zebrafish/.test(part)) tags.add('Zebrafish');
    else other.push(part);
  }
  return { tags: SPECIES_TAGS.filter((t) => tags.has(t)), other };
}

export const FIXATIVE_TAGS = ['NBF', 'PFA', 'Frozen', 'Zinc formalin', 'Ethanol', 'Methanol', "Bouin's", "Carnoy's", 'Methacarn', "Telly's", "Davidson's"];

// "FRESH/ FROZEN/ ACETONE" -> ['Frozen'] (acetone fixes the cut sections, not the tissue).
// "4% PFA to Sucrose to OCT" -> ['PFA', 'Frozen'].
export function fixativeTags(raw) {
  const s = String(raw ?? '').toLowerCase();
  const tags = new Set();
  const frozenFirst = /^\s*(fresh|frozen)/.test(s);
  if (/fresh|frozen|\boct\b|acetone/.test(s)) tags.add('Frozen');
  if (!frozenFirst) {
    if (/zinc/.test(s)) tags.add('Zinc formalin');
    else if (/nbf|formalin/.test(s)) tags.add('NBF');
    if (/pfa|paraformaldehyde/.test(s) && !/^oct/.test(s)) tags.add('PFA');
    if (/etoh|(^|[^m])ethanol/.test(s)) tags.add('Ethanol');
    if (/methanol/.test(s)) tags.add('Methanol');
    if (/methacarn/.test(s)) tags.add('Methacarn');
    if (/bouin/.test(s)) tags.add("Bouin's");
    if (/carnoy/.test(s)) tags.add("Carnoy's");
    if (/telly/.test(s)) tags.add("Telly's");
    if (/davidson/.test(s)) tags.add("Davidson's");
  }
  return FIXATIVE_TAGS.filter((t) => tags.has(t));
}

// Fluorescent detection: named dyes, or a fluorophore wavelength after a dye family ("AF 594", "CF647") or after an
// anti-something secondary ("anti-HRP 594", "goat anti-rabbit 488", "anti-DIG 647").
const FLUOR = /alexa|fitc|\bcy[235]\b|texas red|dylight|\bpe\b|rhodamine|tritc|red 549|\bsa-af\d|\b(?:af|cf|atto|ifluor)\s?-?\s?(?:350|405|430|488|514|532|546|555|568|594|610|633|647|660|680|700|750|790)\b|\banti-?\s?[a-z0-9]+[\s-](?:405|488|546|555|568|594|633|647|660|680|750)\b/i;
// An overnight primary incubation ("1:2000 ONRT", "ON 4C", "o/n") is done by hand: the stainers do not run overnight,
// so a protocol that borrows BOND or Ventana reagents for it is still a manual stain.
const OVERNIGHT = (dilution) => /\b(?:o\/n|onrt|on\s?rt|overnight)\b/i.test(dilution) || /\bON(?:\b|\d)/.test(dilution);   // "ON", "ON 4C", "ON4C"
export const isOvernight = (dilution) => OVERNIGHT(String(dilution || ''));

// What kind of assay a protocol is, and how it is detected. Platform and chromogen are a best guess from the text;
// the IHC team can set them by hand (see deriveAssay).
export function classify({ name = '', kit = '', dilution: dil = '' }) {
  // Non-breaking spaces (pasted from Word or a web page) count as spaces, here and in the C# port.
  const sp = (v) => String(v ?? '').replace(/\u00a0/g, ' ');
  const n = sp(name); const k = sp(kit); const dilution = sp(dil);
  // Opal fluorophores are written "OPAL 520", "OPAL520" or "OPALs 690, 520, 570"; count the distinct ones.
  const opal = /opal/i.test(k) ? new Set(k.match(/\b(480|520|540|570|620|650|690|780)\b/g) || []).size || 1 : 0;
  const namePlex = /^duplex\b/i.test(n) ? 2 : /^triplex\b/i.test(n) ? 3 : Number(n.match(/^(\d)-plex/i)?.[1] || 0);
  const byHand = isOvernight(dilution) || /\bmanual\b/i.test(k);
  const platform = byHand ? 'Manual' : /bond/i.test(k) ? 'Leica Bond' : /ventana|ultraview|optiview/i.test(k) ? 'Ventana' : 'Manual';
  // A 4- to 6-plex panel is always fluorescent here, even when the kit column does not say so.
  if (namePlex >= 4 && !opal) return { kind: 'Opal', plex: namePlex, chromogen: 'Opal', platform: platform === 'Ventana' ? 'Manual' : platform };
  const fluor = FLUOR.test(k) || FLUOR.test(n);
  // A TUNEL assay may be named for its target and only name the kit ("ApopTag kit anti-DIG 647").
  if (/tunel|apoptag/i.test(n) || /tunel|apoptag/i.test(k)) return { kind: 'TUNEL', plex: 1, chromogen: fluor ? 'Fluorescent' : 'DAB', platform };
  if (/β-gal|b-gal|x-gal|beta-gal/i.test(n)) return { kind: 'β-gal', plex: 1, chromogen: 'X-gal', platform };
  if (namePlex >= 2 || opal >= 2) {
    const plex = Math.max(namePlex, opal);
    if (opal >= 1) return { kind: 'Opal', plex, chromogen: 'Opal', platform };
    if (fluor) return { kind: 'IF', plex, chromogen: 'Fluorescent', platform };
    return { kind: 'IHC', plex, chromogen: /red/i.test(k) ? 'DAB + Red' : 'DAB', platform };
  }
  if (opal === 1) return { kind: 'Opal', plex: 1, chromogen: 'Opal', platform };
  if (fluor) return { kind: 'IF', plex: 1, chromogen: 'Fluorescent', platform };
  return { kind: 'IHC', plex: 1, chromogen: /refine red|fast red|permanent red|vector red/i.test(k) ? 'Red' : 'DAB', platform };
}

export const kindLabel = (a) => (a.kind === 'Opal' ? (a.plex > 1 ? `Opal ${a.plex}-plex` : 'Opal (1 marker)')
  : a.kind === 'IF' ? (a.plex > 1 ? `IF ${a.plex}-plex` : 'Immunofluorescence')
    : a.kind === 'IHC' ? (a.plex > 1 ? `IHC ${a.plex}-plex` : 'IHC')
      : a.kind === 'TUNEL' && a.chromogen === 'Fluorescent' ? 'TUNEL (fluorescent)' : a.kind);
// A fluorescent TUNEL counts too: it is scanned on the Akoya system and has no chromogen to choose.
export const isFluorescent = (a) => a.kind === 'Opal' || a.kind === 'IF' || a.chromogen === 'Fluorescent';

// Fields people edit; everything else on an assay is derived from them.
export const ASSAY_FIELDS = [
  ['name', 'Antibody'], ['dilution', 'Dilution and time'], ['retrieval', 'Antigen retrieval'], ['digestion', 'Proteolytic digestion'],
  ['kit', 'Secondary antibody / detection kit'], ['fixative', 'Fixative'], ['species', 'Species'], ['control', 'Control tissue'],
  ['manufacturer', 'Manufacturer'], ['catalog', 'Catalog number'],
];

// Fields added in the LIMS (the IHC database export has no columns for them). The IHC team fills them in on the
// assay form; each is a drop-down list except the clone. An empty value means "not recorded".
export const PLATFORMS = ['Manual', 'Leica Bond', 'Ventana'];
export const CHROMOGENS = ['DAB', 'Red', 'DAB + Red', 'Fluorescent', 'X-gal'];
export const HOSTS_LIST = ['Rabbit', 'Mouse', 'Rat', 'Goat', 'Sheep', 'Donkey', 'Chicken', 'Guinea pig', 'Hamster', 'Human', 'Not applicable'];
export const CLONALITIES = ['Monoclonal', 'Polyclonal', 'Not applicable'];
export const VISIBILITY = [['Public', 'Public: investigators can request it'], ['Internal', 'Not public: MHL staff only']];
export const RESULTS = [['', 'Not recorded'], ['Works', 'Works'], ['Optimizing', 'Being optimized'], ['Failed', 'Did not work']];
export const resultLabel = (r) => RESULTS.find(([k]) => k === r)?.[1] || 'Not recorded';
export const EXTRA_FIELDS = [
  ['clone', 'Antibody clone'], ['host', 'Antibody host'], ['clonality', 'Clonality'], ['platformSet', 'Platform'], ['chromogenSet', 'Chromogen'],
  ['visibility', 'Public'], ['preferred', 'Preferred'], ['result', 'Result'],
];

// Platform and chromogen set by hand win over the guess from the text. Choosing Fluorescent for an IHC protocol makes
// it immunofluorescence (and the reverse), which changes how it is priced and scanned.
export function applyDetection(c, { platformSet = '', chromogenSet = '' } = {}) {
  const out = { ...c, platformAuto: c.platform, chromogenAuto: c.chromogen };
  if (PLATFORMS.includes(platformSet)) out.platform = platformSet;
  if (CHROMOGENS.includes(chromogenSet)) {
    if (out.kind === 'Opal') { if (chromogenSet !== 'Fluorescent') { out.kind = 'IHC'; out.chromogen = chromogenSet; } }
    else {
      out.chromogen = chromogenSet;
      if (chromogenSet === 'Fluorescent' && out.kind === 'IHC') out.kind = 'IF';
      else if (chromogenSet !== 'Fluorescent' && out.kind === 'IF') out.kind = 'IHC';
    }
  }
  return out;
}

export function deriveAssay(fields) {
  const sp = speciesTags(fields.species);
  const d = applyDetection(classify(fields), fields);
  delete d.platformAuto; delete d.chromogenAuto;
  return { ...d, speciesTags: sp.tags, speciesOther: sp.other, fixTags: fixativeTags(fields.fixative) };
}

export const FLAG_TEXT = {
  'dilution-recovered': 'Excel had stored this dilution as a time of day. It was converted back; please confirm it against the protocol.',
  'name-recovered': 'Excel had turned this antibody name into a date. It was restored; please confirm.',
  duplicate: 'An exact copy of another entry. Hidden from the request form.',
  'species-blank': 'No species recorded.',
  'species-unrecognized': 'Part of the species text was not recognized.',
  'double-incomplete': 'Marked as a double stain, but only one protocol follows the marker.',
  'double-same': 'A double stain that lists the same protocol twice.',
  'retrieval-blank': 'No antigen retrieval recorded.',
};

// ---------- antibody details ----------
// The catalog has no clone or host columns. Until someone fills in the assay's own clone, host and clonality fields,
// they are read from the text where they appear: a clone in the name ("2A Peptide (3H4)", "CD3 (clone SP7)"), the
// host and isotype in brackets after the catalog number ("(rabb mAb)", "(rat IgG2a)"). Notes are never read: they
// are free text ("Kit does not have a clone or host") and gave false clones. A field filled in always wins, and
// "N/A" (or "none", "-") in it means "not applicable": nothing is guessed for that field.
const HOSTS = [[/\b(rabb(it)?|rab|rb)\b/i, 'Rabbit'], [/\b(ms|mouse|msigg\w*)\b/i, 'Mouse'], [/\b(rat|rt)\b/i, 'Rat'], [/\b(goat|gt)\b/i, 'Goat'],
  [/\b(sheep|sh)\b/i, 'Sheep'], [/\b(chicken|ch)\b/i, 'Chicken'], [/\b(g\.?\s?pig|guinea pig)\b/i, 'Guinea pig'], [/\bhamster\b/i, 'Hamster'],
  [/\bdonkey\b/i, 'Donkey'], [/\bhuman\b/i, 'Human']];
const CLONE_LIKE = /^(?:\d+[A-Z]\d+[a-z]?|[A-Z]{1,3}\d{1,4}[A-Z]?\d*|(?:SP|EP|EPR|MRQ|RM|D|E|C|MECA|RAM|YP|HMB|AE)-?\d[\w.\-]*|AE1\/AE3|N-\d+|MC-\d+)$/;
const NOT_CLONE = /^(CD\d+|p\d+|CA\d+|HLA-|ICAM|NCAM|SSEA|LMP|XPO|CRHR|SQSTM|5HT|GLPN|FLK)/i;
export const NOT_APPLICABLE = /^(n\/?a|none|not applicable|no clone|-+|—)$/i;

export function antibodyInfo(a) {
  const name = String(a.name || ''); const cat = String(a.catalog || '');
  const own = { clone: String(a.clone || '').trim(), host: String(a.host || '').trim(), clonality: String(a.clonality || '').trim() };
  const entered = !!(own.clone || own.host || own.clonality);
  // Panels and double stains hold several antibodies; their details are on the components.
  if ((a.plex > 1 || (cat.match(/,/g) || []).length >= 1) && !entered) return { clone: '', host: '', isotype: '', clonality: '', conjugate: '', several: true, from: {} };
  const from = {};
  const cloneNA = NOT_APPLICABLE.test(own.clone);
  let clone = cloneNA ? '' : own.clone;
  if (own.clone) from.clone = 'entered';
  else {
    const explicit = `${name} ${cat}`.match(/\bclone\s*[:#]?\s*([A-Za-z0-9][\w.\-\/]*)/i);
    const tok = explicit?.[1] || '';
    if (tok && /\d/.test(tok) && !NOT_APPLICABLE.test(tok)) clone = tok;
    else {
      const paren = name.match(/\(([^()]+)\)\s*$/);
      const p = paren ? paren[1].trim() : '';
      if (p && !/\s/.test(p) && /\d/.test(p) && CLONE_LIKE.test(p) && !NOT_CLONE.test(p)) clone = p;
    }
    if (clone) from.clone = 'text';
  }
  const brackets = (cat.match(/\(([^()]*)\)/g) || []).map((x) => x.slice(1, -1)).filter((x) => !/^was\b/i.test(x)).join(' ');
  const hostNA = NOT_APPLICABLE.test(own.host);
  let host = hostNA ? 'Not applicable' : own.host;
  if (own.host) from.host = 'entered';
  else { host = HOSTS.find(([re]) => re.test(brackets))?.[1] || ''; if (host) from.host = 'text'; }
  const isotype = (brackets.match(/\bIg[AGMEY]\d?[a-c]?\b/i) || [''])[0].replace(/^ig/i, 'Ig');
  let clonality = '';
  if (own.clonality) { clonality = NOT_APPLICABLE.test(own.clonality) ? 'Not applicable' : own.clonality; from.clonality = 'entered'; }
  else if (!cloneNA) {
    const realHost = host === 'Not applicable' ? '' : host;
    clonality = /\b(mab|mono|monocl)/i.test(brackets) || clone || (isotype && realHost !== 'Rabbit' && realHost !== 'Goat' && !/poly|pab/i.test(brackets)) ? 'Monoclonal'
      : /\b(pab|poly|polycl)/i.test(brackets) || /^(Goat|Sheep|Donkey|Chicken|Guinea pig)$/.test(realHost) ? 'Polyclonal' : '';
    if (clonality) from.clonality = 'text';
  }
  const biotin = /biot/i.test(brackets);
  return { clone, host, isotype, clonality, conjugate: biotin ? 'Biotin' : /FITC/i.test(`${name} ${brackets}`) ? 'FITC' : '', from, cloneNotApplicable: cloneNA };
}

// ---------- matching a sample to an assay ----------

export const REQUEST_SPECIES = [
  ['Mouse', 'Mouse', 'MOUSE'], ['Rat', 'Rat', 'RAT'], ['Human', 'Human (coded tissue)', 'HUMAN'],
  ['PDX', 'Human xenograft in mouse (PDX)', 'PDX'], ['Organoid', 'Organoid', 'ORGANOID'], ['Canine', 'Canine', 'OTHER'], ['Other', 'Other', 'OTHER'],
];
export const REQUEST_FIXATIVES = [
  ['10% NBF', 'NBF'], ['4% PFA', 'PFA'], ['Zinc formalin', 'Zinc formalin'], ['70% ethanol', 'Ethanol'], ['Methanol', 'Methanol'],
  ["Bouin's", "Bouin's"], ["Carnoy's", "Carnoy's"], ['Fresh frozen (OCT)', 'Frozen'], ['Other', null],
];
export const SAMPLE_TYPES = [['FIXED', 'Fixed tissue'], ['FROZEN', 'Frozen tissue'], ['BLOCK', 'Paraffin block'], ['SLIDES', 'Unstained slides']];

const speciesAccepts = { Mouse: ['Mouse'], Rat: ['Rat'], Human: ['Human'], PDX: ['Human xenograft', 'Human'], Organoid: ['Human', 'Mouse'], Canine: ['Canine'] };

// Warnings, not errors: the IHC team may still run an assay outside its validated species or fixative.
export function assayFit(assay, { species, fixative, sampleTypes = [] }) {
  const notes = [];
  const want = speciesAccepts[species];
  if (want && assay.speciesTags.length && !want.some((t) => assay.speciesTags.includes(t)))
    notes.push(`listed for ${assay.speciesTags.join(', ')}, not ${species === 'PDX' ? 'human xenografts' : species.toLowerCase()}`);
  const fixTag = REQUEST_FIXATIVES.find(([label]) => label === fixative)?.[1];
  const frozenOnly = sampleTypes.length && sampleTypes.every((t) => t === 'FROZEN');
  if (frozenOnly && assay.fixTags.length && !assay.fixTags.includes('Frozen')) notes.push('validated on fixed tissue, not frozen');
  else if (!frozenOnly && fixTag && fixTag !== 'Frozen' && assay.fixTags.length && !assay.fixTags.includes(fixTag)) notes.push(`validated on ${assay.fixTags.join(', ')}, not ${fixative}`);
  return notes;
}

// ---------- pricing an IHC request ----------
// Codes from the CY2027 list. Where the list has no obvious code, the rule says so in `assumptions`.

const OPAL_CODES = { 1: 'HP006009', 2: 'HP006010', 3: 'HP006011', 4: 'HP006012', 5: 'HP006013', 6: 'HP006014' };

export function stainCodes(stain, assay) {
  if (stain.newAntibody) return [{ section: 'STAIN', code: stain.newAntibody.supplied ? 'HP006005' : 'HP006004', perSlide: 1 }];
  if (!assay) return [];
  if (assay.kind === 'TUNEL') return [{ section: 'STAIN', code: 'HP006008', perSlide: 1 }];
  if (assay.kind === 'β-gal') return [{ section: 'STAIN', code: 'HP006001', perSlide: 1 }];
  if (assay.kind === 'Opal') return [{ section: 'STAIN', code: OPAL_CODES[Math.min(6, assay.plex)], perSlide: 1 }];
  return [{ section: 'STAIN', code: 'HP006004', perSlide: Math.max(1, assay.plex) }];
}

// addOn: the stains go on blocks this request already makes (a necropsy or histology request), so there is no
// trimming or embedding to add and every stained slide is an extra section from an existing block.
export function estimateIhc(draft, assayById, { addOn = false } = {}) {
  const units = new Map(); const assumptions = new Set();
  const add = (section, code, n) => { if (n > 0) { const k = `${section}|${code}`; units.set(k, (units.get(k) || 0) + n); } };
  const he = draft.he?.on ? Math.max(0, Number(draft.he.perBlock) || 0) : 0;
  const un = draft.unstained?.on ? Math.max(0, Number(draft.unstained.perBlock) || 0) : 0;
  const stains = (draft.stains || []).map((s) => ({ s, a: s.assayId ? assayById(s.assayId) : null }));
  const scan = draft.scan || {};
  const scanning = scan.x20 || scan.x40;
  for (const sample of draft.samples || []) {
    const type = sample.type;
    const cut = type !== 'SLIDES';
    const slides = he + (cut ? un : 0) + stains.length;
    if (addOn) { if (slides > 0) add('MICROTOMY', 'HP004002', slides); }
    else {
      if (type === 'FIXED') add('TRIM_EMBED', 'HP003003', 1);
      if (type === 'FROZEN') add('TRIM_EMBED', 'HP003005', 1);
      if (cut && slides > 0) { add('MICROTOMY', 'HP004001', 1); add('MICROTOMY', 'HP004002', slides - 1); }
    }
    if (!cut && un > 0) assumptions.add('Unstained slides cannot be cut from submitted slides, so they are not estimated.');
    add('STAIN', 'HP005003', he);
    let bright = he; let fluor = 0;
    for (const { s, a } of stains) {
      for (const c of stainCodes(s, a)) add(c.section, c.code, c.perSlide);
      if (a && isFluorescent(a)) fluor++; else bright++;
    }
    if (scan.x20) add('IMAGE', 'HP001006', bright);
    if (scan.x40) add('IMAGE', 'HP001007', bright);
    if (scanning) add('IMAGE', 'HP001009', fluor);
  }
  const n = (draft.samples || []).length;
  for (const { s, a } of stains) {
    if (s.newAntibody) {
      add('STAIN', 'HP009002', 8);
      assumptions.add('A new antibody is estimated with 2 hours of optimization labor (HP009002 x 8) plus one slide per block; MHL confirms after reviewing the antibody.');
      if (s.newAntibody.supplied) assumptions.add('The requester supplies the antibody, so slides use HP006005 (IHC, labor only).');
    } else if (a && a.kind === 'IHC' && a.plex > 1) assumptions.add(`${a.name}: the price list has no chromogenic multiplex code, so it is estimated as ${a.plex} x HP006004 per slide.`);
    else if (a && a.kind === 'IF') assumptions.add(`${a.name}: non-Opal immunofluorescence has no code of its own, so it is estimated as HP006004 per slide.`);
  }
  if (scanning && stains.some(({ a }) => a && isFluorescent(a))) assumptions.add('Fluorescent slides are scanned on the Akoya system (HP001009) instead of the Aperio.');
  if (draft.importance === 'STAT') assumptions.add('STAT: the CY2027 list has no STAT surcharge code, so none is estimated.');
  if (addOn && stains.length) assumptions.add('The stained slides are cut from blocks this request already makes, so each is estimated as an additional section (HP004002).');
  const lines = [...units].map(([k, u]) => { const [section, code] = k.split('|'); return { section, code, units: u }; });
  const order = ['TRIM_EMBED', 'MICROTOMY', 'STAIN', 'IMAGE'];
  lines.sort((x, y) => order.indexOf(x.section) - order.indexOf(y.section) || x.code.localeCompare(y.code));
  return { lines, assumptions: [...assumptions], blocks: n };
}

// Work areas a request will pass through, from the sample types and whether scanning was asked for.
export function ihcAreas(draft) {
  const types = new Set((draft.samples || []).map((s) => s.type));
  const areas = [];
  if (types.has('FIXED')) areas.push('TRIMM');
  if (types.has('FIXED') || types.has('FROZEN')) areas.push('EMBED');
  if (types.has('FIXED') || types.has('FROZEN') || types.has('BLOCK')) areas.push('MICRO');
  areas.push('STAIN');
  if (draft.scan?.x20 || draft.scan?.x40) areas.push('IMAGE');
  return areas;
}

export const daysBetween = (a, b) => Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 86400000);

// Things the IHC team would want to know before accepting.
export function requestWarnings(draft, assayById, today) {
  const out = [];
  const types = (draft.samples || []).map((s) => s.type);
  if (draft.fixDate && types.includes('FIXED')) {
    const d = daysBetween(draft.fixDate, today);
    if (d > 7) out.push(`Tissue has been in fixative for ${d} days. Long formalin fixation can weaken IHC staining; moving the tissue to 70% ethanol, or processing it soon, helps.`);
  }
  for (const s of draft.stains || []) {
    const a = s.assayId ? assayById(s.assayId) : null;
    if (a) {
      if (a.status !== 'Active') out.push(`${a.name} (#${a.id}) is ${a.status.toLowerCase()} in the catalog.`);
      if (a.result === 'Failed') out.push(`${a.name} (#${a.id}) is marked "Did not work" in the catalog. Choose another protocol or check with the IHC team.`);
      else if (a.result === 'Optimizing') out.push(`${a.name} (#${a.id}) is still being optimized.`);
      for (const n of assayFit(a, { species: draft.species, fixative: draft.fixativeUsed, sampleTypes: types })) out.push(`${a.name} (#${a.id}) is ${n}.`);
    } else if (s.newAntibody) out.push(`${s.newAntibody.name} is not in the catalog, so the IHC team will optimize it first. The antibody's datasheet helps.`);
  }
  return out;
}

// One line describing the request, for the LIMS request record.
export function summarize(draft, assayById) {
  const names = (draft.stains || []).map((s) => (s.assayId ? assayById(s.assayId)?.name : s.newAntibody?.name) || '?');
  const parts = [];
  if (names.length) parts.push(`${names.join(', ')}`);
  if (draft.he?.on) parts.push(`H&E x${draft.he.perBlock}`);
  if (draft.unstained?.on) parts.push(`unstained x${draft.unstained.perBlock}`);
  const scan = [draft.scan?.x20 && '20x', draft.scan?.x40 && '40x'].filter(Boolean).join(' and ');
  const tissues = [...new Set((draft.samples || []).map((s) => s.tissue).filter(Boolean))].join(', ');
  return `IHC request: ${parts.join('; ')} on ${(draft.samples || []).length} block(s)${tissues ? ` (${tissues})` : ''}${scan ? `; scan at ${scan}` : ''}.`;
}

// ---------- the catalog as an Excel workbook ----------
// The workbook: one row per protocol with every column, and a second sheet saying what the columns mean.
export const CATALOG_COLUMNS = [
  ['#', 'id', 7], ['Antibody', 'name', 28], ['Antibody clone', 'cloneShown', 14], ['Antibody host', 'hostShown', 13], ['Clonality', 'clonalityShown', 13],
  ['Kind', 'kindLabel', 16], ['Platform', 'platform', 12], ['Chromogen', 'chromogen', 12], ['Dilution and time', 'dilution', 22], ['Antigen retrieval', 'retrieval', 30],
  ['Proteolytic digestion', 'digestion', 18], ['Secondary antibody / detection kit', 'kit', 40], ['Fixative', 'fixative', 16], ['Species', 'species', 18],
  ['Control tissue', 'control', 24], ['Manufacturer', 'manufacturer', 20], ['Catalog number', 'catalog', 20], ['Public', 'publicText', 10], ['Preferred', 'preferredText', 10],
  ['Result', 'resultLabel', 15], ['Status', 'status', 10], ['Needs checking', 'checkText', 14], ['Notes', 'notes', 40], ['Last changed', 'changed', 12], ['Export line', 'sourceLine', 10],
];
export function catalogSheets(assays, { filtered = false, today = '', source = '' } = {}) {
  const row = (a) => {
    const v = { ...a, publicText: a.visibility === 'Internal' ? 'Not public' : 'Public', preferredText: a.preferred ? 'Yes' : 'No',
      checkText: a.flags.filter((x) => x !== 'duplicate').length ? 'Yes' : '', changed: a.updatedAt ? a.updatedAt.slice(0, 10) : '' };
    return CATALOG_COLUMNS.map(([, k]) => (k === 'id' || k === 'sourceLine' ? (Number.isFinite(v[k]) ? v[k] : '') : String(v[k] ?? '')));
  };
  return [
    { name: 'Assay catalog', rows: [CATALOG_COLUMNS.map(([h]) => ({ v: h, style: 'header' })), ...assays.map(row)], cols: CATALOG_COLUMNS.map(([, , w]) => w), freezeRows: 1 },
    { name: 'About', cols: [26, 90], rows: [
      [{ v: 'MHL IHC assay catalog', style: 'title' }],
      ['Downloaded', today], ['From', `${source} (MHL LIMS pilot)`], ['Rows', `${assays.length} protocols${filtered ? ', the ones that matched the filters on screen' : ', every status'}`], [],
      [{ v: 'Column', style: 'header' }, { v: 'Meaning', style: 'header' }],
      ['Antibody clone, host, clonality', 'As entered on the assay; where nobody has entered them, as read from the antibody name and catalog number. N/A = not applicable.'],
      ['Kind, platform, chromogen', 'Worked out from the detection kit and dilution unless set by hand on the assay.'],
      ['Public', 'Public: investigators can request it. Not public: MHL staff only.'],
      ['Preferred', 'The protocol to use first when there are several for the same target.'],
      ['Result', 'Works, Being optimized, Did not work, or not recorded.'],
      ['Needs checking', 'Something the import repaired or found missing; see the assay page in the LIMS.'],
    ] },
  ];
}
