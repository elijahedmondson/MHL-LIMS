// Molecular (formerly the IHC tab): accepted IHC requests, assigned and worked with their bench worksheet; Xenium runs
// (xeniumviews.js); the assay catalog (assays.js) and the dilution calculator (calculator.js). New requests, including
// reviewing and accepting IHC requests from the web form (renderIhcReview), are made under New request.
import { $, $$, api, esc, money, fmtDate, fmtDateTime, getMeta, sectionName, act, pageTop, options, navigate, kindBadge } from '../ui.js';

export function ihcTabs(current, meta) {
  const t = [['requests', '#/molecular', `IHC requests${meta.ihc.unassigned ? ` <span class="count" title="Not assigned yet">${meta.ihc.unassigned}</span>` : ''}`],
    ['xenium', '#/molecular/xenium', `Xenium${meta.ihc.xeniumQueue ? ` <span class="count" title="MHL numbers waiting for a run">${meta.ihc.xeniumQueue}</span>` : ''}`],
    ['catalog', '#/molecular/assays', 'Assay catalog'], ['calculator', '#/molecular/calculator', 'Antibody dilution calculator']];
  return `<h1>Molecular</h1><nav class="subtabs" aria-label="Molecular sections">${t.map(([k, href, label]) => `<a href="${href}" ${k === current ? 'aria-current="page"' : ''}>${label}</a>`).join('')}</nav>`;
}
export const molecularTabs = ihcTabs;

const statusClass = { Submitted: 'warn', Accepted: 'complete', Declined: 'muted' };
const webBadge = (s) => `<span class="badge ${statusClass[s] || ''}">${esc(s)}</span>`;

const WORK_BADGE = { 'Not started': 'muted', 'In progress': 'warn', Done: 'complete' };
const workBadge = (w) => `<span class="badge ${WORK_BADGE[w] || ''}">${esc(w)}</span>`;
const homeState = { filter: 'todo' };

