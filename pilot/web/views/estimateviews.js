// The Estimates tab: cost estimates for possible new projects, made before the investigator submits a NAS request.
// A draft is edited here and saved as it changes; it is priced in the browser with the same code the core uses.
// Sent estimates are read-only: accept, decline, revise (a new revision), copy, or link an accepted one to NAS.
import { $, $$, api, esc, money, fmtDate, fmtDateTime, getMeta, getPriceList, sectionName, act, pageTop, options, toast, navigate, download, saveFile, kindBadge } from '../ui.js';
import * as ESTX from '../lib/estimates.mjs';
import * as MAIL from '../lib/estimatemail.mjs';
import { amount, sumMoney } from '../lib/rules.mjs';

const MONEY = { amount, sumMoney };
const LAB = 'Molecular Histopathology Laboratory (MHL)';
const LAB2 = 'Laboratory Animal Sciences Program, NCI at Frederick';
const FIXATIVES = [['10%NBF', '10% neutral buffered formalin'], ['4%PFA', '4% paraformaldehyde'], ['FRESH', 'Fresh or unfixed'], ['OTHER', 'Other']];
const BADGE = { DRAFT: 'warn', SENT: 'info', ACCEPTED: 'complete', DECLINED: 'muted', EXPIRED: 'muted', SUPERSEDED: 'muted', DISCARDED: 'muted' };
const FILTERS = [['OPEN', 'Open'], ['DRAFT', 'Draft'], ['SENT', 'Sent'], ['ACCEPTED', 'Accepted'], ['DECLINED', 'Declined'], ['EXPIRED', 'Expired'], ['DISCARDED', 'Discarded'], ['ALL', 'All']];
const IHC_SPECIES = { MOUSE: 'Mouse', RAT: 'Rat', HUMAN: 'Human', PDX: 'PDX', ORGANOID: 'Organoid' };
const IHC_FIXATIVE = { '10%NBF': '10% NBF', '4%PFA': '4% PFA', FRESH: 'Fresh frozen (OCT)' };
const badge = (d) => `<span class="badge ${BADGE[d] || ''}">${esc(ESTX.STATUS_LABEL[d] || d)}</span>`;
const piName = (p) => [p.last, p.first].filter(Boolean).join(', ');
const r2 = (x) => Math.round(x * 100) / 100;
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// ---------- list ----------
const listState = { status: 'OPEN', q: '' };

export async function renderEstimates(app, params) {
  const want = (params.get('status') || '').toUpperCase();
  if (FILTERS.some(([k]) => k === want)) listState.status = want;
  const [meta, pl] = await Promise.all([getMeta(), getPriceList()]);
  app.innerHTML = `
    <div class="head"><h1>Estimates</h1></div>
    <p class="muted" style="max-width:860px">Cost estimates for possible new projects, priced from the ${esc(pl.name)} price list before the investigator submits a NAS request.
      Send one, record whether it was accepted, then link it to the investigator's NAS request; New request starts from its lines.</p>
    <div class="split wide-left">
      <div>
        <div class="toolbar"><input id="q" value="${esc(listState.q)}" placeholder="Estimate number, investigator, institute or project" aria-label="Search estimates" autocomplete="off"></div>
        <div class="filters" role="group" aria-label="Status" id="efilters"></div>
        <div id="elist" aria-live="polite"></div>
      </div>
      <div>
        <div class="panel">
          <h2>New estimate</h2>
          <form class="form" id="newest" style="grid-template-columns:1fr 1fr">
            <div class="field"><label for="nlast">Investigator last name</label><input id="nlast" maxlength="100" required></div>
            <div class="field"><label for="nfirst">First name</label><input id="nfirst" maxlength="100"></div>
            <div class="field full"><label for="ninst">Institute, branch or lab</label><input id="ninst" maxlength="200" placeholder="e.g. NCI/CCR, Mouse Cancer Genetics"></div>
            <div class="field full"><label for="ntitle">Project title</label><input id="ntitle" maxlength="200" required></div>
            <div class="field"><label for="nspecies">Species</label><select id="nspecies">${options(Object.entries(meta.species).map(([k, v]) => [k, v.name]), 'MOUSE')}</select></div>
            <div class="field"><label for="ntype">Kind of work</label><select id="ntype">${options(Object.entries(meta.requestTypes).map(([k, v]) => [k, v.name]), '', { blank: 'Decide later' })}</select></div>
            <div class="field"><label for="nn">Animals or samples</label><input id="nn" type="number" min="1" max="500" placeholder="optional"></div>
            <div class="full"><button class="btn" type="submit">Start the estimate</button></div>
          </form>
          <p class="small muted">Choosing the kind of work and the number of animals fills in the usual lines, as New request does; you can change everything afterwards. To start from an earlier estimate, open it and choose <strong>Copy</strong>.</p>
        </div>
      </div>
    </div>`;
  pageTop(app);
  const draw = async () => {
    const res = await api('GET', `/api/estimates?status=${listState.status}&q=${encodeURIComponent(listState.q)}`);
    const c = res.counts; const open = (c.DRAFT || 0) + (c.SENT || 0);
    $('#efilters').innerHTML = FILTERS.map(([k, label]) => {
      const n = k === 'OPEN' ? open : k === 'ALL' ? null : c[k] || 0;
      return `<button type="button" data-st="${k}" aria-pressed="${k === listState.status}">${esc(label)}${n != null ? ` ${n}` : ''}</button>`;
    }).join('');
    $$('[data-st]').forEach((b) => b.addEventListener('click', () => { listState.status = b.dataset.st; draw(); }));
    $('#elist').innerHTML = res.estimates.length ? `<div class="scroll-x"><table class="t">
      <thead><tr><th>Estimate</th><th>Investigator</th><th>Project</th><th class="n">Total</th><th>Status</th><th>NAS</th></tr></thead>
      <tbody>${res.estimates.map((e) => `<tr>
        <td style="white-space:nowrap"><a class="idtxt" href="#/estimates/${e.id}">${esc(e.label)}</a><br><span class="small muted">${fmtDate(e.createdOn)}, ${esc(e.createdBy)}</span></td>
        <td>${esc(e.investigator)}<br><span class="small muted">${esc(e.inst)}</span></td>
        <td>${esc(clip(e.title, 70))}</td>
        <td class="n">${money(e.total)}${e.optionalTotal ? `<br><span class="small muted">+ ${money(e.optionalTotal)} optional</span>` : ''}</td>
        <td>${badge(e.display)}<br><span class="small muted">${e.display === 'SENT' ? `valid until ${fmtDate(e.validUntil)}` : e.display === 'EXPIRED' ? `expired ${fmtDate(e.validUntil)}` : e.sentOn ? `sent ${fmtDate(e.sentOn)}` : 'not sent'}</span></td>
        <td style="white-space:nowrap">${e.nasNumber ? `NAS# ${esc(e.nasNumber)}${e.requestNumber ? `<br><span class="small muted">request ${esc(e.requestNumber)}</span>` : ''}` : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<p class="empty">${listState.q ? `No estimate matches “${esc(listState.q)}”.` : 'No estimates here.'}</p>`;
  };
  let t = null;
  $('#q').addEventListener('input', (e) => { listState.q = e.target.value.trim(); clearTimeout(t); t = setTimeout(draw, 150); });
  $('#newest').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const type = $('#ntype').value; const n = $('#nn').value ? Number($('#nn').value) : null;
      const def = meta.requestTypes[type];
      const lines = def && n ? ESTX.planLines(def, n, null, pl.items) : [];
      const res = await api('POST', '/api/estimates', {
        investigator: { last: $('#nlast').value, first: $('#nfirst').value, inst: $('#ninst').value }, title: $('#ntitle').value, species: $('#nspecies').value,
        type, n, phases: [{ name: def ? def.name : 'Phase 1', lines }],
      });
      navigate(`#/estimates/${res.id}`);
      return res;
    }, (r) => `Estimate ${r.number} started`);
  });
  await draw();
}

// ---------- lines, read-only (view and print) ----------
function linesTable(meta, p, { print = false } = {}) {
  const many = p.phases.length > 1;
  const row = (l) => `<tr${l.optional ? ' class="dim"' : ''}><td class="code">${l.code ? esc(l.code) : '<span class="small">not on list</span>'}${l.custom ? ' †' : l.priceByHand ? ' ‡' : ''}</td>
    <td>${esc(l.description)}${l.note ? `<br><span class="small muted">${esc(l.note)}</span>` : ''}</td>
    <td class="n">${l.units}${l.custom && l.unit ? `<span class="small muted"> ${esc(l.unit)}</span>` : ''}</td><td class="n">${l.custom && l.unitPrice === 0 ? 'to be confirmed' : money(l.unitPrice)}</td><td class="n">${l.custom && l.unitPrice === 0 ? '' : money(l.amount)}</td></tr>`;
  const counted = p.phases.map((ph) => ({ ...ph, lines: ph.lines.filter((l) => !l.optional) }));
  const optional = p.phases.flatMap((ph) => ph.lines.filter((l) => l.optional).map((l) => ({ ...l, phase: ph.name })));
  return `
    <table class="t est-read ${print ? 'rep-t' : ''}">
      <thead><tr><th>Code</th><th>Description</th><th class="n">Units</th><th class="n">Unit price</th><th class="n">Amount</th></tr></thead>
      <tbody>${counted.map((ph) => `${many ? `<tr class="sec"><td colspan="5">${esc(ph.name)}</td></tr>` : ''}${ph.lines.map(row).join('')}
        ${many ? `<tr class="est-sub"><td colspan="4">${esc(ph.name)} subtotal</td><td class="n">${money(ph.subtotal)}</td></tr>` : ''}`).join('')}
        <tr class="total"><td colspan="4">Total estimate</td><td class="n">${money(p.total)}</td></tr>
        ${optional.length ? `<tr class="est-gap"><td colspan="5"></td></tr><tr class="sec"><td colspan="5">Optional, not included in the total</td></tr>
          ${optional.map((l) => row({ ...l, optional: false, note: [many ? l.phase : '', l.note].filter(Boolean).join(' · ') })).join('')}
          <tr class="est-sub"><td colspan="4">Optional lines</td><td class="n">${money(p.optionalTotal)}</td></tr>` : ''}</tbody>
    </table>
    ${p.custom || p.byHand ? `<p class="small muted">${p.custom ? '† Not on the price list; priced by MHL for this estimate. ' : ''}${p.byHand ? '‡ On the price list without a price; priced by MHL for this estimate.' : ''}</p>` : ''}`;
}

