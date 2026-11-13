// Printable study reports, for every animal in a study by group.
//   Study necropsy report: groups, animal disposition, gross lesion incidence and each animal's gross findings, organ
//   weights (tables and dot plots) and bloodwork (tables and scatterplots of every animal by group).
//   Study pathology report: incidence of microscopic findings, neoplasm tables, and each animal's findings by group.
// Incidences carry Fisher's exact test against the first group, as the footnotes say.
import { $, api, esc, fmtDate, fmtDateTime, act, pageTop } from '../ui.js';
import { groupColors, dotPlot, legendHtml, fmt, rangeText } from './charts.js';

const LAB = 'Molecular Histopathology Laboratory (MHL)';
const LAB2 = 'Laboratory Animal Sciences Program, NCI at Frederick';
const KIND = { HEMATOLOGY: 'Hematology', CHEMISTRY: 'Clinical chemistry' };
const pct = (a, n) => (n ? `${Math.round((a / n) * 100)}%` : '');
const star = (p) => (p == null ? '' : p < 0.01 ? '<sup class="sig">**</sup>' : p < 0.05 ? '<sup class="sig">*</sup>' : '');
const groupHead = (rep, k) => { const g = rep.groups.find((x) => x.code === k); return `${esc(k)}${g?.name ? `<br><span class="small" style="font-weight:400">${esc(g.name)}</span>` : ''}`; };
const fisherNote = (rep) => (rep.groups.length > 1 ? `<p class="small muted">Animals affected / animals examined (percent). * p &lt; 0.05, ** p &lt; 0.01 compared with group ${esc(rep.reference)}${rep.groups[0]?.name ? ` (${esc(rep.groups[0].name)})` : ''}, Fisher's exact test, two-sided, not adjusted for multiple comparisons.</p>` : '<p class="small muted">Animals affected / animals examined (percent).</p>');

function header(rep, title, status) {
  const s = rep.study;
  return `
    <div class="rep-head">
      <div><div class="rep-lab">${LAB}</div><div class="small muted">${LAB2}</div></div>
      <div class="rep-title">${esc(title)}${status ? `<div class="rep-draft">${esc(status)}</div>` : ''}</div>
    </div>
    <div class="rep-pilot">Pilot with test data: not a valid report</div>
    <table class="rep-facts"><tbody>
      <tr><th>Study</th><td><strong>${esc(s.zap)}</strong><br><span class="small">${esc(s.title)}</span></td><th>Investigator</th><td>${esc(s.piName || 'Not recorded')}${s.inst ? `<br><span class="small">${esc(s.inst)}</span>` : ''}</td><th>ACUC protocol</th><td>${esc(s.acuc || 'Not recorded')}</td></tr>
      <tr><th>Protocols</th><td>${esc(s.protocolName)}${s.trimProtocolName ? `<br><span class="small">Trim: ${esc(s.trimProtocolName)}</span>` : ''}</td><th>Requests</th><td>${rep.requests.map((r) => esc(r.number)).join(', ')}</td><th>Printed</th><td>${fmtDateTime(rep.printedAt)}<br><span class="small">by ${esc(rep.printedBy)}</span></td></tr>
    </tbody></table>`;
}

function groupsTable(rep, countLabel, count) {
  return `<table class="t rep-t"><thead><tr><th>Group</th><th>Name</th><th>Treatment</th><th>Sex</th><th class="n">Animals</th><th class="n">${esc(countLabel)}</th></tr></thead><tbody>
    ${rep.groups.map((g) => `<tr><td><strong>${esc(g.code)}</strong></td><td>${esc(g.name)}</td><td>${esc(g.treatment)}</td><td>${g.female && g.male ? `${g.female} F, ${g.male} M` : g.female ? 'Female' : g.male ? 'Male' : esc(g.sex || '')}</td><td class="n">${g.n}</td><td class="n">${count(g.code)}</td></tr>`).join('')}
  </tbody></table>`;
}