// Molecular > IHC requests: every accepted IHC request (from the web form or ordered with a new request), to assign and work.
export async function renderIhcHome(app) {
  const [meta, { requests }] = await Promise.all([getMeta(true), api('GET', '/api/ihc/requests')]);
  const me = meta.settings.initials;
  const accepted = requests.filter((r) => r.status === 'Accepted');
  const waiting = requests.filter((r) => r.status === 'Submitted').length;
  const declined = requests.filter((r) => r.status === 'Declined');
  const FILTERS = [['todo', 'To do', (r) => r.workStatus !== 'Done'], ['unassigned', 'Unassigned', (r) => !r.assignedTo && r.workStatus !== 'Done'],
    ['mine', `Mine${me ? ` (${me})` : ''}`, (r) => r.assignedTo === me && r.workStatus !== 'Done'], ['done', 'Done', (r) => r.workStatus === 'Done'], ['all', 'All', () => true]];
  const [, , pick] = FILTERS.find(([k]) => k === homeState.filter) || FILTERS[0];
  const rows = accepted.filter(pick).sort((a, b) => (a.workStatus === 'Done') - (b.workStatus === 'Done') || (a.importance === 'STAT' ? 0 : 1) - (b.importance === 'STAT' ? 0 : 1) || (a.due || '').localeCompare(b.due || ''));
  app.innerHTML = `
    ${ihcTabs('requests', meta)}
    <p class="muted" style="max-width:900px">Accepted IHC requests, from the web form or ordered with a new request. Assign each to the person doing the work, and record when it is under way and done. ${waiting ? `<a href="#/new">${waiting} IHC request${waiting === 1 ? '' : 's'} from the web form ${waiting === 1 ? 'is' : 'are'} waiting for review under New request.</a>` : 'Requests from the web form are reviewed and accepted under New request.'}</p>
    <div class="filters" role="group" aria-label="Show">${FILTERS.map(([k, label, f]) => `<button type="button" data-f="${k}" aria-pressed="${k === homeState.filter}">${esc(label)} ${accepted.filter(f).length}</button>`).join('')}</div>
    ${rows.length ? `
      <div class="row" style="margin:8px 0">
        <label class="small muted" for="assignto">Assign selected to</label>
        <input id="assignto" class="inp" list="staff" maxlength="4" style="width:90px;text-transform:uppercase" placeholder="initials" autocomplete="off">
        <datalist id="staff">${meta.staff.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
        <button class="btn small" type="button" id="doassign">Assign</button><button class="btn small quiet" type="button" id="unassign">Unassign</button>
        <span class="small muted" id="selcount">0 selected</span>
      </div>
      <div class="scroll-x"><table class="t">
      <thead><tr><th><input type="checkbox" id="all" aria-label="Select all"></th><th>IHC request</th><th>LIMS request</th><th>Investigator</th><th>Due</th><th class="n">Blocks</th><th>Stains</th><th>Assigned to</th><th>Work</th><th></th></tr></thead>
      <tbody>${rows.map((r) => `<tr>
        <td class="mid"><input type="checkbox" class="sel" value="${r.id}" aria-label="Select ${esc(r.number)}"></td>
        <td><a class="idtxt" href="#/molecular/request/${r.id}">${esc(r.number)}</a>${r.importance === 'STAT' ? ' <span class="badge stat">STAT</span>' : ''}<br><span class="small muted">${r.source === 'NEW_REQUEST' ? 'ordered with the request' : 'web form'}</span></td>
        <td>${r.requestId ? `<a class="idtxt" href="#/request/${r.requestId}">${esc(r.requestNumber)}</a>` : ''}</td>
        <td>${esc(r.investigator)}<br><span class="muted small">${esc(r.species)}</span></td>
        <td>${r.due ? (r.due < meta.today && r.workStatus !== 'Done' ? `<span class="overdue">${fmtDate(r.due)}</span>` : fmtDate(r.due)) : ''}</td>
        <td class="n">${r.samples}</td>
        <td>${r.stains.map(esc).join('<br>') || '<span class="muted">H&amp;E or unstained only</span>'}${r.newAntibodies ? ' <span class="badge warn">new antibody</span>' : ''}</td>
        <td>${r.assignedTo ? `<strong>${esc(r.assignedTo)}</strong>` : '<span class="badge warn">Unassigned</span>'}</td>
        <td>${workBadge(r.workStatus)}${r.doneOn ? `<br><span class="small muted">${fmtDate(r.doneOn)}</span>` : ''}</td>
        <td><div class="rowbtns">${r.workStatus === 'Not started' ? `<button class="btn small quiet" type="button" data-work="${r.id}" data-st="In progress">Start</button>` : r.workStatus === 'In progress' ? `<button class="btn small quiet" type="button" data-work="${r.id}" data-st="Done">Done</button>` : ''}<a class="btn small quiet" href="#/molecular/request/${r.id}">Worksheet</a></div></td>
      </tr>`).join('')}</tbody></table></div>`
    : `<p class="empty">${accepted.length ? 'Nothing here.' : 'No accepted IHC requests yet.'}</p>`}
    ${declined.length ? `<details class="section"><summary><strong>Declined (${declined.length})</strong></summary>
      <table class="t section"><tbody>${declined.map((r) => `<tr><td><a class="idtxt" href="#/molecular/request/${r.id}">${esc(r.number)}</a></td><td>${esc(r.investigator)}</td><td>${fmtDate(r.submittedOn)}</td><td>${r.stains.map(esc).join(', ')}</td></tr>`).join('')}</tbody></table></details>` : ''}`;
  pageTop(app);
  $$('[data-f]', app).forEach((b) => b.addEventListener('click', () => { homeState.filter = b.dataset.f; renderIhcHome(app); }));
  const sel = () => $$('.sel:checked', app).map((c) => Number(c.value));
  const count = () => { const el = $('#selcount'); if (el) el.textContent = `${sel().length} selected`; };
  $$('.sel', app).forEach((c) => c.addEventListener('change', count));
  $('#all')?.addEventListener('change', (e) => { $$('.sel', app).forEach((c) => { c.checked = e.target.checked; }); count(); });
  const assign = (to) => (e) => act(e.currentTarget, async () => {
    if (!sel().length) throw new Error('Tick the IHC requests to assign.');
    if (to === null && !$('#assignto').value.trim()) throw new Error('Type the initials to assign them to.');
    const r = await api('POST', '/api/ihc/requests/assign', { ids: sel(), to: to ?? $('#assignto').value.trim() });
    await renderIhcHome(app);
    return r;
  }, (r) => (to === '' ? `${r.changed} unassigned` : `${r.changed} assigned`));
  $('#doassign')?.addEventListener('click', assign(null));
  $('#unassign')?.addEventListener('click', assign(''));
  $$('[data-work]', app).forEach((b) => b.addEventListener('click', () => act(b, async () => { await api('POST', `/api/ihc/requests/${b.dataset.work}/work`, { status: b.dataset.st }); await renderIhcHome(app); }, `Marked ${b.dataset.st.toLowerCase()}`)));
}

function stainRows(stains, { linkAssays = true } = {}) {
  return stains.map((s) => {
    if (s.newAntibody) {
      const n = s.newAntibody;
      return `<tr><td><strong>${esc(n.name)}</strong> <span class="badge warn">not in catalog</span>${n.host ? `<br><span class="muted small">${esc(n.host)}</span>` : ''}</td>
        <td colspan="5">New antibody to optimize. ${n.supplied ? '<strong>The requester supplies the antibody.</strong> ' : ''}${esc(n.notes || '')}</td>
        <td>${esc(n.manufacturer)}<br><span class="muted small">${esc(n.catalog)}</span></td><td>${esc(s.chromogen)}</td></tr>`;
    }
    const p = s.snapshot || s.protocol;
    return `<tr><td>${linkAssays ? `<a href="#/molecular/assay/${p.id}">${esc(p.name)}</a>` : esc(p.name)} <span class="muted small">#${p.id}</span><br>${kindBadge({ ...p, kindLabel: s.kindLabel || s.current?.kindLabel || p.kind })}
        ${s.changedSince ? '<br><span class="badge warn" title="The catalog entry was edited after this request was submitted">changed in catalog since</span>' : ''}</td>
      <td>${esc(p.dilution)}</td><td>${esc(p.retrieval)}</td><td>${esc(p.digestion)}</td><td class="small">${esc(p.kit)}</td><td>${esc(p.control)}</td>
      <td>${esc(p.manufacturer)}<br><span class="muted small">${esc(p.catalog)}</span></td><td>${esc(s.chromogen)}</td></tr>`;
  }).join('');
}
// Narrow layout: one card per stain with its protocol.
function stainCards(stains, { linkAssays = true } = {}) {
  return stains.map((s) => {
    if (s.newAntibody) {
      const n = s.newAntibody;
      return `<div class="stain-card"><div><strong>${esc(n.name)}</strong> <span class="badge warn">not in catalog</span></div>
        <dl><dt>Source</dt><dd>${esc(n.manufacturer)} ${esc(n.catalog)}${n.host ? `, ${esc(n.host)}` : ''}</dd>
          <dt>Antibody</dt><dd>${n.supplied ? 'Supplied by the requester' : 'MHL to buy'}</dd>${n.notes ? `<dt>Notes</dt><dd>${esc(n.notes)}</dd>` : ''}
          <dt>Chromogen</dt><dd>${esc(s.chromogen)}</dd></dl></div>`;
    }
    const p = s.snapshot || s.protocol;
    const row = (label, v) => `<dt>${label}</dt><dd>${esc(v) || '<span class="muted">Not recorded</span>'}</dd>`;
    return `<div class="stain-card"><div>${linkAssays ? `<a href="#/molecular/assay/${p.id}"><strong>${esc(p.name)}</strong></a>` : `<strong>${esc(p.name)}</strong>`} <span class="muted small">#${p.id}</span>
        ${kindBadge({ ...p, kindLabel: s.kindLabel || s.current?.kindLabel || p.kind })}${s.changedSince ? ' <span class="badge warn" title="The catalog entry was edited after this request was submitted">changed in catalog since</span>' : ''}</div>
      <dl>${row('Dilution and time', p.dilution)}${row('Antigen retrieval', p.retrieval)}${row('Digestion', p.digestion)}${row('Detection', p.kit)}
        ${row('Positive control', p.control)}${row('Source', `${p.manufacturer} ${p.catalog}`)}${row('Validated on', `${p.species || 'species not recorded'}, ${p.fixative}`)}${row('Chromogen', s.chromogen)}</dl></div>`;
  }).join('');
}
const STAIN_HEAD = '<thead><tr><th>Antibody</th><th>Dilution and time</th><th>Antigen retrieval</th><th>Digestion</th><th>Detection</th><th>Positive control</th><th>Source</th><th>Chromogen</th></tr></thead>';

export function estimateTable(meta, est) {
  const groups = meta.sections.map((s) => [s.code, est.lines.filter((l) => l.section === s.code)]).filter(([, ls]) => ls.length);
  return `<table class="t">
      <thead><tr><th>Charge</th><th class="n">Units</th><th class="n">Amount</th></tr></thead>
      <tbody>${groups.map(([s, ls]) => `<tr class="sec"><td colspan="3">${esc(sectionName(meta, s))}</td></tr>` + ls.map((l) => `
        <tr><td><span class="code">${esc(l.code)}</span><br><span class="small">${esc(l.description)}</span></td><td class="n">${l.units}</td><td class="n">${l.amount == null ? '<span class="badge warn">not priced</span>' : money(l.amount)}</td></tr>`).join('')).join('')}
        <tr class="total"><td colspan="2">Estimate</td><td class="n">${money(est.total)}</td></tr></tbody></table>
    ${est.assumptions.length ? `<ul class="assume">${est.assumptions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>` : ''}
    ${est.problems?.length ? `<p class="note">${est.problems.map(esc).join('<br>')}</p>` : ''}`;
}

const sampleTypeName = (meta, k) => meta.ihc.sampleTypes.find(([c]) => c === k)?.[1] || k;

// ---------- changing the stains on an IHC request ----------
// Used on the review page (before accepting) and on an accepted request until its work is done: replace a protocol
// chosen for the wrong species, add a stain to work in progress, or remove one. Saving records who changed what, and
// why, in the request's history; on an accepted request the estimate changes by the difference.
const RESULT_CLS = { Works: 'complete', Optimizing: 'warn', Failed: 'stat' };
const coded = (a) => [a.preferred ? '<span class="badge complete">★ Preferred</span>' : '', a.visibility === 'Internal' ? '<span class="badge muted">Not public</span>' : '',
  a.result && a.result !== 'Works' ? `<span class="badge ${RESULT_CLS[a.result] || ''}">${esc(a.resultLabel || a.result)}</span>` : ''].filter(Boolean).join(' ');

function stainEditor(box, { w, stains, meta, onSaved, onCancel }) {
  const types = [...new Set(w.samples.map((s) => s.type))].join(',');
  const fluorescent = (v) => v && (v.kind === 'Opal' || v.kind === 'IF' || v.chromogen === 'Fluorescent');
  // Working copy: each stain with what is needed to show it.
  const list = stains.map((s) => (s.newAntibody ? { newAntibody: { ...s.newAntibody }, chromogen: s.chromogen }
    : { assayId: s.assayId, chromogen: s.chromogen, view: { ...(s.snapshot || {}), kindLabel: s.current?.kindLabel || s.kindLabel || s.snapshot?.kind, fit: [] } }));
  let replacing = null; let found = [];
  const accepted = w.status === 'Accepted';
  box.innerHTML = `
    <div class="panel section noprint" id="stain-editor">
      <h2>Change stains on ${esc(w.number)}</h2>
      <p class="small muted">Material: ${esc(meta.ihc.species.find(([k]) => k === w.species)?.[1] || w.species)}, ${esc(w.fixativeUsed)}${types ? `, ${esc(types.split(',').map((t) => sampleTypeName(meta, t).toLowerCase()).join(' and '))}` : ''}. Protocols validated for this material come first.
        ${accepted ? 'Stains that stay keep the protocol as it was requested; a new one uses the catalog as it is now. The request\'s estimate changes by the difference.' : ''}</p>
      <div id="se-list"></div>
      <h3 class="section" id="se-findlabel">Add a stain</h3>
      <div class="picker" style="max-width:none;margin-top:0"><input id="se-find" placeholder="Target, clone or catalog number, e.g. CD8, D4W2Z, ab101500" autocomplete="off" aria-labelledby="se-findlabel"></div>
      <div id="se-found" aria-live="polite"></div>
      <details class="section"><summary><strong>The antibody is not in the catalog</strong></summary>
        <form class="form section" id="se-new" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="se-nn">Target</label><input id="se-nn" maxlength="120" required></div>
          <div class="field"><label for="se-nl">Clone</label><input id="se-nl" maxlength="40"></div>
          <div class="field"><label for="se-nm">Manufacturer</label><input id="se-nm" maxlength="120" required></div>
          <div class="field"><label for="se-nc">Catalog number</label><input id="se-nc" maxlength="60"></div>
          <div class="field"><label for="se-nh">Host and clonality</label><input id="se-nh" maxlength="60" placeholder="e.g. Rabbit monoclonal"></div>
          <div class="field"><label><input type="checkbox" id="se-ns"> The investigator supplies it</label></div>
          <div class="full"><button class="btn quiet" type="submit">Add new antibody</button></div>
        </form>
      </details>
      <div class="field section"><label for="se-reason">Reason for the change${accepted ? ' (required, kept in the history)' : ' (kept in the history)'}</label>
        <input id="se-reason" class="inp" maxlength="300" placeholder="e.g. Wrong species: mouse CD8 instead of the human protocol"></div>
      <div class="actions" style="margin-top:10px"><button class="btn" type="button" id="se-save">Save stains</button><button class="btn quiet" type="button" id="se-cancel">Cancel</button></div>
    </div>`;

  const drawList = () => {
    $('#se-list').innerHTML = list.length ? `<table class="t"><tbody>${list.map((s, i) => {
      const v = s.view || {};
      return `<tr class="${replacing === i ? 'sel-row' : ''}"><td>${s.newAntibody ? `<strong>${esc(s.newAntibody.name)}</strong> <span class="badge warn">not in catalog</span><br><span class="small muted">${esc([s.newAntibody.host, s.newAntibody.manufacturer, s.newAntibody.catalog].filter(Boolean).join(', '))}</span>`
        : `<strong>${esc(v.name)}</strong> ${kindBadge(v)} <span class="small muted">#${s.assayId}</span> ${coded(v)}<br><span class="small muted">${esc([v.species || 'species not recorded', v.fixative, v.dilution, `${v.manufacturer || ''} ${v.catalog || ''}`.trim()].filter(Boolean).join(' · '))}</span>${v.fit?.length ? `<br><span class="small fitnote">${esc(v.fit.join('; '))}</span>` : ''}`}
        ${replacing === i ? '<br><span class="badge info">Choose its replacement below</span>' : ''}</td>
        <td>${s.newAntibody || fluorescent(v) ? '' : `<select data-chrom="${i}" aria-label="Chromogen">${options([['DAB', 'DAB'], ['Red', 'Red']], s.chromogen)}</select>`}</td>
        <td class="mid"><div class="rowbtns">${s.newAntibody ? '' : `<button class="btn small quiet" type="button" data-replace="${i}">${replacing === i ? 'Stop replacing' : 'Replace…'}</button>`}<button class="btn small quiet" type="button" data-rm="${i}">Remove</button></div></td></tr>`;
    }).join('')}</tbody></table>` : `<p class="empty" style="padding:8px 0">No stains.${w.he.on || w.unstained.on ? ' H&amp;E or unstained slides are still made.' : ''}</p>`;
    $('#se-findlabel').textContent = replacing != null ? `Replace ${list[replacing].view?.name || ''} with` : 'Add a stain';
    $$('[data-chrom]', box).forEach((sel) => sel.addEventListener('change', () => { list[Number(sel.dataset.chrom)].chromogen = sel.value; }));
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.rm); list.splice(i, 1); if (replacing === i) replacing = null; else if (replacing > i) replacing--; drawList(); search(); }));
    $$('[data-replace]', box).forEach((b) => b.addEventListener('click', () => {
      const i = Number(b.dataset.replace);
      replacing = replacing === i ? null : i;
      if (replacing != null && !$('#se-find').value.trim()) $('#se-find').value = (list[i].view?.name || '').replace(/\s*\(.*$/, '');
      drawList(); search(); $('#se-find').focus();
    }));
  };
  const search = async () => {
    const q = $('#se-find').value.trim();
    if (!q) { $('#se-found').innerHTML = ''; return; }
    const res = await api('GET', `/api/ihc/assays?q=${encodeURIComponent(q)}&limit=15&fitSpecies=${encodeURIComponent(w.species)}&fitFixative=${encodeURIComponent(w.fixativeUsed)}&fitTypes=${encodeURIComponent(types)}`);
    found = res.assays;
    const have = new Set(list.map((s) => s.assayId).filter(Boolean));
    $('#se-found').innerHTML = found.length ? `<ul class="found-list">${found.map((a, i) => `<li class="${a.fit.length || a.result === 'Failed' ? 'misfit' : ''}">
        <div><strong>${esc(a.name)}</strong> ${kindBadge(a)} <span class="small muted">#${a.id}</span> ${coded(a)}<br>
          <span class="small muted">${esc([a.species || 'species not recorded', a.fixative, a.dilution, `${a.manufacturer} ${a.catalog}`.trim()].filter(Boolean).join(' · '))}</span>
          ${a.fit.length ? `<br><span class="small fitnote">${esc(a.fit.join('; '))}</span>` : ''}</div>
        <div>${have.has(a.id) ? '<span class="badge complete">On the request</span>' : `<button class="btn small ${a.fit.length || a.result === 'Failed' ? 'quiet' : ''}" type="button" data-pick="${i}">${replacing != null ? 'Use instead' : 'Add'}</button>`}</div></li>`).join('')}</ul>
      ${res.total > found.length ? `<p class="small muted">${res.total - found.length} more; type more to narrow it down.</p>` : ''}`
      : `<p class="small muted">Nothing in the catalog matches “${esc(q)}”.</p>`;
    $$('[data-pick]', $('#se-found')).forEach((b) => b.addEventListener('click', () => {
      const a = found[Number(b.dataset.pick)];
      const item = { assayId: a.id, chromogen: fluorescent(a) ? a.chromogen : (a.chromogen === 'Red' ? 'Red' : 'DAB'), view: a };
      if (replacing != null) { list[replacing] = item; replacing = null; } else list.push(item);
      $('#se-find').value = '';
      drawList(); search();
    }));
  };
  let t = null;
  $('#se-find').addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 150); });
  $('#se-new').addEventListener('submit', (e) => {
    e.preventDefault();
    const clone = $('#se-nl').value.trim();
    list.push({ chromogen: 'DAB', newAntibody: { name: `${$('#se-nn').value.trim()}${clone ? ` (clone ${clone})` : ''}`, manufacturer: $('#se-nm').value.trim(), catalog: $('#se-nc').value.trim(),
      host: $('#se-nh').value.trim(), supplied: $('#se-ns').checked, notes: '' } });
    e.target.reset(); drawList();
  });
  $('#se-cancel').addEventListener('click', onCancel);
  $('#se-save').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await api('PUT', `/api/ihc/requests/${w.id}/stains`, { reason: $('#se-reason').value.trim(),
      stains: list.map((s) => (s.newAntibody ? { newAntibody: s.newAntibody, chromogen: s.chromogen } : { assayId: s.assayId, chromogen: s.chromogen })) });
    await onSaved(res);
    return res;
  }, (res) => `${res.change}${res.estimateBefore != null && res.estimateBefore !== res.estimateAfter ? `. Estimate ${money(res.estimateBefore)} → ${money(res.estimateAfter)}` : ''}${res.warning ? `. ${res.warning}` : ''}`));
  drawList();
  $('#se-find').focus();
}

