// Pathology: the worklist of cases and the Zaphod-style case entry (tissues, diagnoses, gross correlation,
// cause of death, comment, sign-out and amendment). Reports and summaries are in reports.js.
import { $, $$, api, esc, money, fmtDate, fmtDateTime, getMeta, getPriceList, areaName, act, toast, pageTop, options, navigate, subjectLabel } from '../ui.js';
import { dxText, diagnosesFor, findDiagnosis, slidesRead, signOutProblems } from '../lib/pathology.mjs';

const STATUS = { SIGNED: ['complete', 'Signed out'], DRAFT: ['warn', 'Draft'], NOT_STARTED: ['', 'Not started'], WAITING: ['muted', 'After necropsy'] };
export const caseBadge = (status, version) => `<span class="badge ${STATUS[status]?.[0] || ''}">${STATUS[status]?.[1] || status}${version > 1 ? ` v${version}` : ''}</span>`;
let mineOnly = false;

export async function renderPathWorklist(app) {
  const meta = await getMeta();
  const wl = await api('GET', `/api/pathology/worklist${mineOnly ? '?mine=1' : ''}`);
  app.innerHTML = `
    <h1>Pathology</h1>
    <p class="small"><a href="#/terminology">Organ and diagnosis library (INHAND and SEND)</a></p>
    <div class="row section" style="margin-top:14px">
      <div class="seg" role="group" aria-label="Which cases">
        <button type="button" data-mine="0" aria-pressed="${!mineOnly}">All open cases</button>
        <button type="button" data-mine="1" aria-pressed="${mineOnly}">Assigned to me (${esc(wl.me)})</button>
      </div>
      <span class="small muted">Cases from necropsy start when the necropsy is approved. Submitted slides (pathology review requests) are ready at once. Add pathology to any other request from its Overview.</span>
    </div>
    <div class="split wide-left section">
      <div>
        ${wl.requests.length ? wl.requests.map((r) => (r.subjects.every((x) => x.status === 'WAITING') ? `
          <section class="panel compact-req" style="margin-bottom:16px">
            <div class="row"><a class="idtxt" href="#/request/${r.requestId}/pathology">${esc(r.number)}</a><span class="muted">${esc(r.pi)}</span>
              ${r.zap ? `<a href="#/study/${r.studyId}">${esc(r.zap)}</a>` : ''}<span class="spacer"></span><span class="small muted">Due ${fmtDate(r.due)}</span></div>
            <p class="small muted" style="margin:6px 0 0">${r.subjects.length} animal${r.subjects.length === 1 ? '' : 's'}${r.subjects.some((x) => x.priority === 'S') ? ` (${r.subjects.filter((x) => x.priority === 'S').length} STAT)` : ''} waiting for necropsy approval. <a href="#/necropsy">Necropsy worklist</a></p>
          </section>` : `
          <section class="panel" style="margin-bottom:16px" data-req="${r.requestId}">
            <div class="row"><a class="idtxt" href="#/request/${r.requestId}/pathology">${esc(r.number)}</a><span class="muted">${esc(r.pi)}</span>
              ${r.zap ? `<a href="#/study/${r.studyId}?view=pathology">${esc(r.zap)}</a>` : `<span class="small muted">${esc(r.type)}</span>`}
              <span class="spacer"></span><span class="small muted">Due ${fmtDate(r.due)} · ${r.signed} of ${r.subjects.length} signed out</span></div>
            ${r.studyTitle ? `<p class="small muted" style="margin:4px 0 6px">${esc(r.studyTitle)}</p>` : ''}
            <table class="t"><thead><tr><th><input type="checkbox" data-all="${r.requestId}" aria-label="Select all cases in ${esc(r.number)}"></th><th>PHL#</th><th>Animal or sample</th><th>Group</th><th>Slides</th><th>Pathologist</th><th>Report</th><th></th></tr></thead><tbody>
              ${r.subjects.map((s) => `<tr>
                <td class="mid"><input type="checkbox" class="pick" value="${s.id}" data-r="${r.requestId}" aria-label="Select ${esc(s.phl)}"></td>
                <td class="code">${esc(s.phl)} ${s.priority === 'S' ? '<span class="badge stat">STAT</span>' : ''}</td>
                <td>${esc(subjectLabel(s))}</td><td>${esc(s.groupCode || '')}${s.sex ? ` (${esc(s.sex)})` : ''}</td>
                <td class="small">${s.slidesReady ? '<span class="badge info">Ready</span>' : esc(areaName(meta, s.area))}</td>
                <td>${esc(s.assigned || '')}</td><td>${caseBadge(s.status, s.version)}</td>
                <td class="mid">${s.status === 'WAITING' ? `<a class="btn small quiet" href="#/necropsy/${s.id}">Necropsy</a>` : s.status === 'SIGNED' ? `<a class="btn small quiet" href="#/report/${s.id}/pathology">Report</a>` : `<a class="btn small" href="#/pathology/${s.id}">${s.status === 'DRAFT' ? 'Continue' : 'Start'}</a>`}</td>
              </tr>`).join('')}
            </tbody></table>
            <div class="row" style="margin-top:8px"><label class="small muted" for="as-${r.requestId}">Assign selected to</label>
              <input id="as-${r.requestId}" class="inp" style="width:80px;text-transform:uppercase" maxlength="4" value="${esc(wl.me)}" aria-label="Pathologist initials">
              <button class="btn small quiet" type="button" data-assign="${r.requestId}">Assign</button></div>
          </section>`)).join('')
        : `<p class="empty">${mineOnly ? 'No open cases are assigned to you.' : 'No open requests include pathology.'}</p>`}
      </div>
      <div>
        <h2>Recuts requested</h2>
        ${wl.recuts.length ? `<table class="t"><tbody>${wl.recuts.map((x) => `<tr><td class="code"><a href="#/pathology/${x.subjectId}">${esc(x.phl)}</a></td><td>${esc(x.organ)}${x.block ? `, block ${esc(x.block)}` : ''}<br><span class="small muted">${esc(x.note || '')}</span></td><td class="small">${esc(x.requestNumber)}</td></tr>`).join('')}</tbody></table>`
        : '<p class="muted small">None. A pathologist can ask for a recut, level or special stain on any tissue.</p>'}
      </div>
    </div>`;
  pageTop(app);
  $$('[data-mine]', app).forEach((b) => b.addEventListener('click', () => { mineOnly = b.dataset.mine === '1'; renderPathWorklist(app); }));
  $$('[data-all]', app).forEach((c) => c.addEventListener('change', () => $$(`.pick[data-r="${c.dataset.all}"]`, app).forEach((x) => { x.checked = c.checked; })));
  $$('[data-assign]', app).forEach((b) => b.addEventListener('click', () => {
    const rid = b.dataset.assign;
    const ids = $$(`.pick[data-r="${rid}"]:checked`, app).map((x) => Number(x.value));
    if (!ids.length) { toast('Select the cases to assign first.', 'error'); return; }
    act(b, async () => { const res = await api('POST', '/api/pathology/assign', { subjectIds: ids, pathologist: $(`#as-${rid}`).value }); await renderPathWorklist(app); return res; }, (res) => `${res.assigned} cases assigned`);
  }));
}

