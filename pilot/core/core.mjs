// MHL LIMS pilot: application core.
//
// All state changes and business rules live here, behind a tiny HTTP-like interface
// (handle(method, path, query, body)). The Node server calls it for /api requests and saves
// the state to a JSON file; the standalone build calls it directly in the browser and saves
// to localStorage. Pricing and billing rules come from tools/rules-reference/rules.mjs, the
// same rules the C# Domain project implements.

import * as R from '../../tools/rules-reference/rules.mjs';
import * as IHC from './ihc.mjs';
import * as PATH from './pathology.mjs';
import * as NEC from './necrules.mjs';
import * as TERM from './terminology.mjs';
import * as PROT from './protocols.mjs';
import * as BW from './bloodwork.mjs';
import * as WSIX from './wsi.mjs';
import * as ESTX from './estimates.mjs';
import * as MAIL from './estimatemail.mjs';
import * as XEN from './xenium.mjs';
import * as ANIMALS from './animallist.mjs';
import { describe, sig, fisherExact } from './stats.mjs';
import { AREAS, AREA_ORDER, TERMINAL_AREAS, REQUEST_TYPES, SPECIES, DICTIONARIES, NECROPSY_EXTRAS, PERFUSION_CODES, PATHOLOGISTS } from './defs.mjs';

