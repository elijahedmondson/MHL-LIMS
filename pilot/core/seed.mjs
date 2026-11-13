// Fictional pilot data, created by replaying a realistic history through the core API on past dates,
// so every record obeys the same rules as data entered by hand (prices, statuses, audit trail).
// Investigators, NAS numbers and projects are invented; dates are relative to the day the data is created.

import { createCore, emptyState, addDays, loadAssays } from './core.mjs';
import { REQUEST_TYPES } from './defs.mjs';
import * as ESTX from './estimates.mjs';

function mulberry32(seed) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PEOPLE = {
  nakamura: { requesterLast: 'Nakamura', requesterFirst: 'Rei', inst: 'NCI/DCTD, Developmental Therapeutics' },
  okafor: { requesterLast: 'Okafor', requesterFirst: 'Adaeze', inst: 'NCI/CCR, Laboratory of Cancer Biology' },
  lindqvist: { requesterLast: 'Lindqvist', requesterFirst: 'Maren', inst: 'NCI/CCR, Tumor Immunology Section' },
  petrakis: { requesterLast: 'Petrakis', requesterFirst: 'Ilias', inst: 'NCI/CCR, Gastrointestinal Malignancies' },
  haddad: { requesterLast: 'Haddad', requesterFirst: 'Samir', inst: 'NCI/CCR, Comparative Oncology' },
  rivera: { requesterLast: 'Rivera', requesterFirst: 'Jordan', inst: 'NCI/CCR, Imaging Biomarkers' },
  brennan: { requesterLast: 'Brennan', requesterFirst: 'Cole', inst: 'NCI/CCR, Mouse Cancer Genetics' },
  abernathy: { requesterLast: 'Abernathy', requesterFirst: 'Grace', inst: 'NCI/CCR, Pediatric Oncology' },
  sato: { requesterLast: 'Sato', requesterFirst: 'Kenji', inst: 'NCI/CCR, Neuro-Oncology' },
  moreau: { requesterLast: 'Moreau', requesterFirst: 'Claire', inst: 'NCI/DCEG, Molecular Epidemiology' },
};

const lines = (rows) => rows.map(([section, code, units]) => ({ section, code, units }));

// Investigators who place IHC requests through the web form. Contact details are fictional.
const WEB = {
  varga: { requester: { last: 'Varga', first: 'Eszter', inst: 'NCI/CCR, Thoracic and GI Malignancies', building: '10/4B21', phone: '240-555-0142', email: 'eszter.varga@example.org' }, billTo: 'Varga', projectId: '25X0023117.01' },
  okafor: { requester: { last: 'Okafor', first: 'Adaeze', inst: 'NCI/CCR, Laboratory of Cancer Biology', building: '560/21-12', phone: '301-555-0177', email: 'adaeze.okafor@example.org' }, billTo: 'Okafor', projectId: '25X0012345.01' },
  whitcombe: { requester: { last: 'Whitcombe', first: 'Daniel', inst: 'NCI/CCR, Laboratory of Cell Biology', building: '37/5002', phone: '240-555-0109', email: 'daniel.whitcombe@example.org' }, billTo: 'Whitcombe', projectId: '25X0016610.02' },
  ferreira: { requester: { last: 'Ferreira', first: 'Lucia', inst: 'NCI/CCR, Cancer Innovation Laboratory', building: '1050/116', phone: '301-555-0163', email: 'lucia.ferreira@example.org' }, billTo: 'Ferreira', projectId: '25X0024052.01' },
};

