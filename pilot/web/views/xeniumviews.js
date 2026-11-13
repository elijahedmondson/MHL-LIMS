// Molecular > Xenium: PHL numbers waiting in the Xenium work area, planning a run (two Xenium slides), assigning it, and
// following it step by step to data delivery. Rules and lists are in core/xenium.mjs.
import { $, $$, api, esc, fmtDate, fmtDateTime, getMeta, act, pageTop, options, navigate } from '../ui.js';
import * as XEN from '../lib/xenium.mjs';
import { ihcTabs } from './ihcviews.js';

const STATUS_BADGE = { DELIVERED: 'complete', FAILED: 'muted', CANCELLED: 'muted', PLANNED: 'info' };
const statusBadge = (code) => `<span class="badge ${STATUS_BADGE[code] || 'warn'}">${esc(XEN.stepLabel(code))}</span>`;
const progress = (code) => (XEN.stepIndex(code) >= 0 ? `<span class="small muted">step ${XEN.stepIndex(code) + 1} of ${XEN.STEPS.length}</span>` : '');
const listState = { runs: 'active' };

function panelOptions(assay, selected) {
  const usable = XEN.PANELS.filter((p) => p.assay === assay || (assay === 'PROTEIN' && p.assay === 'V1'));
  return options(usable.map((p) => [p.id, p.name]), selected && usable.some((p) => p.id === selected) ? selected : usable[0]?.id);
}

export async function renderXenium(app) {
  const [meta, d] = await Promise.all([getMeta(true), api('GET', '/api/xenium')]);
  const runs = d.runs.filter((r) => listState.runs === 'all' || r.active);
  app.innerHTML = `
    ${ihcTabs('xenium', meta)}
    <p class="muted" style="max-width:900px">10x Genomics Xenium runs. PHL numbers moved to the Xenium work area wait here. Plan a run of up to ${XEN.SLIDES_PER_RUN} Xenium slides, assign it, and record each step; when the data are delivered the PHL numbers move on to their next work area. The CY2027 price list has no Xenium charge code, so runs make no charges in the pilot.</p>
    <h2 class="section">Waiting for a run <span class="small muted" style="font-weight:400">${d.queue.length} PHL number${d.queue.length === 1 ? '' : 's'}</span></h2>
    ${d.queue.length ? `<table class="t">
      <thead><tr><th><input type="checkbox" id="all" aria-label="Select all"></th><th>PHL#</th><th>Sample</th><th>Request</th><th>Investigator</th><th>Material</th><th>In Xenium since</th><th>Due</th></tr></thead>
      <tbody>${d.queue.map((q) => `<tr>
        <td class="mid"><input type="checkbox" class="sel" value="${q.subjectId}" aria-label="Select ${esc(q.phl)}"></td>
        <td class="code">${esc(q.phl)}${q.priority === 'S' ? ' <span class="badge stat">STAT</span>' : ''}</td><td>${esc(q.label)}</td>
        <td><a class="idtxt" href="#/request/${q.requestId}">${esc(q.requestNumber)}</a></td><td>${esc(q.investigator)}</td><td>${esc(q.speciesName)}</td>
        <td>${fmtDate(q.since)}</td><td>${q.due && q.due < meta.today ? `<span class="overdue">${fmtDate(q.due)}</span>` : fmtDate(q.due)}</td></tr>`).join('')}</tbody></table>
      <div class="actions"><button class="btn" type="button" id="plan">Plan a run with the selected PHL numbers</button></div>
      <div id="planbox"></div>`
    : '<p class="empty">Nothing waiting. Move PHL numbers to the Xenium work area on their request when their sections are ready.</p>'}
    <div class="row section"><h2 style="margin:0">Runs</h2><span class="spacer"></span>
      <div class="filters" role="group" aria-label="Show runs" style="margin:0">${[['active', 'In progress'], ['all', 'All']].map(([k, l]) => `<button type="button" data-runs="${k}" aria-pressed="${k === listState.runs}">${l}</button>`).join('')}</div></div>
    ${runs.length ? `<table class="t section">
      <thead><tr><th>Run</th><th>Step</th><th>Assay and panel</th><th>PHL numbers</th><th>Requests</th><th>Assigned to</th><th>Last step</th></tr></thead>
      <tbody>${runs.map((r) => `<tr>
        <td><a class="idtxt" href="#/molecular/xenium/run/${r.id}">${esc(r.number)}</a></td>
        <td>${statusBadge(r.status)}<br>${progress(r.status)}</td>
        <td>${esc(r.assayName)}<br><span class="small muted">${esc(r.panelName)}</span></td>
        <td class="small">${r.phls.map(esc).join('<br>')}<br><span class="muted">${r.slides} slide${r.slides === 1 ? '' : 's'}</span></td>
        <td>${r.requests.map((q) => `<a class="idtxt" href="#/request/${q.id}">${esc(q.number)}</a><br><span class="small muted">${esc(q.investigator)}</span>`).join('<br>')}</td>
        <td>${r.assignedTo ? `<strong>${esc(r.assignedTo)}</strong>` : '<span class="badge warn">Unassigned</span>'}</td>
        <td>${fmtDate(r.lastStepOn)}</td></tr>`).join('')}</tbody></table>`
    : `<p class="empty">${listState.runs === 'active' && d.runs.length ? 'No run in progress.' : 'No Xenium runs yet.'}</p>`}`;
  pageTop(app);
  $$('[data-runs]', app).forEach((b) => b.addEventListener('click', () => { listState.runs = b.dataset.runs; renderXenium(app); }));
  $('#all')?.addEventListener('change', (e) => { $$('.sel', app).forEach((c) => { c.checked = e.target.checked; }); });
  $('#plan')?.addEventListener('click', () => {
    const picked = $$('.sel:checked', app).map((c) => d.queue.find((q) => q.subjectId === Number(c.value)));
    if (!picked.length) { $('#planbox').innerHTML = '<p class="note">Tick the PHL numbers to put on the run.</p>'; return; }
    planForm($('#planbox'), meta, picked, d.staff);
  });
}