// The request as submitted, in the order of the form's steps. Also used for the investigator's printable copy.
export function requestSummary(meta, w, { stains = w.stains, matches = [], linkAssays = true } = {}) {
  const rq = w.requester;
  const days = w.fixDate ? Math.round((Date.parse(w.submittedOn || meta.today) - Date.parse(w.fixDate)) / 86400000) : null;
  return `
    <section class="step-sum"><h3>1. Requester</h3>
      <dl class="dl">
        <dt>Investigator</dt><dd>${esc(rq.last)}${rq.first ? `, ${esc(rq.first)}` : ''}${rq.inst ? `<br><span class="muted">${esc(rq.inst)}</span>` : ''}</dd>
        <dt>Contact</dt><dd>${[rq.building && `Building/room ${esc(rq.building)}`, esc(rq.phone), rq.email && `<a href="mailto:${esc(rq.email)}">${esc(rq.email)}</a>`].filter(Boolean).join('<br>')}</dd>
        <dt>Bill to (PI)</dt><dd>${esc(w.billTo)}</dd><dt>Project ID</dt><dd>${esc(w.projectId)}</dd>
        <dt>ACUC protocol</dt><dd>${esc(w.acuc || 'Not given')}</dd><dt>Pathologist</dt><dd>${esc(w.pathologist)}</dd>
        <dt>Importance</dt><dd>${w.importance === 'STAT' ? '<span class="badge stat">STAT</span>' : 'Routine'}</dd>
      </dl></section>
    <section class="step-sum"><h3>2. Material</h3>
      <dl class="dl">
        <dt>Species</dt><dd>${esc(meta.ihc.species.find(([k]) => k === w.species)?.[1] || w.species)}</dd>
        <dt>Fixative</dt><dd>${esc(w.fixativeUsed)}${w.fixativeSubmitted && w.fixativeSubmitted !== w.fixativeUsed ? `, submitted in ${esc(w.fixativeSubmitted)}` : ''}</dd>
        <dt>Into fixative</dt><dd>${w.fixDate ? `${fmtDate(w.fixDate)}${days != null && days >= 0 ? ` <span class="muted">(${days} days before submission)</span>` : ''}` : 'Not given'}</dd>
      </dl></section>
    <section class="step-sum"><h3>3. Samples</h3>
      <table class="t"><thead><tr><th>#</th><th>Organ or tissue</th><th>Animal or MHL block no.</th><th>Type</th><th>Already in the LIMS</th></tr></thead>
        <tbody>${w.samples.map((s, i) => { const m = matches.find((x) => x.sample === i); return `<tr><td>${i + 1}</td><td>${esc(s.tissue)}</td><td class="code">${esc(s.blockNo)}</td><td>${esc(sampleTypeName(meta, s.type))}</td>
          <td>${m ? `<a href="#/request/${m.requestId}">${esc(m.phl)}</a> <span class="muted small">on ${esc(m.requestNumber)}${m.studyZap ? `, ${esc(m.studyZap)}` : ''}</span>` : ''}</td></tr>`; }).join('')}</tbody></table></section>
    <section class="step-sum"><h3>4. General procedures</h3>
      <p>${[w.he.on && `H&amp;E stained, ${w.he.perBlock} per block`, w.unstained.on && `Unstained, ${w.unstained.perBlock} per block`].filter(Boolean).join('<br>') || 'None'}</p></section>
    <section class="step-sum"><h3>5. Stains</h3>
      ${stains.length ? stainCards(stains, { linkAssays }) : '<p>None</p>'}</section>
    <section class="step-sum"><h3>6. Imaging</h3><p>${[w.scan.x20 && 'Whole-slide scan at 20x', w.scan.x40 && 'Whole-slide scan at 40x'].filter(Boolean).join('<br>') || 'No scanning'}</p></section>
    <section class="step-sum"><h3>7. Additional information</h3><p>${esc(w.additional) || '<span class="muted">None</span>'}</p></section>`;
}