export class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export function addDays(iso, days) {
  const t = new Date(iso + 'T12:00:00Z');
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

export function emptyState(today) {
  return {
    version: 7,
    createdOn: today,
    settings: { initials: '', pricingFrom: '2026-01-01', instrumentFolders: { chemistry: '', hematology: '' } },
    counters: {},
    nas: [], requests: [], subjects: [], events: [], studies: [], necropsies: {},
    charges: [], reviews: [], batches: [], audit: [],
    assays: [], ihcRequests: [],
    pathology: {}, pathAssign: {},
    library: { ...TERM.starterLibrary(), lists: structuredClone(DICTIONARIES) }, sendCt: null,
    protocols: PROT.starterProtocols(),
    bloodwork: { runs: [], results: [], cytology: [], ranges: {} },
    wsi: newWsi(),
    estimates: [],
    xenium: { runs: [] },
  };
}

const newWsi = () => ({ scanners: WSIX.SCANNERS.map((s) => ({ ...s, status: 'Available', folder: '', serials: [], notes: '' })), images: [], runs: [] });
// Data saved before version 7: a NAS request may now fund several requests (it stays open until closed), Xenium runs
// are tracked, and studies keep the summary text of their study reports.
export function upgradeToV7(state) {
  if (state.version >= 7 && state.xenium) return false;
  state.xenium ||= { runs: [] };
  for (const n of state.nas) {
    if (n.closed != null) continue;
    // Saved before a NAS request could fund several requests: one whose requests are all complete has served its purpose.
    const reqs = state.requests.filter((r) => r.nasId === n.id);
    n.closed = reqs.length > 0 && reqs.every((r) => r.status === 'Complete');
    if (n.closed) { n.closedBy = 'UPGRADE'; n.closedOn = reqs.map((r) => r.completed).filter(Boolean).sort().at(-1) || null; }
  }
  for (const w of state.ihcRequests || []) {
    const r = w.status === 'Accepted' ? state.requests.find((x) => x.id === w.requestId) : null;
    if (r?.status === 'Complete' && !w.workStatus) Object.assign(w, { workStatus: 'Done', doneOn: r.completed || null });
  }
  for (const st of state.studies) st.reportNotes ||= { necropsy: '', pathology: '' };
  state.version = 7;
  return true;
}

// Data saved before version 6: add cost estimates for possible new projects.
export function upgradeToV6(state) {
  if (Array.isArray(state.estimates) && state.version >= 6) return false;
  if (!Array.isArray(state.estimates)) state.estimates = [];
  state.version = 6;
  return true;
}

// Data saved before version 5: add whole-slide imaging.
export function upgradeToV5(state) {
  if (state.wsi && state.version >= 5) return false;
  state.wsi ||= newWsi();
  state.version = 5;
  return true;
}

// Data saved before version 4: add the terminology library, Zaphod-style protocols (studies and necropsies keep the
// protocol they had, now split into a necropsy protocol and a trim protocol with the same number) and bloodwork.
export function upgradeToV4(state) {
  if (state.library && state.protocols && state.bloodwork) return false;
  state.library ||= { ...TERM.starterLibrary(), lists: structuredClone(DICTIONARIES) };
  state.sendCt ??= null;
  state.protocols ||= PROT.starterProtocols();
  state.bloodwork ||= { runs: [], results: [], cytology: [], ranges: {} };
  state.settings.instrumentFolders ||= { chemistry: '', hematology: '' };
  for (const st of state.studies) {
    if (st.necropsyProtocolId == null) st.necropsyProtocolId = st.protocolId ?? 1;
    if (st.trimProtocolId == null) st.trimProtocolId = st.protocolId ?? 1;
  }
  for (const n of Object.values(state.necropsies)) {
    if (n.necropsyProtocolId == null) n.necropsyProtocolId = n.protocolId ?? 1;
    if (n.trimProtocolId == null) n.trimProtocolId = n.protocolId ?? 1;
  }
  state.version = 4;
  return true;
}

// The converted catalog leaves empty fields out; fill them in so every assay has the same shape.
export function loadAssays(ihcCatalog) {
  return (ihcCatalog?.assays || []).map((a) => ({
    name: '', dilution: '', retrieval: '', digestion: '', kit: '', fixative: '', species: '', control: '', manufacturer: '', catalog: '',
    kind: 'IHC', plex: 1, chromogen: 'DAB', platform: 'Manual', speciesTags: [], fixTags: [], status: 'Active', list: null, sourceLine: null,
    flags: [], repairs: {}, doubleStain: null, components: null, partOf: [], duplicateOf: null, notes: '', updatedAt: null, ...a,
  }));
}

const fail = (message) => { throw new R.DomainError(message); };
const isDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const text = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const num = (v) => (v === '' || v == null ? null : Number(v));
const round2 = (x) => Math.round(x * 100) / 100;

export function createCore({ state, priceList, ihcCatalog = null, clock, save = () => {}, reseed = null }) {
  const catalog = () => R.loadCatalog(priceList, { effectiveFrom: state.settings.pricingFrom });
  const codeInfo = (code) => priceList.items.find((i) => i.code === code);
  const by = () => state.settings.initials || 'ME';
  const nextId = () => { state.counters.id = (state.counters.id || 1000) + 1; return state.counters.id; };
  const commit = () => save(state);

  // Data saved before the IHC module existed: add the assay catalog and an empty request list.
  if (!Array.isArray(state.assays)) {
    state.assays = loadAssays(ihcCatalog);
    state.ihcRequests = [];
    state.version = 2;
    commit();
  }
  // Data saved before the pathology module existed.
  if (!state.pathology || typeof state.pathology !== 'object') {
    state.pathology = {};
    state.pathAssign = {};
    state.version = 3;
    commit();
  }
  if (upgradeToV4(state)) commit();
  if (upgradeToV5(state)) commit();
  if (upgradeToV6(state)) commit();
  if (upgradeToV7(state)) commit();

  function audit(action, entity, entityId, detail = '', who = null) {
    state.audit.push({ id: nextId(), at: clock.now(), by: who || by(), action, entity, entityId, detail });
    if (state.audit.length > 3000) state.audit.splice(0, state.audit.length - 3000);
  }

  function allocate(name, period, count) {
    const c = (state.counters[name] ||= {});
    const first = c[period] || 1;
    c[period] = first + count;
    return first;
  }

  // ---------- lookups ----------
  const getRequest = (id) => state.requests.find((r) => r.id === Number(id)) || (() => { throw new HttpError(404, 'Request not found.'); })();
  const getSubject = (id) => state.subjects.find((s) => s.id === Number(id)) || (() => { throw new HttpError(404, 'PHL number not found.'); })();
  const getStudy = (id) => state.studies.find((s) => s.id === Number(id)) || (() => { throw new HttpError(404, 'Study not found.'); })();
  const getCharge = (id) => state.charges.find((c) => c.id === Number(id)) || (() => { throw new HttpError(404, 'Charge not found.'); })();
  const nasOf = (r) => state.nas.find((n) => n.id === r.nasId) || null;
  const studyOf = (r) => (r.studyId ? state.studies.find((s) => s.id === r.studyId) : null);
  const subjectsOf = (r) => state.subjects.filter((s) => s.requestId === r.id).sort((a, b) => a.phl.localeCompare(b.phl));
  const chargesOf = (r) => state.charges.filter((c) => c.requestId === r.id);
  // A NAS request can fund several LIMS requests (say a pilot and then the main study); they share its authorization.
  const requestsOfNas = (nas) => state.requests.filter((r) => r.nasId === nas.id).sort((a, b) => a.id - b.id);
  function nasUsage(nas, { except = null } = {}) {
    const reqs = requestsOfNas(nas).filter((r) => r.id !== except);
    const ids = new Set(reqs.map((r) => r.id));
    const live = state.charges.filter((c) => ids.has(c.requestId) && c.status !== 'VOID');
    const chargedOn = (r) => R.sumMoney(live.filter((c) => c.requestId === r.id).map((c) => c.amount));
    const estimated = R.sumMoney(reqs.map((r) => r.estimateTotal));
    const charged = R.sumMoney(live.map((c) => c.amount));
    // What each request has taken of the authorization: its estimate, or what has been charged to it if that is more.
    const committed = R.sumMoney(reqs.map((r) => Math.max(r.estimateTotal, chargedOn(r))));
    return {
      requests: reqs.map((r) => ({ id: r.id, number: r.number, status: r.status, type: r.type, estimateTotal: r.estimateTotal, charged: chargedOn(r), estimatePhase: r.estimatePhase || '' })),
      estimated, charged, committed, remaining: round2(nas.authorized - committed),
    };
  }
  const nasView = (n) => ({ ...n, usage: nasUsage(n) });
  const mustBeOpenNas = (nas) => { if (nas.closed) fail(`NAS# ${nas.number} is closed. Reopen it under New request to start another request from it.`); };
  // Protocols: a study names a necropsy protocol and a trim protocol; an animal's organ list combines them for its sex.
  const necProtocol = (id) => state.protocols.necropsy.find((p) => p.id === Number(id)) || null;
  const trimProtocol = (id) => state.protocols.trim.find((p) => p.id === Number(id)) || null;
  const firstUsable = (list) => list.find((p) => p.approved && !p.obsolete) || list[0] || null;
  const organSex = (name) => state.library.organs.find((o) => o.name.toLowerCase() === String(name || '').toLowerCase())?.sex || 'N';
  const resolveFor = (necId, trimId, sex = '') => PROT.resolveProtocol(necProtocol(necId) || firstUsable(state.protocols.necropsy), trimId === null ? null : (trimProtocol(trimId) || null), sex, organSex);
  const studyProtocol = (study, sex = '') => (study ? resolveFor(study.necropsyProtocolId, study.trimProtocolId ?? null, sex) : resolveFor(null, firstUsable(state.protocols.trim)?.id ?? null, sex));
  const necropsyProtocolOf = (n, subject) => resolveFor(n.necropsyProtocolId ?? n.protocolId, 'trimProtocolId' in n ? n.trimProtocolId : n.protocolId, subject?.sex || '');
  const lists = () => state.library.lists || DICTIONARIES;
  const piName = (p) => (p ? (p.first ? `${p.last}, ${p.first}` : p.last) : '');
  const getAssay = (id) => state.assays.find((a) => a.id === Number(id)) || (() => { throw new HttpError(404, 'Assay not found.'); })();
  const assayById = (id) => state.assays.find((a) => a.id === Number(id)) || null;
  const getWeb = (id) => state.ihcRequests.find((w) => w.id === Number(id)) || (() => { throw new HttpError(404, 'IHC request not found.'); })();

  // ---------- tracking ----------
  function move(subject, to, note = '') {
    if (!AREA_ORDER.includes(to)) fail(`Unknown work area ${to}.`);
    if (subject.area === to) return false;
    state.events.push({ id: nextId(), subjectId: subject.id, requestId: subject.requestId, from: subject.area, to, date: clock.today(), at: clock.now(), by: by(), note });
    subject.area = to;
    subject.since = clock.today();
    return true;
  }

  function nextAreaAfter(request, area) {
    const i = AREA_ORDER.indexOf(area);
    const later = AREA_ORDER.slice(i + 1).filter((a) => a !== 'BLOOD' && (request.areas.includes(a) || a === 'QC-PA'));
    return later[0] || 'QC-PA';
  }

  // ---------- charges ----------
  function newCharge(request, { section, code, date, units, note, subjectId }, source = 'MANUAL', extra = {}) {
    if (request.status === 'Cancelled') fail('This request is cancelled; charges cannot be added.');
    if (subjectId != null && !state.subjects.some((s) => s.id === Number(subjectId) && s.requestId === request.id))
      fail('That PHL number is not on this request.');
    const line = R.createCharge(catalog(), { requestId: request.id, chargeType: request.chargeType },
      { section: text(section, 20), code: text(code, 10).toUpperCase(), date: date || clock.today(), units: Number(units), description: text(note) || null, subjectId: subjectId == null ? null : Number(subjectId) });
    if (!isDate(line.date)) fail('The charge date is not a valid date.');
    const charge = {
      id: nextId(), requestId: request.id, subjectId: line.subjectId, section: line.section, code: line.code,
      codeDescription: codeInfo(line.code)?.description || '', note: line.description || '', date: line.date,
      units: line.units, unitPrice: line.unitPrice, amount: line.amount, status: 'PENDING', sourceType: source,
      adjustsId: null, batchId: null, enteredBy: by(), enteredAt: clock.now(), approvedBy: null, approvedAt: null, ...extra,
    };
    state.charges.push(charge);
    return charge;
  }

  function chargeView(c) {
    const subject = c.subjectId ? state.subjects.find((s) => s.id === c.subjectId) : null;
    return { ...c, phl: subject?.phl || null, batch: c.batchId ? state.batches.find((b) => b.id === c.batchId)?.fileName : null };
  }

  // The request's own charges, and the NAS request's: its authorization is shared by every request it funds, so what is
  // left is the authorization less the charges of all of them.
  function financials(r) {
    const live = chargesOf(r).filter((c) => c.status !== 'VOID');
    const nas = nasOf(r);
    const charged = R.sumMoney(live.map((c) => c.amount));
    const released = R.sumMoney(live.filter((c) => c.status === 'RELEASED').map((c) => c.amount));
    const authorized = nas?.authorized ?? null;
    const u = nas ? nasUsage(nas) : null;
    const nasCharged = u ? u.charged : charged;
    return { authorized, estimate: r.estimateTotal, charged, released, remaining: authorized == null ? null : round2(authorized - nasCharged),
      nasCharged, nasEstimated: u ? u.estimated : r.estimateTotal, nasRequests: u ? u.requests.length : 1,
      otherRequests: u ? u.requests.filter((x) => x.id !== r.id).map((x) => ({ id: x.id, number: x.number })) : [] };
  }

  // For lists: charged so far (every charge that is not void, released or not) against the estimate sent to NAS,
  // with the NAS authorization for context.
  function billingSummary(r) {
    const f = financials(r);
    const nas = nasOf(r);
    const level = f.authorized != null && f.nasCharged > f.authorized ? 'OVER_AUTHORIZED' : f.estimate && f.charged > f.estimate ? 'OVER_ESTIMATE' : 'OK';
    return { charged: f.charged, released: f.released, estimate: f.estimate, authorized: f.authorized, nasNumber: nas?.number || null, nasRequests: f.nasRequests, nasCharged: f.nasCharged,
      pctOfEstimate: f.estimate ? Math.round((f.charged / f.estimate) * 1000) / 10 : null, state: level };
  }

  // ---------- handlers ----------
  function meta() {
    const unpriced = priceList.items.filter((i) => i.price == null).map((i) => i.code);
    return {
      today: clock.today(), settings: state.settings, areas: AREAS, terminalAreas: TERMINAL_AREAS, requestTypes: REQUEST_TYPES,
      species: SPECIES, dictionaries: lists(), extras: NECROPSY_EXTRAS, perfusionCodes: PERFUSION_CODES,
      protocols: {
        necropsy: state.protocols.necropsy.map((p) => ({ id: p.id, name: p.name, approved: p.approved, obsolete: p.obsolete })),
        trim: state.protocols.trim.map((p) => ({ id: p.id, name: p.name, approved: p.approved, obsolete: p.obsolete })),
        fixatives: lists().fixatives || PROT.FIXATIVES, freezes: lists().freezes || PROT.FREEZES,
      },
      sections: priceList.sections, priceList: { name: priceList.name, codes: priceList.items.length, unpriced, pricingFrom: state.settings.pricingFrom },
      staff: staffInitials(),
      xenium: { steps: XEN.STEPS, assays: XEN.ASSAYS, panels: XEN.PANELS, qc: XEN.QC_FIELDS, slidesPerRun: XEN.SLIDES_PER_RUN },
      ihc: {
        species: IHC.REQUEST_SPECIES.map(([k, label]) => [k, label]), fixatives: IHC.REQUEST_FIXATIVES.map(([label]) => label), sampleTypes: IHC.SAMPLE_TYPES,
        pathologists: PATHOLOGISTS, flagText: IHC.FLAG_TEXT, speciesTags: IHC.SPECIES_TAGS, fixTags: IHC.FIXATIVE_TAGS, fields: IHC.ASSAY_FIELDS,
        catalog: { name: ihcCatalog?.name || 'IHC assay catalog', source: ihcCatalog?.source || '', convertedOn: ihcCatalog?.convertedOn || '', entries: state.assays.length,
          active: state.assays.filter((a) => a.status === 'Active').length, flagged: state.assays.filter((a) => a.status !== 'Retired' && a.flags.some((f) => f !== 'duplicate')).length },
        waiting: state.ihcRequests.filter((w) => w.status === 'Submitted').length,
        unassigned: state.ihcRequests.filter((w) => w.status === 'Accepted' && !w.assignedTo && w.workStatus !== 'Done').length,
        xeniumQueue: state.subjects.filter((s) => s.area === 'SPATL' && !onActiveRun(s.id)).length,
        xeniumActive: state.xenium.runs.filter((x) => XEN.isActive(x)).length,
      },
      pathology: {
        results: PATH.RESULTS, severity: PATH.SEVERITY, distribution: PATH.DISTRIBUTION, laterality: PATH.LATERALITY, behavior: PATH.BEHAVIOR, origin: PATH.ORIGIN,
        organs: state.library.organs.filter((o) => o.active !== false).map((o) => o.name), paired: state.library.organs.filter((o) => o.paired).map((o) => o.name),
        diagnoses: state.library.diagnoses, systems: TERM.INHAND_SYSTEMS, library: { source: state.library.source, updatedAt: state.library.updatedAt,
          sendCt: state.sendCt ? { fileName: state.sendCt.fileName, importedAt: state.sendCt.importedAt } : null },
      },
      wsi: {
        scanners: state.wsi.scanners.map((x) => ({ id: x.id, name: x.name, modes: x.modes, mags: x.mags, status: x.status })), rescanReasons: WSIX.RESCAN_REASONS,
        toReview: state.wsi.images.filter((x) => x.status === 'TO_REVIEW' || x.status === 'UNMATCHED').length,
      },
      bloodwork: {
        instruments: BW.INSTRUMENTS, chemistry: BW.CHEMISTRY, hematology: BW.HEMATOLOGY, specimens: BW.CYTOLOGY_SPECIMENS, stains: BW.CYTOLOGY_STAINS,
        differentials: BW.DIFFERENTIALS, rbcMorphology: BW.RBC_MORPHOLOGY, grades: BW.GRADES, plateletEstimates: BW.PLATELET_ESTIMATES,
        toReview: state.bloodwork.results.filter((r) => r.status === 'TO_REVIEW' || r.status === 'UNMATCHED').length,
      },
    };
  }

  function search({ query }) {
    const raw = text(query.q, 60);
    const t = raw.toUpperCase().replace(/^NAS\s*#?\s*/, '').replace(/^ZAP\s+/, 'ZAP');
    if (t.length < 2) return { hits: [], assays: { count: 0, top: [] } };
    const hits = [];
    for (const r of state.requests) {
      const nas = nasOf(r); const study = studyOf(r);
      const web = r.webRequestId ? state.ihcRequests.find((w) => w.id === r.webRequestId) : null;
      let matched = null;
      if (r.number.startsWith(t)) matched = `Request ${r.number}`;
      else if (nas && nas.number.toUpperCase() === t) matched = `NAS# ${nas.number}`;
      else if (study && study.zap.toUpperCase() === t) matched = `ZAP# ${study.zap}`;
      else if (web && web.number.replace('-', '').startsWith(t.replace('-', ''))) matched = `IHC request ${web.number}`;
      else {
        const s = state.subjects.find((x) => x.requestId === r.id && x.phl.startsWith(t));
        if (s) matched = `PHL# ${s.phl}`;
        else if (r.pi.last.toUpperCase().startsWith(t)) matched = `Investigator ${r.pi.last}`;
      }
      if (matched) hits.push({ id: r.id, href: `#/request/${r.id}`, number: r.number, pi: piName(r.pi), type: REQUEST_TYPES[r.type].name, status: r.status, zap: study?.zap || null, received: r.received, matched, billing: billingSummary(r) });
    }
    // IHC requests from the web form that are not (yet) LIMS requests.
    for (const w of state.ihcRequests.filter((x) => !x.requestId)) {
      let matched = null;
      if (w.number.replace('-', '').startsWith(t.replace('-', ''))) matched = `IHC request ${w.number}`;
      else if (w.requester.last.toUpperCase().startsWith(t)) matched = `Investigator ${w.requester.last}`;
      else if (w.samples.some((s) => s.blockNo && s.blockNo.toUpperCase().startsWith(t))) matched = `Block ${w.samples.find((s) => s.blockNo.toUpperCase().startsWith(t)).blockNo}`;
      if (matched) hits.push({ id: w.id, href: `#/molecular/request/${w.id}`, number: w.number, pi: piName(w.requester), type: 'IHC request from the web form', status: w.status, zap: null, received: w.submittedOn, matched });
    }
    // Cost estimates (the current revision of each), by number or investigator.
    const tq = estimateQuery(t).replace(/[\s-]/g, '');
    for (const e of currentEstimates().filter((x) => x.status !== 'DISCARDED')) {
      let matched = null;
      if (tq.length >= 3 && e.number.replace('-', '').startsWith(tq)) matched = `Estimate ${ESTX.estimateLabel(e)}`;
      else if (e.investigator.last.toUpperCase().startsWith(t)) matched = `Investigator ${e.investigator.last} (estimate)`;
      if (matched) hits.push({ id: e.id, href: `#/estimates/${e.id}`, number: ESTX.estimateLabel(e), pi: piName(e.investigator), type: `Cost estimate: ${e.title}`,
        status: ESTX.STATUS_LABEL[ESTX.displayStatus(e, clock.today())], zap: null, received: e.sentOn || e.createdOn, matched });
    }
    hits.sort((a, b) => b.received.localeCompare(a.received) || b.number.localeCompare(a.number));
    // Antibodies in the IHC catalog, so "CD8" or "ab101500" finds the assay too.
    const q = raw.toLowerCase();
    const found = /^[\d-]+[a-z]?$/i.test(raw) && raw.length > 5 ? [] : state.assays.filter((a) => a.status === 'Active' && (a.name.toLowerCase().includes(q) || a.catalog.toLowerCase().includes(q)));
    found.sort((a, b) => Number(!a.name.toLowerCase().startsWith(q)) - Number(!b.name.toLowerCase().startsWith(q)) || a.name.localeCompare(b.name));
    return { hits: hits.slice(0, 50), assays: { count: found.length, top: found.slice(0, 6).map((a) => ({ id: a.id, name: a.name, kind: IHC.kindLabel(a), species: a.species, catalog: a.catalog })) } };
  }

  function requestDetail({ params }) {
    const r = getRequest(params[0]);
    const study = studyOf(r);
    const subjects = subjectsOf(r).map((s) => ({ ...s, necropsy: state.necropsies[s.id]?.status || null, pathology: state.pathology[s.id]?.status || null }));
    const track = AREAS.filter((a) => a.code === 'ENTRY' || a.code === 'QC-PA' || r.areas.includes(a.code));
    const web = r.webRequestId ? state.ihcRequests.find((w) => w.id === r.webRequestId) : null;
    return {
      request: { ...r, piName: piName(r.pi), typeName: REQUEST_TYPES[r.type].name },
      nas: nasOf(r) ? nasView(nasOf(r)) : null, study: study ? { id: study.id, zap: study.zap, title: study.title, acuc: study.acuc } : null,
      webRequest: web ? { id: web.id, number: web.number, submittedOn: web.submittedOn, pathologist: web.pathologist, stains: web.stains.length } : null,
      openNas: r.nasId ? [] : state.nas.filter((n) => !n.closed).map((n) => ({ id: n.id, number: n.number, requester: n.requester, authorized: n.authorized, requests: requestsOfNas(n).length })),
      subjects, track,
      charges: chargesOf(r).sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id).map(chargeView),
      financials: financials(r),
      reviews: state.reviews.filter((v) => v.requestId === r.id),
      events: state.events.filter((e) => e.requestId === r.id).slice(-60).reverse()
        .map((e) => ({ ...e, phl: state.subjects.find((s) => s.id === e.subjectId)?.phl })),
      audit: state.audit.filter((a) => a.entity === 'request' && a.entityId === r.id).slice(-30).reverse(),
      images: state.wsi.images.filter((x) => subjects.some((s) => s.id === x.subjectId)).map(imageSummary),
      xeniumRuns: state.xenium.runs.filter((x) => x.slides.some((sl) => sl.sections.some((sec) => subjects.some((s) => s.id === sec.subjectId)))).map(runSummary),
      bloodwork: {
        results: state.bloodwork.results.filter((x) => subjects.some((s) => s.id === x.subjectId)).map(resultSummary),
        cytology: state.bloodwork.cytology.filter((x) => subjects.some((s) => s.id === x.subjectId)).map(cytologySummary),
      },
    };
  }

  // The MHL Request Tracking Form, as PHL.exe printed it (d_cmp001 = d_req_prt + d_phl_prt_hp): the request on top,
  // then each PHL number with inits, proc and units rows under every work area, a new page for each priority.
  // Staff fill it in by hand as the samples move through the lab.
  const SHEET_COLUMNS = [['BLOOD', 'Hema/Blood Chem'], ['NECRO', 'Necro'], ['TRIMM', 'Trimm'], ['EMBED', 'Embed'], ['MICRO', 'Micro'], ['STAIN', 'Stain'],
    ['SPATL', 'Xenium'], ['IMAGE', 'Image'], ['PATHO', 'Path'], ['OTHER', 'Other'], ['QC-PA', 'QC']];
  const PRIORITY_NAME = { S: 'STAT', P: 'Priority', R: 'Routine' };

  function trackingSheet({ params }) {
    const r = getRequest(params[0]);
    const nas = nasOf(r); const study = studyOf(r);
    const web = r.webRequestId ? state.ihcRequests.find((w) => w.id === r.webRequestId) : null;
    const subjects = subjectsOf(r);
    const pathologists = [...new Set(subjects.map((s) => state.pathology[s.id]?.pathologist || state.pathAssign[s.id]).filter(Boolean))];
    const columns = SHEET_COLUMNS.filter(([code]) => code !== 'SPATL' || r.areas.includes('SPATL'))
      .map(([code, label]) => ({ code, label, inRequest: code === 'OTHER' || code === 'QC-PA' || r.areas.includes(code) }));
    // Work already recorded in the LIMS, for a sheet reprinted part way: who moved the PHL number on from each area, and
    // when (the first forward move; a move back for a recut is not the area finishing), and who completed it (QC).
    const ahead = (from, to) => AREA_ORDER.indexOf(to) > AREA_ORDER.indexOf(from);
    const done = (s) => {
      const out = {};
      for (const e of state.events.filter((x) => x.subjectId === s.id)) {
        if (!e.from || !ahead(e.from, e.to)) continue;
        if (e.from !== 'ENTRY' && !out[e.from]) out[e.from] = { by: e.by, date: e.date };
        if (e.to === 'QC-PA' && !out['QC-PA']) out['QC-PA'] = { by: e.by, date: e.date };
      }
      return out;
    };
    const groups = ['S', 'P', 'R'].map((p) => ({ priority: p, label: PRIORITY_NAME[p],
      rows: subjects.filter((s) => (s.priority || r.priority || 'R') === p).map((s) => ({ id: s.id, phl: s.phl, label: s.label, groupCode: s.groupCode || '', sex: s.sex || '',
        restricted: !!s.restricted, area: s.area, done: done(s) })) })).filter((g) => g.rows.length);
    return {
      header: {
        lab: r.lab, number: r.number, typeCode: r.type, typeName: REQUEST_TYPES[r.type].name, investigatorLast: r.pi.last, investigatorFirst: r.pi.first || '',
        fixative: r.fixative || '', tissueDisp: r.tissueDisp || '', species: SPECIES[r.species]?.name || r.species, contact: r.createdBy || '',
        // The pathologist assigned in the LIMS; failing that, the one the investigator asked for on the IHC web request.
        pathologist: pathologists.join(', ') || (web?.pathologist && web.pathologist !== PATHOLOGISTS[0] ? web.pathologist : ''),
        zap: study?.zap || '', studyTitle: study?.title || '', acuc: study?.acuc || '', description: r.description || '',
        nasNumber: nas?.number || '', approvedBudget: nas?.authorized ?? null, estimatedCost: r.estimateTotal, received: r.received, due: r.due,
        chargeType: r.chargeType, estTurnaroundDays: REQUEST_TYPES[r.type].days, webRequestNumber: web?.number || '', printedOn: clock.today(),
      },
      columns, groups, count: subjects.length,
    };
  }

  function listRequests({ query }) {
    const status = text(query.status, 20);
    const rows = state.requests.filter((r) => !status || r.status === status).map((r) => {
      const subjects = subjectsOf(r);
      const counts = {};
      for (const s of subjects) counts[s.area] = (counts[s.area] || 0) + 1;
      return {
        id: r.id, number: r.number, pi: piName(r.pi), type: REQUEST_TYPES[r.type].name, status: r.status, received: r.received, due: r.due,
        zap: studyOf(r)?.zap || null, subjects: subjects.length, areas: counts,
        pending: chargesOf(r).filter((c) => c.status === 'PENDING').length, restricted: subjects.some((s) => s.restricted), billing: billingSummary(r),
      };
    });
    rows.sort((a, b) => (a.due || '').localeCompare(b.due || '') || a.number.localeCompare(b.number));
    return { requests: rows };
  }

  // NAS requests that can still start a request: every one not closed, with what is already estimated against it.
  function listNas({ query }) {
    const all = query.all === '1';
    const list = state.nas.filter((n) => all || !n.closed).map(nasView);
    list.sort((a, b) => Number(a.closed) - Number(b.closed) || Number(a.usage.requests.length > 0) - Number(b.usage.requests.length > 0) || a.submitted.localeCompare(b.submitted));
    return { nas: list, closed: state.nas.filter((n) => n.closed).length };
  }

  function getNas({ params }) {
    const nas = state.nas.find((n) => n.id === Number(params[0])) || (() => { throw new HttpError(404, 'NAS request not found.'); })();
    return { nas: nasView(nas) };
  }

  function closeNas({ params, body }) {
    const nas = state.nas.find((n) => n.id === Number(params[0])) || (() => { throw new HttpError(404, 'NAS request not found.'); })();
    const close = body.closed !== false;
    if (close && nas.closed) fail(`NAS# ${nas.number} is already closed.`);
    if (!close && !nas.closed) fail(`NAS# ${nas.number} is open.`);
    nas.closed = close;
    nas.closedBy = close ? by() : null; nas.closedOn = close ? clock.today() : null;
    audit(close ? 'NAS_CLOSED' : 'NAS_REOPENED', 'nas', nas.id, `NAS# ${nas.number}${close ? `, ${requestsOfNas(nas).length} requests made from it` : ''}`);
    commit();
    return { ok: true };
  }

  function addNas({ body }) {
    const type = text(body.type, 20);
    if (!REQUEST_TYPES[type]) fail('Choose a request type.');
    const last = text(body.requesterLast, 100);
    if (!last) fail('The requester\'s last name is required.');
    const authorized = Number(body.authorized);
    if (!(authorized > 0)) fail('The authorized amount must be more than zero.');
    const n = Number(body.n);
    if (!Number.isInteger(n) || n < 1 || n > 500) fail('The number of PHL numbers must be a whole number from 1 to 500.');
    const species = text(body.species, 20) || 'MOUSE';
    if (!SPECIES[species]) fail('Unknown species.');
    const yy = clock.today().slice(2, 4);
    let number = text(body.number, 30);
    if (!number) number = `${yy}-${String(allocate('NAS', yy, 1) + 400).padStart(4, '0')}`;
    if (state.nas.some((x) => x.number.toUpperCase() === number.toUpperCase())) fail(`NAS# ${number} already exists.`);
    const scope = Array.isArray(body.scope) ? body.scope.map(([s, c, u]) => [text(s, 20), text(c, 10), Number(u)]) : null;
    const nas = {
      id: nextId(), number, requester: { last, first: text(body.requesterFirst, 100), inst: text(body.inst, 200) },
      project: text(body.project, 30), authorized: round2(authorized), submitted: clock.today(),
      description: text(body.description, 1000), type, n, species, scope, requestId: null, closed: false,
    };
    state.nas.push(nas);
    audit('NAS_ADDED', 'nas', nas.id, number);
    commit();
    return { nas };
  }

  function createRequest({ body }) {
    const nas = state.nas.find((n) => n.id === Number(body.nasId));
    if (!nas) fail('Choose an approved NAS request.');
    mustBeOpenNas(nas);
    const earlier = requestsOfNas(nas).length;
    const species = text(body.species, 20) || 'MOUSE';
    // An animal list from the investigator: one PHL number per animal, in its order.
    const animals = body.animals != null ? readAnimals(body.animals, species) : null;
    if (animals && Number(body.n) !== animals.length) fail(`The request is for ${Number(body.n)} PHL numbers but the animal list has ${animals.length} animals.`);
    const { request, phls } = insertRequest({
      nas, pi: nas.requester, project: nas.project, description: nas.description, type: text(body.type, 20), n: Number(body.n),
      species, priority: body.priority, areas: body.areas, lines: body.lines, study: body.study, fixative: body.fixative,
      requestNumber: body.requestNumber, tissueDisp: body.tissueDisp, labels: animals ? animals.map((a) => a.label) : null,
    });
    if (animals) applyAnimals(request, animals, text(body.animalFile, 200));
    const phase = text(body.estimatePhase, 60);
    if (phase && (nas.estimatePhases || []).some((p) => p.name === phase)) request.estimatePhase = phase;
    const order = body.ihc ? attachIhcOrder(request, phls, body.ihc) : null;
    // The stains add their work areas (an add-on on existing blocks needs no trimming or embedding).
    if (order) {
      const add = IHC.ihcAreas(order).filter((a) => !(order.addOn && (a === 'TRIMM' || a === 'EMBED')));
      request.areas = AREA_ORDER.filter((x) => request.areas.includes(x) || add.includes(x));
    }
    audit('REQUEST_CREATED', 'request', request.id, `${request.number}${request.numberEnteredByHand ? ' (number entered by hand)' : ''} from NAS# ${nas.number}${earlier ? ` (request ${earlier + 1} on it)` : ''}${request.estimatePhase ? `, estimate phase "${request.estimatePhase}"` : ''}, ${phls.length} PHL numbers${request.animalList ? ` from the animal list${request.animalList.fileName ? ` ${request.animalList.fileName}` : ''}` : ''}${order ? `, with IHC order ${order.number}` : ''}`);
    commit();
    return { id: request.id, number: request.number, phls, ihcNumber: order?.number || null };
  }

  // The animals as the browser sends them, checked again here: the same rules as reading the spreadsheet.
  function readAnimals(list, species) {
    if (!Array.isArray(list) || !list.length) fail('The animal list is empty.');
    if (list.length > ANIMALS.MAX_ANIMALS) fail(`A request can have at most ${ANIMALS.MAX_ANIMALS} PHL numbers.`);
    const phi = ANIMALS.phiSpecies(species);
    const seen = new Set();
    return list.map((raw, i) => {
      const { animal, problems } = ANIMALS.normalizeAnimal(raw && typeof raw === 'object' ? raw : {}, { phi, today: clock.today() });
      if (problems.length) fail(`Animal ${i + 1}${animal.label ? ` (${animal.label})` : ''}: ${problems.join(' ')}`);
      const k = animal.label.toLowerCase();
      if (seen.has(k)) fail(`Animal ID ${animal.label} is in the list twice.`);
      seen.add(k);
      return animal;
    });
  }

  // Each PHL number gets its animal's details; the study gets any group it does not have yet.
  function applyAnimals(request, animals, fileName) {
    const subjects = state.subjects.filter((s) => s.requestId === request.id).sort((a, b) => a.phl.localeCompare(b.phl));
    const study = request.studyId ? state.studies.find((s) => s.id === request.studyId) : null;
    if (study) {
      for (const g of ANIMALS.groupsFromAnimals(animals)) {
        if (!study.groups.some((x) => x.code.toLowerCase() === g.code.toLowerCase())) study.groups.push(g);
      }
    }
    const codeOf = (c) => (c && study ? study.groups.find((x) => x.code.toLowerCase() === c.toLowerCase())?.code : c) || null;
    const groupTreatment = (c) => (study ? study.groups.find((x) => x.code === c)?.treatment : '') || '';
    subjects.forEach((s, i) => {
      const a = animals[i];
      // Groups belong to a study; without one, the animal's group is kept in its notes.
      const code = study ? codeOf(a.groupCode) : null;
      const noted = !study && a.groupCode ? `Group: ${a.groupCode}` : '';
      // A treatment that differs from its group's goes into the animal's notes, so it is not lost.
      const ownTreatment = a.treatment && a.treatment !== groupTreatment(code) ? `Treatment: ${a.treatment}` : '';
      Object.assign(s, { groupCode: code, sex: a.sex || null, strain: a.strain, genotype: a.genotype, dob: a.dob || null, age: a.age, cage: a.cage,
        notes: [a.notes, noted, ownTreatment].filter(Boolean).join('. ') });
      if (a.priority === 'S' || a.priority === 'P') s.priority = a.priority;
    });
    request.animalList = { fileName, animals: animals.length, by: by(), at: clock.now() };
  }

  // Issues the request number and PHL numbers and accessions them. Shared by NAS intake and accepted IHC requests.
  // ---------- request numbers ----------
  // Automatic: lab + two-digit year + counter (HP260103), skipping any number already used. By hand: a number such as a
  // legacy PHL request ID (270333, 270333A). The Rpt080 billing extract identifies a request by its lab letter and the
  // last five characters of its number, so those must not match another request of the same lab.
  const transIdOf = (lab, number) => R.transId(lab, number);
  function requestNumberProblem(lab, number) {
    const n = String(number || '');
    // Letters and digits, optionally in parts joined by single hyphens; the last five (the billing trans ID) letters and digits only.
    if (n.length < 4 || n.length > 12 || !/^[A-Z0-9]+(-[A-Z0-9]+)*$/.test(n) || !/[1-9]/.test(n) || /-/.test(n.slice(-5))) {
      return 'A request number is 4 to 12 letters and digits (hyphens allowed between parts, but not in the last five characters), with at least one digit that is not zero.';
    }
    const other = n.match(/^([A-Z]{2})\d{6}$/);
    if (other && other[1] !== lab && Object.values(REQUEST_TYPES).some((d) => d.lab === other[1])) return `${n} looks like a ${other[1]} request number, but this request belongs to the ${lab} lab.`;
    if (state.requests.some((r) => r.number === n)) return `Request ${n} already exists.`;
    const clash = state.requests.find((r) => r.lab === lab && transIdOf(lab, r.number) === transIdOf(lab, n));
    if (clash) return `The billing extract (Rpt080) knows a request by its last five characters, and ${n} ends like ${clash.number}. Choose another number.`;
    return '';
  }
  function nextRequestNumber(lab, today, { take = false } = {}) {
    const yy = today.slice(2, 4);
    const key = `REQ-${lab}`;
    let n = state.counters[key]?.[yy] || 1;
    while (requestNumberProblem(lab, R.formatRequestNumber(lab, today, n))) n++;
    if (take) (state.counters[key] ||= {})[yy] = n + 1;   // only a create writes the counter; a peek leaves state alone
    return R.formatRequestNumber(lab, today, n);
  }
  function peekRequestNumber({ query }) {
    const def = REQUEST_TYPES[text(query.type, 20)] || REQUEST_TYPES['NECRO-FULL'];
    return { number: nextRequestNumber(def.lab, clock.today()), lab: def.lab };
  }
  function checkRequestNumber({ query }) {
    const def = REQUEST_TYPES[text(query.type, 20)] || REQUEST_TYPES['NECRO-FULL'];
    const number = text(query.number, 20).toUpperCase();
    const problem = requestNumberProblem(def.lab, number);
    return { number, ok: !problem, problem, transId: problem ? '' : transIdOf(def.lab, number) };
  }

  function insertRequest({ nas = null, pi, project, description, type, n, species, priority, areas, lines, study, fixative, labels = null, sources = null, webRequestId = null, requestNumber = '', tissueDisp = '' }) {
    const def = REQUEST_TYPES[type];
    if (!def) fail('Choose a request type.');
    if (!Number.isInteger(n) || n < 1 || n > 500) fail('The number of PHL numbers must be a whole number from 1 to 500.');
    if (!SPECIES[species]) fail('Unknown species.');
    const prio = ['R', 'P', 'S'].includes(priority) ? priority : 'R';
    const workAreas = Array.isArray(areas) && areas.length
      ? AREA_ORDER.filter((a) => areas.includes(a) && a !== 'ENTRY' && a !== 'QC-PA') : def.areas;
    if (!Array.isArray(lines) || lines.length === 0) fail('The estimate needs at least one line.');
    const cat = catalog();
    const estimateLines = lines.map((l) => {
      const e = R.estimateLine(cat, { section: text(l.section, 20), code: text(l.code, 10).toUpperCase(), units: Number(l.units), date: clock.today() });
      return { section: e.section, code: e.code, description: e.description, units: e.units, unitPrice: e.unitPrice, amount: e.amount };
    });

    // Study: none, an existing one, or a new one created here.
    let studyId = null;
    const st = study || {};
    if (st.mode === 'existing') {
      studyId = getStudy(st.studyId).id;
    } else if (st.mode === 'new') {
      studyId = insertStudy({ zap: st.zap, title: st.title, pi, acuc: st.acuc, protocolId: st.protocolId || (type === 'NECRO-FULL' ? 1 : 2),
        necropsyProtocolId: st.necropsyProtocolId, trimProtocolId: st.trimProtocolId }).id;
    }

    const today = clock.today();
    const lab = def.lab;
    const yy = today.slice(2, 4);
    const manual = text(requestNumber, 20).toUpperCase();
    if (manual) { const problem = requestNumberProblem(lab, manual); if (problem) fail(problem); }
    const number = manual || nextRequestNumber(lab, today, { take: true });
    const request = {
      id: nextId(), number, lab, type, status: 'Open', received: today, due: addDays(today, def.days), completed: null,
      pi: { ...pi }, nasId: nas?.id ?? null, project: text(project, 40), studyId, priority: prio, species, fixative: text(fixative, 20) || '10%NBF',
      areas: workAreas, description: text(description, 1000), chargeType: 'C', estimateLines, estimateTotal: R.sumMoney(estimateLines.map((l) => l.amount)),
      webRequestId, createdBy: by(), createdAt: clock.now(), numberEnteredByHand: !!manual, tissueDisp: text(tissueDisp, 20).toUpperCase(),
    };
    state.requests.push(request);
    const phls = R.formatPhlNumbers(allocate('PHL', yy, n), n, 'YearPrefixed', today);
    const sp = SPECIES[species];
    phls.forEach((phl, i) => {
      const subject = {
        id: nextId(), requestId: request.id, phl, label: labels?.[i] || (sp.restricted ? `Case ${i + 1}` : String(i + 1)), groupCode: null, sex: null,
        priority: prio, species, subjectType: sp.subjectType, restricted: sp.restricted, area: null, since: today, studyId, sampleIndex: labels ? i : null,
        sourceSubjectId: sources?.[i] ?? null,   // the existing PHL# this block came from, if any
      };
      state.subjects.push(subject);
      move(subject, 'ENTRY', 'Accessioned');
    });
    if (nas && !nas.requestId) nas.requestId = request.id;   // the first request made from it (requests carry nasId)
    return { request, phls };
  }

  // A request accepted from the IHC web form may not have a NAS request yet; link one later.
  function linkNas({ params, body }) {
    const r = getRequest(params[0]);
    if (r.nasId) fail(`Request ${r.number} already has a NAS request.`);
    const nas = state.nas.find((n) => n.id === Number(body.nasId));
    if (!nas) fail('Choose a NAS request.');
    mustBeOpenNas(nas);
    r.nasId = nas.id;
    if (!nas.requestId) nas.requestId = r.id;
    if (!r.project) r.project = nas.project;
    audit('NAS_LINKED', 'request', r.id, `NAS# ${nas.number}`);
    commit();
    return { ok: true };
  }

  function moveSubjects({ params, body }) {
    const r = getRequest(params[0]);
    const to = text(body.to, 10);
    const ids = new Set((body.subjectIds || []).map(Number));
    const subjects = subjectsOf(r).filter((s) => ids.has(s.id));
    if (subjects.length === 0) fail('Select at least one PHL number.');
    let moved = 0;
    for (const s of subjects) if (move(s, to, text(body.note, 200))) moved++;
    if (moved) audit('SUBJECTS_MOVED', 'request', r.id, `${moved} to ${AREAS.find((a) => a.code === to)?.name || to}`);
    commit();
    return { moved };
  }

  function completeRequest({ params, body }) {
    const r = getRequest(params[0]);
    if (r.status !== 'Open') fail(`Request ${r.number} is ${r.status}; only open requests can be completed.`);
    const date = body.date || clock.today();
    if (!isDate(date)) fail('The completion date is not valid.');
    if (date < r.received) fail('The completion date is before the received date.');
    if (date > clock.today()) fail('The completion date cannot be in the future.');
    const open = subjectsOf(r).filter((s) => !TERMINAL_AREAS.includes(s.area)).map((s) => s.phl);
    if (open.length) fail(`Request ${r.number} cannot be completed: ${open.slice(0, 8).join(', ')}${open.length > 8 ? ` and ${open.length - 8} more` : ''} not yet complete.`);
    r.status = 'Complete'; r.completed = date;
    audit('REQUEST_COMPLETED', 'request', r.id, date);
    commit();
    return { ok: true };
  }

  function addCharge({ params, body }) {
    const r = getRequest(params[0]);
    const c = newCharge(r, { section: body.section, code: body.code, date: body.date, units: body.units, note: body.note, subjectId: body.subjectId || null });
    audit('CHARGE_ADDED', 'request', r.id, `${c.code} x ${c.units} = ${c.amount.toFixed(2)}`);
    commit();
    return { charge: chargeView(c) };
  }

  function editCharge({ params, body }) {
    const c = getCharge(params[0]);
    if (c.status !== 'PENDING') fail('Only pending charges can be edited. Return it to pending first.');
    if (c.sourceType === 'ADJUSTMENT') fail('Adjustments cannot be edited; void it and add a new adjustment.');
    const units = body.units == null ? c.units : Number(body.units);
    R.validateUnits(units);
    const note = body.note == null ? c.note : text(body.note);
    if (codeInfo(c.code)?.requiresDescription && !note) fail(`${c.code} needs a description of the work.`);
    c.units = units; c.note = note; c.amount = R.amount(units, c.unitPrice);
    audit('CHARGE_EDITED', 'request', c.requestId, `${c.code} now x ${units}`);
    commit();
    return { charge: chargeView(c) };
  }

  function approveCharge({ params }) {
    const c = getCharge(params[0]);
    if (c.status !== 'PENDING') fail(`Only pending charges can be approved (this one is ${c.status.toLowerCase()}).`);
    c.status = 'APPROVED'; c.approvedBy = by(); c.approvedAt = clock.now();
    audit('CHARGE_APPROVED', 'request', c.requestId, c.code);
    commit();
    return { charge: chargeView(c) };
  }

  function returnCharge({ params }) {
    const c = getCharge(params[0]);
    if (c.status !== 'APPROVED') fail('Only approved charges can be returned to pending.');
    c.status = 'PENDING'; c.approvedBy = null; c.approvedAt = null;
    audit('CHARGE_RETURNED', 'request', c.requestId, c.code);
    commit();
    return { charge: chargeView(c) };
  }

  function voidCharge({ params, body }) {
    const c = getCharge(params[0]);
    if (c.status === 'RELEASED') fail('Released charges cannot be voided. Add an adjustment instead.');
    if (c.status === 'VOID') fail('This charge is already void.');
    c.status = 'VOID'; c.voidReason = text(body.reason, 300);
    audit('CHARGE_VOIDED', 'request', c.requestId, `${c.code}${c.voidReason ? `: ${c.voidReason}` : ''}`);
    commit();
    return { charge: chargeView(c) };
  }

  function adjustCharge({ params, body }) {
    const c = getCharge(params[0]);
    if (c.status !== 'RELEASED') fail('Only released charges are adjusted. Edit or void the charge instead.');
    const delta = Number(body.unitsDelta);
    if (!delta || Math.abs(Math.round(delta * 100) - delta * 100) > 1e-9) fail('Enter a non-zero change in units, with at most two decimals.');
    const reason = text(body.reason, 300);
    if (!reason) fail('An adjustment needs a reason.');
    const prior = state.charges.filter((x) => x.adjustsId === c.id && x.status !== 'VOID').reduce((a, x) => a + x.units, 0);
    if (c.units + prior + delta < 0) fail('The adjustments would reverse more units than were charged.');
    const adj = {
      ...c, id: nextId(), units: delta, amount: R.amount(delta, c.unitPrice), date: clock.today(), note: reason, status: 'PENDING',
      sourceType: 'ADJUSTMENT', adjustsId: c.id, batchId: null, enteredBy: by(), enteredAt: clock.now(), approvedBy: null, approvedAt: null,
    };
    state.charges.push(adj);
    audit('CHARGE_ADJUSTED', 'request', c.requestId, `${c.code} ${delta > 0 ? '+' : ''}${delta}: ${reason}`);
    commit();
    return { charge: chargeView(adj) };
  }

  function approvePending({ params }) {
    const r = getRequest(params[0]);
    const pending = chargesOf(r).filter((c) => c.status === 'PENDING');
    for (const c of pending) { c.status = 'APPROVED'; c.approvedBy = by(); c.approvedAt = clock.now(); }
    if (pending.length) audit('CHARGES_APPROVED', 'request', r.id, `${pending.length} charges`);
    commit();
    return { approved: pending.length };
  }

  function review({ params, body }) {
    const r = getRequest(params[0]);
    const outcome = body.outcome === 'CORRECTIONS_NEEDED' ? 'CORRECTIONS_NEEDED' : 'OK';
    const rv = { id: nextId(), requestId: r.id, by: by(), at: clock.now(), date: clock.today(), outcome, comment: text(body.comment, 500) };
    state.reviews.push(rv);
    audit('BILLING_REVIEWED', 'request', r.id, outcome === 'OK' ? 'Billing QC: OK' : `Billing QC: corrections needed. ${rv.comment}`);
    commit();
    return { review: rv };
  }

  // ---------- billing ----------
  function billingQueue() {
    const rows = [];
    for (const r of state.requests) {
      const cs = chargesOf(r);
      const pending = cs.filter((c) => c.status === 'PENDING');
      const approved = cs.filter((c) => c.status === 'APPROVED');
      if (!pending.length && !approved.length) continue;
      rows.push({
        id: r.id, number: r.number, pi: piName(r.pi), status: r.status,
        pending: { count: pending.length, amount: R.sumMoney(pending.map((c) => c.amount)) },
        approved: { count: approved.length, amount: R.sumMoney(approved.map((c) => c.amount)) },
        lastReview: state.reviews.filter((v) => v.requestId === r.id).at(-1) || null,
      });
    }
    return { requests: rows.sort((a, b) => b.pending.count - a.pending.count || a.number.localeCompare(b.number)) };
  }

  function eligible(lab, start, end) {
    if (!['HP', 'PA'].includes(lab)) fail('Choose the HP or PA lab.');
    if (!isDate(start) || !isDate(end)) fail('Enter a valid billing period.');
    if (end < start) fail('The billing period ends before it starts.');
    const batch = { lab, periodStart: start, periodEnd: end };
    return state.charges.filter((c) => R.isEligible(batch, c));
  }

  function extractLines(lines) {
    return lines.map((c) => {
      const r = state.requests.find((x) => x.id === c.requestId);
      return { requestNumber: r.number, lab: r.lab, project: r.project, investigator: piName(r.pi), nas: nasOf(r)?.number || null, code: c.code, units: c.units };
    });
  }

  function billingPreview({ query }) {
    const lines = eligible(text(query.lab, 4), query.start, query.end);
    const records = R.rpt080Records(extractLines(lines), query.end);
    return {
      lines: lines.map(chargeView).map((c) => ({ ...c, requestNumber: state.requests.find((r) => r.id === c.requestId).number })),
      total: R.sumMoney(lines.map((c) => c.amount)), records, file: R.rpt080Write(records),
    };
  }

  function releaseBatch({ body }) {
    const lab = text(body.lab, 4);
    const lines = eligible(lab, body.start, body.end);
    if (!lines.length) fail('There are no approved charges for this lab and period. Approve charges in the billing QC queue first.');
    const records = R.rpt080Records(extractLines(lines), body.end);
    let fileName = `${lab}${body.end.slice(2, 4)}${body.end.slice(5, 7)}${body.end.slice(8, 10)}.txt`;
    let k = 2;
    while (state.batches.some((b) => b.fileName === fileName)) fileName = fileName.replace(/(-\d+)?\.txt$/, `-${k++}.txt`);
    const batch = {
      id: nextId(), lab, periodStart: body.start, periodEnd: body.end, status: 'RELEASED', releasedBy: by(), releasedAt: clock.now(),
      lineIds: lines.map((c) => c.id), lineCount: lines.length, total: R.sumMoney(lines.map((c) => c.amount)), fileName, file: R.rpt080Write(records),
    };
    for (const c of lines) { c.status = 'RELEASED'; c.batchId = batch.id; }
    state.batches.push(batch);
    audit('BATCH_RELEASED', 'batch', batch.id, `${fileName}: ${lines.length} lines, ${batch.total.toFixed(2)}`);
    for (const rid of new Set(lines.map((c) => c.requestId))) audit('CHARGES_RELEASED', 'request', rid, `Billing batch ${fileName}`);
    commit();
    return { batch: { ...batch, file: undefined } };
  }

  function listBatches() {
    return { batches: state.batches.map(({ file, lineIds, ...b }) => b).sort((a, b) => b.releasedAt.localeCompare(a.releasedAt)) };
  }

  function batchFile({ params }) {
    const b = state.batches.find((x) => x.id === Number(params[0]));
    if (!b) throw new HttpError(404, 'Billing batch not found.');
    return { __file: { name: b.fileName, type: 'text/plain; charset=utf-8', content: b.file } };
  }

  function getPriceList() {
    return { name: priceList.name, pricingFrom: state.settings.pricingFrom, sections: priceList.sections, items: priceList.items };
  }

  // ---------- studies ----------
  function protocolIds({ protocolId, necropsyProtocolId, trimProtocolId }) {
    const nec = necProtocol(necropsyProtocolId ?? protocolId) || firstUsable(state.protocols.necropsy);
    const trim = trimProtocolId === '' || trimProtocolId === 0 ? null : (trimProtocol(trimProtocolId ?? protocolId) || (trimProtocolId == null ? firstUsable(state.protocols.trim) : null));
    if (!nec) fail('There is no necropsy protocol. Add one under Necropsy > Protocols.');
    if (nec.obsolete) fail(`The necropsy protocol "${nec.name}" is obsolete.`);
    if (trim?.obsolete) fail(`The trim protocol "${trim.name}" is obsolete.`);
    return { necropsyProtocolId: nec.id, trimProtocolId: trim?.id ?? null };
  }

  function insertStudy({ zap, title, pi, acuc, protocolId, necropsyProtocolId, trimProtocolId }) {
    let z = text(zap, 20).toUpperCase().replace(/\s+/g, '');
    if (!z) z = `ZAP${allocate('ZAP', 0, 1) + 2239}`;
    if (!/^ZAP\d{3,6}$/.test(z)) fail('A ZAP number looks like ZAP2240.');
    if (state.studies.some((s) => s.zap === z)) fail(`${z} already exists.`);
    const study = {
      id: nextId(), zap: z, title: text(title, 300) || 'Untitled study', pi: pi || { last: '', first: '', inst: '' }, acuc: text(acuc, 50),
      ...protocolIds({ protocolId, necropsyProtocolId, trimProtocolId }), groups: [], createdOn: clock.today(),
    };
    state.studies.push(study);
    audit('STUDY_CREATED', 'study', study.id, z);
    return study;
  }

  function listStudies() {
    return {
      studies: state.studies.map((s) => {
        const animals = state.subjects.filter((x) => x.studyId === s.id);
        return { id: s.id, zap: s.zap, title: s.title, pi: piName(s.pi), protocol: necProtocol(s.necropsyProtocolId)?.name || '', trimProtocol: trimProtocol(s.trimProtocolId)?.name || '', animals: animals.length,
          necropsied: animals.filter((a) => state.necropsies[a.id]?.status === 'APPROVED').length, createdOn: s.createdOn };
      }).sort((a, b) => b.zap.localeCompare(a.zap)),
    };
  }

  function createStudy({ body }) {
    const s = insertStudy({ zap: body.zap, title: body.title, pi: { last: text(body.piLast, 100), first: text(body.piFirst, 100), inst: text(body.inst, 200) }, acuc: body.acuc,
      protocolId: body.protocolId, necropsyProtocolId: body.necropsyProtocolId, trimProtocolId: body.trimProtocolId });
    commit();
    return { id: s.id, zap: s.zap };
  }

  function editStudy({ params, body }) {
    const s = getStudy(params[0]);
    if (body.title != null) s.title = text(body.title, 300) || s.title;
    if (body.acuc != null) s.acuc = text(body.acuc, 50);
    const wantNec = body.necropsyProtocolId ?? body.protocolId;
    const wantTrim = body.trimProtocolId !== undefined ? (body.trimProtocolId === '' ? null : body.trimProtocolId) : body.protocolId;
    const changed = (wantNec != null && Number(wantNec) !== s.necropsyProtocolId) || (wantTrim !== undefined && (wantTrim == null ? null : Number(wantTrim)) !== (s.trimProtocolId ?? null));
    if (changed) {   // a study may keep a protocol that has since become obsolete; only a change is checked
      Object.assign(s, protocolIds({ necropsyProtocolId: wantNec ?? s.necropsyProtocolId, trimProtocolId: wantTrim === undefined ? s.trimProtocolId : (wantTrim == null ? '' : wantTrim) }));
    }
    audit('STUDY_EDITED', 'study', s.id, s.zap);
    commit();
    return { ok: true };
  }

  function setGroups({ params, body }) {
    const s = getStudy(params[0]);
    const groups = (body.groups || []).map((g) => ({
      code: text(g.code, 20), name: text(g.name, 100), sex: ['M', 'F', 'U'].includes(g.sex) ? g.sex : '', genotype: text(g.genotype, 100), treatment: text(g.treatment, 200),
    })).filter((g) => g.code);
    const codes = groups.map((g) => g.code.toUpperCase());
    if (new Set(codes).size !== codes.length) fail('Each group needs its own code.');
    const removed = s.groups.filter((g) => !groups.some((x) => x.code === g.code)).map((g) => g.code);
    const inUse = state.subjects.filter((x) => x.studyId === s.id && removed.includes(x.groupCode));
    if (inUse.length) fail(`Group ${inUse[0].groupCode} still has animals assigned. Move them first.`);
    s.groups = groups;
    audit('GROUPS_SET', 'study', s.id, groups.map((g) => g.code).join(', '));
    commit();
    return { groups };
  }

  function editSubject({ params, body }) {
    const subj = getSubject(params[0]);
    const study = subj.studyId ? state.studies.find((s) => s.id === subj.studyId) : null;
    if (body.groupCode !== undefined) {
      const code = text(body.groupCode, 20) || null;
      if (code && !study?.groups.some((g) => g.code === code)) fail(`Group ${code} is not defined for this study.`);
      subj.groupCode = code;
      const g = study?.groups.find((x) => x.code === code);
      if (g?.sex && !body.sex) subj.sex = g.sex;
    }
    if (body.sex !== undefined) subj.sex = ['M', 'F', 'U'].includes(body.sex) ? body.sex : null;
    if (body.label !== undefined) subj.label = text(body.label, 40) || subj.label;
    if (body.priority !== undefined && ['R', 'P', 'S'].includes(body.priority)) subj.priority = body.priority;
    if (body.dob !== undefined) subj.dob = isDate(body.dob) ? body.dob : null;
    audit('SUBJECT_EDITED', 'request', subj.requestId, subj.phl);
    commit();
    return { subject: subj };
  }

  function studyDetail({ params }) {
    const s = getStudy(params[0]);
    const protocol = studyProtocol(s);
    const animals = state.subjects.filter((x) => x.studyId === s.id).sort((a, b) => a.phl.localeCompare(b.phl));
    const nx = animals.map((a) => ({ a, n: state.necropsies[a.id] }));
    const approved = nx.filter(({ n }) => n?.status === 'APPROVED');
    const groupName = (code) => s.groups.find((g) => g.code === code)?.name || '';
    const groupKeys = [...s.groups.map((g) => g.code), ...(animals.some((a) => !a.groupCode) ? ['(none)'] : [])];
    const keyOf = (a) => a.groupCode || '(none)';

    const series = (label, unit, pick) => {
      const points = approved.map(({ a, n }) => ({ phl: a.phl, label: a.label, group: keyOf(a), sex: a.sex || 'U', value: pick(n) }))
        .filter((p) => typeof p.value === 'number' && Number.isFinite(p.value));
      if (!points.length) return null;
      const groups = groupKeys.map((code) => {
        const d = describe(points.filter((p) => p.group === code).map((p) => p.value));
        return { code, name: groupName(code), n: d.n, mean: sig(d.mean), sd: sig(d.sd), ciLow: sig(d.ciLow), ciHigh: sig(d.ciHigh) };
      }).filter((g) => g.n > 0);
      return { label, unit, groups, points };
    };
    const weighed = protocol.organs.filter((o) => o.weigh).map((o) => o.organ);
    const organW = (n, organ) => n.organs.find((o) => o.organ === organ && !o.notCollected)?.weight ?? null;
    const absolute = [series('Body weight', 'g', (n) => n.bodyWeight), ...weighed.map((o) => series(o, 'g', (n) => organW(n, o)))].filter(Boolean);
    const relative = weighed.map((o) => series(o, '% of body weight', (n) => {
      const w = organW(n, o);
      return w != null && n.bodyWeight ? (w / n.bodyWeight) * 100 : null;
    })).filter(Boolean);

    // Gross findings incidence: animals with a finding of that morphology in that organ, by group.
    const incidence = new Map();
    for (const { a, n } of approved)
      for (const o of n.organs)
        for (const f of o.findings) {
          const key = `${o.organ}|${f.morphology}`;
          if (!incidence.has(key)) incidence.set(key, { organ: o.organ, morphology: f.morphology, byGroup: {} });
          const row = incidence.get(key);
          (row.byGroup[keyOf(a)] ||= new Set()).add(a.id);
        }
    const examined = Object.fromEntries(groupKeys.map((g) => [g, approved.filter(({ a }) => keyOf(a) === g).length]));
    const incidenceRows = [...incidence.values()].map((r) => ({ ...r, byGroup: Object.fromEntries(Object.entries(r.byGroup).map(([g, set]) => [g, set.size])) }))
      .sort((x, y) => x.organ.localeCompare(y.organ) || x.morphology.localeCompare(y.morphology));

    const requests = [...new Set(animals.map((a) => a.requestId))].map((id) => state.requests.find((r) => r.id === id)).map((r) => ({ id: r.id, number: r.number }));
    return {
      study: { ...s, piName: piName(s.pi), protocolName: protocol.name, trimProtocolName: protocol.trimName }, protocol, requests, groupKeys, examined,
      animals: nx.map(({ a, n }) => ({ id: a.id, phl: a.phl, label: a.label, groupCode: a.groupCode, sex: a.sex, priority: a.priority, area: a.area,
        requestId: a.requestId, necropsy: n?.status || null, necropsyDate: n?.date || null, bodyWeight: n?.bodyWeight ?? null })),
      absolute, relative, incidence: incidenceRows,
    };
  }

  function studyCsv({ params }) {
    const s = getStudy(params[0]);
    const protocol = studyProtocol(s);
    const weighed = protocol.organs.filter((o) => o.weigh).map((o) => o.organ);
    const esc = csvEsc;
    const header = ['PHL', 'Animal', 'Group', 'Sex', 'Necropsy status', 'Necropsy date', 'Body weight (g)', ...weighed.map((o) => `${o} (g)`), 'Gross findings'];
    const rows = state.subjects.filter((x) => x.studyId === s.id).sort((a, b) => a.phl.localeCompare(b.phl)).map((a) => {
      const n = state.necropsies[a.id];
      const findings = n ? n.organs.flatMap((o) => o.findings.map((f) => `${o.organ}: ${findingText(f)}`)).join('; ') : '';
      return [a.phl, a.label, a.groupCode, a.sex, n?.status || 'Not started', n?.date, n?.bodyWeight,
        ...weighed.map((o) => n?.organs.find((x) => x.organ === o && !x.notCollected)?.weight ?? ''), findings];
    });
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
    return { __file: { name: `${s.zap}-animal-data.csv`, type: 'text/csv; charset=utf-8', content: csv } };
  }

  // ---------- necropsy ----------
  function findingText(f) {
    const size = f.sizeMm ? `${f.sizeMm} mm` : '';
    const qty = f.qty && f.qty > 1 ? `${f.qty}` : '';
    const parts = [f.site, [qty, f.morphology].filter(Boolean).join(' '), f.shape, f.color, f.consistency, size].filter(Boolean);
    const fix = f.fixation?.length ? ` (${f.fixation.join(', ')})` : '';
    return parts.join(', ') + fix + (f.notes ? `. ${f.notes}` : '');
  }

  function blankNecropsy(subject) {
    const study = subject.studyId ? state.studies.find((s) => s.id === subject.studyId) : null;
    const protocol = studyProtocol(study, subject.sex || '');
    return {
      subjectId: subject.id, status: 'DRAFT', protocolId: protocol.necropsyId, necropsyProtocolId: protocol.necropsyId, trimProtocolId: protocol.trimId,
      date: clock.today(), prosector: by(), fate: lists().fates[0],
      condition: lists().conditions[0], physicalId: lists().physicalIds[0], matchesCageCard: false, bodyWeight: null, partial: false,
      organs: protocol.organs.map((o) => ({ organ: o.organ, weigh: o.weigh, weight: null, block: o.block === '' ? null : (/^\d+$/.test(o.block) ? Number(o.block) : o.block),
        notCollected: false, findings: [], fixative: o.fixative || '', freeze: o.freeze || '', measure: !!o.measure, instructions: o.description || '' })),
      observations: '', perfusion: protocol.perfusion || '',
      extras: Object.fromEntries(NECROPSY_EXTRAS.map((e) => [e.key, e.kind === 'count' ? 0 : false])),
      approvedBy: null, approvedAt: null, chargeIds: [], history: [],
    };
  }

  function necropsyWorklist() {
    const rows = [];
    for (const r of state.requests.filter((x) => x.status === 'Open' && x.areas.includes('NECRO'))) {
      const study = studyOf(r);
      const subjects = subjectsOf(r);
      const todo = subjects.filter((s) => state.necropsies[s.id]?.status !== 'APPROVED');
      if (!todo.length) continue;
      rows.push({
        requestId: r.id, number: r.number, pi: piName(r.pi), zap: study?.zap || null, studyId: study?.id || null, studyTitle: study?.title || '',
        subjects: todo.map((s) => ({ id: s.id, phl: s.phl, label: s.label, groupCode: s.groupCode, sex: s.sex, priority: s.priority, area: s.area, status: state.necropsies[s.id]?.status || null })),
        done: subjects.length - todo.length, total: subjects.length,
      });
    }
    return { requests: rows };
  }

  function getNecropsy({ params }) {
    const subject = getSubject(params[0]);
    const request = state.requests.find((r) => r.id === subject.requestId);
    const study = studyOf(request);
    const n = state.necropsies[subject.id] || blankNecropsy(subject);
    const siblings = subjectsOf(request);
    const i = siblings.findIndex((s) => s.id === subject.id);
    return {
      necropsy: n, subject, request: { id: request.id, number: request.number, piName: piName(request.pi), chargeType: request.chargeType, areas: request.areas },
      study: study ? { id: study.id, zap: study.zap, title: study.title, groups: study.groups } : null,
      protocol: necropsyProtocolOf(n, subject), prevId: siblings[i - 1]?.id || null, nextId: siblings[i + 1]?.id || null,
      charges: n.chargeIds.map((id) => state.charges.find((c) => c.id === id)).filter(Boolean).map(chargeView),
    };
  }

  function cleanNecropsy(subject, input, existing) {
    const base = existing || blankNecropsy(subject);
    const positive = (v, label) => {
      const x = num(v);
      if (x == null) return null;
      if (!Number.isFinite(x) || x < 0) fail(`${label} must be a positive number.`);
      return x;
    };
    const organs = Array.isArray(input.organs) ? input.organs : base.organs;
    return {
      ...base,
      date: isDate(input.date) ? input.date : base.date,
      prosector: text(input.prosector, 4).toUpperCase() || base.prosector,
      fate: lists().fates.includes(input.fate) ? input.fate : base.fate,
      condition: lists().conditions.includes(input.condition) ? input.condition : base.condition,
      physicalId: lists().physicalIds.includes(input.physicalId) ? input.physicalId : base.physicalId,
      matchesCageCard: input.matchesCageCard == null ? base.matchesCageCard : !!input.matchesCageCard,
      bodyWeight: input.bodyWeight === undefined ? base.bodyWeight : positive(input.bodyWeight, 'Body weight'),
      partial: input.partial == null ? base.partial : !!input.partial,
      perfusion: ['', 'whole', 'lung', 'liver'].includes(input.perfusion) ? input.perfusion : base.perfusion,
      observations: input.observations == null ? base.observations : text(input.observations, 2000),
      extras: Object.fromEntries(NECROPSY_EXTRAS.map((e) => {
        const v = input.extras?.[e.key] ?? base.extras[e.key];
        if (e.kind === 'count') { const c = Number(v) || 0; if (!Number.isInteger(c) || c < 0 || c > 200) fail(`${e.label} must be a whole number.`); return [e.key, c]; }
        return [e.key, !!v];
      })),
      organs: organs.map((o) => ({
        organ: text(o.organ, 60), weigh: !!o.weigh, weight: positive(o.weight, `${o.organ} weight`),
        block: o.block == null || o.block === '' ? null : /^\d+$/.test(String(o.block).trim()) ? Math.max(1, Math.min(999, parseInt(o.block, 10))) : text(o.block, 6).toUpperCase(),
        notCollected: !!o.notCollected, fixative: text(o.fixative, 60), freeze: text(o.freeze, 60), measure: !!o.measure, measurement: text(o.measurement, 60), instructions: text(o.instructions, 300),
        findings: (o.findings || []).map((f) => ({
          id: f.id || nextId(), site: text(f.site, 60), morphology: text(f.morphology, 60), shape: text(f.shape, 40), color: text(f.color, 40),
          consistency: text(f.consistency, 40), qty: f.qty === '' || f.qty == null ? null : Math.max(1, parseInt(f.qty, 10) || 1),
          sizeMm: positive(f.sizeMm, 'Finding size'), fixation: (f.fixation || []).filter((x) => lists().fixation.includes(x)), notes: text(f.notes, 300),
        })),
      })).filter((o) => o.organ),
    };
  }

  function saveNecropsy({ params, body }) {
    const subject = getSubject(params[0]);
    const existing = state.necropsies[subject.id];
    if (existing?.status === 'APPROVED') fail('This necropsy is approved. Unapprove it (with a reason) before editing.');
    const n = cleanNecropsy(subject, body || {}, existing);
    n.history = [...(existing?.history || []), { at: clock.now(), by: by(), action: 'Saved draft' }].slice(-50);
    state.necropsies[subject.id] = n;
    if (subject.area === 'ENTRY') move(subject, 'NECRO', 'Necropsy started');
    commit();
    return getNecropsy({ params });
  }

  function approveNecropsy({ params, body }) {
    const subject = getSubject(params[0]);
    const request = state.requests.find((r) => r.id === subject.requestId);
    const existing = state.necropsies[subject.id];
    if (existing?.status === 'APPROVED') fail('This necropsy is already approved.');
    const n = cleanNecropsy(subject, body || {}, existing);
    const protocol = necropsyProtocolOf(n, subject);
    const problems = NEC.approvalProblems(n, protocol);
    if (problems.length) fail(`Before approving: ${problems.join('; ')}.`);

    // Work events drive billing: the necropsy and each ticked procedure become pending charges.
    const charges = request.chargeType === 'C'
      ? NEC.approvalCharges(n).map((c) => newCharge(request, { section: c.section, code: c.code, date: n.date, units: c.units, subjectId: subject.id }, 'EVENT', { necropsySubjectId: subject.id }))
      : [];
    n.status = 'APPROVED'; n.approvedBy = by(); n.approvedAt = clock.now(); n.chargeIds = charges.map((c) => c.id);
    n.history = [...n.history, { at: clock.now(), by: by(), action: `Approved; ${charges.length} charges created` }];
    state.necropsies[subject.id] = n;
    if (subject.area === 'ENTRY') move(subject, 'NECRO', 'Necropsy');
    move(subject, nextAreaAfter(request, 'NECRO'), 'Necropsy approved');
    audit('NECROPSY_APPROVED', 'request', request.id, `${subject.phl}: ${charges.map((c) => c.code).join(', ') || 'no charges'}`);
    commit();
    return getNecropsy({ params });
  }

  function unapproveNecropsy({ params, body }) {
    const subject = getSubject(params[0]);
    const n = state.necropsies[subject.id];
    if (n?.status !== 'APPROVED') fail('This necropsy is not approved.');
    const reason = text(body.reason, 300);
    if (!reason) fail('Give a reason for unapproving the necropsy.');
    const linked = n.chargeIds.map((id) => state.charges.find((c) => c.id === id)).filter(Boolean);
    if (linked.some((c) => c.status === 'RELEASED')) fail('Its charges have already been released for billing. Correct them with adjustments in the request\'s charges, then unapprove.');
    if (state.pathology[subject.id]?.status === 'SIGNED') fail('The pathology report for this animal is signed out. Amend the pathology report first, then unapprove the necropsy.');
    for (const c of linked) if (c.status !== 'VOID') { c.status = 'VOID'; c.voidReason = `Necropsy unapproved: ${reason}`; }
    n.status = 'DRAFT'; n.approvedBy = null; n.approvedAt = null; n.chargeIds = [];
    n.history = [...n.history, { at: clock.now(), by: by(), action: `Unapproved: ${reason}` }];
    move(subject, 'NECRO', `Necropsy unapproved: ${reason}`);
    audit('NECROPSY_UNAPPROVED', 'request', subject.requestId, `${subject.phl}: ${reason}`);
    commit();
    return getNecropsy({ params });
  }

  // ---------- pathology ----------
  // One case per PHL number, like Zaphod's tblPathologyHeaders: tissues (from the approved necropsy, or added by the
  // pathologist for submitted material), diagnoses per tissue, gross-to-microscopic correlation, cause of death,
  // a comment, sign-out (which creates the pathology charges) and amendments that keep the earlier versions.
  const RESULT_KEYS = PATH.RESULTS.map(([k]) => k);
  const isPaired = (organ) => state.library.organs.some((o) => o.paired && o.name === organ) || PATH.PAIRED.has(organ);
  const needsNecropsy = (r) => r.areas.includes('NECRO');
  const necropsyDone = (subject) => state.necropsies[subject.id]?.status === 'APPROVED';
  const requestOf = (subject) => state.requests.find((r) => r.id === subject.requestId);

  function grossFindingsOf(subject) {
    const n = state.necropsies[subject.id];
    if (n?.status !== 'APPROVED') return [];
    return n.organs.flatMap((o) => o.findings.map((f) => ({ id: f.id, organ: o.organ, block: o.block, text: findingText(f) })));
  }

  function waitingReason(subject) {
    const r = requestOf(subject);
    if (!r.areas.includes('PATHO')) return 'This request does not include pathology. Add a pathology review to the request first.';
    if (needsNecropsy(r) && !necropsyDone(subject)) return 'The necropsy for this animal is not approved yet. Pathology starts from the approved necropsy.';
    return null;
  }

  function blankCase(subject) {
    const n = state.necropsies[subject.id];
    const fromNecropsy = n?.status === 'APPROVED';
    return {
      subjectId: subject.id, status: 'DRAFT', version: 1, pathologist: state.pathAssign[subject.id] || by(),
      tissues: fromNecropsy ? n.organs.map((o, i) => ({ id: `n${i + 1}`, organ: o.organ, block: o.block == null ? null : String(o.block), fromNecropsy: true,
        result: o.notCollected ? 'NOT_PRESENT' : 'PENDING', diagnoses: [], comment: '', recut: false, recutNote: '' })) : [],
      grossNoCorrelate: {}, causeOfDeath: { kind: fromNecropsy && n.fate === 'Scheduled euthanasia' ? 'NA' : '', dxId: null, comment: '' },
      comment: '', extraQuarterHours: 0, extraTimeNote: '', startedAt: null, updatedAt: null, signedBy: null, signedAt: null,
      chargeIds: [], history: [], versions: [], amendments: [],
    };
  }

  function cleanCase(subject, input, base) {
    const gross = new Set(grossFindingsOf(subject).map((g) => g.id));
    const pick = (v, list) => (list.includes(v) ? v : '');
    const tissues = (Array.isArray(input.tissues) ? input.tissues : base.tissues).slice(0, 120).map((t) => {
      const organ = text(t.organ, 60);
      const diagnoses = (Array.isArray(t.diagnoses) ? t.diagnoses : []).slice(0, 30).map((dx) => {
        const term = text(dx.term, 120);
        const known = PATH.findDiagnosis(term, state.library.diagnoses);
        const neoplasm = known ? known.neoplasm : !!dx.neoplasm;
        return {
          id: text(dx.id, 20) || `d${nextId()}`, term: known ? known.term : term, inDictionary: !!known, neoplasm, modifier: text(dx.modifier, 120),
          distribution: pick(dx.distribution, PATH.DISTRIBUTION), laterality: isPaired(organ) ? pick(dx.laterality, PATH.LATERALITY) : '',
          severity: neoplasm ? '' : pick(String(dx.severity ?? ''), PATH.SEVERITY.map(([k]) => k)),
          behavior: neoplasm ? pick(dx.behavior, PATH.BEHAVIOR) : '', origin: neoplasm ? (pick(dx.origin, PATH.ORIGIN) || 'Primary') : '',
          correlates: (Array.isArray(dx.correlates) ? dx.correlates : []).map(Number).filter((id) => gross.has(id)), comment: text(dx.comment, 300),
        };
      });
      let result = RESULT_KEYS.includes(t.result) ? t.result : 'PENDING';
      if (diagnoses.length) result = 'LESIONS';
      return { id: text(t.id, 20) || `t${nextId()}`, organ, block: t.block == null || t.block === '' ? null : text(t.block, 12), fromNecropsy: !!t.fromNecropsy,
        result, diagnoses, comment: text(t.comment, 500), recut: !!t.recut, recutNote: text(t.recutNote, 200) };
    }).filter((t) => t.organ);
    const dxIds = new Set(tissues.flatMap((t) => t.diagnoses.map((x) => x.id)));
    const cod = input.causeOfDeath || base.causeOfDeath || {};
    const qh = parseInt(input.extraQuarterHours ?? base.extraQuarterHours, 10) || 0;
    if (qh < 0 || qh > 40) fail('Additional pathologist time must be between 0 and 40 quarter hours.');
    const ini = text(input.pathologist ?? base.pathologist, 4).toUpperCase();
    return {
      ...base, tissues, pathologist: /^[A-Z]{2,4}$/.test(ini) ? ini : by(),
      grossNoCorrelate: Object.fromEntries(Object.entries(input.grossNoCorrelate || base.grossNoCorrelate || {}).filter(([id, v]) => v === true && gross.has(Number(id)))),
      causeOfDeath: { kind: ['', 'NA', 'UNDETERMINED', 'DIAGNOSIS'].includes(cod.kind) ? cod.kind : '', dxId: dxIds.has(cod.dxId) ? cod.dxId : null, comment: text(cod.comment, 300) },
      comment: input.comment === undefined ? base.comment : text(input.comment, 4000),
      extraQuarterHours: qh, extraTimeNote: text(input.extraTimeNote ?? base.extraTimeNote, 200),
    };
  }

  const needCauseOfDeath = (subject) => ['Found dead', 'Moribund euthanasia'].includes(state.necropsies[subject.id]?.fate) && necropsyDone(subject);
  const caseStatus = (subject) => {
    const c = state.pathology[subject.id];
    if (c) return c.status === 'SIGNED' ? 'SIGNED' : 'DRAFT';
    return waitingReason(subject) ? 'WAITING' : 'NOT_STARTED';
  };

  function pathologyWorklist({ query }) {
    const mine = query.mine === '1';
    const rows = [];
    for (const r of state.requests.filter((x) => x.status === 'Open' && x.areas.includes('PATHO'))) {
      const study = studyOf(r);
      const subjects = subjectsOf(r).map((s) => ({
        id: s.id, phl: s.phl, label: s.label, groupCode: s.groupCode, sex: s.sex, priority: s.priority, area: s.area, status: caseStatus(s),
        assigned: state.pathology[s.id]?.pathologist || state.pathAssign[s.id] || null, version: state.pathology[s.id]?.version || null,
        slidesReady: AREA_ORDER.indexOf(s.area) >= AREA_ORDER.indexOf('PATHO'),
      })).filter((s) => !mine || s.assigned === by());
      if (!subjects.length) continue;
      rows.push({
        requestId: r.id, number: r.number, type: REQUEST_TYPES[r.type].name, pi: piName(r.pi), due: r.due, zap: study?.zap || null, studyId: study?.id || null,
        studyTitle: study?.title || '', subjects, signed: subjects.filter((s) => s.status === 'SIGNED').length,
      });
    }
    // Requests with cases a pathologist can read come first; then STAT; then by due date.
    const actionable = (r) => Number(r.subjects.some((s) => s.status === 'NOT_STARTED' || s.status === 'DRAFT'));
    const stat = (r) => Number(r.subjects.some((s) => s.priority === 'S' && s.status !== 'SIGNED'));
    rows.sort((a, b) => actionable(b) - actionable(a) || stat(b) - stat(a) || (a.due || '').localeCompare(b.due || ''));
    const recuts = [];
    for (const [sid, c] of Object.entries(state.pathology)) for (const t of c.tissues) if (t.recut) {
      const s = state.subjects.find((x) => x.id === Number(sid));
      if (s) recuts.push({ subjectId: s.id, phl: s.phl, organ: t.organ, block: t.block, note: t.recutNote, requestNumber: requestOf(s).number, status: c.status });
    }
    return { requests: rows, recuts, me: by() };
  }

  function getCase({ params }) {
    const subject = getSubject(params[0]);
    const request = requestOf(subject);
    const study = studyOf(request);
    const existing = state.pathology[subject.id];
    const c = existing || blankCase(subject);
    const nec = state.necropsies[subject.id];
    const siblings = subjectsOf(request);
    const i = siblings.findIndex((s) => s.id === subject.id);
    const gross = grossFindingsOf(subject);
    return {
      case: c, saved: !!existing, subject, waiting: existing ? null : waitingReason(subject),
      request: { id: request.id, number: request.number, piName: piName(request.pi), type: REQUEST_TYPES[request.type].name, chargeType: request.chargeType, areas: request.areas },
      study: study ? { id: study.id, zap: study.zap, title: study.title, groups: study.groups } : null,
      necropsy: nec?.status === 'APPROVED' ? { date: nec.date, fate: nec.fate, condition: nec.condition, bodyWeight: nec.bodyWeight, prosector: nec.prosector, observations: nec.observations } : null,
      grossFindings: gross, needCauseOfDeath: needCauseOfDeath(subject),
      problems: PATH.signOutProblems(c, { grossFindings: gross, needCauseOfDeath: needCauseOfDeath(subject) }),
      slides: PATH.slidesRead(c), prevId: siblings[i - 1]?.id || null, nextId: siblings[i + 1]?.id || null,
      charges: c.chargeIds.map((id) => state.charges.find((x) => x.id === id)).filter(Boolean).map(chargeView),
    };
  }

  function saveCase({ params, body }) {
    const subject = getSubject(params[0]);
    const existing = state.pathology[subject.id];
    if (existing?.status === 'SIGNED') fail('This report is signed out. Amend it (with a reason) before editing.');
    if (!existing) { const why = waitingReason(subject); if (why) fail(why); }
    const c = cleanCase(subject, body || {}, existing || blankCase(subject));
    c.startedAt ||= clock.now(); c.updatedAt = clock.now();
    c.history = [...(c.history || []), { at: clock.now(), by: by(), action: 'Saved draft' }].slice(-60);
    state.pathology[subject.id] = c;
    commit();
    return getCase({ params });
  }

  function signOutCase({ params, body }) {
    const subject = getSubject(params[0]);
    const request = requestOf(subject);
    const existing = state.pathology[subject.id];
    if (existing?.status === 'SIGNED') fail('This report is already signed out.');
    if (!existing) { const why = waitingReason(subject); if (why) fail(why); }
    const c = cleanCase(subject, body || {}, existing || blankCase(subject));
    const problems = PATH.signOutProblems(c, { grossFindings: grossFindingsOf(subject), needCauseOfDeath: needCauseOfDeath(subject) });
    if (problems.length) fail(`Before signing out: ${problems.join('; ')}.`);

    // The work drives billing: one PA001002 per glass slide read, plus any extra pathologist time.
    // After an amendment, only slides or time beyond what was already billed are charged.
    const kept = c.chargeIds.map((id) => state.charges.find((x) => x.id === id)).filter((x) => x && x.status === 'RELEASED');
    const billed = (code) => kept.filter((x) => x.code === code).reduce((a, x) => a + x.units, 0)
      + state.charges.filter((x) => x.adjustsId && kept.some((k) => k.id === x.adjustsId) && x.code === code && x.status !== 'VOID').reduce((a, x) => a + x.units, 0);
    const slides = PATH.slidesRead(c);
    const created = request.chargeType === 'C'
      ? PATH.signOutCharges({ slides, extraQuarterHours: c.extraQuarterHours, extraTimeNote: c.extraTimeNote, billedSlides: billed('PA001002'), billedQuarterHours: billed('PA001004'), version: c.version })
        .map((x) => newCharge(request, { section: x.section, code: x.code, units: x.units, note: x.note, subjectId: subject.id }, 'EVENT', { pathologySubjectId: subject.id }))
      : [];
    const now = clock.now();
    c.status = 'SIGNED'; c.signedBy = by(); c.signedAt = now; c.updatedAt = now;
    c.chargeIds = [...kept.map((x) => x.id), ...created.map((x) => x.id)];
    c.versions = [...(c.versions || []), { version: c.version, signedBy: c.signedBy, signedAt: now, tissues: structuredClone(c.tissues), causeOfDeath: { ...c.causeOfDeath }, comment: c.comment }];
    c.history = [...(c.history || []), { at: now, by: by(), action: `Signed out${c.version > 1 ? ` (version ${c.version})` : ''}; ${slides} slide${slides === 1 ? '' : 's'}; ${created.length} charge${created.length === 1 ? '' : 's'} created` }];
    state.pathology[subject.id] = c;
    if (!TERMINAL_AREAS.includes(subject.area)) move(subject, nextAreaAfter(request, 'PATHO'), 'Pathology signed out');
    const dxCount = c.tissues.reduce((a, t) => a + t.diagnoses.length, 0);
    audit('PATHOLOGY_SIGNED', 'request', request.id, `${subject.phl}: v${c.version}, ${slides} slides, ${dxCount} diagnoses${created.length ? `, ${created.map((x) => `${x.code} x ${x.units}`).join(', ')}` : ''}`);
    commit();
    return getCase({ params });
  }

  function amendCase({ params, body }) {
    const subject = getSubject(params[0]);
    const c = state.pathology[subject.id];
    if (c?.status !== 'SIGNED') fail('Only a signed-out report can be amended.');
    const reason = text(body.reason, 300);
    if (!reason) fail('Give a reason for amending the report. It appears on the amended report.');
    for (const id of c.chargeIds) {
      const ch = state.charges.find((x) => x.id === id);
      if (ch && !['RELEASED', 'VOID'].includes(ch.status)) { ch.status = 'VOID'; ch.voidReason = `Pathology report amended: ${reason}`; }
    }
    c.status = 'DRAFT'; c.version += 1; c.signedBy = null; c.signedAt = null;
    c.amendments = [...(c.amendments || []), { version: c.version, at: clock.now(), by: by(), reason }];
    c.history = [...c.history, { at: clock.now(), by: by(), action: `Reopened for amendment (version ${c.version}): ${reason}` }];
    move(subject, 'PATHO', `Pathology report being amended: ${reason}`);
    audit('PATHOLOGY_AMENDED', 'request', subject.requestId, `${subject.phl}: version ${c.version}. ${reason}`);
    commit();
    return getCase({ params });
  }

  function assignPathologist({ body }) {
    const ini = text(body.pathologist, 4).toUpperCase();
    if (ini && !/^[A-Z]{2,4}$/.test(ini)) fail('Pathologist initials are two to four letters.');
    const subjects = (body.subjectIds || []).map(Number).map((id) => state.subjects.find((s) => s.id === id)).filter(Boolean);
    if (!subjects.length) fail('Choose at least one case.');
    for (const s of subjects) {
      if (ini) state.pathAssign[s.id] = ini; else delete state.pathAssign[s.id];
      const c = state.pathology[s.id];
      if (c && c.status === 'DRAFT' && ini) c.pathologist = ini;
    }
    for (const rid of new Set(subjects.map((s) => s.requestId))) audit('PATHOLOGIST_ASSIGNED', 'request', rid, `${subjects.filter((s) => s.requestId === rid).length} cases to ${ini || 'nobody'}`);
    commit();
    return { assigned: subjects.length };
  }

  function addPathologyArea({ params }) {
    const r = getRequest(params[0]);
    if (r.areas.includes('PATHO')) fail(`Request ${r.number} already includes pathology.`);
    if (r.status !== 'Open') fail('Only open requests can have pathology added.');
    r.areas = AREA_ORDER.filter((a) => a === 'PATHO' || r.areas.includes(a));
    audit('PATHOLOGY_ADDED', 'request', r.id, 'Pathology review added to the request');
    commit();
    return { ok: true };
  }

  // A request's necropsies, for its Necropsy tab.
  function requestNecropsy({ params }) {
    const r = getRequest(params[0]);
    const study = studyOf(r);
    const animals = subjectsOf(r).map((s) => {
      const n = state.necropsies[s.id];
      const organs = n ? n.organs : [];
      return { id: s.id, phl: s.phl, label: s.label, groupCode: s.groupCode, sex: s.sex, priority: s.priority, status: n?.status || null, date: n?.date || null,
        prosector: n?.prosector || '', fate: n?.fate || '', bodyWeight: n?.bodyWeight ?? null, organsTotal: organs.length, organsCollected: organs.filter((o) => !o.notCollected).length,
        findings: organs.reduce((k, o) => k + o.findings.length, 0) };
    });
    return { animals, approved: animals.filter((a) => a.status === 'APPROVED').length, drafts: animals.filter((a) => a.status === 'DRAFT').length,
      groups: animals.some((a) => a.groupCode), protocol: study ? studyProtocol(study).name : '' };
  }

  // Everything a printed necropsy or pathology report for one animal needs.
  function animalReport({ params }) {
    const subject = getSubject(params[0]);
    const request = requestOf(subject);
    const study = studyOf(request);
    const group = study?.groups.find((g) => g.code === subject.groupCode) || null;
    const n = state.necropsies[subject.id];
    const c = state.pathology[subject.id] || null;
    const necropsy = n ? {
      status: n.status, date: n.date, prosector: n.prosector, fate: n.fate, condition: n.condition, physicalId: n.physicalId, matchesCageCard: n.matchesCageCard,
      bodyWeight: n.bodyWeight, partial: n.partial, perfusion: n.perfusion, observations: n.observations, approvedBy: n.approvedBy, approvedAt: n.approvedAt,
      protocol: necropsyProtocolOf(n, subject).name,
      organs: n.organs.map((o) => ({ organ: o.organ, block: o.block, notCollected: o.notCollected, weight: o.weigh ? o.weight : null,
        relative: o.weigh && o.weight > 0 && n.bodyWeight > 0 ? Math.round((o.weight / n.bodyWeight) * 100000) / 1000 : null,
        findings: o.findings.map((f) => ({ id: f.id, text: findingText(f) })) })),
    } : null;
    let pathology = null;
    if (c) {
      const gross = grossFindingsOf(subject);
      const dxById = new Map(c.tissues.flatMap((t) => t.diagnoses.map((x) => [x.id, { ...x, organ: t.organ }])));
      const cod = c.causeOfDeath || {};
      pathology = {
        status: c.status, version: c.version, pathologist: c.pathologist, signedBy: c.signedBy, signedAt: c.signedAt, amendments: c.amendments || [],
        previous: (c.versions || []).filter((v) => v.version < c.version || c.status !== 'SIGNED').map((v) => ({ version: v.version, signedBy: v.signedBy, signedAt: v.signedAt })),
        tissues: c.tissues.map((t) => ({ organ: t.organ, block: t.block, result: t.result, comment: t.comment, diagnoses: t.diagnoses.map((x) => ({ text: PATH.dxText(x), neoplasm: x.neoplasm, comment: x.comment })) })),
        correlation: gross.map((g) => {
          const dx = c.tissues.flatMap((t) => t.diagnoses.map((x) => ({ ...x, organ: t.organ }))).filter((x) => (x.correlates || []).includes(g.id));
          return { organ: g.organ, gross: g.text, micro: dx.length ? dx.map((x) => `${x.organ}: ${PATH.dxText(x)}`).join('; ') : c.grossNoCorrelate?.[g.id] ? 'No microscopic correlate' : 'Not yet correlated' };
        }),
        causeOfDeath: cod.kind === 'NA' ? 'Not applicable (scheduled euthanasia)' : cod.kind === 'UNDETERMINED' ? 'Undetermined' : cod.kind === 'DIAGNOSIS' && dxById.get(cod.dxId) ? `${dxById.get(cod.dxId).organ}: ${PATH.dxText(dxById.get(cod.dxId))}` : '',
        causeOfDeathComment: cod.comment, comment: c.comment, slides: PATH.slidesRead(c),
      };
    }
    return {
      subject: { id: subject.id, phl: subject.phl, label: subject.label, sex: subject.sex, species: SPECIES[subject.species]?.name || subject.species, groupCode: subject.groupCode, restricted: subject.restricted, dob: subject.dob || null,
        strain: subject.strain || '', genotype: subject.genotype || '', age: subject.age || '', cage: subject.cage || '', notes: subject.notes || '' },
      request: { id: request.id, number: request.number, piName: piName(request.pi), inst: request.pi.inst, type: REQUEST_TYPES[request.type].name, received: request.received },
      study: study ? { id: study.id, zap: study.zap, title: study.title, acuc: study.acuc } : null, group, necropsy, pathology, printedAt: clock.now(), printedBy: by(),
    };
  }

  function pathologySummaryFor(subjects, groupKeys, keyOf) {
    const signed = subjects.filter((s) => state.pathology[s.id]?.status === 'SIGNED').map((s) => ({ subject: s, groupKey: keyOf(s), c: state.pathology[s.id] }));
    const usedKeys = groupKeys.filter((g) => subjects.some((s) => keyOf(s) === g));
    return {
      groupKeys: usedKeys, ...PATH.summarizePathology(signed, usedKeys),
      cases: subjects.map((s) => ({ id: s.id, phl: s.phl, label: s.label, group: keyOf(s), sex: s.sex, status: caseStatus(s), version: state.pathology[s.id]?.version || null,
        signedAt: state.pathology[s.id]?.signedAt || null, pathologist: state.pathology[s.id]?.pathologist || state.pathAssign[s.id] || null })),
    };
  }

  function studyPathology({ params }) {
    const s = getStudy(params[0]);
    const animals = state.subjects.filter((x) => x.studyId === s.id).sort((a, b) => a.phl.localeCompare(b.phl));
    const keys = [...s.groups.map((g) => g.code), '(none)'];
    return { groups: s.groups, ...pathologySummaryFor(animals, keys, (a) => a.groupCode || '(none)') };
  }

  function requestPathology({ params }) {
    const r = getRequest(params[0]);
    const subjects = subjectsOf(r);
    const study = studyOf(r);
    const keys = study ? [...study.groups.map((g) => g.code), '(none)'] : ['All'];
    return { groups: study?.groups || [], ...pathologySummaryFor(subjects, keys, (a) => (study ? a.groupCode || '(none)' : 'All')) };
  }

  function pathologyCsv(subjects, name) {
    const esc = csvEsc;
    const header = ['PHL', 'Animal', 'Group', 'Sex', 'Report status', 'Version', 'Signed by', 'Signed', 'Tissue', 'Block', 'Result', 'Diagnosis', 'In dictionary', 'Modifier',
      'Distribution', 'Laterality', 'Severity', 'Neoplasm', 'Behavior', 'Origin', 'Gross findings correlated'];
    const label = Object.fromEntries(PATH.RESULTS);
    const rows = [];
    for (const s of subjects) {
      const c = state.pathology[s.id];
      if (!c) continue;
      const gross = new Map(grossFindingsOf(s).map((g) => [g.id, `${g.organ}: ${g.text}`]));
      const base = [s.phl, s.label, s.groupCode, s.sex, c.status === 'SIGNED' ? 'Signed out' : 'Draft', c.version, c.signedBy, c.signedAt];
      for (const t of c.tissues) {
        if (!t.diagnoses.length) rows.push([...base, t.organ, t.block, label[t.result], '', '', '', '', '', '', '', '', '', '', '']);
        for (const x of t.diagnoses) rows.push([...base, t.organ, t.block, label[t.result], x.term, x.inDictionary ? 'yes' : 'no', x.modifier, x.distribution, x.laterality,
          x.severity, x.neoplasm ? 'yes' : 'no', x.behavior, x.origin, (x.correlates || []).map((id) => gross.get(id)).filter(Boolean).join('; ')]);
      }
    }
    const csv = [header, ...rows].map((r) => r.map(esc).join(',')).join('\r\n') + '\r\n';
    return { __file: { name, type: 'text/csv; charset=utf-8', content: csv } };
  }

  // ---------- IHC assay catalog ----------
  const KIND_GROUPS = {
    ihc: (a) => a.kind === 'IHC' && a.plex === 1, multiplex: (a) => a.plex > 1, fluorescent: (a) => IHC.isFluorescent(a),
    other: (a) => a.kind === 'TUNEL' || a.kind === 'β-gal',
  };
  const reviewFlags = (a) => a.flags.filter((f) => f !== 'duplicate');
  function assaySummary(a, fit = null) {
    return {
      id: a.id, name: a.name, kind: a.kind, plex: a.plex, kindLabel: IHC.kindLabel(a), dilution: a.dilution, retrieval: a.retrieval, kit: a.kit,
      fixative: a.fixative, species: a.species, speciesTags: a.speciesTags, fixTags: a.fixTags, control: a.control, manufacturer: a.manufacturer,
      catalog: a.catalog, status: a.status, flags: a.flags, list: a.list, isDouble: !!a.components, chromogen: a.chromogen, platform: a.platform,
      antibody: IHC.antibodyInfo(a), ...(fit ? { fit: IHC.assayFit(a, fit) } : {}),
    };
  }

  function listAssays({ query }) {
    const words = text(query.q, 80).toLowerCase().split(/\s+/).filter(Boolean);
    const status = text(query.status, 20) || 'Active';
    const group = KIND_GROUPS[query.kind];
    const fit = query.fitSpecies ? { species: text(query.fitSpecies, 20), fixative: text(query.fitFixative, 40), sampleTypes: text(query.fitTypes, 60).split(',').filter(Boolean) } : null;
    let rows = state.assays.filter((a) => (status === 'all' || a.status === status)
      && (!group || group(a))
      && (!query.species || a.speciesTags.includes(query.species))
      && (!query.fix || a.fixTags.includes(query.fix))
      && (query.issues !== '1' || reviewFlags(a).length)
      && words.every((w) => (/^#\d+$/.test(w) ? a.id === Number(w.slice(1)) : `${a.name} ${a.catalog} ${a.manufacturer} ${a.kit} ${a.clone || ''} ${a.host || ''}`.toLowerCase().includes(w))));
    const q = words.join(' ');
    const qre = new RegExp(`^${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^0-9]|$)`);
    const rank = (a) => {
      const n = a.name.toLowerCase();
      // "cd8" ranks CD8 and CD8a above CD86.
      const r = !q ? 0 : n === q ? 0 : qre.test(n) ? 1 : n.startsWith(q) ? 2 : n.includes(q) ? 3 : 4;
      return fit ? r + (IHC.assayFit(a, fit).length ? 10 : 0) : r;
    };
    rows = rows.map((a) => [rank(a), a]).sort((x, y) => x[0] - y[0] || x[1].name.localeCompare(y[1].name, 'en', { sensitivity: 'base' }) || x[1].id - y[1].id).map(([, a]) => a);
    const limit = query.limit === 'all' ? rows.length : Math.max(1, Math.min(1000, Number(query.limit) || 100));
    return { total: rows.length, assays: rows.slice(0, limit).map((a) => assaySummary(a, fit)) };
  }

  function assayDetail({ params }) {
    const a = getAssay(params[0]);
    const usedIn = state.ihcRequests.filter((w) => w.stains.some((s) => s.assayId === a.id))
      .map((w) => ({ id: w.id, number: w.number, status: w.status, submittedOn: w.submittedOn, investigator: piName(w.requester) }));
    return {
      assay: { ...a, kindLabel: IHC.kindLabel(a), antibody: IHC.antibodyInfo(a) },
      components: (a.components || []).map(assayById).filter(Boolean).map((x) => assaySummary(x)),
      partOf: (a.partOf || []).map(assayById).filter(Boolean).map((x) => assaySummary(x)),
      duplicateOf: a.duplicateOf ? assaySummary(assayById(a.duplicateOf)) : null,
      sameName: state.assays.filter((x) => x.id !== a.id && x.name.toLowerCase() === a.name.toLowerCase()).map((x) => assaySummary(x)),
      usedIn, history: state.audit.filter((x) => x.entity === 'assay' && x.entityId === a.id).slice(-30).reverse(),
    };
  }

  function readAssayFields(body, base = {}) {
    const out = {};
    for (const [k] of IHC.ASSAY_FIELDS) out[k] = body[k] === undefined ? (base[k] ?? '') : text(body[k], k === 'kit' || k === 'control' ? 600 : 200);
    if (!out.name) fail('An assay needs an antibody name.');
    return out;
  }

  function addAssay({ body }) {
    const fields = readAssayFields(body);
    const a = {
      ...loadAssays({ assays: [{}] })[0], id: Math.max(0, ...state.assays.map((x) => x.id)) + 1, ...fields, ...IHC.deriveAssay(fields),
      notes: text(body.notes, 1000), updatedAt: clock.now(),
    };
    delete a.speciesOther;
    state.assays.push(a);
    audit('ASSAY_ADDED', 'assay', a.id, a.name);
    commit();
    return { id: a.id };
  }

  function editAssay({ params, body }) {
    const a = getAssay(params[0]);
    const fields = readAssayFields(body, a);
    const changed = IHC.ASSAY_FIELDS.filter(([k]) => fields[k] !== a[k]).map(([k, label]) => `${label}: ${a[k] || '(blank)'} → ${fields[k] || '(blank)'}`);
    const notes = body.notes === undefined ? a.notes : text(body.notes, 1000);
    if (!changed.length && notes === a.notes) return { id: a.id, changed: 0 };
    const derived = IHC.deriveAssay(fields);
    delete derived.speciesOther;
    Object.assign(a, fields, a.components ? { speciesTags: derived.speciesTags, fixTags: derived.fixTags } : derived, { notes, updatedAt: clock.now() });
    // Editing a repaired field counts as checking it.
    if (fields.dilution !== undefined && changed.some((c) => c.startsWith('Dilution'))) a.flags = a.flags.filter((f) => f !== 'dilution-recovered');
    if (changed.some((c) => c.startsWith('Antibody'))) a.flags = a.flags.filter((f) => f !== 'name-recovered');
    if (a.species) a.flags = a.flags.filter((f) => f !== 'species-blank');
    if (a.retrieval) a.flags = a.flags.filter((f) => f !== 'retrieval-blank');
    audit('ASSAY_EDITED', 'assay', a.id, changed.join('; ') || 'Notes');
    commit();
    return { id: a.id, changed: changed.length };
  }

  function confirmAssay({ params }) {
    const a = getAssay(params[0]);
    const cleared = reviewFlags(a);
    if (!cleared.length) fail('Nothing on this assay is waiting to be checked.');
    a.flags = a.flags.filter((f) => f === 'duplicate');
    a.updatedAt = clock.now();
    audit('ASSAY_CHECKED', 'assay', a.id, `Checked: ${cleared.join(', ')}`);
    commit();
    return { ok: true };
  }

  function setAssayStatus(status) {
    return ({ params, body }) => {
      const a = getAssay(params[0]);
      if (a.status === status) fail(`This assay is already ${status.toLowerCase()}.`);
      const reason = text(body.reason, 300);
      if (status === 'Retired' && !reason) fail('Give a reason for retiring the assay (for example, replaced by a new clone).');
      const was = a.status;
      a.status = status; a.updatedAt = clock.now();
      if (status === 'Active') a.flags = a.flags.filter((f) => f !== 'duplicate');
      audit(status === 'Retired' ? 'ASSAY_RETIRED' : 'ASSAY_RESTORED', 'assay', a.id, `${was} → ${status}${reason ? `: ${reason}` : ''}`);
      commit();
      return { ok: true };
    };
  }

  // ---------- IHC requests from the web form ----------
  // The investigator form (the old phlrequest.ncifcrf.gov MH request) submits here; the IHC team reviews and
  // accepts it, which creates a LIMS request with PHL numbers and an estimate.
  const speciesCode = (s) => IHC.REQUEST_SPECIES.find(([k]) => k === s)?.[2] || 'OTHER';
  const stainLookup = (w) => (id) => w?.stains?.find((s) => s.assayId === Number(id))?.snapshot || assayById(id);

  function readDraft(body, strict) {
    const b = body || {};
    const rq = b.requester || {};
    const problems = [];
    const need = (cond, msg) => { if (!cond) problems.push(msg); };
    const draft = {
      requester: { last: text(rq.last, 100), first: text(rq.first, 100), inst: text(rq.inst, 200), building: text(rq.building, 40), phone: text(rq.phone, 30), email: text(rq.email, 120) },
      billTo: text(b.billTo, 100), projectId: text(b.projectId, 40), acuc: text(b.acuc, 50),
      pathologist: PATHOLOGISTS.includes(b.pathologist) ? b.pathologist : PATHOLOGISTS[0],
      importance: b.importance === 'STAT' ? 'STAT' : 'Routine',
      species: IHC.REQUEST_SPECIES.some(([k]) => k === b.species) ? b.species : '',
      fixativeUsed: IHC.REQUEST_FIXATIVES.some(([l]) => l === b.fixativeUsed) ? b.fixativeUsed : '',
      fixativeSubmitted: IHC.REQUEST_FIXATIVES.some(([l]) => l === b.fixativeSubmitted) ? b.fixativeSubmitted : '',
      fixDate: isDate(b.fixDate) ? b.fixDate : '',
      samples: (Array.isArray(b.samples) ? b.samples : []).slice(0, 200).map((s) => ({
        tissue: text(s.tissue, 60), blockNo: text(s.blockNo, 30), type: IHC.SAMPLE_TYPES.some(([k]) => k === s.type) ? s.type : 'FIXED',
      })).filter((s) => s.tissue || s.blockNo),
      he: { on: !!b.he?.on, perBlock: Math.max(1, Math.min(10, parseInt(b.he?.perBlock, 10) || 1)) },
      unstained: { on: !!b.unstained?.on, perBlock: Math.max(1, Math.min(20, parseInt(b.unstained?.perBlock, 10) || 1)) },
      stains: [], scan: { x20: !!b.scan?.x20, x40: !!b.scan?.x40 }, additional: text(b.additional, 2000),
    };
    if (!draft.fixativeSubmitted) draft.fixativeSubmitted = draft.fixativeUsed;
    for (const s of (Array.isArray(b.stains) ? b.stains : []).slice(0, 20)) {
      if (s.assayId) {
        const a = assayById(s.assayId);
        if (!a) { problems.push(`Assay #${s.assayId} is not in the catalog.`); continue; }
        if (a.status !== 'Active') problems.push(`${a.name} (#${a.id}) is ${a.status.toLowerCase()} and can no longer be requested.`);
        const chromogen = IHC.isFluorescent(a) ? a.chromogen : ['DAB', 'Red'].includes(s.chromogen) ? s.chromogen : (a.chromogen === 'Red' ? 'Red' : 'DAB');
        draft.stains.push({ assayId: a.id, chromogen, newAntibody: null });
      } else if (s.newAntibody) {
        const na = s.newAntibody;
        const item = { name: text(na.name, 120), manufacturer: text(na.manufacturer, 120), catalog: text(na.catalog, 60), host: text(na.host, 60), supplied: !!na.supplied, notes: text(na.notes, 500) };
        if (!item.name) { problems.push('Give the name of the new antibody.'); continue; }
        draft.stains.push({ assayId: null, chromogen: ['DAB', 'Red'].includes(s.chromogen) ? s.chromogen : 'DAB', newAntibody: item });
      }
    }
    if (strict) {
      need(draft.requester.last, 'Enter the investigator\'s last name.');
      need(draft.billTo, 'Enter who to bill (the PI).');
      need(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(draft.requester.email), 'Enter an email address so the IHC team can reach you.');
      need(draft.projectId, 'Enter the project ID to bill.');
      need(draft.species, 'Choose the species.');
      need(draft.fixativeUsed, 'Choose the fixative used.');
      need(draft.samples.length, 'List at least one organ, tissue or block.');
      need(draft.samples.every((s) => s.tissue), 'Each sample needs the organ or tissue.');
      need(draft.he.on || draft.unstained.on || draft.stains.length, 'Choose at least one thing to do: H&E, unstained slides or a stain.');
      need(!draft.fixDate || draft.fixDate <= clock.today(), 'The date into fixative cannot be in the future.');
      if (draft.stains.some((s) => s.newAntibody && !s.newAntibody.manufacturer)) problems.push('Give the manufacturer of the new antibody.');
    }
    if (strict && problems.length) fail(problems.join(' '));
    return { draft, problems };
  }

  function priceEstimate(draft, lookup, opts = {}) {
    const est = IHC.estimateIhc(draft, lookup, opts);
    const cat = catalog(); const problems = [];
    const lines = est.lines.map((l) => {
      try { const e = R.estimateLine(cat, { ...l, date: clock.today() }); return { section: l.section, code: e.code, description: e.description, units: e.units, unitPrice: e.unitPrice, amount: e.amount }; }
      catch (e) { problems.push(`${l.code}: ${e.message}`); return { ...l, description: codeInfo(l.code)?.description || '', unitPrice: null, amount: null }; }
    });
    return { lines, total: R.sumMoney(lines.filter((l) => l.amount != null).map((l) => l.amount)), assumptions: est.assumptions, problems, areas: IHC.ihcAreas(draft) };
  }

  function estimateDraft({ body }) {
    const { draft, problems } = readDraft(body, false);
    return { estimate: priceEstimate(draft, assayById), warnings: IHC.requestWarnings(draft, assayById, clock.today()), problems, summary: IHC.summarize(draft, assayById) };
  }

  function submitIhc({ body }) {
    const { draft } = readDraft(body, true);
    const yy = clock.today().slice(2, 4);
    const w = {
      id: nextId(), number: `MH${yy}-${String(allocate('MH', yy, 1)).padStart(4, '0')}`, status: 'Submitted', submittedOn: clock.today(), submittedAt: clock.now(),
      ...draft,
      stains: draft.stains.map((s) => {
        const a = s.assayId ? assayById(s.assayId) : null;
        const snapshot = a ? { id: a.id, ...Object.fromEntries(IHC.ASSAY_FIELDS.map(([k]) => [k, a[k]])), kind: a.kind, plex: a.plex, chromogen: a.chromogen, speciesTags: a.speciesTags, fixTags: a.fixTags, status: a.status } : null;
        return { ...s, snapshot };
      }),
      copiedFrom: body.copiedFrom ? Number(body.copiedFrom) || null : null,
      requestId: null, acceptedBy: null, acceptedAt: null, declinedBy: null, declinedAt: null, declineReason: '',
    };
    state.ihcRequests.push(w);
    audit('IHC_SUBMITTED', 'ihc', w.id, `${w.number}: ${IHC.summarize(w, stainLookup(w))}`, 'WEB');
    commit();
    return { id: w.id, number: w.number };
  }

  function webSummary(w) {
    const est = priceEstimate(w, stainLookup(w), { addOn: !!w.addOn });
    const req = w.requestId ? state.requests.find((r) => r.id === w.requestId) : null;
    return {
      id: w.id, number: w.number, status: w.status, submittedOn: w.submittedOn, investigator: piName(w.requester), species: w.species, importance: w.importance,
      samples: w.samples.length, stains: w.stains.map((s) => s.snapshot?.name || s.newAntibody?.name), newAntibodies: w.stains.filter((s) => s.newAntibody).length,
      estimate: est.total, warnings: IHC.requestWarnings(w, assayById, w.submittedOn).length, requestId: req?.id || null, requestNumber: req?.number || null,
      source: w.source || 'WEB', assignedTo: w.assignedTo || null, workStatus: w.status === 'Accepted' ? w.workStatus || 'Not started' : null, doneOn: w.doneOn || null,
      due: req?.due || null, requestStatus: req?.status || null, acceptedAt: w.acceptedAt || null,
    };
  }

  function listIhc({ query }) {
    const status = text(query.status, 20);
    const rows = state.ihcRequests.filter((w) => !status || w.status === status).map(webSummary);
    rows.sort((a, b) => (a.status === 'Submitted' ? 0 : 1) - (b.status === 'Submitted' ? 0 : 1) || b.submittedOn.localeCompare(a.submittedOn) || b.number.localeCompare(a.number));
    return { requests: rows };
  }

  // A block number the investigator gave that is already a PHL number in the LIMS (PHL# with or without its letter).
  function blockMatch(blockNo, excludeRequestId = null) {
    const b = String(blockNo || '').toUpperCase().replace(/\s+/g, '');
    if (b.length < 6) return null;
    return state.subjects.find((x) => x.requestId !== excludeRequestId && (x.phl === b || x.phl.slice(0, 8) === b)) || null;
  }

  function ihcDetail({ params }) {
    const w = getWeb(params[0]);
    const lookup = stainLookup(w);
    const req = w.requestId ? state.requests.find((r) => r.id === w.requestId) : null;
    const matches = w.samples.map((s, i) => {
      const subj = blockMatch(s.blockNo, w.requestId);
      if (!subj) return null;
      const r = state.requests.find((x) => x.id === subj.requestId);
      return { sample: i, phl: subj.phl, requestId: r.id, requestNumber: r.number, label: subj.label, studyZap: studyOf(r)?.zap || null };
    }).filter(Boolean);
    return {
      request: w,
      stains: w.stains.map((s) => {
        const a = s.assayId ? assayById(s.assayId) : null;
        return { ...s, current: a ? assaySummary(a) : null, changedSince: a ? (a.updatedAt || '') > w.submittedAt : false };
      }),
      estimate: priceEstimate(w, lookup, { addOn: !!w.addOn }), warnings: IHC.requestWarnings(w, assayById, w.submittedOn), summary: IHC.summarize(w, lookup), matches,
      linked: req ? { id: req.id, number: req.number, status: req.status } : null,
      openNas: state.nas.filter((n) => !n.closed).map((n) => ({ id: n.id, number: n.number, requester: n.requester, authorized: n.authorized, project: n.project, requests: requestsOfNas(n).length,
        suggested: n.requester.last.toLowerCase() === w.requester.last.toLowerCase() })),
      history: state.audit.filter((x) => x.entity === 'ihc' && x.entityId === w.id).reverse(),
    };
  }

  function acceptIhc({ params, body }) {
    const w = getWeb(params[0]);
    if (w.status !== 'Submitted') fail(`${w.number} is ${w.status.toLowerCase()}; only submitted requests can be accepted.`);
    let nas = null;
    if (body.nasId) {
      nas = state.nas.find((n) => n.id === Number(body.nasId));
      if (!nas) fail('That NAS request was not found.');
      mustBeOpenNas(nas);
    }
    const lookup = stainLookup(w);
    const est = IHC.estimateIhc(w, lookup);
    const lines = Array.isArray(body.lines) && body.lines.length ? body.lines : est.lines;
    const { request, phls } = insertRequest({
      nas, pi: { last: w.requester.last, first: w.requester.first, inst: w.requester.inst }, project: w.projectId || nas?.project || '',
      description: IHC.summarize(w, lookup), type: 'MOLEC', n: w.samples.length, species: speciesCode(w.species),
      priority: w.importance === 'STAT' ? 'S' : 'R', areas: IHC.ihcAreas(w), lines, fixative: w.fixativeSubmitted,
      labels: w.samples.map((s) => [s.tissue, s.blockNo].filter(Boolean).join(', ').slice(0, 40)),
      sources: w.samples.map((s) => blockMatch(s.blockNo)?.id ?? null), webRequestId: w.id,
    });
    w.status = 'Accepted'; w.requestId = request.id; w.acceptedBy = by(); w.acceptedAt = clock.now();
    audit('IHC_ACCEPTED', 'ihc', w.id, `Accepted as ${request.number}${nas ? ` with NAS# ${nas.number}` : ', NAS request to be linked'}`);
    audit('REQUEST_CREATED', 'request', request.id, `${request.number} from IHC request ${w.number}${nas ? ` and NAS# ${nas.number}` : ''}, ${phls.length} PHL numbers`);
    commit();
    return { id: request.id, number: request.number, phls };
  }

  function declineIhc({ params, body }) {
    const w = getWeb(params[0]);
    if (w.status !== 'Submitted') fail(`${w.number} is ${w.status.toLowerCase()}; only submitted requests can be declined.`);
    const reason = text(body.reason, 500);
    if (!reason) fail('Give the investigator a reason.');
    w.status = 'Declined'; w.declinedBy = by(); w.declinedAt = clock.now(); w.declineReason = reason;
    audit('IHC_DECLINED', 'ihc', w.id, reason);
    commit();
    return { ok: true };
  }

  // Bench worksheet for an accepted IHC request: every block with every stain and its protocol as requested.
  function ihcWorksheet({ params }) {
    const r = getRequest(params[0]);
    if (!r.webRequestId) fail(`Request ${r.number} did not come from the IHC request form.`);
    const w = getWeb(r.webRequestId);
    const subjects = subjectsOf(r);
    const blocks = w.samples.map((s, i) => {
      const subj = subjects.find((x) => x.sampleIndex === i) || subjects[i];
      const src = subj?.sourceSubjectId ? state.subjects.find((x) => x.id === subj.sourceSubjectId) : null;
      const srcReq = src ? state.requests.find((x) => x.id === src.requestId) : null;
      return { ...s, phl: subj?.phl || '', source: src ? { phl: src.phl, requestId: srcReq.id, requestNumber: srcReq.number } : null };
    });
    const stains = w.stains.map((s) => ({
      ...s, protocol: s.snapshot, changedSince: s.assayId ? (assayById(s.assayId)?.updatedAt || '') > w.submittedAt : false,
      kindLabel: s.snapshot ? IHC.kindLabel(s.snapshot) : 'New antibody',
    }));
    return { request: { id: r.id, number: r.number, piName: piName(r.pi), due: r.due }, web: { id: w.id, number: w.number, pathologist: w.pathologist, submittedOn: w.submittedOn, he: w.he, unstained: w.unstained, scan: w.scan, additional: w.additional, species: w.species, fixativeUsed: w.fixativeUsed, fixDate: w.fixDate }, blocks, stains };
  }

  // ---------- terminology library (INHAND / SEND) ----------
  const libDx = (term) => state.library.diagnoses.find((d) => d.term.toLowerCase() === String(term || '').toLowerCase()) || null;
  const libOrgan = (name) => state.library.organs.find((o) => o.name.toLowerCase() === String(name || '').toLowerCase()) || null;
  const systemKey = (k) => (TERM.INHAND_SYSTEMS.some((x) => x.key === k) ? k : 'general');
  // Text from spreadsheets reaches these files; a cell that starts like a formula gets a leading apostrophe so Excel shows it.
  const csvSafe = (t) => (/^[=+@\t\r]/.test(t) || (/^-/.test(t) && !/^-\d+(\.\d+)?$/.test(t)) ? `'${t}` : t);
  const csvEsc = (v) => { const t = csvSafe(v == null ? '' : String(v)); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
  const csvFile = (name, rows) => ({ __file: { name, type: 'text/csv; charset=utf-8', content: rows.map((r) => r.map(csvEsc).join(',')).join('\r\n') + '\r\n' } });

  function sendCtSummary() {
    if (!state.sendCt) return null;
    return { fileName: state.sendCt.fileName, importedAt: state.sendCt.importedAt, importedBy: state.sendCt.importedBy,
      lists: Object.fromEntries(Object.entries(state.sendCt.codelists).map(([k, l]) => [k, { name: l.name, code: l.code, terms: l.terms.length }])) };
  }

  function getLibrary() {
    const used = new Map();
    for (const c of Object.values(state.pathology)) for (const t of c.tissues) for (const d of t.diagnoses) used.set(d.term.toLowerCase(), (used.get(d.term.toLowerCase()) || 0) + 1);
    const L = state.library;
    return {
      source: L.source, updatedAt: L.updatedAt, systems: TERM.INHAND_SYSTEMS, sendCt: sendCtSummary(), lists: L.lists, zaphodLists: L.zaphodLists || null,
      organs: L.organs, diagnoses: L.diagnoses.map((d) => ({ ...d, usedIn: used.get(d.term.toLowerCase()) || 0 })),
      counts: { organs: L.organs.length, diagnoses: L.diagnoses.length,
        verified: L.organs.filter((o) => o.send?.verified).length + L.diagnoses.filter((d) => d.send?.verified).length,
        unverified: L.organs.filter((o) => o.send?.spec && !o.send.verified).length + L.diagnoses.filter((d) => !d.send?.verified).length },
    };
  }

  function importSendCt({ body }) {
    const wanted = new Set(TERM.SEND_LISTS);
    const codelists = {};
    for (const [k, l] of Object.entries(body.codelists || {})) {
      if (!wanted.has(k) || !Array.isArray(l?.terms)) continue;
      codelists[k] = { code: text(l.code, 20), short: k, name: text(l.name, 200), extensible: !!l.extensible,
        terms: l.terms.slice(0, 20000).map((x) => ({ code: text(x.code, 20), value: text(x.value, 300), synonyms: (Array.isArray(x.synonyms) ? x.synonyms : []).slice(0, 20).map((y) => text(y, 300)),
          definition: text(x.definition, 400), preferred: text(x.preferred, 300) })).filter((x) => x.value) };
    }
    if (!codelists.SPEC && !codelists.NONNEO && !codelists.NEOPLASM) fail('The file has none of the SEND codelists the library uses (SPEC, NONNEO, NEOPLASM). Choose "SEND Terminology.txt" from NCI EVS.');
    state.sendCt = { fileName: text(body.fileName, 160) || 'SEND Terminology.txt', importedAt: clock.now(), importedBy: by(), codelists };
    const res = TERM.verifyLibrary(state.library, codelists);
    state.library = { ...res.library, updatedAt: clock.now() };
    const terms = Object.values(codelists).reduce((n, l) => n + l.terms.length, 0);
    audit('SEND_CT_IMPORTED', 'library', 0, `${state.sendCt.fileName}: ${terms} terms in ${Object.keys(codelists).join(', ')}; ${res.verified} library entries matched, ${res.unmatched} to review`);
    commit();
    return { verified: res.verified, unmatched: res.unmatched, sendCt: sendCtSummary() };
  }

  function searchSendCt({ query }) {
    const list = state.sendCt?.codelists?.[text(query.list, 20)];
    if (!list) return { available: false, terms: [] };
    return { available: true, terms: TERM.searchSend(list, text(query.q, 80), 30) };
  }

  function codeAgainstSend(listKey, value) {
    const hit = state.sendCt ? TERM.findSendTerm(state.sendCt.codelists[listKey], value) : null;
    return hit ? { term: hit.value, code: hit.code, verified: true } : { term: value, code: '', verified: false };
  }

  function saveDiagnosis({ body }) {
    const original = text(body.original, 160);
    const term = text(body.term, 160);
    if (!term) fail('Give the diagnosis term.');
    const existing = original ? libDx(original) : null;
    if (original && !existing) fail(`${original} is not in the library.`);
    const clash = libDx(term);
    if (clash && clash !== existing) fail(`${term} is already in the library.`);
    const organs = (Array.isArray(body.organs) ? body.organs : []).map((o) => text(o, 80)).filter((o) => o === '*' || libOrgan(o)).map((o) => (o === '*' ? o : libOrgan(o).name));
    const neoplasm = !!body.neoplasm;
    const list = TERM.sendList(neoplasm);
    const entry = {
      term, organs: organs.length ? organs : ['*'], neoplasm, system: systemKey(body.system), active: body.active !== false, source: existing?.source || 'lab',
      send: { list, ...codeAgainstSend(list, text(body.sendTerm, 300).toUpperCase() || TERM.guessSendTerm(term)) },
    };
    if (existing) Object.assign(existing, entry); else state.library.diagnoses.push(entry);
    state.library.updatedAt = clock.now();
    audit(existing ? 'DIAGNOSIS_EDITED' : 'DIAGNOSIS_ADDED', 'library', 0, `${term}${entry.send.verified ? ` = SEND ${entry.send.list} ${entry.send.term} (${entry.send.code})` : ''}`);
    commit();
    return { diagnosis: entry };
  }

  function organEntry(name, { paired = false, sex = 'N', system = 'general', spec = '', source = 'lab', active = true } = {}) {
    const c = spec ? codeAgainstSend('SPEC', spec) : { term: '', code: '', verified: false };
    return { name, paired: !!paired, sex: ['M', 'F'].includes(sex) ? sex : 'N', system: systemKey(system), active, source, send: { spec: c.term, code: c.code, verified: c.verified } };
  }

  function saveOrgan({ body }) {
    const original = text(body.original, 80);
    const name = text(body.name, 80);
    if (!name) fail('Give the organ name.');
    const existing = original ? libOrgan(original) : null;
    if (original && !existing) fail(`${original} is not in the library.`);
    const clash = libOrgan(name);
    if (clash && clash !== existing) fail(`${name} is already in the library.`);
    const entry = organEntry(name, { paired: body.paired, sex: body.sex, system: body.system, spec: text(body.spec, 200).toUpperCase(), source: existing?.source || 'lab', active: body.active !== false });
    if (existing) Object.assign(existing, entry); else state.library.organs.push(entry);
    state.library.updatedAt = clock.now();
    audit(existing ? 'ORGAN_EDITED' : 'ORGAN_ADDED', 'library', 0, name);
    commit();
    return { organ: entry };
  }

  function ensureOrgans(names, source) {
    let added = 0;
    for (const raw of names) {
      const name = text(raw, 80);
      if (!name || libOrgan(name)) continue;
      const m = TERM.ORGAN_TERMS[name];
      state.library.organs.push(organEntry(name, { sex: m?.sex, system: m?.system, spec: m?.spec ?? name.toUpperCase(), source }));
      added++;
    }
    return added;
  }

  function libraryCsv() {
    return csvFile(`mhl-pathology-library-${clock.today()}.csv`, [
      ['Kind', 'Term', 'Organs', 'Neoplasm', 'INHAND system', 'SEND codelist', 'SEND value', 'NCI code', 'Checked against SEND CT', 'Source', 'Active'],
      ...state.library.organs.map((o) => ['Organ', o.name, '', '', TERM.systemName(o.system), 'SPEC', o.send?.spec, o.send?.code, o.send?.verified ? 'Yes' : 'No', o.source, o.active === false ? 'No' : 'Yes']),
      ...state.library.diagnoses.map((d) => ['Diagnosis', d.term, d.organs.join('; '), d.neoplasm ? 'Yes' : 'No', TERM.systemName(d.system), d.send?.list, d.send?.term, d.send?.code, d.send?.verified ? 'Yes' : 'No', d.source, d.active === false ? 'No' : 'Yes']),
    ]);
  }

  // SEND-style microscopic findings for a study's signed cases. A convenience table, not a validated SEND dataset.
  function studySendMi({ params }) {
    const s = getStudy(params[0]);
    const rows = [['STUDYID', 'USUBJID', 'PHL', 'GROUP', 'SEX', 'MISEQ', 'MISPEC', 'MIORRES', 'MISTRESC', 'MIRESCAT', 'MISEV', 'MILAT', 'MIDISTR (not SEND)', 'Coded against SEND CT']];
    for (const a of state.subjects.filter((x) => x.studyId === s.id).sort((x, y) => x.phl.localeCompare(y.phl))) {
      const c = state.pathology[a.id];
      if (c?.status !== 'SIGNED') continue;
      let seq = 0;
      for (const t of c.tissues) {
        const spec = libOrgan(t.organ)?.send?.spec || t.organ.toUpperCase();
        if (t.result === 'NSL') rows.push([s.zap, `${s.zap}-${a.phl}`, a.phl, a.groupCode, a.sex, ++seq, spec, 'No significant lesions', 'NORMAL', '', '', '', '', '']);
        for (const dx of t.diagnoses) {
          const m = TERM.miRow({ organ: t.organ, dx: { ...dx, text: PATH.dxText(dx) }, library: state.library });
          rows.push([s.zap, `${s.zap}-${a.phl}`, a.phl, a.groupCode, a.sex, ++seq, m.MISPEC, m.MIORRES, m.MISTRESC, m.MIRESCAT, m.MISEV, m.MILAT, m.MIDISTR, m.CODED]);
        }
      }
    }
    return csvFile(`${s.zap}-MI-SEND-style.csv`, rows);
  }

  // ---------- protocols ----------
  const protoList = (kind) => (kind === 'trim' ? state.protocols.trim : kind === 'necropsy' ? state.protocols.necropsy : fail('Unknown kind of protocol.'));
  const getProtocol = (kind, id) => protoList(kind).find((p) => p.id === Number(id)) || (() => { throw new HttpError(404, 'Protocol not found.'); })();
  const studiesUsing = (kind, p) => state.studies.filter((st) => (kind === 'trim' ? st.trimProtocolId : st.necropsyProtocolId) === p.id);
  const nextProtocolId = (kind) => Math.max(0, ...protoList(kind).map((p) => p.id)) + 1;

  function protocolSummary(kind, p) {
    return { id: p.id, name: p.name, description: p.description, date: p.date, approved: p.approved, obsolete: p.obsolete, source: p.source,
      rows: (kind === 'trim' ? p.organs : p.steps).length, studies: studiesUsing(kind, p).length, problems: PROT.protocolProblems(p, kind).length };
  }

  function listProtocols() {
    return { necropsy: state.protocols.necropsy.map((p) => protocolSummary('necropsy', p)), trim: state.protocols.trim.map((p) => protocolSummary('trim', p)) };
  }

  function protocolDetail({ params }) {
    const [kind, id] = params;
    const p = getProtocol(kind, id);
    return { kind, protocol: p, problems: PROT.protocolProblems(p, kind), studies: studiesUsing(kind, p).map((st) => ({ id: st.id, zap: st.zap, title: st.title })),
      organs: state.library.organs.filter((o) => o.active !== false).map((o) => ({ name: o.name, sex: o.sex })),
      history: state.audit.filter((x) => x.entity === `protocol-${kind}` && x.entityId === p.id).slice(-30).reverse() };
  }

  function protocolRows(kind, body) {
    if (kind === 'trim') {
      return { organs: (Array.isArray(body.organs) ? body.organs : []).slice(0, 300).map((o) => ({ block: text(o.block, 10).toUpperCase(), organ: text(o.organ, 80),
        sex: ['M', 'F'].includes(o.sex) ? o.sex : 'N', description: text(o.description, 300) })).filter((o) => o.organ) };
    }
    return { steps: (Array.isArray(body.steps) ? body.steps : []).slice(0, 300).map((st) => ({ organ: text(st.organ, 80), fixative: text(st.fixative, 60), freeze: text(st.freeze, 60),
      weigh: !!st.weigh, measure: !!st.measure, description: text(st.description, 300) })).filter((st) => st.organ).map((st, i) => ({ seq: i + 1, ...st })) };
  }

  function createProtocol({ params, body }) {
    const kind = params[0];
    const copy = body.copyFrom ? getProtocol(kind, body.copyFrom) : null;
    const name = text(body.name, 120) || (copy ? `${copy.name} (copy)` : '');
    if (!name) fail('Give the protocol a name.');
    if (protoList(kind).some((p) => p.name.toLowerCase() === name.toLowerCase())) fail(`There is already a ${kind} protocol called "${name}".`);
    const rows = copy ? structuredClone(kind === 'trim' ? { organs: copy.organs } : { steps: copy.steps }) : protocolRows(kind, body);
    const p = {
      id: nextProtocolId(kind), name, description: text(body.description ?? copy?.description, 500), date: clock.today(), approved: false, obsolete: false,
      approvedBy: '', dateApproved: '', instructions: text(body.instructions ?? copy?.instructions, 2000), source: 'pilot', zaphodId: null,
      ...(kind === 'necropsy' ? { weighAnimal: body.weighAnimal == null ? (copy ? copy.weighAnimal : true) : !!body.weighAnimal,
        perfusion: ['', 'whole', 'lung', 'liver'].includes(body.perfusion) ? body.perfusion : (copy?.perfusion || '') } : {}),
      ...rows,
    };
    protoList(kind).push(p);
    ensureOrgans((kind === 'trim' ? p.organs : p.steps).map((r) => r.organ), 'protocol');
    audit('PROTOCOL_CREATED', `protocol-${kind}`, p.id, copy ? `${name}, copied from ${copy.name}` : name);
    commit();
    return { id: p.id };
  }

  function editProtocol({ params, body }) {
    const [kind, id] = params;
    const p = getProtocol(kind, id);
    if (p.obsolete) fail('This protocol is obsolete. Restore it before editing.');
    const name = body.name == null ? p.name : text(body.name, 120);
    if (!name) fail('Give the protocol a name.');
    if (protoList(kind).some((x) => x !== p && x.name.toLowerCase() === name.toLowerCase())) fail(`There is already a ${kind} protocol called "${name}".`);
    Object.assign(p, { name, description: body.description == null ? p.description : text(body.description, 500), instructions: body.instructions == null ? p.instructions : text(body.instructions, 2000) });
    if (kind === 'necropsy') {
      if (body.weighAnimal != null) p.weighAnimal = !!body.weighAnimal;
      if (body.perfusion != null && ['', 'whole', 'lung', 'liver'].includes(body.perfusion)) p.perfusion = body.perfusion;
    }
    if (body.steps || body.organs) Object.assign(p, protocolRows(kind, body));
    const wasApproved = p.approved;
    if (wasApproved) { p.approved = false; p.approvedBy = ''; p.dateApproved = ''; }
    ensureOrgans((kind === 'trim' ? p.organs : p.steps).map((r) => r.organ), 'protocol');
    audit('PROTOCOL_EDITED', `protocol-${kind}`, p.id, wasApproved ? 'Edited; it needs approving again' : 'Edited');
    commit();
    return protocolDetail({ params });
  }

  function setProtocolFlag(action) {
    return ({ params, body }) => {
      const [kind, id] = params;
      const p = getProtocol(kind, id);
      if (action === 'approve') {
        const problems = PROT.protocolProblems(p, kind);
        if (problems.length) fail(`Before approving: ${problems.join(' ')}`);
        if (p.obsolete) fail('An obsolete protocol cannot be approved.');
        Object.assign(p, { approved: true, approvedBy: by(), dateApproved: clock.today() });
      } else if (action === 'obsolete') p.obsolete = true;
      else p.obsolete = false;
      audit(`PROTOCOL_${action.toUpperCase()}`, `protocol-${kind}`, p.id, text(body?.reason, 200) || p.name);
      commit();
      return protocolDetail({ params });
    };
  }

  // Protocols, study links, dictionaries and reference ranges from Zaphod (export_zaphod_reference.sql), or one protocol
  // from a pasted table. With ?preview=1 it says what would change and changes nothing.
  function importProtocols({ body, query }) {
    const preview = query.preview === '1';
    let parsed;
    try {
      if (body.format === 'zaphod') parsed = PROT.parseZaphodExport(String(body.text || ''));
      else if (body.format === 'table') {
        const t = PROT.parseProtocolTable(String(body.text || ''), text(body.name, 120));
        if (!t.name) fail('Give the protocol a name.');
        const base = { zaphodId: null, description: '', date: clock.today(), approved: false, obsolete: false, approvedBy: '', dateApproved: '', instructions: '' };
        parsed = { source: 'table', studies: [], dictionaries: null,
          necropsy: body.kind !== 'trim' && t.steps.length ? [{ ...base, name: t.name, weighAnimal: true, perfusion: '', steps: t.steps }] : [],
          trim: body.kind !== 'necropsy' && t.organs.length ? [{ ...base, name: t.name, organs: t.organs }] : [] };
        if (!parsed.necropsy.length && !parsed.trim.length) fail(body.kind === 'trim' ? 'A trim protocol needs a Block column.' : 'A necropsy protocol needs organ rows with Weigh, Fixative or Sequence columns, or no Block column.');
      } else fail('Choose what to import.');
    } catch (e) { if (e instanceof R.DomainError) throw e; fail(e.message); }
    const opts = { linkStudies: true, dictionaries: true, ranges: true, ...(body.options || {}) };
    // A Zaphod protocol is the same protocol only if it has the same Zaphod ID (Zaphod can hold two protocols with one name).
    const match = (kind, p) => (p.zaphodId != null
      ? protoList(kind).find((x) => x.source === 'zaphod' && x.zaphodId === p.zaphodId)
      : protoList(kind).find((x) => x.name.toLowerCase() === p.name.toLowerCase())) || null;
    const LISTS = ['sites', 'morphology', 'shapes', 'colors', 'consistencies', 'fates', 'conditions', 'physicalIds', 'fixatives', 'freezes'];
    const d = parsed.dictionaries;
    const plan = {
      necropsy: parsed.necropsy.map((p) => ({ name: p.name, rows: p.steps.length, action: match('necropsy', p) ? 'update' : 'add', approved: p.approved, obsolete: p.obsolete })),
      trim: parsed.trim.map((p) => ({ name: p.name, rows: p.organs.length, action: match('trim', p) ? 'update' : 'add', approved: p.approved, obsolete: p.obsolete })),
      studies: parsed.studies.map((st) => ({ zap: st.zap, inPilot: state.studies.some((x) => x.zap === st.zap.toUpperCase()),
        necropsy: parsed.necropsy.find((p) => p.zaphodId === st.necropsyZaphodId)?.name || '', trim: parsed.trim.find((p) => p.zaphodId === st.trimZaphodId)?.name || '' })),
      dictionaries: d ? {
        organs: d.organs.length, newOrgans: d.organs.filter((o) => !libOrgan(o.name)).length, diagnoses: d.diagnoses.length, newDiagnoses: d.diagnoses.filter((x) => !libDx(x.term)).length,
        lists: Object.fromEntries(LISTS.map((k) => [k, d[k].length])), chemistryRanges: d.chemistryRanges.length, hematologyRanges: d.hematologyRanges.length,
      } : null,
      exportedAt: parsed.exportedAt || '', database: parsed.database || '',
    };
    if (preview) return { plan };

    const source = parsed.source === 'zaphod' ? 'zaphod' : 'pilot';
    const idMap = { necropsy: new Map(), trim: new Map() };
    for (const kind of ['necropsy', 'trim']) {
      for (const p of parsed[kind]) {
        const existing = match(kind, p);
        const fields = { ...p, source, approvedBy: p.approvedBy || '', dateApproved: p.dateApproved || '' };
        if (existing) { Object.assign(existing, fields, { id: existing.id }); idMap[kind].set(p.zaphodId, existing.id); }
        else { const np = { id: nextProtocolId(kind), ...fields }; protoList(kind).push(np); idMap[kind].set(p.zaphodId, np.id); }
        ensureOrgans((kind === 'trim' ? p.organs : p.steps).map((r) => r.organ), source);
      }
    }
    let linked = 0;
    if (opts.linkStudies) {
      for (const st of parsed.studies) {
        const pilot = state.studies.find((x) => x.zap === st.zap.toUpperCase());
        if (!pilot) continue;
        if (idMap.necropsy.has(st.necropsyZaphodId)) pilot.necropsyProtocolId = idMap.necropsy.get(st.necropsyZaphodId);
        if (idMap.trim.has(st.trimZaphodId)) pilot.trimProtocolId = idMap.trim.get(st.trimZaphodId);
        linked++;
      }
    }
    let organsAdded = 0; let dxAdded = 0; let listsReplaced = 0; let rangesLoaded = 0;
    if (d && opts.dictionaries) {
      for (const o of d.organs) {
        const ex = libOrgan(o.name);
        if (ex) { ex.paired = ex.paired || o.paired; if (o.sex !== 'N') ex.sex = o.sex; continue; }
        organsAdded += ensureOrgans([o.name], 'zaphod');
        const added = libOrgan(o.name);
        if (added) { added.paired = o.paired; if (o.sex !== 'N') added.sex = o.sex; }
      }
      for (const x of d.diagnoses) {
        if (libDx(x.term)) continue;
        const neoplasm = /^n/i.test(x.code);   // Zaphod's Code (H/N) read as N = neoplasm; see open question 21
        const list = TERM.sendList(neoplasm);
        const organ = x.organ ? libOrgan(x.organ) : null;
        state.library.diagnoses.push({ term: x.term, organs: organ ? [organ.name] : ['*'], neoplasm, system: organ?.system || 'general', active: true, source: 'zaphod',
          zaphodCode: x.code, send: { list, ...codeAgainstSend(list, TERM.guessSendTerm(x.term)) } });
        dxAdded++;
      }
      for (const k of LISTS) if (d[k].length) { state.library.lists[k] = [...new Set(d[k])]; listsReplaced++; }
      // The necropsy and pathology rules recognize these fates by name, so they stay in the list.
      for (const f of ['Scheduled euthanasia', 'Moribund euthanasia', 'Found dead']) {
        if (!state.library.lists.fates.some((x) => x.toLowerCase() === f.toLowerCase())) state.library.lists.fates.push(f);
      }
      state.library.zaphodLists = { severity: d.severity, distribution: d.distribution, neoplasm: d.neoplasm, hn: d.hn };
      state.library.source = 'Zaphod dictionaries with the pilot starter list';
      state.library.updatedAt = clock.now();
    }
    if (d && opts.ranges) {
      const speciesKey = (name) => Object.entries(SPECIES).find(([, v]) => v.name.toLowerCase().slice(0, 4) === String(name).toLowerCase().slice(0, 4))?.[0] || null;
      for (const r of [...d.chemistryRanges, ...d.hematologyRanges]) {
        const key = speciesKey(r.species);
        if (!key) continue;
        const target = (state.bloodwork.ranges[key] ||= {});
        for (const [col, v] of Object.entries(r.values)) {
          const code = BW.analyteCode(col.replace(/range$/i, '').replace(/percent$/i, '%').replace(/plus$/i, '+'));
          const range = BW.parseRange(v);
          if (code && range) { target[code] = { low: range.low, high: range.high }; rangesLoaded++; }
        }
      }
    }
    audit('PROTOCOLS_IMPORTED', 'library', 0, `${source === 'zaphod' ? 'Zaphod export' : 'Pasted table'}: ${parsed.necropsy.length} necropsy and ${parsed.trim.length} trim protocols; ${linked} studies linked; ${organsAdded} organs and ${dxAdded} diagnoses added; ${listsReplaced} lists replaced; ${rangesLoaded} reference ranges`);
    commit();
    return { plan, linked, organsAdded, diagnosesAdded: dxAdded, listsReplaced, rangesLoaded };
  }

  // ---------- bloodwork ----------
  const BWS = () => state.bloodwork;
  const getResult = (id) => BWS().results.find((r) => r.id === Number(id)) || (() => { throw new HttpError(404, 'Result not found.'); })();
  const getCytology = (id) => BWS().cytology.find((c) => c.id === Number(id)) || (() => { throw new HttpError(404, 'Cytology record not found.'); })();
  const instrumentName = (code) => BW.INSTRUMENTS[code]?.name || code;

  // The sample ID typed on the analyzer is the PHL number; also accept it without the letter when only one PHL# fits.
  function subjectByPhl(sampleId) {
    const n = BW.normalizeSampleId(sampleId);
    if (n.length < 6) return null;
    const exact = state.subjects.find((s) => s.phl === n);
    if (exact) return exact;
    const loose = state.subjects.filter((s) => s.phl.slice(0, 8) === n);
    return loose.length === 1 ? loose[0] : null;
  }

  function analyteView(r, subject) {
    const species = subject?.species || 'MOUSE';
    return r.analytes.map((a) => {
      const info = BW.analyteInfo(a.code);
      // A unit printed by the analyzer that is not the usual one (say glucose in mmol/L) is kept, and the lab's
      // range, which is in the usual unit, is not applied to it.
      const otherUnit = a.unit && info?.unit && BW.sameUnit(a.unit, info.unit) === false;
      const range = otherUnit ? (a.range ? { ...a.range, source: 'instrument' } : null) : BW.rangeFor(a.code, species, BWS().ranges, a.range);
      return { ...a, name: info?.name || a.code, unit: a.unit || info?.unit || '', range, labFlag: BW.flagFor(a.value, range), unitNote: otherUnit ? `Printed in ${a.unit}, not ${info.unit}` : '' };
    });
  }

  function resultSummary(r) {
    const subject = r.subjectId ? state.subjects.find((s) => s.id === r.subjectId) : null;
    const req = subject ? requestOf(subject) : null;
    const flagged = analyteView(r, subject).filter((a) => a.labFlag || ['H', 'L'].includes(a.flag)).length;
    return { id: r.id, kind: r.kind, instrument: r.instrument, instrumentName: instrumentName(r.instrument), panel: r.panel, sampleId: r.sampleId,
      subjectId: subject?.id || null, phl: subject?.phl || null, label: subject?.label || '', groupCode: subject?.groupCode || '', requestId: req?.id || null,
      requestNumber: req?.number || null, zap: req ? studyOf(req)?.zap || null : null, testedOn: r.testedOn, testedAt: r.testedAt, status: r.status,
      analytes: r.analytes.length, flagged, runId: r.runId, fileName: BWS().runs.find((x) => x.id === r.runId)?.fileName || '', rejectReason: r.rejectReason };
  }

  function importBloodwork({ body }) {
    const fileName = text(body.fileName, 200) || 'Pasted text';
    let parsed; let layout = '';
    let truncated = false;
    if (Array.isArray(body.grid)) {
      truncated = body.grid.length > 300 || body.grid.some((r) => Array.isArray(r) && r.length > 500);
      const grid = body.grid.slice(0, 300).map((r) => (Array.isArray(r) ? r.slice(0, 500).map((c) => text(c, 80)) : []));
      const h = BW.parseHemavetGrid(grid, text(body.layout, 20));
      parsed = h.results; layout = h.layout;
    } else if (typeof body.text === 'string') {
      truncated = body.text.length > 1_000_000;
      parsed = BW.splitPrintouts(body.text.slice(0, 1_000_000)).map(BW.parseAbaxis);
      // A printout without its header line (for example a capture that started mid-print) does not say which analyzer it
      // came from; the rest of the file, or the choice on the import page, decides.
      const stated = parsed.find((p) => p.instrumentStated)?.instrument;
      parsed.forEach((p) => { if (['VS2', 'PICCOLO'].includes(body.instrument)) p.instrument = body.instrument; else if (!p.instrumentStated) p.instrument = stated || 'ABAXIS'; });
    } else fail('Choose a file to import.');
    parsed = parsed.filter((p) => p.analytes.length);
    if (!parsed.length) fail('No results were found in this file. It should be a VetScan VS2 or Piccolo printout captured by PuTTY, or a Hemavet DMS export.');
    const run = { id: nextId(), fileName, kind: parsed[0].kind, instrument: parsed[0].instrument, layout, importedAt: clock.now(), importedBy: by(), source: text(body.source, 20) || 'file', count: 0 };
    if (parsed.length > 500) truncated = true;
    const out = { imported: 0, matched: 0, unmatched: 0, duplicates: 0, truncated, results: [] };
    const valuesKey = (analytes) => analytes.map((a) => `${a.code}=${a.value ?? a.text}`).join(';');
    for (const p of parsed.slice(0, 500)) {
      const subject = subjectByPhl(p.sampleId);
      const sampleId = text(p.sampleId, 40);
      const testedOn = isDate(p.testedOn) ? p.testedOn : clock.today();
      const sameInstrument = (x) => x.instrument === p.instrument || p.instrument === 'ABAXIS' || x.instrument === 'ABAXIS';
      const dup = BWS().results.find((x) => x.status !== 'REJECTED' && x.kind === p.kind && sameInstrument(x) && x.testedOn === testedOn
        && x.testedAt === (p.testedAt || '') && (subject ? x.subjectId === subject.id : x.sampleId === sampleId) && valuesKey(x.analytes) === valuesKey(p.analytes));
      if (dup) { out.duplicates++; continue; }
      const r = {
        id: nextId(), runId: run.id, kind: p.kind, instrument: p.instrument, panel: text(p.panel, 80), sampleId, subjectId: subject?.id ?? null,
        testedOn, testedAt: text(p.testedAt, 5), testNumber: text(p.testNumber, 20), rotorLot: text(p.rotorLot, 30), serial: text(p.serial, 30),
        qc: text(p.qc, 60), indices: p.indices ? { hem: text(p.indices.hem, 4), lip: text(p.indices.lip, 4), ict: text(p.indices.ict, 4) } : null,
        analytes: p.analytes.slice(0, 80).map((a) => ({ code: a.code, value: Number.isFinite(a.value) ? a.value : null, text: text(a.text, 20), prefix: ['<', '>'].includes(a.prefix) ? a.prefix : '',
          unit: text(a.unit, 20), flag: text(a.flag, 3).toUpperCase(), range: a.range && Number.isFinite(a.range.low) ? { low: a.range.low, high: a.range.high } : null })),
        raw: text(p.raw, 8000), status: subject ? 'TO_REVIEW' : 'UNMATCHED', comment: '', reviewedBy: null, reviewedAt: null, chargeId: null, rejectReason: '',
        history: [{ at: clock.now(), by: by(), action: `Imported from ${fileName}` }],
      };
      BWS().results.push(r);
      out.imported++; if (subject) out.matched++; else out.unmatched++;
      out.results.push(resultSummary(r));
    }
    run.count = out.imported;
    BWS().runs.push(run);
    audit('BLOODWORK_IMPORTED', 'bloodwork', run.id, `${fileName}: ${out.imported} results (${out.unmatched} unmatched${out.duplicates ? `, ${out.duplicates} already imported` : ''})`);
    commit();
    return { runId: run.id, layout, ...out };
  }

  function cytologySummary(c) {
    const subject = state.subjects.find((s) => s.id === c.subjectId);
    const req = subject ? requestOf(subject) : null;
    return { id: c.id, subjectId: c.subjectId, phl: subject?.phl || '', label: subject?.label || '', requestId: req?.id || null, requestNumber: req?.number || '',
      specimen: c.specimen, collectedOn: c.collectedOn, status: c.status, pathologist: c.pathologist, version: c.version, signedAt: c.signedAt };
  }

  function bloodworkHome() {
    const all = BWS().results;
    const sum = (rows) => rows.map(resultSummary);
    return {
      toReview: sum(all.filter((r) => r.status === 'TO_REVIEW')).sort((a, b) => (a.phl || '').localeCompare(b.phl || '') || a.kind.localeCompare(b.kind)),
      unmatched: sum(all.filter((r) => r.status === 'UNMATCHED')),
      recent: sum(all.filter((r) => r.status === 'RELEASED' || r.status === 'REJECTED').slice(-40).reverse()),
      runs: BWS().runs.slice(-15).reverse(),
      cytology: BWS().cytology.map(cytologySummary).sort((a, b) => (a.status === 'DRAFT' ? 0 : 1) - (b.status === 'DRAFT' ? 0 : 1) || b.collectedOn.localeCompare(a.collectedOn)),
      ranges: Object.fromEntries(Object.entries(BWS().ranges).map(([k, v]) => [k, Object.keys(v).length])),
      folders: state.settings.instrumentFolders || { chemistry: '', hematology: '' },
    };
  }

  function bloodworkResult({ params }) {
    const r = getResult(params[0]);
    const subject = r.subjectId ? state.subjects.find((s) => s.id === r.subjectId) : null;
    const req = subject ? requestOf(subject) : null;
    const study = req ? studyOf(req) : null;
    return {
      result: { ...r, instrumentName: instrumentName(r.instrument), fileName: BWS().runs.find((x) => x.id === r.runId)?.fileName || '' },
      analytes: analyteView(r, subject),
      subject: subject ? { id: subject.id, phl: subject.phl, label: subject.label, sex: subject.sex, groupCode: subject.groupCode, species: subject.species } : null,
      request: req ? { id: req.id, number: req.number, piName: piName(req.pi), chargeType: req.chargeType } : null,
      study: study ? { id: study.id, zap: study.zap } : null,
      others: subject ? BWS().results.filter((x) => x.subjectId === subject.id && x.id !== r.id).map(resultSummary) : [],
      charge: r.chargeId ? chargeView(state.charges.find((c) => c.id === r.chargeId)) : null,
    };
  }

  function assignResult({ params, body }) {
    const r = getResult(params[0]);
    if (!['UNMATCHED', 'TO_REVIEW'].includes(r.status)) fail('Only results that are not yet released can be assigned to a PHL number.');
    const subject = subjectByPhl(body.phl);
    if (!subject) fail(`${text(body.phl, 20) || 'That'} is not a PHL number in the LIMS.`);
    r.subjectId = subject.id; r.status = 'TO_REVIEW';
    r.history.push({ at: clock.now(), by: by(), action: `Assigned to ${subject.phl} (analyzer ID "${r.sampleId}")` });
    audit('BLOODWORK_ASSIGNED', 'request', subject.requestId, `${subject.phl}: ${r.kind.toLowerCase()} result with sample ID "${r.sampleId}"`);
    commit();
    return bloodworkResult({ params });
  }

  function releaseResult({ params, body }) {
    const r = getResult(params[0]);
    if (r.status !== 'TO_REVIEW') fail(r.status === 'UNMATCHED' ? 'Assign the result to a PHL number first.' : `This result is ${r.status.toLowerCase()}.`);
    const subject = getSubject(r.subjectId);
    const req = requestOf(subject);
    const code = BW.INSTRUMENTS[r.instrument]?.charge;
    const charge = req.chargeType === 'C' && code
      ? newCharge(req, { section: 'BLOOD', code, date: r.testedOn, units: 1, subjectId: subject.id }, 'EVENT', { bloodworkResultId: r.id }) : null;
    Object.assign(r, { status: 'RELEASED', reviewedBy: by(), reviewedAt: clock.now(), comment: text(body.comment, 1000), chargeId: charge?.id ?? null });
    r.history.push({ at: clock.now(), by: by(), action: `Reviewed and released${charge ? `; charge ${code} created` : ''}` });
    audit('BLOODWORK_RELEASED', 'request', req.id, `${subject.phl}: ${r.kind.toLowerCase()} from ${instrumentName(r.instrument)}${charge ? `, ${code}` : ''}`);
    commit();
    return bloodworkResult({ params });
  }

  // A printout that did not say which analyzer it came from: the reviewer says, which decides the charge code.
  function setInstrument({ params, body }) {
    const r = getResult(params[0]);
    if (!['UNMATCHED', 'TO_REVIEW'].includes(r.status)) fail('Only results not yet released can be changed.');
    if (r.kind !== 'CHEMISTRY' || !['VS2', 'PICCOLO'].includes(body.instrument)) fail('Choose the VS2 or the Piccolo.');
    r.history.push({ at: clock.now(), by: by(), action: `Analyzer set to ${instrumentName(body.instrument)} (was ${instrumentName(r.instrument)})` });
    r.instrument = body.instrument;
    commit();
    return bloodworkResult({ params });
  }

  function rejectResult({ params, body }) {
    const r = getResult(params[0]);
    if (r.status === 'RELEASED') fail('Reopen the result before rejecting it.');
    if (r.status === 'REJECTED') fail('This result is already rejected.');
    const reason = text(body.reason, 300);
    if (!reason) fail('Give a reason, for example "QC failed, rerun" or "duplicate run".');
    Object.assign(r, { status: 'REJECTED', rejectReason: reason, reviewedBy: by(), reviewedAt: clock.now() });
    r.history.push({ at: clock.now(), by: by(), action: `Rejected: ${reason}` });
    audit('BLOODWORK_REJECTED', 'bloodwork', r.id, `${r.sampleId}: ${reason}`);
    commit();
    return bloodworkResult({ params });
  }

  function reopenResult({ params, body }) {
    const r = getResult(params[0]);
    if (!['RELEASED', 'REJECTED'].includes(r.status)) fail('Only released or rejected results can be reopened.');
    const reason = text(body.reason, 300);
    if (!reason) fail('Give a reason for reopening the result.');
    const charge = r.chargeId ? state.charges.find((c) => c.id === r.chargeId) : null;
    if (charge?.status === 'RELEASED') fail('Its charge has been released for billing. Correct it with an adjustment in the request\'s charges first.');
    if (charge && charge.status !== 'VOID') { charge.status = 'VOID'; charge.voidReason = `Bloodwork reopened: ${reason}`; }
    Object.assign(r, { status: r.subjectId ? 'TO_REVIEW' : 'UNMATCHED', chargeId: null, rejectReason: '' });
    r.history.push({ at: clock.now(), by: by(), action: `Reopened: ${reason}` });
    audit('BLOODWORK_REOPENED', 'bloodwork', r.id, `${r.sampleId}: ${reason}`);
    commit();
    return bloodworkResult({ params });
  }

  function getRanges() { return { ranges: BWS().ranges, species: Object.entries(SPECIES).map(([k, v]) => [k, v.name]) }; }

  function putRanges({ body }) {
    const species = text(body.species, 20);
    if (!SPECIES[species]) fail('Choose a species.');
    const cleaned = {};
    for (const [code, r] of Object.entries(body.ranges || {})) {
      if (!BW.analyteInfo(code)) continue;
      const low = num(r?.low); const high = num(r?.high);
      if (low == null && high == null) continue;
      if ((low != null && !Number.isFinite(low)) || (high != null && !Number.isFinite(high))) fail(`${code}: the range must be numbers.`);
      if (low != null && high != null && low > high) fail(`${code}: the low end is above the high end.`);
      cleaned[code] = { low, high };
    }
    BWS().ranges[species] = cleaned;
    audit('RANGES_SET', 'bloodwork', 0, `${SPECIES[species].name}: ${Object.keys(cleaned).length} analytes`);
    commit();
    return getRanges();
  }

  function createCytology({ body }) {
    const subject = body.subjectId ? getSubject(body.subjectId) : subjectByPhl(body.phl);
    if (!subject) fail(`${text(body.phl, 20) || 'That'} is not a PHL number in the LIMS.`);
    if (!BW.CYTOLOGY_SPECIMENS.includes(body.specimen)) fail('Choose the specimen.');
    const c = { id: nextId(), subjectId: subject.id, specimen: body.specimen, stain: BW.CYTOLOGY_STAINS[0], collectedOn: clock.today(), counts: {}, rbc: {}, nrbc: null, platelets: '',
      description: '', interpretation: '', status: 'DRAFT', version: 1, pathologist: by(), signedBy: null, signedAt: null, versions: [], amendments: [],
      history: [{ at: clock.now(), by: by(), action: 'Started' }] };
    BWS().cytology.push(c);
    audit('CYTOLOGY_STARTED', 'request', subject.requestId, `${subject.phl}: ${c.specimen}`);
    commit();
    return { id: c.id };
  }

  function cytologyDetail({ params }) {
    const c = getCytology(params[0]);
    const subject = getSubject(c.subjectId);
    const req = requestOf(subject);
    const study = studyOf(req);
    return { cytology: c, summary: BW.differentialSummary(c.counts, c.specimen), cells: BW.DIFFERENTIALS[BW.differentialKind(c.specimen)],
      subject: { id: subject.id, phl: subject.phl, label: subject.label, sex: subject.sex, groupCode: subject.groupCode },
      request: { id: req.id, number: req.number, piName: piName(req.pi) }, study: study ? { id: study.id, zap: study.zap } : null,
      bloodwork: BWS().results.filter((r) => r.subjectId === subject.id && r.status === 'RELEASED').map(resultSummary) };
  }

  function saveCytology({ params, body }) {
    const c = getCytology(params[0]);
    if (c.status === 'SIGNED') fail('This cytology report is signed. Amend it (with a reason) to change it.');
    if (body.specimen != null && BW.CYTOLOGY_SPECIMENS.includes(body.specimen)) c.specimen = body.specimen;
    if (body.stain != null && BW.CYTOLOGY_STAINS.includes(body.stain)) c.stain = body.stain;
    if (body.collectedOn != null && isDate(body.collectedOn)) c.collectedOn = body.collectedOn;
    const cells = BW.DIFFERENTIALS[BW.differentialKind(c.specimen)];
    if (body.counts) {
      c.counts = Object.fromEntries(cells.map((k) => {
        const v = body.counts[k]; const n = v === '' || v == null ? 0 : Number(v);
        if (!Number.isInteger(n) || n < 0 || n > 10000) fail(`${k}: enter a whole number of cells.`);
        return [k, n];
      }).filter(([, n]) => n > 0));
    }
    if (body.rbc) c.rbc = Object.fromEntries(BW.RBC_MORPHOLOGY.map((k) => [k, BW.GRADES.includes(body.rbc[k]) ? body.rbc[k] : '']).filter(([, v]) => v));
    if (body.nrbc !== undefined) {
      const n = body.nrbc === '' || body.nrbc == null ? null : Number(body.nrbc);
      if (n != null && (!Number.isInteger(n) || n < 0 || n > 1000)) fail('Nucleated RBCs per 100 WBC must be a whole number.');
      c.nrbc = n;
    }
    if (body.platelets != null && BW.PLATELET_ESTIMATES.includes(body.platelets)) c.platelets = body.platelets;
    if (body.description != null) c.description = text(body.description, 4000);
    if (body.interpretation != null) c.interpretation = text(body.interpretation, 4000);
    c.history = [...c.history, { at: clock.now(), by: by(), action: 'Saved draft' }].slice(-60);
    commit();
    return cytologyDetail({ params });
  }

  function signCytology({ params }) {
    const c = getCytology(params[0]);
    if (c.status === 'SIGNED') fail('This cytology report is already signed.');
    if (!c.interpretation) fail('Before signing: write the interpretation.');
    Object.assign(c, { status: 'SIGNED', signedBy: by(), signedAt: clock.now(), pathologist: by() });
    c.versions.push({ version: c.version, signedBy: c.signedBy, signedAt: c.signedAt, snapshot: { specimen: c.specimen, stain: c.stain, counts: c.counts, rbc: c.rbc, nrbc: c.nrbc,
      platelets: c.platelets, description: c.description, interpretation: c.interpretation } });
    c.history.push({ at: clock.now(), by: by(), action: `Signed out (version ${c.version})` });
    const subject = getSubject(c.subjectId);
    audit('CYTOLOGY_SIGNED', 'request', subject.requestId, `${subject.phl}: ${c.specimen}, version ${c.version}`);
    commit();
    return cytologyDetail({ params });
  }

  function amendCytology({ params, body }) {
    const c = getCytology(params[0]);
    if (c.status !== 'SIGNED') fail('Only a signed report can be amended.');
    const reason = text(body.reason, 300);
    if (!reason) fail('Give the reason for the amendment.');
    c.amendments.push({ fromVersion: c.version, reason, by: by(), at: clock.now() });
    Object.assign(c, { status: 'DRAFT', version: c.version + 1, signedBy: null, signedAt: null });
    c.history.push({ at: clock.now(), by: by(), action: `Amendment started: ${reason}` });
    commit();
    return cytologyDetail({ params });
  }

  // Released results and signed cytology for one animal, for its bloodwork report.
  function subjectBloodwork({ params }) {
    const subject = getSubject(params[0]);
    const req = requestOf(subject);
    const study = studyOf(req);
    const results = BWS().results.filter((r) => r.subjectId === subject.id && r.status === 'RELEASED')
      .sort((a, b) => a.kind.localeCompare(b.kind) || a.testedOn.localeCompare(b.testedOn))
      .map((r) => ({ ...resultSummary(r), qc: r.qc, indices: r.indices, comment: r.comment, reviewedBy: r.reviewedBy, reviewedAt: r.reviewedAt, analytes: analyteView(r, subject) }));
    const cytology = BWS().cytology.filter((c) => c.subjectId === subject.id && c.status === 'SIGNED')
      .map((c) => ({ ...c, summary: BW.differentialSummary(c.counts, c.specimen), cells: BW.DIFFERENTIALS[BW.differentialKind(c.specimen)] }));
    return { subject: { id: subject.id, phl: subject.phl, label: subject.label, sex: subject.sex, groupCode: subject.groupCode, species: subject.species },
      request: { id: req.id, number: req.number, piName: piName(req.pi) }, study: study ? { id: study.id, zap: study.zap, title: study.title } : null, results, cytology };
  }

  // Group means by analyte for a study, from the latest released result of each kind per animal.
  function studyBloodwork({ params }) {
    const s = getStudy(params[0]);
    const animals = state.subjects.filter((x) => x.studyId === s.id).sort((a, b) => a.phl.localeCompare(b.phl));
    const groupKeys = [...s.groups.map((g) => g.code), ...(animals.some((a) => !a.groupCode) ? ['(none)'] : [])];
    const latest = (a, kind) => BWS().results.filter((r) => r.subjectId === a.id && r.kind === kind && r.status === 'RELEASED')
      .sort((x, y) => `${y.testedOn}${y.testedAt}`.localeCompare(`${x.testedOn}${x.testedAt}`))[0];
    const tables = ['HEMATOLOGY', 'CHEMISTRY'].map((kind) => {
      const rows = animals.map((a) => ({ a, r: latest(a, kind) })).filter((x) => x.r);
      const order = (kind === 'HEMATOLOGY' ? BW.HEMATOLOGY : BW.CHEMISTRY).map((x) => x.code);
      const codes = [...new Set(rows.flatMap(({ r }) => r.analytes.filter((x) => x.value != null).map((x) => x.code)))].sort((x, y) => order.indexOf(x) - order.indexOf(y));
      return { kind, animals: rows.length, analytes: codes.map((code) => {
        const info = BW.analyteInfo(code);
        // Each animal's value (for the scatterplots) and the reference range most of them were flagged against.
        const points = rows.map(({ a, r }) => ({ a, v: analyteView(r, a).find((x) => x.code === code) })).filter(({ v }) => v && v.value != null)
          .map(({ a, v }) => ({ phl: a.phl, label: a.label, group: a.groupCode || '(none)', sex: a.sex || 'U', value: v.value, flag: v.labFlag || '', range: v.range }));
        const rangeCount = new Map();
        for (const p of points) if (p.range && (Number.isFinite(p.range.low) || Number.isFinite(p.range.high))) { const k = JSON.stringify([p.range.low ?? null, p.range.high ?? null]); rangeCount.set(k, (rangeCount.get(k) || 0) + 1); }
        const common = [...rangeCount].sort((x, y) => y[1] - x[1])[0];
        const range = common ? { low: JSON.parse(common[0])[0], high: JSON.parse(common[0])[1] } : null;
        return { code, name: info?.name || code, unit: info?.unit || '', range, points: points.map(({ range: _r, ...p }) => p), groups: groupKeys.map((g) => {
          const d = describe(rows.filter(({ a }) => (a.groupCode || '(none)') === g).map(({ r }) => r.analytes.find((x) => x.code === code)?.value).filter((v) => v != null));
          return { code: g, n: d.n, mean: sig(d.mean), sd: sig(d.sd), ciLow: sig(d.ciLow), ciHigh: sig(d.ciHigh) };
        }) };
      }) };
    });
    return { study: { id: s.id, zap: s.zap, title: s.title }, groupKeys, groups: s.groups, tables,
      cytology: BWS().cytology.filter((c) => animals.some((a) => a.id === c.subjectId)).map(cytologySummary) };
  }

  function studyBloodworkCsv({ params }) {
    const s = getStudy(params[0]);
    const rows = [['ZAP', 'PHL', 'Animal', 'Group', 'Sex', 'Kind', 'Instrument', 'Date', 'Time', 'Analyte', 'Value', 'Unit', 'Instrument flag', 'Range low', 'Range high', 'Range source', 'Flag']];
    for (const a of state.subjects.filter((x) => x.studyId === s.id).sort((x, y) => x.phl.localeCompare(y.phl))) {
      for (const r of BWS().results.filter((x) => x.subjectId === a.id && x.status === 'RELEASED')) {
        for (const v of analyteView(r, a)) rows.push([s.zap, a.phl, a.label, a.groupCode, a.sex, r.kind, instrumentName(r.instrument), r.testedOn, r.testedAt,
          v.code, v.value ?? `${v.prefix}${v.text}`, v.unit, v.flag, v.range?.low, v.range?.high, v.range?.source, v.labFlag]);
      }
    }
    return csvFile(`${s.zap}-bloodwork.csv`, rows);
  }

  // ---------- study reports ----------
  // Printable study-level reports. The necropsy report: groups, animal disposition, gross lesion incidence and each
  // animal's gross findings, organ weights (tables and plots) and bloodwork (tables and scatterplots by group). The
  // pathology report: incidence of microscopic findings, neoplasm tables and each animal's findings by group. Incidences
  // are compared with the first group listed by Fisher's exact test (two-sided, not adjusted for multiple comparisons).
  function studyReportBase(s) {
    const animals = state.subjects.filter((x) => x.studyId === s.id).sort((a, b) => a.phl.localeCompare(b.phl));
    const keyOf = (a) => a.groupCode || '(none)';
    const groupKeys = [...s.groups.map((g) => g.code), ...(animals.some((a) => !a.groupCode) ? ['(none)'] : [])];
    const groups = groupKeys.map((code) => {
      const g = s.groups.find((x) => x.code === code);
      const list = animals.filter((a) => keyOf(a) === code);
      return { code, name: g?.name || (code === '(none)' ? 'No group' : ''), sex: g?.sex || '', treatment: g?.treatment || '', n: list.length,
        female: list.filter((a) => a.sex === 'F').length, male: list.filter((a) => a.sex === 'M').length };
    }).filter((g) => g.n > 0);
    const protocol = studyProtocol(s);
    const requests = [...new Set(animals.map((a) => a.requestId))].map((id) => state.requests.find((r) => r.id === id)).filter(Boolean);
    return {
      study: { id: s.id, zap: s.zap, title: s.title, piName: piName(s.pi), inst: s.pi?.inst || '', acuc: s.acuc, protocolName: protocol.name, trimProtocolName: protocol.trimName || '' },
      groups, keys: groups.map((g) => g.code), reference: groups[0]?.code || null, animals, keyOf,
      requests: requests.map((r) => ({ id: r.id, number: r.number, type: REQUEST_TYPES[r.type].name, received: r.received })),
      notes: s.reportNotes || { necropsy: '', pathology: '' }, printedAt: clock.now(), printedBy: by(),
    };
  }
  // p value of each group's incidence against the reference group's; null for the reference group itself.
  const pVersusReference = (cells) => cells.map((c, i) => (i === 0 || c.group === '(none)' ? null : fisherExact(c.affected, c.examined - c.affected, cells[0].affected, cells[0].examined - cells[0].affected)));

  function studyNecropsyReport({ params }) {
    const s = getStudy(params[0]);
    const base = studyReportBase(s);
    const det = studyDetail({ params });
    const { keyOf, ...rest } = base;
    const animals = base.animals.map((a) => {
      const n = state.necropsies[a.id];
      const ok = n?.status === 'APPROVED';
      return { id: a.id, phl: a.phl, label: a.label, group: keyOf(a), sex: a.sex || '', necropsy: n?.status || null, date: n?.date || null, prosector: n?.prosector || '',
        fate: n?.fate || '', condition: n?.condition || '', bodyWeight: n?.bodyWeight ?? null, observations: ok ? n.observations || '' : '',
        findings: ok ? n.organs.flatMap((o) => o.findings.map((f) => ({ organ: o.organ, text: findingText(f) }))) : [],
        notCollected: ok ? n.organs.filter((o) => o.notCollected).map((o) => o.organ) : [] };
    });
    const incidence = det.incidence.map((r) => {
      const cells = base.keys.map((g) => ({ group: g, affected: r.byGroup[g] || 0, examined: det.examined[g] || 0 }));
      return { organ: r.organ, finding: r.morphology, cells, p: pVersusReference(cells) };
    });
    return { ...rest, animals, approved: animals.filter((a) => a.necropsy === 'APPROVED').length, examined: det.examined, incidence,
      absolute: det.absolute, relative: det.relative, bloodwork: studyBloodwork({ params }) };
  }

  function studyPathologyReport({ params }) {
    const s = getStudy(params[0]);
    const base = studyReportBase(s);
    const { keyOf, ...rest } = base;
    const sum = studyPathology({ params });
    const keys = base.keys.filter((k) => sum.groupKeys.includes(k));
    const incidence = sum.incidence.map((r) => {
      const cells = keys.map((g) => ({ group: g, ...r.byGroup[g] }));
      return { organ: r.organ, term: r.term, neoplasm: r.neoplasm, cells, p: pVersusReference(cells) };
    });
    const signed = base.animals.filter((a) => state.pathology[a.id]?.status === 'SIGNED');
    // Neoplasms by organ: animals with each neoplasm, benign or malignant primary, or metastatic.
    const neo = new Map();
    for (const a of signed) {
      for (const t of state.pathology[a.id].tissues) for (const dx of t.diagnoses.filter((x) => x.neoplasm)) {
        const kind = dx.origin === 'Metastatic' ? 'Metastatic' : dx.behavior || 'Uncertain';
        const k = `${t.organ}|${dx.term}|${kind}`;
        if (!neo.has(k)) neo.set(k, { organ: t.organ, term: dx.term, kind, animals: {} });
        (neo.get(k).animals[keyOf(a)] ||= new Set()).add(a.id);
      }
    }
    const examinedIn = (organ, g) => sum.examined?.[organ]?.[g] || 0;
    const neoplasms = [...neo.values()].map((r) => {
      const cells = keys.map((g) => ({ group: g, affected: r.animals[g]?.size || 0, examined: examinedIn(r.organ, g) }));
      return { organ: r.organ, term: r.term, kind: r.kind, cells, p: pVersusReference(cells) };
    }).sort((x, y) => x.organ.localeCompare(y.organ) || x.kind.localeCompare(y.kind) || x.term.localeCompare(y.term));
    const animals = base.animals.map((a) => {
      const c = state.pathology[a.id];
      const rep = c?.status === 'SIGNED' ? animalReport({ params: [a.id] }).pathology : null;
      return { id: a.id, phl: a.phl, label: a.label, group: keyOf(a), sex: a.sex || '', status: c?.status || null, signedBy: c?.signedBy || '', signedAt: c?.signedAt || null,
        version: c?.version || null, causeOfDeath: rep?.causeOfDeath || '', comment: rep?.comment || '',
        findings: rep ? rep.tissues.flatMap((t) => t.diagnoses.map((x) => ({ organ: t.organ, text: x.text, neoplasm: x.neoplasm }))) : [],
        nsl: rep ? rep.tissues.filter((t) => t.result === 'NSL').map((t) => t.organ) : [],
        notExamined: rep ? rep.tissues.filter((t) => ['NOT_EXAMINED', 'NOT_PRESENT'].includes(t.result)).map((t) => t.organ) : [] };
    });
    return { ...rest, keys, animals, signed: signed.length, pathologists: [...new Set(signed.map((a) => state.pathology[a.id].signedBy).filter(Boolean))],
      incidence, neoplasmSummary: sum.neoplasms, neoplasms, tabulated: sum.tabulated, tabAnimals: sum.animals, notRead: sum.notRead };
  }

  function saveReportNotes({ params, body }) {
    const s = getStudy(params[0]);
    const kind = body.kind === 'pathology' ? 'pathology' : 'necropsy';
    s.reportNotes ||= { necropsy: '', pathology: '' };
    s.reportNotes[kind] = text(body.text, 8000);
    audit('STUDY_REPORT_SUMMARY', 'study', s.id, `${s.zap}: ${kind} report summary saved`);
    commit();
    return { ok: true };
  }

  // ---------- IHC ordered with a new request ----------
  const stainSnapshot = (s) => {
    const a = s.assayId ? assayById(s.assayId) : null;
    const snapshot = a ? { id: a.id, ...Object.fromEntries(IHC.ASSAY_FIELDS.map(([k]) => [k, a[k]])), kind: a.kind, plex: a.plex, chromogen: a.chromogen, speciesTags: a.speciesTags, fixTags: a.fixTags, status: a.status } : null;
    return { ...s, snapshot };
  };
  const IHC_SPECIES_OF = { MOUSE: 'Mouse', RAT: 'Rat', HUMAN: 'Human', PDX: 'PDX', ORGANOID: 'Organoid' };
  const IHC_FIXATIVE_OF = { '10%NBF': '10% NBF', '4%PFA': '4% PFA', FRESH: 'Fresh frozen (OCT)' };

  function ihcDraftForRequest({ pi, project, species, fixative, priority, n, phls = [], ihc }) {
    const sampleType = IHC.SAMPLE_TYPES.some(([k]) => k === ihc.sampleType) ? ihc.sampleType : 'BLOCK';
    return readDraft({
      requester: { last: pi.last, first: pi.first, inst: pi.inst }, billTo: pi.last, projectId: project, importance: priority === 'S' ? 'STAT' : 'Routine',
      species: IHC_SPECIES_OF[species] || 'Other', fixativeUsed: IHC_FIXATIVE_OF[fixative] || 'Other',
      samples: Array.from({ length: n }, (_, i) => ({ tissue: text(ihc.tissue, 60) || 'Tissue', blockNo: phls[i] || `#${i + 1}`, type: sampleType })),
      he: ihc.he, unstained: ihc.unstained, stains: ihc.stains, scan: ihc.scan, additional: text(ihc.notes, 2000),
    }, false);
  }

  function attachIhcOrder(request, phls, ihc) {
    const { draft, problems } = ihcDraftForRequest({ pi: request.pi, project: request.project, species: request.species, fixative: request.fixative, priority: request.priority, n: phls.length, phls, ihc });
    if (problems.length) fail(problems.join(' '));
    if (!draft.stains.length && !draft.he.on && !draft.unstained.on) return null;
    const yy = clock.today().slice(2, 4);
    const w = {
      id: nextId(), number: `MH${yy}-${String(allocate('MH', yy, 1)).padStart(4, '0')}`, status: 'Accepted', source: 'NEW_REQUEST', submittedOn: clock.today(), submittedAt: clock.now(),
      ...draft, stains: draft.stains.map(stainSnapshot), addOn: !!ihc.addOn, copiedFrom: null,
      requestId: request.id, acceptedBy: by(), acceptedAt: clock.now(), declinedBy: null, declinedAt: null, declineReason: '',
    };
    state.ihcRequests.push(w);
    request.webRequestId = w.id;
    audit('IHC_ORDERED', 'ihc', w.id, `${w.number} ordered with ${request.number}: ${IHC.summarize(w, stainLookup(w))}`);
    return w;
  }

  // Estimate lines for the stains chosen in New request, before the request exists.
  function estimateRequestIhc({ body }) {
    const n = Math.max(1, Math.min(500, parseInt(body.n, 10) || 1));
    const { draft, problems } = ihcDraftForRequest({ pi: { last: 'x', first: '', inst: '' }, project: '', species: text(body.species, 20), fixative: text(body.fixative, 20),
      priority: body.priority, n, ihc: body.ihc || {} });
    return { estimate: priceEstimate(draft, assayById, { addOn: !!body.ihc?.addOn }), warnings: IHC.requestWarnings(draft, assayById, clock.today()), problems, summary: IHC.summarize(draft, assayById) };
  }

  // ---------- cost estimates for possible new projects ----------
  // Built before there is a NAS request: priced from the price list, sent to the investigator, then accepted, declined
  // or revised. An accepted estimate is linked to the NAS request the investigator submits (or, in the pilot, makes
  // one), and its price list lines become that NAS request's scope, which New request starts its estimate from.
  const EMONEY = { amount: R.amount, sumMoney: R.sumMoney };
  const getEstimate = (id) => state.estimates.find((e) => e.id === Number(id)) || (() => { throw new HttpError(404, 'Estimate not found.'); })();
  const pricedEstimate = (e) => ESTX.priceEstimate(e, priceList.items, EMONEY, { frozen: e.status !== 'DRAFT' });
  const revisionsOf = (e) => state.estimates.filter((x) => x.number === e.number).sort((a, b) => a.rev - b.rev);
  // The current revision: the latest one not discarded (or, if every revision was discarded, the last of them).
  const latestRevision = (e) => { const all = revisionsOf(e); return all.filter((x) => x.status !== 'DISCARDED').at(-1) || all.at(-1); };
  const currentEstimates = () => [...new Map(state.estimates.map((x) => [x.number, latestRevision(x)])).values()];
  // "EST26-0003 rev 2", as shown on screen, finds EST26-0003.
  const estimateQuery = (q) => q.replace(/\s*rev\s*\d+\s*$/i, '');
  const SECTION_CODES = priceList.sections.map((x) => x.code);
  const FIXATIVES = ['10%NBF', '4%PFA', 'FRESH', 'OTHER'];

  // Reads what the editor sends. Drafts may be saved with unfinished lines; sending checks them.
  function readEstimate(b) {
    const inv = b.investigator || {};
    const email = text(inv.email, 120);
    if (email && !MAIL.isAddress(email)) fail('The email address does not look right.');
    const species = text(b.species, 20);
    if (species && !SPECIES[species]) fail('Unknown species.');
    const type = text(b.type, 20);
    if (type && !REQUEST_TYPES[type]) fail('Unknown request type.');
    const n = b.n === '' || b.n == null ? null : Number(b.n);
    if (n != null && (!Number.isInteger(n) || n < 1 || n > 500)) fail('The number of animals or samples must be a whole number from 1 to 500.');
    const validDays = b.validDays === '' || b.validDays == null ? ESTX.VALID_DAYS : Number(b.validDays);
    if (!Number.isInteger(validDays) || validDays < 1 || validDays > 365) fail('An estimate is valid for 1 to 365 days.');
    const phasesIn = Array.isArray(b.phases) ? b.phases : [];
    if (phasesIn.length > ESTX.MAX_PHASES) fail(`An estimate can have at most ${ESTX.MAX_PHASES} phases.`);
    if (phasesIn.reduce((k, ph) => k + (Array.isArray(ph?.lines) ? ph.lines.length : 0), 0) > ESTX.MAX_LINES) fail(`An estimate can have at most ${ESTX.MAX_LINES} lines.`);
    const phases = phasesIn.map((ph, i) => ({
      name: text(ph?.name, 60) || `Phase ${i + 1}`,
      lines: (Array.isArray(ph?.lines) ? ph.lines : []).map((raw) => {
        const l = raw && typeof raw === 'object' ? raw : {};
        const code = text(l.code, 10).toUpperCase();
        const section = text(l.section, 20).toUpperCase();
        if (!code && !SECTION_CODES.includes(section)) fail('Choose the price list section for each line that is not on the price list.');
        const line = { section, code, units: Math.round(Number(l.units) * 100) / 100 || 0, optional: !!l.optional, note: text(l.note, 200),
          description: code ? '' : text(l.description, 200), unit: code ? '' : text(l.unit, 30), unitPrice: l.unitPrice === '' || l.unitPrice == null ? null : Number(l.unitPrice) };
        // Keep what the list says next to the line, so a sent estimate keeps its wording and prices if the list changes.
        const pr = ESTX.priceLine(line, priceList.items, EMONEY);
        return { ...line, section: pr.section || section, description: pr.description, unit: pr.unit, unitPrice: pr.unitPrice ?? (Number.isFinite(line.unitPrice) ? line.unitPrice : null), priceByHand: pr.priceByHand };
      }),
    }));
    const assumptions = (Array.isArray(b.assumptions) ? b.assumptions : String(b.assumptions || '').split('\n')).map((x) => text(x, 500)).filter(Boolean).slice(0, 30);
    return {
      investigator: { last: text(inv.last, 100), first: text(inv.first, 100), inst: text(inv.inst, 200), email, phone: text(inv.phone, 30) },
      title: text(b.title, 200), description: text(b.description, 2000), species, fixative: FIXATIVES.includes(b.fixative) ? b.fixative : '10%NBF',
      type, n, validDays, assumptions, phases,
    };
  }

  function estimateRow(e) {
    const p = pricedEstimate(e);
    const nas = e.nasId ? state.nas.find((x) => x.id === e.nasId) : null;
    return {
      id: e.id, number: e.number, rev: e.rev, label: ESTX.estimateLabel(e), status: e.status, display: ESTX.displayStatus(e, clock.today()),
      investigator: piName(e.investigator), inst: e.investigator.inst, title: e.title, total: p.total, optionalTotal: p.optionalTotal,
      createdOn: e.createdOn, createdBy: e.createdBy, sentOn: e.sentOn, validUntil: e.validUntil, nasNumber: nas?.number || null,
      requestNumber: nas ? requestsOfNas(nas).map((r) => r.number).join(', ') || null : null,
    };
  }

  function listEstimates({ query }) {
    const want = text(query.status, 20).toUpperCase() || 'OPEN';
    const q = estimateQuery(text(query.q, 60)).toLowerCase();
    const today = clock.today();
    // One row per estimate number: its latest revision.
    const latest = currentEstimates();
    const counts = {};
    for (const e of latest) { const d = ESTX.displayStatus(e, today); counts[d] = (counts[d] || 0) + 1; }
    const rows = latest.filter((e) => {
      const d = ESTX.displayStatus(e, today);
      if (want === 'OPEN' ? !['DRAFT', 'SENT'].includes(d) : want === 'ALL' ? d === 'DISCARDED' : d !== want) return false;
      if (!q) return true;
      return [e.number, e.title, e.investigator.last, e.investigator.first, e.investigator.inst].some((v) => String(v || '').toLowerCase().includes(q.replace(/^est\s*/, 'est')));
    }).map(estimateRow);
    rows.sort((a, b) => (b.sentOn || b.createdOn).localeCompare(a.sentOn || a.createdOn) || b.number.localeCompare(a.number));
    return { estimates: rows, counts, validDays: ESTX.VALID_DAYS };
  }

  function estimateDetail({ params }) {
    const e = getEstimate(params[0]);
    const p = pricedEstimate(e);
    const ids = new Set(revisionsOf(e).map((x) => x.id));
    const nas = e.nasId ? state.nas.find((x) => x.id === e.nasId) : null;
    return {
      estimate: e, label: ESTX.estimateLabel(e), display: ESTX.displayStatus(e, clock.today()), priced: p, sendProblems: e.status === 'DRAFT' ? ESTX.sendProblems(e, p) : [],
      latest: latestRevision(e).id === e.id, revisions: revisionsOf(e).map((x) => ({ id: x.id, rev: x.rev, label: ESTX.estimateLabel(x), status: x.status, display: ESTX.displayStatus(x, clock.today()), sentOn: x.sentOn, total: pricedEstimate(x).total })),
      nas: nas ? { id: nas.id, number: nas.number, authorized: nas.authorized, scopeFromEstimate: !!nas.scopeFromEstimate, closed: !!nas.closed,
        requests: requestsOfNas(nas).map((r) => ({ id: r.id, number: r.number, estimatePhase: r.estimatePhase || '' })) } : null,
      openNas: state.nas.filter((x) => !x.closed && !x.estimateId).map((x) => ({ id: x.id, number: x.number, requester: piName({ last: x.requester.last, first: x.requester.first }), authorized: x.authorized, type: x.type, n: x.n,
        hasScope: Array.isArray(x.scope) && x.scope.length > 0,
        suggested: x.requester.last.toLowerCase() === e.investigator.last.toLowerCase() })),
      copiedFrom: e.copiedFrom ? (() => { const c = state.estimates.find((x) => x.id === e.copiedFrom); return c ? { id: c.id, label: ESTX.estimateLabel(c) } : null; })() : null,
      history: state.audit.filter((a) => a.entity === 'estimate' && ids.has(a.entityId)).slice(-40),
      priceList: { name: priceList.name, status: priceList.status, effectiveFrom: priceList.effectiveFrom },
    };
  }

  function newEstimateRecord(fields, { number = null, rev = 1 } = {}) {
    const yy = clock.today().slice(2, 4);
    return {
      id: nextId(), number: number || `EST${yy}-${String(allocate('EST', yy, 1)).padStart(4, '0')}`, rev, status: 'DRAFT', ...fields,
      priceListName: priceList.name, createdBy: by(), createdOn: clock.today(), updatedBy: by(), updatedAt: clock.now(),
      sentBy: null, sentOn: null, validUntil: null, decidedBy: null, decidedOn: null, declineReason: '', nasId: null,
      supersedes: null, supersededBy: null, statusBeforeRevision: null, copiedFrom: null,
    };
  }

  function createEstimate({ body }) {
    const fields = readEstimate(body);
    if (!fields.investigator.last) fail('Enter the investigator\'s last name.');
    if (!fields.title) fail('Give the project a title.');
    if (!fields.phases.length) fields.phases = [{ name: 'Phase 1', lines: [] }];
    const e = newEstimateRecord(fields);
    state.estimates.push(e);
    audit('ESTIMATE_CREATED', 'estimate', e.id, `${e.number} for ${piName(e.investigator)}: ${e.title}`);
    commit();
    return { id: e.id, number: e.number };
  }

  const mustBeDraft = (e) => { if (e.status !== 'DRAFT') fail(`${ESTX.estimateLabel(e)} has been ${ESTX.STATUS_LABEL[e.status].toLowerCase()}; only a draft can be changed. Revise it to make changes.`); };

  // Drafts are saved as they are edited, so saving is not audited; sending and the decisions are.
  function saveEstimate({ params, body }) {
    const e = getEstimate(params[0]);
    mustBeDraft(e);
    const fields = readEstimate(body);
    if (!fields.investigator.last) fail('Enter the investigator\'s last name.');
    if (!fields.title) fail('Give the project a title.');
    Object.assign(e, fields, { priceListName: priceList.name, updatedBy: by(), updatedAt: clock.now() });
    commit();
    const p = pricedEstimate(e);
    return { ok: true, updatedAt: e.updatedAt, total: p.total, sendProblems: ESTX.sendProblems(e, p) };
  }

  function sendEstimate({ params }) {
    const e = getEstimate(params[0]);
    const r = markSent(e);
    commit();
    return r;
  }

  // Sending fixes the lines as priced today and starts the validity period. Used by "Mark as sent" and by emailing.
  function markSent(e) {
    mustBeDraft(e);
    const p = pricedEstimate(e);
    const problems = ESTX.sendProblems(e, p);
    if (problems.length) fail(`Not ready to send: ${problems.slice(0, 4).join(' ')}${problems.length > 4 ? ` (and ${problems.length - 4} more)` : ''}`);
    // Freeze the lines as priced today.
    e.phases = e.phases.map((ph, i) => ({ name: ph.name, lines: p.phases[i].lines.map((l) => ({ section: l.section, code: l.code, description: l.description, unit: l.unit, units: l.units,
      unitPrice: l.unitPrice, optional: l.optional, note: l.note, priceByHand: l.priceByHand })) }));
    Object.assign(e, { status: 'SENT', sentBy: by(), sentOn: clock.today(), validUntil: addDays(clock.today(), e.validDays || ESTX.VALID_DAYS), priceListName: priceList.name, total: p.total });
    audit('ESTIMATE_SENT', 'estimate', e.id, `${ESTX.estimateLabel(e)} for $${p.total.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}, valid until ${e.validUntil}`);
    return { ok: true, validUntil: e.validUntil };
  }

  // ---------- emailing an estimate ----------
  // The pilot builds the email and the browser hands it to the user's email program; the user checks it and sends it
  // there. What is recorded is that it was emailed, to whom, and how.
  const emailSettings = () => ({ cc: '', signOff: '', ...(state.settings.estimateEmail || {}) });
  function emailProblem(e) {
    const label = ESTX.estimateLabel(e);
    if (e.status === 'SUPERSEDED') return `${label} has been replaced by a later revision; email that one.`;
    if (e.status === 'DISCARDED') return `${label} was discarded.`;
    if (e.status === 'DECLINED') return `${label} was declined. Revise it to send a new estimate.`;
    if (ESTX.displayStatus(e, clock.today()) === 'EXPIRED') return `${label} expired on ${ESTX.fmtDay(e.validUntil)}. Revise it, which checks the prices again, and email the revision.`;
    return '';
  }
  const mailOptions = (e, extra) => ({ today: clock.today(), preparedBy: e.sentBy || by(), speciesName: SPECIES[e.species]?.name || '', listName: priceList.name, listStatus: priceList.status, ...extra });

  function estimateEmailForm({ params }) {
    const e = getEstimate(params[0]);
    const p = pricedEstimate(e);
    const s = emailSettings();
    const kinds = MAIL.emailKinds(e);
    return {
      id: e.id, label: ESTX.estimateLabel(e), problem: emailProblem(e), kinds, to: e.investigator.email ? [e.investigator.email] : [], cc: s.cc,
      signOff: s.signOff || MAIL.defaultSignOff(by()), defaultSignOff: MAIL.defaultSignOff(by()), remembered: !!state.settings.estimateEmail,
      defaults: Object.fromEntries(kinds.map((k) => [k, { subject: MAIL.defaultSubject(e, k), message: MAIL.defaultMessage(e, p, { kind: k, today: clock.today() }) }])),
      sendProblems: e.status === 'DRAFT' ? ESTX.sendProblems(e, p) : [], validUntil: ESTX.validUntilFor(e, clock.today()), emails: e.emails || [],
      options: mailOptions(e, {}), mailtoMax: MAIL.MAILTO_MAX,
    };
  }

  function emailEstimate({ params, body }) {
    const e = getEstimate(params[0]);
    const problem = emailProblem(e);
    if (problem) fail(problem);
    const label = ESTX.estimateLabel(e);
    const to = MAIL.parseAddresses(body.to); const cc = MAIL.parseAddresses(body.cc);
    const bad = [...to.bad, ...cc.bad];
    if (bad.length) fail(`${bad.length === 1 ? 'This is' : 'These are'} not an email address: ${bad.slice(0, 3).join(', ')}${bad.length > 3 ? '…' : ''}`);
    if (!to.addresses.length) fail('Enter the address to send it to.');
    if (to.addresses.length + cc.addresses.length > MAIL.MAX_RECIPIENTS) fail(`An email from the pilot can go to at most ${MAIL.MAX_RECIPIENTS} addresses.`);
    const subject = MAIL.cut(MAIL.wellFormed(body.subject).replace(/[\r\n\t]+/g, ' ').trim(), 200);
    if (!subject) fail('Enter a subject.');
    const message = MAIL.wellFormed(body.message).replace(/\r\n?/g, '\n').trim();
    if (message.length > MAIL.MAX_MESSAGE) fail(`The message can be at most ${MAIL.MAX_MESSAGE.toLocaleString('en-US')} characters.`);
    const signOff = MAIL.wellFormed(body.signOff).replace(/\r\n?/g, '\n').trim();
    if (signOff.length > MAIL.MAX_SIGNOFF) fail(`The sign-off can be at most ${MAIL.MAX_SIGNOFF} characters.`);
    const method = Object.keys(MAIL.METHODS).includes(body.method) ? body.method : 'outlook';
    // Emailing a draft to the investigator sends it; a draft can also go to a colleague for review, still a draft.
    let sent = null;
    if (e.status === 'DRAFT' && body.markSent) {
      sent = markSent(e);
      if (!e.investigator.email) e.investigator.email = to.addresses[0];
    }
    const kind = e.status === 'DRAFT' ? 'review' : e.status === 'ACCEPTED' ? 'copy' : 'send';
    const p = pricedEstimate(e);
    const mail = MAIL.estimateEmail(e, p, mailOptions(e, { kind, subject, message, signOff }));
    let eml = null; let mailto = null;
    if (method === 'outlook') {
      const attachments = body.attachCsv ? [{ name: MAIL.csvName(e), type: 'text/csv', content: `\ufeff${ESTX.csvText(ESTX.csvRows(e, p))}` }] : [];
      eml = MAIL.buildEml({ to: to.addresses, cc: cc.addresses, subject, text: mail.text, html: mail.html, attachments });
    } else if (method === 'mailto') {
      mailto = MAIL.mailtoFor({ to: to.addresses, cc: cc.addresses, subject, mail });
      if (mailto.tooLong) fail('This email is too long for an email link. Shorten the message, or use Open in Outlook or Copy the email.');
    }
    e.emails = [...(e.emails || []), { at: clock.now(), by: by(), to: to.addresses, cc: cc.addresses, subject, method, kind }];
    if (body.remember) state.settings.estimateEmail = { cc: cc.addresses.join('; '), signOff };   // forgetting is in settings
    audit('ESTIMATE_EMAILED', 'estimate', e.id, `${label}: ${kind === 'review' ? 'draft for review' : kind === 'copy' ? 'a copy' : 'the estimate'} emailed to ${to.addresses.join(', ')}${cc.addresses.length ? `, copy to ${cc.addresses.join(', ')}` : ''} (${MAIL.METHODS[method]})`);
    commit();
    return { label, kind, method, sent, to: to.addresses, cc: cc.addresses, subject, html: mail.html, text: mail.text,
      eml, emlName: MAIL.emlName(e), mailto: mailto?.url || null, mailtoShort: !!mailto?.short };
  }

  function acceptEstimate({ params }) {
    const e = getEstimate(params[0]);
    if (e.status !== 'SENT') fail(`Only a sent estimate can be accepted; ${ESTX.estimateLabel(e)} is ${ESTX.STATUS_LABEL[e.status].toLowerCase()}.`);
    if (ESTX.displayStatus(e, clock.today()) === 'EXPIRED') fail(`${ESTX.estimateLabel(e)} expired on ${e.validUntil}. Revise it, which checks the prices again, and send the revision.`);
    Object.assign(e, { status: 'ACCEPTED', decidedBy: by(), decidedOn: clock.today() });
    audit('ESTIMATE_ACCEPTED', 'estimate', e.id, ESTX.estimateLabel(e));
    commit();
    return { ok: true };
  }

  function declineEstimate({ params, body }) {
    const e = getEstimate(params[0]);
    if (e.status !== 'SENT') fail(`Only a sent estimate can be declined; ${ESTX.estimateLabel(e)} is ${ESTX.STATUS_LABEL[e.status].toLowerCase()}.`);
    const reason = text(body.reason, 500);
    if (!reason) fail('Say why the estimate was declined (for example, the investigator chose another lab, or the project was not funded).');
    Object.assign(e, { status: 'DECLINED', decidedBy: by(), decidedOn: clock.today(), declineReason: reason });
    audit('ESTIMATE_DECLINED', 'estimate', e.id, `${ESTX.estimateLabel(e)}: ${reason}`);
    commit();
    return { ok: true };
  }

  // A revision is a new draft with the next revision number; the one it replaces is kept, marked revised.
  function reviseEstimate({ params }) {
    const e = getEstimate(params[0]);
    if (latestRevision(e).id !== e.id) fail(`${ESTX.estimateLabel(e)} already has a later revision.`);
    if (!['SENT', 'ACCEPTED', 'DECLINED'].includes(e.status)) fail(`A ${ESTX.STATUS_LABEL[e.status].toLowerCase()} estimate cannot be revised.`);
    if (e.nasId) fail(`${ESTX.estimateLabel(e)} is linked to a NAS request; make a copy for new work instead.`);
    const { investigator, title, description, species, fixative, type, n, validDays, assumptions } = e;
    const r = newEstimateRecord({ investigator: { ...investigator }, title, description, species, fixative, type, n, validDays, assumptions: [...assumptions],
      // Prices come from the list again, except for lines priced by hand.
      phases: e.phases.map((ph) => ({ name: ph.name, lines: ph.lines.map((l) => ({ ...l, unitPrice: l.code && !l.priceByHand ? null : l.unitPrice })) })) },
    { number: e.number, rev: Math.max(...revisionsOf(e).map((x) => x.rev)) + 1 });   // a discarded revision's number is not used again
    r.supersedes = e.id;
    Object.assign(e, { statusBeforeRevision: e.status, status: 'SUPERSEDED', supersededBy: r.id });
    state.estimates.push(r);
    audit('ESTIMATE_REVISED', 'estimate', r.id, `${ESTX.estimateLabel(r)} started from ${ESTX.estimateLabel(e)}`);
    commit();
    return { id: r.id };
  }

  function copyEstimate({ params }) {
    const e = getEstimate(params[0]);
    const { investigator, title, description, species, fixative, type, n, validDays, assumptions } = e;
    const c = newEstimateRecord({ investigator: { ...investigator }, title, description, species, fixative, type, n, validDays, assumptions: [...assumptions],
      phases: e.phases.map((ph) => ({ name: ph.name, lines: ph.lines.map((l) => ({ ...l, unitPrice: l.code && !l.priceByHand ? null : l.unitPrice })) })) });
    c.copiedFrom = e.id;
    state.estimates.push(c);
    audit('ESTIMATE_CREATED', 'estimate', c.id, `${c.number} copied from ${ESTX.estimateLabel(e)}`);
    commit();
    return { id: c.id, number: c.number };
  }

  // Discarding a draft revision puts the revision it came from back as it was.
  function discardEstimate({ params }) {
    const e = getEstimate(params[0]);
    mustBeDraft(e);
    e.status = 'DISCARDED';
    let back = null;
    if (e.supersedes) {
      back = state.estimates.find((x) => x.id === e.supersedes);
      if (back && back.supersededBy === e.id) Object.assign(back, { status: back.statusBeforeRevision || 'SENT', supersededBy: null, statusBeforeRevision: null });
    }
    audit('ESTIMATE_DISCARDED', 'estimate', e.id, `${ESTX.estimateLabel(e)}${back ? `; ${ESTX.estimateLabel(back)} is current again` : ''}`);
    commit();
    return { ok: true, backTo: back?.id || null };
  }

  // Links an accepted estimate to the NAS request the investigator submitted, or (pilot only) makes that NAS request.
  function linkEstimateNas({ params, body }) {
    const e = getEstimate(params[0]);
    if (e.status !== 'ACCEPTED') fail('Accept the estimate before linking it to a NAS request.');
    if (e.nasId) fail(`${ESTX.estimateLabel(e)} is already linked to a NAS request.`);
    const phaseIdx = Array.isArray(body.phases) && body.phases.length ? [...new Set(body.phases.map(Number))].filter((i) => Number.isInteger(i) && i >= 0 && i < e.phases.length) : null;
    if (Array.isArray(body.phases) && body.phases.length && !phaseIdx.length) fail('Choose at least one phase.');
    const scope = ESTX.scopeOf(e, phaseIdx);
    const p = pricedEstimate(e);
    let nas;
    if (body.nasId) {
      nas = state.nas.find((x) => x.id === Number(body.nasId));
      if (!nas) fail('Choose a NAS request.');
      mustBeOpenNas(nas);
      if (nas.estimateId) fail(`NAS# ${nas.number} is already linked to an estimate.`);
    } else if (body.create) {
      const type = text(body.type, 20) || e.type; const n = Number(body.n ?? e.n);
      if (!REQUEST_TYPES[type]) fail('Choose the request type for the NAS request.');
      const authorized = body.authorized != null && body.authorized !== '' ? Number(body.authorized) : ESTX.phasesTotal(p, phaseIdx, EMONEY);
      if (!(authorized > 0)) fail('The phases chosen come to $0.00 (lines to be confirmed have no price yet); enter the amount NAS authorized.');
      nas = addNas({ body: { type, n, species: e.species || 'MOUSE', requesterLast: e.investigator.last, requesterFirst: e.investigator.first, inst: e.investigator.inst,
        project: text(body.project, 30), authorized, number: text(body.number, 30), description: [e.title, e.description].filter(Boolean).join('. ').slice(0, 1000), scope: null } }).nas;
    } else fail('Choose a NAS request, or make one from the estimate.');
    nas.estimateId = e.id; nas.estimateLabel = ESTX.estimateLabel(e);
    // A NAS request that came with its own scope keeps it; otherwise the estimate's price list lines become its scope.
    const ownScope = Array.isArray(nas.scope) && nas.scope.length > 0;
    const fromEstimate = !ownScope && scope.length > 0;
    if (fromEstimate) {
      nas.scope = scope;
      // Each phase on its own too, so each request made from the NAS request can start from its phase (pilot, main study).
      const picked = phaseIdx || e.phases.map((_, i) => i);
      nas.estimatePhases = picked.map((i) => ({ name: e.phases[i].name, scope: ESTX.scopeOf(e, [i]), leftOut: ESTX.leftOutOfScope(e, [i]) })).filter((x) => x.scope.length);
    }
    if (!ownScope) nas.scopeLeftOut = ESTX.leftOutOfScope(e, phaseIdx);   // New request lists them
    nas.scopeFromEstimate = fromEstimate;
    e.nasId = nas.id;
    audit('ESTIMATE_LINKED', 'estimate', e.id, `${ESTX.estimateLabel(e)} linked to NAS# ${nas.number}${phaseIdx ? ` (${phaseIdx.map((i) => e.phases[i].name).join(', ')})` : ''}`);
    commit();
    return { ok: true, nasId: nas.id, nasNumber: nas.number, scope: nas.scope, scopeFromEstimate: fromEstimate };
  }

  function estimateCsv({ params }) {
    const e = getEstimate(params[0]);
    return csvFile(`${ESTX.estimateLabel(e).replace(/\s+/g, '-')}.csv`, ESTX.csvRows(e, pricedEstimate(e)));
  }

  // ---------- molecular work: accepted IHC requests are assigned and worked ----------
  const IHC_WORK = ['Not started', 'In progress', 'Done'];
  const initialsOf = (v) => {
    const t = text(v, 4).toUpperCase();
    if (t && !/^[A-Z]{2,4}$/.test(t)) fail('Assign to a person\'s initials: two to four letters.');
    return t;
  };
  // Initials seen in the audit trail, to offer when assigning work (the pilot has no staff list; production has sign-on).
  function staffInitials() {
    const seen = new Set(state.settings.initials ? [state.settings.initials] : []);
    for (const a of state.audit) if (/^[A-Z]{2,4}$/.test(a.by || '') && !['WEB', 'ME'].includes(a.by)) seen.add(a.by);
    return [...seen].sort();
  }

  function assignIhc({ body }) {
    const ids = [...new Set((Array.isArray(body.ids) ? body.ids : []).map(Number))];
    if (!ids.length) fail('Choose at least one IHC request.');
    const to = initialsOf(body.to);
    const list = ids.map(getWeb);
    for (const w of list) if (w.status !== 'Accepted') fail(`${w.number} is ${w.status.toLowerCase()}; only accepted requests are assigned.`);
    let changed = 0;
    for (const w of list) {
      if ((w.assignedTo || '') === to) continue;
      Object.assign(w, { assignedTo: to || null, assignedBy: by(), assignedAt: clock.now() });
      audit(to ? 'IHC_ASSIGNED' : 'IHC_UNASSIGNED', 'ihc', w.id, to ? `${w.number} assigned to ${to}` : `${w.number} unassigned`);
      changed++;
    }
    commit();
    return { ok: true, changed };
  }

  function ihcWork({ params, body }) {
    const w = getWeb(params[0]);
    if (w.status !== 'Accepted') fail(`${w.number} is ${w.status.toLowerCase()}; only accepted requests are worked.`);
    if (!IHC_WORK.includes(body.status)) fail('Choose Not started, In progress or Done.');
    if ((w.workStatus || 'Not started') === body.status) fail(`${w.number} is already ${body.status.toLowerCase()}.`);
    // Starting work that nobody has been given takes it on.
    if (body.status !== 'Not started' && !w.assignedTo) Object.assign(w, { assignedTo: by(), assignedBy: by(), assignedAt: clock.now() });
    Object.assign(w, { workStatus: body.status, workBy: by(), workAt: clock.now(), doneOn: body.status === 'Done' ? clock.today() : null });
    audit('IHC_WORK', 'ihc', w.id, `${w.number}: ${body.status.toLowerCase()}${w.assignedTo ? ` (${w.assignedTo})` : ''}`);
    commit();
    return { ok: true };
  }

  // ---------- Xenium runs ----------
  // A run is two Xenium slides with sections of PHL numbers waiting in the Xenium work area. It is assigned to someone,
  // goes through the steps in xenium.mjs, and on delivery the PHL numbers move on. The CY2027 list has no Xenium code,
  // so runs make no charges (open question).
  const XRUNS = () => state.xenium.runs;
  const getRun = (id) => XRUNS().find((x) => x.id === Number(id)) || (() => { throw new HttpError(404, 'Xenium run not found.'); })();
  const onActiveRun = (subjectId, exceptRun = null) => XRUNS().find((x) => x.id !== exceptRun && XEN.isActive(x)
    && x.slides.some((sl) => sl.sections.some((s) => s.subjectId === subjectId)));
  const runSubjects = (run) => run.slides.flatMap((sl) => sl.sections.map((s) => state.subjects.find((x) => x.id === s.subjectId)).filter(Boolean));
  function xeniumQueue() {
    return state.subjects.filter((s) => s.area === 'SPATL' && !onActiveRun(s.id)).map((s) => {
      const r = requestOf(s);
      return { subjectId: s.id, phl: s.phl, label: s.label, species: s.species, speciesName: SPECIES[s.species]?.name || s.species, priority: s.priority, since: s.since,
        requestId: r.id, requestNumber: r.number, investigator: piName(r.pi), due: r.due };
    }).sort((a, b) => (a.priority === 'S' ? 0 : 1) - (b.priority === 'S' ? 0 : 1) || (a.due || '').localeCompare(b.due || '') || a.phl.localeCompare(b.phl));
  }
  function runSummary(x) {
    const subs = runSubjects(x);
    const reqs = [...new Map(subs.map((s) => requestOf(s)).map((r) => [r.id, r])).values()];
    return { id: x.id, number: x.number, status: x.status, statusLabel: XEN.stepLabel(x.status), active: XEN.isActive(x), assay: x.assay, assayName: XEN.assayName(x.assay),
      panelName: x.panelName, assignedTo: x.assignedTo, sections: subs.length, slides: x.slides.filter((sl) => sl.sections.length).length,
      requests: reqs.map((r) => ({ id: r.id, number: r.number, investigator: piName(r.pi) })), createdOn: x.createdOn, lastStepOn: x.steps[x.status]?.on || x.createdOn,
      phls: subs.map((s) => s.phl) };
  }
  function listXenium() {
    const runs = XRUNS().map(runSummary).sort((a, b) => Number(b.active) - Number(a.active) || b.number.localeCompare(a.number));
    return { queue: xeniumQueue(), runs, staff: staffInitials() };
  }
  function readRunFields(body, run = null) {
    const assay = XEN.ASSAYS.some(([c]) => c === body.assay) ? body.assay : run?.assay;
    if (!assay) fail('Choose the Xenium assay.');
    const panel = XEN.panelById(body.panelId ?? run?.panelId);
    if (!panel) fail('Choose a panel.');
    return { assay, panelId: panel.id, panelName: panel.name, customNote: text(body.customNote ?? run?.customNote, 300), segmentation: body.segmentation != null ? !!body.segmentation : !!run?.segmentation,
      instrumentSerial: text(body.instrumentSerial ?? run?.instrumentSerial, 40), notes: text(body.notes ?? run?.notes, 2000) };
  }
  function createRun({ body }) {
    const slides = (Array.isArray(body.slides) ? body.slides : []).map((sl) => ({ slot: Number(sl.slot), slideSerial: text(sl.slideSerial, 40), subjectIds: [...new Set((sl.subjectIds || []).map(Number))] }))
      .filter((sl) => sl.subjectIds.length || sl.slideSerial);
    const problems = XEN.slidesProblems(slides);
    if (problems.length) fail(problems.join(' '));
    for (const sl of slides) for (const id of sl.subjectIds) {
      const s = getSubject(id);
      if (s.area !== 'SPATL') fail(`${s.phl} is not in the Xenium work area.`);
      const other = onActiveRun(s.id);
      if (other) fail(`${s.phl} is already on Xenium run ${other.number}.`);
    }
    const yy = clock.today().slice(2, 4);
    const run = {
      id: nextId(), number: `XR${yy}-${String(allocate('XR', yy, 1)).padStart(4, '0')}`, status: 'PLANNED', ...readRunFields(body),
      slides: slides.sort((a, b) => a.slot - b.slot).map((sl) => ({ slot: sl.slot, slideSerial: sl.slideSerial, sections: sl.subjectIds.map((subjectId) => ({ subjectId })) })),
      assignedTo: initialsOf(body.assignedTo) || null, steps: { PLANNED: { on: clock.today(), by: by() } }, qc: {}, outputFolder: '', failReason: '',
      createdBy: by(), createdOn: clock.today(),
    };
    XRUNS().push(run);
    audit('XENIUM_PLANNED', 'xenium', run.id, `${run.number}: ${run.panelName}, ${runSubjects(run).map((s) => s.phl).join(', ')}${run.assignedTo ? `, assigned to ${run.assignedTo}` : ''}`);
    commit();
    return { id: run.id, number: run.number };
  }
  function runDetail({ params }) {
    const x = getRun(params[0]);
    const subs = runSubjects(x);
    return {
      run: x, summary: runSummary(x), next: XEN.isActive(x) ? XEN.nextStep(x.status) : null,
      steps: XEN.STEPS.map(([code, label]) => ({ code, label, on: x.steps[code]?.on || null, by: x.steps[code]?.by || null, note: x.steps[code]?.note || '' })),
      slides: x.slides.map((sl) => ({ slot: sl.slot, slideSerial: sl.slideSerial, sections: sl.sections.map((sec) => {
        const s = state.subjects.find((y) => y.id === sec.subjectId); const r = s ? requestOf(s) : null;
        return { subjectId: sec.subjectId, phl: s?.phl || '?', label: s?.label || '', area: s?.area || '', species: SPECIES[s?.species]?.name || '', requestId: r?.id || null, requestNumber: r?.number || '', investigator: r ? piName(r.pi) : '' };
      }) })),
      warnings: XEN.panelWarnings(x, subs.map((s) => s.species)), staff: staffInitials(),
      history: state.audit.filter((a) => a.entity === 'xenium' && a.entityId === x.id).reverse(),
    };
  }
  function updateRun({ params, body }) {
    const x = getRun(params[0]);
    const active = XEN.isActive(x);
    const changes = [];
    if ('assignedTo' in body) {
      const to = initialsOf(body.assignedTo) || null;
      if (to !== (x.assignedTo || null)) { changes.push(to ? `assigned to ${to}` : 'unassigned'); x.assignedTo = to; }
    }
    if (['assay', 'panelId', 'customNote', 'segmentation', 'instrumentSerial'].some((k) => k in body)) {
      if (!active) fail(`${x.number} is ${XEN.stepLabel(x.status).toLowerCase()}; its assay and panel can no longer change.`);
      const f = readRunFields(body, x);
      if (XEN.stepIndex(x.status) >= XEN.stepIndex('PROBES') && (f.panelId !== x.panelId || f.assay !== x.assay || f.segmentation !== !!x.segmentation || f.customNote !== (x.customNote || ''))) {
        fail(`The probes are already on ${x.number}'s slides; the assay, panel, custom genes and cell segmentation cannot change.`);
      }
      if (f.panelId !== x.panelId) changes.push(`panel ${f.panelName}`);
      Object.assign(x, f);
    } else if ('notes' in body) x.notes = text(body.notes, 2000);
    if (Array.isArray(body.slideSerials)) {
      if (!active || XEN.stepIndex(x.status) >= XEN.stepIndex('LOADED')) fail(`${x.number}'s slides are already on the instrument; their serial numbers cannot change.`);
      body.slideSerials.forEach((v, i) => { if (x.slides[i]) x.slides[i].slideSerial = text(v, 40); });
    }
    if (body.qc && typeof body.qc === 'object') {
      for (const [k] of XEN.QC_FIELDS) {
        if (!(k in body.qc)) continue;
        const v = body.qc[k] === '' || body.qc[k] == null ? null : Number(body.qc[k]);
        if (v != null && !(Number.isFinite(v) && v >= 0)) fail('QC numbers are zero or more.');
        if (k === 'q20' && v != null && v > 100) fail('A percentage is at most 100.');
        x.qc[k] = v;
      }
      changes.push('QC recorded');
    }
    if ('outputFolder' in body) x.outputFolder = text(body.outputFolder, 400);
    audit('XENIUM_UPDATED', 'xenium', x.id, `${x.number}: ${changes.join(', ') || 'details updated'}`);
    commit();
    return { ok: true };
  }
  function advanceRun({ params, body }) {
    const x = getRun(params[0]);
    if (!XEN.isActive(x)) fail(`${x.number} is ${XEN.stepLabel(x.status).toLowerCase()}.`);
    const next = XEN.nextStep(x.status);
    const on = body.date || clock.today();
    if (!isDate(on) || on > clock.today()) fail('Enter a date that is not in the future.');
    if (on < (x.steps[x.status]?.on || x.createdOn)) fail(`That is before the previous step (${x.steps[x.status]?.on}).`);
    if (next === 'LOADED' && !x.slides.filter((sl) => sl.sections.length).every((sl) => sl.slideSerial)) fail('Record the Xenium slide serial number of each slide before loading the instrument.');
    x.steps[next] = { on, by: by(), note: text(body.note, 300) };
    x.status = next;
    let moved = [];
    if (next === 'DELIVERED' && body.moveOn !== false) {
      for (const s of runSubjects(x)) {
        if (s.area !== 'SPATL') continue;
        if (move(s, nextAreaAfter(requestOf(s), 'SPATL'), `Xenium run ${x.number} delivered`)) moved.push(s.phl);
      }
    }
    audit('XENIUM_STEP', 'xenium', x.id, `${x.number}: ${XEN.stepLabel(next).toLowerCase()}${moved.length ? `; ${moved.join(', ')} moved on` : ''}`);
    commit();
    return { ok: true, status: next, moved };
  }
  function stepBackRun({ params }) {
    const x = getRun(params[0]);
    if (!XEN.isActive(x)) fail(`${x.number} is ${XEN.stepLabel(x.status).toLowerCase()}; it cannot step back.`);
    if (x.status === 'PLANNED') fail(`${x.number} is at its first step.`);
    const was = x.status;
    delete x.steps[was];
    x.status = XEN.STEPS[XEN.stepIndex(was) - 1][0];
    audit('XENIUM_STEP_BACK', 'xenium', x.id, `${x.number}: back from ${XEN.stepLabel(was).toLowerCase()}`);
    commit();
    return { ok: true, status: x.status };
  }
  function endRun({ params, body }) {
    const x = getRun(params[0]);
    if (!XEN.isActive(x)) fail(`${x.number} is ${XEN.stepLabel(x.status).toLowerCase()}.`);
    const outcome = body.outcome === 'CANCELLED' ? 'CANCELLED' : 'FAILED';
    const reason = text(body.reason, 500);
    if (!reason) fail(`Say why the run ${outcome === 'FAILED' ? 'failed' : 'was cancelled'}.`);
    x.status = outcome; x.failReason = reason; x.steps[outcome] = { on: clock.today(), by: by(), note: reason };
    audit(outcome === 'FAILED' ? 'XENIUM_FAILED' : 'XENIUM_CANCELLED', 'xenium', x.id, `${x.number}: ${reason}. Its sections are back in the queue.`);
    commit();
    return { ok: true };
  }

  // ---------- whole-slide imaging ----------
  // Images are registered from what the scanners write (file headers read in the browser or by the server), matched to
  // PHL numbers by barcode or file name, reviewed (pass, or rescan with a reason), and a pass creates the scan charge.
  const WSI = () => state.wsi;
  const getImage = (id) => WSI().images.find((x) => x.id === Number(id)) || (() => { throw new HttpError(404, 'Slide image not found.'); })();
  const getScanner = (id) => WSI().scanners.find((x) => x.id === id) || null;
  const scannerName = (id) => getScanner(id)?.name || id;
  const SCANNER_STATUS = ['Available', 'In use', 'Maintenance', 'Out of service'];

  // A slide sent for rescanning is settled once a later image of the same block and slide has been registered.
  const openRescans = (subjectId) => WSI().images.filter((r) => r.subjectId === subjectId && r.status === 'RESCAN'
    && !WSI().images.some((y) => y.id > r.id && y.subjectId === subjectId && y.block === r.block && y.slide === r.slide && ['PASSED', 'TO_REVIEW'].includes(y.status)));

  function imageSummary(x) {
    const subject = x.subjectId ? state.subjects.find((s) => s.id === x.subjectId) : null;
    const req = subject ? requestOf(subject) : null;
    return { id: x.id, fileName: x.fileName, format: x.format, scannerId: x.scannerId, scannerName: scannerName(x.scannerId), scannerStated: x.scannerStated,
      subjectId: subject?.id || null, phl: subject?.phl || null, label: subject?.label || '', requestId: req?.id || null, requestNumber: req?.number || null,
      zap: req ? studyOf(req)?.zap || null : null, block: x.block, slide: x.slide, stain: x.stain, mag: x.mag, channels: x.channels.length,
      scannedOn: x.scannedOn, scannedAt: x.scannedAt, status: x.status, reasons: x.qc?.reasons || [], idText: x.idText, idFrom: x.idFrom, sizeBytes: x.sizeBytes };
  }

  function scanQueue() {
    const rows = [];
    for (const r of state.requests.filter((x) => x.status === 'Open' && x.areas.includes('IMAGE'))) {
      const all = subjectsOf(r);
      const waiting = all.filter((s) => s.area === 'IMAGE');
      if (!waiting.length) continue;
      const web = r.webRequestId ? state.ihcRequests.find((w) => w.id === r.webRequestId) : null;
      const units = (code) => r.estimateLines.filter((l) => l.code === code).reduce((n, l) => n + l.units, 0);
      const stains = (web?.stains || []).map((s) => s.snapshot).filter(Boolean);
      const fluorescent = units('HP001009') > 0 || stains.some((a) => IHC.isFluorescent(a));
      const opal = stains.some((a) => a.kind === 'Opal') || (units('HP001009') > 0 && !stains.length);
      const mag = web?.scan?.x40 || units('HP001007') > units('HP001006') ? 40 : 20;
      const scans = units('HP001006') + units('HP001007') + units('HP001009');
      rows.push({
        requestId: r.id, number: r.number, pi: piName(r.pi), type: REQUEST_TYPES[r.type].name, due: r.due, zap: studyOf(r)?.zap || null,
        mag, fluorescent, opal, scanner: WSIX.suggestScanner({ fluorescent, opal, mag }), expectedPer: scans ? Math.max(1, Math.round(scans / all.length)) : null,
        ihcNumber: web?.number || null, stains: stains.map((a) => a.name),
        subjects: waiting.map((s) => {
          const imgs = WSI().images.filter((x) => x.subjectId === s.id);
          const count = (st) => imgs.filter((x) => x.status === st).length;
          return { id: s.id, phl: s.phl, label: s.label, priority: s.priority, since: s.since, passed: count('PASSED'), toReview: count('TO_REVIEW'), rescan: openRescans(s.id).length };
        }),
      });
    }
    return rows.sort((a, b) => (a.due || '').localeCompare(b.due || '') || a.number.localeCompare(b.number));
  }

  function wsiHome() {
    const all = WSI().images;
    return {
      scanners: WSI().scanners.map((s) => ({ ...s, toReview: all.filter((x) => x.scannerId === s.id && x.status === 'TO_REVIEW').length,
        lastScan: all.filter((x) => x.scannerId === s.id).map((x) => `${x.scannedOn} ${x.scannedAt}`).sort().at(-1) || '' })),
      queue: scanQueue(),
      toReview: all.filter((x) => x.status === 'TO_REVIEW').map(imageSummary).sort((a, b) => (a.phl || '').localeCompare(b.phl || '') || a.fileName.localeCompare(b.fileName)),
      unmatched: all.filter((x) => x.status === 'UNMATCHED').map(imageSummary),
      recent: all.filter((x) => x.status === 'PASSED' || x.status === 'RESCAN').slice(-60).reverse().map(imageSummary),
      runs: WSI().runs.slice(-15).reverse(),
    };
  }

  // Files already registered, so a folder can be read again without re-reading every header.
  function wsiKnown() { return { keys: WSI().images.map((x) => x.fileKey) }; }

  function registerImages({ body }) {
    const files = Array.isArray(body.files) ? body.files.slice(0, 2000) : [];
    if (!files.length) fail('Choose slide image files or a scanner folder.');
    const chosen = body.scannerId ? getScanner(text(body.scannerId, 20)) : null;
    if (body.scannerId && !chosen) fail('Unknown scanner.');
    const run = { id: nextId(), source: text(body.source, 20) || 'files', label: text(body.label, 200) || `${files.length} file${files.length === 1 ? '' : 's'}`,
      scannerId: chosen?.id || null, importedAt: clock.now(), importedBy: by(), count: 0, skipped: 0 };
    const out = { imported: 0, matched: 0, unmatched: 0, duplicates: 0, unreadable: 0, results: [] };
    const keys = new Set(WSI().images.map((x) => x.fileKey));
    const names = new Set(WSI().images.filter((x) => x.sizeBytes).map((x) => `${x.fileName.toLowerCase()}|${x.sizeBytes}`));
    for (const f of files) {
      const fileName = text(f.fileName, 200);
      if (!fileName) continue;
      if (f.format === 'UNREADABLE') { out.unreadable++; continue; }
      const path = text(f.path, 600);
      const sizeBytes = Number.isFinite(Number(f.sizeBytes)) ? Math.max(0, Math.round(Number(f.sizeBytes))) : 0;
      const fileKey = `${(path || fileName).toLowerCase()}|${sizeBytes}`;
      // The same file reached by another route (chosen files, a browser folder, the server) is still the same image.
      const nameKey = `${fileName.toLowerCase()}|${sizeBytes}`;
      if (keys.has(fileKey) || (sizeBytes && names.has(nameKey))) { out.duplicates++; continue; }
      keys.add(fileKey); names.add(nameKey);
      // Which scanner: its instrument ID in the file, then the model the file states, then the choice on the page (or
      // the folder's scanner), then a guess from the file type.
      const serial = text(f.serial, 60);
      const bySerial = serial ? WSI().scanners.find((s) => s.serials.some((x) => x.toLowerCase() === serial.toLowerCase())) : null;
      const stated = f.modelStated ? getScanner(f.model) : null;
      const scanner = bySerial || stated || chosen || getScanner(f.model) || getScanner('AT2');
      const conflict = chosen && scanner.id !== chosen.id ? `Read from the ${chosen.name} folder or choice, but the file says ${scanner.name}.` : '';
      const info = { fileName, barcode: text(f.barcode, 80), slideId: text(f.slideId, 80), internalName: text(f.internalName, 120) };
      const phlOf = (id) => subjectByPhl(id.hasLetter ? id.phl : id.digits);
      const id = WSIX.slideIdOf(info, phlOf);
      const subject = id ? phlOf(id) : null;
      const x = {
        id: nextId(), runId: run.id, scannerId: scanner.id, scannerStated: !!(bySerial || stated || chosen),
        format: ['SVS', 'AFI', 'QPTIFF', 'TIFF'].includes(f.format) ? f.format : 'TIFF', fileName, path, sizeBytes, fileKey, ...info,
        idFrom: id?.from || '', idText: text(id?.text, 120), subjectId: subject?.id ?? null, block: text(id?.block, 6), slide: text(id?.slide, 6), stain: text(id?.stain, 40),
        mag: [5, 10, 20, 40, 60].includes(Number(f.mag)) ? Number(f.mag) : null, mpp: Number(f.mpp) > 0 && Number(f.mpp) < 10 ? Math.round(Number(f.mpp) * 10000) / 10000 : null,
        width: Number.isInteger(f.width) ? f.width : null, height: Number.isInteger(f.height) ? f.height : null,
        channels: (Array.isArray(f.channels) ? f.channels : []).slice(0, 20).map((c) => ({ name: text(c.name, 60), biomarker: text(c.biomarker, 60), exposure: text(c.exposure, 20), file: text(c.file, 200) })).filter((c) => c.name),
        scannedOn: isDate(f.scannedOn) ? f.scannedOn : clock.today(), scannedAt: /^\d{2}:\d{2}$/.test(f.scannedAt || '') ? f.scannedAt : '',
        serial, operator: text(f.operator, 60), hasLabel: !!f.hasLabel, hasMacro: !!f.hasMacro,
        warnings: [...(Array.isArray(f.warnings) ? f.warnings : []).slice(0, 5).map((w) => text(w, 200)), ...(conflict ? [conflict] : [])], description: text(f.description, 1200),
        status: subject ? 'TO_REVIEW' : 'UNMATCHED', qc: null, chargeId: null, link: '',
        history: [{ at: clock.now(), by: by(), action: `Registered from ${run.label}` }],
      };
      if (subject) {
        // Work events drive tracking: an image of a slide means the slide was scanned.
        const req = requestOf(subject);
        if (req.areas.includes('IMAGE') && AREA_ORDER.indexOf(subject.area) < AREA_ORDER.indexOf('IMAGE')) move(subject, 'IMAGE', `Slide image registered: ${fileName}`);
      }
      WSI().images.push(x);
      out.imported++; if (subject) out.matched++; else out.unmatched++;
      out.results.push(imageSummary(x));
    }
    run.count = out.imported; run.skipped = out.duplicates;
    WSI().runs.push(run);
    audit('WSI_REGISTERED', 'wsi', run.id, `${run.label}: ${out.imported} images (${out.unmatched} unmatched${out.duplicates ? `, ${out.duplicates} already registered` : ''})`);
    commit();
    return { runId: run.id, ...out };
  }

  function imageDetail({ params }) {
    const x = getImage(params[0]);
    const subject = x.subjectId ? state.subjects.find((s) => s.id === x.subjectId) : null;
    const req = subject ? requestOf(subject) : null;
    const charge = WSIX.scanCharge(x.scannerId, x);
    return {
      image: { ...x, scannerName: scannerName(x.scannerId) }, scanners: WSI().scanners.map((s) => ({ id: s.id, name: s.name })),
      subject: subject ? { id: subject.id, phl: subject.phl, label: subject.label, area: subject.area, groupCode: subject.groupCode } : null,
      request: req ? { id: req.id, number: req.number, piName: piName(req.pi), chargeType: req.chargeType } : null,
      others: subject ? WSI().images.filter((y) => y.subjectId === subject.id && y.id !== x.id).map(imageSummary) : [],
      plannedCharge: { ...charge, description: codeInfo(charge.code)?.description || '' },
      charge: x.chargeId ? chargeView(state.charges.find((c) => c.id === x.chargeId)) : null,
    };
  }

  function assignImage({ params, body }) {
    const x = getImage(params[0]);
    if (!['UNMATCHED', 'TO_REVIEW'].includes(x.status)) fail('Only images not yet reviewed can be assigned.');
    const id = WSIX.parseSlideId(body.phl);
    const subject = id ? subjectByPhl(id.hasLetter ? id.phl : id.digits) : subjectByPhl(body.phl);
    if (!subject) fail(`${text(body.phl, 30) || 'That'} is not a PHL number in the LIMS.`);
    Object.assign(x, { subjectId: subject.id, status: 'TO_REVIEW', block: text(body.block || id?.block || x.block, 6), slide: text(body.slide || id?.slide || x.slide, 6) });
    x.history.push({ at: clock.now(), by: by(), action: `Assigned to ${subject.phl}${x.block ? ` block ${x.block}` : ''}${x.slide ? ` slide ${x.slide}` : ''}` });
    audit('WSI_ASSIGNED', 'request', subject.requestId, `${subject.phl}: ${x.fileName}`);
    commit();
    return imageDetail({ params });
  }

  function setImageScanner({ params, body }) {
    const x = getImage(params[0]);
    if (x.status === 'PASSED') fail('Reopen the image to change its scanner.');
    const s = getScanner(text(body.scannerId, 20));
    if (!s) fail('Choose a scanner.');
    x.history.push({ at: clock.now(), by: by(), action: `Scanner set to ${s.name} (was ${scannerName(x.scannerId)})` });
    x.scannerId = s.id; x.scannerStated = true;
    commit();
    return imageDetail({ params });
  }

  function passImage({ params, body }) {
    const x = getImage(params[0]);
    if (x.status !== 'TO_REVIEW') fail(x.status === 'UNMATCHED' ? 'Assign the image to a PHL number first.' : `This image is ${x.status === 'PASSED' ? 'already passed' : 'marked for rescan'}.`);
    const subject = getSubject(x.subjectId);
    const req = requestOf(subject);
    const { code } = WSIX.scanCharge(x.scannerId, x);
    // Charged on the scan date, unless the scanner's clock puts it before the prices in effect or in the future.
    const date = x.scannedOn >= state.settings.pricingFrom && x.scannedOn <= clock.today() ? x.scannedOn : clock.today();
    const charge = req.chargeType === 'C'
      ? newCharge(req, { section: 'IMAGE', code, date, units: 1, subjectId: subject.id, note: x.fileName }, 'EVENT', { wsiImageId: x.id }) : null;
    Object.assign(x, { status: 'PASSED', chargeId: charge?.id ?? null, qc: { result: 'PASS', reasons: [], note: text(body.note, 500), by: by(), at: clock.now() } });
    x.history.push({ at: clock.now(), by: by(), action: `Passed QC${charge ? `; charge ${code} created` : ''}` });
    audit('WSI_PASSED', 'request', req.id, `${subject.phl}: ${x.fileName}${charge ? `, ${code}` : ''}`);
    commit();
    return imageDetail({ params });
  }

  function rescanImage({ params, body }) {
    const x = getImage(params[0]);
    if (x.status !== 'TO_REVIEW') fail('Only an image waiting for review can be sent for rescanning.');
    const reasons = (Array.isArray(body.reasons) ? body.reasons : []).filter((r) => WSIX.RESCAN_REASONS.includes(r));
    if (!reasons.length) fail('Choose why the slide needs rescanning.');
    if (reasons.includes('Other') && !text(body.note, 500)) fail('Describe the problem.');
    Object.assign(x, { status: 'RESCAN', qc: { result: 'RESCAN', reasons, note: text(body.note, 500), by: by(), at: clock.now() } });
    x.history.push({ at: clock.now(), by: by(), action: `Rescan: ${reasons.join(', ')}${body.note ? ` (${text(body.note, 200)})` : ''}` });
    audit('WSI_RESCAN', 'request', getSubject(x.subjectId).requestId, `${x.fileName}: ${reasons.join(', ')}`);
    commit();
    return imageDetail({ params });
  }

  function reopenImage({ params, body }) {
    const x = getImage(params[0]);
    if (!['PASSED', 'RESCAN'].includes(x.status)) fail('Only reviewed images can be reopened.');
    const reason = text(body.reason, 300);
    if (!reason) fail('Give a reason for reopening the image.');
    const charge = x.chargeId ? state.charges.find((c) => c.id === x.chargeId) : null;
    if (charge?.status === 'RELEASED') fail('Its scan charge has been released for billing. Correct it with an adjustment in the request\'s charges first.');
    if (charge && charge.status !== 'VOID') { charge.status = 'VOID'; charge.voidReason = `Slide image reopened: ${reason}`; }
    Object.assign(x, { status: x.subjectId ? 'TO_REVIEW' : 'UNMATCHED', chargeId: null, qc: null });
    x.history.push({ at: clock.now(), by: by(), action: `Reopened: ${reason}` });
    commit();
    return imageDetail({ params });
  }

  // A link to the image in HALO Link or eSlide Manager, for the pathologist.
  function setImageLink({ params, body }) {
    const x = getImage(params[0]);
    const link = text(body.link, 500);
    if (link && !/^https?:\/\/[^\s]+$/i.test(link)) fail('The link must start with http:// or https://.');
    x.link = link;
    x.history.push({ at: clock.now(), by: by(), action: link ? 'Viewer link set' : 'Viewer link removed' });
    commit();
    return imageDetail({ params });
  }

  function editScanner({ params, body }) {
    const s = getScanner(params[0]);
    if (!s) throw new HttpError(404, 'Scanner not found.');
    if (body.status != null) { if (!SCANNER_STATUS.includes(body.status)) fail('Unknown scanner status.'); s.status = body.status; }
    if (body.folder != null) s.folder = text(body.folder, 400);
    if (body.serials != null) s.serials = (Array.isArray(body.serials) ? body.serials : String(body.serials).split(',')).map((x) => text(x, 60)).filter(Boolean).slice(0, 10);
    if (body.notes != null) s.notes = text(body.notes, 500);
    audit('SCANNER_EDITED', 'wsi', 0, `${s.name}: ${s.status}${s.folder ? `, folder ${s.folder}` : ''}`);
    commit();
    return { scanner: s };
  }

  // Scanning is done for these PHL numbers: they move on to the next work area.
  function completeScanning({ body }) {
    const ids = (Array.isArray(body.subjectIds) ? body.subjectIds : []).map(Number);
    if (!ids.length) fail('Choose PHL numbers.');
    const moved = [];
    for (const id of ids) {
      const s = getSubject(id);
      if (s.area !== 'IMAGE') fail(`${s.phl} is not in scanning.`);
      const imgs = WSI().images.filter((x) => x.subjectId === s.id);
      if (imgs.some((x) => x.status === 'TO_REVIEW')) fail(`${s.phl} has slide images waiting for review.`);
      const rescans = openRescans(s.id);
      if (rescans.length) fail(`${s.phl} has ${rescans.length === 1 ? 'a slide' : `${rescans.length} slides`} waiting to be rescanned (${rescans.map((x) => x.fileName).join(', ')}). Register the new scan, or reopen and pass the old one.`);
      if (!imgs.some((x) => x.status === 'PASSED') && !body.force) fail(`${s.phl} has no passed slide image. Register its images, or confirm that it moves on without one.`);
      const req = requestOf(s);
      const to = nextAreaAfter(req, 'IMAGE');
      move(s, to, body.force && !imgs.some((x) => x.status === 'PASSED') ? `Scanning done without a registered image${body.note ? `: ${text(body.note, 200)}` : ''}` : 'Scanning done');
      moved.push(s.phl);
    }
    audit('WSI_DONE', 'wsi', 0, `Scanning done: ${moved.join(', ')}`);
    commit();
    return { moved };
  }

  // ---------- settings and data ----------
  function putSettings({ body }) {
    if (body.initials != null) {
      const ini = text(body.initials, 4).toUpperCase();
      if (!/^[A-Z]{2,4}$/.test(ini)) fail('Initials are two to four letters.');
      state.settings.initials = ini;
    }
    if (body.pricingFrom != null) {
      if (!isDate(body.pricingFrom)) fail('Enter a valid date.');
      state.settings.pricingFrom = body.pricingFrom;
    }
    if ('estimateEmail' in body) {
      if (body.estimateEmail) {
        const cc = MAIL.parseAddresses(body.estimateEmail.cc);
        if (cc.bad.length) fail(`Not an email address: ${cc.bad.slice(0, 3).join(', ')}`);
        state.settings.estimateEmail = { cc: cc.addresses.join('; '), signOff: MAIL.cut(MAIL.wellFormed(body.estimateEmail.signOff).trim(), MAIL.MAX_SIGNOFF) };
      } else delete state.settings.estimateEmail;
    }
    if (body.instrumentFolders) {
      state.settings.instrumentFolders = { chemistry: text(body.instrumentFolders.chemistry, 400), hematology: text(body.instrumentFolders.hematology, 400) };
    }
    commit();
    return { settings: state.settings };
  }

  function exportAll() {
    return { __file: { name: `mhl-lims-pilot-backup-${clock.today()}.json`, type: 'application/json', content: JSON.stringify(state, null, 2) } };
  }

  function reset() {
    if (!reseed) fail('Reset is not available.');
    const keep = state.settings.initials;
    const fresh = reseed();
    for (const k of Object.keys(state)) delete state[k];
    Object.assign(state, fresh);
    state.settings.initials = keep;
    commit();
    return { ok: true };
  }

  const routes = [
    ['GET', /^\/api\/meta$/, meta],
    ['GET', /^\/api\/search$/, search],
    ['GET', /^\/api\/requests$/, listRequests],
    ['GET', /^\/api\/requests\/(\d+)$/, requestDetail],
    ['POST', /^\/api\/requests$/, createRequest],
    ['GET', /^\/api\/requests\/next-number$/, peekRequestNumber],
    ['GET', /^\/api\/requests\/check-number$/, checkRequestNumber],
    ['GET', /^\/api\/requests\/(\d+)\/tracking-sheet$/, trackingSheet],
    ['POST', /^\/api\/requests\/(\d+)\/move$/, moveSubjects],
    ['POST', /^\/api\/requests\/(\d+)\/complete$/, completeRequest],
    ['POST', /^\/api\/requests\/(\d+)\/charges$/, addCharge],
    ['POST', /^\/api\/requests\/(\d+)\/approve-pending$/, approvePending],
    ['POST', /^\/api\/requests\/(\d+)\/review$/, review],
    ['PATCH', /^\/api\/charges\/(\d+)$/, editCharge],
    ['POST', /^\/api\/charges\/(\d+)\/approve$/, approveCharge],
    ['POST', /^\/api\/charges\/(\d+)\/return$/, returnCharge],
    ['POST', /^\/api\/charges\/(\d+)\/void$/, voidCharge],
    ['POST', /^\/api\/charges\/(\d+)\/adjust$/, adjustCharge],
    ['GET', /^\/api\/nas$/, listNas],
    ['POST', /^\/api\/nas$/, addNas],
    ['GET', /^\/api\/price-list$/, getPriceList],
    ['GET', /^\/api\/billing\/queue$/, billingQueue],
    ['GET', /^\/api\/billing\/preview$/, billingPreview],
    ['GET', /^\/api\/billing\/batches$/, listBatches],
    ['POST', /^\/api\/billing\/batches$/, releaseBatch],
    ['GET', /^\/api\/billing\/batches\/(\d+)\/file$/, batchFile],
    ['GET', /^\/api\/studies$/, listStudies],
    ['POST', /^\/api\/studies$/, createStudy],
    ['GET', /^\/api\/studies\/(\d+)$/, studyDetail],
    ['PATCH', /^\/api\/studies\/(\d+)$/, editStudy],
    ['PUT', /^\/api\/studies\/(\d+)\/groups$/, setGroups],
    ['GET', /^\/api\/studies\/(\d+)\/export\.csv$/, studyCsv],
    ['PATCH', /^\/api\/subjects\/(\d+)$/, editSubject],
    ['GET', /^\/api\/necropsy\/worklist$/, necropsyWorklist],
    ['GET', /^\/api\/necropsy\/(\d+)$/, getNecropsy],
    ['PUT', /^\/api\/necropsy\/(\d+)$/, saveNecropsy],
    ['POST', /^\/api\/necropsy\/(\d+)\/approve$/, approveNecropsy],
    ['POST', /^\/api\/necropsy\/(\d+)\/unapprove$/, unapproveNecropsy],
    ['GET', /^\/api\/pathology\/worklist$/, pathologyWorklist],
    ['POST', /^\/api\/pathology\/assign$/, assignPathologist],
    ['GET', /^\/api\/pathology\/(\d+)$/, getCase],
    ['PUT', /^\/api\/pathology\/(\d+)$/, saveCase],
    ['POST', /^\/api\/pathology\/(\d+)\/signout$/, signOutCase],
    ['POST', /^\/api\/pathology\/(\d+)\/amend$/, amendCase],
    ['GET', /^\/api\/reports\/(\d+)$/, animalReport],
    ['GET', /^\/api\/studies\/(\d+)\/pathology$/, studyPathology],
    ['GET', /^\/api\/studies\/(\d+)\/report\/necropsy$/, studyNecropsyReport],
    ['GET', /^\/api\/studies\/(\d+)\/report\/pathology$/, studyPathologyReport],
    ['PUT', /^\/api\/studies\/(\d+)\/report-notes$/, saveReportNotes],
    ['GET', /^\/api\/studies\/(\d+)\/pathology\.csv$/, ({ params }) => { const s = getStudy(params[0]); return pathologyCsv(state.subjects.filter((x) => x.studyId === s.id).sort((a, b) => a.phl.localeCompare(b.phl)), `${s.zap}-pathology.csv`); }],
    ['GET', /^\/api\/requests\/(\d+)\/pathology$/, requestPathology],
    ['GET', /^\/api\/requests\/(\d+)\/pathology\.csv$/, ({ params }) => { const r = getRequest(params[0]); return pathologyCsv(subjectsOf(r), `${r.number}-pathology.csv`); }],
    ['POST', /^\/api\/requests\/(\d+)\/add-pathology$/, addPathologyArea],
    ['GET', /^\/api\/ihc\/assays$/, listAssays],
    ['POST', /^\/api\/ihc\/assays$/, addAssay],
    ['GET', /^\/api\/ihc\/assays\/(\d+)$/, assayDetail],
    ['PATCH', /^\/api\/ihc\/assays\/(\d+)$/, editAssay],
    ['POST', /^\/api\/ihc\/assays\/(\d+)\/check$/, confirmAssay],
    ['POST', /^\/api\/ihc\/assays\/(\d+)\/retire$/, setAssayStatus('Retired')],
    ['POST', /^\/api\/ihc\/assays\/(\d+)\/restore$/, setAssayStatus('Active')],
    ['GET', /^\/api\/ihc\/requests$/, listIhc],
    ['POST', /^\/api\/ihc\/requests$/, submitIhc],
    ['POST', /^\/api\/ihc\/estimate$/, estimateDraft],
    ['GET', /^\/api\/ihc\/requests\/(\d+)$/, ihcDetail],
    ['POST', /^\/api\/ihc\/requests\/assign$/, assignIhc],
    ['POST', /^\/api\/ihc\/requests\/(\d+)\/work$/, ihcWork],
    ['GET', /^\/api\/xenium$/, listXenium],
    ['POST', /^\/api\/xenium\/runs$/, createRun],
    ['GET', /^\/api\/xenium\/runs\/(\d+)$/, runDetail],
    ['PATCH', /^\/api\/xenium\/runs\/(\d+)$/, updateRun],
    ['POST', /^\/api\/xenium\/runs\/(\d+)\/advance$/, advanceRun],
    ['POST', /^\/api\/xenium\/runs\/(\d+)\/back$/, stepBackRun],
    ['POST', /^\/api\/xenium\/runs\/(\d+)\/end$/, endRun],
    ['POST', /^\/api\/ihc\/requests\/(\d+)\/accept$/, acceptIhc],
    ['POST', /^\/api\/ihc\/requests\/(\d+)\/decline$/, declineIhc],
    ['GET', /^\/api\/requests\/(\d+)\/ihc$/, ihcWorksheet],
    ['GET', /^\/api\/requests\/(\d+)\/necropsy$/, requestNecropsy],
    ['POST', /^\/api\/requests\/(\d+)\/nas$/, linkNas],
    ['POST', /^\/api\/nas\/(\d+)\/close$/, closeNas],
    ['GET', /^\/api\/nas\/(\d+)$/, getNas],
    ['GET', /^\/api\/library$/, getLibrary],
    ['GET', /^\/api\/library\/export\.csv$/, libraryCsv],
    ['POST', /^\/api\/library\/send-ct$/, importSendCt],
    ['GET', /^\/api\/library\/send-search$/, searchSendCt],
    ['POST', /^\/api\/library\/diagnoses$/, saveDiagnosis],
    ['POST', /^\/api\/library\/organs$/, saveOrgan],
    ['GET', /^\/api\/studies\/(\d+)\/send-mi\.csv$/, studySendMi],
    ['GET', /^\/api\/protocols$/, listProtocols],
    ['POST', /^\/api\/protocols\/import$/, importProtocols],
    ['GET', /^\/api\/protocols\/(necropsy|trim)\/(\d+)$/, protocolDetail],
    ['PUT', /^\/api\/protocols\/(necropsy|trim)\/(\d+)$/, editProtocol],
    ['POST', /^\/api\/protocols\/(necropsy|trim)$/, createProtocol],
    ['POST', /^\/api\/protocols\/(necropsy|trim)\/(\d+)\/approve$/, setProtocolFlag('approve')],
    ['POST', /^\/api\/protocols\/(necropsy|trim)\/(\d+)\/obsolete$/, setProtocolFlag('obsolete')],
    ['POST', /^\/api\/protocols\/(necropsy|trim)\/(\d+)\/restore$/, setProtocolFlag('restore')],
    ['GET', /^\/api\/bloodwork$/, bloodworkHome],
    ['POST', /^\/api\/bloodwork\/import$/, importBloodwork],
    ['GET', /^\/api\/bloodwork\/results\/(\d+)$/, bloodworkResult],
    ['POST', /^\/api\/bloodwork\/results\/(\d+)\/assign$/, assignResult],
    ['POST', /^\/api\/bloodwork\/results\/(\d+)\/release$/, releaseResult],
    ['POST', /^\/api\/bloodwork\/results\/(\d+)\/reject$/, rejectResult],
    ['POST', /^\/api\/bloodwork\/results\/(\d+)\/instrument$/, setInstrument],
    ['POST', /^\/api\/bloodwork\/results\/(\d+)\/reopen$/, reopenResult],
    ['GET', /^\/api\/bloodwork\/ranges$/, getRanges],
    ['PUT', /^\/api\/bloodwork\/ranges$/, putRanges],
    ['POST', /^\/api\/bloodwork\/cytology$/, createCytology],
    ['GET', /^\/api\/bloodwork\/cytology\/(\d+)$/, cytologyDetail],
    ['PUT', /^\/api\/bloodwork\/cytology\/(\d+)$/, saveCytology],
    ['POST', /^\/api\/bloodwork\/cytology\/(\d+)\/sign$/, signCytology],
    ['POST', /^\/api\/bloodwork\/cytology\/(\d+)\/amend$/, amendCytology],
    ['GET', /^\/api\/subjects\/(\d+)\/bloodwork$/, subjectBloodwork],
    ['GET', /^\/api\/studies\/(\d+)\/bloodwork$/, studyBloodwork],
    ['GET', /^\/api\/studies\/(\d+)\/bloodwork\.csv$/, studyBloodworkCsv],
    ['POST', /^\/api\/requests\/ihc-estimate$/, estimateRequestIhc],
    ['GET', /^\/api\/wsi$/, wsiHome],
    ['GET', /^\/api\/wsi\/known$/, wsiKnown],
    ['POST', /^\/api\/wsi\/register$/, registerImages],
    ['POST', /^\/api\/wsi\/complete$/, completeScanning],
    ['PUT', /^\/api\/wsi\/scanners\/([A-Z0-9]+)$/, editScanner],
    ['GET', /^\/api\/wsi\/images\/(\d+)$/, imageDetail],
    ['POST', /^\/api\/wsi\/images\/(\d+)\/assign$/, assignImage],
    ['POST', /^\/api\/wsi\/images\/(\d+)\/scanner$/, setImageScanner],
    ['POST', /^\/api\/wsi\/images\/(\d+)\/pass$/, passImage],
    ['POST', /^\/api\/wsi\/images\/(\d+)\/rescan$/, rescanImage],
    ['POST', /^\/api\/wsi\/images\/(\d+)\/reopen$/, reopenImage],
    ['POST', /^\/api\/wsi\/images\/(\d+)\/link$/, setImageLink],
    ['PUT', /^\/api\/settings$/, putSettings],
    ['GET', /^\/api\/estimates$/, listEstimates],
    ['POST', /^\/api\/estimates$/, createEstimate],
    ['GET', /^\/api\/estimates\/(\d+)$/, estimateDetail],
    ['PUT', /^\/api\/estimates\/(\d+)$/, saveEstimate],
    ['POST', /^\/api\/estimates\/(\d+)\/send$/, sendEstimate],
    ['GET', /^\/api\/estimates\/(\d+)\/email$/, estimateEmailForm],
    ['POST', /^\/api\/estimates\/(\d+)\/email$/, emailEstimate],
    ['POST', /^\/api\/estimates\/(\d+)\/accept$/, acceptEstimate],
    ['POST', /^\/api\/estimates\/(\d+)\/decline$/, declineEstimate],
    ['POST', /^\/api\/estimates\/(\d+)\/revise$/, reviseEstimate],
    ['POST', /^\/api\/estimates\/(\d+)\/copy$/, copyEstimate],
    ['POST', /^\/api\/estimates\/(\d+)\/discard$/, discardEstimate],
    ['POST', /^\/api\/estimates\/(\d+)\/nas$/, linkEstimateNas],
    ['GET', /^\/api\/estimates\/(\d+)\/csv$/, estimateCsv],
    ['GET', /^\/api\/export$/, exportAll],
    ['POST', /^\/api\/reset$/, reset],
  ];

  // Returns { status, json } or { status, file: { name, type, content } }.
  // A failed change rolls the state back, so a request either happens completely or not at all.
  function handle(method, path, query = {}, body = null) {
    const snapshot = method === 'GET' ? null : structuredClone(state);
    const rollback = () => {
      if (!snapshot) return;
      for (const k of Object.keys(state)) delete state[k];
      Object.assign(state, snapshot);
    };
    try {
      for (const [m, re, fn] of routes) {
        if (m !== method) continue;
        const match = path.match(re);
        if (!match) continue;
        const result = fn({ params: match.slice(1), query, body: body || {} });
        if (result && result.__file) return { status: 200, file: result.__file };
        return { status: 200, json: result };
      }
      return { status: 404, json: { error: 'No such endpoint.' } };
    } catch (e) {
      rollback();
      if (e instanceof R.DomainError) return { status: 400, json: { error: e.message } };
      if (e instanceof HttpError) return { status: e.status, json: { error: e.message } };
      return { status: 500, json: { error: `Unexpected error: ${e.message}` } };
    }
  }

  return { handle, state, findingText };
}