function planForm(box, meta, picked, staff) {
  const human = picked.some((q) => ['HUMAN', 'PDX', 'ORGANOID'].includes(q.species));
  const firstPanel = human ? 'H-5K' : 'M-5K';
  box.innerHTML = `
    <form class="panel section" id="planform" style="max-width:980px">
      <h2>Plan a Xenium run</h2>
      <div class="form" style="grid-template-columns:1fr 1.6fr 1fr;max-width:none">
        <div class="field"><label for="xassay">Assay</label><select id="xassay">${options(XEN.ASSAYS, 'PRIME')}</select></div>
        <div class="field"><label for="xpanel">Panel</label><select id="xpanel">${panelOptions('PRIME', firstPanel)}</select></div>
        <div class="field"><label for="xto">Assign to</label><input id="xto" list="xstaff" maxlength="4" placeholder="initials" style="text-transform:uppercase" autocomplete="off" value="${esc(meta.settings.initials || '')}"><datalist id="xstaff">${staff.map((x) => `<option value="${esc(x)}">`).join('')}</datalist></div>
        <div class="field"><label for="xcustom">Custom or add-on genes</label><input id="xcustom" maxlength="300" placeholder="e.g. a Custom Design Panel number"></div>
        <div class="field"><label for="xinst">Instrument serial</label><input id="xinst" maxlength="40" placeholder="Xenium Analyzer serial"></div>
        <div class="field"><label><input type="checkbox" id="xseg"> Multimodal cell segmentation staining</label></div>
      </div>
      <h3 class="section">Slides</h3>
      <table class="t"><thead><tr><th>PHL#</th><th>Sample</th><th>Request</th><th>Material</th><th>Slide</th></tr></thead>
        <tbody>${picked.map((q, i) => `<tr><td class="code">${esc(q.phl)}</td><td>${esc(q.label)}</td><td>${esc(q.requestNumber)}</td><td>${esc(q.speciesName)}</td>
          <td><select data-slot="${q.subjectId}" class="inp" style="width:auto" aria-label="Slide for ${esc(q.phl)}">${options([[1, 'Slide 1'], [2, 'Slide 2']], i % 2 === 0 || picked.length === 1 ? 1 : 2)}</select></td></tr>`).join('')}</tbody></table>
      <div class="form" style="grid-template-columns:1fr 1fr 2fr;max-width:none;margin-top:10px">
        <div class="field"><label for="xs1">Slide 1 serial number</label><input id="xs1" maxlength="40" placeholder="from the slide label"></div>
        <div class="field"><label for="xs2">Slide 2 serial number</label><input id="xs2" maxlength="40"></div>
        <div class="field"><label for="xnotes">Notes</label><input id="xnotes" maxlength="2000"></div>
      </div>
      <p class="small muted">Each Xenium slide holds the sections that fit its imageable area; check the layout with the slide guide. The serial numbers can be filled in later, before the slides go on the instrument.</p>
      <div id="xwarn"></div>
      <div class="actions"><button class="btn" type="submit">Plan the run</button></div>
    </form>`;
  const warn = () => {
    const w = XEN.panelWarnings({ assay: $('#xassay').value, panelId: $('#xpanel').value, segmentation: $('#xseg').checked }, picked.map((q) => q.species));
    $('#xwarn').innerHTML = w.map((x) => `<p class="note">${esc(x)}</p>`).join('');
  };
  $('#xassay').addEventListener('change', () => { $('#xpanel').innerHTML = panelOptions($('#xassay').value, $('#xpanel').value); warn(); });
  $$('#xpanel, #xseg', box).forEach((el) => el.addEventListener('change', warn));
  warn();
  $('#planform').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const slot = (id) => Number($(`[data-slot="${id}"]`).value);
      const slides = [1, 2].map((n) => ({ slot: n, slideSerial: $(`#xs${n}`).value.trim(), subjectIds: picked.filter((q) => slot(q.subjectId) === n).map((q) => q.subjectId) }))
        .filter((s) => s.subjectIds.length);
      const r = await api('POST', '/api/xenium/runs', { assay: $('#xassay').value, panelId: $('#xpanel').value, customNote: $('#xcustom').value, segmentation: $('#xseg').checked,
        instrumentSerial: $('#xinst').value, assignedTo: $('#xto').value.trim(), notes: $('#xnotes').value, slides });
      navigate(`#/molecular/xenium/run/${r.id}`);
      return r;
    }, (r) => `Run ${r.number} planned`);
  });
  box.scrollIntoView?.({ block: 'start' });
}

