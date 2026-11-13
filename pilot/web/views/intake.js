// New request: approved NAS request -> request details and study -> stains and IHC -> estimate -> create, MHL numbers and labels.
// Requests from the IHC web form are reviewed and accepted here too (ihcviews.renderIhcReview), so every new request
// starts in this tab. A NAS request can fund several requests (a pilot and then the main study) until it is closed.
import { $, $$, api, esc, money, fmtDate, addDays, getMeta, getPriceList, sectionName, act, pageTop, options, code128Svg, zplJar, subjectLabel, kindBadge, saveFile, toast } from '../ui.js';
import { loadCatalog, estimateLine, summarizeEstimate } from '../lib/rules.mjs';
import * as ANIMALS from '../lib/animallist.mjs';
import { writeXlsx, XLSX_TYPE } from '../lib/xlsxwrite.mjs';
import { readSheets } from '../lib/sheets.mjs';
import { codingBadges } from './assays.js';

const STEPS = ['Choose NAS request', 'Request details', 'Stains and IHC', 'Estimate', 'Create and label'];
let wiz = null;
let showClosed = false;

// A new wizard for a NAS request (n is the NAS request with its usage, from /api/nas).
function startWizard(n, meta) {
  const def = meta.requestTypes[n.type];
  const firstOk = (list) => (list.find((p) => p.approved && !p.obsolete) || list[0])?.id || '';
  // From an estimate in phases, start from the first phase no request has used yet.
  const usedPhases = new Set(n.usage.requests.map((r) => r.estimatePhase).filter(Boolean));
  const phase = (n.estimatePhases || []).find((p) => !usedPhases.has(p.name))?.name || n.estimatePhases?.[0]?.name || '';
  wiz = { step: 1, nas: n, type: n.type, n: n.n, species: n.species, priority: 'R', fixative: '10%NBF', areas: [...def.areas], lines: null, fromScope: false, phase,
    study: { mode: n.type === 'NECRO-FULL' && !n.usage.requests.length ? 'new' : 'none', studyId: '', zap: '', title: '', acuc: '', necropsyProtocolId: firstOk(meta.protocols.necropsy), trimProtocolId: firstOk(meta.protocols.trim) },
    ihc: blankIhc(n.type), ihcLines: [], ihcKey: '' };
}

export async function renderIntake(app) {
  const meta = await getMeta();

  const step = wiz?.step ?? 0;
  app.innerHTML = `
    <h1>New request</h1>
    <ol class="steps">${STEPS.map((s, i) => `<li class="${i === step ? 'on' : i < step ? 'done' : ''}">${s}</li>`).join('')}</ol>
    <div id="step"></div>`;
  const box = $('#step');
  if (step === 0) await stepNas(app, box, meta);
  else if (step === 1) await stepDetails(app, box, meta);
  else if (step === 2) await stepIhc(app, box, meta);
  else if (step === 3) await stepEstimate(app, box, meta);
  else await stepReview(app, box, meta);
  pageTop(app);
  return undefined;
}

async function stepNas(app, box, meta) {
  const [{ nas, closed }, web] = await Promise.all([api('GET', `/api/nas${showClosed ? '?all=1' : ''}`), api('GET', '/api/ihc/requests')]);
  const waiting = web.requests.filter((w) => w.status === 'Submitted');
  const types = Object.entries(meta.requestTypes).map(([k, v]) => [k, v.name]);
  const used = (n) => n.usage.requests;
  // NAS requests not used yet come first; those that already fund a request are folded away until wanted.
  const card = (n) => `
      <div class="qitem${n.closed ? ' dim' : ''}">
        <div><div class="nas">${esc(n.number)}</div><div class="muted small">Approved ${fmtDate(n.submitted)}</div>${n.estimateId ? `<div class="small"><a href="#/estimates/${n.estimateId}">Estimate ${esc(n.estimateLabel)}</a></div>` : ''}</div>
        <div><strong>${esc(n.requester.last)}${n.requester.first ? `, ${esc(n.requester.first)}` : ''}</strong><div class="desc">${esc(n.description)}</div>
          ${used(n).length ? `<div class="small" style="margin-top:4px">${used(n).length === 1 ? 'Request' : `${used(n).length} requests`} made from it: ${used(n).map((r) => `<a class="idtxt" href="#/request/${r.id}">${esc(r.number)}</a>${r.estimatePhase ? ` <span class="muted">(${esc(r.estimatePhase)})</span>` : ''}`).join(', ')}
            <span class="muted">· ${money(n.usage.estimated)} estimated, ${money(n.usage.remaining)} not yet estimated</span></div>` : ''}
          ${n.closed ? `<div class="small muted">Closed ${fmtDate(n.closedOn)} by ${esc(n.closedBy || '')}</div>` : ''}</div>
        <div class="amt">${money(n.authorized)}<div class="muted small" style="font-family:var(--body)">authorized</div></div>
        <div class="rowbtns" style="flex-direction:column;align-items:stretch">${n.closed ? `<button class="btn small quiet" type="button" data-reopen="${n.id}">Reopen</button>`
          : `<button class="btn" type="button" data-nas="${n.id}">${used(n).length ? 'Start another request' : 'Start request'}</button>${used(n).length ? `<button class="btn small quiet" type="button" data-close="${n.id}" title="No more requests will be made from this NAS request">Close NAS request</button>` : ''}`}</div>
      </div>`;
  const fresh = nas.filter((n) => !n.closed && !used(n).length);
  const inUse = nas.filter((n) => !n.closed && used(n).length);
  const shut = nas.filter((n) => n.closed);
  box.innerHTML = `
    <h2>Approved NAS requests</h2>
    <p class="muted" style="max-width:900px">Approved NAS requests for MHL. In production these arrive from NAS automatically; in the pilot you can add one yourself. A NAS request can fund more than one request, for example a pilot and then the main study: it stays here until you close it, and each new request is checked against what is left of its authorization.</p>
    ${fresh.length ? `<div class="queue">${fresh.map(card).join('')}</div>` : '<p class="empty">Every open NAS request already funds a request. Start another request from one below, or add a NAS request.</p>'}
    ${inUse.length ? `<details class="section" ${fresh.length ? '' : 'open'}><summary><strong>NAS requests that already fund a request (${inUse.length})</strong> <span class="small muted">start another request from one, or close it</span></summary>
      <div class="queue section">${inUse.map(card).join('')}</div></details>` : ''}
    ${shut.length ? `<div class="queue section">${shut.map(card).join('')}</div>` : ''}
    ${closed ? `<p class="small"><button class="btn small quiet" type="button" id="showclosed">${showClosed ? 'Hide' : 'Show'} ${closed} closed NAS request${closed === 1 ? '' : 's'}</button></p>` : ''}
    <h2 class="section">IHC requests from the web form${waiting.length ? ` <span class="badge warn">${waiting.length} to review</span>` : ''}</h2>
    <p class="muted" style="max-width:900px">Requests investigators send from the IHC request form (the old phlrequest site). Review one, then accept it to create a request with MHL numbers and an estimate, or decline it with a reason. Accepted requests are assigned and worked under Molecular.</p>
    ${waiting.length ? `<table class="t">
      <thead><tr><th>Request</th><th>Submitted</th><th>Investigator</th><th class="n">Blocks</th><th>Stains</th><th class="n">Estimate</th><th>Check</th><th></th></tr></thead>
      <tbody>${waiting.map((r) => `<tr>
        <td><a class="idtxt" href="#/new/ihc/${r.id}">${esc(r.number)}</a>${r.importance === 'STAT' ? ' <span class="badge stat">STAT</span>' : ''}</td>
        <td>${fmtDate(r.submittedOn)}</td><td>${esc(r.investigator)}<br><span class="muted small">${esc(r.species)}</span></td><td class="n">${r.samples}</td>
        <td>${r.stains.map(esc).join('<br>') || '<span class="muted">H&amp;E or unstained only</span>'}${r.newAntibodies ? ' <span class="badge warn">new antibody</span>' : ''}</td>
        <td class="n">${money(r.estimate)}</td><td>${r.warnings ? `<span class="badge warn">${r.warnings} to check</span>` : '<span class="badge complete">OK</span>'}</td>
        <td><a class="btn small" href="#/new/ihc/${r.id}">Review</a></td></tr>`).join('')}</tbody></table>`
    : '<p class="empty">No IHC requests waiting for review.</p>'}
    <details class="section" ${nas.length ? '' : 'open'}>
      <summary><strong>Add an approved NAS request (pilot only)</strong></summary>
      <form class="form section" id="addnas">
        <div class="field"><label for="nl">Requester last name</label><input id="nl" required maxlength="100"></div>
        <div class="field"><label for="nf">Requester first name</label><input id="nf" maxlength="100"></div>
        <div class="field"><label for="ni">Institute, lab or branch</label><input id="ni" maxlength="200"></div>
        <div class="field"><label for="nn">NAS# (leave blank to number it)</label><input id="nn" maxlength="30"></div>
        <div class="field"><label for="np">Project number</label><input id="np" maxlength="30" placeholder="e.g. 25X0012345.01"></div>
        <div class="field"><label for="na">Authorized amount ($)</label><input id="na" type="number" min="1" step="0.01" required></div>
        <div class="field"><label for="nt">Request type</label><select id="nt">${options(types, 'NECRO-FULL')}</select></div>
        <div class="field"><label for="nc">MHL numbers needed (animals, cases or samples)</label><input id="nc" type="number" min="1" max="500" value="10" required></div>
        <div class="field"><label for="ns">Species or material</label><select id="ns">${options(Object.entries(meta.species).map(([k, v]) => [k, v.name]), 'MOUSE')}</select></div>
        <div class="field full"><label for="nd">Description of the work</label><textarea id="nd" maxlength="1000"></textarea></div>
        <div class="full"><button class="btn quiet" type="submit">Add NAS request</button></div>
      </form>
    </details>`;
  $$('[data-nas]', box).forEach((b) => b.addEventListener('click', () => { startWizard(nas.find((x) => x.id === Number(b.dataset.nas)), meta); renderIntake(app); }));
  $$('[data-close]', box).forEach((b) => b.addEventListener('click', () => {
    const n = nas.find((x) => x.id === Number(b.dataset.close));
    if (!window.confirm(`Close NAS# ${n.number}? No more requests can be started from it until it is reopened. Its ${used(n).length} request${used(n).length === 1 ? '' : 's'} carry on as before.`)) return;
    act(b, async () => { await api('POST', `/api/nas/${n.id}/close`, {}); await renderIntake(app); }, `NAS# ${n.number} closed`);
  }));
  $$('[data-reopen]', box).forEach((b) => b.addEventListener('click', () => act(b, async () => { await api('POST', `/api/nas/${b.dataset.reopen}/close`, { closed: false }); await renderIntake(app); }, 'NAS request reopened')));
  $('#showclosed')?.addEventListener('click', () => { showClosed = !showClosed; renderIntake(app); });
  $('#addnas').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('POST', '/api/nas', { requesterLast: $('#nl').value, requesterFirst: $('#nf').value, inst: $('#ni').value, number: $('#nn').value, project: $('#np').value,
        authorized: Number($('#na').value), type: $('#nt').value, n: Number($('#nc').value), species: $('#ns').value, description: $('#nd').value });
      await renderIntake(app);
    }, 'NAS request added');
  });
}

