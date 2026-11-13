// Reference definitions for the pilot: work areas, request types, necropsy dictionaries and protocols.
// The dictionaries are reasonable starting values; replace them with Zaphod's own lists during migration.

export const AREAS = [
  { code: 'ENTRY', name: 'Accessioned' }, { code: 'NECRO', name: 'Necropsy' }, { code: 'BLOOD', name: 'Blood' },
  { code: 'TRIMM', name: 'Trim' }, { code: 'EMBED', name: 'Embed' }, { code: 'MICRO', name: 'Microtomy' },
  { code: 'STAIN', name: 'Stain' }, { code: 'SPATL', name: 'Xenium' }, { code: 'IMAGE', name: 'Scan' },
  { code: 'PATHO', name: 'Pathology' }, { code: 'QC-PA', name: 'Complete' },
];
export const AREA_ORDER = AREAS.map((a) => a.code);
export const TERMINAL_AREAS = ['QC-PA'];

// plan: [section, charge code, units per PHL number] used to suggest an estimate.
export const REQUEST_TYPES = {
  'NECRO-FULL': { name: 'Necropsy, histology and pathology', lab: 'HP', days: 30, areas: ['NECRO', 'BLOOD', 'TRIMM', 'EMBED', 'MICRO', 'STAIN', 'IMAGE', 'PATHO'],
    plan: [['NECRO', 'HP002001', 1], ['NECRO', 'HP002021', 1], ['TRIM_EMBED', 'HP003003', 3], ['MICROTOMY', 'HP004001', 3], ['STAIN', 'HP005003', 3], ['IMAGE', 'HP001006', 3], ['PATH', 'PA001002', 3]] },
  'HISTO': { name: 'Histology only (fixed tissue received)', lab: 'HP', days: 14, areas: ['TRIMM', 'EMBED', 'MICRO', 'STAIN'],
    plan: [['TRIM_EMBED', 'HP003003', 1], ['MICROTOMY', 'HP004001', 1], ['STAIN', 'HP005003', 1]] },
  'MOLEC': { name: 'IHC, RNAscope or multiplex IF', lab: 'HP', days: 21, areas: ['MICRO', 'STAIN', 'IMAGE'],
    plan: [['MICROTOMY', 'HP004001', 1], ['STAIN', 'HP006004', 1], ['IMAGE', 'HP001006', 1]] },
  'XENIUM': { name: '10x Xenium spatial', lab: 'HP', days: 30, areas: ['MICRO', 'STAIN', 'SPATL', 'IMAGE'],
    plan: [['MICROTOMY', 'HP004001', 1], ['STAIN', 'HP005003', 1], ['IMAGE', 'HP001007', 1]] },
  'SCAN': { name: 'Slide scanning only', lab: 'HP', days: 5, areas: ['IMAGE'], plan: [['IMAGE', 'HP001007', 1]] },
  'PATH-ONLY': { name: 'Pathology review of submitted slides', lab: 'PA', days: 14, areas: ['PATHO'], plan: [['PATH', 'PA001002', 1]] },
};

export const SPECIES = {
  MOUSE: { name: 'Mouse', subjectType: 'MOUSE', restricted: false },
  RAT: { name: 'Rat', subjectType: 'RAT', restricted: false },
  HUMAN: { name: 'Human (coded)', subjectType: 'HUMAN_DONOR', restricted: true },
  PDX: { name: 'PDX model', subjectType: 'PDX_MODEL', restricted: true },
  ORGANOID: { name: 'Organoid line', subjectType: 'ORGANOID_LINE', restricted: true },
  OTHER: { name: 'Other', subjectType: 'OTHER', restricted: false },
};

