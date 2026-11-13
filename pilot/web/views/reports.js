// Printable reports for one animal (necropsy, pathology), all reports for a request or study, and the pathology
// summary tables shared by the study and request pages.
import { $, api, esc, fmtDate, fmtDateTime, pageTop, download, act } from '../ui.js';

const LAB = 'Molecular Histopathology Laboratory (MHL)';
const LAB2 = 'Laboratory Animal Sciences Program, NCI at Frederick';
const RESULT = { NSL: 'No significant lesions', LESIONS: 'Lesions', NOT_EXAMINED: 'Not examined', NOT_PRESENT: 'Tissue not present', PENDING: 'Not read yet' };

function header(r, title, draft) {
  const s = r.subject; const st = r.study; const n = r.necropsy;
  return `
    <div class="rep-head">
      <div><div class="rep-lab">${LAB}</div><div class="small muted">${LAB2}</div></div>
      <div class="rep-title">${esc(title)}${draft ? `<div class="rep-draft">${esc(draft)}</div>` : ''}</div>
    </div>
    <div class="rep-pilot">Pilot with test data: not a valid report</div>
    <table class="rep-facts"><tbody>
      <tr><th>PHL#</th><td class="code">${esc(s.phl)}</td><th>Animal or sample</th><td>${esc(s.label)}${[s.strain, s.genotype].filter(Boolean).length ? `<br><span class="small">${esc([s.strain, s.genotype].filter(Boolean).join(', '))}</span>` : ''}${s.dob ? `<br><span class="small">Born ${fmtDate(s.dob)}</span>` : s.age ? `<br><span class="small">Age ${esc(s.age)}</span>` : ''}</td><th>Species</th><td>${esc(s.species)}</td></tr>
      <tr><th>Study</th><td>${st ? `${esc(st.zap)}<br><span class="small">${esc(st.title)}</span>` : 'None'}</td><th>Group</th><td>${r.group ? `${esc(r.group.code)} ${esc(r.group.name)}${r.group.treatment ? `<br><span class="small">${esc(r.group.treatment)}</span>` : ''}` : esc(s.groupCode || 'None')}</td><th>Sex</th><td>${s.sex === 'F' ? 'Female' : s.sex === 'M' ? 'Male' : 'Not recorded'}</td></tr>
      <tr><th>Investigator</th><td>${esc(r.request.piName)}${r.request.inst ? `<br><span class="small">${esc(r.request.inst)}</span>` : ''}</td><th>Request</th><td>${esc(r.request.number)}<br><span class="small">${esc(r.request.type)}</span></td><th>ACUC protocol</th><td>${esc(st?.acuc || 'Not recorded')}</td></tr>
      ${n ? `<tr><th>Necropsy</th><td>${fmtDate(n.date)}, prosector ${esc(n.prosector)}</td><th>Fate</th><td>${esc(n.fate)}<br><span class="small">${esc(n.condition)}</span></td><th>Body weight</th><td>${n.bodyWeight != null ? `${n.bodyWeight} g` : 'Not recorded'}</td></tr>` : ''}
    </tbody></table>`;
}

function necropsySection(r) {
  const n = r.necropsy;
  if (!n) return '<p class="empty">No necropsy was recorded at MHL for this animal or sample.</p>';
  const notCollected = n.organs.filter((o) => o.notCollected).map((o) => o.organ);
  return `
    <h2 class="rep-h">Necropsy</h2>
    <p class="small">${esc(n.protocol)}${n.partial ? ', partial necropsy' : ''}${n.perfusion ? `, ${esc(n.perfusion)} perfusion` : ''}. Identification: ${esc(n.physicalId)}${n.matchesCageCard ? ', matches cage card' : ''}.</p>
    <table class="t rep-t"><thead><tr><th>Organ</th><th class="n">Block</th><th class="n">Weight (g)</th><th class="n">% body weight</th><th>Gross findings</th></tr></thead><tbody>
      ${n.organs.map((o) => `<tr><td>${esc(o.organ)}</td><td class="n">${esc(o.block ?? '')}</td><td class="n">${o.weight ?? ''}</td><td class="n">${o.relative ?? ''}</td>
        <td>${o.notCollected ? '<span class="muted">Not collected</span>' : o.findings.length ? o.findings.map((f) => esc(f.text)).join('<br>') : '<span class="muted">No gross findings</span>'}</td></tr>`).join('')}
    </tbody></table>
    ${notCollected.length ? `<p class="small"><strong>Not collected:</strong> ${notCollected.map(esc).join(', ')}.</p>` : ''}
    ${n.observations ? `<p><strong>Observations.</strong> ${esc(n.observations)}</p>` : ''}
    <p class="rep-sign">${n.status === 'APPROVED' ? `Necropsy approved by ${esc(n.approvedBy)} on ${fmtDateTime(n.approvedAt)}.` : 'Necropsy not approved yet (draft).'}</p>`;
}

