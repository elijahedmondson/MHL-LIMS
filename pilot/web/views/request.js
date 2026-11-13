// Request page. Every request has the same tabs in the same order: Overview (journey, PHL numbers, moves), Labels,
// Estimate, Necropsy, Bloodwork, Pathology, Slide images, Charges and History; a tab that does not apply says so. An IHC
// order's bench worksheet is under Molecular.
import { $, $$, api, esc, money, fmtDate, fmtDateTime, getMeta, getPriceList, areaName, sectionName, statusBadge, act, pageTop, options, code128Svg, subjectLabel, animalDetails } from '../ui.js';
import { amount } from '../lib/rules.mjs';
import { pathologySummaryHtml, wireSummary, casesTable } from './reports.js';
import { requestImagesHtml } from './wsiviews.js';

const chargeFilter = {};
const R_sum = (xs) => Math.round(xs.reduce((a, x) => a + x, 0) * 100) / 100;
const TABS = [['overview', 'Overview'], ['labels', 'Labels'], ['estimate', 'Estimate'], ['necropsy', 'Necropsy'], ['bloodwork', 'Bloodwork'], ['pathology', 'Pathology'],
  ['images', 'Slide images'], ['charges', 'Charges'], ['history', 'History']];

export async function renderRequest(app, id, tab) {
  const [d, meta] = await Promise.all([api('GET', `/api/requests/${id}`), getMeta()]);
  const r = d.request;
  const restricted = d.subjects.some((s) => s.restricted);
  const pending = d.charges.filter((c) => c.status === 'PENDING').length;
  // The old "IHC worksheet" tab moved to Molecular.
  if (tab === 'ihc') { location.replace(d.webRequest ? `#/molecular/request/${d.webRequest.id}` : `#/request/${r.id}`); return; }
  const tabs = TABS;
  // Tabs that do not apply to this request are dimmed (they still open, and say why they are empty).
  const applies = { necropsy: r.areas.includes('NECRO'), bloodwork: r.areas.includes('BLOOD') || d.bloodwork.results.length > 0 || d.bloodwork.cytology.length > 0,
    pathology: r.areas.includes('PATHO'), images: r.areas.includes('IMAGE') || d.images.length > 0 };
  app.innerHTML = `
    <div class="crumb"><a href="#/">Look up</a></div>
    <div class="head">
      <h1>${esc(r.number)}</h1>
      ${statusBadge(r.status)}
      ${restricted ? '<span class="restricted" title="Visible only to staff with the human tissue role">Restricted</span>' : ''}
    </div>
    <div class="facts">
      <span><b>${esc(r.typeName)}</b></span>
      <span>${esc(r.piName)}</span>
      <span>Received <b>${fmtDate(r.received)}</b></span>
      <span>${r.completed ? `Completed <b>${fmtDate(r.completed)}</b>` : `Due <b class="${r.due < meta.today ? 'overdue' : ''}">${fmtDate(r.due)}${r.due < meta.today ? ' (overdue)' : ''}</b>`}</span>
      <span>${d.subjects.length} PHL numbers</span>
    </div>
    <nav class="subtabs" aria-label="Request sections">
      ${tabs.map(([k, label]) => `<a href="#/request/${r.id}/${k}" ${k === tab ? 'aria-current="page"' : ''} class="${applies[k] === false ? 'na' : ''}" ${applies[k] === false ? 'title="Not part of this request"' : ''}>${label}${k === 'charges' && pending ? `<span class="count" title="Charges waiting for billing QC">${pending}</span>` : ''}</a>`).join('')}
    </nav>
    <div id="tab"></div>`;
  const box = $('#tab');
  const reload = () => renderRequest(app, id, tab);
  if (tab === 'charges') await chargesTab(box, d, meta, reload);
  else if (tab === 'estimate') estimateTab(box, d, meta);
  else if (tab === 'labels') labelsTab(box, d);
  else if (tab === 'history') historyTab(box, d, meta);
  else if (tab === 'necropsy') await necropsyTab(box, d, meta);
  else if (tab === 'bloodwork') bloodworkTab(box, d, applies.bloodwork);
  else if (tab === 'images') { box.innerHTML = applies.images ? requestImagesHtml(d) : notPart('slide scanning', 'Scan', r, meta); }
  else if (tab === 'pathology') await pathologyTab(box, r, d, meta, reload);
  else overviewTab(box, d, meta, reload);
  pageTop(app);
}

