// Outside IHC sources: what the Human Protein Atlas, the Antibody Registry (RRIDs), Antibodypedia, CiteAb, NordiQC and
// ImmunoQuery can add to an assay in MHL's own catalog, and the readers for the two that publish open data files.
//
// What each source allows decides what the LIMS keeps (checked November 2026; see docs/outside-ihc-sources.md):
//   - Human Protein Atlas: CC BY 4.0. Its download files may be imported, with the version and licence shown wherever
//     the data appear. Human tissue only.
//   - Antibody Registry: RRIDs are CC0. The registry's download (after signing in) may be imported to find the RRID of
//     each catalog antibody.
//   - Antibodypedia and CiteAb: their terms forbid copying their content into a database (CiteAb also forbids scraping).
//     The LIMS only links to them; staff may save the page they found and a short note in their own words.
//   - NordiQC: free to read, copyrighted, no data files. Links and staff notes.
//   - ImmunoQuery: an Elsevier subscription. Links only.
// MHL's own catalog stays the record of how an assay is run; outside data is shown beside it, never merged into it.
//
// Shared by the pilot core and the browser (/lib/outside.mjs). Uses only what browsers and Node 18+ both have.

export const SOURCES = [
  { key: 'hpa', name: 'Human Protein Atlas', short: 'HPA', home: 'https://www.proteinatlas.org/', domains: ['proteinatlas.org'], use: 'import',
    access: 'Free. Open data (CC BY 4.0): its download files can be imported here.',
    what: 'Where each human protein is found by IHC in normal and cancer tissue, how reliable that staining is, and the HPA antibodies used.',
    caution: 'Human tissue. For a mouse assay it shows where the human protein is found, which is a guide to control tissue, not proof the mouse antibody works.' },
  { key: 'registry', name: 'Antibody Registry (RRID)', short: 'RRID', home: 'https://www.antibodyregistry.org/', domains: ['antibodyregistry.org', 'scicrunch.org', 'rrid.site'], use: 'import',
    access: 'Free. RRIDs are open (CC0); the registry download (after signing in) can be imported here.',
    what: 'The RRID that identifies the exact antibody product, for methods sections, grant reports and NIH rigor requirements.' },
  { key: 'antibodypedia', name: 'Antibodypedia', short: 'Antibodypedia', home: 'https://www.antibodypedia.com/', domains: ['antibodypedia.com'], use: 'link',
    access: 'Free to read. Its terms forbid copying its content into a database, so the LIMS links to it.',
    what: 'Antibodies against each human target from more than 100 providers, with validation scores by application, including IHC.' },
  { key: 'citeab', name: 'CiteAb', short: 'CiteAb', home: 'https://www.citeab.com/antibodies/search', domains: ['citeab.com'], use: 'link',
    access: 'Free search. Its terms forbid scraping; its data come only under a paid licence, so the LIMS links to it.',
    what: 'Antibodies ranked by how often papers cite them, with application and species filters; the most useful of the six for mouse antibodies.' },
  { key: 'nordiqc', name: 'NordiQC', short: 'NordiQC', home: 'https://www.nordiqc.org/epitope.php', domains: ['nordiqc.org'], use: 'link',
    access: 'Free to read. No data files, so the LIMS links to it.',
    what: 'Quality assessment of clinical IHC by epitope: which clones and protocols stained optimally, with recommended protocols for each stainer.',
    caution: 'Human diagnostic tissue.' },
  { key: 'immunoquery', name: 'ImmunoQuery', short: 'ImmunoQuery', home: 'https://app.immunoquery.com/', domains: ['immunoquery.com'], use: 'link',
    access: 'Elsevier subscription; sign in. Links only.',
    what: 'Antibody panels for human tumor diagnosis, with the percent of cases positive from the literature.', caution: 'Human diagnostic pathology.' },
];
export const OTHER_SOURCE = { key: 'other', name: 'Other (datasheet, paper)', domains: null };
export const sourceByKey = (k) => SOURCES.find((s) => s.key === k) || (k === 'other' ? OTHER_SOURCE : null);
export const HPA_LICENCE = 'CC BY 4.0';

// "N/A" means "does not apply" (a tag such as GFP has no gene; a kit may have no RRID): nothing is suggested.
export const NOT_APPLICABLE = /^(n\/?a|none|not applicable|-+|—)$/i;
const isNA = (v) => NOT_APPLICABLE.test(String(v || '').trim());

// ---------- identifiers ----------

// An antibody RRID: "AB_2722", "RRID:AB_2722", or a registry or resolver address that ends in one.
export function readRrid(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { value: '' };
  if (isNA(s)) return { value: 'N/A' };
  const plain = s.match(/^(?:RRID\s*:\s*)?AB_(\d{1,10})$/i);
  if (plain) return { value: `AB_${plain[1]}` };
  if (/^https?:\/\//i.test(s) && hostAllowed(s, sourceByKey('registry').domains)) {
    const m = s.match(/(?:RRID:)?AB_(\d{1,10})\/?(?:[?#].*)?$/i);
    if (m) return { value: `AB_${m[1]}` };
  }
  if (/^(?:RRID\s*:\s*)?(CVCL|SCR|IMSR|MGI|Addgene|ZFIN|BDSC)_?/i.test(s)) return { value: '', error: `${s} is not an antibody RRID; antibody RRIDs start with AB_.` };
  return { value: '', error: 'An antibody RRID looks like AB_2722 (or RRID:AB_2722).' };
}

// UniProt accessions (UniProt's own pattern), up to three: "P46013" or "P46013, Q61263".
const UNIPROT = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})(?:-\d+)?$/;
export function readUniprot(raw) {
  const parts = String(raw ?? '').toUpperCase().split(/[\s,;]+/).filter(Boolean);
  if (!parts.length) return { value: '' };
  const bad = parts.filter((p) => !UNIPROT.test(p));
  if (bad.length) return { value: '', error: `${bad.join(', ')} ${bad.length === 1 ? 'is not a UniProt accession' : 'are not UniProt accessions'} (such as P46013).` };
  if (parts.length > 3) return { value: '', error: 'Give at most three UniProt accessions (the human and the mouse protein, say).' };
  return { value: [...new Set(parts)].join(', ') };
}

// The target's gene symbol, as HGNC writes it for human (MKI67) or MGI for mouse (Mki67); outside sources are searched
// with the human form. "N/A" for a tag or reagent (GFP, BrdU, TUNEL).
export function readGene(raw) {
  const s = String(raw ?? '').trim();
  if (!s) return { value: '' };
  if (isNA(s)) return { value: 'N/A' };
  if (!/^[A-Za-z0-9][A-Za-z0-9\-.@]{0,19}$/.test(s)) return { value: '', error: 'A gene symbol is one word of letters, numbers and hyphens, such as MKI67, PTPRC or CD8A. Type N/A for a tag or reagent.' };
  return { value: s };
}
export const geneKey = (g) => String(g || '').trim().toUpperCase();
export const hasGene = (a) => !!a.target && !isNA(a.target);
export const hasRrid = (a) => /^AB_\d+$/.test(a.rrid || '');

// Only plain http and https addresses on the source's own site are saved, so a saved link cannot run script.
export function hostAllowed(url, domains) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (!domains) return true;
  const host = u.hostname.toLowerCase();
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}