// ---------- case entry ----------
let pc = null;          // the case being edited
let ctx = null;         // the rest of the server response
let dirty = false;
let editing = null;     // { t, x } diagnosis editor (x = -1 for new), or { t, tissue: true } tissue details

export async function renderPathCase(app, subjectId) {
  const [d, meta, pl] = await Promise.all([api('GET', `/api/pathology/${subjectId}`), getMeta(), getPriceList()]);
  pc = structuredClone(d.case); ctx = d; dirty = false; editing = null;
  draw(app, meta, pl);
  pageTop(app);
}

const RESULT_SHORT = { NSL: ['NSL', 'No significant lesions'], LESIONS: ['Lesions', 'Lesions present'], NOT_EXAMINED: ['NE', 'Not examined'], NOT_PRESENT: ['NP', 'Tissue not present'] };

function draw(app, meta, pl) {
  const d = ctx; const s = d.subject;
  const signed = pc.status === 'SIGNED';
  const locked = signed || !!d.waiting;
  const dis = locked ? 'disabled' : '';
  const group = d.study?.groups.find((g) => g.code === s.groupCode);
  const problems = signOutProblems(pc, { grossFindings: d.grossFindings, needCauseOfDeath: d.needCauseOfDeath });
  const slides = slidesRead(pc);
  const price = (code) => pl.items.find((i) => i.code === code)?.price;
  const allDx = pc.tissues.flatMap((t) => t.diagnoses.map((x) => [x.id, `${t.organ}: ${dxText(x)}`]));
  app.innerHTML = `
    <div class="crumb"><a href="#/pathology">Pathology</a> <span class="muted">/</span> <a href="#/request/${d.request.id}/pathology">${esc(d.request.number)}</a>${d.study ? ` <span class="muted">/</span> <a href="#/study/${d.study.id}?view=pathology">${esc(d.study.zap)}</a>` : ''}</div>
    <div class="nec-head" style="margin-top:8px">
      <h1>${esc(s.phl)}</h1>
      ${s.priority === 'S' ? '<span class="badge stat">STAT</span>' : ''}
      ${caseBadge(d.waiting ? 'WAITING' : signed ? 'SIGNED' : d.saved ? 'DRAFT' : 'NOT_STARTED', pc.version)}
      <span class="muted">${esc(subjectLabel(s))}${s.groupCode ? `, group ${esc(s.groupCode)}${group?.name ? ` (${esc(group.name)})` : ''}` : ''}${s.sex ? `, ${s.sex === 'F' ? 'female' : s.sex === 'M' ? 'male' : 'sex unknown'}` : ''}</span>
      <span class="spacer"></span>
      <button class="btn small quiet" type="button" id="prev" ${d.prevId ? '' : 'disabled'}>Previous case</button>
      <button class="btn small quiet" type="button" id="next" ${d.nextId ? '' : 'disabled'}>Next case</button>
    </div>
    <p class="muted small">${esc(d.request.piName)}. ${esc(d.request.type)}.
      ${d.necropsy ? ` Necropsy ${fmtDate(d.necropsy.date)} by ${esc(d.necropsy.prosector)}: ${esc(d.necropsy.fate.toLowerCase())}, body weight ${d.necropsy.bodyWeight ?? 'not recorded'} g. <a href="#/report/${s.id}/necropsy">Necropsy report</a>` : ' No necropsy at MHL; tissues are added from the submitted material.'}
      ${d.saved ? ` · <a href="#/report/${s.id}/pathology">${signed ? 'Pathology report' : 'Preview report'}</a>` : ''}</p>
    ${d.waiting ? `<div class="note">${esc(d.waiting)} ${d.request.areas.includes('NECRO') ? `<a href="#/necropsy/${s.id}">Open the necropsy</a>` : `<a href="#/request/${d.request.id}">Open the request</a>`}</div>` : ''}
    ${signed ? `<div class="locked">Signed out by ${esc(pc.signedBy)} on ${fmtDateTime(pc.signedAt)}${pc.version > 1 ? ` (amended, version ${pc.version})` : ''}. ${d.charges.length ? `Charges: ${d.charges.map((c) => `${esc(c.code)} x ${c.units} (${c.status.toLowerCase()})`).join('; ')}.` : 'No charges.'}
      <div class="actions" style="margin-top:10px"><a class="btn" href="#/report/${s.id}/pathology">View report</a><button class="btn quiet" type="button" id="amend">Amend report</button></div></div>` : ''}

    <div class="split wide-left section">
      <div>
        <div class="row"><h2 style="margin:0">Tissues</h2><span class="spacer"></span>
          ${locked ? '' : `<span class="small muted">Unread tissues:</span><button class="btn small quiet" type="button" data-bulk="NSL">No significant lesions</button><button class="btn small quiet" type="button" data-bulk="NOT_EXAMINED">Not examined</button>`}</div>
        <table class="organs path">
          <thead><tr><th>Tissue</th><th>Result</th><th>Diagnoses</th><th>Gross findings</th></tr></thead>
          <tbody>${pc.tissues.map((t, ti) => tissueRow(t, ti, dis, meta)).join('') || '<tr><td colspan="4" class="muted">No tissues yet. Add the tissues on the submitted slides below.</td></tr>'}</tbody>
        </table>
        ${locked ? '' : `<div class="row" style="margin-top:12px">
          <select id="addorg" class="inp" style="width:auto" aria-label="Tissue to add">${options(meta.pathology.organs, '', { blank: 'Add a tissue…' })}</select>
          <input id="addblk" class="inp" style="width:90px" placeholder="Block or slide" aria-label="Block or slide">
          <button class="btn small quiet" type="button" id="addtissue">Add tissue</button></div>`}
      </div>
      <aside>
        <div class="panel">
          <h2>${signed ? 'Signed out' : 'Before sign-out'}</h2>
          ${signed ? '<p class="small muted">The report is locked. Amend it to make changes; the earlier version is kept.</p>'
            : problems.length ? `<ul class="checks-list">${problems.map((p) => `<li>${esc(p[0].toUpperCase() + p.slice(1))}</li>`).join('')}</ul>` : '<p class="note ok" style="margin-top:0">Ready to sign out.</p>'}
          <p class="small" style="margin-top:10px"><strong>${slides}</strong> slide${slides === 1 ? '' : 's'} read${d.request.chargeType === 'C' ? `: ${signed ? 'charged' : 'signing out charges'} PA001002 x ${slides}${price('PA001002') != null ? ` (${money(price('PA001002') * slides)})` : ''}${pc.extraQuarterHours ? ` and PA001004 x ${pc.extraQuarterHours}` : ''}` : ''}.</p>
        </div>
        <div class="field section"><label for="cod">Cause of death${d.needCauseOfDeath ? ' (required: found dead or moribund)' : ''}</label>
          <select id="cod" class="inp" ${dis}>${options([['', 'Not recorded'], ['NA', 'Not applicable (scheduled euthanasia)'], ['UNDETERMINED', 'Undetermined'], ['DIAGNOSIS', 'One of the diagnoses']], pc.causeOfDeath.kind)}</select></div>
        ${pc.causeOfDeath.kind === 'DIAGNOSIS' ? `<div class="field" style="margin-top:8px"><label for="coddx">Diagnosis</label><select id="coddx" class="inp" ${dis}>${options(allDx, pc.causeOfDeath.dxId || '', { blank: 'Choose' })}</select></div>` : ''}
        <div class="field" style="margin-top:8px"><label for="codc">Cause of death comment</label><input id="codc" class="inp" maxlength="300" value="${esc(pc.causeOfDeath.comment)}" ${dis}></div>
        <div class="field section"><label for="pcom">Pathologist's comment</label><textarea id="pcom" maxlength="4000" style="min-height:120px" ${dis}>${esc(pc.comment)}</textarea></div>
        <div class="form" style="grid-template-columns:110px 1fr;gap:10px;margin-top:12px">
          <div class="field"><label for="xq">Extra time (¼ h)</label><input id="xq" type="number" min="0" max="40" value="${pc.extraQuarterHours || 0}" ${dis}></div>
          <div class="field"><label for="xn">What the extra time was for</label><input id="xn" maxlength="200" value="${esc(pc.extraTimeNote)}" ${dis}></div>
          <div class="field"><label for="pini">Pathologist</label><input id="pini" maxlength="4" style="text-transform:uppercase" value="${esc(pc.pathologist)}" ${dis}></div>
        </div>
        ${locked ? '' : '<div class="actions"><button class="btn quiet" type="button" id="save">Save draft</button><button class="btn" type="button" id="signout">Sign out</button></div>'}
        ${pc.history?.length ? `<h3 class="section">History</h3><ul class="small muted" style="padding-left:18px">${pc.history.slice().reverse().slice(0, 12).map((h) => `<li>${fmtDateTime(h.at)} ${esc(h.by)}: ${esc(h.action)}</li>`).join('')}</ul>` : ''}
      </aside>
    </div>`;
  wire(app, meta, pl);
}