export async function renderXeniumRun(app, id) {
  const [meta, d] = await Promise.all([getMeta(true), api('GET', `/api/xenium/runs/${id}`)]);
  const x = d.run;
  const active = d.summary.active;
  const lockedPanel = XEN.stepIndex(x.status) >= XEN.stepIndex('PROBES') || !active;
  app.innerHTML = `
    <div class="crumb noprint"><a href="#/molecular/xenium">Xenium</a></div>
    <div class="head"><h1>${esc(x.number)}</h1>${statusBadge(x.status)}${progress(x.status)}</div>
    <div class="facts"><span><b>${esc(XEN.assayName(x.assay))}</b></span><span>${esc(x.panelName)}</span>${x.segmentation ? '<span>Cell segmentation staining</span>' : ''}
      <span>Assigned to <b>${esc(x.assignedTo || 'nobody yet')}</b></span>${x.instrumentSerial ? `<span>Instrument ${esc(x.instrumentSerial)}</span>` : ''}<span>Planned ${fmtDate(x.createdOn)} by ${esc(x.createdBy)}</span></div>
    ${d.warnings.map((w) => `<p class="note">${esc(w)}</p>`).join('')}
    ${x.status === 'FAILED' || x.status === 'CANCELLED' ? `<p class="note">${esc(XEN.stepLabel(x.status))}: ${esc(x.failReason)}. Its sections are back in the queue.</p>` : ''}
    <div class="split section">
      <div>
        <h2>Steps</h2>
        <table class="t"><tbody>${d.steps.map((st) => `<tr class="${st.on ? '' : 'dim'}"><td>${st.on ? '✓' : ''}</td><td><strong>${esc(st.label)}</strong>${st.note ? `<br><span class="small muted">${esc(st.note)}</span>` : ''}</td>
          <td class="small">${st.on ? `${fmtDate(st.on)}<br>${esc(st.by)}` : ''}</td></tr>`).join('')}</tbody></table>
        ${d.next ? `<form class="panel section noprint" id="advance">
          <h3>Next: ${esc(XEN.stepLabel(d.next))}</h3>
          <div class="form" style="grid-template-columns:1fr 2fr;max-width:none">
            <div class="field"><label for="adate">Date</label><input id="adate" type="date" value="${meta.today}" max="${meta.today}"></div>
            <div class="field"><label for="anote">Note</label><input id="anote" maxlength="300"></div>
            ${d.next === 'DELIVERED' ? '<div class="field full"><label><input type="checkbox" id="amove" checked> Move the PHL numbers on to their next work area</label></div>' : ''}
          </div>
          <div class="actions"><button class="btn" type="submit">Mark done</button>${x.status !== 'PLANNED' ? '<button class="btn quiet" type="button" id="back">Undo the last step</button>' : ''}
            <button class="btn quiet" type="button" id="endrun">Failed or cancelled…</button></div>
        </form>
        <form class="panel section noprint" id="endform" hidden>
          <div class="field"><span class="lbl">Outcome</span><div class="checks"><label><input type="radio" name="outcome" value="FAILED" checked> The run failed</label><label><input type="radio" name="outcome" value="CANCELLED"> Cancelled</label></div></div>
          <div class="field"><label for="ereason">Reason</label><input id="ereason" maxlength="500" required placeholder="e.g. Instrument error during cycle 4; tissue detached"></div>
          <p class="small muted">The sections go back to the queue for another run.</p>
          <div class="actions"><button class="btn" type="submit">Record it</button><button class="btn quiet" type="button" id="noend">Cancel</button></div>
        </form>` : ''}
        <h2 class="section">Slides</h2>
        ${d.slides.map((sl, i) => `<h3>Slide ${sl.slot}</h3>
          <div class="field" style="max-width:320px"><label for="ser${i}" class="small">Xenium slide serial number</label><input id="ser${i}" class="inp" data-serial="${i}" maxlength="40" value="${esc(sl.slideSerial)}" ${active ? '' : 'disabled'}></div>
          <table class="t"><thead><tr><th>PHL#</th><th>Sample</th><th>Request</th><th>Material</th><th>Where now</th></tr></thead><tbody>
            ${sl.sections.map((s) => `<tr><td class="code">${esc(s.phl)}</td><td>${esc(s.label)}</td><td><a class="idtxt" href="#/request/${s.requestId}">${esc(s.requestNumber)}</a><br><span class="small muted">${esc(s.investigator)}</span></td><td>${esc(s.species)}</td><td class="small">${esc((meta.areas.find((a) => a.code === s.area) || {}).name || s.area)}</td></tr>`).join('')}
          </tbody></table>`).join('')}
        ${active ? '<div class="actions noprint"><button class="btn small quiet" type="button" id="saveser">Save serial numbers</button></div>' : ''}
      </div>
      <div>
        <h2>Run details</h2>
        <form class="form noprint" id="details" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="dto">Assigned to</label><input id="dto" list="dstaff" maxlength="4" style="text-transform:uppercase" value="${esc(x.assignedTo || '')}" autocomplete="off"><datalist id="dstaff">${d.staff.map((v) => `<option value="${esc(v)}">`).join('')}</datalist></div>
          <div class="field"><label for="dinst">Instrument serial</label><input id="dinst" maxlength="40" value="${esc(x.instrumentSerial)}" ${active ? '' : 'disabled'}></div>
          <div class="field"><label for="dassay">Assay</label><select id="dassay" ${lockedPanel ? 'disabled' : ''}>${options(XEN.ASSAYS, x.assay)}</select></div>
          <div class="field"><label for="dpanel">Panel</label><select id="dpanel" ${lockedPanel ? 'disabled' : ''}>${panelOptions(x.assay, x.panelId)}</select></div>
          <div class="field full"><label for="dcustom">Custom or add-on genes</label><input id="dcustom" maxlength="300" value="${esc(x.customNote)}" ${lockedPanel ? 'disabled' : ''}></div>
          <div class="field full"><label><input type="checkbox" id="dseg" ${x.segmentation ? 'checked' : ''} ${lockedPanel ? 'disabled' : ''}> Multimodal cell segmentation staining</label></div>
          <div class="field full"><label for="dnotes">Notes</label><textarea id="dnotes" maxlength="2000" rows="3">${esc(x.notes)}</textarea></div>
          <div class="full"><button class="btn small quiet" type="submit">Save details</button>${lockedPanel && active ? ' <span class="small muted">The probes are on the slides: the assay and panel are fixed.</span>' : ''}</div>
        </form>
        <h2 class="section">Quality and data</h2>
        <form class="form noprint" id="qc" style="grid-template-columns:1fr 1fr">
          ${XEN.QC_FIELDS.map(([k, label, unit]) => `<div class="field"><label for="q${k}">${esc(label)}${unit ? ` (${esc(unit)})` : ''}</label><input id="q${k}" data-qc="${k}" type="number" min="0" step="any" value="${x.qc[k] ?? ''}"></div>`).join('')}
          <div class="field full"><label for="qout">Output folder</label><input id="qout" maxlength="400" value="${esc(x.outputFolder)}" placeholder="e.g. \\\\server\\Xenium\\${esc(x.number)}"></div>
          <div class="full"><button class="btn small quiet" type="submit">Save quality and data</button></div>
        </form>
        <p class="small muted">From the run summary Xenium Onboard Analysis writes, and where the output folder was copied for the investigator.</p>
        <div class="actions noprint"><button class="btn quiet" type="button" id="print">Print run sheet</button></div>
        <h2 class="section">History</h2>
        <table class="t"><tbody>${d.history.map((h) => `<tr><td class="small">${fmtDateTime(h.at)}<br>${esc(h.by)}</td><td class="small">${esc(h.detail)}</td></tr>`).join('')}</tbody></table>
      </div>
    </div>`;
  pageTop(app);
  const reload = () => renderXeniumRun(app, id);
  $('#print').addEventListener('click', () => window.print());
  $('#advance')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { const r = await api('POST', `/api/xenium/runs/${id}/advance`, { date: $('#adate').value, note: $('#anote').value, moveOn: $('#amove') ? $('#amove').checked : undefined }); await reload(); return r; },
      (r) => `${XEN.stepLabel(r.status)}${r.moved.length ? `; ${r.moved.length} PHL number${r.moved.length === 1 ? '' : 's'} moved on` : ''}`);
  });
  $('#back')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/xenium/runs/${id}/back`, {}); await reload(); }, 'Last step undone'));
  $('#endrun')?.addEventListener('click', () => { $('#endform').hidden = false; $('#ereason').focus(); });
  $('#noend')?.addEventListener('click', () => { $('#endform').hidden = true; });
  $('#endform')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { await api('POST', `/api/xenium/runs/${id}/end`, { outcome: $('input[name="outcome"]:checked').value, reason: $('#ereason').value }); await reload(); }, 'Recorded');
  });
  $('#saveser')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('PATCH', `/api/xenium/runs/${id}`, { slideSerials: $$('[data-serial]').map((el) => el.value) }); await reload(); }, 'Serial numbers saved'));
  $('#dassay').addEventListener('change', () => { $('#dpanel').innerHTML = panelOptions($('#dassay').value, $('#dpanel').value); });
  $('#details').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const body = { assignedTo: $('#dto').value.trim(), notes: $('#dnotes').value };
      if (!lockedPanel) Object.assign(body, { assay: $('#dassay').value, panelId: $('#dpanel').value, customNote: $('#dcustom').value, segmentation: $('#dseg').checked, instrumentSerial: $('#dinst').value });
      else if (active) body.instrumentSerial = $('#dinst').value;
      await api('PATCH', `/api/xenium/runs/${id}`, body);
      await reload();
    }, 'Run saved');
  });
  $('#qc').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('PATCH', `/api/xenium/runs/${id}`, { qc: Object.fromEntries($$('[data-qc]').map((el) => [el.dataset.qc, el.value])), outputFolder: $('#qout').value });
      await reload();
    }, 'Quality and data saved');
  });
}