// A page someone found on an outside source, with a short note in their own words (a summary, not a copy).
export function readReference(body) {
  const src = sourceByKey(String(body?.source || ''));
  if (!src) return { error: 'Choose which source the page is from.' };
  const url = String(body?.url ?? '').trim();
  const note = String(body?.note ?? '').trim().replace(/\s+/g, ' ');
  if (!url && !note) return { error: 'Give the address of the page, a note, or both.' };
  if (url) {
    if (url.length > 500) return { error: 'That address is too long (500 characters at most).' };
    if (!hostAllowed(url, null)) return { error: 'Give a web address starting with https:// (or http://).' };
    if (src.domains && !hostAllowed(url, src.domains)) return { error: `That address is not on ${src.name} (${src.domains.join(', ')}). Choose "Other" for a datasheet or paper.` };
  }
  if (note.length > 400) return { error: 'Keep the note to 400 characters: a summary in your own words, not a copy of the page.' };
  return { value: { source: src.key, url, note } };
}

// ---------- matching catalog numbers and vendors ----------

// A catalog number as the registry would write it: brackets ("(rabb mAb)") and "Cat#" removed, upper case. Entries
// with several antibodies ("ab133616, ab101500") have no single catalog number.
export function catalogRaw(raw) {
  // "(rabb mAb0" (a bracket never closed) is dropped with the rest of the line; "N/A (ms)" is no catalog number.
  let s = String(raw ?? '').replace(/\([^()]*\)/g, ' ').replace(/\(.*$/, ' ');
  if (/[,;]/.test(s) || NOT_APPLICABLE.test(s.trim())) return '';
  s = s.replace(/\b(?:cat(?:alog)?\.?\s*(?:no\.?|number|#)?|clone\s+\S+)\s*:?/gi, ' ');
  return s.toUpperCase().replace(/[^A-Z0-9-]+/g, '').replace(/^-+|-+$/g, '');
}
export const catalogKey = (raw) => catalogRaw(raw).replace(/-/g, '');
// A bare number such as "9027" is shared by many vendors' catalogs; it only matches with the vendor.
const distinctive = (key) => (/[A-Z]/.test(key) && key.length >= 5) || key.length >= 7;

const VENDORS = [
  ['cell signaling', /cell signal|\bcst\b/], ['abcam', /abcam/], ['bd', /\bbd\b|becton|pharmingen/],
  ['thermo', /thermo|invitrogen|ebioscience|life tech|molecular probes|pierce|lab ?vision|neomarkers/], ['santa cruz', /santa cruz/],
  ['novus', /novus/], ['r&d', /r\s?&\s?d|r and d|bio-?techne/], ['proteintech', /proteintech/], ['leica', /leica|novocastra/], ['agilent', /dako|agilent/],
  ['biolegend', /biolegend/], ['millipore', /millipore|sigma|merck|chemicon|upstate|calbiochem|oncogene research/], ['biocare', /biocare/], ['vector', /vector lab/],
  ['genetex', /genetex/], ['bio-rad', /bio-?rad|serotec/], ['roche', /ventana|roche/], ['atlas', /atlas antibodies|prestige/], ['synaptic systems', /synaptic systems|\bsysy\b/],
  ['wako', /wako|fujifilm/], ['abnova', /abnova/], ['cell marque', /cell marque/], ['jackson', /jackson immuno/], ['bethyl', /bethyl/], ['enzo', /enzo/], ['antibodies-online', /antibodies-online/],
];
export function vendorKey(raw) {
  const s = String(raw ?? '').toLowerCase();
  if (!s.trim()) return '';
  return VENDORS.find(([, re]) => re.test(s))?.[0] || s.replace(/\b(inc|ltd|llc|gmbh|corp(oration)?|co|company|biosciences?|biologicals?|technolog(y|ies)|laboratories|labs?|antibodies)\b|[^a-z0-9]+/g, ' ').trim();
}
export const vendorsMatch = (a, b) => { const x = vendorKey(a); const y = vendorKey(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

// HPA's own antibodies are sold under their HPA IDs (HPA002198, CAB000146, AMAb90569).
const HPA_AB = /\b(HPA\d{6}|CAB\d{6}|AMAb\d{5})\b/i;
export const hpaAntibodyId = (catalog) => (String(catalog || '').match(HPA_AB)?.[1] || '').toUpperCase().replace(/^AMAB/, 'AMAb');

// Panels and double stains hold several antibodies; their outside references belong on the single-stain protocols.
export const singleAntibody = (a) => !(a.plex > 1) && !a.components && !/\d-plex|^(duplex|triplex)\b/i.test(a.name || '') && !/[,;]/.test(String(a.catalog || '').replace(/\([^()]*\)/g, ''));

// ---------- the target gene ----------

const GREEK = { 'α': 'a', 'β': 'b', 'γ': 'g', 'δ': 'd', 'ε': 'e', 'κ': 'k', 'λ': 'l', 'μ': 'm' };
const phrase = (s) => String(s || '').toLowerCase().replace(/[αβγδεκλμ]/g, (c) => GREEK[c]).replace(/\s+/g, ' ').trim();
export const nameKey = (s) => phrase(s).toUpperCase().replace(/\s+/g, '');
export const looseKey = (s) => nameKey(s).replace(/[-./_]/g, '');

// Common IHC names whose gene symbol is not the name itself (human symbols). Checked against the HPA when it is loaded.
export const TARGET_ALIASES = {
  'ki67': 'MKI67', 'ki-67': 'MKI67', 'mib-1': 'MKI67', 'f4/80': 'ADGRE1', 'cd31': 'PECAM1', 'pecam-1': 'PECAM1', 'cd31 pecam-1': 'PECAM1',
  'cd45': 'PTPRC', 'cd45 (lca)': 'PTPRC', 'lca': 'PTPRC', 'b220': 'PTPRC', 'cd45r': 'PTPRC', 'cd45r/b220': 'PTPRC', 'cd45r/ b220': 'PTPRC', 'cd45ra': 'PTPRC', 'cd45ro': 'PTPRC',
  'iba1': 'AIF1', 'iba-1': 'AIF1', 'sma': 'ACTA2', 'a-sma': 'ACTA2', 'actin, a-smooth muscle': 'ACTA2', 'alpha smooth muscle actin': 'ACTA2', 'smooth muscle actin': 'ACTA2',
  'e-cadherin': 'CDH1', 'cadherin (e-cadherin)': 'CDH1', 'n-cadherin': 'CDH2', 'cadherin (n-cadherin)': 'CDH2', 'b-catenin': 'CTNNB1', 'catenin (b-catenin)': 'CTNNB1', 'beta-catenin': 'CTNNB1',
  'cd3': 'CD3E', 'cd8': 'CD8A', 'cd8a': 'CD8A', 'cd20': 'MS4A1', 'cd117': 'KIT', 'ckit': 'KIT', 'c-kit': 'KIT', 'cd11b': 'ITGAM', 'cd11c': 'ITGAX', 'cd79a': 'CD79A',
  'cd138': 'SDC1', 'cd10': 'MME', 'cd15': 'FUT4', 'cd15 (ssea1)': 'FUT4', 'cd56': 'NCAM1', 'cd56 (ncam1)': 'NCAM1', 'cd57': 'B3GAT1', 'cd206': 'MRC1', 'cd204': 'MSR1', 'cd133': 'PROM1',
  'cd103': 'ITGAE', 'cd49a': 'ITGA1', 'cd49b': 'ITGA2', 'cd54': 'ICAM1', 'cd54 (icam1)': 'ICAM1', 'cd71': 'TFRC', 'cd71 (transferrin receptor)': 'TFRC', 'cd25': 'IL2RA', 'cd21': 'CR2',
  'cd23': 'FCER2', 'cd166': 'ALCAM', 'cd276': 'CD276', 'b7-h3': 'CD276', 'b7-h3 (cd276)': 'CD276', 'b7h4': 'VTCN1', 'b7-h4': 'VTCN1', 'pd-l1': 'CD274', 'pdl1': 'CD274', 'pd-1': 'PDCD1', 'pd1': 'PDCD1',
  'her2': 'ERBB2', 'c-erbb-2': 'ERBB2', 'p53': 'TP53', 'p27': 'CDKN1B', 'cdkn1b (p27)': 'CDKN1B', 'p21': 'CDKN1A', 'p16': 'CDKN2A', 'c-myc': 'MYC', 'c-fos': 'FOS', 'c-maf': 'MAF',
  'androgen receptor': 'AR', 'estrogen receptor alpha': 'ESR1', 'progesterone receptor': 'PGR', 'cleaved caspase 3': 'CASP3', 'cleaved casp3': 'CASP3', 'caspase 3': 'CASP3', 'caspase-3': 'CASP3',
  'caspase 8': 'CASP8', 'calretinin': 'CALB2', 'chromogranin': 'CHGA', 'chromogranin a': 'CHGA', 'synaptophysin': 'SYP', 'vimentin': 'VIM', 'desmin': 'DES', 'myeloperoxidase': 'MPO',
  'lysozyme': 'LYZ', 'cea': 'CEACAM5', 'carcinoembryonic antigen (cea)': 'CEACAM5', 'cea/cd66e': 'CEACAM5', 'carbonic anhydrase ix': 'CA9', 'carbonic anhydrase ix (ca9)': 'CA9',
  'carbonic anhydrase xii': 'CA12', 'ttf-1': 'NKX2-1', 'ttf1': 'NKX2-1', '53bp1': 'TP53BP1', 'ascl1 (mash1)': 'ASCL1', 'mash1': 'ASCL1', 'ascl2/mash2': 'ASCL2', 'bap-1': 'BAP1',
  'bcl-2': 'BCL2', 'alkaline phosphatase (tissue non-specific)': 'ALPL', 'cathepsin g': 'CTSG', 'ccl2/mcp-1': 'CCL2', 'c/ebpbeta': 'CEBPB', 'c/ebpb': 'CEBPB', 'c/ebpdelta': 'CEBPD', 'c/ebpd': 'CEBPD',
  'claudin 3': 'CLDN3', 'claudin 4': 'CLDN4', 'claudin 5': 'CLDN5', 'cd206 (a/mannose)': 'MRC1', 'alk (anaplastic lymphoma kinase)': 'ALK', 'cd103 (itgae)': 'ITGAE', 'gfap': 'GFAP',
  'foxp3': 'FOXP3', 'cd68': 'CD68', 'cd4': 'CD4', 'cd163': 'CD163', 'cd34': 'CD34', 'cd19': 'CD19', 'cd1a': 'CD1A', 'cd1d': 'CD1D', 'cd44': 'CD44', 'cd38': 'CD38', 'cd40': 'CD40',
  'cd69': 'CD69', 'cd74': 'CD74', 'cd86': 'CD86', 'cd24': 'CD24', 'cd27': 'CD27', 'cd6': 'CD6', 'cd200': 'CD200', 'tmem119': 'TMEM119', 'satb2': 'SATB2', 'numa1': 'NUMA1',
  'cyclin d1': 'CCND1', 'cox-2': 'PTGS2', 'cox2': 'PTGS2', 'cytokeratin 5': 'KRT5', 'cytokeratin 7': 'KRT7', 'cytokeratin 8': 'KRT8', 'cytokeratin 14': 'KRT14', 'cytokeratin 18': 'KRT18',
  'cytokeratin 19': 'KRT19', 'cytokeratin 20': 'KRT20', 'ck5': 'KRT5', 'ck7': 'KRT7', 'ck8': 'KRT8', 'ck14': 'KRT14', 'ck18': 'KRT18', 'ck19': 'KRT19', 'ck20': 'KRT20',
  'epidermal growth factor receptor (egfr)': 'EGFR', 'epithelial membrane antigen (ema)': 'MUC1', 'ema': 'MUC1', 'era': 'ESR1', 'er-alpha': 'ESR1', 'er-beta': 'ESR2', 'erb': 'ESR2',
  'exportin-1': 'XPO1', 'collagen iv': 'COL4A1', 'clusterin': 'CLU', 'decorin': 'DCN', 'calreticulin': 'CALR', 'apoe': 'APOE', 'akt2': 'AKT2', 'ephb2': 'EPHB2', 'epcam': 'EPCAM',
  'complement component c3d': 'C3', 'corticotropin releasing factor (crf)': 'CRH', 'corticotropin releasing factor receptor 2 (crhr2)': 'CRHR2', 'bombesin receptor 3': 'BRS3',
};
const aliasOf = (p) => (Object.hasOwn(TARGET_ALIASES, p) ? TARGET_ALIASES[p] : '');
// Tags, labels and reagents: no gene to look up.
const NO_GENE = /^(e?gfp|[ert]fp|yfp|tdtomato|mcherry|2a peptide|brdu|edu|tunel|apoptag|apoptag \(tunel\)|ha( tag)?|flag( tag)?|v5( tag)?|myc tag|biotin|digoxigenin|dig|alexa fluor \d+|fitc|luciferase|b-gal|beta-gal|x-gal|lacz|5-hmc|5-mc|candida albicans|ca19-9)$/;

// The phrases a catalog name could mean, in lower case: the whole name, the name without brackets, what is in brackets,
// and each word (`whole` has all but the single words). Notes in brackets ("1st of double stain with CD45R", "method for bones", "a/Hu", "Clone 010") are left out.
export function namePhrases(name) {
  const core = String(name || '').replace(/\((?:\d(?:st|nd|rd|th) of double[^)]*|[^)]*\bfor bones\b[^)]*|a\/\w+|clone [^)]*)\)/gi, ' ').replace(/\s+/g, ' ').trim();
  const phrases = new Set([phrase(core)]);
  const noParen = phrase(core.replace(/\([^)]*\)/g, ' '));
  if (noParen) phrases.add(noParen);
  for (const m of core.matchAll(/\(([^)]+)\)/g)) phrases.add(phrase(m[1]));
  phrases.delete('');
  const whole = new Set(phrases);
  for (const p of whole) for (const part of p.split(/\s*\/\s*|\s+/)) if (part.length > 1) phrases.add(part);
  return { core, phrases, whole };
}