// New request > review an IHC request from the web form, then accept it (a request with MHL numbers) or decline it.
export async function renderIhcReview(app, id) {
  const [meta, d] = await Promise.all([getMeta(true), api('GET', `/api/ihc/requests/${id}`)]);
  const w = d.request;
  if (w.status !== 'Submitted') { location.replace(`#/molecular/request/${w.id}`); return; }
  const nasOpts = [...d.openNas].sort((a, b) => Number(b.suggested) - Number(a.suggested));
  app.innerHTML = `
    <div class="crumb noprint"><a href="#/new">New request</a></div>
    <div class="head"><h1>${esc(w.number)}</h1>${webBadge(w.status)}${w.importance === 'STAT' ? '<span class="badge stat">STAT</span>' : ''}</div>
    ${factsHtml(w)}
    <p class="muted" style="margin-top:8px">${esc(d.summary)}</p>
    <div id="stain-edit-box"></div>
    <div class="split wide-left section">
      <div>${requestSummary(meta, w, { stains: d.stains, matches: d.matches })}</div>
      <div>
        ${d.warnings.length ? `<h2>Check before accepting</h2>${d.warnings.map((x) => `<p class="note">${esc(x)}</p>`).join('')}` : '<p class="note ok">Nothing to flag: every stain is in the catalog and fits the species and fixative.</p>'}
        <div class="actions noprint" style="margin-top:8px"><button class="btn quiet" type="button" id="chg-stains">Change stains…</button></div>
        ${d.matches.length ? `<p class="note info">${d.matches.length} of the blocks are already MHL numbers in the LIMS. Their history stays linked.</p>` : ''}
        <h2 class="section">Estimate</h2>
        <p class="small muted">From the samples and stains, priced from the ${esc(meta.priceList.name)} list. It becomes the request's initial estimate.</p>
        ${estimateTable(meta, d.estimate)}
        <div class="panel section noprint" id="accept">
          <h2>Accept</h2>
          <p class="small muted">Creates a request (${esc(meta.requestTypes.MOLEC.name)}) with one MHL number per block, due in ${meta.requestTypes.MOLEC.days} days. Its IHC work is then assigned under Molecular.</p>
          <div class="field"><label for="nas">NAS request (funding)</label>
            <select id="nas" class="inp">${options([['', 'Link a NAS request later'], ...nasOpts.map((n) => [n.id, `${n.number}, ${n.requester.last}, ${money(n.authorized)}${n.requests ? `, ${n.requests} request${n.requests === 1 ? '' : 's'} already` : ''}${n.suggested ? ' (same investigator)' : ''}`])], nasOpts.find((n) => n.suggested)?.id || '')}</select></div>
          <div class="actions" style="margin-top:14px"><button class="btn" type="button" id="do-accept">Accept and create request</button><button class="btn quiet" type="button" id="do-decline">Decline</button></div>
        </div>
        <div class="actions noprint"><button class="btn quiet" type="button" id="print">Print</button></div>
        ${historyHtml(d)}
      </div>
    </div>`;
  pageTop(app);
  $('#print').addEventListener('click', () => window.print());
  $('#chg-stains').addEventListener('click', () => {
    stainEditor($('#stain-edit-box'), { w, stains: d.stains, meta, onSaved: () => renderIhcReview(app, id), onCancel: () => { $('#stain-edit-box').innerHTML = ''; } });
    $('#stain-edit-box').scrollIntoView({ block: 'start' });
  });
  $('#do-accept').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await api('POST', `/api/ihc/requests/${w.id}/accept`, { nasId: $('#nas').value ? Number($('#nas').value) : null });
    await getMeta(true);
    navigate(`#/new/created/${res.id}`);
    return res;
  }, (res) => `Accepted as ${res.number}: ${res.phls.length} MHL numbers issued`));
  $('#do-decline').addEventListener('click', (e) => {
    const reason = prompt(`Decline ${w.number}? The investigator sees this reason:`, '');
    if (!reason) return;
    act(e.currentTarget, async () => { await api('POST', `/api/ihc/requests/${w.id}/decline`, { reason }); await getMeta(true); navigate('#/new'); }, `${w.number} declined`);
  });
}