export function seedState({ priceList, ihcCatalog = null, today }) {
  const state = emptyState(today);
  state.assays = loadAssays(ihcCatalog);
  const years = [...new Set([addDays(today, -60), today].map((d) => d.slice(2, 4)))];
  state.counters = { id: 1000, PHL: {}, 'REQ-HP': {}, 'REQ-PA': {}, NAS: {}, ZAP: {}, MH: {} };
  for (const yy of years) { state.counters.PHL[yy] = 280; state.counters['REQ-HP'][yy] = 96; state.counters['REQ-PA'][yy] = 8; state.counters.MH[yy] = 150; }

  let minute = 0;
  const clock = { day: today };
  clock.today = () => clock.day;
  clock.now = () => { minute = (minute + 7) % 480; return `${clock.day}T${String(8 + Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}:00`; };
  const core = createCore({ state, priceList, ihcCatalog, clock });
  const call = (method, path, body = null, query = {}) => {
    const res = core.handle(method, path, query, body);
    if (res.status !== 200) throw new Error(`Seed step failed: ${method} ${path}: ${res.json && res.json.error}`);
    return res.json;
  };
  const on = (offset, initials) => { clock.day = addDays(today, offset); state.settings.initials = initials; };
  const yy = (offset) => addDays(today, offset).slice(2, 4);
  const subjectsOf = (requestId) => state.subjects.filter((s) => s.requestId === requestId).sort((a, b) => a.phl.localeCompare(b.phl));
  const moveAll = (requestId, to, pick = (list) => list) => call('POST', `/api/requests/${requestId}/move`, { to, subjectIds: pick(subjectsOf(requestId)).map((s) => s.id) });
  const charge = (requestId, section, code, units, note) => call('POST', `/api/requests/${requestId}/charges`, { section, code, units, note, date: clock.day }).charge;
  const nas = (who, number, extra) => call('POST', '/api/nas', { ...PEOPLE[who], number, ...extra }).nas;
  const ids = {};

  // ---- Nakamura: histology only, completed and billed last period ----
  on(-58, 'BA'); ids.nasNak = nas('nakamura', `${yy(-58)}-0389`, { project: '25X0011873.04', authorized: 900, type: 'HISTO', n: 20, species: 'MOUSE', description: 'Histology on 20 fixed tissues from a dosing study.' }).id;
  on(-55, 'KT'); ids.nak = call('POST', '/api/requests', { nasId: ids.nasNak, type: 'HISTO', n: 20, species: 'MOUSE', lines: lines([['TRIM_EMBED', 'HP003003', 20], ['MICROTOMY', 'HP004001', 20], ['STAIN', 'HP005003', 20]]) }).id;
  on(-53, 'KT'); moveAll(ids.nak, 'TRIMM');
  on(-52, 'KT'); moveAll(ids.nak, 'EMBED'); charge(ids.nak, 'TRIM_EMBED', 'HP003003', 20);
  on(-47, 'JM'); moveAll(ids.nak, 'MICRO'); charge(ids.nak, 'MICROTOMY', 'HP004001', 20);
  on(-41, 'JM'); moveAll(ids.nak, 'STAIN'); charge(ids.nak, 'STAIN', 'HP005003', 20);

  // ---- Okafor: necropsy study ZAP2215 ----
  on(-38, 'BA'); ids.nasOka = nas('okafor', `${yy(-38)}-0412`, { project: '25X0012345.01', authorized: 4200, type: 'NECRO-FULL', n: 12, species: 'MOUSE', description: 'Necropsy, histology and pathology for 12 KrasG12D; Trp53fl/fl mice, three tissues per animal.' }).id;
  on(-36, 'KT');
  ids.oka = call('POST', '/api/requests', {
    nasId: ids.nasOka, type: 'NECRO-FULL', n: 12, species: 'MOUSE',
    study: { mode: 'new', zap: 'ZAP2215', title: 'Tumor latency in KrasG12D; Trp53fl/fl mice', acuc: 'ASP-24-117', protocolId: 1 },
    lines: lines([['NECRO', 'HP002001', 12], ['NECRO', 'HP002021', 12], ['TRIM_EMBED', 'HP003003', 36], ['MICROTOMY', 'HP004001', 36], ['STAIN', 'HP005003', 36], ['IMAGE', 'HP001006', 36], ['PATH', 'PA001002', 36]]),
  }).id;
  const okaStudy = state.studies.find((s) => s.zap === 'ZAP2215');
  call('PUT', `/api/studies/${okaStudy.id}/groups`, { groups: [
    { code: 'G1', name: 'Vehicle', sex: 'F', treatment: 'Vehicle, daily oral gavage' },
    { code: 'G2', name: 'Compound A', sex: 'F', treatment: 'Compound A 30 mg/kg, daily oral gavage' },
    { code: 'G3', name: 'Compound A', sex: 'M', treatment: 'Compound A 30 mg/kg, daily oral gavage' }] });
  subjectsOf(ids.oka).forEach((s, i) => call('PATCH', `/api/subjects/${s.id}`, { groupCode: ['G1', 'G2', 'G3'][Math.floor(i / 4)] }));

  on(-35, 'KT');
  const rnd = mulberry32(2215);
  const normal = (mean, sd) => { const u = Math.max(rnd(), 1e-9); const v = rnd(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const r3 = (x) => Math.round(x * 1000) / 1000;
  subjectsOf(ids.oka).forEach((s) => {
    const g = s.groupCode; const male = s.sex === 'M'; const treated = g !== 'G1';
    const base = call('GET', `/api/necropsy/${s.id}`).necropsy;
    const weights = {
      Brain: normal(male ? 0.47 : 0.48, 0.012), Heart: normal(male ? 0.13 : 0.115, 0.008),
      Lungs: treated ? normal(0.21, 0.03) : normal(0.31, 0.05), Liver: normal(male ? 1.35 : 1.15, 0.08) * (treated ? 1.15 : 1),
      Spleen: treated ? normal(0.11, 0.02) : normal(0.075, 0.01), Kidneys: normal(male ? 0.36 : 0.29, 0.02),
    };
    const nodules = treated ? 1 + Math.floor(rnd() * 3) : 5 + Math.floor(rnd() * 6);
    const organs = base.organs.map((o) => {
      const findings = [];
      if (o.organ === 'Lungs') findings.push({ site: 'Multifocal', morphology: 'Nodule', qty: nodules, shape: 'Round', color: 'White', consistency: 'Firm', sizeMm: treated ? 1 : 2 + Math.floor(rnd() * 3), fixation: ['NBF'] });
      if (o.organ === 'Spleen' && treated && rnd() > 0.35) findings.push({ site: 'Diffuse', morphology: 'Enlarged', color: 'Dark red', fixation: ['NBF'] });
      if (o.organ === 'Liver' && g === 'G3' && rnd() > 0.5) findings.push({ site: 'Diffuse', morphology: 'Discoloration', color: 'Pale', fixation: ['NBF'], notes: 'Accentuated lobular pattern' });
      return { ...o, weight: o.weigh ? r3(weights[o.organ]) : null, findings };
    });
    const nec = { ...base, prosector: 'KT', bodyWeight: Math.round(normal(male ? 26 : 22.5, 1.5) * 10) / 10, matchesCageCard: true, organs,
      extras: { ...base.extras, bloodCollection: true }, observations: treated ? '' : 'Moderate respiratory effort before euthanasia.' };
    call('PUT', `/api/necropsy/${s.id}`, nec);
    call('POST', `/api/necropsy/${s.id}/approve`, {});
  });

  // Terminal blood from the necropsy: hematology (a Hemavet DMS sheet) and chemistry (VS2 printouts captured by PuTTY),
  // imported and released through the same API as a real file, so ZAP2215 has bloodwork to summarize.
  {
    const br = mulberry32(2216);
    const nv = (mean, sd) => { const u = Math.max(br(), 1e-9); const v = br(); return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
    const animals = subjectsOf(ids.oka);
    const fx = (x, d) => x.toFixed(d);
    const heme = animals.map((s) => {
      const tumors = s.groupCode === 'G1';
      const wbc = nv(tumors ? 9.8 : 6.4, 1.1); const ne = wbc * (tumors ? 0.32 : 0.16); const ly = wbc * (tumors ? 0.6 : 0.77); const mo = wbc * 0.05; const eo = wbc * 0.025;
      const rbc = nv(9.4, 0.4); const hct = rbc * nv(4.95, 0.08);
      return { s, v: { WBC: fx(wbc, 2), NE: fx(ne, 2), LY: fx(ly, 2), MO: fx(mo, 2), EO: fx(eo, 2), BA: '0.01', 'NE%': fx((ne / wbc) * 100, 1), 'LY%': fx((ly / wbc) * 100, 1),
        'MO%': '5.0', 'EO%': '2.5', 'BA%': '0.1', RBC: fx(rbc, 2), HB: fx(rbc * 1.5, 1), HCT: fx(hct, 1), MCV: fx((hct / rbc) * 10, 1), MCH: fx(15.1, 1), MCHC: fx((rbc * 1.5 / hct) * 100, 1),
        RDW: fx(nv(17, 0.6), 1), PLT: String(Math.round(nv(tumors ? 1150 : 880, 90))), MPV: fx(nv(5.3, 0.2), 1) },
        flags: tumors ? { WBC: 'H', NE: 'H' } : {} };
    });
    const ROWS = { WBC: 6, NE: 7, LY: 8, MO: 9, EO: 10, BA: 11, 'NE%': 13, 'LY%': 14, 'MO%': 15, 'EO%': 16, 'BA%': 17, RBC: 19, HB: 20, HCT: 21, MCV: 22, MCH: 23, MCHC: 24, RDW: 25, PLT: 28, MPV: 29 };
    const grid = Array.from({ length: 29 }, () => Array(2 + heme.length * 2).fill(''));
    heme.forEach(({ s, v, flags }, k) => {
      const vc = 2 + 2 * k;
      grid[0][vc + 1] = s.phl; grid[1][vc + 1] = String(500 + k); grid[3][vc + 1] = clock.today(); grid[4][vc + 1] = `10:${String(5 + k * 2).padStart(2, '0')}`;
      for (const [code, row] of Object.entries(ROWS)) { grid[row - 1][vc] = v[code]; grid[row - 1][vc + 1] = flags[code] || ''; }
    });
    call('POST', '/api/bloodwork/import', { fileName: `Hemavet export ${clock.today()}.xls`, grid });
    const CHEM = [['ALB', 'g/dL', '2.5-4.8', 3.1, 0.2, 1], ['ALP', 'U/L', '62-209', 95, 15, 0], ['ALT', 'U/L', '28-132', 42, 8, 0], ['AMY', 'U/L', '211-563', 390, 40, 0],
      ['TBIL', 'mg/dL', '0.1-0.9', 0.3, 0.05, 1], ['BUN', 'mg/dL', '18-29', 22, 2.5, 0], ['CA', 'mg/dL', '8.8-11.5', 9.8, 0.3, 1], ['PHOS', 'mg/dL', '6.1-10.1', 7.8, 0.6, 1],
      ['CRE', 'mg/dL', '0.2-0.8', 0.3, 0.05, 1], ['GLU', 'mg/dL', '90-192', 170, 18, 0], ['NA+', 'mmol/L', '140-160', 151, 2, 0], ['K+', 'mmol/L', '4.7-6.4', 5.6, 0.4, 1],
      ['TP', 'g/dL', '3.6-6.6', 5.4, 0.3, 1], ['GLOB', 'g/dL', '1.0-3.2', 2.3, 0.2, 1]];
    const printouts = animals.map((s, k) => {
      const lines = ['=~=~=~=~=~=~=~=~=~=~=~= PuTTY log =~=~=~=~=~=~=~=~=~=~=~=', '            VETSCAN VS2', '   Comprehensive Diagnostic Profile',
        `${clock.today()} 10:${String(30 + k * 2).padStart(2, '0')} AM`, 'Sample Type:    Other', `Patient ID: ${s.phl}`, 'Rotor Lot Number: 6098AA2', 'Serial Number:    0000V40123', ''];
      for (const [code, unit, range, mean, sd, dp] of CHEM) {
        let val = nv(mean, sd);
        if (code === 'ALT' && s.groupCode === 'G3') val *= 3.4;          // the G3 males' pale livers
        if (code === 'ALT' && s.groupCode === 'G2') val *= 1.5;
        const [lo, hi] = range.split('-').map(Number);
        const flag = val > hi ? 'H' : val < lo ? 'L' : ' ';
        lines.push(`${code.padEnd(6)} ${val.toFixed(dp).padStart(4)} ${flag} ${unit.padEnd(7)}${range}`);
      }
      lines.push('', 'QC  OK', 'HEM 0     LIP 0     ICT 0', '');
      return lines.join('\r\n');
    }).join('\r\n');
    call('POST', '/api/bloodwork/import', { fileName: `VS2 PuTTY log ${clock.today()}.txt`, text: printouts });
    on(-34, 'JM');
    const waiting = state.bloodwork.results.filter((r) => r.status === 'TO_REVIEW');
    for (const r of waiting.slice(0, -2)) call('POST', `/api/bloodwork/results/${r.id}/release`, {});
    on(-30, 'KM');
    const bm = call('POST', '/api/bloodwork/cytology', { subjectId: animals[1].id, specimen: 'Bone marrow smear' }).id;
    call('PUT', `/api/bloodwork/cytology/${bm}`, { stain: 'Wright-Giemsa', collectedOn: addDays(today, -35),
      counts: { Myeloblasts: 3, Promyelocytes: 6, Myelocytes: 22, Metamyelocytes: 31, 'Band neutrophils': 38, 'Segmented neutrophils': 54, Eosinophils: 9, Basophils: 1,
        Rubriblasts: 2, Prorubricytes: 5, Rubricytes: 41, Metarubricytes: 48, Lymphocytes: 28, 'Plasma cells': 2, Monocytes: 3, Macrophages: 2, Megakaryocytes: 5 },
      description: 'Highly cellular smear with orderly, complete maturation of myeloid and erythroid series. Megakaryocytes are adequate in number and mature. No atypical cells.',
      interpretation: 'Myeloid hyperplasia, mild, with orderly maturation; consistent with a response to the pulmonary neoplasms. No evidence of hematopoietic neoplasia.' });
    call('POST', `/api/bloodwork/cytology/${bm}/sign`, {});
  }

  on(-33, 'JM'); moveAll(ids.nak, 'QC-PA');
  on(-32, 'JM'); call('POST', `/api/requests/${ids.nak}/complete`, {});
  on(-30, 'BA'); call('POST', `/api/nas/${ids.nasNak}/close`, {});   // the work is done: no more requests from this NAS request
  on(-28, 'KT'); moveAll(ids.oka, 'EMBED');

  // ---- Lindqvist: multiplex IF on PDX tumors ----
  on(-24, 'BA'); ids.nasLin = nas('lindqvist', `${yy(-24)}-0430`, { project: '25X0018820.02', authorized: 3000, type: 'MOLEC', n: 4, species: 'PDX', description: 'Opal 6-plex immune panel on 8 sections from 4 PDX tumors, with multispectral scanning.' }).id;
  on(-21, 'JM');
  ids.lin = call('POST', '/api/requests', { nasId: ids.nasLin, type: 'MOLEC', n: 4, species: 'PDX', lines: lines([['MICROTOMY', 'HP004001', 8], ['STAIN', 'HP006014', 8], ['STAIN', 'HP009002', 8], ['IMAGE', 'HP001009', 8]]) }).id;
  subjectsOf(ids.lin).forEach((s, i) => call('PATCH', `/api/subjects/${s.id}`, { label: `PDX-${i + 1} (passage P${3 + i})` }));
  moveAll(ids.oka, 'MICRO');

  // ---- Billing period closes: QC and release ----
  on(-20, 'BA');
  call('POST', `/api/requests/${ids.nak}/approve-pending`, {});
  call('POST', `/api/requests/${ids.oka}/approve-pending`, {});
  call('POST', `/api/requests/${ids.nak}/review`, { outcome: 'OK' });
  call('POST', '/api/billing/batches', { lab: 'HP', start: addDays(today, -60), end: addDays(today, -21) });

  on(-19, 'JM'); moveAll(ids.lin, 'MICRO'); ids.linCut = charge(ids.lin, 'MICROTOMY', 'HP004001', 8).id;
  on(-18, 'KT'); ids.okaBlocks = charge(ids.oka, 'TRIM_EMBED', 'HP003003', 36).id;

  // ---- Petrakis: Xenium on organoid lines ----
  on(-17, 'BA'); ids.nasPet = nas('petrakis', `${yy(-17)}-0441`, { project: '25X0020011.01', authorized: 2400, type: 'XENIUM', n: 3, species: 'ORGANOID', description: 'Xenium 5K panel on three colon organoid lines, with H&E and 40x scans. The Xenium run itself has no code on the CY2027 list.' }).id;
  on(-14, 'JM');
  ids.pet = call('POST', '/api/requests', { nasId: ids.nasPet, type: 'XENIUM', n: 3, species: 'ORGANOID', lines: lines([['MICROTOMY', 'HP004001', 3], ['STAIN', 'HP005003', 3], ['IMAGE', 'HP001007', 3]]) }).id;
  subjectsOf(ids.pet).forEach((s, i) => call('PATCH', `/api/subjects/${s.id}`, { label: `ORG-${i + 1} (passage P${8 + i})` }));
  ids.okaCut = charge(ids.oka, 'MICROTOMY', 'HP004001', 36).id;

  on(-12, 'JM');
  moveAll(ids.oka, 'STAIN'); moveAll(ids.lin, 'STAIN'); moveAll(ids.pet, 'MICRO');
  charge(ids.lin, 'STAIN', 'HP009002', 6, 'Opal panel optimization');
  ids.petCut = charge(ids.pet, 'MICROTOMY', 'HP004001', 3).id;
  on(-11, 'JM'); moveAll(ids.pet, 'STAIN'); ids.petHE = charge(ids.pet, 'STAIN', 'HP005003', 3).id;

  on(-10, 'BA');
  for (const id of [ids.okaBlocks, ids.okaCut, ids.linCut, ids.petCut, ids.petHE]) call('POST', `/api/charges/${id}/approve`, {});
  on(-10, 'JM'); charge(ids.oka, 'STAIN', 'HP005003', 36); charge(ids.pet, 'IMAGE', 'HP001007', 3);

  // ---- Haddad and Rivera: pathology review and scanning ----
  on(-9, 'BA'); ids.nasHad = nas('haddad', `${yy(-9)}-0446`, { project: '25X0016402.01', authorized: 600, type: 'PATH-ONLY', n: 6, species: 'MOUSE', description: 'Pathology review of 18 submitted slides from 6 animals.' }).id;
  on(-9, 'JM'); charge(ids.oka, 'STAIN', 'HP005017', 6, 'Masson trichrome, lungs');
  on(-7, 'BA'); ids.nasRiv = nas('rivera', `${yy(-7)}-0452`, { project: '25X0019930.01', authorized: 650, type: 'SCAN', n: 2, species: 'OTHER', description: 'Whole-slide scanning of 40 slides at 40x, in two boxes.' }).id;
  on(-7, 'JM'); ids.had = call('POST', '/api/requests', { nasId: ids.nasHad, type: 'PATH-ONLY', n: 6, species: 'MOUSE', lines: lines([['PATH', 'PA001002', 18]]) }).id;
  on(-6, 'JM'); moveAll(ids.had, 'PATHO'); charge(ids.lin, 'STAIN', 'HP006014', 8);
  on(-6, 'BA'); nas('abernathy', `${yy(-6)}-0471`, { project: '25X0021004.01', authorized: 5000, type: 'NECRO-FULL', n: 16, species: 'MOUSE', description: 'Necropsy, histology and pathology for a 16-mouse neuroblastoma PDX efficacy study, three tissues per animal.' });
  on(-5, 'JM');
  ids.riv = call('POST', '/api/requests', { nasId: ids.nasRiv, type: 'SCAN', n: 2, species: 'OTHER', lines: lines([['IMAGE', 'HP001007', 40]]) }).id;
  subjectsOf(ids.riv).forEach((s, i) => call('PATCH', `/api/subjects/${s.id}`, { label: `Box ${i + 1}` }));
  on(-4, 'JM'); moveAll(ids.riv, 'IMAGE'); moveAll(ids.oka, 'IMAGE', (l) => l.slice(0, 9)); charge(ids.oka, 'IMAGE', 'HP001006', 20);
  on(-4, 'BA'); nas('sato', `${yy(-4)}-0474`, { project: '25X0017766.02', authorized: 4800, type: 'MOLEC', n: 24, species: 'HUMAN', description: 'RNAscope (3 probes) on 24 FFPE glioma blocks with 20x scanning.', scope: [['MICROTOMY', 'HP004001', 24], ['STAIN', 'HP006017', 24], ['IMAGE', 'HP001006', 24]] });
  on(-3, 'JM'); moveAll(ids.oka, 'PATHO', (l) => l.slice(0, 4)); moveAll(ids.pet, 'SPATL'); charge(ids.riv, 'IMAGE', 'HP001007', 26);
  on(-3, 'BA'); nas('moreau', `${yy(-3)}-0477`, { project: '25X0022381.01', authorized: 950, type: 'SCAN', n: 60, species: 'HUMAN', description: 'Whole-slide scanning of 60 archival H&E slides at 40x.' });
  on(-2, 'BA'); ids.nasBre = nas('brennan', `${yy(-2)}-0458`, { project: '25X0013550.03', authorized: 2100, type: 'NECRO-FULL', n: 6, species: 'MOUSE', description: 'Lung perfusion fixation pilot in 6 mice; three animals are STAT.' }).id;
  on(-1, 'JM'); moveAll(ids.lin, 'IMAGE', (l) => l.slice(0, 2)); charge(ids.lin, 'IMAGE', 'HP001009', 4);

  // ---- Brennan: necropsy today, study ZAP2231 ----
  on(0, 'KT');
  ids.bre = call('POST', '/api/requests', {
    nasId: ids.nasBre, type: 'NECRO-FULL', n: 6, species: 'MOUSE',
    study: { mode: 'new', zap: 'ZAP2231', title: 'Lung perfusion fixation pilot', acuc: 'ASP-26-042', protocolId: 3 },
    lines: lines([['NECRO', 'HP002001', 6], ['NECRO', 'HP002008', 6], ['TRIM_EMBED', 'HP003003', 12], ['MICROTOMY', 'HP004001', 12], ['STAIN', 'HP005003', 12], ['IMAGE', 'HP001006', 12], ['PATH', 'PA001002', 12]]),
  }).id;
  const breStudy = state.studies.find((s) => s.zap === 'ZAP2231');
  call('PUT', `/api/studies/${breStudy.id}/groups`, { groups: [
    { code: 'C', name: 'Control', sex: 'M', treatment: 'Immersion fixation' }, { code: 'T', name: 'Perfused', sex: 'M', treatment: 'Intratracheal perfusion, 10% NBF' }] });
  subjectsOf(ids.bre).forEach((s, i) => call('PATCH', `/api/subjects/${s.id}`, { groupCode: i < 3 ? 'C' : 'T', priority: i < 3 ? 'S' : 'R' }));
  moveAll(ids.bre, 'NECRO', (l) => l.slice(0, 3));
  const first = subjectsOf(ids.bre)[0];
  const draft = call('GET', `/api/necropsy/${first.id}`).necropsy;
  call('PUT', `/api/necropsy/${first.id}`, { ...draft, bodyWeight: 26.4, organs: draft.organs.map((o) => (o.organ === 'Lungs' ? { ...o, weight: 0.182 } : o)) });

  // ---- IHC requests placed through the web form (the old phlrequest MH request) ----
  if (state.assays.length) {
    const assay = (pred, what) => { const a = state.assays.find((x) => x.status === 'Active' && pred(x)); if (!a) throw new Error(`Seed step failed: no catalog assay for ${what}`); return a.id; };
    const plex6 = assay((a) => a.name.startsWith('6-plex PDL1 + Ki67'), '6-plex PDL1 panel');
    const ki67 = assay((a) => a.name === 'Ki-67' && a.species === 'Mouse' && a.fixative === '10% NBF', 'mouse Ki-67');
    const cd3 = assay((a) => a.name === 'CD3' && a.species === 'Mouse' && a.catalog.startsWith('ab231775'), 'mouse CD3');
    const cd8 = assay((a) => a.name === 'CD8' && a.kind === 'IHC' && a.catalog.startsWith('ab101500') && a.fixative === '10% NBF', 'CD8 ab101500');
    const f480 = assay((a) => a.name === 'F4/80' && a.fixTags.includes('Frozen'), 'frozen F4/80');
    const web = (who, extra) => call('POST', '/api/ihc/requests', { ...WEB[who], pathologist: 'Any MHL pathologist', importance: 'Routine', ...extra });
    const blocks = (list, type = 'BLOCK') => list.map(([tissue, blockNo]) => ({ tissue, blockNo, type }));

    on(-6, 'LW');
    const first = web('varga', { species: 'PDX', fixativeUsed: '10% NBF', samples: blocks([['Tumor', 'PDX-117 P4'], ['Tumor', 'PDX-117 P5']]),
      he: { on: true, perBlock: 1 }, stains: [{ assayId: plex6 }], scan: { x20: true }, additional: 'Immune panel on two passages of one PDX line.' });
    on(-5, 'BA'); const nasVarga = nas('varga', `${yy(-5)}-0479`, { requesterLast: 'Varga', requesterFirst: 'Eszter', inst: 'NCI/CCR, Thoracic and GI Malignancies', project: '25X0023117.01', authorized: 1500, type: 'MOLEC', n: 3, species: 'PDX', description: 'Opal 6-plex immune panel with H&E and scans on 3 PDX tumor blocks.' });
    on(-4, 'LW');
    const second = web('varga', { species: 'PDX', fixativeUsed: '10% NBF', samples: blocks([['Tumor', 'PDX-117 P4'], ['Tumor', 'PDX-117 P5'], ['Tumor', 'PDX-117 P6']]),
      he: { on: true, perBlock: 1 }, stains: [{ assayId: plex6 }], scan: { x20: true }, additional: 'Replaces my earlier request: three passages, not two.' });
    call('POST', `/api/ihc/requests/${first.id}/decline`, { reason: `Replaced by ${second.number}, which lists all three blocks.` });

    on(-3, 'LW');
    web('ferreira', { species: 'Mouse', fixativeUsed: 'Fresh frozen (OCT)', samples: blocks([['Tumor', 'LF-22'], ['Spleen', 'LF-22']], 'FROZEN'),
      stains: [{ assayId: f480 }, { newAntibody: { name: 'SLC7A11 (xCT)', manufacturer: 'Cell Signaling Technology', catalog: '12691', host: 'Rabbit mAb', supplied: true, notes: 'Datasheet attached to the email.' } }],
      scan: { x40: true }, additional: 'Ferroptosis study. We will bring the antibody with the samples.' });

    on(-1, 'LW');
    const okaPhls = subjectsOf(ids.oka).slice(0, 4).map((s) => s.phl);
    web('okafor', { species: 'Mouse', fixativeUsed: '10% NBF', acuc: 'ASP-24-117', samples: blocks(okaPhls.map((p) => ['Lungs', p])),
      stains: [{ assayId: ki67 }, { assayId: cd3 }], scan: { x20: true }, additional: 'Lung blocks from study ZAP2215 (vehicle group). Proliferation and T cells in the nodules.' });

    on(0, 'LW');
    web('whitcombe', { species: 'Mouse', fixativeUsed: '10% NBF', fixDate: addDays(today, -339), samples: blocks([['Liver', 'Animal 1042'], ['Liver', 'Animal 1043']], 'FIXED'),
      he: { on: true, perBlock: 1 }, unstained: { on: true, perBlock: 1 }, stains: [{ assayId: cd8, chromogen: 'DAB' }], scan: { x20: true } });
    call('POST', `/api/ihc/requests/${second.id}/accept`, { nasId: nasVarga.id });
  }

  // ---- Pathology: ZAP2215 cases read and signed out across the three groups; Haddad's submitted slides ----
  const dx = (term, extra = {}) => ({ term, ...extra });
  // plan: { organ: [diagnoses] }; organs in `read` but not in plan are "no significant lesions"; others "not examined".
  const readCase = (subjectId, { read, plan = {}, comment = '', sign = true, extraTissues = null }) => {
    const base = call('GET', `/api/pathology/${subjectId}`).case;
    const tissues = (extraTissues || base.tissues).map((t) => {
      if (t.result === 'NOT_PRESENT') return t;
      const dxs = (plan[t.organ] || []).map((x, i) => ({ id: `d${subjectId}${t.id}${i}`, ...x }));
      return { ...t, diagnoses: dxs, result: dxs.length ? 'LESIONS' : read.includes(t.organ) ? 'NSL' : 'NOT_EXAMINED' };
    });
    // Correlate each gross finding with the first diagnosis in its organ; otherwise "no microscopic correlate".
    const gross = call('GET', `/api/pathology/${subjectId}`).grossFindings;
    const grossNoCorrelate = {};
    for (const g of gross) {
      const t = tissues.find((x) => x.organ === g.organ && x.diagnoses.length);
      if (t) { const target = t.diagnoses.find((x) => x.neoplasmFirst) || t.diagnoses[0]; target.correlates = [...(target.correlates || []), g.id]; } else grossNoCorrelate[g.id] = true;
    }
    const body = { ...base, tissues, grossNoCorrelate, comment, causeOfDeath: { kind: 'NA', dxId: null, comment: '' } };
    call('PUT', `/api/pathology/${subjectId}`, body);
    if (sign) call('POST', `/api/pathology/${subjectId}/signout`, body);
  };
  const oka = subjectsOf(ids.oka);
  const lungRead = ['Lungs', 'Heart', 'Liver', 'Spleen'];
  on(-2, 'JM'); call('POST', `/api/requests/${ids.oka}/move`, { to: 'PATHO', subjectIds: [oka[4], oka[5], oka[8], oka[9]].map((s) => s.id) });
  call('POST', '/api/pathology/assign', { subjectIds: oka.map((s) => s.id), pathologist: 'KM' });
  on(-1, 'KM');
  readCase(oka[0].id, { read: lungRead, plan: {
    Lungs: [dx('Carcinoma, bronchiolo-alveolar', { behavior: 'Malignant', distribution: 'Multifocal', neoplasmFirst: true }), dx('Adenoma, bronchiolo-alveolar', { behavior: 'Benign', distribution: 'Multifocal' }), dx('Hyperplasia, bronchiolo-alveolar', { distribution: 'Multifocal', severity: '3' })] },
  comment: 'Multiple bronchiolo-alveolar neoplasms, consistent with the KrasG12D; Trp53fl/fl model. One carcinoma invades the adjacent parenchyma.' });
  readCase(oka[1].id, { read: lungRead, plan: {
    Lungs: [dx('Adenoma, bronchiolo-alveolar', { behavior: 'Benign', distribution: 'Multifocal', neoplasmFirst: true }), dx('Hyperplasia, bronchiolo-alveolar', { distribution: 'Multifocal', severity: '2' }), dx('Accumulation, alveolar macrophage', { distribution: 'Multifocal', severity: '1' })] } });
  readCase(oka[2].id, { read: lungRead, plan: {
    Lungs: [dx('Carcinoma, bronchiolo-alveolar', { behavior: 'Malignant', distribution: 'Multifocal', neoplasmFirst: true }), dx('Hyperplasia, bronchiolo-alveolar', { distribution: 'Multifocal', severity: '3' })],
    Liver: [dx('Hematopoiesis, extramedullary', { distribution: 'Multifocal', severity: '1' })] } });
  readCase(oka[3].id, { read: lungRead, plan: { Lungs: [dx('Adenoma, bronchiolo-alveolar', { behavior: 'Benign', distribution: 'Multifocal' })] }, sign: false });
  readCase(oka[4].id, { read: lungRead, plan: {
    Lungs: [dx('Adenoma, bronchiolo-alveolar', { behavior: 'Benign', distribution: 'Focal', neoplasmFirst: true }), dx('Hyperplasia, bronchiolo-alveolar', { distribution: 'Focal', severity: '1' })],
    Spleen: [dx('Hematopoiesis, extramedullary, increased', { distribution: 'Diffuse', severity: '3' })] } });
  readCase(oka[5].id, { read: lungRead, plan: {
    Lungs: [dx('Hyperplasia, bronchiolo-alveolar', { distribution: 'Focal', severity: '2' }), dx('Adenoma, bronchiolo-alveolar', { behavior: 'Benign', distribution: 'Focal' })],
    Spleen: [dx('Hematopoiesis, extramedullary, increased', { distribution: 'Diffuse', severity: '2' })] } });
  readCase(oka[8].id, { read: lungRead, plan: {
    Lungs: [dx('Adenoma, bronchiolo-alveolar', { behavior: 'Benign', distribution: 'Focal', neoplasmFirst: true })],
    Liver: [dx('Vacuolation, hepatocellular', { modifier: 'centrilobular', distribution: 'Diffuse', severity: '2' })],
    Spleen: [dx('Hematopoiesis, extramedullary, increased', { distribution: 'Diffuse', severity: '2' })] },
  comment: 'Centrilobular hepatocellular vacuolation is consistent with the pale livers seen at necropsy; consider a compound-related effect.' });

  // Haddad: slides submitted without necropsy, three per animal; the pathologist adds the tissues.
  const had = subjectsOf(ids.had);
  call('POST', '/api/pathology/assign', { subjectIds: had.map((s) => s.id), pathologist: 'PS' });
  on(0, 'PS');
  const slides3 = [['Liver', '1'], ['Kidneys', '2'], ['Skin', '3']].map(([organ, block], i) => ({ id: `s${i + 1}`, organ, block, result: 'PENDING', diagnoses: [], comment: '', recut: false, recutNote: '' }));
  readCase(had[0].id, { read: ['Liver', 'Kidneys', 'Skin'], extraTissues: slides3, plan: {
    Skin: [dx('Ulcer', { distribution: 'Focal', severity: '3' }), dx('Inflammation, chronic', { distribution: 'Focally extensive', severity: '3', modifier: 'dermal' })],
    Kidneys: [dx('Nephropathy, chronic progressive', { distribution: 'Multifocal', severity: '1', laterality: 'Bilateral' })] },
  comment: 'Focal ulcerative dermatitis with chronic inflammation. No neoplasm in the sections examined.' });
  readCase(had[1].id, { read: ['Liver', 'Kidneys', 'Skin'], extraTissues: slides3, plan: {
    Liver: [dx('Adenoma, hepatocellular', { behavior: 'Benign', distribution: 'Focal' }), dx('Vacuolation, hepatocellular', { distribution: 'Multifocal', severity: '2' })] } });
  readCase(had[2].id, { read: ['Liver'], extraTissues: slides3.map((t) => ({ ...t, recut: t.organ === 'Skin', recutNote: t.organ === 'Skin' ? 'Section too thin; recut 2 levels' : '' })), plan: {}, sign: false });

  // Slide images, registered through the same API as files read from the scanners' output folders. The instrument IDs
  // are examples (they match the sample files in samples/scanners); each lab enters its scanners' real IDs.
  {
    const SERIALS = { AT2: ['SS7201'], GT450: ['SS45001'], FL: ['FL1234'], PHENOHT: ['PHENO-HT-01'] };
    for (const s of state.wsi.scanners) s.serials = SERIALS[s.id] || [];
    const svs = (fileName, offset, time, { gt = false, barcode = '' } = {}) => ({
      fileName, path: `S:\\Scans\\${gt ? 'GT450' : 'AT2'}\\${addDays(today, offset)}\\${fileName}`, format: 'SVS', model: gt ? 'GT450' : 'AT2', modelStated: gt,
      sizeBytes: (gt ? 2_400_000_000 : 690_000_000) + fileName.length * 7919, scannedOn: addDays(today, offset), scannedAt: time, mag: gt ? 40 : 20, mpp: gt ? 0.263 : 0.499,
      width: gt ? 98304 : 46000, height: gt ? 61440 : 32914, serial: gt ? 'SS45001' : 'SS7201', barcode, internalName: fileName.replace(/\.svs$/, ''), hasLabel: true, hasMacro: true,
    });
    on(-3, 'JM');
    call('POST', '/api/wsi/register', { source: 'folder', label: 'Aperio AT2 output folder', files: [svs('26000306A-B2-HE.svs', -3, '14:10'), svs('26000306A-B4-HE.svs', -3, '14:13'), svs('26000307A-B2-HE.svs', -3, '14:17')] });
    call('POST', '/api/wsi/register', { source: 'folder', label: 'Aperio GT 450 output folder',
      files: [1, 2, 3].map((n) => svs(`26000325A-S0${n}.svs`, -3, `15:0${n * 2}`, { gt: true, barcode: `26000325A-S0${n}` })).concat([svs('Slide_0017.svs', -3, '15:09', { gt: true })]) });
    on(-2, 'JM');
    const img = (name) => state.wsi.images.find((x) => x.fileName === name).id;
    for (const n of ['26000306A-B2-HE.svs', '26000306A-B4-HE.svs', '26000325A-S01.svs', '26000325A-S02.svs']) call('POST', `/api/wsi/images/${img(n)}/pass`, {});
    call('POST', `/api/wsi/images/${img('26000325A-S03.svs')}/rescan`, { reasons: ['Out of focus'], note: 'Lower left corner soft; rescan with extra focus points.' });
    on(-1, 'JM');
    const opal = [['DAPI', ''], ['Opal 480', 'CD8'], ['Opal 520', 'PD-L1'], ['Opal 570', 'CD68'], ['Opal 620', 'FoxP3'], ['Opal 690', 'PanCK'], ['Opal 780', 'Ki-67']];
    call('POST', '/api/wsi/register', { source: 'folder', label: 'PhenoImager HT output folder', files: [{
      fileName: '26000312A_Scan1.qptiff', path: `S:\\Scans\\PhenoImagerHT\\${addDays(today, -1)}\\26000312A_Scan1.qptiff`, format: 'QPTIFF', model: 'PHENOHT', modelStated: true,
      sizeBytes: 31_800_000_000, scannedOn: addDays(today, -1), scannedAt: '11:42', mag: 20, mpp: 0.4972, width: 52440, height: 38612, serial: 'PHENO-HT-01',
      barcode: '26000312A', slideId: '26000312A', channels: opal.map(([name, biomarker]) => ({ name, biomarker })),
    }] });
  }

  // ---- Molecular: a Xenium run under way on two of Petrakis's organoid lines (the third waits for a recut), and an
  // accepted IHC request being worked ----
  {
    on(-2, 'JM');
    const pet = subjectsOf(ids.pet);
    const run = call('POST', '/api/xenium/runs', { assay: 'PRIME', panelId: 'H-5K', segmentation: true, assignedTo: 'JM', instrumentSerial: 'XETG00123',
      notes: 'ORG-3 waits for a recut: its first section folded.', slides: [{ slot: 1, slideSerial: '0023481', subjectIds: [pet[0].id] }, { slot: 2, slideSerial: '0023482', subjectIds: [pet[1].id] }] });
    call('POST', `/api/xenium/runs/${run.id}/advance`, { note: '5 µm FFPE sections of the organoid pellets, one per slide' });
    on(-1, 'JM'); call('POST', `/api/xenium/runs/${run.id}/advance`, { note: 'Overnight hybridization started 16:40' });
    const varga = state.ihcRequests.find((w) => w.requester.last === 'Varga' && w.status === 'Accepted');
    if (varga) {
      on(0, 'LW');
      call('POST', '/api/ihc/requests/assign', { ids: [varga.id], to: 'LW' });
      call('POST', `/api/ihc/requests/${varga.id}/work`, { status: 'In progress' });
    }
  }

  // ---- Cost estimates for possible new projects: one expired, one declined, one revised and sent, one accepted and
  // linked to the NAS request the investigator then submitted, and a draft with two phases and IHC ----
  {
    const est = (body) => call('POST', '/api/estimates', body).id;
    const plan = (type, n, perBlock = null) => ESTX.planLines(REQUEST_TYPES[type], n, perBlock, priceList.items);
    const act = (id, what, body = {}) => call('POST', `/api/estimates/${id}/${what}`, body);
    const person = (last, first, inst) => ({ last, first, inst, email: `${first}.${last}`.toLowerCase() + '@example.org', phone: '' });
    // Emailing as staff do: the suggested wording, opened in Outlook, the lab's shared mailbox copied.
    const email = (id, extra = {}) => {
      const f = call('GET', `/api/estimates/${id}/email`);
      const kind = extra.markSent === false ? 'review' : f.kinds[0];
      return call('POST', `/api/estimates/${id}/email`, { to: f.to, cc: 'mhl-estimates@example.org', subject: f.defaults[kind].subject, message: f.defaults[kind].message,
        signOff: f.signOff, markSent: true, method: 'outlook', attachCsv: true, ...extra });
    };

    on(-130, 'BA');
    const iverson = est({ investigator: person('Iverson', 'Paul', 'NCI/DCTD, Biological Testing Branch'), title: 'Histology and pathology for a 28-day rat toxicology study',
      description: '40 rats, ten tissues each: paraffin blocks, H&E and a pathology read of every slide.', species: 'RAT', type: 'HISTO', n: 40,
      phases: [{ name: 'Histology and pathology', lines: [...plan('HISTO', 40, 10), { section: 'PATH', code: 'PA001002', units: 400 }] }],
      assumptions: ['Tissues arrive fixed in 10% NBF and trimmed by MHL.'] });
    on(-128, 'BA'); act(iverson, 'send');

    on(-60, 'BA');
    const brennan = est({ investigator: person('Brennan', 'Cole', 'NCI/CCR, Mouse Cancer Genetics'), title: 'Embryo collection and diagrams, E14.5',
      description: 'Embryo collection with diagrams from 10 timed-pregnant dams.', species: 'MOUSE', type: 'NECRO-FULL', n: 10,
      phases: [{ name: 'Collection', lines: [{ section: 'NECRO', code: 'HP002003', units: 10 }, { section: 'NECRO', code: 'HP002006', units: 10 }] }] });
    on(-59, 'BA'); act(brennan, 'send');
    on(-45, 'BA'); act(brennan, 'decline', { reason: 'The investigator decided to collect the embryos in their own lab.' });

    on(-30, 'BA');
    const xenium = (lines) => [{ name: 'Organoid lines', lines: [{ section: 'TRIM_EMBED', code: 'HP003009', units: lines }, ...plan('XENIUM', lines),
      { section: 'STAIN', code: '', description: '10x Xenium 5K panel run, per slide (no code on the CY2027 list; price to be confirmed)', unit: 'slide', units: lines, unitPrice: 0 }] }];
    const castellanosBody = { investigator: person('Castellanos', 'Ruth', 'NCI/CCR, Urologic Oncology Branch'), title: 'Xenium spatial profiling of prostate cancer organoids',
      description: 'Prostate cancer organoid lines embedded as cell pellets; H&E and a 10x Xenium 5K panel on one section of each, with 40x scans.', species: 'ORGANOID', type: 'XENIUM', n: 3,
      phases: xenium(3), assumptions: ['The Xenium run has no charge code on the CY2027 price list; MHL will confirm its price before the work is scheduled.'] };
    const castellanos = est(castellanosBody);
    on(-29, 'BA'); act(castellanos, 'send');
    on(-14, 'BA'); const rev2 = act(castellanos, 'revise').id;
    call('PUT', `/api/estimates/${rev2}`, { ...castellanosBody, n: 4, description: `${castellanosBody.description} Revised: a fourth organoid line added.`, phases: xenium(4) });
    on(-13, 'BA'); email(rev2);

    on(-11, 'BA');
    const moreau = est({ investigator: person('Moreau', 'Claire', 'NCI/DCEG, Molecular Epidemiology'), title: 'Whole-slide scanning of archival H&E slides',
      description: '60 archival H&E slides from a case-control study, scanned at 40x for review on screen.', species: 'HUMAN', type: 'SCAN', n: 60,
      phases: [{ name: 'Scanning', lines: [{ section: 'IMAGE', code: 'HP001007', units: 60 }] }], assumptions: ['Slides arrive labeled with coded IDs only, with no patient identifiers.'] });
    on(-10, 'BA'); email(moreau);
    on(-4, 'BA'); act(moreau, 'accept');
    on(-3, 'BA'); act(moreau, 'nas', { nasId: state.nas.find((x) => x.requester.last === 'Moreau').id });

    on(-1, 'BA');
    let ihcLines = []; let ihcNotes = [];
    if (state.assays.length) {
      const find = (pred) => state.assays.find((x) => x.status === 'Active' && pred(x))?.id;
      const stains = [find((a) => a.name === 'CD8' && a.kind === 'IHC' && a.catalog.startsWith('ab101500') && a.fixative === '10% NBF'),
        find((a) => a.name === 'Ki-67' && a.species === 'Mouse' && a.fixative === '10% NBF')].filter(Boolean).map((assayId) => ({ assayId }));
      const res = call('POST', '/api/requests/ihc-estimate', { n: 32, species: 'MOUSE', fixative: '10%NBF',
        ihc: { tissue: 'Tumor', sampleType: 'BLOCK', addOn: true, he: { on: false, perBlock: 1 }, unstained: { on: false, perBlock: 1 }, scan: { x20: true, x40: false }, stains } });
      ihcLines = res.estimate.lines.map((l) => ({ section: l.section, code: l.code, units: l.units, note: 'IHC on the tumor blocks: CD8 and Ki-67' }));
      ihcNotes = res.estimate.assumptions.map(ESTX.forEstimate);
    }
    est({ investigator: person('Halvorsen', 'Ingrid', 'NCI/CCR, Cancer and Inflammation Program'), title: 'Anti-PD-1 efficacy study in MC38 tumors',
      description: 'A pilot of 8 mice, then a main study of 32 mice in four groups. Necropsy with three tissues per animal, H&E, 20x scans and pathology; CD8 and Ki-67 IHC on the tumors in the main study.',
      species: 'MOUSE', type: 'NECRO-FULL', n: 32,
      phases: [{ name: 'Pilot (8 mice)', lines: plan('NECRO-FULL', 8) },
        { name: 'Main study (32 mice)', lines: [...plan('NECRO-FULL', 32), ...ihcLines, { section: 'BLOOD', code: 'HP002204', units: 32, optional: true, note: 'If clinical chemistry is wanted at necropsy' }] }],
      assumptions: ['Three tissues per animal (tumor, spleen, tumor-draining lymph node).', ...ihcNotes] });
  }

  state.settings.initials = '';
  return state;
}