function pathologySection(r) {
  const p = r.pathology;
  if (!p) return '<p class="empty">Pathology has not been started for this animal or sample.</p>';
  const lesions = p.tissues.filter((t) => t.diagnoses.length);
  const list = (k) => p.tissues.filter((t) => t.result === k).map((t) => `${esc(t.organ)}${t.block ? ` (${esc(t.block)})` : ''}`);
  const nsl = list('NSL'); const ne = list('NOT_EXAMINED'); const np = list('NOT_PRESENT'); const pending = list('PENDING');
  return `
    <h2 class="rep-h">Microscopic diagnoses</h2>
    ${lesions.length ? `<table class="t rep-t"><thead><tr><th>Tissue</th><th class="n">Block</th><th>Diagnosis</th></tr></thead><tbody>
      ${lesions.map((t) => `<tr><td>${esc(t.organ)}</td><td class="n">${esc(t.block ?? '')}</td><td>${t.diagnoses.map((x) => `<div class="${x.neoplasm ? 'rep-neo' : ''}">${esc(x.text)}${x.comment ? ` <span class="small muted">(${esc(x.comment)})</span>` : ''}</div>`).join('')}${t.comment ? `<div class="small muted">${esc(t.comment)}</div>` : ''}</td></tr>`).join('')}
    </tbody></table>` : '<p>No microscopic lesions in the tissues examined.</p>'}
    ${nsl.length ? `<p class="small"><strong>No significant lesions:</strong> ${nsl.join(', ')}.</p>` : ''}
    ${ne.length ? `<p class="small"><strong>Not examined:</strong> ${ne.join(', ')}.</p>` : ''}
    ${np.length ? `<p class="small"><strong>Tissue not present:</strong> ${np.join(', ')}.</p>` : ''}
    ${pending.length ? `<p class="small"><strong>Not read yet:</strong> ${pending.join(', ')}.</p>` : ''}
    <p class="small">Glass slides examined: ${p.slides}. Severity grades: 1 minimal, 2 mild, 3 moderate, 4 marked, 5 severe.</p>
    ${p.correlation.length ? `<h2 class="rep-h">Gross and microscopic correlation</h2>
      <table class="t rep-t"><thead><tr><th>Organ</th><th>Gross finding</th><th>Microscopic correlate</th></tr></thead><tbody>
        ${p.correlation.map((c) => `<tr><td>${esc(c.organ)}</td><td>${esc(c.gross)}</td><td>${esc(c.micro)}</td></tr>`).join('')}</tbody></table>` : ''}
    <h2 class="rep-h">Cause of death</h2><p>${esc(p.causeOfDeath || 'Not recorded')}${p.causeOfDeathComment ? `. ${esc(p.causeOfDeathComment)}` : ''}</p>
    ${p.comment ? `<h2 class="rep-h">Pathologist's comment</h2><p class="rep-comment">${esc(p.comment)}</p>` : ''}
    <div class="rep-sign">
      ${p.status === 'SIGNED' ? `Electronically signed by <strong>${esc(p.signedBy)}</strong> on ${fmtDateTime(p.signedAt)}.` : `Draft by ${esc(p.pathologist)}. Not signed out.`}
      ${p.amendments.length ? `<div><strong>Amended report, version ${p.version}.</strong> ${p.amendments.map((a) => `Version ${a.version}, ${fmtDateTime(a.at)} by ${esc(a.by)}: ${esc(a.reason)}`).join('. ')}.</div>` : ''}
      ${p.previous.length ? `<div class="small muted">Earlier signed versions: ${p.previous.map((v) => `v${v.version} by ${esc(v.signedBy)} on ${fmtDate(v.signedAt.slice(0, 10))}`).join('; ')}.</div>` : ''}
    </div>`;
}

export function reportHtml(r, kind) {
  if (kind === 'necropsy') return `<article class="report">${header(r, 'Necropsy report', r.necropsy && r.necropsy.status !== 'APPROVED' ? 'Draft' : '')}${necropsySection(r)}${footer(r)}</article>`;
  const draft = r.pathology && r.pathology.status !== 'SIGNED' ? 'Draft: not signed out' : '';
  return `<article class="report">${header(r, 'Pathology report', draft)}${pathologySection(r)}${footer(r)}</article>`;
}
const footer = (r) => `<p class="rep-foot small muted">${esc(r.subject.phl)} · printed ${fmtDateTime(r.printedAt)} by ${esc(r.printedBy)} from the MHL LIMS pilot</p>`;

export async function renderReport(app, subjectId, kind) {
  const r = await api('GET', `/api/reports/${subjectId}`);
  const other = kind === 'necropsy' ? 'pathology' : 'necropsy';
  app.innerHTML = `
    <div class="noprint row">
      <div class="crumb"><a href="#/request/${r.request.id}">${esc(r.request.number)}</a>${r.study ? ` / <a href="#/study/${r.study.id}">${esc(r.study.zap)}</a>` : ''}</div>
      <span class="spacer"></span>
      ${r.pathology || r.necropsy ? `<a class="btn quiet small" href="#/report/${subjectId}/${other}">${other === 'necropsy' ? 'Necropsy report' : 'Pathology report'}</a>` : ''}
      ${kind === 'pathology' ? `<a class="btn quiet small" href="#/pathology/${subjectId}">Open the case</a>` : `<a class="btn quiet small" href="#/necropsy/${subjectId}">Open the necropsy</a>`}
      <button class="btn small" type="button" id="print">Print</button>
    </div>
    ${reportHtml(r, kind)}`;
  pageTop(app);
  $('#print').addEventListener('click', () => window.print());
}

// Every signed-out pathology report (or approved necropsy report) for a request or a study, one per page.
export async function renderReportSet(app, scope, id, kind) {
  const sum = await api('GET', scope === 'study' ? `/api/studies/${id}/pathology` : `/api/requests/${id}/pathology`);
  const ids = kind === 'necropsy' ? sum.cases.map((c) => c.id) : sum.cases.filter((c) => c.status === 'SIGNED').map((c) => c.id);
  const reports = [];
  for (const sid of ids) { const r = await api('GET', `/api/reports/${sid}`); if (kind !== 'necropsy' || r.necropsy?.status === 'APPROVED') reports.push(r); }
  app.innerHTML = `
    <div class="noprint row"><div class="crumb"><a href="#/${scope === 'study' ? `study/${id}?view=pathology` : `request/${id}/pathology`}">Back</a></div><span class="spacer"></span>
      <span class="muted small">${reports.length} ${kind === 'necropsy' ? 'approved necropsy' : 'signed-out pathology'} reports</span><button class="btn small" type="button" id="print">Print all</button></div>
    ${reports.length ? reports.map((r) => reportHtml(r, kind)).join('') : '<p class="empty">No reports are ready yet.</p>'}`;
  pageTop(app);
  $('#print').addEventListener('click', () => window.print());
}

// ---------- summary tables ----------
const groupName = (groups, code) => groups.find((g) => g.code === code)?.name || '';

export function pathologySummaryHtml(sum, { csvPath, scope, id, necropsy = true }) {
  const signed = sum.cases.filter((c) => c.status === 'SIGNED').length;
  const g = sum.groupKeys;
  const label = (k) => `${esc(k)}${groupName(sum.groups, k) ? `<br><span class="small muted" style="font-weight:400">${esc(groupName(sum.groups, k))}</span>` : ''}`;
  const head = `
    <div class="row"><h2 style="margin:0">Pathology</h2><span class="small muted">${signed} of ${sum.cases.length} reports signed out; summaries include signed-out reports only.</span><span class="spacer"></span>
      <a class="btn small quiet" href="#/reports/${scope}/${id}/pathology">Print all signed reports</a>
      ${necropsy ? `<a class="btn small quiet" href="#/reports/${scope}/${id}/necropsy">Print necropsy reports</a>` : ''}
      <button class="btn small quiet" type="button" data-csv="${esc(csvPath)}">Download diagnoses (CSV)</button></div>`;
  if (!signed) return `${head}<p class="empty">No pathology reports are signed out yet.</p>`;
  const neo = sum.neoplasms;
  return `${head}
    <h3 class="section">Incidence of microscopic findings</h3>
    <table class="t"><thead><tr><th>Tissue</th><th>Diagnosis</th>${g.map((k) => `<th class="n">${label(k)}</th>`).join('')}</tr></thead><tbody>
      ${sum.incidence.map((r, i) => `<tr${i && sum.incidence[i - 1].organ !== r.organ ? ' class="grp-start"' : ''}><td>${i && sum.incidence[i - 1].organ === r.organ ? '' : esc(r.organ)}</td>
        <td class="${r.neoplasm ? 'rep-neo' : ''}">${esc(r.term)}</td>${g.map((k) => { const c = r.byGroup[k]; return `<td class="n ${c.affected ? '' : 'muted'}">${c.affected}/${c.examined}${c.meanGrade != null ? ` <span class="small muted">(${c.meanGrade})</span>` : ''}</td>`; }).join('')}</tr>`).join('')}
    </tbody></table>
    <p class="small muted">Animals with the finding / animals whose tissue was read. In brackets: mean severity of the affected animals (1 minimal to 5 severe). Neoplasms in bold.</p>
    <h3 class="section">Neoplasms</h3>
    <table class="t" style="max-width:640px"><thead><tr><th></th>${g.map((k) => `<th class="n">${esc(k)}</th>`).join('')}</tr></thead><tbody>
      ${[['animals', 'Animals with a signed-out report'], ['any', 'Animals with any neoplasm'], ['benign', 'Animals with a benign primary neoplasm'], ['malignant', 'Animals with a malignant primary neoplasm'], ['metastatic', 'Animals with metastases'], ['primaryBenign', 'Benign primary neoplasms (count)'], ['primaryMalignant', 'Malignant primary neoplasms (count)']]
        .map(([k, l]) => `<tr><td>${l}</td>${g.map((x) => `<td class="n">${neo[x]?.[k] ?? 0}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <h3 class="section">Individual animal findings</h3>
    <div class="panel tab-wrap"><table class="t tabulated"><thead><tr><th>Tissue / diagnosis</th>${sum.animals.map((a) => `<th class="n"><a href="#/report/${a.id}/pathology" title="${esc(a.phl)}">${esc(a.label)}</a><br><span class="small muted" style="font-weight:400">${esc(a.group)}${a.sex ? ` ${esc(a.sex)}` : ''}</span></th>`).join('')}</tr></thead><tbody>
      ${sum.tabulated.map((row) => `<tr class="org"><td>${esc(row.organ)}</td>${sum.animals.map((a) => `<td class="n">${esc(row.status[a.id] || '')}</td>`).join('')}</tr>
        ${row.diagnoses.map((x) => `<tr><td class="dxrow">${esc(x.term)}</td>${sum.animals.map((a) => `<td class="n"><strong>${esc(x.cells[a.id] || '')}</strong></td>`).join('')}</tr>`).join('')}`).join('')}
    </tbody></table></div>
    <p class="small muted">Tissue rows: - no significant lesions, + lesions, NE not examined, NP not present. Diagnosis rows: severity 1-5, P present, B benign, M malignant (m metastatic).${sum.notRead.length ? ` Not read in any animal: ${sum.notRead.map(esc).join(', ')}.` : ''}</p>`;
}

export function wireSummary(box) {
  box.querySelectorAll('[data-csv]').forEach((b) => b.addEventListener('click', () => act(b, () => download(b.dataset.csv), (f) => `Downloaded ${f.name}`)));
}

export function casesTable(sum) {
  const groups = sum.groupKeys.some((g) => g !== 'All');
  return `<table class="t"><thead><tr><th>PHL#</th><th>Animal or sample</th>${groups ? '<th>Group</th>' : ''}<th>Pathologist</th><th>Report</th><th></th></tr></thead><tbody>
    ${sum.cases.map((c) => `<tr><td class="code">${esc(c.phl)}</td><td>${esc(c.label)}</td>${groups ? `<td>${esc(c.group)}${c.sex ? ` (${esc(c.sex)})` : ''}</td>` : ''}<td>${esc(c.pathologist || '')}</td>
      <td><span class="badge ${c.status === 'SIGNED' ? 'complete' : c.status === 'DRAFT' ? 'warn' : c.status === 'WAITING' ? 'muted' : ''}">${{ SIGNED: 'Signed out', DRAFT: 'Draft', WAITING: 'Waiting for necropsy', NOT_STARTED: 'Not started' }[c.status]}${c.version > 1 ? ` v${c.version}` : ''}</span>${c.signedAt ? `<br><span class="small muted">${fmtDate(c.signedAt.slice(0, 10))}</span>` : ''}</td>
      <td class="mid"><div class="rowbtns">${c.status === 'WAITING' ? '' : `<a class="btn small quiet" href="#/pathology/${c.id}">${c.status === 'SIGNED' ? 'Case' : c.status === 'DRAFT' ? 'Continue' : 'Start'}</a>`}${c.status === 'SIGNED' ? `<a class="btn small quiet" href="#/report/${c.id}/pathology">Report</a>` : ''}</div></td></tr>`).join('')}
  </tbody></table>`;
}
