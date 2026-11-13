// Study page: groups, animals, organ weight summaries with charts, gross findings incidence, CSV export.
import { $, $$, api, esc, fmtDate, getMeta, areaName, act, pageTop, options, download } from '../ui.js';
import { pathologySummaryHtml, wireSummary } from './reports.js';
import { studyBloodworkHtml, wireStudyBloodwork } from './bloodviews.js';
import { PALETTE, fmt, dotPlot } from './charts.js';

export async function renderStudy(app, id, view) {
  const [d, meta, path, blood] = await Promise.all([api('GET', `/api/studies/${id}`), getMeta(), api('GET', `/api/studies/${id}/pathology`), api('GET', `/api/studies/${id}/bloodwork`)]);
  const signed = path.cases.filter((c) => c.status === 'SIGNED').length;
  const s = d.study;
  const colors = Object.fromEntries(d.groupKeys.map((g, i) => [g, PALETTE[i % PALETTE.length]]));
  const series = view === 'relative' ? d.relative : d.absolute;
  const necropsied = d.animals.filter((a) => a.necropsy === 'APPROVED').length;
  app.innerHTML = `
    <div class="crumb"><a href="#/necropsy">Necropsy</a></div>
    <div class="head"><h1>${esc(s.zap)}</h1><span class="muted">${esc(s.title)}</span></div>
    <div class="facts"><span>${esc(s.piName || 'No investigator recorded')}</span><span>ACUC <b>${esc(s.acuc || 'not recorded')}</b></span><span>${esc(s.protocolName)}</span>
      <span>${necropsied} of ${d.animals.length} animals necropsied</span><span>${signed} pathology reports signed out</span>
      ${d.requests.map((r) => `<a href="#/request/${r.id}">${esc(r.number)}</a>`).join(' ')}</div>
    <div class="actions"><a class="btn" href="#/studyreport/${s.id}/necropsy">Study necropsy report</a><a class="btn" href="#/studyreport/${s.id}/pathology">Study pathology report</a></div>

    <div class="split section">
      <div>
        <h2>Groups</h2>
        <table class="t" id="groups"><thead><tr><th>Code</th><th>Name</th><th>Sex</th><th>Treatment</th><th></th></tr></thead><tbody>
          ${s.groups.map((g, i) => groupRow(g, i)).join('')}
        </tbody></table>
        <div class="actions" style="margin-top:10px"><button class="btn small quiet" type="button" id="addg">Add group</button><button class="btn small" type="button" id="saveg">Save groups</button></div>

        <h2 class="section">Study details</h2>
        <form class="form" id="details" style="grid-template-columns:1fr 1fr">
          <div class="field full"><label for="st">Title</label><input id="st" value="${esc(s.title)}"></div>
          <div class="field"><label for="sa">ACUC protocol</label><input id="sa" value="${esc(s.acuc)}"></div>
          <div class="field"><label for="sp">Necropsy protocol</label><select id="sp">${options(meta.protocols.necropsy.filter((p) => !p.obsolete || p.id === s.necropsyProtocolId).map((p) => [p.id, p.name]), s.necropsyProtocolId)}</select></div>
          <div class="field"><label for="sx">Trim protocol</label><select id="sx">${options(meta.protocols.trim.filter((p) => !p.obsolete || p.id === s.trimProtocolId).map((p) => [p.id, p.name]), s.trimProtocolId, { blank: 'None' })}</select></div>
          <p class="small full"><a href="#/protocol/necropsy/${s.necropsyProtocolId}">View the necropsy protocol</a>${s.trimProtocolId ? ` · <a href="#/protocol/trim/${s.trimProtocolId}">View the trim protocol</a>` : ''}</p>
          <div class="full"><button class="btn small quiet" type="submit">Save details</button></div>
        </form>
        <p class="small muted">Changing the protocol affects animals not yet necropsied.</p>
      </div>
      <div>
        <h2>Animals</h2>
        <table class="t"><thead><tr><th>MHL#</th><th>Animal</th><th>Group</th><th>Sex</th><th>Where</th><th>Necropsy</th><th>Pathology</th></tr></thead><tbody>
          ${d.animals.map((a) => `<tr>
            <td class="code"><a href="#/necropsy/${a.id}">${esc(a.phl)}</a> ${a.priority === 'S' ? '<span class="badge stat">STAT</span>' : ''}</td><td>${esc(a.label)}</td>
            <td><select class="inp" data-g="${a.id}" aria-label="Group for ${esc(a.phl)}">${options(s.groups.map((g) => [g.code, g.code]), a.groupCode, { blank: 'None' })}</select></td>
            <td><select class="inp" data-s="${a.id}" aria-label="Sex for ${esc(a.phl)}">${options([['F', 'F'], ['M', 'M'], ['U', 'U']], a.sex, { blank: '' })}</select></td>
            <td class="small">${esc(areaName(meta, a.area))}</td>
            <td>${a.necropsy === 'APPROVED' ? `<a class="badge complete" href="#/report/${a.id}/necropsy" title="Necropsy report">Approved</a><br><span class="small muted">${fmtDate(a.necropsyDate)}, BW ${a.bodyWeight ?? ''} g</span>` : `<a href="#/necropsy/${a.id}">${a.necropsy === 'DRAFT' ? 'Draft' : 'Start'}</a>`}</td>
            <td>${(() => { const c = path.cases.find((x) => x.id === a.id); if (!c || c.status === 'WAITING') return '<span class="muted small">After necropsy</span>'; return c.status === 'SIGNED' ? `<a class="badge complete" href="#/report/${a.id}/pathology" title="Pathology report">Signed out</a>` : `<a href="#/pathology/${a.id}">${c.status === 'DRAFT' ? 'Draft' : 'Start'}</a>`; })()}</td>
          </tr>`).join('')}
        </tbody></table>
      </div>
    </div>

    <section class="section">
      <div class="row"><h2 style="margin:0">Organ weights</h2><span class="spacer"></span>
        <div class="seg" role="group" aria-label="Weight type">
          <button type="button" data-view="absolute" aria-pressed="${view !== 'relative'}">Absolute (g)</button>
          <button type="button" data-view="relative" aria-pressed="${view === 'relative'}">Relative (% of body weight)</button>
        </div>
        <button class="btn small quiet" type="button" id="csv">Download animal data (CSV)</button>
      </div>
      ${series.length ? `
        <p class="small muted">Approved necropsies only. Points are animals; the gray point and bars are the group mean and 95% confidence interval.</p>
        <div class="legend">${d.groupKeys.filter((g) => series.some((x) => x.groups.some((y) => y.code === g))).map((g) => `<span><svg width="12" height="12"><circle cx="6" cy="6" r="5" fill="${colors[g]}"/></svg>${esc(g)}${s.groups.find((x) => x.code === g)?.name ? ` ${esc(s.groups.find((x) => x.code === g).name)}` : ''}</span>`).join('')}
          <span><svg width="12" height="12"><circle cx="6" cy="6" r="4.5" fill="#777"/></svg>Female</span><span><svg width="12" height="12"><path d="M6 1 L11 11 L1 11 Z" fill="#777"/></svg>Male</span></div>
        ${summaryTable(series)}
        <div class="charts">${series.map((x) => dotPlot(x, colors)).join('')}</div>`
      : '<p class="empty">No approved necropsies with weights yet.</p>'}
    </section>

    <section class="section" id="pathsum">${pathologySummaryHtml(path, { csvPath: `/api/studies/${id}/pathology.csv`, scope: 'study', id })}
      ${signed ? `<p class="small"><button class="btn small quiet" type="button" id="sendmi">Download microscopic findings, SEND style (CSV)</button> <span class="muted">Coded with the library's SEND values; a convenience table, not a validated SEND dataset.</span></p>` : ''}</section>

    <section class="section" id="bloodsum">${studyBloodworkHtml(blood, id)}</section>

    <section class="section">
      <h2>Gross findings</h2>
      ${d.incidence.length ? `<table class="t"><thead><tr><th>Organ</th><th>Finding</th>${d.groupKeys.map((g) => `<th class="n">${esc(g)}</th>`).join('')}</tr></thead><tbody>
        ${d.incidence.map((r) => `<tr><td>${esc(r.organ)}</td><td>${esc(r.morphology)}</td>${d.groupKeys.map((g) => `<td class="n">${r.byGroup[g] || 0} / ${d.examined[g] || 0}</td>`).join('')}</tr>`).join('')}
      </tbody></table><p class="small muted">Animals with the finding / animals necropsied, by group.</p>` : '<p class="empty">No gross findings recorded in approved necropsies.</p>'}
    </section>`;
  pageTop(app);

  const reload = () => renderStudy(app, id, view);
  wireSummary($('#pathsum'));
  wireStudyBloodwork($('#bloodsum'));
  $('#sendmi')?.addEventListener('click', (e) => act(e.currentTarget, () => download(`/api/studies/${id}/send-mi.csv`), (f) => `Downloaded ${f.name}`));
  if (view === 'pathology') $('#pathsum')?.scrollIntoView();
  if (view === 'bloodwork') $('#bloodsum')?.scrollIntoView();
  $$('[data-view]', app).forEach((b) => b.addEventListener('click', () => { location.hash = `#/study/${id}?view=${b.dataset.view}`; }));
  $('#csv').addEventListener('click', (e) => act(e.currentTarget, () => download(`/api/studies/${id}/export.csv`), (f) => `Downloaded ${f.name}`));
  $('#addg').addEventListener('click', () => { $('#groups tbody').insertAdjacentHTML('beforeend', groupRow({ code: '', name: '', sex: '', treatment: '' }, $$('#groups tbody tr').length)); });
  $('#groups').addEventListener('click', (e) => { const b = e.target.closest('[data-rmg]'); if (b) b.closest('tr').remove(); });
  $('#saveg').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const groups = $$('#groups tbody tr').map((tr) => ({ code: $('[data-f="code"]', tr).value.trim(), name: $('[data-f="name"]', tr).value, sex: $('[data-f="sex"]', tr).value, treatment: $('[data-f="treatment"]', tr).value }));
    await api('PUT', `/api/studies/${id}/groups`, { groups });
    await reload();
  }, 'Groups saved'));
  $('#details').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { const nec = Number($('#sp').value); const trim = $('#sx').value ? Number($('#sx').value) : '';
      await api('PATCH', `/api/studies/${id}`, { title: $('#st').value, acuc: $('#sa').value,
        ...(nec !== s.necropsyProtocolId ? { necropsyProtocolId: nec } : {}), ...((trim || null) !== (s.trimProtocolId ?? null) ? { trimProtocolId: trim } : {}) }); await reload(); }, 'Study saved');
  });
  $$('[data-g]', app).forEach((sel) => sel.addEventListener('change', () => act(sel, async () => { await api('PATCH', `/api/subjects/${sel.dataset.g}`, { groupCode: sel.value }); await reload(); }, 'Group updated')));
  $$('[data-s]', app).forEach((sel) => sel.addEventListener('change', () => act(sel, async () => { await api('PATCH', `/api/subjects/${sel.dataset.s}`, { sex: sel.value }); await reload(); }, 'Sex updated')));
}