// The symbol a catalog name probably means, best guess first. `genes` is the imported HPA summary (by upper-case symbol);
// without it, words written like symbols are offered as "check". Never chosen automatically: staff accept them.
export function targetCandidates(a, genes = null, synonymIndex = null) {
  if (!singleAntibody(a)) return [];
  const { core, phrases, whole } = namePhrases(a.name);
  // A tag or label (GFP, BrdU, ApopTag) is recognized from the whole name, not one word of it ("I-Ad, biotin" is an
  // antibody to I-Ad that happens to be biotinylated).
  const isTag = [...whole].some((p) => NO_GENE.test(p));
  const out = []; const seen = new Set();
  const add = (symbol, why, strength) => { const k = geneKey(symbol); if (!k || seen.has(k)) return; seen.add(k); out.push({ symbol, why, strength }); };
  for (const p of phrases) {
    const alias = aliasOf(p);
    if (alias) add(alias, genes?.[alias] ? `“${p}” is ${alias} in the HPA` : `“${p}” is usually ${alias}`, genes?.[alias] ? 3 : 2);
  }
  if (genes) {
    // A single word of a longer name ("Hop" in "Hop protein") is weaker evidence than the whole name, and a synonym
    // shared by several genes is only a hint.
    for (const p of phrases) { const g = genes[nameKey(p)]; if (g) add(g.gene, whole.has(p) ? `the name is the HPA gene symbol ${g.gene}` : `“${p}” is the HPA gene symbol ${g.gene}; check it`, whole.has(p) ? 3 : 1); }
    const idx = synonymIndex || buildSynonymIndex(genes);
    for (const p of phrases) {
      const list = idx.exact.get(nameKey(p)) || [];
      for (const sym of list) add(sym, list.length > 1 ? `“${p}” is a synonym of ${list.join(' and ')} in the HPA` : `“${p}” is a synonym of ${sym} in the HPA`, list.length === 1 && whole.has(p) ? 2 : 1);
    }
    for (const p of phrases) for (const sym of idx.loose.get(looseKey(p)) || []) add(sym, `“${p}” is close to ${sym} in the HPA`, 1);
  } else if (!isTag) {
    // Without the HPA: a word written in capitals and numbers (AASS, CDK4, AGR2) is probably the symbol itself.
    // Mixed case with a number or two capitals (Akt2, ApoE, EpCAM) counts too. Words that are already aliases are not repeated.
    for (const tok of core.replace(/\([^)]*\)/g, ' ').split(/[\s/,]+/)) {
      if (aliasOf(phrase(tok)) || !/^[A-Za-z][A-Za-z0-9]{2,9}$/.test(tok)) continue;
      if (/^[A-Z][A-Z0-9]+$/.test(tok) || /\d/.test(tok) || (tok.match(/[A-Z]/g) || []).length >= 2) add(tok.toUpperCase(), 'the name looks like a gene symbol; check it', 1);
    }
  }
  // N/A never outranks a gene with good evidence.
  if (isTag) add('N/A', 'a tag, label or reagent, not a gene', out.some((c) => c.strength >= 2) ? 1 : 3);
  return out.sort((x, y) => y.strength - x.strength).slice(0, 4);
}