function sectionSummary(meta, p) {
  return `<table class="t"><tbody>${p.bySection.map((s) => `<tr><td>${esc(sectionName(meta, s.section))}</td><td class="n">${money(s.amount)}</td></tr>`).join('')}</tbody></table>`;
}

// ---------- one estimate ----------
export async function renderEstimate(app, id) {
  const [meta, pl, d] = await Promise.all([getMeta(), getPriceList(), api('GET', `/api/estimates/${id}`)]);
  return d.estimate.status === 'DRAFT' ? editor(app, meta, pl, d) : viewer(app, meta, d);
}

function topHtml(d) {
  return `<div class="crumb"><a href="#/estimates">Estimates</a></div>
    <div class="head"><h1>${esc(d.label)}</h1>${badge(d.display)}</div>
    <p class="muted" style="margin-top:2px">${esc(piName(d.estimate.investigator))}${d.estimate.investigator.inst ? `, ${esc(d.estimate.investigator.inst)}` : ''}: ${esc(d.estimate.title)}</p>`;
}

function revisionsHtml(d) {
  if (d.revisions.length < 2 && !d.copiedFrom) return '';
  return `<h3 class="section">Revisions</h3>
    ${d.revisions.length > 1 ? `<table class="t"><tbody>${d.revisions.map((r) => `<tr><td>${r.id === d.estimate.id ? `<strong>${esc(r.label)}</strong>` : `<a href="#/estimates/${r.id}">${esc(r.label)}</a>`}</td>
      <td>${badge(r.display)}</td><td class="small muted">${r.sentOn ? `sent ${fmtDate(r.sentOn)}` : ''}</td><td class="n">${money(r.total)}</td></tr>`).join('')}</tbody></table>` : ''}
    ${d.copiedFrom ? `<p class="small muted">Copied from <a href="#/estimates/${d.copiedFrom.id}">${esc(d.copiedFrom.label)}</a>.</p>` : ''}`;
}

const ACTION = { ESTIMATE_CREATED: 'Started', ESTIMATE_SENT: 'Sent', ESTIMATE_ACCEPTED: 'Accepted', ESTIMATE_DECLINED: 'Declined', ESTIMATE_REVISED: 'Revised',
  ESTIMATE_DISCARDED: 'Discarded', ESTIMATE_LINKED: 'Linked to NAS', ESTIMATE_EMAILED: 'Emailed' };
function historyHtml(d) {
  return d.history.length ? `<h3 class="section">History</h3><table class="t"><tbody>${d.history.slice().reverse().map((a) => `<tr><td class="small">${fmtDateTime(a.at)}<br>${esc(a.by)}</td>
    <td class="small"><strong>${esc(ACTION[a.action] || a.action)}</strong><br>${esc(a.detail)}</td></tr>`).join('')}</tbody></table>` : '';
}

// ---------- read-only: sent, accepted, declined, expired, revised, discarded ----------
function viewer(app, meta, d) {
  const e = d.estimate; const p = d.priced; const ds = d.display;
  const facts = [
    e.sentOn && ['Sent', `${fmtDate(e.sentOn)} by ${esc(e.sentBy)}`],
    e.validUntil && [ds === 'EXPIRED' ? 'Expired' : 'Valid until', fmtDate(e.validUntil)],
    e.decidedOn && [e.status === 'DECLINED' || e.statusBeforeRevision === 'DECLINED' ? 'Declined' : 'Accepted', `${fmtDate(e.decidedOn)} by ${esc(e.decidedBy)}`],
    e.declineReason && ['Reason', esc(e.declineReason)],
    ['Prices', `${esc(e.priceListName)} price list`],
    ['Kind of work', e.type ? `${esc(meta.requestTypes[e.type]?.name || e.type)}${e.n ? `, ${e.n} animals or samples` : ''}` : 'Not set'],
    ['Species', esc(meta.species[e.species]?.name || 'Not set')],
    e.investigator.email && ['Email', esc(e.investigator.email)],
    (e.emails || []).length && ['Emailed', e.emails.slice(-3).reverse().map((m) => `${fmtDate(m.at.slice(0, 10))} to ${esc(m.to.join(', '))}${m.kind === 'review' ? ' (draft for review)' : m.kind === 'copy' ? ' (copy)' : ''}`).join('<br>')],
  ].filter(Boolean);
  const supersededBy = e.supersededBy ? d.revisions.find((r) => r.id === e.supersededBy) : null;
  const canRevise = d.latest && ['SENT', 'ACCEPTED', 'DECLINED'].includes(e.status) && !e.nasId;
  app.innerHTML = `
    ${topHtml(d)}
    ${ds === 'EXPIRED' ? `<p class="note">This estimate expired on ${fmtDate(e.validUntil)}. Revise it to check the prices again and send the revision, or record that it was declined.</p>` : ''}
    ${supersededBy ? `<p class="note info">Replaced by <a href="#/estimates/${supersededBy.id}">${esc(supersededBy.label)}</a>.</p>` : ''}
    ${e.status === 'DISCARDED' ? '<p class="note">This draft was discarded and was never sent.</p>' : ''}
    <div class="actions noprint">
      ${ds === 'SENT' ? '<button class="btn" type="button" id="accept">The investigator accepted it</button>' : ''}
      ${e.status === 'SENT' ? '<button class="btn quiet" type="button" id="decline">Declined…</button>' : ''}
      ${canRevise ? '<button class="btn quiet" type="button" id="revise">Revise</button>' : ''}
      ${d.latest && (ds === 'SENT' || e.status === 'ACCEPTED') ? `<a class="btn quiet" href="#/estimates/${e.id}/email">${e.status === 'ACCEPTED' ? 'Email a copy' : (e.emails || []).length ? 'Email again' : 'Email'}</a>` : ''}
      <a class="btn quiet" href="#/estimates/${e.id}/print">Print</a>
      <button class="btn quiet" type="button" id="csv">Download CSV</button>
      <button class="btn quiet" type="button" id="copy">Copy as a new estimate</button>
    </div>
    <form id="declineform" class="panel section" hidden style="max-width:620px">
      <div class="field"><label for="reason">Why was it declined?</label><textarea id="reason" maxlength="500" required placeholder="e.g. The project was not funded; the investigator chose another lab"></textarea></div>
      <div class="actions"><button class="btn" type="submit">Record as declined</button><button class="btn quiet" type="button" id="nodecline">Cancel</button></div>
    </form>
    ${nasPanel(meta, d)}
    <div class="split wide-left section">
      <div>
        ${e.description ? `<p style="max-width:760px">${esc(e.description)}</p>` : ''}
        ${linesTable(meta, p)}
        ${e.assumptions.length ? `<h3 class="section">Assumptions</h3><ul class="assume">${e.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
      </div>
      <div>
        <div class="calc-big"><span class="muted">Total estimate</span><b>${money(p.total)}</b>${p.optionalTotal ? `<span class="muted">+ ${money(p.optionalTotal)} in optional lines</span>` : ''}</div>
        <dl class="dl">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>
        <h3 class="section">By section</h3>${sectionSummary(meta, p)}
        ${revisionsHtml(d)}
        ${historyHtml(d)}
      </div>
    </div>`;
  pageTop(app);
  const go = (path, msg) => (ev) => act(ev.currentTarget, async () => { const r = await api('POST', `/api/estimates/${e.id}/${path}`, {}); navigate(`#/estimates/${r.id || e.id}`); return r; }, msg);
  $('#accept')?.addEventListener('click', go('accept', `${d.label} accepted. Link it to the NAS request when the investigator submits one.`));
  $('#revise')?.addEventListener('click', go('revise', 'A new revision has been started; prices come from the price list again'));
  $('#copy').addEventListener('click', go('copy', 'Copied as a new estimate'));
  $('#csv').addEventListener('click', (ev) => act(ev.currentTarget, () => download(`/api/estimates/${e.id}/csv`), (f) => `Downloaded ${f.name}`));
  $('#decline')?.addEventListener('click', () => { $('#declineform').hidden = false; $('#reason').focus(); });
  $('#nodecline')?.addEventListener('click', () => { $('#declineform').hidden = true; });
  $('#declineform').addEventListener('submit', (ev) => {
    ev.preventDefault();
    act(ev.submitter, async () => { await api('POST', `/api/estimates/${e.id}/decline`, { reason: $('#reason').value }); navigate(`#/estimates/${e.id}`); }, `${d.label} recorded as declined`);
  });
  bindNasPanel(d);
}

// An accepted estimate: link it to the investigator's NAS request, or (pilot only) make the NAS request from it.
function nasPanel(meta, d) {
  const e = d.estimate;
  if (d.nas) {
    return `<p class="note ok">Linked to NAS# <strong>${esc(d.nas.number)}</strong> (${money(d.nas.authorized)} authorized).
      ${d.nas.requests.length ? `${d.nas.requests.length === 1 ? 'Request' : 'Requests'} made from it: ${d.nas.requests.map((r) => `<a href="#/request/${r.id}">${esc(r.number)}</a>${r.estimatePhase ? ` (${esc(r.estimatePhase)})` : ''}`).join(', ')}. ` : ''}
      ${d.nas.closed ? 'The NAS request is closed.' : d.nas.scopeFromEstimate ? `Under <a href="#/new">New request</a>, choosing that NAS request starts ${d.nas.requests.length ? 'another request' : 'the estimate'} from these lines${e.phases.length > 1 ? ' (one phase at a time if you like)' : ''}.`
        : 'That NAS request came with its own scope, so New request starts from its scope rather than from these lines.'}</p>`;
  }
  if (e.status !== 'ACCEPTED') return '';
  const many = e.phases.length > 1;
  const sorted = [...d.openNas].sort((a, b) => Number(b.suggested) - Number(a.suggested));
  return `
    <form class="panel section noprint" id="nasform" style="max-width:860px">
      <h2>Link to the NAS request</h2>
      <p class="small muted">The investigator submits a NAS request quoting this estimate. Linking it gives the NAS request this estimate's price list lines, and New request starts from them
        (unless the NAS request came with its own scope). Optional lines, lines not on the price list and codes priced by hand are left out; New request lists them.</p>
      ${many ? `<div class="field"><span class="lbl">Phases this NAS request covers</span><div class="checks">${e.phases.map((ph, i) => `<label><input type="checkbox" name="ph" value="${i}" checked> ${esc(ph.name)} (${money(d.priced.phases[i].subtotal)})</label>`).join('')}</div></div>` : ''}
      <div class="checks" style="flex-direction:column;align-items:flex-start;gap:6px;margin-top:8px">
        <label><input type="radio" name="nasmode" value="link" ${sorted.length ? 'checked' : 'disabled'}> A NAS request already received</label>
        <label><input type="radio" name="nasmode" value="create" ${sorted.length ? '' : 'checked'}> Make the NAS request here (pilot only; in production NAS requests come from the NAS site)</label>
      </div>
      <div id="naslink" class="field" style="max-width:520px;margin-top:8px">
        <label for="nasid">NAS request</label>
        <select id="nasid">${sorted.length ? options(sorted.map((n) => [n.id, `NAS# ${n.number}: ${n.requester}, ${money(n.authorized)}${n.suggested ? ' (same investigator)' : ''}${n.hasScope ? ' (has its own scope)' : ''}`]), sorted.find((n) => n.suggested)?.id ?? '', { blank: 'Choose the NAS request' }) : '<option value="">No open NAS request</option>'}</select>
      </div>
      <div id="nascreate" class="form" style="grid-template-columns:1fr 1fr 1fr;margin-top:8px" hidden>
        <div class="field"><label for="ntype2">Request type</label><select id="ntype2">${options(Object.entries(meta.requestTypes).map(([k, v]) => [k, v.name]), e.type, { blank: 'Choose' })}</select></div>
        <div class="field"><label for="nn2">MHL numbers</label><input id="nn2" type="number" min="1" max="500" value="${e.n ?? ''}"></div>
        <div class="field"><label for="nauth">Authorized ($)</label><input id="nauth" type="number" min="0.01" step="0.01" placeholder="the estimate total"></div>
        <div class="field"><label for="nproj">Project ID</label><input id="nproj" maxlength="30" placeholder="Costpoint project"></div>
        <div class="field"><label for="nnum">NAS# (optional)</label><input id="nnum" maxlength="30" placeholder="next number"></div>
      </div>
      <div class="actions"><button class="btn" type="submit">Link the NAS request</button></div>
    </form>`;
}

function bindNasPanel(d) {
  const f = $('#nasform');
  if (!f) return;
  const mode = () => $('input[name="nasmode"]:checked', f)?.value || 'link';
  const show = () => { $('#naslink').hidden = mode() !== 'link'; $('#nascreate').hidden = mode() !== 'create'; };
  $$('input[name="nasmode"]', f).forEach((r) => r.addEventListener('change', show));
  show();
  f.addEventListener('submit', (ev) => {
    ev.preventDefault();
    act(ev.submitter, async () => {
      const boxes = $$('input[name="ph"]', f);
      const phases = boxes.length ? boxes.filter((b) => b.checked).map((b) => Number(b.value)) : null;
      if (boxes.length && !phases.length) throw new Error('Choose at least one phase.');
      const body = mode() === 'link' ? { nasId: Number($('#nasid').value), phases }
        : { create: true, phases, type: $('#ntype2').value, n: $('#nn2').value, authorized: $('#nauth').value, project: $('#nproj').value, number: $('#nnum').value };
      if (mode() === 'link' && !body.nasId) throw new Error('Choose a NAS request.');
      const r = await api('POST', `/api/estimates/${d.estimate.id}/nas`, body);
      navigate(`#/estimates/${d.estimate.id}`);
      return r;
    }, (r) => `Linked to NAS# ${r.nasNumber}`);
  });
}