const factsHtml = (w) => `<div class="facts">
      <span><b>${esc(w.requester.last)}${w.requester.first ? `, ${esc(w.requester.first)}` : ''}</b></span>
      <span>Submitted <b>${fmtDate(w.submittedOn)}</b></span><span>${w.samples.length} block${w.samples.length === 1 ? '' : 's'}</span>
      <span>${w.stains.length} stain${w.stains.length === 1 ? '' : 's'}</span><span>Pathologist: ${esc(w.pathologist)}</span>
    </div>`;
const historyHtml = (d) => `<h2 class="section">History</h2>
  <table class="t"><tbody>${d.history.map((h) => `<tr><td>${fmtDateTime(h.at)}</td><td>${esc(h.by === 'WEB' ? 'Investigator (web form)' : h.by)}</td><td>${esc(h.action.replace(/^IHC_/, '').replace(/_/g, ' ').toLowerCase())}<br><span class="small muted">${esc(h.detail)}</span></td></tr>`).join('')}</tbody></table>`;

// Molecular > an accepted (or declined) IHC request: who is doing it, how far it is, and the bench worksheet.
export async function renderIhcRequest(app, id) {
  const [meta, d] = await Promise.all([getMeta(true), api('GET', `/api/ihc/requests/${id}`)]);
  const w = d.request;
  if (w.status === 'Submitted') { location.replace(`#/new/ihc/${w.id}`); return; }
  const work = w.workStatus || 'Not started';
  app.innerHTML = `
    <div class="crumb noprint"><a href="#/molecular">Molecular</a></div>
    <div class="head"><h1>${esc(w.number)}</h1>${webBadge(w.status)}${w.status === 'Accepted' ? workBadge(work) : ''}${w.importance === 'STAT' ? '<span class="badge stat">STAT</span>' : ''}</div>
    ${factsHtml(w)}
    ${w.status === 'Accepted' ? `
      <div class="panel section noprint" style="max-width:900px">
        <div class="row">
          <span>Request <a class="idtxt" href="#/request/${d.linked.id}">${esc(d.linked.number)}</a>, accepted ${fmtDateTime(w.acceptedAt)} by ${esc(w.acceptedBy)}.</span><span class="spacer"></span>
          <label class="small muted" for="assignto">Assigned to</label>
          <input id="assignto" class="inp" list="staff" maxlength="4" style="width:80px;text-transform:uppercase" value="${esc(w.assignedTo || '')}" placeholder="initials" autocomplete="off">
          <datalist id="staff">${meta.staff.map((x) => `<option value="${esc(x)}">`).join('')}</datalist>
          <button class="btn small quiet" type="button" id="saveassign">Save</button>
          <span class="small muted">Work:</span>
          ${['Not started', 'In progress', 'Done'].map((st) => `<button class="btn small ${st === work ? '' : 'quiet'}" type="button" data-st="${esc(st)}" aria-pressed="${st === work}" ${st === work ? 'disabled' : ''}>${esc(st)}</button>`).join('')}
        </div>
        ${w.assignedBy ? `<p class="small muted" style="margin:6px 0 0">${w.assignedTo ? `Assigned to ${esc(w.assignedTo)}` : 'Unassigned'} by ${esc(w.assignedBy)}, ${fmtDateTime(w.assignedAt)}.${w.workBy ? ` ${esc(work)} since ${fmtDateTime(w.workAt)} (${esc(w.workBy)}).` : ''}</p>` : ''}
        <div class="row" style="margin-top:8px"><button class="btn small quiet" type="button" id="chg-stains" ${d.linked.status !== 'Open' ? `disabled title="Request ${esc(d.linked.number)} is ${esc(d.linked.status.toLowerCase())}"` : work === 'Done' ? 'disabled title="Set the work back to In progress to change the stains"' : ''}>Change stains…</button>
          <span class="small muted">Replace a protocol, add a stain to this work, or remove one.</span></div>
      </div>
      <div id="stain-edit-box"></div>
      <h2 class="section">Worksheet</h2><div id="worksheet"></div>` : ''}
    ${w.status === 'Declined' ? `<p class="note section">Declined by ${esc(w.declinedBy)} on ${fmtDateTime(w.declinedAt)}: ${esc(w.declineReason)}</p>` : ''}
    <details class="section" ${w.status === 'Declined' ? 'open' : ''}><summary><strong>The request as submitted</strong></summary>
      <div class="split wide-left section">
        <div>${requestSummary(meta, w, { stains: d.stains, matches: d.matches })}</div>
        <div><h2>Estimate</h2>${estimateTable(meta, d.estimate)}${historyHtml(d)}</div>
      </div></details>`;
  pageTop(app);
  if (w.status === 'Accepted') {
    await ihcWorksheetTab($('#worksheet'), d.linked.id);
    $('#saveassign').addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', '/api/ihc/requests/assign', { ids: [w.id], to: $('#assignto').value.trim() }); await renderIhcRequest(app, id); }, 'Assignment saved'));
    $$('[data-st]', app).forEach((b) => b.addEventListener('click', () => act(b, async () => { await api('POST', `/api/ihc/requests/${w.id}/work`, { status: b.dataset.st }); await renderIhcRequest(app, id); }, `Marked ${b.dataset.st.toLowerCase()}`)));
    $('#chg-stains').addEventListener('click', () => {
      stainEditor($('#stain-edit-box'), { w, stains: d.stains, meta, onSaved: () => renderIhcRequest(app, id), onCancel: () => { $('#stain-edit-box').innerHTML = ''; } });
      $('#stain-edit-box').scrollIntoView({ block: 'start' });
    });
  }
}