// Synonym lookups for the imported HPA genes: exact ("KI-67" -> MKI67) and ignoring hyphens and dots.
// Built once per imported gene list (the list is replaced, never changed, on import).
const synonymMemo = new WeakMap();
export function buildSynonymIndex(genes) {
  if (genes && typeof genes === 'object' && synonymMemo.has(genes)) return synonymMemo.get(genes);
  const exact = new Map(); const loose = new Map();
  const put = (map, k, sym) => { if (!k) return; const list = map.get(k) || []; if (!list.includes(sym)) list.push(sym); map.set(k, list); };
  for (const g of Object.values(genes || {})) {
    put(loose, looseKey(g.gene), g.gene);
    for (const s of g.synonyms || []) { put(exact, nameKey(s), g.gene); put(loose, looseKey(s), g.gene); }
  }
  const idx = { exact, loose };
  if (genes && typeof genes === 'object') synonymMemo.set(genes, idx);
  return idx;
}

// ---------- RRIDs ----------

// The imported registry rows by catalog number, and by each shorter form of it ("14-0195-82" under "14-0195"), so each
// assay is matched without reading every row.
export function registryIndex(rows = []) {
  const byKey = new Map(); const byPrefix = new Map();
  const put = (m, k, item) => { const l = m.get(k); if (l) l.push(item); else m.set(k, [item]); };
  for (const r of rows) {
    const rr = catalogRaw(r.catalog);
    if (!rr) continue;
    const item = { r, rr, rk: rr.replace(/-/g, '') };
    put(byKey, item.rk, item);
    for (let i = rr.lastIndexOf('-'); i > 0; i = rr.lastIndexOf('-', i - 1)) put(byPrefix, rr.slice(0, i), item);
  }
  return { byKey, byPrefix, size: rows.length };
}