function groupRow(g, i) {
  return `<tr>
    <td><input class="inp" data-f="code" value="${esc(g.code)}" style="width:70px" aria-label="Group code ${i + 1}"></td>
    <td><input class="inp" data-f="name" value="${esc(g.name)}" aria-label="Group name ${i + 1}"></td>
    <td><select class="inp" data-f="sex" style="width:64px" aria-label="Group sex ${i + 1}">${options([['F', 'F'], ['M', 'M'], ['U', 'U']], g.sex, { blank: '' })}</select></td>
    <td><input class="inp" data-f="treatment" value="${esc(g.treatment)}" aria-label="Treatment ${i + 1}"></td>
    <td class="mid"><button class="btn small quiet" type="button" data-rmg aria-label="Remove group">Remove</button></td></tr>`;
}


function summaryTable(series) {
  const groups = [...new Set(series.flatMap((x) => x.groups.map((g) => g.code)))];
  return `<table class="t" style="margin-top:8px"><thead><tr><th>Measure</th>${groups.map((g) => `<th class="n">${esc(g)}<br><span class="small muted" style="font-weight:400">mean ± SD (n)</span></th>`).join('')}</tr></thead><tbody>
    ${series.map((x) => `<tr><td>${esc(x.label)} <span class="small muted">${esc(x.unit)}</span></td>${groups.map((g) => {
      const s = x.groups.find((y) => y.code === g);
      return `<td class="n">${s ? `${fmt(s.mean)}${s.sd != null ? ` ± ${fmt(s.sd)}` : ''} <span class="muted">(${s.n})</span>` : ''}</td>`;
    }).join('')}</tr>`).join('')}
  </tbody></table>`;
}