// ---------- the draft editor ----------
function editor(app, meta, pl, d) {
  const ed = structuredClone(d.estimate);
  ed.phases = ed.phases.length ? ed.phases : [{ name: 'Phase 1', lines: [] }];
  let tool = null;            // { phase, kind: 'code' | 'plan' | 'ihc' | 'custom' }
  let ihc = null;             // the IHC helper's choices
  let timer = null; let dirty = false; let chain = Promise.resolve();
  const priced = () => ESTX.priceEstimate(ed, pl.items, MONEY);
  const item = (code) => pl.items.find((i) => i.code === code);

  const payload = () => ({ investigator: ed.investigator, title: ed.title, description: ed.description, species: ed.species, fixative: ed.fixative, type: ed.type, n: ed.n,
    validDays: ed.validDays, assumptions: ed.assumptions, phases: ed.phases });
  const saveState = (msg, bad = false) => { const el = $('#savestate'); if (el) { el.textContent = msg; el.className = `small ${bad ? 'fitnote' : 'muted'}`; } };
  // Saves run one after another, each sending the whole draft as it is then, so a slow save never overwrites a later
  // one. A failed save leaves the draft marked unsaved; the next edit, or any action, tries again.
  let gone = false;
  const save = () => {
    clearTimeout(timer);
    const run = chain.catch(() => {}).then(async () => {
      if (!dirty || gone === 'discarded') return;
      dirty = false; saveState('Saving…');
      try {
        await api('PUT', `/api/estimates/${ed.id}`, payload());
        if (!dirty) saveState(`Saved at ${new Date().toTimeString().slice(0, 5)}`);
      } catch (err) { dirty = true; saveState(`Not saved: ${err.message}`, true); throw err; }
    });
    chain = run;
    return run;
  };
  const changed = () => { dirty = true; saveState('Unsaved changes'); clearTimeout(timer); timer = setTimeout(() => save().catch(() => {}), 700); };
  // Leaving the page saves what is left to save, and says so if that fails; closing the window asks first.
  const onUnload = (ev) => { if (dirty) { ev.preventDefault(); ev.returnValue = ''; } };
  const onLeave = () => {
    window.removeEventListener('hashchange', onLeave); window.removeEventListener('beforeunload', onUnload);
    if (gone !== 'discarded') gone = true;
    if (dirty) save().catch((err) => toast(`Your last changes to ${d.label} were not saved: ${err.message}`, 'error'));
  };
  window.addEventListener('hashchange', onLeave); window.addEventListener('beforeunload', onUnload);

  app.innerHTML = `
    ${topHtml(d)}
    <div class="split wide-left">
      <div>
        <h2 class="section">Investigator and project</h2>
        <form class="form" id="efields" onsubmit="return false" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="ilast">Investigator last name</label><input id="ilast" maxlength="100" value="${esc(ed.investigator.last)}"></div>
          <div class="field"><label for="ifirst">First name</label><input id="ifirst" maxlength="100" value="${esc(ed.investigator.first)}"></div>
          <div class="field"><label for="iinst">Institute, branch or lab</label><input id="iinst" maxlength="200" value="${esc(ed.investigator.inst)}"></div>
          <div class="field"><label for="iemail">Email</label><input id="iemail" type="email" maxlength="120" value="${esc(ed.investigator.email)}"></div>
          <div class="field full"><label for="etitle">Project title</label><input id="etitle" maxlength="200" value="${esc(ed.title)}"></div>
          <div class="field full"><label for="edesc">Scope of work, as the investigator will read it</label><textarea id="edesc" maxlength="2000" rows="3">${esc(ed.description)}</textarea></div>
          <div class="field"><label for="especies">Species</label><select id="especies">${options(Object.entries(meta.species).map(([k, v]) => [k, v.name]), ed.species, { blank: 'Not set' })}</select></div>
          <div class="field"><label for="efix">Fixative</label><select id="efix">${options(FIXATIVES, ed.fixative)}</select></div>
          <div class="field"><label for="etype">Kind of work (for the NAS request)</label><select id="etype">${options(Object.entries(meta.requestTypes).map(([k, v]) => [k, v.name]), ed.type, { blank: 'Decide later' })}</select></div>
          <div class="field"><label for="en">Animals or samples (MHL numbers)</label><input id="en" type="number" min="1" max="500" value="${ed.n ?? ''}"></div>
          <div class="field"><label for="evalid">Valid for (days after sending)</label><input id="evalid" type="number" min="1" max="365" value="${ed.validDays ?? ESTX.VALID_DAYS}"></div>
        </form>
        <h2 class="section">Work and prices</h2>
        <p class="small muted">Group the work into phases (for example a pilot and a main study) if the investigator needs them priced separately. Tick <em>Optional</em> for lines shown on the estimate but not counted in the total.</p>
        <div id="phases"></div>
        <button class="btn quiet" type="button" id="addphase">Add a phase</button>
        <h2 class="section">Assumptions</h2>
        <div class="field"><label for="eassume" class="small muted">One per line. They are printed on the estimate.</label><textarea id="eassume" rows="4" maxlength="8000">${esc(ed.assumptions.join('\n'))}</textarea></div>
      </div>
      <div><div class="panel est-sum" id="sum">
        <div id="sumfig"></div>
        <div class="actions" style="flex-wrap:wrap">
          <button class="btn" type="button" id="emailbtn">Email…</button>
          <button class="btn quiet" type="button" id="send">Mark as sent</button>
          <button class="btn quiet" type="button" id="preview">Print preview</button>
        </div>
        <div class="actions" style="flex-wrap:wrap;margin-top:6px">
          <button class="btn small quiet" type="button" id="csv">Download CSV</button>
          <button class="btn small quiet" type="button" id="copy">Copy</button>
          <button class="btn small quiet" type="button" id="discard">Discard draft</button>
        </div>
        <p id="savestate" class="small muted" aria-live="polite">Saved</p>
        <p class="small muted" id="validnote"></p>
      </div>${revisionsHtml(d)}${historyHtml(d)}</div>
    </div>`;
  pageTop(app);

  // Investigator and project fields update the draft without redrawing, so typing keeps its place.
  const bind = (sel, fn, ev = 'input') => $(sel).addEventListener(ev, (e) => { fn(e.target.value); changed(); drawSummary(); });
  bind('#ilast', (v) => { ed.investigator.last = v; });
  bind('#ifirst', (v) => { ed.investigator.first = v; });
  bind('#iinst', (v) => { ed.investigator.inst = v; });
  bind('#iemail', (v) => { ed.investigator.email = v.trim(); });
  bind('#etitle', (v) => { ed.title = v; });
  bind('#edesc', (v) => { ed.description = v; });
  bind('#especies', (v) => { ed.species = v; }, 'change');
  bind('#efix', (v) => { ed.fixative = v; }, 'change');
  bind('#etype', (v) => { ed.type = v; }, 'change');
  bind('#en', (v) => { ed.n = v === '' ? null : Math.max(1, Math.min(500, Math.round(Number(v)) || 1)); });
  bind('#evalid', (v) => { ed.validDays = v === '' ? ESTX.VALID_DAYS : Math.max(1, Math.min(365, Math.round(Number(v)) || ESTX.VALID_DAYS)); });
  $('#en').addEventListener('change', (e) => { e.target.value = ed.n ?? ''; });
  $('#evalid').addEventListener('change', (e) => { e.target.value = ed.validDays; });
  bind('#eassume', (v) => { ed.assumptions = v.split('\n').map((x) => x.trim()).filter(Boolean); });
  $('#addphase').addEventListener('click', () => {
    if (ed.phases.length >= ESTX.MAX_PHASES) { toast(`An estimate can have at most ${ESTX.MAX_PHASES} phases.`, 'error'); return; }
    ed.phases.push({ name: `Phase ${ed.phases.length + 1}`, lines: [] }); changed(); drawPhases();
    $(`[data-phname="${ed.phases.length - 1}"]`)?.select();
  });

  function drawSummary(p = priced()) {
    const problems = ESTX.sendProblems(ed, p);
    $('#sumfig').innerHTML = `
      <div class="calc-big"><span class="muted">Total estimate</span><b>${money(p.total)}</b>${p.optionalTotal ? `<span class="muted">+ ${money(p.optionalTotal)} in optional lines, not in the total</span>` : ''}</div>
      ${p.phases.length > 1 ? `<table class="t"><tbody>${p.phases.map((ph) => `<tr><td>${esc(ph.name)}</td><td class="n">${money(ph.subtotal)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${p.bySection.length ? `<h3 class="section">By section</h3>${sectionSummary(meta, p)}` : ''}
      <p class="small muted">Prices from the ${esc(pl.name)} price list${d.priceList.status && d.priceList.status !== 'APPROVED' ? ` (${esc(d.priceList.status.toLowerCase())})` : ''}. They are fixed when the estimate is sent.</p>
      ${problems.length ? `<h3 class="section">Before sending</h3><ul class="assume">${problems.slice(0, 8).map((x) => `<li>${esc(x)}</li>`).join('')}${problems.length > 8 ? `<li>and ${problems.length - 8} more</li>` : ''}</ul>` : '<p class="note ok">Ready to send.</p>'}`;
    $('#send').disabled = problems.length > 0;
    $('#send').title = problems.length ? 'See "Before sending"' : '';
    $('#validnote').textContent = `Email opens the estimate in Outlook, addressed and ready to send, and marks it as sent; or send the printed estimate yourself and mark it as sent here. It is then valid for ${ed.validDays || ESTX.VALID_DAYS} days.`;
  }
  function bindSummary() {
    $('#emailbtn').addEventListener('click', (e) => act(e.currentTarget, async () => {
      // Keep saving until nothing typed meanwhile is left, so the email page reads the draft as it is now.
      for (let i = 0; i < 5 && (dirty || i === 0); i++) await save();
      if (dirty) throw new Error('The draft could not be saved; try again.');
      navigate(`#/estimates/${ed.id}/email`);
    }));
    $('#send').addEventListener('click', (e) => act(e.currentTarget, async () => {
      await save();
      const r = await api('POST', `/api/estimates/${ed.id}/send`, {});
      navigate(`#/estimates/${ed.id}`);
      return r;
    }, (r) => `${d.label} sent; valid until ${fmtDate(r.validUntil)}`));
    $('#preview').addEventListener('click', (e) => act(e.currentTarget, async () => { await save(); navigate(`#/estimates/${ed.id}/print`); }));
    $('#csv').addEventListener('click', (e) => act(e.currentTarget, async () => { await save(); return download(`/api/estimates/${ed.id}/csv`); }, (f) => `Downloaded ${f.name}`));
    $('#copy').addEventListener('click', (e) => act(e.currentTarget, async () => { await save(); const r = await api('POST', `/api/estimates/${ed.id}/copy`, {}); navigate(`#/estimates/${r.id}`); return r; }, (r) => `Copied as ${r.number}`));
    $('#discard').addEventListener('click', (e) => {
      if (!window.confirm(`Discard ${d.label}? It has not been sent; it stays in the list under Discarded.`)) return;
      act(e.currentTarget, async () => { clearTimeout(timer); dirty = false; gone = 'discarded'; const r = await api('POST', `/api/estimates/${ed.id}/discard`, {}); navigate(r.backTo ? `#/estimates/${r.backTo}` : '#/estimates'); }, 'Draft discarded');
    });
  }
  bindSummary();

  function lineRow(i, j, l) {
    const key = `${i}.${j}`;
    const editPrice = l.custom || l.priceByHand;
    const src = ed.phases[i].lines[j];
    return `<tr data-row="${key}"${l.optional ? ' class="dim"' : ''}>
      <td class="code">${l.code ? esc(l.code) : '<span class="badge info">Not on list</span>'}<br><span class="small muted">${esc(sectionName(meta, l.section))}</span></td>
      <td>${esc(l.description || (l.custom ? 'Describe the work' : ''))}${l.custom && l.unit && !l.description.toLowerCase().includes(l.unit.toLowerCase()) ? ` <span class="small muted">per ${esc(l.unit)}</span>` : ''}
        <input class="est-note" data-note="${key}" value="${esc(src.note || '')}" maxlength="200" placeholder="${l.needsNote ? 'Say what this work is (needed before sending)' : 'Note (optional)'}" aria-label="Note for line ${j + 1}">
        <div class="small fitnote" data-prob="${key}">${esc(l.problem)}</div></td>
      <td class="n"><input class="units" type="number" min="0.01" step="any" data-units="${key}" value="${Number.isFinite(src.units) ? src.units : ''}" aria-label="Units"></td>
      <td class="n">${editPrice ? `<input class="units" type="number" min="0" step="0.01" data-price="${key}" value="${src.unitPrice ?? ''}" aria-label="Unit price" title="${l.custom ? 'Not on the price list: type the price (0 if to be confirmed)' : 'This code has no price on the list: type the price'}">` : money(l.unitPrice)}</td>
      <td class="n" data-amt="${key}">${l.amount == null ? '' : money(l.amount)}</td>
      <td class="mid"><input type="checkbox" data-opt="${key}" ${src.optional ? 'checked' : ''} aria-label="Optional"></td>
      <td class="mid"><button class="btn small quiet est-x" type="button" data-rm="${key}" aria-label="Remove line ${j + 1}" title="Remove this line">✕</button></td></tr>`;
  }

  function drawPhases(focus = null) {
    const p = priced();
    $('#phases').innerHTML = p.phases.map((ph, i) => `
      <section class="panel est-phase">
        <div class="est-ph-head">
          <input class="est-ph-name" data-phname="${i}" value="${esc(ed.phases[i].name)}" maxlength="60" aria-label="Phase name">
          <span class="spacer"></span>
          <span class="small muted">${ph.lines.length} line${ph.lines.length === 1 ? '' : 's'}</span><b data-sub="${i}">${money(ph.subtotal)}</b>
          ${ed.phases.length > 1 ? `<button class="btn small quiet" type="button" data-phrm="${i}">Remove phase</button>` : ''}
        </div>
        ${ph.lines.length ? `<table class="t est-lines"><thead><tr><th>Code</th><th>Description and note</th><th class="n">Units</th><th class="n">Unit price</th><th class="n">Amount</th><th class="mid" title="Shown on the estimate but not counted in the total">Opt.</th><th><span hidden>Remove</span></th></tr></thead>
          <tbody>${ph.lines.map((l, j) => lineRow(i, j, l)).join('')}
          <tr class="total"><td colspan="4" data-phlabel="${i}">${esc(ph.name)}</td><td class="n" data-tot="${i}">${money(ph.subtotal)}</td><td colspan="2" class="small muted" data-opttot="${i}">${ph.optionalTotal ? `+ ${money(ph.optionalTotal)} optional` : ''}</td></tr></tbody></table>`
          : '<p class="empty" style="padding:6px 0">No lines yet. Add them with the buttons below.</p>'}
        <div class="est-tools" role="group" aria-label="Add to ${esc(ph.name)}">
          ${[['plan', 'Fill in from a kind of work'], ['code', 'Add a charge code'], ['ihc', 'Add IHC and stains'], ['custom', 'Add a line not on the price list']].map(([k, label]) =>
            `<button class="btn small ${tool?.phase === i && tool.kind === k ? '' : 'quiet'}" type="button" data-tool="${i}.${k}" aria-pressed="${tool?.phase === i && tool.kind === k}">${label}</button>`).join('')}
        </div>
        ${tool?.phase === i ? `<div class="est-tool" id="tool"></div>` : ''}
      </section>`).join('');
    bindPhases();
    if (tool) drawTool();
    drawSummary();
    if (focus) { const el = $(focus); if (el) { el.focus(); if (el.select) el.select(); } }
  }

  // After a change to units, a price, a note, a name or Optional: update the figures in place (no rebuild).
  const put = (sel, text) => { const el = $(sel); if (el) el.textContent = text; };
  function refreshNumbers() {
    const p = priced();
    p.phases.forEach((ph, i) => {
      ph.lines.forEach((l, j) => {
        const key = `${i}.${j}`;
        put(`[data-amt="${key}"]`, l.amount == null ? '' : money(l.amount));
        put(`[data-prob="${key}"]`, l.problem);
        $(`[data-row="${key}"]`)?.classList.toggle('dim', l.optional);
      });
      put(`[data-sub="${i}"]`, money(ph.subtotal)); put(`[data-tot="${i}"]`, money(ph.subtotal)); put(`[data-phlabel="${i}"]`, ph.name);
      put(`[data-opttot="${i}"]`, ph.optionalTotal ? `+ ${money(ph.optionalTotal)} optional` : '');
    });
    drawSummary(p);
  }
  const at = (key) => { const [i, j] = key.split('.').map(Number); return { i, j, line: ed.phases[i].lines[j] }; };
  function bindPhases() {
    $$('[data-phname]').forEach((el) => el.addEventListener('input', () => { ed.phases[Number(el.dataset.phname)].name = el.value; changed(); refreshNumbers(); }));
    $$('[data-phrm]').forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.phrm);
      if (ed.phases[i].lines.length && !window.confirm(`Remove ${ed.phases[i].name} and its ${ed.phases[i].lines.length} lines?`)) return;
      ed.phases.splice(i, 1); tool = null; changed(); drawPhases();
    }));
    // Units keep what was typed (a third decimal shows as a problem rather than being rounded away).
    $$('[data-units]').forEach((el) => el.addEventListener('input', () => { at(el.dataset.units).line.units = el.value === '' ? NaN : Number(el.value); changed(); refreshNumbers(); }));
    $$('[data-price]').forEach((el) => el.addEventListener('input', () => { at(el.dataset.price).line.unitPrice = el.value === '' ? null : Number(el.value); changed(); refreshNumbers(); }));
    $$('[data-note]').forEach((el) => el.addEventListener('input', () => { at(el.dataset.note).line.note = el.value; changed(); refreshNumbers(); }));
    $$('[data-opt]').forEach((el) => el.addEventListener('change', () => { at(el.dataset.opt).line.optional = el.checked; changed(); refreshNumbers(); }));
    $$('[data-rm]').forEach((b) => b.addEventListener('click', () => { const { i, j } = at(b.dataset.rm); ed.phases[i].lines.splice(j, 1); changed(); drawPhases(); }));
    $$('[data-tool]').forEach((b) => b.addEventListener('click', () => {
      const [i, kind] = b.dataset.tool.split('.');
      tool = tool && tool.phase === Number(i) && tool.kind === kind ? null : { phase: Number(i), kind };
      if (tool?.kind === 'ihc') ihc = newIhc(Number(i));
      drawPhases();
      $('#tool input, #tool select')?.focus();
    }));
  }

  const addLines = (i, lines, msg) => {
    const room = ESTX.MAX_LINES - ed.phases.reduce((k, ph) => k + ph.lines.length, 0);
    if (lines.length > room) { toast(`An estimate can have at most ${ESTX.MAX_LINES} lines.`, 'error'); return false; }
    ed.phases[i].lines.push(...lines); changed(); toast(msg); return true;
  };

  // ----- the four ways of adding lines -----
  function drawTool() {
    const box = $('#tool'); const i = tool.phase;
    if (tool.kind === 'code') {
      box.innerHTML = `<div class="picker" style="margin-top:0"><input id="addcode" placeholder="Type a code or words, e.g. HP002001, perfusion, Opal, scan" autocomplete="off" aria-label="Find a charge code"><ul id="matches" hidden></ul></div>`;
      const input = $('#addcode'); const list = $('#matches');
      input.addEventListener('input', () => {
        const q = input.value.trim().toLowerCase();
        if (q.length < 2) { list.hidden = true; return; }
        const found = pl.items.filter((x) => x.code.toLowerCase().includes(q) || x.description.toLowerCase().includes(q)).slice(0, 12);
        list.innerHTML = found.length ? found.map((x) => `<li><button type="button" data-code="${esc(x.code)}"><span class="code">${esc(x.code)}</span><span>${esc(x.description)}</span><span style="text-align:right">${x.price == null ? 'no price' : money(x.price)}</span></button></li>`).join('')
          : `<li style="padding:8px 12px" class="muted">No code matches “${esc(input.value)}”. Use “Add a line not on the price list” for work the list does not cover.</li>`;
        list.hidden = false;
        $$('[data-code]', list).forEach((b) => b.addEventListener('click', () => {
          const x = item(b.dataset.code);
          if (addLines(i, [{ section: x.sections[0], code: x.code, units: 1, optional: false, note: '', unitPrice: null }], `${x.code} added; set the units`)) {
            drawPhases(`[data-units="${i}.${ed.phases[i].lines.length - 1}"]`);
          }
        }));
      });
    } else if (tool.kind === 'plan') {
      const type0 = ed.type || 'NECRO-FULL';
      box.innerHTML = `
        <div class="form" style="grid-template-columns:2fr 1fr 1fr;max-width:none">
          <div class="field"><label for="ptype">Kind of work</label><select id="ptype">${options(Object.entries(meta.requestTypes).map(([k, v]) => [k, v.name]), type0)}</select></div>
          <div class="field"><label for="pn">Animals or samples</label><input id="pn" type="number" min="1" max="5000" value="${ed.n ?? 10}"></div>
          <div class="field"><label for="pper">Blocks or slides per animal</label><input id="pper" type="number" min="1" max="100" value="${ESTX.planPerBlock(meta.requestTypes[type0], pl.items)}"></div>
        </div>
        <div id="pprev"></div>
        <p class="small muted">The usual lines for this kind of work, as New request suggests them. Lines charged per block or slide use the number per animal; the rest are one per animal or sample.</p>
        <div class="actions"><button class="btn small" type="button" id="padd">Add these lines</button></div>`;
      const current = () => {
        const type = $('#ptype').value; const def = meta.requestTypes[type];
        const n = Math.max(1, Math.min(5000, Math.round(Number($('#pn').value)) || 1));
        const per = Math.max(1, Math.min(100, Math.round(Number($('#pper').value)) || 1));
        return { type, n, lines: ESTX.planLines(def, n, per, pl.items) };
      };
      const showPlan = () => {
        const p = ESTX.priceEstimate({ phases: [{ name: '', lines: current().lines }] }, pl.items, MONEY);
        $('#pprev').innerHTML = `<table class="t section"><tbody>${p.phases[0].lines.map((l) => `<tr><td class="code">${esc(l.code)}</td><td>${esc(l.description)}</td><td class="n">${l.units}</td><td class="n">${l.amount == null ? '<span class="badge warn">no price</span>' : money(l.amount)}</td></tr>`).join('')}
          <tr class="total"><td colspan="3">These lines</td><td class="n">${money(p.total)}</td></tr></tbody></table>`;
      };
      $('#ptype').addEventListener('change', (e) => { $('#pper').value = ESTX.planPerBlock(meta.requestTypes[e.target.value], pl.items); showPlan(); });
      $('#pn').addEventListener('input', showPlan);
      $('#pper').addEventListener('input', showPlan);
      showPlan();
      $('#padd').addEventListener('click', () => {
        const { type, n, lines } = current();
        if (!addLines(i, lines.map((l) => ({ ...l, optional: false, note: '', unitPrice: null })), `${lines.length} lines added to ${ed.phases[i].name}`)) return;
        if (!ed.type) { ed.type = type; $('#etype').value = type; }
        if (!ed.n) { ed.n = Math.min(500, n); $('#en').value = ed.n; }
        tool = null; drawPhases();
      });
    } else if (tool.kind === 'custom') {
      box.innerHTML = `
        <div class="form" style="grid-template-columns:3fr 2fr 1fr 1fr 1fr;max-width:none" id="cform">
          <div class="field"><label for="cdesc">Description</label><input id="cdesc" maxlength="200" placeholder="e.g. 10x Xenium 5K panel run, per slide"></div>
          <div class="field"><label for="csec">Section</label><select id="csec">${options(pl.sections.map((s) => [s.code, s.name]), 'STAIN')}</select></div>
          <div class="field"><label for="cunit">Unit</label><input id="cunit" maxlength="30" placeholder="slide"></div>
          <div class="field"><label for="cunits">Units</label><input id="cunits" type="number" min="0.01" step="any" value="1"></div>
          <div class="field"><label for="cprice">Unit price ($)</label><input id="cprice" type="number" min="0" step="0.01" placeholder="0 = to be confirmed"></div>
        </div>
        <p class="small muted">For work the price list does not cover. It is marked “not on the price list” on the estimate, and it is not carried into the NAS request's scope, because it cannot be charged with a code.</p>
        <div class="actions"><button class="btn small" type="button" id="cadd">Add the line</button></div>`;
      $('#cadd').addEventListener('click', () => {
        const desc = $('#cdesc').value.trim(); const price = $('#cprice').value;
        if (!desc) { toast('Describe the work.', 'error'); $('#cdesc').focus(); return; }
        if (price === '' || !(Number(price) >= 0)) { toast('Give a unit price, or 0 if it is to be confirmed.', 'error'); $('#cprice').focus(); return; }
        if (addLines(i, [{ section: $('#csec').value, code: '', description: desc, unit: $('#cunit').value.trim(), units: r2(Number($('#cunits').value) || 1), unitPrice: r2(Number(price)), optional: false, note: '' }], 'Line added')) { tool = null; drawPhases(); }
      });
    } else if (tool.kind === 'ihc') drawIhc(box, i);
  }

  // The IHC helper uses the same rules as New request: stains from the catalog, per block, priced by the IHC rules.
  function newIhc(i) {
    const blocksHere = ed.phases[i].lines.filter((l) => ['HP003003', 'HP003005'].includes(l.code)).reduce((k, l) => k + (Number(l.units) || 0), 0);
    return { blocks: blocksHere || ed.n || 1, sampleType: 'BLOCK', addOn: blocksHere > 0, he: { on: false, perBlock: 1 }, unstained: { on: false, perBlock: 1 }, scan: { x20: true, x40: false }, stains: [], found: [], q: '', preview: null };
  }
  const ihcBody = () => ({ n: Math.max(1, Math.min(500, ihc.blocks)), species: ed.species || 'OTHER', fixative: ed.fixative || '10%NBF',
    ihc: { tissue: '', sampleType: ihc.sampleType, addOn: ihc.addOn, he: ihc.he, unstained: ihc.unstained, scan: ihc.scan, stains: ihc.stains.map(({ view, ...s }) => s), notes: '' } });

  function drawIhc(box, i) {
    box.innerHTML = `
      <div class="form" style="grid-template-columns:1fr 1.4fr 1fr 1fr;max-width:none">
        <div class="field"><label for="hblocks">Blocks</label><input id="hblocks" type="number" min="1" max="500" value="${ihc.blocks}"></div>
        <div class="field"><label for="htype">Material</label><select id="htype">${options(meta.ihc.sampleTypes, ihc.sampleType)}</select></div>
        <div class="field"><label><input type="checkbox" id="hhe" ${ihc.he.on ? 'checked' : ''}> H&E per block</label><input id="hhen" type="number" min="1" max="10" value="${ihc.he.perBlock}" aria-label="H&E per block"></div>
        <div class="field"><label><input type="checkbox" id="hun" ${ihc.unstained.on ? 'checked' : ''}> Unstained per block</label><input id="hunn" type="number" min="1" max="20" value="${ihc.unstained.perBlock}" aria-label="Unstained per block"></div>
        <div class="field full"><div class="checks">
          <label><input type="checkbox" id="haddon" ${ihc.addOn ? 'checked' : ''}> On blocks this estimate already makes (extra sections, no new blocks)</label>
          <label><input type="checkbox" id="hx20" ${ihc.scan.x20 ? 'checked' : ''}> Scan 20x</label><label><input type="checkbox" id="hx40" ${ihc.scan.x40 ? 'checked' : ''}> Scan 40x</label></div></div>
      </div>
      <div class="split even" style="gap:20px">
        <div>
          <div class="picker" style="max-width:none;margin-top:6px"><input id="hfind" value="${esc(ihc.q)}" placeholder="Find an antibody: target, clone or catalog number" autocomplete="off" aria-label="Search the IHC catalog"></div>
          <div id="hfound" aria-live="polite"></div>
          <details class="section"><summary class="small"><strong>The antibody is not in the catalog</strong></summary>
            <div class="form section" style="grid-template-columns:1fr auto;max-width:none">
              <div class="field"><label for="hnew">Target and clone</label><input id="hnew" maxlength="120" placeholder="e.g. SLC7A11 (clone D2M7A)"></div>
              <div class="field"><label><input type="checkbox" id="hsup"> Investigator supplies it</label><button class="btn small quiet" type="button" id="hnewadd">Add</button></div>
            </div></details>
        </div>
        <div><div id="hchosen"></div><div id="hprev" class="section"></div></div>
      </div>
      <div class="actions"><button class="btn small" type="button" id="hadd">Add these lines to ${esc(ed.phases[i].name)}</button></div>`;
    const read = () => {
      ihc.blocks = Math.max(1, Math.min(500, Math.round(Number($('#hblocks').value)) || 1));
      ihc.sampleType = $('#htype').value; ihc.addOn = $('#haddon').checked;
      ihc.he = { on: $('#hhe').checked, perBlock: Math.max(1, Math.min(10, Math.round(Number($('#hhen').value)) || 1)) };
      ihc.unstained = { on: $('#hun').checked, perBlock: Math.max(1, Math.min(20, Math.round(Number($('#hunn').value)) || 1)) };
      ihc.scan = { x20: $('#hx20').checked, x40: $('#hx40').checked };
    };
    const chosen = () => ihc.stains.length > 0 || ihc.he.on || ihc.unstained.on;
    let seq = 0;
    const preview = async () => {
      read();
      const mine = ++seq; const me = ihc;
      if (!chosen()) { ihc.preview = null; $('#hprev').innerHTML = '<p class="small muted">Choose stains, H&E or unstained slides.</p>'; return; }
      let res;
      try { res = await api('POST', '/api/requests/ihc-estimate', ihcBody()); } catch (err) {
        if (mine === seq && $('#hprev')) { ihc.preview = null; $('#hprev').innerHTML = `<p class="small fitnote">${esc(err.message)}</p>`; }
        return;
      }
      if (mine !== seq || ihc !== me || !$('#hprev')) return;
      ihc.preview = res;
      $('#hprev').innerHTML = `<table class="t"><tbody>${res.estimate.lines.map((l) => `<tr><td class="code">${esc(l.code)}</td><td>${esc(l.description)}</td><td class="n">${l.units}</td><td class="n">${l.amount == null ? '<span class="badge warn">no price</span>' : money(l.amount)}</td></tr>`).join('')}
        <tr class="total"><td colspan="3">IHC and stains</td><td class="n">${money(res.estimate.total)}</td></tr></tbody></table>
        ${res.estimate.assumptions.length ? `<ul class="assume">${res.estimate.assumptions.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}`;
    };
    const drawChosen = () => {
      $('#hchosen').innerHTML = ihc.stains.length ? `<table class="t"><tbody>${ihc.stains.map((s, k) => `<tr><td>${s.newAntibody ? `<strong>${esc(s.newAntibody.name)}</strong> <span class="badge warn">not in catalog</span>${s.newAntibody.supplied ? ' <span class="small muted">supplied</span>' : ''}`
        : `<strong>${esc(s.view.name)}</strong> ${kindBadge(s.view)} <span class="small muted">#${s.assayId}</span>`}</td><td class="mid"><button class="btn small quiet" type="button" data-hrm="${k}">Remove</button></td></tr>`).join('')}</tbody></table>`
        : '<p class="small muted">No stains chosen.</p>';
      $$('[data-hrm]').forEach((b) => b.addEventListener('click', () => { ihc.stains.splice(Number(b.dataset.hrm), 1); drawChosen(); search(); preview(); }));
    };
    const search = async () => {
      const q = ihc.q;
      if (!q) { $('#hfound').innerHTML = ''; return; }
      const sp = IHC_SPECIES[ed.species] || 'Other'; const fx = IHC_FIXATIVE[ed.fixative] || 'Other';
      const res = await api('GET', `/api/ihc/assays?q=${encodeURIComponent(q)}&limit=8&fitSpecies=${encodeURIComponent(sp)}&fitFixative=${encodeURIComponent(fx)}&fitTypes=${ihc.sampleType}`);
      if (!$('#hfound') || ihc.q !== q) return;
      ihc.found = res.assays;
      const picked = new Set(ihc.stains.map((s) => s.assayId));
      $('#hfound').innerHTML = res.assays.length ? `<ul class="found-list">${res.assays.map((a, k) => `<li class="${a.fit.length ? 'misfit' : ''}"><div><strong>${esc(a.name)}</strong> ${kindBadge(a)} <span class="small muted">#${a.id}</span>
          <br><span class="small muted">${esc(clip([`${a.manufacturer} ${a.catalog}`.trim(), a.species, a.fixative].filter(Boolean).join(' · '), 110))}</span>${a.fit.length ? `<br><span class="small fitnote">${esc(a.fit.join('; '))}</span>` : ''}</div>
          <div>${picked.has(a.id) ? '<span class="badge complete">Added</span>' : `<button class="btn small quiet" type="button" data-hpick="${k}">Add</button>`}</div></li>`).join('')}</ul>`
        : `<p class="small muted">Nothing in the catalog matches “${esc(q)}”.</p>`;
      $$('[data-hpick]').forEach((b) => b.addEventListener('click', () => {
        const a = ihc.found[Number(b.dataset.hpick)];
        if (ihc.stains.length >= 20) { toast('At most 20 stains at a time.', 'error'); return; }
        ihc.stains.push({ assayId: a.id, chromogen: a.chromogen === 'Red' ? 'Red' : 'DAB', view: a }); drawChosen(); search(); preview();
      }));
    };
    let t = null;
    $('#hfind').addEventListener('input', (e) => { ihc.q = e.target.value.trim(); clearTimeout(t); t = setTimeout(search, 150); });
    $$('#hblocks, #htype, #hhe, #hhen, #hun, #hunn, #haddon, #hx20, #hx40').forEach((el) => el.addEventListener('change', () => { preview(); if (el.id === 'htype') search(); }));
    $('#hnewadd').addEventListener('click', () => {
      const name = $('#hnew').value.trim();
      if (!name) { toast('Give the antibody target.', 'error'); return; }
      ihc.stains.push({ chromogen: 'DAB', newAntibody: { name, manufacturer: 'To be confirmed', catalog: '', host: '', supplied: $('#hsup').checked, notes: '' } });
      $('#hnew').value = ''; drawChosen(); preview();
    });
    $('#hadd').addEventListener('click', (e) => act(e.currentTarget, async () => {
      await preview();
      if (!ihc) return;
      if (!ihc.preview) throw new Error('Choose stains, H&E or unstained slides first.');
      const names = ihc.stains.map((s) => (s.newAntibody ? s.newAntibody.name : s.view.name));
      const note = clip(`IHC${names.length ? `: ${names.join(', ')}` : ''}`, 200);
      const lines = ihc.preview.estimate.lines.map((l) => ({ section: l.section, code: l.code, units: l.units, optional: false, unitPrice: null,
        note: l.code === 'HP009002' ? 'Optimizing a new antibody (2 hours each)' : note }));
      if (!addLines(i, lines, `${lines.length} IHC lines added to ${ed.phases[i].name}`)) return;
      const add = ihc.preview.estimate.assumptions.map(ESTX.forEstimate).filter((a) => !ed.assumptions.includes(a));
      if (add.length) { ed.assumptions.push(...add); $('#eassume').value = ed.assumptions.join('\n'); }
      tool = null; ihc = null; drawPhases();
    }));
    drawChosen(); search(); preview();
  }

  drawPhases();
}

// ---------- printable estimate ----------
export async function renderEstimatePrint(app, id) {
  const [meta, d] = await Promise.all([getMeta(), api('GET', `/api/estimates/${id}`)]);
  const e = d.estimate; const p = d.priced;
  const draft = e.status === 'DRAFT' ? 'Draft, not sent' : e.status === 'DISCARDED' ? 'Discarded draft' : e.status === 'SUPERSEDED' ? 'Replaced by a later revision' : d.display === 'EXPIRED' ? 'Expired' : '';
  const dated = e.sentOn || meta.today;
  const until = ESTX.validUntilFor(e, meta.today);
  app.innerHTML = `
    <div class="toolbar noprint"><a href="#/estimates/${e.id}">Back to ${esc(d.label)}</a><span class="spacer"></span><button class="btn" type="button" id="print">Print</button></div>
    <article class="report est-doc">
      <div class="rep-head">
        <div><div class="rep-lab">${LAB}</div><div class="small muted">${LAB2}</div></div>
        <div class="rep-title">Cost estimate${draft ? `<div class="rep-draft">${esc(draft)}</div>` : ''}</div>
      </div>
      <div class="rep-pilot">Pilot with test data: not a valid estimate</div>
      <table class="rep-facts"><tbody>
        <tr><th>Estimate</th><td><strong>${esc(d.label)}</strong></td><th>Date</th><td>${fmtDate(dated)}</td><th>Valid until</th><td>${fmtDate(until)}</td></tr>
        <tr><th>Prepared for</th><td>${esc([e.investigator.first, e.investigator.last].filter(Boolean).join(' '))}${e.investigator.inst ? `<br><span class="small">${esc(e.investigator.inst)}</span>` : ''}${e.investigator.email ? `<br><span class="small">${esc(e.investigator.email)}</span>` : ''}</td>
          <th>Prepared by</th><td>${esc(e.sentBy || meta.settings.initials || e.createdBy)}, MHL</td><th>Species</th><td>${esc(meta.species[e.species]?.name || 'Not stated')}</td></tr>
        <tr><th>Project</th><td colspan="5"><strong>${esc(e.title)}</strong></td></tr>
      </tbody></table>
      ${e.description ? `<h2 class="rep-h">Scope of work</h2><p class="rep-comment">${esc(e.description)}</p>` : ''}
      <h2 class="rep-h">Estimated charges</h2>
      ${linesTable(meta, p, { print: true })}
      ${p.toConfirm ? '<p class="small"><strong>Lines marked “to be confirmed” are not priced yet and are not in the total.</strong></p>' : ''}
      <h2 class="rep-h">Assumptions and terms</h2>
      <ul class="assume est-terms">
        ${ESTX.termsOf(e, p, { until, listName: d.priceList.name, listStatus: d.priceList.status }).map((t) => `<li>${esc(t)}</li>`).join('')}
      </ul>
      <div class="rep-foot small muted">${esc(d.label)} · printed ${fmtDate(meta.today)} · MHL LIMS pilot</div>
    </article>`;
  pageTop(app);
  $('#print').addEventListener('click', () => window.print());
}

// ---------- email ----------
// The pilot builds the email; the user's email program sends it. See core/estimatemail.mjs.
const METHOD_DONE = { outlook: 'Email file downloaded', copy: 'Email copied', mailto: 'Email program opened' };

async function copyRich(html, text) {
  try {
    if (navigator.clipboard && window.ClipboardItem) {
      await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]);
      return true;
    }
  } catch { /* fall back below */ }
  // Older browsers, or no permission: select a hidden copy of the email and use the copy command, which keeps formatting.
  const box = document.createElement('div');
  box.contentEditable = 'true'; box.style.cssText = 'position:fixed;left:-10000px;top:0;width:760px;background:#fff';
  box.innerHTML = html;
  document.body.appendChild(box);
  const range = document.createRange(); range.selectNodeContents(box);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(range);
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  sel.removeAllRanges(); box.remove();
  return ok;
}
async function copyPlain(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const t = Object.assign(document.createElement('textarea'), { value: text });
  t.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.appendChild(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}
const openLink = (href) => { const a = Object.assign(document.createElement('a'), { href }); document.body.appendChild(a); a.click(); a.remove(); };

function emailedBefore(list) {
  if (!list.length) return '';
  return `<h3 class="section">Emailed before</h3><table class="t"><tbody>${list.slice().reverse().map((m) => `<tr><td class="small">${fmtDateTime(m.at)}<br>${esc(m.by)}</td>
    <td class="small">${m.kind === 'review' ? 'Draft for review' : m.kind === 'copy' ? 'Copy' : 'Estimate'} to ${esc(m.to.join(', '))}${m.cc.length ? `<br>copy to ${esc(m.cc.join(', '))}` : ''}<br><span class="muted">${esc(MAIL.METHODS[m.method] || m.method)}</span></td></tr>`).join('')}</tbody></table>`;
}

export async function renderEstimateEmail(app, id) {
  const [d, f] = await Promise.all([api('GET', `/api/estimates/${id}`), api('GET', `/api/estimates/${id}/email`)]);
  const e = d.estimate;
  if (f.problem) {
    app.innerHTML = `${topHtml(d)}<p class="note">${esc(f.problem)}</p><p><a href="#/estimates/${e.id}">Back to ${esc(d.label)}</a></p>`;
    pageTop(app);
    return;
  }
  const draft = e.status === 'DRAFT';
  const canSend = draft && !f.sendProblems.length;
  let kind = draft ? (canSend ? 'send' : 'review') : f.kinds[0];
  // A draft for review goes to a colleague, so the investigator's address is not filled in for it.
  const investigatorTo = f.to.join('; ');
  const toFor = (k) => (k === 'review' ? '' : investigatorTo);
  app.innerHTML = `
    ${topHtml(d)}
    <h2 class="section">Email ${esc(d.label)}</h2>
    <p class="muted" style="max-width:900px">The email opens in your email program, addressed and ready, with the estimate laid out in the message. You check it there and click Send, so a copy stays in your Sent Items; the pilot itself never sends email.</p>
    <div class="split even">
      <div>
        <form class="form" id="mform" onsubmit="return false" style="grid-template-columns:1fr">
          ${draft ? `<div class="field"><span class="lbl">This email is</span>
            <div class="checks" style="flex-direction:column;align-items:flex-start;gap:6px">
              <label><input type="radio" name="mkind" value="send" ${kind === 'send' ? 'checked' : ''} ${canSend ? '' : 'disabled'}> The estimate, to the investigator. ${esc(d.label)} is then marked as sent: prices fixed, valid until ${fmtDate(f.validUntil)}.</label>
              <label><input type="radio" name="mkind" value="review" ${kind === 'review' ? 'checked' : ''}> A draft for review, to a colleague. It stays a draft.</label>
            </div>
            ${canSend ? '' : `<p class="small fitnote">Before it can go to the investigator: ${f.sendProblems.slice(0, 4).map(esc).join(' ')}${f.sendProblems.length > 4 ? ` (and ${f.sendProblems.length - 4} more)` : ''} <a href="#/estimates/${e.id}">Back to the draft</a></p>`}</div>` : ''}
          <div class="field"><label for="mto">To</label><input id="mto" value="${esc(toFor(kind))}" placeholder="${kind === 'review' ? 'a colleague, e.g. name@nih.gov' : 'name@nih.gov'} (separate addresses with ;)" autocomplete="off"></div>
          <div class="field"><label for="mcc">Cc</label><input id="mcc" value="${esc(f.cc)}" placeholder="for example the lab's shared mailbox" autocomplete="off"></div>
          <div class="field"><label for="msub">Subject</label><input id="msub" maxlength="200" value="${esc(f.defaults[kind].subject)}"></div>
          <div class="field"><label for="mmsg">Message</label><textarea id="mmsg" rows="10" maxlength="${MAIL.MAX_MESSAGE}">${esc(f.defaults[kind].message)}</textarea></div>
          <div class="field"><label for="msign">Sign-off</label><textarea id="msign" rows="4" maxlength="${MAIL.MAX_SIGNOFF}">${esc(f.signOff)}</textarea></div>
          <div class="checks" style="flex-direction:column;align-items:flex-start;gap:6px">
            <label><input type="checkbox" id="mcsv" checked> Attach the lines as a spreadsheet (CSV) <span class="small muted">with Open in Outlook</span></label>
            <label><input type="checkbox" id="mremember"> Remember this Cc and sign-off for my next estimate emails</label>
          </div>
          ${f.remembered ? '<p class="small muted" id="mforgetline">Your saved Cc and sign-off are filled in. <button class="btn small quiet" type="button" id="mforget">Forget them</button></p>' : ''}
        </form>
        <p class="small fitnote" id="mcheck" aria-live="polite"></p>
        <div class="actions" style="flex-wrap:wrap">
          <button class="btn" type="button" data-method="outlook">Open in Outlook</button>
          <button class="btn quiet" type="button" data-method="copy">Copy the email</button>
          <button class="btn quiet" type="button" data-method="mailto">Other email program</button>
          <a class="btn quiet" href="#/estimates/${e.id}">Cancel</a>
        </div>
        <ul class="assume">
          <li><strong>Open in Outlook</strong> downloads ${esc(MAIL.emlName(e))}. Open it from the browser's downloads and Outlook shows a new message, addressed and ready to send.</li>
          <li><strong>Copy the email</strong> puts the formatted email on the clipboard, to paste into a new message: for Outlook on the web, or if the file opens as a received message.</li>
          <li><strong>Other email program</strong> opens your default email program with a plain-text version and no attachment.</li>
        </ul>
        ${emailedBefore(f.emails)}
      </div>
      <div>
        <h3>Preview</h3>
        <p class="small" id="psub"></p>
        <iframe id="mprev" class="est-mail-prev" sandbox="allow-same-origin" title="Preview of the email"></iframe>
      </div>
    </div>`;
  pageTop(app);

  const mail = () => MAIL.estimateEmail(e, d.priced, { ...f.options, kind, subject: $('#msub').value, message: $('#mmsg').value, signOff: $('#msign').value });
  const addresses = () => {
    const to = MAIL.parseAddresses($('#mto').value); const cc = MAIL.parseAddresses($('#mcc').value);
    const bad = [...to.bad, ...cc.bad];
    const problem = bad.length ? `Not an email address: ${bad.slice(0, 3).join(', ')}` : !to.addresses.length ? 'Enter the address to send it to.'
      : to.addresses.length + cc.addresses.length > MAIL.MAX_RECIPIENTS ? `At most ${MAIL.MAX_RECIPIENTS} addresses.` : '';
    return { to: to.addresses, cc: cc.addresses, problem };
  };
  let timer = null;
  const preview = () => {
    if (!$('#msub') || !$('#mprev')) return;   // the page has moved on
    const m = mail();
    $('#psub').innerHTML = `<span class="muted">Subject:</span> ${esc(m.subject)}`;
    const frame = $('#mprev');
    frame.onload = () => { try { frame.style.height = `${Math.min(2400, Math.max(400, frame.contentDocument.body.scrollHeight + 30))}px`; } catch { /* keep the default height */ } };
    frame.srcdoc = m.html;
  };
  const check = () => { const a = addresses(); $('#mcheck').textContent = $('#mto').value.trim() || $('#mcc').value.trim() ? a.problem : ''; };
  $$('#msub, #mmsg, #msign').forEach((el) => el.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(preview, 250); }));
  $$('#mto, #mcc').forEach((el) => el.addEventListener('input', check));
  // Switching between the estimate and a draft for review swaps the wording, unless it has been changed by hand.
  $$('input[name="mkind"]').forEach((r) => r.addEventListener('change', () => {
    const was = f.defaults[kind]; const wasKind = kind; kind = r.value; const now = f.defaults[kind];
    if ($('#msub').value === was.subject) $('#msub').value = now.subject;
    if ($('#mmsg').value === was.message) $('#mmsg').value = now.message;
    if ($('#mto').value.trim() === toFor(wasKind)) $('#mto').value = toFor(kind);
    $('#mto').placeholder = `${kind === 'review' ? 'a colleague, e.g. name@nih.gov' : 'name@nih.gov'} (separate addresses with ;)`;
    check(); preview();
  }));
  $('#mforget')?.addEventListener('click', (ev) => act(ev.currentTarget, async () => {
    await api('PUT', '/api/settings', { estimateEmail: null });
    if ($('#mcc').value === f.cc) $('#mcc').value = '';
    if ($('#msign').value === f.signOff) $('#msign').value = f.defaultSignOff;
    $('#mforgetline').remove(); preview();
  }, 'The saved Cc and sign-off are forgotten'));
  // One email at a time: every method button is off while one is being prepared, so a double click records one email.
  const methodButtons = $$('[data-method]');
  methodButtons.forEach((b) => b.addEventListener('click', (ev) => act(ev.currentTarget, async () => {
    const method = b.dataset.method;
    const a = addresses();
    if (a.problem) { $('#mcheck').textContent = a.problem; throw new Error(a.problem); }
    if (method === 'mailto') {
      const m = MAIL.mailtoFor({ to: a.to, cc: a.cc, subject: $('#msub').value, mail: mail() });
      if (m.tooLong) throw new Error('This email is too long for an email link. Shorten the message, or use Open in Outlook or Copy the email.');
      if (m.short && !window.confirm('The itemized lines are too long for an email link, so the email will have a summary and say the itemized estimate is in the attached PDF. Attach a PDF of the estimate before sending (open Print, then Save as PDF). Continue?')) return null;
    }
    methodButtons.forEach((x) => { x.disabled = true; });
    let r;
    try {
      r = await api('POST', `/api/estimates/${e.id}/email`, { to: a.to, cc: a.cc, subject: $('#msub').value, message: $('#mmsg').value, signOff: $('#msign').value,
        markSent: draft && kind === 'send', method, attachCsv: $('#mcsv').checked, remember: $('#mremember').checked });
    } finally { methodButtons.forEach((x) => { if (x.isConnected) x.disabled = false; }); }
    clearTimeout(timer);
    let copied = false;
    if (method === 'outlook') saveFile(r.emlName, 'message/rfc822', r.eml);
    else if (method === 'copy') copied = await copyRich(MAIL.htmlBody(r.html), r.text);
    else openLink(r.mailto);
    await emailDone(app, id, r, copied);
    return r;
  }, (r) => (r ? `${METHOD_DONE[r.method]}${r.sent ? `; ${r.label} is marked as sent` : ''}` : null))));
  preview();
}