async function stepDetails(app, box, meta) {
  const def = meta.requestTypes[wiz.type];
  const { studies } = await api('GET', '/api/studies');
  const allAreas = meta.areas.filter((a) => a.code !== 'ENTRY' && a.code !== 'QC-PA');
  box.innerHTML = `
    <form class="form" id="details">
      <div class="field"><span class="lbl">Investigator</span><div class="ro">${esc(wiz.nas.requester.last)}${wiz.nas.requester.first ? `, ${esc(wiz.nas.requester.first)}` : ''}<span class="src">from NAS</span></div></div>
      <div class="field"><span class="lbl">NAS# and project</span><div class="ro">${esc(wiz.nas.number)}, ${esc(wiz.nas.project || 'no project')}<span class="src">from NAS</span></div></div>
      <div class="field full"><span class="lbl">Description</span><div class="ro" style="font-weight:400">${esc(wiz.nas.description)}</div></div>
      <div class="field"><label for="type">Request type</label><select id="type">${options(Object.entries(meta.requestTypes).map(([k, v]) => [k, v.name]), wiz.type)}</select></div>
      <div class="field"><label for="n">Number of MHL numbers (one per animal, case or sample)</label><input id="n" type="number" min="1" max="500" value="${wiz.animals ? wiz.animals.length : wiz.n}" ${wiz.animals ? 'disabled title="Set by the animal list"' : ''}>${wiz.animals ? '<span class="small muted">From the animal list below</span>' : ''}</div>
      <div class="field"><label for="species">Species or material</label><select id="species">${options(Object.entries(meta.species).map(([k, v]) => [k, v.name]), wiz.species)}</select></div>
      <div class="field"><label for="priority">Priority</label><select id="priority">${options([['R', 'Routine'], ['P', 'Priority'], ['S', 'STAT']], wiz.priority)}</select></div>
      <div class="field"><label for="fixative">Fixative</label><select id="fixative">${options([['10%NBF', '10% neutral buffered formalin'], ['4%PFA', '4% paraformaldehyde'], ['FRESH', 'Fresh or unfixed'], ['OTHER', 'Other']], wiz.fixative)}</select></div>
      <div class="field"><label for="tdisp">Tissue disposition (for the tracking sheet)</label><input id="tdisp" list="tdisps" maxlength="20" value="${esc(wiz.tissueDisp || '')}" placeholder="e.g. RTRN" style="text-transform:uppercase">
        <datalist id="tdisps"><option value="RTRN">Return to the investigator</option></datalist></div>
      <div class="field"><span class="lbl">Due date</span><div class="ro">${fmtDate(addDays(meta.today, def.days))} <span class="muted" style="font-weight:400">(${def.days}-day turnaround)</span></div></div>
      <div class="field full"><span class="lbl">Work areas</span>
        <div class="checks" id="areas">${allAreas.map((a) => `<label><input type="checkbox" value="${a.code}" ${wiz.areas.includes(a.code) ? 'checked' : ''}> ${esc(a.name)}</label>`).join('')}</div></div>
      <div class="field full"><span class="lbl">Study (needed for necropsy data)</span>
        <div class="checks" id="smode">
          <label><input type="radio" name="smode" value="none" ${wiz.study.mode === 'none' ? 'checked' : ''}> No study</label>
          <label><input type="radio" name="smode" value="existing" ${wiz.study.mode === 'existing' ? 'checked' : ''} ${studies.length ? '' : 'disabled'}> Existing study</label>
          <label><input type="radio" name="smode" value="new" ${wiz.study.mode === 'new' ? 'checked' : ''}> New study</label>
        </div></div>
      <div class="field" data-smode="existing"><label for="sid">Study</label><select id="sid">${options(studies.map((s) => [s.id, `${s.zap}  ${s.title}`]), wiz.study.studyId, { blank: 'Choose a study' })}</select></div>
      <div class="field" data-smode="new"><label for="szap">ZAP# (leave blank to number it)</label><input id="szap" value="${esc(wiz.study.zap)}" placeholder="e.g. ZAP2240"></div>
      <div class="field" data-smode="new"><label for="stitle">Study title</label><input id="stitle" value="${esc(wiz.study.title)}" maxlength="300"></div>
      <div class="field" data-smode="new"><label for="sacuc">ACUC protocol</label><input id="sacuc" value="${esc(wiz.study.acuc)}" maxlength="50"></div>
      <div class="field" data-smode="new"><label for="sprot">Necropsy protocol</label><select id="sprot">${options(meta.protocols.necropsy.filter((p) => !p.obsolete).map((p) => [p.id, `${p.name}${p.approved ? '' : ' (not approved)'}`]), wiz.study.necropsyProtocolId)}</select></div>
      <div class="field" data-smode="new"><label for="strim">Trim protocol (blocks)</label><select id="strim">${options(meta.protocols.trim.filter((p) => !p.obsolete).map((p) => [p.id, `${p.name}${p.approved ? '' : ' (not approved)'}`]), wiz.study.trimProtocolId, { blank: 'None' })}</select></div>
    </form>
    ${meta.species[wiz.species]?.restricted ? '<p class="note info">Human, PDX and organoid material: only coded IDs are stored, and these records are marked restricted.</p>' : ''}
    <section class="panel section" id="animalsbox">
      <div class="row"><h2 style="margin:0">Animal list</h2><span class="small muted">optional</span><span class="spacer"></span>
        <button class="btn small quiet" type="button" id="altemplate">Download the template (.xlsx)</button>
        <label class="btn small" for="alfile" style="cursor:pointer">Read the investigator's spreadsheet</label><input type="file" id="alfile" accept=".xlsx,.xls,.csv,.txt" hidden></div>
      <p class="small muted" style="margin:6px 0 0">One line per animal: ID, group, sex, strain, genotype, date of birth, cage, treatment, priority and notes. Excel (.xlsx or .xls) or CSV; the investigator's own layout is fine if it has an animal ID column. The request then has one MHL number per animal, in the list's order, each with its details; the groups become the study's groups.</p>
      <div id="alpreview"></div>
    </section>
    <div class="actions"><button class="btn quiet" type="button" id="back">Back</button><button class="btn" type="button" id="next">Continue to estimate</button></div>`;
  const showStudy = () => {
    const mode = $('input[name="smode"]:checked', box)?.value || 'none';
    $$('[data-smode]', box).forEach((el) => { el.hidden = el.dataset.smode !== mode; });
  };
  $$('input[name="smode"]', box).forEach((r) => r.addEventListener('change', showStudy));
  showStudy();
  const read = () => {
    const newType = $('#type').value;
    const typeChanged = newType !== wiz.type;
    const n = wiz.animals ? wiz.animals.length : Math.max(1, Math.min(500, parseInt($('#n').value, 10) || 1));
    if (typeChanged || n !== wiz.n) wiz.lines = null;
    wiz.areas = typeChanged ? [...meta.requestTypes[newType].areas] : $$('#areas input:checked', box).map((i) => i.value);
    Object.assign(wiz, { type: newType, n, species: $('#species').value, priority: $('#priority').value, fixative: $('#fixative').value, tissueDisp: $('#tdisp').value.trim().toUpperCase() });
    wiz.study = { mode: $('input[name="smode"]:checked', box)?.value || 'none', studyId: $('#sid').value, zap: $('#szap').value.trim(), title: $('#stitle').value.trim(), acuc: $('#sacuc').value.trim(),
      necropsyProtocolId: Number($('#sprot').value), trimProtocolId: $('#strim').value ? Number($('#strim').value) : '' };
    if (typeChanged) { wiz.ihc = blankIhc(newType); wiz.ihcLines = []; }
  };
  $('#type').addEventListener('change', () => { read(); renderIntake(app); });
  $('#species').addEventListener('change', () => { read(); renderIntake(app); });
  wireAnimalList(app, box, meta, read);
  $('#back').addEventListener('click', () => { wiz = null; renderIntake(app); });
  $('#next').addEventListener('click', () => {
    read();
    if (wiz.study.mode === 'existing' && !wiz.study.studyId) return alert('Choose the study, or pick "No study".');
    if (wiz.animalParse && !wiz.animals) return alert(wiz.animalParse.problems.length ? 'The animal list has problems to put right first, or remove it.' : 'Use the animal list (or remove it) before going on.');
    wiz.step = 2; renderIntake(app);
    return undefined;
  });
}

