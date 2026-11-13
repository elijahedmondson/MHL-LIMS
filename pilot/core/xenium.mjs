// 10x Genomics Xenium runs: the steps a run goes through, the assays and pre-designed panels, and the checks made
// before a run is planned. Pure, shared by the core and the browser.
//
// The Xenium Analyzer images two Xenium slides per run. Sections are placed in each slide's imageable area, taken
// through probe hybridization, ligation and amplification (with optional multimodal cell segmentation staining), then
// imaged and decoded on the instrument; afterwards the same sections can be H&E stained. Panel names follow 10x
// Genomics' catalog; MHL should keep the list to the panels it stocks.

export const SLIDES_PER_RUN = 2;

export const STEPS = [
  ['PLANNED', 'Planned'],
  ['SECTIONED', 'Sections placed on Xenium slides'],
  ['PROBES', 'Probe hybridization, ligation and amplification'],
  ['LOADED', 'On the Xenium Analyzer'],
  ['RUN_DONE', 'Instrument run complete'],
  ['POST_STAIN', 'Post-run H&E stained'],
  ['DELIVERED', 'Data delivered'],
];
export const ENDED = { FAILED: 'Failed', CANCELLED: 'Cancelled' };
export const stepLabel = (code) => STEPS.find(([c]) => c === code)?.[1] || ENDED[code] || code;
export const stepIndex = (code) => STEPS.findIndex(([c]) => c === code);
export const isActive = (run) => !['DELIVERED', 'FAILED', 'CANCELLED'].includes(run.status);
export const nextStep = (code) => STEPS[stepIndex(code) + 1]?.[0] || null;

export const ASSAYS = [
  ['V1', 'Xenium In Situ Gene Expression'],
  ['PRIME', 'Xenium Prime 5K Gene Expression'],
  ['PROTEIN', 'Xenium In Situ Gene and Protein Expression'],
];
export const assayName = (code) => ASSAYS.find(([c]) => c === code)?.[1] || code;

// species: the material a panel is designed for. 'Any' for a custom panel.
export const PANELS = [
  { id: 'H-MTC', assay: 'V1', species: 'Human', name: 'Human Multi-Tissue and Cancer' },
  { id: 'H-IO', assay: 'V1', species: 'Human', name: 'Human Immuno-Oncology' },
  { id: 'H-BREAST', assay: 'V1', species: 'Human', name: 'Human Breast' },
  { id: 'H-BRAIN', assay: 'V1', species: 'Human', name: 'Human Brain' },
  { id: 'H-LUNG', assay: 'V1', species: 'Human', name: 'Human Lung' },
  { id: 'H-COLON', assay: 'V1', species: 'Human', name: 'Human Colon' },
  { id: 'H-SKIN', assay: 'V1', species: 'Human', name: 'Human Skin' },
  { id: 'M-BRAIN', assay: 'V1', species: 'Mouse', name: 'Mouse Brain' },
  { id: 'M-ATLAS', assay: 'V1', species: 'Mouse', name: 'Mouse Tissue Atlassing' },
  { id: 'H-5K', assay: 'PRIME', species: 'Human', name: 'Xenium Prime 5K Human Pan Tissue and Pathways' },
  { id: 'M-5K', assay: 'PRIME', species: 'Mouse', name: 'Xenium Prime 5K Mouse Pan Tissue and Pathways' },
  { id: 'CUSTOM', assay: 'V1', species: 'Any', name: 'Custom panel (Xenium Panel Designer)' },
];
export const panelById = (id) => PANELS.find((p) => p.id === id) || null;

// What each LIMS species is, for matching panels: PDX tumors are human cells in a mouse.
const SPECIES_IS = { HUMAN: ['Human'], PDX: ['Human', 'Mouse'], MOUSE: ['Mouse'], RAT: ['Rat'], ORGANOID: ['Human', 'Mouse'], OTHER: [] };

// Warnings, not errors: the lab decides.
export function panelWarnings({ assay, panelId, segmentation }, speciesCodes) {
  const out = [];
  const panel = panelById(panelId);
  if (!panel) return ['Choose a panel.'];
  if (panel.assay !== assay && !(assay === 'PROTEIN' && panel.assay === 'V1')) out.push(`${panel.name} is a ${assayName(panel.assay)} panel, not ${assayName(assay)}.`);
  if (assay === 'PROTEIN' && panel.assay === 'PRIME') out.push('Protein detection is not available with Xenium Prime 5K.');
  if (panel.species !== 'Any') {
    for (const sp of [...new Set(speciesCodes)]) {
      const is = SPECIES_IS[sp] || [];
      if (sp === 'ORGANOID') out.push(`Organoids: check that the organoid lines are ${panel.species.toLowerCase()} for the ${panel.name} panel.`);
      else if (is.length && !is.includes(panel.species)) out.push(`${panel.name} is designed for ${panel.species.toLowerCase()} tissue; this run has ${sp.toLowerCase()} material.`);
      else if (sp === 'PDX') out.push(`PDX: the ${panel.name} panel detects the ${panel.species.toLowerCase()} cells (${panel.species === 'Human' ? 'tumor' : 'mouse stroma'}) only.`);
    }
  }
  if (segmentation && assay === 'PROTEIN') out.push('Check whether cell segmentation staining is used together with the protein panel.');
  return out;
}

// The sections on a run, as typed: slides 1 and 2, each with PHL numbers; a PHL number on one slide only.
export function slidesProblems(slides) {
  const out = [];
  if (!Array.isArray(slides) || !slides.length) return ['Put at least one section on a slide.'];
  if (slides.length > SLIDES_PER_RUN) out.push(`The Xenium Analyzer takes ${SLIDES_PER_RUN} slides per run.`);
  const seen = new Set();
  if (new Set(slides.map((s) => s.slot)).size < slides.length) out.push('Each slide has its own slot, 1 or 2.');
  for (const s of slides) {
    if (![1, 2].includes(s.slot)) out.push('A slide is slot 1 or 2.');
    for (const id of s.subjectIds || []) { if (seen.has(id)) out.push('A PHL number can be on only one slide of a run.'); seen.add(id); }
  }
  if (!seen.size) out.push('Put at least one section on a slide.');
  return [...new Set(out)];
}

// Quality numbers from the run summary that Xenium Onboard Analysis writes.
export const QC_FIELDS = [
  ['cells', 'Cells detected', ''], ['transcriptsPerCell', 'Median transcripts per cell', ''], ['genesPerCell', 'Median genes per cell', ''],
  ['q20', 'Decoded transcripts with Q-score of 20 or more', '%'], ['areaMm2', 'Region imaged', 'mm²'],
];