// RRIDs that may belong to the assay's antibody, from the imported registry rows (or their index) and the HPA, best first.
export function rridCandidates(a, registry = [], genes = null) {
  if (!singleAntibody(a) || a.rrid) return [];
  const out = [];
  const hpaId = hpaAntibodyId(a.catalog);
  if (hpaId && genes) {
    for (const g of Object.values(genes)) {
      const ab = (g.antibodies || []).find((x) => x.id === hpaId && x.rrid);
      if (ab) out.push({ rrid: ab.rrid, level: 'exact', why: `HPA antibody ${hpaId} (${g.gene})`, catalog: hpaId, vendor: 'Atlas Antibodies', name: `${g.gene} antibody ${hpaId}`, clone: '' });
    }
  }
  const idx = Array.isArray(registry) ? registryIndex(registry) : registry;
  const raw = catalogRaw(a.catalog); const key = raw.replace(/-/g, '');
  if (key && idx?.byKey) {
    const consider = (item, variant) => {
      const vendorOk = vendorsMatch(a.manufacturer, item.r.vendor);
      const level = !variant ? (vendorOk ? 'exact' : distinctive(key) ? 'catalog only' : null) : vendorOk ? 'variant' : null;
      if (!level) return;
      const r = item.r;
      out.push({ rrid: r.rrid, level, why: level === 'exact' ? 'same catalog number and vendor' : level === 'catalog only' ? `same catalog number; the registry gives the vendor as ${r.vendor || 'unknown'}` : `catalog number ${r.catalog}, a size or format of ${raw}`,
        catalog: r.catalog, vendor: r.vendor, name: r.name || '', clone: r.clone || '' });
    };
    for (const item of idx.byKey.get(key) || []) consider(item, false);
    for (const item of idx.byPrefix.get(raw) || []) consider(item, true);
    if (/\d$/.test(key)) for (let c = 65; c <= 90; c++) for (const item of idx.byKey.get(key + String.fromCharCode(c)) || []) consider(item, true);
  }
  const rank = { exact: 0, variant: 1, 'catalog only': 2 };
  const seen = new Set();
  return out.sort((x, y) => rank[x.level] - rank[y.level]).filter((c) => (seen.has(c.rrid) ? false : seen.add(c.rrid))).slice(0, 5);
}

// ---------- links ----------

// For each source: the best page for this assay (an exact page when an identifier is known, otherwise a search), the
// text to search for where the source has no search address, and the pages staff have saved.
export function sourceLinks(a, { hpaGene = null } = {}) {
  const gene = hasGene(a) ? geneKey(a.target) : '';
  const single = singleAntibody(a);
  const cat = single ? catalogRaw(a.catalog) : '';
  const hpaId = hpaAntibodyId(a.catalog);
  const searchText = gene || String(a.name || '').replace(/\([^)]*\)/g, '').trim();
  const saved = (k) => (a.refs || []).filter((r) => r.source === k && r.url);
  const enc = encodeURIComponent;
  return SOURCES.map((s) => {
    const links = []; let search = '';
    if (s.key === 'hpa') {
      if (hpaGene?.ensembl) {
        links.push({ label: `${hpaGene.gene} in the HPA`, url: `https://www.proteinatlas.org/${enc(hpaGene.ensembl)}-${enc(hpaGene.gene)}`, exact: true });
        links.push({ label: 'HPA antibodies and validation', url: `https://www.proteinatlas.org/${enc(hpaGene.ensembl)}-${enc(hpaGene.gene)}/summary/antibody`, exact: true });
      } else if (searchText) links.push({ label: `Search the HPA for ${searchText}`, url: `https://www.proteinatlas.org/search/${enc(searchText)}`, exact: false });
      if (hpaId) links.push({ label: `HPA antibody ${hpaId}`, url: `https://www.proteinatlas.org/search/${enc(hpaId)}`, exact: true });
    } else if (s.key === 'registry') {
      if (hasRrid(a)) links.push({ label: `RRID:${a.rrid}`, url: `https://www.antibodyregistry.org/${enc(a.rrid)}`, exact: true });
      else if (cat) links.push({ label: `Search for catalog number ${cat}`, url: `https://rrid.site/data/source/nif-0000-07730-1/search?q=${enc(cat)}`, exact: false });
    } else if (s.key === 'antibodypedia') search = searchText;
    else if (s.key === 'citeab') search = cat ? `${cat}${a.manufacturer ? ` ${a.manufacturer}` : ''}` : searchText;
    else if (s.key === 'nordiqc') search = searchText;
    if (!links.length || s.use === 'link') links.push({ label: s.key === 'immunoquery' ? 'Sign in to ImmunoQuery' : s.key === 'nordiqc' ? 'NordiQC epitope list' : `Open ${s.short}`, url: s.home, exact: false });
    return { key: s.key, name: s.name, use: s.use, access: s.access, what: s.what, caution: s.caution || '', links, search, saved: saved(s.key) };
  });
}