function summaryEditor(rep, kind) {
  const text = rep.notes?.[kind] || '';
  return `
    <section class="noprint panel section" id="notesbox">
      <label for="notes"><strong>Summary</strong> <span class="small muted">printed at the top of the report; for the ${kind === 'pathology' ? 'pathologist\'s' : 'study'} narrative and conclusions</span></label>
      <textarea id="notes" rows="4" maxlength="8000" style="width:100%;margin-top:6px">${esc(text)}</textarea>
      <div class="actions" style="margin-top:6px"><button class="btn small quiet" type="button" id="savenotes">Save summary</button></div>
    </section>
    ${text ? `<h2 class="rep-h print-keep">Summary</h2><p class="rep-comment">${esc(text)}</p>` : ''}`;
}

const sumCell = (g) => (g && g.n ? `${fmt(g.mean)}${g.sd != null ? ` ± ${fmt(g.sd)}` : ''} <span class="muted">(${g.n})</span>` : '');
function weightTable(series, keys) {
  return `<table class="t rep-t"><thead><tr><th>Measure</th>${keys.map((k) => `<th class="n">${esc(k)}</th>`).join('')}</tr></thead><tbody>
    ${series.map((x) => `<tr><td>${esc(x.label)} <span class="small muted">${esc(x.unit)}</span></td>${keys.map((k) => `<td class="n">${sumCell(x.groups.find((g) => g.code === k))}</td>`).join('')}</tr>`).join('')}
  </tbody></table><p class="small muted">Mean ± SD (n). Approved necropsies only.</p>`;
}