export const DICTIONARIES = {
  sites: ['Diffuse', 'Multifocal', 'Focal', 'Left', 'Right', 'Bilateral', 'Cranial', 'Caudal', 'Left lateral lobe', 'Median lobe', 'Right lobe', 'Caudate lobe', 'Cortex', 'Medulla', 'Capsule'],
  morphology: ['Mass', 'Nodule', 'Cyst', 'Enlarged', 'Small', 'Discoloration', 'Focus', 'Foci', 'Adhesion', 'Fluid', 'Hemorrhage', 'Thickened', 'Ulcer', 'Abscess', 'Missing'],
  shapes: ['Round', 'Oval', 'Irregular', 'Plaque-like', 'Pedunculated', 'Multilobulated'],
  colors: ['White', 'Tan', 'Pale', 'Red', 'Dark red', 'Black', 'Yellow', 'Green', 'Mottled', 'Gray'],
  consistencies: ['Soft', 'Firm', 'Hard', 'Fluctuant', 'Friable', 'Gritty'],
  fixation: ['NBF', 'OCT', 'LN2', 'PBS'],
  fates: ['Scheduled euthanasia', 'Moribund euthanasia', 'Found dead', 'Accidental death'],
  conditions: ['Good', 'Mild autolysis', 'Moderate autolysis', 'Severe autolysis'],
  physicalIds: ['Ear tag', 'Ear punch', 'Tattoo', 'Toe clip', 'Microchip', 'Cage card only'],
};

// Billable necropsy procedures. Approving a necropsy turns the ticked ones into pending charges.
export const NECROPSY_EXTRAS = [
  { key: 'terminalBleed', label: 'Terminal bleed (heart stick)', code: 'HP002005', kind: 'check' },
  { key: 'bloodCollection', label: 'Blood collection', code: 'HP002021', kind: 'check' },
  { key: 'boneMarrowSmear', label: 'Bone marrow smear', code: 'HP002010', kind: 'check' },
  { key: 'biohazard', label: 'Biohazard disposal', code: 'HP002006', kind: 'check' },
  { key: 'snapFreezeTubes', label: 'Snap-frozen tubes', code: 'HP002016', kind: 'count' },
  { key: 'bloodSmearPairs', label: 'Blood smears (pairs of slides)', code: 'HP002019', kind: 'count' },
];
export const PERFUSION_CODES = { whole: 'HP002007', lung: 'HP002008', liver: 'HP002009' };

// Pathologists an investigator can name on an IHC request. Fictional placeholders; replace with MHL's list.
export const PATHOLOGISTS = ['Any MHL pathologist', 'Dr. N. Achterberg', 'Dr. K. Mensah', 'Dr. P. Szabo'];

const organ = (name, weigh, block) => ({ organ: name, weigh, block });
export const PROTOCOLS = [
  { id: 1, name: 'Mouse full necropsy (standard)', bodyWeight: true, perfusion: '',
    organs: [organ('Brain', true, 1), organ('Heart', true, 2), organ('Lungs', true, 2), organ('Thymus', false, 2), organ('Liver', true, 3),
      organ('Spleen', true, 4), organ('Kidneys', true, 4), organ('Adrenal glands', false, 5), organ('Pancreas', false, 5),
      organ('Lymph nodes', false, 5), organ('Stomach', false, 6), organ('Small intestine', false, 6), organ('Large intestine', false, 6),
      organ('Skin', false, 7), organ('Skeletal muscle', false, 7), organ('Femur and bone marrow', false, 8),
      organ('Reproductive tract', false, 9), organ('Urinary bladder', false, 9)] },
  { id: 2, name: 'Tumor study (targeted)', bodyWeight: true, perfusion: '',
    organs: [organ('Tumor', true, 1), organ('Lungs', true, 2), organ('Liver', true, 3), organ('Spleen', true, 4), organ('Lymph nodes', false, 5)] },
  { id: 3, name: 'Lung perfusion', bodyWeight: true, perfusion: 'lung',
    organs: [organ('Lungs', true, 1), organ('Trachea', false, 1), organ('Heart', true, 2), organ('Liver', true, 3)] },
];