function tissueRow(t, ti, dis, meta) {
  const gross = ctx.grossFindings.filter((g) => g.organ === t.organ);
  const correlatedBy = (gid) => t.diagnoses.find((x) => (x.correlates || []).includes(gid)) || pc.tissues.flatMap((o) => o.diagnoses).find((x) => (x.correlates || []).includes(gid));
  const row = `
    <tr class="${t.result === 'NOT_PRESENT' ? 'nc' : t.result === 'NOT_EXAMINED' ? 'ne' : ''}">
      <td class="organ">${dis ? esc(t.organ) : `<button class="link plain" type="button" data-tdet="${ti}" title="Block, comment, recut">${esc(t.organ)}</button>`}
        ${t.block ? `<br><span class="small muted">Block ${esc(t.block)}</span>` : ''}${t.recut ? '<br><span class="badge warn">Recut</span>' : ''}${t.comment ? `<br><span class="small muted">${esc(t.comment)}</span>` : ''}</td>
      <td><div class="seg small-seg" role="group" aria-label="Result for ${esc(t.organ)}">${Object.entries(RESULT_SHORT).map(([k, [short, long]]) => `<button type="button" data-res="${ti}:${k}" aria-pressed="${t.result === k}" title="${long}" ${dis}>${short}</button>`).join('')}</div></td>
      <td>${t.diagnoses.map((x, xi) => `<span class="dx ${x.neoplasm ? 'neo' : ''}">${esc(dxText(x))}${x.inDictionary === false || (x.term && !findDiagnosis(x.term, meta.pathology.diagnoses)) ? ' <span class="small" title="Not in the diagnosis dictionary">*</span>' : ''}${dis ? '' : `<button type="button" data-dxe="${ti}:${xi}" aria-label="Edit diagnosis">Edit</button><button type="button" data-dxd="${ti}:${xi}" aria-label="Remove diagnosis">×</button>`}</span>`).join('')}
        ${dis ? '' : `<button class="btn small quiet" type="button" data-dxa="${ti}">Add diagnosis</button>`}</td>
      <td>${gross.map((g) => { const by = correlatedBy(g.id); return `<div class="gross"><span class="finding">${esc(g.text)}</span>
        ${by ? `<span class="small ok-text">→ ${esc(by.term)}</span>` : `<label class="small"><input type="checkbox" data-nc="${g.id}" ${pc.grossNoCorrelate?.[g.id] ? 'checked' : ''} ${dis}> No microscopic correlate</label>`}</div>`; }).join('') || '<span class="nsf">None</span>'}</td>
    </tr>`;
  if (!editing || editing.t !== ti) return row;
  if (editing.tissue) {
    return row + `<tr class="fedit"><td></td><td colspan="3"><div class="form" style="grid-template-columns:120px 1fr 1fr">
      <div class="field"><label for="te-b">Block or slide</label><input id="te-b" value="${esc(t.block ?? '')}" maxlength="12"></div>
      <div class="field"><label for="te-c">Comment on this tissue</label><input id="te-c" value="${esc(t.comment)}" maxlength="500"></div>
      <div class="field"><label><input type="checkbox" id="te-r" ${t.recut ? 'checked' : ''}> Recut, level or special stain needed</label><input id="te-rn" value="${esc(t.recutNote)}" maxlength="200" placeholder="What is needed"></div>
      <div class="full row"><button class="btn small" type="button" id="te-save">Save</button><button class="btn small quiet" type="button" id="te-cancel">Cancel</button>
        ${t.fromNecropsy ? '' : '<span class="spacer"></span><button class="btn small quiet" type="button" id="te-del">Remove tissue</button>'}</div></div></td></tr>`;
  }
  const x = editing.x >= 0 ? t.diagnoses[editing.x] : { term: '', modifier: '', distribution: '', laterality: '', severity: '', behavior: '', origin: 'Primary', correlates: [], comment: '', neoplasm: false };
  const paired = meta.pathology.paired.includes(t.organ);
  return row + `
    <tr class="fedit"><td></td><td colspan="3">
      <datalist id="dxlist">${diagnosesFor(t.organ, meta.pathology.diagnoses).map((o) => `<option value="${esc(o.term)}" label="${esc((meta.pathology.systems.find((x) => x.key === o.system)?.name || '') + (o.send?.verified ? ' · SEND coded' : ''))}">`).join('')}</datalist>
      <div class="form" id="dxform" style="grid-template-columns:2fr 1fr 1fr 1fr">
        <div class="field"><label for="dx-t">Diagnosis (${esc(t.organ)})</label><input id="dx-t" list="dxlist" value="${esc(x.term)}" maxlength="120" autocomplete="off" placeholder="Start typing, e.g. hyperplasia">
          <span class="small muted" id="dx-send"></span></div>
        <div class="field"><label for="dx-m">Modifier</label><input id="dx-m" value="${esc(x.modifier)}" maxlength="120" placeholder="e.g. centrilobular"></div>
        <div class="field"><label for="dx-d">Distribution</label><select id="dx-d">${options(meta.pathology.distribution, x.distribution, { blank: 'Not stated' })}</select></div>
        <div class="field">${paired ? `<label for="dx-l">Side</label><select id="dx-l">${options(meta.pathology.laterality, x.laterality, { blank: 'Not stated' })}</select>` : ''}</div>
        <div class="field" data-when="grade"><label for="dx-s">Severity</label><select id="dx-s">${options(meta.pathology.severity.map(([k, v]) => [k, /^\d$/.test(k) ? `${k} ${v}` : v]), x.severity, { blank: 'Choose' })}</select></div>
        <div class="field" data-when="neo"><label for="dx-b">Behavior</label><select id="dx-b">${options(meta.pathology.behavior, x.behavior, { blank: 'Choose' })}</select></div>
        <div class="field" data-when="neo"><label for="dx-o">Origin</label><select id="dx-o">${options(meta.pathology.origin, x.origin || 'Primary')}</select></div>
        <div class="field" data-when="custom"><label><input type="checkbox" id="dx-n" ${x.neoplasm ? 'checked' : ''}> Neoplasm</label><span class="small muted">Not in the dictionary</span></div>
        ${ctx.grossFindings.length ? `<div class="field full"><span class="lbl">Correlates with gross finding</span><div class="checks">${ctx.grossFindings.map((g) => `<label><input type="checkbox" class="dx-c" value="${g.id}" ${(x.correlates || []).includes(g.id) ? 'checked' : ''}> ${esc(g.organ)}: ${esc(g.text)}</label>`).join('')}</div></div>` : ''}
        <div class="field full"><label for="dx-k">Comment</label><input id="dx-k" value="${esc(x.comment)}" maxlength="300"></div>
        <div class="full row"><button class="btn small" type="button" id="dx-save">Save diagnosis</button><button class="btn small quiet" type="button" id="dx-cancel">Cancel</button></div>
      </div>
    </td></tr>`;
}