// ---------- study necropsy report ----------
function necropsyHtml(rep) {
  const colors = groupColors(rep.keys);
  const byGroup = (k) => rep.animals.filter((a) => a.group === k);
  const unapproved = rep.animals.length - rep.approved;
  const bw = rep.bloodwork;
  const bloodTables = bw.tables.filter((t) => t.animals);
  return `
    ${header(rep, 'Study necropsy report', unapproved ? `${unapproved} of ${rep.animals.length} necropsies not approved yet` : '')}
    ${summaryEditor(rep, 'necropsy')}
    <h2 class="rep-h">1. Groups</h2>
    ${groupsTable(rep, 'Necropsies approved', (k) => byGroup(k).filter((a) => a.necropsy === 'APPROVED').length)}

    <h2 class="rep-h">2. Animal disposition</h2>
    <table class="t rep-t"><thead><tr><th>Group</th><th>Animal</th><th>MHL#</th><th>Sex</th><th>Necropsy</th><th>Fate</th><th class="n">Body weight (g)</th><th>Prosector</th></tr></thead><tbody>
      ${rep.keys.map((k) => byGroup(k).map((a, i) => `<tr${i === 0 ? ' class="grp-start"' : ''}><td>${i === 0 ? `<strong>${esc(k)}</strong>` : ''}</td><td>${esc(a.label)}</td><td class="code">${esc(a.phl)}</td><td>${esc(a.sex)}</td>
        <td>${a.necropsy === 'APPROVED' ? fmtDate(a.date) : `<span class="muted">${a.necropsy === 'DRAFT' ? 'Draft' : 'Not done'}</span>`}</td><td class="small">${esc(a.fate)}${a.condition ? `<br>${esc(a.condition)}` : ''}</td>
        <td class="n">${a.necropsy === 'APPROVED' && a.bodyWeight != null ? a.bodyWeight : ''}</td><td>${esc(a.necropsy === 'APPROVED' ? a.prosector : '')}</td></tr>`).join('')).join('')}
    </tbody></table>

    <h2 class="rep-h">3. Gross lesions</h2>
    <h3 class="rep-h3">Incidence by group</h3>
    ${rep.incidence.length ? `<table class="t rep-t"><thead><tr><th>Organ</th><th>Finding</th>${rep.keys.map((k) => `<th class="n">${groupHead(rep, k)}</th>`).join('')}</tr></thead><tbody>
      ${rep.incidence.map((r, i) => `<tr${i && rep.incidence[i - 1].organ !== r.organ ? ' class="grp-start"' : ''}><td>${i && rep.incidence[i - 1].organ === r.organ ? '' : esc(r.organ)}</td><td>${esc(r.finding)}</td>
        ${r.cells.map((c, j) => `<td class="n ${c.affected ? '' : 'muted'}">${c.affected}/${c.examined} <span class="small muted">${pct(c.affected, c.examined)}</span>${star(r.p[j])}</td>`).join('')}</tr>`).join('')}
    </tbody></table>${fisherNote(rep)}` : '<p class="empty">No gross lesions recorded in approved necropsies.</p>'}
    <h3 class="rep-h3">Individual animal gross findings</h3>
    ${rep.keys.map((k) => `<h4 class="rep-h4">Group ${groupHead(rep, k).replace('<br>', ' ')}</h4>
      <table class="t rep-t"><tbody>${byGroup(k).map((a) => `<tr><td style="width:150px"><strong>${esc(a.label)}</strong> <span class="small muted">${esc(a.phl)}${a.sex ? `, ${esc(a.sex)}` : ''}</span></td>
        <td>${a.necropsy !== 'APPROVED' ? '<span class="muted">Necropsy not approved</span>' : a.findings.length ? a.findings.map((f) => `${esc(f.organ)}: ${esc(f.text)}`).join('<br>') : 'No gross lesions'}
          ${a.notCollected.length ? `<br><span class="small muted">Not collected: ${a.notCollected.map(esc).join(', ')}</span>` : ''}${a.observations ? `<br><span class="small">${esc(a.observations)}</span>` : ''}</td></tr>`).join('')}</tbody></table>`).join('')}

    <h2 class="rep-h">4. Organ weights</h2>
    ${rep.absolute.length ? `
      <h3 class="rep-h3">Absolute weights</h3>${weightTable(rep.absolute, rep.keys)}
      ${legendHtml(rep.keys, colors, rep.groups)}
      <div class="charts">${rep.absolute.map((x) => dotPlot(x, colors, { small: true })).join('')}</div>
      ${rep.relative.length ? `<h3 class="rep-h3">Relative weights (% of body weight)</h3>${weightTable(rep.relative, rep.keys)}
        <div class="charts">${rep.relative.map((x) => dotPlot(x, colors, { small: true })).join('')}</div>` : ''}` : '<p class="empty">No approved necropsies with weights yet.</p>'}

    <h2 class="rep-h">5. Bloodwork</h2>
    ${bloodTables.length ? bloodTables.map((t) => `
      <h3 class="rep-h3">${KIND[t.kind] || esc(t.kind)} <span class="small muted" style="font-weight:400">${t.animals} animals, the latest released result of each</span></h3>
      <table class="t rep-t"><thead><tr><th>Analyte</th><th>Unit</th><th>Reference range</th>${rep.keys.map((k) => `<th class="n">${esc(k)}</th>`).join('')}</tr></thead><tbody>
        ${t.analytes.map((a) => `<tr><td>${esc(a.name)} <span class="small muted">${esc(a.code)}</span></td><td class="small">${esc(a.unit)}</td><td class="small">${rangeText(a.range)}</td>
          ${rep.keys.map((k) => `<td class="n">${sumCell(a.groups.find((g) => g.code === k))}</td>`).join('')}</tr>`).join('')}
      </tbody></table>
      ${legendHtml(rep.keys, colors, rep.groups, { range: t.analytes.some((a) => a.range), flags: t.analytes.some((a) => a.points.some((p) => p.flag)) })}
      <div class="charts">${t.analytes.map((a) => dotPlot({ label: a.name, unit: a.unit, groups: a.groups, points: a.points }, colors, { small: true, range: a.range })).join('')}</div>`).join('')
      : '<p class="empty">No released bloodwork for this study.</p>'}
    ${bw.cytology.length ? `<h3 class="rep-h3">Cytology</h3><table class="t rep-t"><tbody>${bw.cytology.map((c) => `<tr><td class="code">${esc(c.phl)}</td><td>${esc(c.specimen)}</td><td>${c.status === 'SIGNED' ? 'Signed' : 'Draft'}</td></tr>`).join('')}</tbody></table>` : ''}
    <div class="rep-foot small muted">${esc(rep.study.zap)} study necropsy report · ${LAB} · MHL LIMS pilot</div>`;
}