async function emailDone(app, id, r, copied) {
  const d = await api('GET', `/api/estimates/${id}`);
  const who = `${r.to.join('; ')}${r.cc.length ? ` (copy to ${r.cc.join('; ')})` : ''}`;
  const how = {
    outlook: `<p><strong>${esc(r.emlName)}</strong> has been downloaded. Open it from the browser's downloads (or your Downloads folder): Outlook opens a new message to ${esc(who)}, ready to send. Check it, then click <strong>Send</strong>.</p>
      <p class="small muted">If it opens as a received message instead (new Outlook and Outlook on the web may do this), copy the email and paste it into a new message.</p>
      <div class="actions"><button class="btn quiet" type="button" id="again">Download it again</button><button class="btn quiet" type="button" id="copyhtml">Copy the email</button></div>`,
    copy: `<p>${copied ? 'The email is on the clipboard.' : '<strong>The browser did not allow copying.</strong> Use Copy the email again.'} Start a new message to ${esc(who)} with the subject below, then paste (Ctrl+V).</p>
      <p><span class="muted">Subject:</span> ${esc(r.subject)}</p>
      <div class="actions"><button class="btn quiet" type="button" id="copyto">Copy the addresses</button><button class="btn quiet" type="button" id="copysub">Copy the subject</button><button class="btn quiet" type="button" id="copyhtml">Copy the email again</button></div>`,
    mailto: `<p>Your email program should have opened a new message to ${esc(who)}. Check it, then click <strong>Send</strong>.</p>
      ${r.mailtoShort ? `<p class="note">The itemized lines did not fit in an email link, so the message has a summary and says the itemized estimate is attached as a PDF. Attach it before sending: <a href="#/estimates/${id}/print">open the printable estimate</a> and print it to PDF.</p>` : ''}
      <div class="actions"><button class="btn quiet" type="button" id="again">Open it again</button><button class="btn quiet" type="button" id="copyhtml">Copy the email instead</button></div>`,
  }[r.method];
  app.innerHTML = `
    ${topHtml(d)}
    <h2 class="section">${esc(METHOD_DONE[r.method])}</h2>
    <div style="max-width:860px">${how}
      ${r.sent ? `<p class="note ok">${esc(r.label)} is marked as sent: its prices are fixed and it is valid until ${fmtDate(r.sent.validUntil)}. When the investigator replies, record the answer on the estimate.</p>`
        : r.kind === 'review' ? `<p class="note info">${esc(r.label)} is still a draft.</p>` : ''}
      <p class="section"><a class="btn" href="#/estimates/${id}">Back to ${esc(r.label)}</a></p>
    </div>`;
  pageTop(app);
  const say = (ok, what) => toast(ok ? `${what} copied` : 'The browser did not allow copying', ok ? 'ok' : 'error');
  $('#again')?.addEventListener('click', () => (r.method === 'outlook' ? saveFile(r.emlName, 'message/rfc822', r.eml) : openLink(r.mailto)));
  $('#copyhtml')?.addEventListener('click', async () => say(await copyRich(MAIL.htmlBody(r.html), r.text), 'Email'));
  $('#copyto')?.addEventListener('click', async () => say(await copyPlain([...r.to, ...r.cc].join('; ')), 'Addresses'));
  $('#copysub')?.addEventListener('click', async () => say(await copyPlain(r.subject), 'Subject'));
}