function journey(d, meta) {
  const track = d.track;
  const pos = (code) => { const i = track.findIndex((a) => a.code === code); return i < 0 ? 0 : ((i + 0.5) / track.length) * 100; };
  return `
    <section class="journey pre" aria-label="Where each PHL number is">
      <div class="journey-grid" style="grid-template-columns: 124px repeat(${track.length}, minmax(60px, 1fr));">
        <div></div>${track.map((a) => `<div class="j-head">${esc(a.name)}</div>`).join('')}
        ${d.subjects.map((s) => `
          <div class="j-phl">${esc(s.phl)}${s.priority === 'S' ? '<span class="badge stat">STAT</span>' : ''}</div>
          <div class="j-track" style="grid-column: span ${track.length}; --to: ${pos(s.area)}%" title="${esc(s.phl)}: ${esc(areaName(meta, s.area))} since ${fmtDate(s.since)}">
            <div class="j-done"></div><div class="j-dot ${meta.terminalAreas.includes(s.area) ? 'done' : ''}"></div>
          </div>`).join('')}
      </div>
    </section>`;
}

function meter(f) {
  if (f.authorized == null) return '<p class="muted">No NAS authorization on file.</p>';
  const pct = (v) => Math.min(100, (v / f.authorized) * 100);
  const shared = f.nasRequests > 1;
  if (shared) {
    // A NAS request funding several requests: the bar is everything charged to it; this request's share is in the key.
    const over = f.nasCharged > f.authorized;
    return `
    <div class="meter">
      <div class="meter-bar ${over ? 'over' : ''}" role="img" aria-label="Charged ${money(f.nasCharged)} of ${money(f.authorized)} authorized, across ${f.nasRequests} requests">
        <div class="meter-fill" style="width:${pct(f.nasCharged)}%"></div>
        <div class="meter-est" style="left:calc(${pct(f.nasEstimated)}% - 1px)" title="Estimates of all ${f.nasRequests} requests ${money(f.nasEstimated)}"></div>
      </div>
      <div class="meter-key">
        <div><b>${money(f.charged)}</b>charged to this request (estimate ${money(f.estimate)})</div>
        <div><b>${money(f.nasCharged)}</b>charged across the ${f.nasRequests} requests on the NAS request</div>
        <div><b style="color:${over ? 'var(--amber)' : 'inherit'}">${money(Math.abs(f.remaining))}</b>${over ? 'over' : 'left of'} ${money(f.authorized)}</div>
      </div>
    </div>`;
  }
  const over = f.charged > f.authorized;
  return `
    <div class="meter">
      <div class="meter-bar ${over ? 'over' : ''}" role="img" aria-label="Charged ${money(f.charged)} of ${money(f.authorized)} authorized">
        <div class="meter-fill" style="width:${pct(f.charged)}%"></div>
        ${f.estimate ? `<div class="meter-est" style="left:calc(${pct(f.estimate)}% - 1px)" title="Estimate ${money(f.estimate)}"></div>` : ''}
      </div>
      <div class="meter-key">
        <div><b>${money(f.charged)}</b>charged so far</div>
        <div><b>${money(f.estimate)}</b>estimate</div>
        <div><b style="color:${over ? 'var(--amber)' : 'inherit'}">${money(Math.abs(f.remaining))}</b>${over ? 'over' : 'left of'} ${money(f.authorized)}</div>
      </div>
    </div>`;
}