// ---------- study pathology report ----------
function pathologyHtml(rep) {
  const unsigned = rep.animals.length - rep.signed;
  const byGroup = (k) => rep.animals.filter((a) => a.group === k);
  const neo = rep.neoplasmSummary;
  const mark = (row, a) => row.status[a.id] || '';
  return `
    ${header(rep, 'Study pathology report', unsigned ? `${unsigned} of ${rep.animals.length} pathology reports not signed out yet` : '')}
    <table class="rep-facts"><tbody><tr><th>Pathologist${rep.pathologists.length === 1 ? '' : 's'}</th><td>${rep.pathologists.map(esc).join(', ') || 'None yet'}</td><th>Reports signed out</th><td>${rep.signed} of ${rep.animals.length}</td><th></th><td></td></tr></tbody></table>
    ${summaryEditor(rep, 'pathology')}
    <h2 class="rep-h">1. Groups</h2>
    ${groupsTable(rep, 'Signed-out reports', (k) => byGroup(k).filter((a) => a.status === 'SIGNED').length)}
    ${!rep.signed ? '<p class="empty">No pathology reports are signed out yet; the tables below count signed-out reports only.</p>' : `
    <h2 class="rep-h">2. Incidence of microscopic findings</h2>
    <table class="t rep-t"><thead><tr><th>Tissue</th><th>Diagnosis</th>${rep.keys.map((k) => `<th class="n">${groupHead(rep, k)}</th>`).join('')}</tr></thead><tbody>
      ${rep.incidence.map((r, i) => `<tr${i && rep.incidence[i - 1].organ !== r.organ ? ' class="grp-start"' : ''}><td>${i && rep.incidence[i - 1].organ === r.organ ? '' : esc(r.organ)}</td>
        <td class="${r.neoplasm ? 'rep-neo' : ''}">${esc(r.term)}</td>${r.cells.map((c, j) => `<td class="n ${c.affected ? '' : 'muted'}">${c.affected}/${c.examined} <span class="small muted">${pct(c.affected, c.examined)}</span>${c.meanGrade != null ? ` <span class="small">[${c.meanGrade}]</span>` : ''}${star(r.p[j])}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    ${fisherNote(rep)}<p class="small muted">Examined: animals whose tissue was read. In brackets: mean severity of the affected animals (1 minimal to 5 severe). Neoplasms in bold.</p>

    <h2 class="rep-h">3. Neoplasms</h2>
    <h3 class="rep-h3">Summary</h3>
    <table class="t rep-t" style="max-width:720px"><thead><tr><th></th>${rep.keys.map((k) => `<th class="n">${esc(k)}</th>`).join('')}</tr></thead><tbody>
      ${[['animals', 'Animals examined (signed-out reports)'], ['any', 'Animals with any neoplasm'], ['benign', 'Animals with a benign primary neoplasm'], ['malignant', 'Animals with a malignant primary neoplasm'],
        ['metastatic', 'Animals with metastases'], ['primaryBenign', 'Benign primary neoplasms (count)'], ['primaryMalignant', 'Malignant primary neoplasms (count)']]
        .map(([k, l]) => `<tr><td>${l}</td>${rep.keys.map((x) => `<td class="n">${neo[x]?.[k] ?? 0}</td>`).join('')}</tr>`).join('')}
    </tbody></table>
    <h3 class="rep-h3">By organ</h3>
    ${rep.neoplasms.length ? `<table class="t rep-t"><thead><tr><th>Organ</th><th>Neoplasm</th><th>Behavior</th>${rep.keys.map((k) => `<th class="n">${esc(k)}</th>`).join('')}</tr></thead><tbody>
      ${rep.neoplasms.map((r) => `<tr><td>${esc(r.organ)}</td><td class="rep-neo">${esc(r.term)}</td><td>${esc(r.kind)}</td>${r.cells.map((c, j) => `<td class="n ${c.affected ? '' : 'muted'}">${c.affected}/${c.examined}${star(r.p[j])}</td>`).join('')}</tr>`).join('')}
    </tbody></table>${fisherNote(rep)}` : '<p class="empty">No neoplasms diagnosed.</p>'}

    <h2 class="rep-h">4. Individual animal findings</h2>
    ${rep.keys.map((k) => {
      const animals = rep.tabAnimals.filter((a) => a.group === k);
      const people = byGroup(k);
      return `<h3 class="rep-h3">Group ${groupHead(rep, k).replace('<br>', ' ')}</h3>
        ${animals.length ? `<div class="tab-wrap"><table class="t tabulated rep-t"><thead><tr><th>Tissue / diagnosis</th>${animals.map((a) => `<th class="n">${esc(a.label)}<br><span class="small muted" style="font-weight:400">${esc(a.sex)}</span></th>`).join('')}</tr></thead><tbody>
          ${rep.tabulated.filter((row) => animals.some((a) => mark(row, a))).map((row) => `<tr class="org"><td>${esc(row.organ)}</td>${animals.map((a) => `<td class="n">${esc(mark(row, a))}</td>`).join('')}</tr>
            ${row.diagnoses.filter((x) => animals.some((a) => x.cells[a.id])).map((x) => `<tr><td class="dxrow">${esc(x.term)}</td>${animals.map((a) => `<td class="n"><strong>${esc(x.cells[a.id] || '')}</strong></td>`).join('')}</tr>`).join('')}`).join('')}
        </tbody></table></div>` : '<p class="small muted">No signed-out reports in this group.</p>'}
        <table class="t rep-t section"><tbody>${people.map((a) => `<tr><td style="width:150px"><strong>${esc(a.label)}</strong> <span class="small muted">${esc(a.phl)}${a.sex ? `, ${esc(a.sex)}` : ''}</span></td>
          <td>${a.status !== 'SIGNED' ? '<span class="muted">Report not signed out</span>' : `${a.findings.length ? a.findings.map((f) => `<span class="${f.neoplasm ? 'rep-neo' : ''}">${esc(f.organ)}: ${esc(f.text)}</span>`).join('<br>') : 'No microscopic findings'}
            ${a.causeOfDeath ? `<br><span class="small">Cause of death: ${esc(a.causeOfDeath)}</span>` : ''}${a.comment ? `<br><span class="small">${esc(a.comment)}</span>` : ''}
            <br><span class="small muted">Signed out by ${esc(a.signedBy)}, ${fmtDate((a.signedAt || '').slice(0, 10))}${a.version > 1 ? `, version ${a.version}` : ''}</span>`}</td></tr>`).join('')}</tbody></table>`;
    }).join('')}
    <p class="small muted">Tissue rows: - no significant lesions, + lesions, NE not examined, NP not present. Diagnosis rows: severity 1-5, P present, B benign, M malignant (m metastatic).${rep.notRead.length ? ` Not read in any animal: ${rep.notRead.map(esc).join(', ')}.` : ''}</p>`}
    <div class="rep-foot small muted">${esc(rep.study.zap)} study pathology report · ${LAB} · MHL LIMS pilot</div>`;
}

export async function renderStudyReport(app, id, kind) {
  const rep = await api('GET', `/api/studies/${id}/report/${kind}`);
  app.innerHTML = `
    <div class="toolbar noprint"><a href="#/study/${id}${kind === 'pathology' ? '?view=pathology' : ''}">Back to ${esc(rep.study.zap)}</a><span class="spacer"></span>
      <a class="btn quiet" href="#/studyreport/${id}/${kind === 'pathology' ? 'necropsy' : 'pathology'}">Study ${kind === 'pathology' ? 'necropsy' : 'pathology'} report</a>
      <button class="btn" type="button" id="print">Print</button></div>
    <article class="report study-rep">${kind === 'pathology' ? pathologyHtml(rep) : necropsyHtml(rep)}</article>`;
  pageTop(app);
  $('#print').addEventListener('click', () => window.print());
  $('#savenotes').addEventListener('click', (e) => act(e.currentTarget, async () => {
    await api('PUT', `/api/studies/${id}/report-notes`, { kind, text: $('#notes').value });
    await renderStudyReport(app, id, kind);
  }, 'Summary saved'));
}