// "IHC worksheet" tab on an accepted request: what the bench needs, one sheet per request.
export async function ihcWorksheetTab(box, requestId) {
  const d = await api('GET', `/api/requests/${requestId}/ihc`);
  const w = d.web;
  const slides = [w.he.on && `H&E x${w.he.perBlock}`, w.unstained.on && `Unstained x${w.unstained.perBlock}`, ...d.stains.map((s) => (s.protocol ? s.protocol.name : s.newAntibody.name))].filter(Boolean);
  box.innerHTML = `
    <div class="row noprint"><p class="muted" style="margin:0">Protocols as they were in the catalog when ${esc(w.number)} was submitted on ${fmtDate(w.submittedOn)}.</p><span class="spacer"></span>
      ${d.stains.length ? `<a class="btn quiet" href="#/molecular/calculator?request=${d.request.id}">Antibody volumes</a>` : ''}<button class="btn" type="button" id="print">Print worksheet</button></div>
    <div class="worksheet">
      <h2 class="print-only">IHC worksheet ${esc(d.request.number)} (${esc(w.number)})</h2>
      <dl class="dl section" style="margin-top:14px">
        <dt>Investigator</dt><dd>${esc(d.request.piName)}</dd><dt>Due</dt><dd>${fmtDate(d.request.due)}</dd>
        <dt>Pathologist</dt><dd>${esc(w.pathologist)}</dd><dt>Material</dt><dd>${esc(w.species)}, ${esc(w.fixativeUsed)}${w.fixDate ? `, into fixative ${fmtDate(w.fixDate)}` : ''}</dd>
        <dt>Scanning</dt><dd>${[w.scan.x20 && '20x', w.scan.x40 && '40x'].filter(Boolean).join(' and ') || 'None'}</dd>
        ${w.additional ? `<dt>Notes</dt><dd>${esc(w.additional)}</dd>` : ''}
      </dl>
      <h3 class="section">Stains</h3>
      <div class="panel" style="padding:6px 10px"><table class="t">${STAIN_HEAD}<tbody>${stainRows(d.stains)}</tbody></table></div>
      <h3 class="section">Blocks and slides</h3>
      <table class="t"><thead><tr><th>MHL#</th><th>Organ or tissue</th><th>Block</th>${slides.map((s) => `<th>${esc(s)}</th>`).join('')}</tr></thead>
        <tbody>${d.blocks.map((b) => `<tr><td class="code">${esc(b.phl)}</td><td>${esc(b.tissue)}</td><td>${b.source ? `<a href="#/request/${b.source.requestId}">${esc(b.source.phl)}</a> <span class="muted small">from ${esc(b.source.requestNumber)}</span>` : esc(b.blockNo)}</td>${slides.map(() => '<td class="tick"><span class="box" aria-hidden="true"></span></td>').join('')}</tr>`).join('')}</tbody></table>
      <p class="small muted">Tick each slide when it is cut and stained. In production each slide gets its own barcode and is scanned at every step.</p>
    </div>`;
  $('#print').addEventListener('click', () => window.print());
}