// ---------- animal list ----------
// The investigator's spreadsheet: read in the browser, checked with the same rules the core applies, shown, and used
// only when the person says so. Changing the species or the study checks it again.
function wireAnimalList(app, box, meta, readForm) {
  const necropsy = () => wiz.areas.includes('NECRO');
  const formSpecies = () => $('#species').value;
  const studyMode = () => $('input[name="smode"]:checked', box)?.value || 'none';
  const studyGroups = async () => {
    const sid = $('#sid').value;
    if (studyMode() !== 'existing' || !sid) return null;
    return (await api('GET', `/api/studies/${sid}`)).study.groups.map((g) => ({ code: g.code, sex: g.sex }));
  };
  const parse = async () => {
    const src = wiz?.animalSource;
    if (!src) return;
    const pick = src.candidates[src.pick] || { sheet: src.sheets[0], header: null };
    wiz.animalParse = ANIMALS.parseAnimalList(pick.sheet.grid, { header: pick.header, phi: ANIMALS.phiSpecies(formSpecies()), groups: await studyGroups(), study: studyMode() !== 'none',
      expected: wiz.nas.n, today: meta.today, necropsy: necropsy(), date1904: !!pick.sheet.date1904 });
    // A list already in use follows its new check; one that now has problems is taken out of use.
    if (wiz.animals) wiz.animals = wiz.animalParse.problems.length ? null : ANIMALS.forRequest(wiz.animalParse.animals);
  };
  const draw = () => {
    const out = $('#alpreview');
    if (!wiz || !out) return;   // the page has moved on
    const p = wiz.animalParse; const src = wiz.animalSource;
    if (!p) { out.innerHTML = ''; return; }
    const sheetName = src.candidates[src.pick]?.sheet.name || src.sheets[0]?.name || '';
    const shown = p.animals.slice(0, ANIMALS.MAX_ANIMALS);
    const s = p.summary;
    const cols = ANIMALS.COLUMNS.filter((c) => p.columns.includes(c.key));
    const sexText = [s.female && `${s.female} F`, s.male && `${s.male} M`, s.noSex && `${s.noSex} no sex`].filter(Boolean).join(', ');
    out.innerHTML = `
      ${src.candidates.length > 1 ? `<div class="row section" style="margin-bottom:0"><label class="small muted" for="alsheet">Sheet</label><select id="alsheet" class="inp" style="width:auto">${options(src.candidates.map((c, i) => [i, `${c.sheet.name} (${c.header.score} columns recognized)`]), src.pick)}</select><span class="small muted">More than one sheet looks like an animal list.</span></div>` : ''}
      <p class="section" style="margin-bottom:6px"><strong>${esc(src.fileName)}</strong>${src.sheets.length > 1 ? `, sheet “${esc(sheetName)}”` : ''}${p.header ? `, headings on line ${p.header.row}` : ''}:
        <strong>${s.count} animal${s.count === 1 ? '' : 's'}</strong>${sexText ? ` (${sexText})` : ''}${s.groups.length ? `; ${s.groups.map((g) => `${esc(g.code)} ${g.n}`).join(', ')}` : ''}${s.stat ? `; ${s.stat} STAT` : ''}.</p>
      ${p.problems.length ? `<div class="note"><strong>Put these right in the spreadsheet and read it again:</strong><ul class="assume" style="color:inherit">${p.problems.slice(0, 15).map((x) => `<li>${esc(x)}</li>`).join('')}${p.problems.length > 15 ? `<li>and ${p.problems.length - 15} more</li>` : ''}</ul></div>` : ''}
      ${p.used.length ? `<p class="small muted" style="margin:0 0 4px">Read: ${p.used.map((u) => `${esc(u.title)}${u.header.toLowerCase() !== u.title.toLowerCase() ? ` from “${esc(u.header)}”` : ''}`).join(', ')}.</p>` : ''}
      ${p.warnings.length ? `<ul class="assume">${p.warnings.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      ${wiz.study.mode !== 'none' && s.groups.length ? `<p class="small muted">${wiz.study.mode === 'new' ? 'The new study gets these groups' : 'Groups the study does not have are added to it'}, with the treatment given for each.</p>` : ''}
      ${p.animals.length ? `<div class="scroll-x" style="max-height:420px;overflow:auto;margin-top:8px"><table class="t">
        <thead><tr><th class="n">Line</th>${cols.map((c) => `<th>${esc(c.title)}</th>`).join('')}<th></th></tr></thead>
        <tbody>${shown.map((a) => `<tr class="${a.problems.length ? 'bad-row' : ''}"><td class="n small muted">${a.row}</td>
          ${cols.map((c) => `<td class="${c.key === 'label' ? 'code' : 'small'}">${esc(c.key === 'priority' ? (a.priority === 'S' ? 'STAT' : a.priority === 'P' ? 'Priority' : '') : c.key === 'dob' && /^\d{4}-\d\d-\d\d$/.test(a.dob) ? fmtDate(a.dob) : a[c.key])}</td>`).join('')}
          <td class="small">${a.problems.map((x) => `<span class="fitnote">${esc(x)}</span>`).join('<br>')}</td></tr>`).join('')}</tbody></table></div>` : ''}
      <div class="actions">
        ${wiz.animals ? `<span class="badge complete">In use: ${wiz.animals.length} MHL numbers from this list</span>` : `<button class="btn" type="button" id="aluse" ${p.problems.length || !p.animals.length ? 'disabled' : ''}>Use these ${s.count} animals</button>`}
        <button class="btn quiet" type="button" id="alclear">Remove the list</button></div>`;
    $('#aluse')?.addEventListener('click', () => {
      readForm();
      wiz.animals = ANIMALS.forRequest(wiz.animalParse.animals);
      wiz.animalFile = wiz.animalSource.fileName;
      if (wiz.n !== wiz.animals.length) wiz.lines = null;
      wiz.n = wiz.animals.length;
      toast(`${wiz.n} animals from ${wiz.animalFile}: the request will have ${wiz.n} MHL numbers`);
      renderIntake(app);
    });
    $('#alclear').addEventListener('click', () => {
      readForm();
      const hadList = !!wiz.animals;
      Object.assign(wiz, { animalSource: null, animalParse: null, animals: null, animalFile: '' });
      if (hadList) { wiz.n = wiz.nas.n; wiz.lines = null; }   // back to the NAS request's number
      renderIntake(app);
    });
    $('#alsheet')?.addEventListener('change', async (e) => { wiz.animalSource.pick = Number(e.target.value); wiz.animals = null; await parse(); draw(); });
  };
  $('#alfile').addEventListener('change', async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    try {
      if (f.size > 10 * 1024 * 1024) throw new Error('That file is larger than 10 MB; an animal list should be much smaller.');
      const { sheets } = await readSheets(new Uint8Array(await f.arrayBuffer()), f.name, { fillMerged: true });
      readForm();
      if (wiz.animals) { wiz.n = wiz.nas.n; wiz.lines = null; }
      Object.assign(wiz, { animals: null, animalFile: '' });
      wiz.animalSource = { fileName: f.name, sheets, candidates: ANIMALS.sheetCandidates(sheets), pick: 0 };
      await parse();
      draw();
    } catch (err) { toast(`Could not read ${f.name}: ${err.message}`, 'error'); }
  });
  $('#altemplate').addEventListener('click', async (e) => act(e.currentTarget, async () => {
    readForm();
    const groups = ((await studyGroups()) || []).map((g) => g.code);
    const study = wiz.study.mode === 'existing' && wiz.study.studyId ? (await api('GET', `/api/studies/${wiz.study.studyId}`)).study.zap : wiz.study.mode === 'new' ? (wiz.study.zap || 'New study') : '';
    const bytes = writeXlsx(ANIMALS.templateSheets({ investigator: [wiz.nas.requester.last, wiz.nas.requester.first].filter(Boolean).join(', '), nasNumber: wiz.nas.number, study,
      speciesName: meta.species[wiz.species]?.name || '', expected: wiz.n, groups, phi: ANIMALS.phiSpecies(wiz.species) }));
    const name = `MHL-animal-list-NAS-${wiz.nas.number}.xlsx`;
    saveFile(name, XLSX_TYPE, bytes);
    return name;
  }, (name) => `Downloaded ${name}`));
  // Checked again for the species and study now on the form.
  $$('input[name="smode"], #sid', box).forEach((el) => el.addEventListener('change', async () => { if (!wiz.animalSource) return; readForm(); await parse(); draw(); }));
  if (wiz.animalSource) parse().then(draw).catch(() => {});
}

// ---------- stains and IHC ----------
// For an IHC, RNAscope or multiplex request this is where the antibodies are chosen. For a necropsy or histology
// request it adds stains on the blocks the request makes (an "add-on", so no extra trimming or embedding is estimated).
function blankIhc(type) {
  const molec = type === 'MOLEC';
  return { tissue: '', sampleType: molec ? 'FIXED' : 'BLOCK', addOn: !molec, he: { on: molec, perBlock: 1 }, unstained: { on: false, perBlock: 1 },
    scan: { x20: false, x40: false }, stains: [], notes: '' };
}
const ihcChosen = (ihc) => ihc.stains.length > 0 || (ihc.addOn ? false : ihc.he.on) || ihc.unstained.on;
const ihcPayload = (ihc) => ({ ...ihc, he: ihc.addOn ? { on: false, perBlock: 1 } : ihc.he, stains: ihc.stains.map(({ view, ...s }) => s) });
const clip = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
function antibodyLine(a) {
  const ab = a.antibody || {};
  const na = (x) => (x && x !== 'Not applicable' ? x : '');
  const bits = [ab.clone ? `clone ${ab.clone}` : ab.cloneNotApplicable ? 'clone N/A' : '', [na(ab.host), na(ab.clonality)].filter(Boolean).join(' ').toLowerCase(), ab.isotype, ab.conjugate && `${ab.conjugate.toLowerCase()}-conjugated`].filter(Boolean);
  return bits.length ? bits.join(', ') : ab.several ? 'several antibodies; see the assay' : 'clone and host not recorded';
}

async function stepIhc(app, box, meta) {
  const ihc = wiz.ihc;
  const molec = wiz.type === 'MOLEC';
  const species = { MOUSE: 'Mouse', RAT: 'Rat', HUMAN: 'Human', PDX: 'PDX', ORGANOID: 'Organoid' }[wiz.species] || 'Other';
  const fixative = { '10%NBF': '10% NBF', '4%PFA': '4% PFA', FRESH: 'Fresh frozen (OCT)' }[wiz.fixative] || 'Other';
  let pending = [];
  box.innerHTML = `
    <p class="muted">${molec ? 'Choose the antibodies, probes or panels for this request from the MHL IHC catalog, with what is done on each block.'
      : 'Optional. Add IHC or special stains on the blocks this request makes; leave it empty if none are needed. These slides are estimated as extra sections from the same blocks.'}
      Each of the ${wiz.n} MHL numbers gets every stain chosen here; the IHC team can adjust it per block on the worksheet.</p>
    <div class="split wide-left">
      <div>
        <form class="form" id="ihcform" onsubmit="return false">
          <div class="field"><label for="itissue">Organ or tissue</label><input id="itissue" list="iorgans" value="${esc(ihc.tissue)}" maxlength="60" placeholder="e.g. Lungs, tumor"></div>
          ${molec ? `<div class="field"><label for="itype">Material received</label><select id="itype">${options(meta.ihc.sampleTypes, ihc.sampleType)}</select></div>
            <div class="field"><label><input type="checkbox" id="ihe" ${ihc.he.on ? 'checked' : ''}> H&E slides per block</label><input id="ihen" type="number" min="1" max="10" value="${ihc.he.perBlock}" aria-label="H&E slides per block"></div>` : ''}
          <div class="field"><label><input type="checkbox" id="iun" ${ihc.unstained.on ? 'checked' : ''}> Unstained slides per block</label><input id="iunn" type="number" min="1" max="20" value="${ihc.unstained.perBlock}" aria-label="Unstained slides per block"></div>
          <div class="field"><span class="lbl">Scan the stained slides</span><div class="checks"><label><input type="checkbox" id="ix20" ${ihc.scan.x20 ? 'checked' : ''}> 20x</label><label><input type="checkbox" id="ix40" ${ihc.scan.x40 ? 'checked' : ''}> 40x</label></div></div>
        </form>
        <datalist id="iorgans">${meta.pathology.organs.map((o) => `<option value="${esc(o)}">`).join('')}</datalist>
        <h3 class="section">Find an antibody</h3>
        <div class="picker" style="max-width:none;margin-top:0"><input id="ifind" placeholder="Target, clone or catalog number, e.g. CD8, F4/80, RAM34, ab101500" autocomplete="off" aria-label="Search the IHC catalog"></div>
        <p class="small muted">Protocols validated for ${esc(species.toLowerCase())} tissue in ${esc(fixative)} come first. Clone and host come from the catalog text and may be missing; the assay page has the full protocol.</p>
        <div id="ifound" aria-live="polite"></div>
        <details class="section"><summary><strong>The antibody is not in the catalog</strong></summary>
          <form class="form section" id="inew" style="grid-template-columns:1fr 1fr">
            <div class="field"><label for="inn">Target</label><input id="inn" maxlength="120" required></div>
            <div class="field"><label for="inl">Clone</label><input id="inl" maxlength="40"></div>
            <div class="field"><label for="inm">Manufacturer</label><input id="inm" maxlength="120" required></div>
            <div class="field"><label for="inc">Catalog number</label><input id="inc" maxlength="60"></div>
            <div class="field"><label for="inh">Host and clonality</label><input id="inh" maxlength="60" placeholder="e.g. Rabbit monoclonal"></div>
            <div class="field"><label><input type="checkbox" id="ins"> The investigator supplies it</label></div>
            <div class="full"><button class="btn quiet" type="submit">Add new antibody</button></div>
          </form>
        </details>
      </div>
      <div>
        <h3>Stains on each block</h3>
        <div id="ichosen"></div>
        <h3 class="section">What this adds to the estimate</h3>
        <div id="iest"><p class="small muted">Nothing yet.</p></div>
        <div class="field section"><label for="inotes">Notes for the IHC team</label><textarea id="inotes" maxlength="2000">${esc(ihc.notes)}</textarea></div>
      </div>
    </div>
    <div class="actions"><button class="btn quiet" type="button" id="back">Back</button>${ihcChosen(ihc) ? '' : '<button class="btn quiet" type="button" id="skip">No stains</button>'}<button class="btn" type="button" id="next">Continue to estimate</button></div>`;

  const read = () => {
    ihc.tissue = $('#itissue').value.trim();
    if (molec) { ihc.sampleType = $('#itype').value; ihc.he = { on: $('#ihe').checked, perBlock: Math.max(1, Math.min(10, parseInt($('#ihen').value, 10) || 1)) }; }
    ihc.unstained = { on: $('#iun').checked, perBlock: Math.max(1, Math.min(20, parseInt($('#iunn').value, 10) || 1)) };
    ihc.scan = { x20: $('#ix20').checked, x40: $('#ix40').checked };
    ihc.notes = $('#inotes').value.trim();
  };
  const refreshEstimate = async () => {
    read();
    if (!ihcChosen(ihc)) { wiz.ihcLines = []; $('#iest').innerHTML = '<p class="small muted">Nothing yet.</p>'; return; }
    const res = await api('POST', '/api/requests/ihc-estimate', { n: wiz.n, species: wiz.species, fixative: wiz.fixative, priority: wiz.priority, ihc: ihcPayload(ihc) });
    wiz.ihcLines = res.estimate.lines.filter((l) => l.amount != null).map((l) => ({ section: l.section, code: l.code, units: l.units }));
    $('#iest').innerHTML = `<table class="t"><tbody>${res.estimate.lines.map((l) => `<tr><td class="code">${esc(l.code)}</td><td>${esc(l.description)}</td><td class="n">${l.units}</td><td class="n">${l.amount == null ? '<span class="badge warn">not priced</span>' : money(l.amount)}</td></tr>`).join('')}
      <tr class="total"><td colspan="3">IHC and stains</td><td class="n">${money(res.estimate.total)}</td></tr></tbody></table>
      ${res.estimate.assumptions.map((x) => `<p class="small muted">${esc(x)}</p>`).join('')}
      ${res.warnings.map((x) => `<p class="note">${esc(x)}</p>`).join('')}`;
  };
  const drawChosen = () => {
    $('#ichosen').innerHTML = ihc.stains.length ? `<table class="t"><tbody>${ihc.stains.map((s, i) => {
      const v = s.view || {};
      const fluor = v.kind === 'Opal' || v.kind === 'IF' || v.chromogen === 'Fluorescent';
      return `<tr><td>${s.newAntibody ? `<strong>${esc(s.newAntibody.name)}</strong> <span class="badge warn">not in catalog</span><br><span class="small muted">${esc([s.newAntibody.host, s.newAntibody.manufacturer, s.newAntibody.catalog].filter(Boolean).join(', '))}</span>`
        : `<strong>${esc(v.name)}</strong> ${kindBadge(v)} <a class="small" href="#/molecular/assay/${s.assayId}" target="_blank" rel="noopener">#${s.assayId}</a><br><span class="small muted">${esc(antibodyLine(v))}</span>
          <br><span class="small muted">${esc(clip([`${v.manufacturer} ${v.catalog}`.trim(), v.dilution, v.platform].filter(Boolean).join(' · '), 120))}</span>${v.fit?.length ? `<br><span class="small fitnote">${esc(v.fit.join('; '))}</span>` : ''}`}</td>
        <td>${s.newAntibody || fluor ? '' : `<select data-chrom="${i}" aria-label="Chromogen">${options([['DAB', 'DAB'], ['Red', 'Red']], s.chromogen)}</select>`}</td>
        <td class="mid"><button class="btn small quiet" type="button" data-unpick="${i}">Remove</button></td></tr>`;
    }).join('')}</tbody></table>` : '<p class="empty" style="padding:10px 0">No stains chosen.</p>';
    $$('[data-unpick]', box).forEach((b) => b.addEventListener('click', () => { ihc.stains.splice(Number(b.dataset.unpick), 1); drawChosen(); search(); refreshEstimate(); }));
    $$('[data-chrom]', box).forEach((sel) => sel.addEventListener('change', () => { ihc.stains[Number(sel.dataset.chrom)].chromogen = sel.value; }));
  };
  const search = async () => {
    const q = $('#ifind').value.trim();
    if (!q) { $('#ifound').innerHTML = '<p class="small muted">Type to search, for example CD3, Ki-67, GFP, Opal or a clone such as MECA-32.</p>'; return; }
    const types = molec ? ihc.sampleType : 'BLOCK';
    const res = await api('GET', `/api/ihc/assays?q=${encodeURIComponent(q)}&limit=20&fitSpecies=${encodeURIComponent(species)}&fitFixative=${encodeURIComponent(fixative)}&fitTypes=${types}`);
    pending = res.assays;
    const picked = new Set(ihc.stains.map((s) => s.assayId));
    $('#ifound').innerHTML = res.assays.length ? `<ul class="found-list">${res.assays.map((a, i) => `<li class="${a.fit.length || a.result === 'Failed' ? 'misfit' : ''}">
        <div><strong>${esc(a.name)}</strong> ${kindBadge(a)} <span class="small muted">#${a.id}</span> ${codingBadges(a, { showWorks: false })}<br><span class="small">${esc(antibodyLine(a))}</span>
          <br><span class="small muted">${esc(clip([`${a.manufacturer} ${a.catalog}`.trim(), a.species || 'species not recorded', a.fixative, a.dilution].filter(Boolean).join(' · '), 150))}</span>
          ${a.fit.length ? `<br><span class="small fitnote">${esc(a.fit.join('; '))}</span>` : ''}</div>
        <div>${picked.has(a.id) ? '<span class="badge complete">Added</span>' : `<button class="btn small ${a.fit.length ? 'quiet' : ''}" type="button" data-pick="${i}">Add</button>`}</div></li>`).join('')}</ul>
      ${res.total > res.assays.length ? `<p class="small muted">${res.total - res.assays.length} more; type more to narrow it down.</p>` : ''}`
      : `<p class="small muted">Nothing in the catalog matches “${esc(q)}”.</p>`;
    $$('[data-pick]', box).forEach((b) => b.addEventListener('click', () => {
      const a = pending[Number(b.dataset.pick)];
      ihc.stains.push({ assayId: a.id, chromogen: a.chromogen === 'Red' ? 'Red' : 'DAB', view: a });
      drawChosen(); search(); refreshEstimate();
    }));
  };
  let t = null;
  $('#ifind').addEventListener('input', () => { clearTimeout(t); t = setTimeout(search, 150); });
  $$('#ihcform input, #ihcform select', box).forEach((el) => el.addEventListener('change', () => { refreshEstimate(); if (el.id === 'itype') search(); }));
  $('#inew').addEventListener('submit', (e) => {
    e.preventDefault();
    const clone = $('#inl').value.trim();
    ihc.stains.push({ chromogen: 'DAB', newAntibody: { name: `${$('#inn').value.trim()}${clone ? ` (clone ${clone})` : ''}`, manufacturer: $('#inm').value.trim(), catalog: $('#inc').value.trim(),
      host: $('#inh').value.trim(), supplied: $('#ins').checked, notes: '' } });
    e.target.reset(); drawChosen(); refreshEstimate();
  });
  const leave = (to) => { read(); const key = JSON.stringify(ihcPayload(ihc)); if (key !== wiz.ihcKey) { wiz.ihcKey = key; wiz.lines = null; } wiz.step = to; renderIntake(app); };
  $('#back').addEventListener('click', () => leave(1));
  $('#skip')?.addEventListener('click', () => { wiz.ihc = blankIhc(wiz.type); wiz.ihc.he.on = false; wiz.ihcLines = []; leave(3); });
  $('#next').addEventListener('click', async (e) => { e.currentTarget.disabled = true; await refreshEstimate(); leave(3); });
  drawChosen();
  search();
  refreshEstimate();
}

// The NAS request as it is now: another request may have been made from it since the wizard started.
async function refreshNas() {
  try { wiz.nas = (await api('GET', `/api/nas/${wiz.nas.id}`)).nas; } catch { /* keep what we have; creating the request checks again */ }
}

async function stepEstimate(app, box, meta) {
  await refreshNas();
  const pl = await getPriceList();
  const catalog = loadCatalog(pl, { effectiveFrom: meta.priceList.pricingFrom });
  const phases = wiz.nas.estimatePhases || [];
  if (!wiz.lines) {
    // Where the lines start from: a phase of the estimate behind the NAS request, the NAS request's scope (if the type and
    // number of MHL numbers match it), or the request type's usual lines.
    const phase = phases.length > 1 && wiz.phase !== '(type)' ? phases.find((p) => p.name === wiz.phase) || null : null;
    const useScope = !phase && wiz.phase !== '(type)' && wiz.nas.scope?.length > 0 && (phases.length > 0 || (wiz.type === wiz.nas.type && wiz.n === wiz.nas.n));
    wiz.fromScope = phase ? 'phase' : !!useScope;
    const base = phase ? phase.scope.map(([section, code, units]) => ({ section, code, units }))
      : useScope ? wiz.nas.scope.map(([section, code, units]) => ({ section, code, units }))
      : meta.requestTypes[wiz.type].plan.map(([section, code, per]) => ({ section, code, units: per * wiz.n }));
    // Stains chosen in the previous step: for an IHC request they replace the generic plan; otherwise they are added.
    const ihcLines = ihcChosen(wiz.ihc) ? wiz.ihcLines : [];
    const usedBase = !(wiz.type === 'MOLEC' && ihcLines.length);
    if (!usedBase) wiz.fromScope = false;   // the stains replace the suggested lines, so no phase or scope was used
    else if (wiz.fromScope === true && phases.length === 1 && wiz.nas.scopeFromEstimate) { wiz.fromScope = 'phase'; wiz.phase = phases[0].name; }
    const merged = (usedBase ? base : []).map((l) => ({ ...l }));
    for (const l of ihcLines) {
      const same = merged.find((m) => m.code === l.code && m.section === l.section);
      if (same) same.units += l.units; else merged.push({ ...l });
    }
    wiz.lines = merged;
  }
  const draw = () => {
    const lines = []; const problems = [];
    wiz.lines.forEach((l, i) => {
      try { lines.push({ ...l, i, ...estimateLine(catalog, { section: l.section, code: l.code, units: l.units, date: meta.today }) }); }
      catch (e) { problems.push(`${l.code}: ${e.message}`); lines.push({ ...l, i, description: pl.items.find((x) => x.code === l.code)?.description || '', amount: null, unitPrice: null }); }
    });
    const ok = lines.filter((l) => l.amount != null);
    // What is left of the NAS authorization after the estimates of the requests already made from it.
    const room = wiz.nas.usage.remaining;
    const others = wiz.nas.usage.requests;
    const sum = summarizeEstimate(ok, room, []);
    const groups = meta.sections.map((s) => [s.code, lines.filter((l) => l.section === s.code)]).filter(([, ls]) => ls.length);
    wiz.priced = ok; wiz.total = sum.total; wiz.problems = problems;
    box.innerHTML = `
      ${phases.length > 1 || (wiz.nas.scope?.length && phases.length) ? `<div class="row" style="margin-bottom:8px"><label for="phasepick" class="small muted">Start from</label>
        <select id="phasepick" class="inp" style="width:auto">${options([...(phases.length > 1 ? phases.map((p) => [p.name, `Estimate ${wiz.nas.estimateLabel}: ${p.name}${others.some((r) => r.estimatePhase === p.name) ? ' (already used)' : ''}`]) : []),
          ...(wiz.nas.scope?.length ? [['(scope)', phases.length > 1 ? `All phases of estimate ${wiz.nas.estimateLabel}` : `Estimate ${wiz.nas.estimateLabel}`]] : []), ['(type)', 'The usual lines for the request type']],
          wiz.fromScope === 'phase' ? wiz.phase : wiz.fromScope ? '(scope)' : '(type)')}</select></div>` : ''}
      <p class="muted">Suggested from ${wiz.fromScope === 'phase' ? `phase “${esc(wiz.phase)}” of estimate ${esc(wiz.nas.estimateLabel)}` : wiz.fromScope ? (wiz.nas.scopeFromEstimate ? `estimate ${esc(wiz.nas.estimateLabel)} (the scope of the NAS request)` : 'the scope in the NAS request') : 'the request type'}${ihcChosen(wiz.ihc) ? ', the stains chosen,' : ''} and ${wiz.n} MHL numbers, priced from the ${esc(pl.name)} list. Change units, remove lines or add codes. The total goes back to NAS as the initial cost estimate.</p>
      <div class="split wide-left">
        <div>
          <table class="t">
            <thead><tr><th>Code</th><th>Description</th><th class="n">Units</th><th class="n">Price</th><th class="n">Amount</th><th><span hidden>Remove</span></th></tr></thead>
            <tbody>
            ${groups.map(([s, ls]) => `<tr class="sec"><td colspan="6">${esc(sectionName(meta, s))}</td></tr>` + ls.map((l) => `
              <tr><td class="code">${esc(l.code)}</td><td>${esc(l.description)}</td>
                <td class="n"><input class="units" id="u${l.i}" data-i="${l.i}" type="number" min="0.25" step="0.25" value="${l.units}" aria-label="Units for ${esc(l.code)}"></td>
                <td class="n">${l.unitPrice == null ? '<span class="badge warn">not priced</span>' : money(l.unitPrice)}</td>
                <td class="n">${l.amount == null ? '' : money(l.amount)}</td>
                <td><button class="btn small quiet" type="button" data-rm="${l.i}" aria-label="Remove ${esc(l.code)}">Remove</button></td></tr>`).join('')).join('')}
            <tr class="total"><td colspan="4">Estimate</td><td class="n">${money(sum.total)}</td><td></td></tr>
            </tbody>
          </table>
          <div class="picker">
            <input id="add" placeholder="Add a charge code: type a code or words, e.g. RNAscope, Opal, perfusion" autocomplete="off" aria-label="Add a charge code">
            <ul id="matches" hidden></ul>
          </div>
          ${problems.length ? `<p class="note">${problems.map(esc).join('<br>')}</p>` : ''}
          ${(() => { const left = wiz.fromScope === 'phase' ? phases.find((p) => p.name === wiz.phase)?.leftOut || [] : wiz.nas.scopeLeftOut || []; return left.length ? `<p class="note">Estimate ${esc(wiz.nas.estimateLabel)} also had work that cannot be charged with a priced code, so it is not above: ${left.map(esc).join('; ')}. Add it with a code (for example labor, HP009002, or a custom stain, HP005007) if it is still wanted.</p>` : ''; })()}
        </div>
        <div>
          <h2>Against the NAS authorization</h2>
          ${others.length ? `<p class="small">NAS# ${esc(wiz.nas.number)} authorized ${money(wiz.nas.authorized)}; ${others.map((r) => `${esc(r.number)} is estimated at ${money(r.estimateTotal)}`).join(', ')}, which leaves <strong>${money(room)}</strong> for this request.</p>` : ''}
          <div class="meter">
            <div class="meter-bar ${sum.estimateExceeds ? 'over' : ''}"><div class="meter-fill" style="width:${room > 0 ? Math.min(100, (sum.total / room) * 100) : 100}%"></div></div>
            <div class="meter-key">
              <div><b>${money(sum.total)}</b>this estimate</div>
              <div><b>${money(room)}</b>${others.length ? 'left on the NAS request' : 'authorized'}</div>
              <div><b style="color:${sum.estimateExceeds ? 'var(--amber)' : 'inherit'}">${money(Math.abs(room - sum.total))}</b>${sum.estimateExceeds ? 'over' : 'headroom'}</div>
            </div>
          </div>
          ${sum.estimateExceeds ? `<p class="note">The estimate is more than ${others.length ? 'is left of what NAS authorized after the other requests on this NAS request' : 'NAS authorized'}. Ask the investigator to revise the NAS request, or reduce the planned work.</p>` : ''}
          <h3 class="section">By section</h3>
          <table class="t"><tbody>${sum.sections.map((s) => `<tr><td>${esc(sectionName(meta, s.section))}</td><td class="n">${money(s.amount)}</td></tr>`).join('')}</tbody></table>
        </div>
      </div>
      <div class="actions"><button class="btn quiet" type="button" id="back">Back</button><button class="btn" type="button" id="next" ${ok.length ? '' : 'disabled'}>Continue</button></div>`;
    $('#phasepick')?.addEventListener('change', (e) => { wiz.phase = e.target.value === '(scope)' ? '' : e.target.value; wiz.lines = null; stepEstimate(app, box, meta); });
    $$('input.units', box).forEach((inp) => inp.addEventListener('change', () => {
      const v = Math.round(parseFloat(inp.value) * 100) / 100;
      if (v > 0) wiz.lines[Number(inp.dataset.i)].units = v;
      draw(); $(`#u${inp.dataset.i}`)?.focus();
    }));
    $$('[data-rm]', box).forEach((b) => b.addEventListener('click', () => { wiz.lines.splice(Number(b.dataset.rm), 1); draw(); }));
    const add = $('#add'); const list = $('#matches');
    add.addEventListener('input', () => {
      const q = add.value.trim().toLowerCase();
      if (q.length < 2) { list.hidden = true; return; }
      const found = pl.items.filter((i) => i.code.toLowerCase().includes(q) || i.description.toLowerCase().includes(q)).slice(0, 12);
      list.innerHTML = found.length ? found.map((i) => `<li><button type="button" data-code="${i.code}"><span class="code">${esc(i.code)}</span><span>${esc(i.description)}</span><span style="text-align:right">${i.price == null ? 'not priced' : money(i.price)}</span></button></li>`).join('')
        : `<li style="padding:8px 12px" class="muted">No code matches “${esc(add.value)}”.</li>`;
      list.hidden = false;
      $$('button', list).forEach((b) => b.addEventListener('click', () => {
        const item = pl.items.find((i) => i.code === b.dataset.code);
        wiz.lines.push({ section: item.sections[0], code: item.code, units: wiz.n });
        draw(); $('#add').focus();
      }));
    });
    $('#back').addEventListener('click', () => { wiz.step = 2; renderIntake(app); });
    $('#next').addEventListener('click', () => { wiz.step = 4; renderIntake(app); });
  };
  draw();
}