function overviewTab(box, d, meta, reload) {
  const r = d.request;
  const hasNecro = r.areas.includes('NECRO');
  const necDone = d.subjects.filter((s) => s.necropsy === 'APPROVED').length;
  const allComplete = d.subjects.every((s) => meta.terminalAreas.includes(s.area));
  const groups = d.subjects.some((s) => s.groupCode);
  box.innerHTML = `
    ${journey(d, meta)}
    <div class="split section">
      <div>
        <h2>Funding</h2>
        <dl class="dl">
          <dt>NAS#</dt><dd>${d.nas ? `${esc(d.nas.number)}<span class="src">from NAS</span>` : '<span class="badge warn">Not linked yet</span>'}</dd>
          <dt>Project</dt><dd>${esc(r.project || 'None')}<span class="src">${d.webRequest && !d.nas ? 'from the IHC request' : 'Costpoint'}</span></dd>
          ${d.nas && d.financials.otherRequests.length ? `<dt>Shared with</dt><dd>${d.financials.otherRequests.map((x) => `<a class="idtxt" href="#/request/${x.id}">${esc(x.number)}</a>`).join(', ')} <span class="muted small">also funded by NAS# ${esc(d.nas.number)}</span></dd>` : ''}
          ${d.webRequest ? `<dt>IHC request</dt><dd><a class="idtxt" href="#/molecular/request/${d.webRequest.id}">${esc(d.webRequest.number)}</a> <span class="muted small">submitted ${fmtDate(d.webRequest.submittedOn)}; worksheet and assignment under Molecular</span></dd>` : ''}
          ${d.xeniumRuns.length ? `<dt>Xenium</dt><dd>${d.xeniumRuns.map((x) => `<a class="idtxt" href="#/molecular/xenium/run/${x.id}">${esc(x.number)}</a> <span class="muted small">${esc(x.statusLabel)}</span>`).join('<br>')}</dd>` : ''}
        </dl>
        ${!d.nas && d.openNas.length ? `<div class="row" style="margin-top:10px"><select id="linknas" class="inp" style="width:auto" aria-label="NAS request to link">${options(d.openNas.map((n) => [n.id, `${n.number}, ${n.requester.last}, ${money(n.authorized)}`]), d.openNas.find((n) => n.requester.last === r.pi.last)?.id || '', { blank: 'Choose a NAS request' })}</select>
          <button class="btn small" type="button" id="dolink">Link NAS request</button></div>` : ''}
        ${!d.nas && !d.openNas.length ? '<p class="small muted">No open NAS request to link. Add one under New request (pilot only).</p>' : ''}
        ${meter(d.financials)}
        <h2 class="section">Investigator and study</h2>
        <dl class="dl">
          <dt>Investigator</dt><dd>${esc(r.piName)}<br><span class="muted">${esc(r.pi.inst)}</span></dd>
          ${d.study ? `<dt>Study</dt><dd><a href="#/study/${d.study.id}">${esc(d.study.zap)}</a><br><span class="muted">${esc(d.study.title)}</span></dd>
            <dt>ACUC protocol</dt><dd>${esc(d.study.acuc || 'Not recorded')}</dd>` : ''}
          ${hasNecro ? `<dt>Necropsy</dt><dd>${necDone} of ${d.subjects.length} approved <a href="#/necropsy">Open necropsy worklist</a></dd>` : ''}
          <dt>Description</dt><dd>${esc(r.description || '')}</dd>
          ${r.tissueDisp ? `<dt>Tissue disposition</dt><dd>${esc(r.tissueDisp)}</dd>` : ''}
          ${r.numberEnteredByHand ? `<dt>Request number</dt><dd>${esc(r.number)} <span class="muted small">entered by hand at intake</span></dd>` : ''}
          ${r.animalList ? `<dt>Animal list</dt><dd>${r.animalList.animals} animals${r.animalList.fileName ? ` from ${esc(r.animalList.fileName)}` : ''} <span class="muted small">read by ${esc(r.animalList.by)}, ${fmtDateTime(r.animalList.at)}</span></dd>` : ''}
        </dl>
        ${r.status === 'Open' ? `<div class="actions"><button class="btn quiet" id="complete" type="button" ${allComplete ? '' : 'disabled title="Every PHL number must reach Complete first"'}>Complete request</button>
          ${r.areas.includes('PATHO') ? '' : '<button class="btn quiet" id="addpath" type="button" title="Adds the Pathology work area so a pathologist can read and report these samples">Add pathology review</button>'}</div>` : ''}
      </div>
      <div>
        <h2>PHL numbers</h2>
        <div class="row" style="margin-bottom:8px">
          <label class="small muted" for="to">Move selected to</label>
          <select id="to" class="inp" style="width:auto">${options(d.track.map((a) => [a.code, a.name]), '')}</select>
          <button class="btn small" type="button" id="move">Move</button>
          <span class="small muted" id="selcount">0 selected</span>
        </div>
        <table class="t" id="subjects">
          <thead><tr><th><input type="checkbox" id="all" aria-label="Select all"></th><th>PHL#</th><th>${d.study ? 'Animal' : d.webRequest ? 'Sample' : 'ID'}</th>${groups ? '<th>Group</th>' : ''}<th>Where</th><th>Since</th>${hasNecro ? '<th>Necropsy</th>' : ''}${r.areas.includes('PATHO') ? '<th>Pathology</th>' : ''}</tr></thead>
          <tbody>${d.subjects.map((s) => `
            <tr>
              <td class="mid"><input type="checkbox" class="sel" value="${s.id}" aria-label="Select ${esc(s.phl)}"></td>
              <td class="code">${esc(s.phl)} ${s.priority === 'S' ? '<span class="badge stat">STAT</span>' : ''}</td>
              <td>${esc(s.label)}${animalDetails(s) ? `<br><span class="small muted">${esc(animalDetails(s))}</span>` : ''}${s.notes ? `<br><span class="small">${esc(s.notes)}</span>` : ''}</td>${groups ? `<td>${esc(s.groupCode || '')}${s.sex ? ` (${esc(s.sex)})` : ''}</td>` : ''}
              <td>${esc(areaName(meta, s.area))}</td><td>${fmtDate(s.since)}</td>
              ${hasNecro ? `<td>${s.necropsy === 'APPROVED' ? `<a class="badge complete" href="#/report/${s.id}/necropsy" title="Necropsy report">Approved</a>` : `<a href="#/necropsy/${s.id}">${s.necropsy === 'DRAFT' ? 'Draft' : 'Start'}</a>`}</td>` : ''}
              ${r.areas.includes('PATHO') ? `<td>${s.pathology === 'SIGNED' ? `<a class="badge complete" href="#/report/${s.id}/pathology" title="Pathology report">Signed out</a>` : hasNecro && s.necropsy !== 'APPROVED' ? '<span class="small muted">After necropsy</span>' : `<a href="#/pathology/${s.id}">${s.pathology === 'DRAFT' ? 'Draft' : 'Start'}</a>`}</td>` : ''}
            </tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => $('.journey', box)?.classList.remove('pre')));
  const sel = () => $$('.sel:checked', box).map((c) => Number(c.value));
  const count = () => { $('#selcount').textContent = `${sel().length} selected`; };
  $$('.sel', box).forEach((c) => c.addEventListener('change', count));
  $('#all').addEventListener('change', (e) => { $$('.sel', box).forEach((c) => { c.checked = e.target.checked; }); count(); });
  $('#move').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await api('POST', `/api/requests/${r.id}/move`, { to: $('#to').value, subjectIds: sel() });
    await reload();
    return res;
  }, (res) => `${res.moved} moved to ${areaName(meta, $('#to')?.value) || 'the new area'}`));
  $('#complete')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/requests/${r.id}/complete`, {}); await reload(); }, 'Request completed'));
  $('#addpath')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/requests/${r.id}/add-pathology`, {}); location.hash = `#/request/${r.id}/pathology`; }, 'Pathology review added'));
  $('#dolink')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/requests/${r.id}/nas`, { nasId: Number($('#linknas').value) }); await reload(); }, 'NAS request linked'));
}

async function chargesTab(box, d, meta, reload) {
  const r = d.request;
  const pl = await getPriceList();
  const f = d.financials;
  const today = meta.today;
  const priced = (code) => pl.items.find((i) => i.code === code);
  const pending = d.charges.filter((c) => c.status === 'PENDING');
  const FILTERS = [['open', 'To bill'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['RELEASED', 'Released'], ['VOID', 'Void'], ['all', 'All']];
  const inFilter = (c, k) => k === 'all' || (k === 'open' ? ['PENDING', 'APPROVED'].includes(c.status) : c.status === k);
  const countOf = (k) => d.charges.filter((c) => inFilter(c, k)).length;
  const filter = chargeFilter[r.id] && countOf(chargeFilter[r.id]) ? chargeFilter[r.id] : countOf('open') ? 'open' : 'all';
  const rows = (k) => {
    const list = d.charges.filter((c) => inFilter(c, k));
    const shown = R_sum(list.filter((c) => c.status !== 'VOID').map((c) => c.amount));
    return `<table class="t" id="charges">
          <thead><tr><th>Date</th><th>Code</th><th>Description</th><th class="n">Units</th><th class="n">Amount</th><th>Status</th><th><span hidden>Actions</span></th></tr></thead>
          <tbody>${list.map((c) => `
            <tr class="${c.status === 'VOID' ? 'void' : ''}">
              <td>${fmtDate(c.date)}</td>
              <td class="code">${esc(c.code)}</td>
              <td>${esc(c.codeDescription)}${c.note ? `<br><span class="muted">${esc(c.note)}</span>` : ''}
                ${c.phl ? `<br><span class="small muted">${esc(c.phl)}</span>` : ''}
                ${c.sourceType === 'EVENT' ? '<span class="src">from necropsy</span>' : ''}${c.sourceType === 'ADJUSTMENT' ? '<span class="src">adjustment</span>' : ''}
                ${c.status === 'VOID' && c.voidReason ? `<br><span class="small muted keep">Void: ${esc(c.voidReason)}</span>` : ''}</td>
              <td class="n">${c.units}</td>
              <td class="n">${money(c.amount)}</td>
              <td class="keep"><span class="status-${c.status}">${esc(c.status[0] + c.status.slice(1).toLowerCase())}</span>${c.batch ? `<br><span class="small muted">${esc(c.batch)}</span>` : ''}
                ${c.approvedBy && c.status !== 'VOID' ? `<br><span class="small muted">QC ${esc(c.approvedBy)}</span>` : ''}</td>
              <td class="keep"><div class="rowbtns">
                ${c.status === 'PENDING' ? `<button class="btn small quiet" data-act="edit" data-id="${c.id}">Edit</button><button class="btn small" data-act="approve" data-id="${c.id}">Approve</button><button class="btn small quiet" data-act="void" data-id="${c.id}">Void</button>` : ''}
                ${c.status === 'APPROVED' ? `<button class="btn small quiet" data-act="return" data-id="${c.id}">Return</button><button class="btn small quiet" data-act="void" data-id="${c.id}">Void</button>` : ''}
                ${c.status === 'RELEASED' && c.sourceType !== 'ADJUSTMENT' ? `<button class="btn small quiet" data-act="adjust" data-id="${c.id}">Adjust</button>` : ''}
              </div></td>
            </tr>`).join('')}
            <tr class="total"><td colspan="4">${k === 'all' ? 'Total (excluding void)' : `Shown (${list.length} lines)`}</td><td class="n">${money(shown)}</td><td colspan="2" class="small muted">All charges: ${money(f.charged)}</td></tr>
          </tbody></table>`;
  };
  box.innerHTML = `
    <div class="split wide-left">
      <div>
        <h2>Charges</h2>
        ${d.charges.length ? `<div class="filters" role="group" aria-label="Show charges">${FILTERS.map(([k, label]) => `<button type="button" data-filter="${k}" aria-pressed="${k === filter}">${label} (${countOf(k)})</button>`).join('')}</div>
        <div id="chargelist"></div>`
        : '<p class="empty">No charges yet. Add one below, or approve a necropsy to create its charges.</p>'}
        ${pending.length ? `<div class="actions"><button class="btn" id="approve-all" type="button">Approve all ${pending.length} pending</button></div>` : ''}

        <h2 class="section">Add a charge</h2>
        <form class="form three" id="add">
          <div class="field"><label for="sec">Section</label><select id="sec">${options(meta.sections.map((s) => [s.code, s.name]), meta.sections[0].code)}</select></div>
          <div class="field" style="grid-column: span 2"><label for="code">Charge code</label><select id="code"></select></div>
          <div class="field"><label for="units">Units</label><input id="units" type="number" min="0.25" step="0.25" value="1"></div>
          <div class="field"><label for="date">Charge date</label><input id="date" type="date" value="${today}"></div>
          <div class="field"><label for="subj">PHL# (optional)</label><select id="subj">${options(d.subjects.map((s) => [s.id, s.phl]), '', { blank: 'Whole request' })}</select></div>
          <div class="field full"><label for="note">Description of the work <span id="needs" class="small"></span></label><input id="note" maxlength="300" placeholder="Required for labor, reagent and custom stain codes"></div>
          <div class="full row"><button class="btn" type="submit">Add charge</button><span id="preview" class="muted"></span></div>
        </form>
      </div>
      <div>
        <h2>Against the NAS authorization</h2>
        ${meter(f)}
        <h2 class="section">Billing QC</h2>
        <p class="small muted">Record that someone has checked this request's charges, like the Billing QC row of the worksheet.</p>
        <div class="field"><label for="rc">Comment (optional)</label><input id="rc" class="inp" maxlength="500"></div>
        <div class="actions" style="margin-top:10px">
          <button class="btn quiet" type="button" data-review="OK">Charges look right</button>
          <button class="btn quiet" type="button" data-review="CORRECTIONS_NEEDED">Corrections needed</button>
        </div>
        ${d.reviews.length ? `<table class="t section"><thead><tr><th>When</th><th>Who</th><th>Outcome</th></tr></thead><tbody>
          ${d.reviews.slice().reverse().map((v) => `<tr><td>${fmtDateTime(v.at)}</td><td>${esc(v.by)}</td><td>${v.outcome === 'OK' ? 'OK' : 'Corrections needed'}${v.comment ? `<br><span class="muted small">${esc(v.comment)}</span>` : ''}</td></tr>`).join('')}
        </tbody></table>` : '<p class="small muted section">Not reviewed yet.</p>'}
      </div>
    </div>`;

  const list = $('#chargelist');
  if (list) list.innerHTML = rows(filter);
  $$('[data-filter]', box).forEach((b) => b.addEventListener('click', () => { chargeFilter[r.id] = b.dataset.filter; reload(); }));
  const codeSel = $('#code');
  const fillCodes = () => {
    const sec = $('#sec').value;
    const items = pl.items.filter((i) => i.sections.includes(sec));
    codeSel.innerHTML = items.map((i) => `<option value="${i.code}">${esc(i.code)}  ${esc(i.description)}  ${i.price == null ? '(not priced)' : money(i.price)}</option>`).join('');
    update();
  };
  const update = () => {
    const item = priced(codeSel.value);
    const units = Number($('#units').value);
    $('#needs').textContent = item?.requiresDescription ? '(required for this code)' : '';
    $('#preview').textContent = item && item.price != null && units > 0 ? `${units} × ${money(item.price)} = ${money(amount(units, item.price))}` : item && item.price == null ? 'This code has no price and cannot be charged.' : '';
  };
  $('#sec').addEventListener('change', fillCodes);
  codeSel.addEventListener('change', update);
  $('#units').addEventListener('input', update);
  fillCodes();

  $('#add').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const res = await api('POST', `/api/requests/${r.id}/charges`, { section: $('#sec').value, code: codeSel.value, units: Number($('#units').value), date: $('#date').value, subjectId: $('#subj').value ? Number($('#subj').value) : null, note: $('#note').value });
      await reload();
      return res;
    }, (res) => `Added ${res.charge.code}, ${money(res.charge.amount)}`);
  });
  $('#approve-all')?.addEventListener('click', (e) => act(e.currentTarget, async () => { const res = await api('POST', `/api/requests/${r.id}/approve-pending`, {}); await reload(); return res; }, (res) => `${res.approved} charges approved`));
  $$('[data-review]', box).forEach((b) => b.addEventListener('click', () => act(b, async () => { await api('POST', `/api/requests/${r.id}/review`, { outcome: b.dataset.review, comment: $('#rc').value }); await reload(); }, 'Billing QC recorded')));

  $$('[data-act]', box).forEach((b) => b.addEventListener('click', () => {
    const c = d.charges.find((x) => x.id === Number(b.dataset.id));
    const kind = b.dataset.act;
    if (kind === 'approve') return act(b, async () => { await api('POST', `/api/charges/${c.id}/approve`, {}); await reload(); }, `${c.code} approved`);
    if (kind === 'return') return act(b, async () => { await api('POST', `/api/charges/${c.id}/return`, {}); await reload(); }, `${c.code} returned to pending`);
    if (kind === 'void') {
      const reason = prompt(`Void ${c.code} (${money(c.amount)})? Reason (optional):`, '');
      if (reason === null) return undefined;
      return act(b, async () => { await api('POST', `/api/charges/${c.id}/void`, { reason }); await reload(); }, `${c.code} voided`);
    }
    if (kind === 'edit') {
      const units = prompt(`Units for ${c.code}:`, String(c.units));
      if (units === null) return undefined;
      const note = prompt('Description of the work:', c.note || '');
      if (note === null) return undefined;
      return act(b, async () => { await api('PATCH', `/api/charges/${c.id}`, { units: Number(units), note }); await reload(); }, `${c.code} updated`);
    }
    if (kind === 'adjust') {
      const delta = prompt(`Released charges are locked. Change in units for ${c.code} (for example -2 to credit two units):`, '');
      if (delta === null) return undefined;
      const reason = prompt('Reason for the adjustment:', '');
      if (reason === null) return undefined;
      return act(b, async () => { await api('POST', `/api/charges/${c.id}/adjust`, { unitsDelta: Number(delta), reason }); await reload(); }, 'Adjustment added as a pending charge');
    }
    return undefined;
  }));
}

function estimateTab(box, d, meta) {
  const r = d.request;
  const auth = d.financials.authorized;
  const bySection = new Map();
  for (const l of r.estimateLines) { const list = bySection.get(l.section) || []; list.push(l); bySection.set(l.section, list); }
  box.innerHTML = `
    <div class="split wide-left">
      <div>
        <h2>Initial cost estimate</h2>
        <p class="muted">Planned units entered at intake, priced from the ${esc(meta.priceList.name)} list on ${fmtDate(r.received)}. This is the "planned" side of the billing worksheet.</p>
        <table class="t"><thead><tr><th>Code</th><th>Description</th><th class="n">Units</th><th class="n">Price</th><th class="n">Amount</th></tr></thead>
          <tbody>${[...bySection].map(([s, lines]) => `<tr class="sec"><td colspan="5">${esc(sectionName(meta, s))}</td></tr>` + lines.map((l) => `
            <tr><td class="code">${esc(l.code)}</td><td>${esc(l.description)}</td><td class="n">${l.units}</td><td class="n">${money(l.unitPrice)}</td><td class="n">${money(l.amount)}</td></tr>`).join('')).join('')}
            <tr class="total"><td colspan="4">Estimate</td><td class="n">${money(r.estimateTotal)}</td></tr>
          </tbody></table>
      </div>
      <div>
        <h2>Compared with</h2>
        <dl class="dl"><dt>NAS authorized</dt><dd>${auth == null ? 'None' : money(auth)}</dd><dt>Charged so far</dt><dd>${money(d.financials.charged)}</dd>
          <dt>Estimate</dt><dd>${money(r.estimateTotal)}</dd>
          ${d.financials.nasRequests > 1 ? `<dt>All requests on the NAS</dt><dd>${money(d.financials.nasEstimated)} estimated, ${money(d.financials.nasCharged)} charged (${d.financials.nasRequests} requests)</dd>` : ''}
          ${r.estimatePhase ? `<dt>From estimate</dt><dd>Phase “${esc(r.estimatePhase)}”${d.nas?.estimateLabel ? ` of ${esc(d.nas.estimateLabel)}` : ''}</dd>` : ''}</dl>
        ${auth != null && d.financials.nasEstimated > auth ? `<p class="note">The estimate${d.financials.nasRequests > 1 ? 's of the requests on this NAS request come' : ' is'} to more than NAS authorized.</p>` : ''}
      </div>
    </div>`;
}

function labelsTab(box, d) {
  const r = d.request;
  box.innerHTML = `
    <div class="row"><p class="muted" style="margin:0">One request label and one jar label per PHL number, and the paper tracking sheet staff fill in as the samples move through the lab.</p><span class="spacer"></span><a class="btn" href="#/labels/${r.id}">Open printable labels</a><a class="btn quiet" href="#/tracking/${r.id}">Tracking sheet</a></div>
    <div class="labels">${[{ v: r.number, l2: r.piName, l3: d.nas ? `NAS# ${d.nas.number}` : '' }, ...d.subjects.slice(0, 11).map((s) => ({ v: s.phl, l2: `${r.number}, ${r.pi.last}`, l3: subjectLabel(s) }))].map((l) => `
      <div class="label">${code128Svg(l.v)}<div class="l1">${esc(l.v)}</div><div class="l2">${esc(l.l2)}</div><div class="l2">${esc(l.l3)}</div></div>`).join('')}</div>
    ${d.subjects.length > 11 ? `<p class="muted">and ${d.subjects.length - 11} more.</p>` : ''}`;
}

// A tab for work this request does not include.
function notPart(what, areaWord, r, meta) {
  return `<p class="empty">This request does not include ${what}. Its work areas are ${r.areas.map((a) => esc(meta.areas.find((x) => x.code === a)?.name || a)).join(', ') || 'none'}.</p>`;
}

async function pathologyTab(box, r, d, meta, reload) {
  if (!r.areas.includes('PATHO')) {
    box.innerHTML = `${notPart('pathology', 'Pathology', r, meta)}
      ${r.status === 'Open' ? '<div class="actions"><button class="btn quiet" id="addpath2" type="button">Add pathology review</button></div><p class="small muted">Adds the Pathology work area so a pathologist can read and report these samples.</p>' : ''}`;
    $('#addpath2')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/requests/${r.id}/add-pathology`, {}); await reload(); }, 'Pathology review added'));
    return;
  }
  const sum = await api('GET', `/api/requests/${r.id}/pathology`);
  box.innerHTML = `
    ${d.study ? `<div class="actions" style="margin-top:0"><a class="btn small" href="#/studyreport/${d.study.id}/pathology">Study pathology report (${esc(d.study.zap)})</a></div>` : ''}
    <div class="row"><p class="muted" style="margin:0">One pathology case per PHL number. ${r.areas.includes('NECRO') ? 'Cases open when the necropsy is approved.' : 'Tissues are added from the submitted material.'}</p>
      <span class="spacer"></span><a class="btn small quiet" href="#/pathology">Pathology worklist</a></div>
    <div class="section">${casesTable(sum)}</div>
    <section class="section" id="pathsum">${pathologySummaryHtml(sum, { csvPath: `/api/requests/${r.id}/pathology.csv`, scope: 'request', id: r.id, necropsy: r.areas.includes('NECRO') })}</section>`;
  wireSummary(box);
}