// ---------- reading files without holding them in memory ----------

const SIG_ZIP = 0x04034b50;
// Hands the text of a file to onChunk piece by piece: a plain file, a .gz, or the first .tsv/.csv/.txt inside a .zip
// (the HPA publishes proteinatlas.tsv.zip). Only the parts read are held, so a file of hundreds of megabytes is fine.
export async function readTextChunks(file, onChunk, { entry = /\.(tsv|csv|txt)$/i } = {}) {
  const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
  let stream; let name = file.name || '';
  if (head.length === 4 && new DataView(head.buffer).getUint32(0, true) === SIG_ZIP) {
    const e = await zipEntry(file, entry);
    name = e.name;
    const data = file.slice(e.start, e.start + e.size);
    if (e.method === 8) { needDecompression(); stream = data.stream().pipeThrough(new DecompressionStream('deflate-raw')); }
    else if (e.method === 0) stream = data.stream();
    else throw new Error(`${e.name} is compressed in a way this browser cannot read (method ${e.method}); unzip it and choose the file inside.`);
  } else if (head[0] === 0x1f && head[1] === 0x8b) { needDecompression(); stream = file.stream().pipeThrough(new DecompressionStream('gzip')); }
  else stream = file.stream();
  const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
  let chars = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chars += value.length;
      if (onChunk(value) === false) { await reader.cancel(); break; }
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  }
  return { name, chars };
}
const needDecompression = () => { if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot open compressed files; unzip it and choose the file inside.'); };

async function zipEntry(file, entry) {
  const tailLen = Math.min(file.size, 65557 + 22);
  const tail = new Uint8Array(await file.slice(file.size - tailLen).arrayBuffer());
  const tv = new DataView(tail.buffer);
  let eocd = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('This .zip file is damaged or incomplete.');
  let count = tv.getUint16(eocd + 10, true); let cdSize = tv.getUint32(eocd + 12, true); let cdOffset = tv.getUint32(eocd + 16, true);
  if (cdOffset === 0xffffffff || count === 0xffff) {   // ZIP64
    const loc = eocd - 20;
    if (loc < 0 || tv.getUint32(loc, true) !== 0x07064b50) throw new Error('This .zip file is damaged or incomplete.');
    const recAt = Number(tv.getBigUint64(loc + 8, true));
    const rec = new DataView(await file.slice(recAt, recAt + 56).arrayBuffer());
    if (rec.getUint32(0, true) !== 0x06064b50) throw new Error('This .zip file is damaged or incomplete.');
    count = Number(rec.getBigUint64(32, true)); cdSize = Number(rec.getBigUint64(40, true)); cdOffset = Number(rec.getBigUint64(48, true));
  }
  const cd = new Uint8Array(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const dv = new DataView(cd.buffer);
  const names = []; const found = [];
  for (let p = 0, k = 0; k < count && p + 46 <= cd.length; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const method = dv.getUint16(p + 10, true); let csize = dv.getUint32(p + 20, true); let usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true); const xlen = dv.getUint16(p + 30, true); const clen = dv.getUint16(p + 32, true);
    let local = dv.getUint32(p + 42, true);
    const nm = new TextDecoder().decode(cd.subarray(p + 46, p + 46 + nlen));
    // ZIP64 extra field: the 64-bit sizes and offset, in this order, for each 32-bit field that is 0xFFFFFFFF.
    for (let x = p + 46 + nlen; x + 4 <= p + 46 + nlen + xlen;) {
      const id = dv.getUint16(x, true); const len = dv.getUint16(x + 2, true);
      if (id === 0x0001) {
        let q = x + 4;
        if (usize === 0xffffffff) { usize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (csize === 0xffffffff) { csize = Number(dv.getBigUint64(q, true)); q += 8; }
        if (local === 0xffffffff) { local = Number(dv.getBigUint64(q, true)); }
      }
      x += 4 + len;
    }
    names.push(nm);
    if (!nm.endsWith('/') && !/(^|\/)__MACOSX\//.test(nm) && entry.test(nm)) found.push({ nm, method, csize, local });
    p += 46 + nlen + xlen + clen;
  }
  // A data file (.tsv, .csv) rather than a README.txt beside it.
  const pick = found.find((f) => /\.(tsv|csv)$/i.test(f.nm)) || found[0];
  if (pick) {
    const lh = new DataView(await file.slice(pick.local, pick.local + 30).arrayBuffer());
    if (lh.getUint32(0, true) !== SIG_ZIP) throw new Error('This .zip file is damaged or incomplete.');
    const start = pick.local + 30 + lh.getUint16(26, true) + lh.getUint16(28, true);
    return { name: pick.nm.split('/').pop(), method: pick.method, start, size: pick.csize };
  }
  throw new Error(`The .zip file has no .tsv or .csv file inside${names.length ? ` (it has ${names.slice(0, 3).join(', ')}${names.length > 3 ? '…' : ''})` : ''}.`);
}

// Splits text arriving in pieces into lines (a line may span two pieces).
export function lineSplitter(onLine) {
  let rest = '';
  return {
    push(t) { const lines = (rest + t).split('\n'); rest = lines.pop(); for (const l of lines) onLine(l.endsWith('\r') ? l.slice(0, -1) : l); },
    end() { if (rest) onLine(rest.endsWith('\r') ? rest.slice(0, -1) : rest); rest = ''; },
  };
}

// RFC 4180 CSV arriving in pieces: quoted fields with commas, doubled quotes and line breaks.
// delimiter 'auto' chooses tab or comma from the first line.
export function csvSplitter(onRow, delimiter = ',') {
  let row = []; let field = ''; let quoted = false; let afterQuote = false; let started = false;
  let head = delimiter === 'auto' ? '' : null;
  const emit = () => { row.push(field); onRow(row); row = []; field = ''; started = false; };
  const decide = () => { const first = head.split('\n')[0]; delimiter = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ','; const t = head; head = null; return t; };
  return {
    push(chunk) {
      let t = chunk;
      if (head !== null) { head += chunk; if (!head.includes('\n')) return; t = decide(); }
      for (let i = 0; i < t.length; i++) {
        const ch = t[i];
        if (afterQuote) {
          afterQuote = false;
          if (ch === '"') { field += '"'; continue; }
          quoted = false;
        }
        if (quoted) { if (ch === '"') afterQuote = true; else field += ch; continue; }
        if (ch === '"' && field === '' && !started) { quoted = true; started = true; continue; }
        if (ch === delimiter) { row.push(field); field = ''; started = false; continue; }
        if (ch === '\n') { emit(); continue; }
        if (ch === '\r') continue;
        field += ch; started = true;
      }
    },
    end() {
      if (head !== null) { const t = decide(); if (t) this.push(t); }
      afterQuote = false; quoted = false; if (field !== '' || row.length) emit();
    },
  };
}

const headerKey = (h) => String(h || '').replace(/^﻿/, '').trim().replace(/^"|"$/g, '').toLowerCase().replace(/[\s_\-#.]+/g, '');
function findColumns(header, spec) {
  const keys = header.map(headerKey);
  const col = {};
  for (const [field, aliases] of Object.entries(spec)) {
    const i = keys.findIndex((k) => aliases.includes(k));
    if (i >= 0) col[field] = i;
  }
  return col;
}

// ---------- the Human Protein Atlas files ----------

const HPA_SUMMARY = {
  gene: ['gene', 'genename'], synonyms: ['genesynonym', 'genesynonyms'], ensembl: ['ensembl', 'ensemblgeneid', 'ensemblid'], description: ['genedescription'],
  uniprot: ['uniprot'], evidence: ['evidence', 'hpaevidence', 'proteinevidence'], antibody: ['antibody', 'antibodies'],
  reliabilityIH: ['reliability(ih)', 'ihreliability', 'reliability(tissue)'], reliabilityIF: ['reliability(if)', 'ifreliability'],
  rrid: ['antibodyrrid', 'antibodyrrids'], tissueSpecificity: ['rnatissuespecificity'], tissueNtpm: ['rnatissuespecificntpm', 'rnatissuespecifictpm'],
};
const HPA_TISSUE = { ensembl: ['gene'], gene: ['genename'], tissue: ['tissue', 'ihctissuename'], cellType: ['celltype'], level: ['level'], reliability: ['reliability'] };
const LEVELS = ['High', 'Medium', 'Low'];
const clip = (s, n) => { const t = String(s ?? '').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// Reads either HPA file line by line, keeping only the genes the catalog may need (`wanted`: upper-case symbols and
// names; `wantedAntibodies`: HPA antibody IDs in catalog numbers):
//   proteinatlas.tsv (one row per gene): symbol, synonyms, Ensembl and UniProt IDs, IHC and IF reliability, the HPA
//     antibodies and their RRIDs, and RNA tissue specificity;
//   normal_tissue.tsv (one row per gene, tissue and cell type): the IHC staining level, kept for High, Medium and Low.
export function hpaReader({ wanted = [], wantedTissue = null, wantedAntibodies = [], maxGenes = 1500, maxTissueGenes = 600, maxTissueRows = 16 } = {}) {
  const keysOf = (list) => { const set = new Set(); for (const w of list) { set.add(nameKey(w)); set.add(looseKey(w)); } return set; };
  let want = keysOf(wanted);
  const wantAb = new Set([...wantedAntibodies].map((x) => String(x).toUpperCase()));
  let kind = null; let col = null; let rows = 0; let capped = false;
  const genes = new Map(); const tissue = new Map();
  const wantedName = (s) => { const t = String(s || '').trim(); return !!t && (want.has(nameKey(t)) || want.has(looseKey(t))); };
  const cell = (cells, k) => (col[k] == null ? '' : String(cells[col[k]] ?? '').trim().replace(/^"|"$/g, ''));
  return {
    line(raw) {
      if (!raw.trim()) return;
      const cells = raw.split('\t');
      if (!kind) {
        if (cells.length < 3) throw new Error('This is not a tab-separated HPA download. Choose proteinatlas.tsv (or .tsv.zip) or normal_tissue.tsv from proteinatlas.org/about/download.');
        const t = findColumns(cells, HPA_TISSUE); const s = findColumns(cells, HPA_SUMMARY);
        if (t.level != null && t.cellType != null && t.gene != null && t.tissue != null) { kind = 'tissue'; col = t; if (wantedTissue) want = keysOf(wantedTissue); }
        else if (s.gene != null && s.ensembl != null) { kind = 'summary'; col = s; }
        else throw new Error(`The file's columns are not those of an HPA download (it starts ${cells.slice(0, 4).join(', ')}). Choose proteinatlas.tsv or normal_tissue.tsv.`);
        return;
      }
      rows++;
      if (kind === 'summary') {
        const gene = cell(cells, 'gene');
        if (!gene) return;
        const synonyms = cell(cells, 'synonyms').split(/\s*,\s*/).filter(Boolean);
        const antibodyIds = cell(cells, 'antibody').split(/[\s,;]+/).filter((x) => /^[A-Za-z]{2,5}\d{4,7}$/.test(x)).map((x) => x.toUpperCase().replace(/^AMAB/, 'AMAb'));
        if (!(wantedName(gene) || synonyms.some(wantedName) || antibodyIds.some((x) => wantAb.has(x.toUpperCase())))) return;
        if (genes.size >= maxGenes && !genes.has(geneKey(gene))) { capped = true; return; }
        const rridText = cell(cells, 'rrid');
        const pairs = new Map([...rridText.matchAll(/([A-Za-z]{2,5}\d{4,7})\W{0,4}?(AB_\d+)/g)].map((m) => [m[1].toUpperCase().replace(/^AMAB/, 'AMAb'), m[2]]));
        const bare = [...rridText.matchAll(/AB_\d+/g)].map((m) => m[0]);
        const antibodies = antibodyIds.slice(0, 12).map((id, i) => ({ id, rrid: pairs.get(id) || (!pairs.size && bare.length === antibodyIds.length ? bare[i] : '') }));
        genes.set(geneKey(gene), {
          gene, ensembl: cell(cells, 'ensembl'), synonyms: synonyms.slice(0, 15).map((x) => clip(x, 40)), description: clip(cell(cells, 'description'), 160),
          uniprot: cell(cells, 'uniprot').split(/[\s,;]+/).filter((x) => UNIPROT.test(x)).slice(0, 3), evidence: clip(cell(cells, 'evidence'), 60),
          reliabilityIH: clip(cell(cells, 'reliabilityIH'), 30), reliabilityIF: clip(cell(cells, 'reliabilityIF'), 30), antibodies,
          tissueSpecificity: clip(cell(cells, 'tissueSpecificity'), 60), tissueNtpm: clip(cell(cells, 'tissueNtpm'), 200),
        });
      } else {
        const gene = cell(cells, 'gene');
        if (!gene || !wantedName(gene)) return;
        const level = LEVELS.find((l) => l.toLowerCase() === cell(cells, 'level').toLowerCase());
        const k = geneKey(gene);
        if (!tissue.has(k)) {
          if (tissue.size >= maxTissueGenes) { capped = true; return; }
          tissue.set(k, { gene, ensembl: cell(cells, 'ensembl'), reliability: '', rows: [] });
        }
        const t = tissue.get(k);
        t.reliability ||= clip(cell(cells, 'reliability'), 30);
        if (level) t.rows.push({ tissue: clip(cell(cells, 'tissue'), 60), cell: clip(cell(cells, 'cellType'), 60), level });
      }
    },
    result() {
      if (!kind) throw new Error('The file is empty.');
      const missing = Object.keys(kind === 'summary' ? HPA_SUMMARY : HPA_TISSUE).filter((k) => col[k] == null);
      if (kind === 'summary') return { kind, rows, capped, missing, genes: [...genes.values()] };
      const order = (l) => LEVELS.indexOf(l);
      return { kind, rows, capped, missing, tissue: [...tissue.values()].map((t) => ({ ...t, rows: t.rows.sort((x, y) => order(x.level) - order(y.level)).slice(0, maxTissueRows) })) };
    },
  };
}

// ---------- the Antibody Registry download ----------

const REGISTRY = {
  rrid: ['rrid', 'abid', 'antibodyid', 'abidentifier'], citation: ['propercitation', 'citation'], catalog: ['catalognum', 'catalognumber', 'catnum', 'catalog', 'catno', 'catalognumbers'],
  vendor: ['vendor', 'vendorname', 'company', 'manufacturer', 'supplier'], name: ['abname', 'antibodyname', 'name', 'productname'],
  target: ['abtarget', 'targetantigen', 'target', 'antigen'], clone: ['cloneid', 'clone'],
};
const toRrid = (v) => { const s = String(v || '').trim(); const m = s.match(/AB_(\d{1,10})/i); return m ? `AB_${m[1]}` : /^\d{1,10}$/.test(s) ? `AB_${s}` : ''; };

// Keeps the registry rows whose catalog number matches a catalog antibody's: the same number, a size or format of it
// ("14-0195" -> "14-0195-82"), or a letter suffix ("9027" -> "9027S"). The download has millions of rows; the few hundred
// that match are kept (3,000 at most).
export function registryReader({ catalogs = [], maxRows = 3000 } = {}) {
  const keys = new Set(); const raws = new Set();
  for (const c of catalogs) { const r = catalogRaw(c); if (r) { raws.add(r); keys.add(r.replace(/-/g, '')); } }
  let col = null; let rows = 0; let capped = false;
  const kept = [];
  const matches = (rr) => {
    const rk = rr.replace(/-/g, '');
    if (keys.has(rk)) return true;
    if (/[A-Z]$/.test(rk) && keys.has(rk.slice(0, -1))) return true;
    for (let i = rr.lastIndexOf('-'); i > 0; i = rr.lastIndexOf('-', i - 1)) if (raws.has(rr.slice(0, i))) return true;
    return false;
  };
  return {
    row(cells) {
      if (cells.every((c) => !String(c).trim())) return;   // blank lines, before the header or between rows
      if (!col) {
        col = findColumns(cells, REGISTRY);
        if ((col.rrid == null && col.citation == null) || col.catalog == null) {
          const got = cells.slice(0, 6).join(', ');
          col = null;
          throw new Error(`The file needs an RRID (or proper citation) column and a catalog number column; it has ${got}. Download the registry list from antibodyregistry.org (signed in).`);
        }
        return;
      }
      rows++;
      const get = (k) => (col[k] == null ? '' : String(cells[col[k]] ?? '').trim());
      const catalog = get('catalog');
      if (!catalog) return;
      const rr = catalogRaw(catalog);
      if (!rr || !matches(rr)) return;
      const rrid = toRrid(get('rrid')) || toRrid(get('citation'));
      if (!rrid) return;
      if (kept.length >= maxRows) { capped = true; return; }
      kept.push({ rrid, catalog: clip(catalog, 40), vendor: clip(get('vendor'), 80), name: clip(get('name'), 120), target: clip(get('target'), 60), clone: clip(get('clone'), 40) });
    },
    result() {
      if (!col) throw new Error('The file is empty.');
      return { rows, capped, kept };
    },
  };
}

// What the browser should keep when reading the big files, from the catalog: symbols and names for the HPA, single
// catalog numbers for the registry.
export function importWants(assays, hpaGenes = {}) {
  const loaded = Object.keys(hpaGenes).length > 0;
  const idx = loaded ? buildSynonymIndex(hpaGenes) : null;
  const symbols = new Set(); const antibodies = new Set(); const catalogs = new Set(); const tissueSymbols = new Set();
  for (const a of assays) {
    if (a.status === 'Duplicate') continue;
    if (hasGene(a)) { symbols.add(geneKey(a.target)); tissueSymbols.add(geneKey(a.target)); }
    const id = hpaAntibodyId(a.catalog); if (id) antibodies.add(id);
    if (!singleAntibody(a)) continue;
    const c = catalogRaw(a.catalog); if (c) catalogs.add(c);
    if (hasGene(a)) continue;
    for (const p of namePhrases(a.name).phrases) {
      if (p.length < 2 || !/[a-z]/.test(p)) continue;
      symbols.add(p.toUpperCase());
      const alias = aliasOf(p);
      if (alias) { symbols.add(alias); tissueSymbols.add(alias); }
    }
    const best = targetCandidates(a, loaded ? hpaGenes : null, loaded ? idx : null)[0];
    if (best && best.symbol !== 'N/A') tissueSymbols.add(geneKey(best.symbol));
  }
  for (const k of Object.keys(hpaGenes)) symbols.add(k);
  return { symbols: [...symbols], antibodies: [...antibodies], catalogs: [...catalogs], tissueSymbols: [...tissueSymbols] };
}