function wire(app, meta, pl) {
  const s = ctx.subject;
  const redraw = () => {
    const a = document.activeElement;
    const sel = a && a.id ? `#${a.id}` : a && a.dataset && Object.keys(a.dataset).length
      ? Object.entries(a.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${v}"]`).join('') : null;
    draw(app, meta, pl);
    if (sel) $(sel, app)?.focus();
  };
  const mark = () => { dirty = true; };
  $$('[data-res]', app).forEach((b) => b.addEventListener('click', () => {
    const [ti, k] = b.dataset.res.split(':');
    const t = pc.tissues[Number(ti)];
    if (k !== 'LESIONS' && t.diagnoses.length) { toast('Remove the diagnoses first, or keep the result as Lesions.', 'error'); return; }
    t.result = k; mark();
    if (k === 'LESIONS' && !t.diagnoses.length) editing = { t: Number(ti), x: -1 };
    redraw(); if (editing) $('#dx-t')?.focus();
  }));
  $$('[data-bulk]', app).forEach((b) => b.addEventListener('click', () => { pc.tissues.forEach((t) => { if (t.result === 'PENDING') t.result = b.dataset.bulk; }); mark(); redraw(); }));
  $$('[data-dxa]', app).forEach((b) => b.addEventListener('click', () => { editing = { t: Number(b.dataset.dxa), x: -1 }; redraw(); $('#dx-t')?.focus(); }));
  $$('[data-dxe]', app).forEach((b) => b.addEventListener('click', () => { const [t, x] = b.dataset.dxe.split(':').map(Number); editing = { t, x }; redraw(); $('#dx-t')?.focus(); }));
  $$('[data-dxd]', app).forEach((b) => b.addEventListener('click', () => {
    const [t, x] = b.dataset.dxd.split(':').map(Number);
    const removed = pc.tissues[t].diagnoses.splice(x, 1)[0];
    if (pc.causeOfDeath.dxId === removed.id) pc.causeOfDeath.dxId = null;
    if (!pc.tissues[t].diagnoses.length) pc.tissues[t].result = 'PENDING';
    mark(); redraw();
  }));
  $$('[data-tdet]', app).forEach((b) => b.addEventListener('click', () => { editing = { t: Number(b.dataset.tdet), tissue: true }; redraw(); $('#te-b')?.focus(); }));
  $$('[data-nc]', app).forEach((c) => c.addEventListener('change', () => { pc.grossNoCorrelate = { ...(pc.grossNoCorrelate || {}) }; if (c.checked) pc.grossNoCorrelate[c.dataset.nc] = true; else delete pc.grossNoCorrelate[c.dataset.nc]; mark(); redraw(); }));

  // Diagnosis editor: show severity for non-neoplastic terms, behavior and origin for neoplasms.
  const syncDx = () => {
    const term = $('#dx-t')?.value.trim();
    if (term == null) return;
    const known = findDiagnosis(term, meta.pathology.diagnoses);
    const neo = known ? known.neoplasm : $('#dx-n')?.checked;
    $$('[data-when="grade"]', app).forEach((el) => { el.hidden = !!neo; });
    $$('[data-when="neo"]', app).forEach((el) => { el.hidden = !neo; });
    $$('[data-when="custom"]', app).forEach((el) => { el.hidden = !term || !!known; });
    const hint = $('#dx-send');
    if (hint) hint.textContent = known ? `${meta.pathology.systems.find((x) => x.key === known.system)?.name || ''}${known.send?.term ? `; SEND ${known.send.list}: ${known.send.term}${known.send.verified ? ` (${known.send.code})` : ' (not yet checked against SEND)'}` : ''}` : term ? 'Not in the library; it will be marked * and can be added under Terminology.' : '';
  };
  $('#dx-t')?.addEventListener('input', syncDx); $('#dx-n')?.addEventListener('change', syncDx); syncDx();
  $('#dx-cancel')?.addEventListener('click', () => { editing = null; redraw(); });
  $('#dx-save')?.addEventListener('click', () => {
    const term = $('#dx-t').value.trim();
    if (!term) { toast('Choose or type the diagnosis.', 'error'); $('#dx-t').focus(); return; }
    const known = findDiagnosis(term, meta.pathology.diagnoses);
    const neoplasm = known ? known.neoplasm : $('#dx-n').checked;
    const t = pc.tissues[editing.t];
    const prev = editing.x >= 0 ? t.diagnoses[editing.x] : {};
    const dxv = { ...prev, id: prev.id || `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, term: known ? known.term : term, inDictionary: !!known, neoplasm,
      modifier: $('#dx-m').value.trim(), distribution: $('#dx-d').value, laterality: $('#dx-l')?.value || '', severity: neoplasm ? '' : $('#dx-s').value,
      behavior: neoplasm ? $('#dx-b').value : '', origin: neoplasm ? $('#dx-o').value : '', correlates: $$('.dx-c:checked', app).map((c) => Number(c.value)), comment: $('#dx-k').value.trim() };
    // A gross finding correlates with one diagnosis; move it here if another had it.
    for (const o of pc.tissues) for (const other of o.diagnoses) if (other !== prev) other.correlates = (other.correlates || []).filter((g) => !dxv.correlates.includes(g));
    for (const g of dxv.correlates) if (pc.grossNoCorrelate) delete pc.grossNoCorrelate[g];
    if (editing.x >= 0) t.diagnoses[editing.x] = dxv; else t.diagnoses.push(dxv);
    t.result = 'LESIONS'; editing = null; mark(); redraw();
  });
  $('#te-cancel')?.addEventListener('click', () => { editing = null; redraw(); });
  $('#te-save')?.addEventListener('click', () => {
    const t = pc.tissues[editing.t];
    Object.assign(t, { block: $('#te-b').value.trim() || null, comment: $('#te-c').value.trim(), recut: $('#te-r').checked, recutNote: $('#te-rn').value.trim() });
    editing = null; mark(); redraw();
  });
  $('#te-del')?.addEventListener('click', () => { pc.tissues.splice(editing.t, 1); editing = null; mark(); redraw(); });
  $('#addtissue')?.addEventListener('click', () => {
    const organ = $('#addorg').value;
    if (!organ) { toast('Choose the tissue to add.', 'error'); return; }
    pc.tissues.push({ id: `t${Date.now().toString(36)}`, organ, block: $('#addblk').value.trim() || null, fromNecropsy: false, result: 'PENDING', diagnoses: [], comment: '', recut: false, recutNote: '' });
    mark(); redraw(); $('#addorg')?.focus();
  });
  const fields = { '#cod': (v) => { pc.causeOfDeath = { ...pc.causeOfDeath, kind: v }; return true; }, '#coddx': (v) => { pc.causeOfDeath = { ...pc.causeOfDeath, dxId: v || null }; },
    '#codc': (v) => { pc.causeOfDeath = { ...pc.causeOfDeath, comment: v }; }, '#pcom': (v) => { pc.comment = v; }, '#xq': (v) => { pc.extraQuarterHours = Math.max(0, parseInt(v, 10) || 0); return true; },
    '#xn': (v) => { pc.extraTimeNote = v; }, '#pini': (v) => { pc.pathologist = v.toUpperCase(); } };
  for (const [sel, fn] of Object.entries(fields)) {
    const el = $(sel, app);
    if (!el) continue;
    el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => { const again = fn(el.value); mark(); if (again || el.tagName === 'SELECT') redraw(); });
  }

  const save = async () => { const res = await api('PUT', `/api/pathology/${s.id}`, pc); ctx = res; pc = structuredClone(res.case); dirty = false; return res; };
  const go = async (id) => { if (dirty && pc.status !== 'SIGNED' && !ctx.waiting) await save(); navigate(`#/pathology/${id}`); };
  $('#prev')?.addEventListener('click', (e) => act(e.currentTarget, () => go(ctx.prevId)));
  $('#next')?.addEventListener('click', (e) => act(e.currentTarget, () => go(ctx.nextId)));
  $('#save')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await save(); redraw(); }, 'Draft saved'));
  $('#signout')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await api('POST', `/api/pathology/${s.id}/signout`, pc);
    ctx = res; pc = structuredClone(res.case); dirty = false; editing = null; redraw();
    return res;
  }, (res) => `Signed out. ${res.charges.filter((c) => c.status === 'PENDING').length ? 'Pathology charges sent to billing QC.' : ''}${res.nextId ? ' Use Next case to continue.' : ''}`));
  $('#amend')?.addEventListener('click', (e) => {
    const reason = prompt('Why is the report being amended? The reason is printed on the amended report.', '');
    if (!reason) return;
    act(e.currentTarget, async () => { const res = await api('POST', `/api/pathology/${s.id}/amend`, { reason }); ctx = res; pc = structuredClone(res.case); redraw(); }, 'Report reopened for amendment');
  });
}