// Necropsy: every PHL number's necropsy, with the reports for the request and its study.
async function necropsyTab(box, d, meta) {
  const r = d.request;
  if (!r.areas.includes('NECRO')) { box.innerHTML = `${notPart('necropsy', 'Necropsy', r, meta)}${d.study ? `<p class="small"><a href="#/study/${d.study.id}">Study ${esc(d.study.zap)}</a></p>` : ''}`; return; }
  const n = await api('GET', `/api/requests/${r.id}/necropsy`);
  const label = { APPROVED: 'Approved', DRAFT: 'Draft', null: 'Not started' };
  box.innerHTML = `
    <div class="row"><p class="muted" style="margin:0">${n.approved} of ${n.animals.length} necropsies approved${n.drafts ? `, ${n.drafts} in draft` : ''}. ${n.protocol ? `Protocol: ${esc(n.protocol)}.` : ''}</p><span class="spacer"></span>
      <a class="btn small quiet" href="#/necropsy">Necropsy worklist</a>
      ${n.approved ? `<a class="btn small quiet" href="#/reports/request/${r.id}/necropsy">Print approved necropsy reports</a>` : ''}
      ${d.study ? `<a class="btn small" href="#/studyreport/${d.study.id}/necropsy">Study necropsy report (${esc(d.study.zap)})</a><a class="btn small quiet" href="#/study/${d.study.id}">Study page</a>` : ''}</div>
    <table class="t section"><thead><tr><th>PHL#</th><th>Animal</th>${n.groups ? '<th>Group</th>' : ''}<th>Necropsy</th><th>Date</th><th>Prosector</th><th>Fate</th><th class="n">Body weight (g)</th><th class="n">Organs collected</th><th class="n">Gross findings</th><th></th></tr></thead>
      <tbody>${n.animals.map((a) => `<tr>
        <td class="code">${esc(a.phl)}${a.priority === 'S' ? ' <span class="badge stat">STAT</span>' : ''}</td><td>${esc(a.label)}</td>${n.groups ? `<td>${esc(a.groupCode || '')}${a.sex ? ` (${esc(a.sex)})` : ''}</td>` : ''}
        <td><span class="badge ${a.status === 'APPROVED' ? 'complete' : a.status === 'DRAFT' ? 'warn' : 'muted'}">${label[a.status]}</span></td>
        <td>${fmtDate(a.date)}</td><td>${esc(a.prosector || '')}</td><td class="small">${esc(a.fate || '')}</td><td class="n">${a.bodyWeight ?? ''}</td>
        <td class="n">${a.organsTotal ? `${a.organsCollected} / ${a.organsTotal}` : ''}</td><td class="n">${a.status ? a.findings : ''}</td>
        <td><div class="rowbtns">${a.status === 'APPROVED' ? `<a class="btn small quiet" href="#/report/${a.id}/necropsy">Report</a>` : `<a class="btn small quiet" href="#/necropsy/${a.id}">${a.status === 'DRAFT' ? 'Continue' : 'Start'}</a>`}</div></td></tr>`).join('')}</tbody></table>`;
}