async function stepReview(app, box, meta) {
  await refreshNas();
  const def = meta.requestTypes[wiz.type];
  const s = wiz.study;
  box.innerHTML = `
    <div class="split">
      <div>
        <h2>Ready to create</h2>
        <dl class="dl">
          <dt>Investigator</dt><dd>${esc(wiz.nas.requester.last)}${wiz.nas.requester.first ? `, ${esc(wiz.nas.requester.first)}` : ''}</dd>
          <dt>NAS#</dt><dd>${esc(wiz.nas.number)}</dd>
          <dt>Type</dt><dd>${esc(def.name)}${wiz.priority === 'S' ? ', STAT' : ''}</dd>
          <dt>MHL numbers</dt><dd>${wiz.n}${wiz.animals ? ` <span class="muted">from the animal list ${esc(wiz.animalFile)}${(() => { const g = ANIMALS.groupsFromAnimals(wiz.animals); return g.length ? `: ${g.map((x) => esc(x.code)).join(', ')}` : ''; })()}</span>` : ''}</dd>
          <dt>Study</dt><dd>${s.mode === 'none' ? 'None' : s.mode === 'new' ? `New: ${esc(s.zap || 'next ZAP#')} ${esc(s.title)}` : 'Existing study'}</dd>
          <dt>Stains and IHC</dt><dd>${ihcChosen(wiz.ihc) ? esc([...wiz.ihc.stains.map((x) => (x.view ? `${x.view.name}${x.view.antibody?.clone ? ` (${x.view.antibody.clone})` : ''}` : x.newAntibody.name)),
    !wiz.ihc.addOn && wiz.ihc.he.on ? `H&E x${wiz.ihc.he.perBlock}` : '', wiz.ihc.unstained.on ? `unstained x${wiz.ihc.unstained.perBlock}` : ''].filter(Boolean).join(', ')) + ' on each block' : 'None'}</dd>
          <dt>Estimate</dt><dd>${money(wiz.total)} of ${money(wiz.nas.authorized)} authorized</dd>
        </dl>
        <h3 class="section">Request number</h3>
        <div class="checks" style="flex-direction:column;align-items:flex-start;gap:6px" id="rnmode">
          <label><input type="radio" name="rnmode" value="auto" ${wiz.numberMode !== 'manual' ? 'checked' : ''}> Next number: <strong class="code" id="rnnext">…</strong></label>
          <label><input type="radio" name="rnmode" value="manual" ${wiz.numberMode === 'manual' ? 'checked' : ''}> Enter the number by hand, for example a request ID from PHL.exe (the old tracking system)</label>
        </div>
        <div class="field" style="max-width:280px;margin-top:6px"><label for="rnum" class="small">Request number</label><input id="rnum" maxlength="12" value="${esc(wiz.manualNumber || '')}" placeholder="e.g. 270333" style="text-transform:uppercase" ${wiz.numberMode === 'manual' ? '' : 'disabled'}></div>
        <p class="small" id="rncheck" aria-live="polite"></p>
        <p class="note info">Creating the request issues the MHL numbers from a counter that never hands out the same number twice, and accessions every MHL number. An automatic request number comes from the same kind of counter; a number entered by hand is checked against every request first.</p>
      </div>
      <div>
        <h2>Estimate lines</h2>
        <table class="t"><tbody>${wiz.priced.map((l) => `<tr><td class="code">${esc(l.code)}</td><td>${esc(l.description)}</td><td class="n">${l.units}</td><td class="n">${money(l.amount)}</td></tr>`).join('')}
          <tr class="total"><td colspan="3">Estimate</td><td class="n">${money(wiz.total)}</td></tr></tbody></table>
      </div>
    </div>
    <div class="actions"><button class="btn quiet" type="button" id="back">Back</button><button class="btn" type="button" id="create">Create request and MHL numbers</button></div>`;
  $('#back').addEventListener('click', () => { wiz.step = 3; renderIntake(app); });
  // Request number: the next automatic number, or one typed by hand and checked as it is typed.
  api('GET', `/api/requests/next-number?type=${encodeURIComponent(wiz.type)}`)
    .then((r) => { const el = $('#rnnext'); if (el) el.textContent = r.number; })
    .catch(() => { const el = $('#rnnext'); if (el) el.textContent = 'issued when the request is created'; });
  // Each check carries a sequence number; an answer is shown only if nothing has changed since it was asked.
  let chk = null, seq = 0;
  const typed = () => ($('#rnum')?.value || '').trim().toUpperCase();
  const check = async () => {
    const out = $('#rncheck');
    if (!out || !$('#rnum')) return;   // the page has moved on
    const v = typed(); wiz.manualNumber = v;
    const mine = ++seq, mode = wiz.numberMode, type = wiz.type;
    if (mode !== 'manual') { out.innerHTML = ''; return; }
    if (!v) { out.innerHTML = '<span class="muted">Type the request number.</span>'; return; }
    let r;
    try { r = await api('GET', `/api/requests/check-number?type=${encodeURIComponent(type)}&number=${encodeURIComponent(v)}`); } catch (err) { r = { ok: false, problem: err.message }; }
    if (mine !== seq || wiz.numberMode !== mode || wiz.type !== type || typed() !== v || !$('#rncheck')) return;
    $('#rncheck').innerHTML = r.ok ? `<span class="ok-text">${esc(r.number)} is free.</span> <span class="muted">It appears in the billing extract as ${esc(r.transId)}.</span>` : `<span class="fitnote">${esc(r.problem)}</span>`;
  };
  $$('input[name="rnmode"]', box).forEach((r) => r.addEventListener('change', () => {
    wiz.numberMode = r.value; $('#rnum').disabled = r.value !== 'manual';
    if (r.value === 'manual') $('#rnum').focus();
    clearTimeout(chk); check();
  }));
  $('#rnum').addEventListener('input', () => { wiz.manualNumber = typed(); clearTimeout(chk); chk = setTimeout(check, 200); });
  check();
  $('#create').addEventListener('click', (e) => act(e.currentTarget, async () => {
    // Read the box itself: the live check runs a moment after typing stops, so wiz may lag the last keystroke.
    clearTimeout(chk);
    if (wiz.numberMode === 'manual') wiz.manualNumber = typed();
    if (wiz.numberMode === 'manual' && !wiz.manualNumber) throw new Error('Type the request number, or choose the next automatic number.');
    const study = s.mode === 'existing' ? { mode: 'existing', studyId: Number(s.studyId) }
      : s.mode === 'new' ? { mode: 'new', zap: s.zap, title: s.title, acuc: s.acuc, necropsyProtocolId: s.necropsyProtocolId, trimProtocolId: s.trimProtocolId } : { mode: 'none' };
    const res = await api('POST', '/api/requests', { nasId: wiz.nas.id, type: wiz.type, n: wiz.n, species: wiz.species, priority: wiz.priority, fixative: wiz.fixative, areas: wiz.areas, study,
      lines: wiz.priced.map((l) => ({ section: l.section, code: l.code, units: l.units })), ihc: ihcChosen(wiz.ihc) ? ihcPayload(wiz.ihc) : null,
      requestNumber: wiz.numberMode === 'manual' ? wiz.manualNumber : '', tissueDisp: wiz.tissueDisp || '', estimatePhase: wiz.fromScope === 'phase' ? wiz.phase : '',
      animals: wiz.animals || null, animalFile: wiz.animals ? wiz.animalFile : '' });
    const nasId = wiz.nas.id;
    wiz = null;
    location.hash = `#/new/created/${res.id}?nas=${nasId}`;
    return res;
  }, (res) => `Request ${res.number} created`));
}