function bloodworkTab(box, d, applies = true) {
  const KIND = { HEMATOLOGY: 'Hematology', CHEMISTRY: 'Chemistry' };
  if (!applies) { box.innerHTML = '<p class="empty">This request does not include bloodwork, and no results have been matched to its PHL numbers.</p>'; return KIND; }
  const byPhl = d.subjects.map((s) => ({ s, results: d.bloodwork.results.filter((x) => x.subjectId === s.id), cyto: d.bloodwork.cytology.filter((x) => x.subjectId === s.id) }));
  box.innerHTML = `
    <div class="row"><p class="muted" style="margin:0">Hematology, chemistry and cytology for each PHL number. Results arrive under Bloodwork, are matched by PHL number, and count here once released.</p>
      <span class="spacer"></span><a class="btn small quiet" href="#/bloodwork">Bloodwork</a></div>
    <table class="t section"><thead><tr><th>PHL#</th><th>Animal</th><th>Hematology</th><th>Chemistry</th><th>Cytology</th><th></th></tr></thead><tbody>
      ${byPhl.map(({ s, results, cyto }) => {
        const cell = (kind) => results.filter((x) => x.kind === kind).map((x) => `<a href="#/bloodwork/result/${x.id}">${fmtDate(x.testedOn)}</a> <span class="small muted">${x.status === 'RELEASED' ? 'released' : x.status.toLowerCase().replace('_', ' ')}${x.flagged ? `, ${x.flagged} flagged` : ''}</span>`).join('<br>') || '<span class="muted">—</span>';
        return `<tr><td class="code">${esc(s.phl)}</td><td>${esc(s.label)}</td><td>${cell('HEMATOLOGY')}</td><td>${cell('CHEMISTRY')}</td>
          <td>${cyto.map((c) => `<a href="#/bloodwork/cytology/${c.id}">${esc(c.specimen)}</a> <span class="small muted">${c.status === 'SIGNED' ? 'signed' : 'draft'}</span>`).join('<br>') || '<span class="muted">—</span>'}</td>
          <td>${results.some((x) => x.status === 'RELEASED') || cyto.some((c) => c.status === 'SIGNED') ? `<a class="small" href="#/report/${s.id}/bloodwork">Report</a>` : ''}</td></tr>`;
      }).join('')}
    </tbody></table>`;
  return KIND;
}