// The page after a request is created, from a NAS request here or from an accepted IHC web request: labels, the
// tracking sheet, and starting the next one. another: the NAS request it came from, to start another request from it.
export async function renderCreatedPage(app, requestId, { another = false } = {}) {
  const d = await api('GET', `/api/requests/${requestId}`);
  const r = d.request;
  const phls = d.subjects.map((s) => s.phl).sort();
  const nasOpen = d.nas && !d.nas.closed;
  const labels = [{ v: r.number, l2: `${r.piName}${d.nas ? `, NAS# ${d.nas.number}` : ''}`, l3: `${d.subjects.length} MHL numbers` },
    ...d.subjects.map((s) => ({ v: s.phl, l2: `${r.number}, ${r.pi.last}`, l3: subjectLabel(s) }))];
  let sel = Math.min(1, labels.length - 1);
  const draw = () => {
    app.innerHTML = `
      <div class="crumb"><a href="#/new">New request</a></div>
      <h1>Request ${esc(r.number)} created</h1>
      <p>${d.subjects.length} MHL numbers, <strong>${esc(phls[0])}</strong> to <strong>${esc(phls.at(-1))}</strong>, are accessioned. ${d.nas ? `The estimate of ${money(r.estimateTotal)} is ready to send back to NAS# ${esc(d.nas.number)}${d.financials.nasRequests > 1 ? `, which now funds ${d.financials.nasRequests} requests` : ''}.` : 'Link a NAS request on the request page when the investigator has one.'}</p>
      <div class="actions" style="margin-top:12px">
        <a class="btn" href="#/labels/${r.id}">Print labels</a>
        <a class="btn" href="#/tracking/${r.id}">Print tracking sheet</a>
        <a class="btn quiet" href="#/request/${r.id}">Open ${esc(r.number)}</a>
        ${d.webRequest ? `<a class="btn quiet" href="#/molecular/request/${d.webRequest.id}">IHC worksheet (${esc(d.webRequest.number)})</a>` : ''}
        ${r.areas.includes('NECRO') ? '<a class="btn quiet" href="#/necropsy">Go to necropsy</a>' : ''}
        ${nasOpen && another ? `<button class="btn quiet" type="button" id="againnas">Another request from NAS# ${esc(d.nas.number)}</button>` : ''}
        <button class="btn quiet" type="button" id="another">${wiz ? 'Back to the request in progress' : 'Start a new request'}</button>
      </div>
      <h2 class="section">Labels</h2>
      <p class="muted small">Select a label to see the ZPL a thermal printer would receive.</p>
      <div class="labels">${labels.slice(0, 8).map((l, i) => `
        <button type="button" class="label" aria-pressed="${i === sel}" data-l="${i}">${code128Svg(l.v)}<div class="l1">${esc(l.v)}</div><div class="l2">${esc(l.l2)}</div><div class="l2">${esc(l.l3)}</div></button>`).join('')}</div>
      ${labels.length > 8 ? `<p class="muted">and ${labels.length - 8} more.</p>` : ''}
      <pre class="code">${esc(zplJar(labels[sel].v, labels[sel].v, labels[sel].l2, labels[sel].l3))}</pre>`;
    $$('[data-l]', app).forEach((b) => b.addEventListener('click', () => { sel = Number(b.dataset.l); draw(); $(`[data-l="${sel}"]`, app).focus(); }));
    $('#another').addEventListener('click', () => navigateNew(app));   // a wizard already in progress is kept
    $('#againnas')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      const meta = await getMeta();
      const { nas } = await api('GET', '/api/nas');
      const n = nas.find((x) => x.id === d.nas.id);
      if (!n) throw new Error(`NAS# ${d.nas.number} is closed.`);
      startWizard(n, meta);
      navigateNew(app);
    }));
    pageTop(app);
  };
  draw();
}
// Back to the wizard: through the router if the address changes, directly if it is already #/new.
function navigateNew(app) { if (location.hash === '#/new') renderIntake(app); else location.hash = '#/new'; }