function historyTab(box, d, meta) {
  box.innerHTML = `
    <div class="split even">
      <div>
        <h2>Tracking</h2>
        <table class="t"><thead><tr><th>When</th><th>PHL#</th><th>Move</th><th>Who</th></tr></thead><tbody>
          ${d.events.map((e) => `<tr><td>${fmtDateTime(e.at)}</td><td class="code">${esc(e.phl)}</td><td>${e.from ? `${esc(areaName(meta, e.from))} to ` : ''}${esc(areaName(meta, e.to))}${e.note ? `<br><span class="small muted">${esc(e.note)}</span>` : ''}</td><td>${esc(e.by)}</td></tr>`).join('')}
        </tbody></table>
        ${d.events.length >= 60 ? '<p class="small muted">Showing the latest 60 moves.</p>' : ''}
      </div>
      <div>
        <h2>Audit trail</h2>
        <table class="t"><thead><tr><th>When</th><th>Who</th><th>What</th></tr></thead><tbody>
          ${d.audit.map((a) => `<tr><td>${fmtDateTime(a.at)}</td><td>${esc(a.by)}</td><td>${esc(a.action.replace(/_/g, ' ').toLowerCase())}<br><span class="small muted">${esc(a.detail)}</span></td></tr>`).join('')}
        </tbody></table>
      </div>
    </div>`;
}
