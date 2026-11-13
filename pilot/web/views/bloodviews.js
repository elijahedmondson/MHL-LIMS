// Bloodwork: importing results from the Genesis (Hemavet DMS export), VS2 and Piccolo (PuTTY logs, or listening to the
// analyzer's serial port directly), reviewing and releasing them, cytology, reference ranges, and the printable report.
import { $, $$, api, esc, fmtDate, fmtDateTime, getMeta, act, pageTop, options, navigate, toast, download } from '../ui.js';
import { readSheet, sniff } from '../lib/sheets.mjs';

const KIND = { HEMATOLOGY: 'Hematology', CHEMISTRY: 'Chemistry' };
const STATUS = { TO_REVIEW: ['warn', 'To review'], UNMATCHED: ['warn', 'Unmatched'], RELEASED: ['complete', 'Released'], REJECTED: ['muted', 'Rejected'] };
const badge = (s) => `<span class="badge ${STATUS[s]?.[0] || ''}">${STATUS[s]?.[1] || s}</span>`;
const fmtVal = (a) => (a.value != null ? `${a.prefix || ''}${a.value}` : esc(a.text || '—'));
const flagCell = (f) => (f === 'H' ? '<b class="hi">H</b>' : f === 'L' ? '<b class="lo">L</b>' : esc(f || ''));
const rangeText = (r) => (r ? `${r.low ?? ''}–${r.high ?? ''}${r.source === 'lab' ? '' : ' *'}` : '');

function resultsTable(rows, { assign = false } = {}) {
  if (!rows.length) return '<p class="empty">None.</p>';
  return `<table class="t"><thead><tr><th>${assign ? 'Sample ID on the analyzer' : 'MHL#'}</th><th>${assign ? 'File' : 'Animal'}</th><th>Kind</th><th>Instrument</th><th>Tested</th><th class="n">Flags</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((r) => `<tr class="click" data-href="#/bloodwork/result/${r.id}">
      <td class="code">${assign ? esc(r.sampleId || '(blank)') : `${esc(r.phl || '')}${r.zap ? `<br><span class="small muted">${esc(r.zap)}</span>` : ''}`}</td>
      <td class="small">${assign ? esc(r.fileName) : `${esc(r.label)}${r.groupCode ? `, ${esc(r.groupCode)}` : ''}${r.requestNumber ? `<br><span class="muted">${esc(r.requestNumber)}</span>` : ''}`}</td>
      <td>${KIND[r.kind]}${r.panel ? `<br><span class="small muted">${esc(r.panel)}</span>` : ''}</td><td class="small">${esc(r.instrumentName)}</td>
      <td class="small">${fmtDate(r.testedOn)} ${esc(r.testedAt)}</td><td class="n">${r.flagged ? `<span class="badge warn">${r.flagged}</span>` : ''}</td><td>${badge(r.status)}</td>
      <td><a class="btn small quiet" href="#/bloodwork/result/${r.id}">${r.status === 'UNMATCHED' ? 'Assign' : r.status === 'TO_REVIEW' ? 'Review' : 'Open'}</a></td></tr>`).join('')}
  </tbody></table>`;
}

export async function renderBloodwork(app, tab = 'review') {
  const [home, meta] = await Promise.all([api('GET', '/api/bloodwork'), getMeta()]);
  const tabs = [['review', `To review (${home.toReview.length + home.unmatched.length})`], ['import', 'Import results'], ['cytology', `Cytology (${home.cytology.length})`], ['ranges', 'Reference ranges'], ['recent', 'Released']];
  app.innerHTML = `
    <h1>Bloodwork</h1>
    <p class="muted">Hematology from the Genesis analyzer, chemistry from the VetScan VS2 and Piccolo, and cytology. Results are matched to animals by the MHL number typed on the analyzer, reviewed, then released, which creates the charge.</p>
    <nav class="subtabs" aria-label="Bloodwork sections">${tabs.map(([k, l]) => `<a href="#/bloodwork/${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
    <div id="bw" class="section"></div>`;
  pageTop(app);
  const box = $('#bw');
  if (tab === 'import') importTab(box, home);
  else if (tab === 'cytology') cytologyTab(box, home, meta);
  else if (tab === 'ranges') await rangesTab(box, meta);
  else if (tab === 'recent') {
    box.innerHTML = `<h2>Released and rejected</h2>${resultsTable(home.recent)}
      <h2 class="section">Imports</h2><table class="t"><thead><tr><th>File</th><th>When</th><th>By</th><th class="n">Results</th></tr></thead><tbody>
      ${home.runs.map((r) => `<tr><td>${esc(r.fileName)}${r.layout ? ` <span class="small muted">(${esc(r.layout)} layout)</span>` : ''}</td><td class="small">${fmtDateTime(r.importedAt)}</td><td>${esc(r.importedBy)}</td><td class="n">${r.count}</td></tr>`).join('')}</tbody></table>`;
  } else {
    box.innerHTML = `
      <h2>Results to review</h2>
      <p class="small muted">Check each result against the printout and the animal, then release it. Flags are the instrument's (H or L on the printout) and the lab's, from the reference ranges.</p>
      ${resultsTable(home.toReview)}
      <h2 class="section">Sample IDs that are not MHL numbers</h2>
      <p class="small muted">Usually a typing slip on the analyzer. Open the result and assign it to the right MHL number.</p>
      ${resultsTable(home.unmatched, { assign: true })}`;
  }
  $$('tr.click', box).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a,button')) location.hash = tr.dataset.href; }));
}

// ---------- import ----------
let serial = null;
function importTab(box, home) {
  const server = !window.MHL_LOCAL;
  const canSerial = 'serial' in navigator;
  box.innerHTML = `
    <div class="split even">
      <div class="panel">
        <h2>Import files</h2>
        <p class="small">Choose the PuTTY logs from the VS2 or Piccolo (.txt or .log) and the Hemavet DMS export (.xls, .xlsx or .csv). You can choose several at once. The files are read on this computer; a file imported twice is skipped.</p>
        <div class="field"><label for="inst">Chemistry analyzer</label><select id="inst">${options([['', 'Work it out from the printout'], ['VS2', 'VetScan VS2'], ['PICCOLO', 'Piccolo Xpress']], '')}</select></div>
        <div class="field"><label for="layout">Hemavet sheet layout</label><select id="layout">${options([['', 'Work it out from the sheet'], ['original', 'Original layout (Zaphod: Read files)'], ['extended', 'Newer layout with RDW-SD, PDW and PCT (Zaphod: Read new file format)']], '')}</select></div>
        <input type="file" id="bf" multiple accept=".txt,.log,.xls,.xlsx,.csv,.tsv,.htm,.html" aria-label="Instrument files">
        <div id="bres" class="section" aria-live="polite"></div>
        <p class="small muted">Sample files to try are in the pilot's <code>samples/instruments</code> folder.</p>
      </div>
      <div>
        <div class="panel">
          <h2>Paste a printout</h2>
          <p class="small">Paste what PuTTY captured for one or more VS2 or Piccolo printouts.</p>
          <textarea id="paste" style="min-height:110px;font-family:var(--mono, monospace)" aria-label="Printout text"></textarea>
          <div class="actions"><button class="btn quiet" type="button" id="pastego">Import text</button></div>
        </div>
        <div class="panel section">
          <h2>Listen to an analyzer</h2>
          ${canSerial ? `<p class="small">Instead of PuTTY: connect the VS2 or Piccolo serial cable to this computer, choose its port, and print or resend the results on the analyzer. Each printout is imported when the analyzer stops sending. Edge or Chrome only. Try it alongside PuTTY at first.</p>
            <div class="form" style="grid-template-columns:1fr 1fr"><div class="field"><label for="baud">Speed (baud)</label><select id="baud">${options(['9600', '19200', '38400', '57600', '115200'], '9600')}</select></div>
            <div class="field"><span class="lbl">&nbsp;</span><div><button class="btn" type="button" id="listen">${serial ? 'Stop listening' : 'Choose port and listen'}</button></div></div></div>
            <p class="small muted" id="sstat">${serial ? 'Listening…' : 'Not listening.'}</p><pre class="code" id="slog" style="max-height:160px;overflow:auto" hidden></pre>`
          : '<p class="small">This browser cannot talk to serial ports. Open the pilot in Microsoft Edge or Google Chrome to listen to an analyzer directly, or keep capturing with PuTTY and import the log.</p>'}
        </div>
        ${server ? `<div class="panel section">
          <h2>Read the instrument folders</h2>
          <p class="small">Like Zaphod's Read Files buttons: imports every file in the folders below and moves each one it read into a Processed folder next to it.</p>
          <p class="small">Chemistry: <code>${esc(home.folders.chemistry || 'not set')}</code><br>Hematology: <code>${esc(home.folders.hematology || 'not set')}</code> <a href="#/settings">Change</a></p>
          <div class="actions"><button class="btn quiet" type="button" id="readdir" ${home.folders.chemistry || home.folders.hematology ? '' : 'disabled'}>Read new files</button></div>
        </div>` : ''}
      </div>
    </div>`;
  const out = $('#bres');
  const report = (name, res) => {
    out.insertAdjacentHTML('beforeend', `<p class="small"><strong>${esc(name)}</strong>: ${res.error ? `<span class="fitnote">${esc(res.error)}</span>`
      : `${res.imported} imported (${res.matched} matched${res.unmatched ? `, <a href="#/bloodwork/review">${res.unmatched} unmatched</a>` : ''})${res.duplicates ? `, ${res.duplicates} already imported` : ''}${res.layout ? `; ${esc(res.layout)} layout` : ''}${res.truncated ? '; <span class="fitnote">only part of the file was read</span>' : ''}`}${res.error && res.imported != null ? ` <span class="fitnote">${esc(res.error)}</span>` : ''}</p>`);
  };
  const importFile = async (f) => {
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const kind = sniff(bytes, f.name);
      const textLike = /\.(txt|log)$/i.test(f.name) || (kind === 'csv' && !/\.csv$/i.test(f.name) && /VETSCAN|VS2|PICCOLO|Patient ID/i.test(new TextDecoder().decode(bytes.slice(0, 4000))));
      if (textLike) return await api('POST', '/api/bloodwork/import', { fileName: f.name, text: new TextDecoder().decode(bytes), instrument: $('#inst').value });
      const { grid } = await readSheet(bytes, f.name);
      return await api('POST', '/api/bloodwork/import', { fileName: f.name, grid, layout: $('#layout').value });
    } catch (e) { return { error: e.message }; }
  };
  $('#bf').addEventListener('change', async (e) => {
    out.innerHTML = '';
    for (const f of e.target.files) report(f.name, await importFile(f));
    await getMeta(true);
    e.target.value = '';
  });
  $('#pastego').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await api('POST', '/api/bloodwork/import', { fileName: `Pasted ${new Date().toLocaleString()}`, text: $('#paste').value, instrument: $('#inst').value });
    report('Pasted text', res); $('#paste').value = '';
    return res;
  }));
  $('#readdir')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await api('POST', '/api/bloodwork/read-folder', {});
    out.innerHTML = '';
    for (const f of res.files) report(f.name, f);
    if (!res.files.length) out.innerHTML = '<p class="small muted">No new files in the folders.</p>';
    return res;
  }));
  $('#listen')?.addEventListener('click', async () => {
    if (serial) { await stopSerial(); importTab(box, home); return; }
    try { await startSerial(Number($('#baud').value)); importTab(box, home); } catch (err) { toast(err.message, 'error'); }
  });
}

async function startSerial(baudRate) {
  const port = await navigator.serial.requestPort();
  await port.open({ baudRate, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none' });
  serial = { port, reader: null, keep: true, buf: '', timer: null, instrument: document.querySelector('#inst')?.value || '' };
  const decoder = new TextDecoder();
  const status = (t) => { const el = document.querySelector('#sstat'); if (el) el.textContent = t; };
  const flush = async () => {
    const text = serial?.buf || ''; if (serial) serial.buf = '';
    if (!text.trim()) return;
    const log = document.querySelector('#slog');
    if (log) { log.hidden = false; log.textContent = `${text.slice(-1500)}\n`; }
    try {
      const res = await api('POST', '/api/bloodwork/import', { fileName: `Serial capture ${new Date().toLocaleString()}`, text, source: 'serial', instrument: serial?.instrument || '' });
      toast(`Analyzer result imported: ${res.imported} result${res.imported === 1 ? '' : 's'}${res.unmatched ? `, ${res.unmatched} unmatched` : ''}`);
      status('Listening… last printout imported.');
    } catch (e) { toast(`The printout could not be read: ${e.message}`, 'error'); status('Listening…'); }
  };
  (async () => {
    while (serial?.keep && port.readable) {
      serial.reader = port.readable.getReader();
      try {
        for (;;) {
          const { value, done } = await serial.reader.read();
          if (done) break;
          serial.buf += decoder.decode(value, { stream: true });
          status(`Receiving… ${serial.buf.length} characters`);
          clearTimeout(serial.timer);
          serial.timer = setTimeout(flush, 3000);
        }
      } catch (e) { status(`Stopped: ${e.message}`); } finally { serial?.reader?.releaseLock(); }
    }
  })();
}
async function stopSerial() {
  if (!serial) return;
  serial.keep = false;
  try { await serial.reader?.cancel(); } catch { /* already closed */ }
  try { await serial.port.close(); } catch { /* already closed */ }
  serial = null;
}

// ---------- one result ----------
export async function renderBloodResult(app, id) {
  const d = await api('GET', `/api/bloodwork/results/${id}`);
  const r = d.result;
  const locked = r.status === 'RELEASED' || r.status === 'REJECTED';
  app.innerHTML = `
    <p class="crumb"><a href="#/bloodwork">Bloodwork</a></p>
    <div class="head"><h1>${KIND[r.kind]}${d.subject ? `: ${esc(d.subject.phl)}` : ''}</h1>${badge(r.status)}</div>
    <div class="facts"><span>${esc(r.instrumentName)}${r.panel ? `, ${esc(r.panel)}` : ''}</span><span>Tested ${fmtDate(r.testedOn)} ${esc(r.testedAt)}</span>
      <span>Sample ID on the analyzer: <b class="code">${esc(r.sampleId || '(blank)')}</b></span>${r.rotorLot ? `<span>Rotor lot ${esc(r.rotorLot)}</span>` : ''}${r.testNumber ? `<span>Test ${esc(r.testNumber)}</span>` : ''}
      ${r.qc ? `<span>QC <b>${esc(r.qc)}</b></span>` : ''}${r.indices ? `<span>HEM ${esc(r.indices.hem)} LIP ${esc(r.indices.lip)} ICT ${esc(r.indices.ict)}</span>` : ''}
      <span>File: ${esc(r.fileName)}</span></div>
    ${d.subject ? `<p class="small">Animal ${esc(d.subject.label)}${d.subject.groupCode ? `, group ${esc(d.subject.groupCode)}` : ''}${d.subject.sex ? `, ${d.subject.sex === 'F' ? 'female' : d.subject.sex === 'M' ? 'male' : 'sex unknown'}` : ''}.
      <a href="#/request/${d.request.id}">${esc(d.request.number)}</a> ${esc(d.request.piName)}${d.study ? `, <a href="#/study/${d.study.id}?view=bloodwork">${esc(d.study.zap)}</a>` : ''}.
      <a href="#/report/${d.subject.id}/bloodwork">Bloodwork report</a></p>` : ''}
    ${r.status === 'REJECTED' ? `<p class="note">Rejected by ${esc(r.reviewedBy)}: ${esc(r.rejectReason)}</p>` : ''}
    ${r.status === 'RELEASED' ? `<div class="locked">Released by ${esc(r.reviewedBy)} on ${fmtDateTime(r.reviewedAt)}.${d.charge ? ` Charge ${esc(d.charge.code)} ${esc(d.charge.codeDescription)} (${d.charge.status.toLowerCase()}).` : ' No charge (no-charge request).'}${r.comment ? `<br>${esc(r.comment)}` : ''}</div>` : ''}
    <div class="split wide-left section">
      <div>
        <table class="t"><thead><tr><th>Analyte</th><th class="n">Result</th><th>Unit</th><th class="n">Range</th><th>Instrument flag</th><th>Flag</th></tr></thead><tbody>
          ${d.analytes.map((a) => `<tr class="${a.labFlag ? 'flag' : ''}"><td>${esc(a.name)} <span class="small muted">${esc(a.code)}</span></td><td class="n"><b>${fmtVal(a)}</b></td><td class="small">${esc(a.unit)}</td>
            <td class="n small">${rangeText(a.range)}</td><td>${flagCell(a.flag)}</td><td>${flagCell(a.labFlag)}${a.unitNote ? ` <span class="small fitnote">${esc(a.unitNote)}</span>` : ''}</td></tr>`).join('')}
        </tbody></table>
        <p class="small muted">Range: the lab's reference range for the species if one is set under Reference ranges; otherwise the range printed by the analyzer (*). Flag compares the result with that range.</p>
        ${r.raw ? `<details class="section"><summary>What the analyzer sent</summary><pre class="code">${esc(r.raw)}</pre></details>` : ''}
      </div>
      <div>
        ${r.status === 'UNMATCHED' || r.status === 'TO_REVIEW' ? `
          <h2>${r.status === 'UNMATCHED' ? 'Assign to an MHL number' : 'Wrong animal?'}</h2>
          <form class="form" id="assign" style="grid-template-columns:2fr 1fr"><div class="field"><label for="aphl">MHL#</label><input id="aphl" value="${esc(r.status === 'UNMATCHED' ? r.sampleId : d.subject?.phl || '')}" maxlength="20" style="text-transform:uppercase"></div>
            <div class="field"><span class="lbl">&nbsp;</span><div><button class="btn ${r.status === 'UNMATCHED' ? '' : 'quiet'}" type="submit">Assign</button></div></div></form>` : ''}
        ${r.status === 'TO_REVIEW' ? `
          <h2 class="section">Review</h2>
          <div class="field"><label for="cmt">Comment (optional; shown on the report)</label><textarea id="cmt" maxlength="1000"></textarea></div>
          <div class="actions"><button class="btn" type="button" id="release">Release result</button><button class="btn quiet" type="button" id="reject">Reject</button></div>
          ${r.instrument === 'ABAXIS' ? `<div class="field section"><label for="inst">Which analyzer printed this? (the printout does not say)</label><select id="inst">${options([['', 'Choose'], ['VS2', 'VetScan VS2'], ['PICCOLO', 'Piccolo Xpress']], '')}</select></div>` : ''}
          <p class="small muted">Releasing locks the result and creates the ${r.kind === 'HEMATOLOGY' ? 'CBC (HP002101)' : r.instrument === 'PICCOLO' ? 'Piccolo panel (HP002205)' : r.instrument === 'VS2' ? 'VetScan panel (HP002204)' : 'chemistry'} charge for billing QC.</p>` : ''}
        ${r.status === 'UNMATCHED' ? '<div class="actions section"><button class="btn quiet" type="button" id="reject">Reject (not ours, or a test run)</button></div>' : ''}
        ${locked ? '<div class="actions"><button class="btn quiet" type="button" id="reopen">Reopen</button></div>' : ''}
        ${d.others.length ? `<h2 class="section">Other results for this animal</h2>${resultsTable(d.others)}` : ''}
        <h2 class="section">History</h2><ul class="small muted">${r.history.slice().reverse().map((h) => `<li>${fmtDateTime(h.at)} ${esc(h.by)}: ${esc(h.action)}</li>`).join('')}</ul>
      </div>
    </div>`;
  pageTop(app);
  const reload = () => renderBloodResult(app, id);
  $('#assign')?.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { await api('POST', `/api/bloodwork/results/${id}/assign`, { phl: $('#aphl').value }); await reload(); }, 'Assigned'); });
  $('#inst')?.addEventListener('change', (e) => act(null, async () => { if (!e.target.value) return; await api('POST', `/api/bloodwork/results/${id}/instrument`, { instrument: e.target.value }); await reload(); }, 'Analyzer set'));
  $('#release')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/bloodwork/results/${id}/release`, { comment: $('#cmt').value }); await getMeta(true); await reload(); }, 'Released'));
  $('#reject')?.addEventListener('click', (e) => act(e.currentTarget, async () => { const reason = prompt('Why reject this result? For example: QC failed, rerun; duplicate run; not an MHL sample.'); if (!reason) return; await api('POST', `/api/bloodwork/results/${id}/reject`, { reason }); await getMeta(true); await reload(); }, 'Rejected'));
  $('#reopen')?.addEventListener('click', (e) => act(e.currentTarget, async () => { const reason = prompt('Why reopen it?'); if (!reason) return; await api('POST', `/api/bloodwork/results/${id}/reopen`, { reason }); await getMeta(true); await reload(); }, 'Reopened'));
}

// ---------- cytology ----------
function cytologyTab(box, home, meta) {
  box.innerHTML = `
    <div class="split wide-left">
      <div><h2>Cytology</h2>
        ${home.cytology.length ? `<table class="t"><thead><tr><th>MHL#</th><th>Specimen</th><th>Collected</th><th>Pathologist</th><th>Status</th></tr></thead><tbody>
          ${home.cytology.map((c) => `<tr class="click" data-href="#/bloodwork/cytology/${c.id}"><td class="code"><a href="#/bloodwork/cytology/${c.id}">${esc(c.phl)}</a><br><span class="small muted">${esc(c.requestNumber)}</span></td>
            <td>${esc(c.specimen)}</td><td class="small">${fmtDate(c.collectedOn)}</td><td>${esc(c.pathologist)}</td><td>${c.status === 'SIGNED' ? `<span class="badge complete">Signed${c.version > 1 ? ` v${c.version}` : ''}</span>` : '<span class="badge warn">Draft</span>'}</td></tr>`).join('')}
        </tbody></table>` : '<p class="empty">No cytology yet.</p>'}</div>
      <div class="panel"><h2>New cytology</h2>
        <form class="form" id="newcyto"><div class="field"><label for="cphl">MHL#</label><input id="cphl" maxlength="20" required style="text-transform:uppercase"></div>
          <div class="field"><label for="cspec">Specimen</label><select id="cspec">${options(meta.bloodwork.specimens, 'Blood smear')}</select></div>
          <div><button class="btn" type="submit">Start</button></div></form>
        <p class="small muted">Blood and marrow smears get a differential count; marrow also an M:E ratio. Fluids and aspirates get a cell count and description.</p></div>
    </div>`;
  $$('tr.click', box).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  $('#newcyto').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { const res = await api('POST', '/api/bloodwork/cytology', { phl: $('#cphl').value, specimen: $('#cspec').value }); navigate(`#/bloodwork/cytology/${res.id}`); return res; });
  });
}

export async function renderCytology(app, id) {
  const meta = await getMeta();
  let d = await api('GET', `/api/bloodwork/cytology/${id}`);
  const draw = () => {
    const c = d.cytology; const signed = c.status === 'SIGNED'; const dis = signed ? 'disabled' : '';
    const sum = d.summary;
    app.innerHTML = `
      <p class="crumb"><a href="#/bloodwork/cytology">Bloodwork › Cytology</a></p>
      <div class="head"><h1>Cytology: ${esc(d.subject.phl)}</h1>${signed ? `<span class="badge complete">Signed${c.version > 1 ? ` v${c.version}` : ''}</span>` : `<span class="badge warn">Draft${c.version > 1 ? ` v${c.version}` : ''}</span>`}</div>
      <p class="small">Animal ${esc(d.subject.label)}${d.subject.groupCode ? `, group ${esc(d.subject.groupCode)}` : ''}. <a href="#/request/${d.request.id}">${esc(d.request.number)}</a> ${esc(d.request.piName)}${d.study ? `, ${esc(d.study.zap)}` : ''}. <a href="#/report/${d.subject.id}/bloodwork">Bloodwork report</a></p>
      ${signed ? `<div class="locked">Signed out by ${esc(c.signedBy)} on ${fmtDateTime(c.signedAt)}. <button class="btn small quiet" type="button" id="amend">Amend</button></div>` : ''}
      <div class="form three section">
        <div class="field"><label for="c-spec">Specimen</label><select id="c-spec" ${dis}>${options(meta.bloodwork.specimens, c.specimen)}</select></div>
        <div class="field"><label for="c-stain">Stain</label><select id="c-stain" ${dis}>${options(meta.bloodwork.stains, c.stain)}</select></div>
        <div class="field"><label for="c-date">Collected</label><input type="date" id="c-date" value="${esc(c.collectedOn)}" ${dis}></div>
      </div>
      <div class="split section">
        <div>
          <h2>Differential count</h2>
          <table class="t"><thead><tr><th>Cell</th><th class="n">Count</th><th class="n">%</th></tr></thead><tbody>
            ${d.cells.map((cell) => `<tr><td>${esc(cell)}</td><td class="n"><input class="inp" type="number" min="0" max="10000" style="width:80px" data-cell="${esc(cell)}" value="${c.counts[cell] || ''}" ${dis} aria-label="${esc(cell)} count"></td><td class="n" data-pct="${esc(cell)}">${sum.pct[cell] || ''}</td></tr>`).join('')}
            <tr class="total"><td>Cells counted</td><td class="n" id="tot">${sum.total}</td><td></td></tr>
            ${sum.kind === 'marrow' ? `<tr><td>M:E ratio</td><td class="n" id="me">${sum.me ?? ''}</td><td></td></tr>` : ''}
          </tbody></table>
        </div>
        <div>
          ${sum.kind === 'blood' ? `<h2>Red cells and platelets</h2>
            <table class="t"><tbody>${meta.bloodwork.rbcMorphology.map((m) => `<tr><td>${esc(m)}</td><td><select data-rbc="${esc(m)}" ${dis} aria-label="${esc(m)}">${options(meta.bloodwork.grades.map((g) => [g, g || 'None seen']), c.rbc[m] || '')}</select></td></tr>`).join('')}
              <tr><td>Nucleated RBC per 100 WBC</td><td><input class="inp" type="number" min="0" id="c-nrbc" style="width:80px" value="${c.nrbc ?? ''}" ${dis}></td></tr>
              <tr><td>Platelet estimate</td><td><select id="c-plt" ${dis}>${options(meta.bloodwork.plateletEstimates.map((p) => [p, p || 'Not assessed']), c.platelets)}</select></td></tr></tbody></table>` : ''}
          ${d.bloodwork.length ? `<h3 class="section">Released bloodwork for this animal</h3><ul class="small">${d.bloodwork.map((b) => `<li><a href="#/bloodwork/result/${b.id}">${KIND[b.kind]}, ${fmtDate(b.testedOn)}</a>${b.flagged ? ` (${b.flagged} flagged)` : ''}</li>`).join('')}</ul>` : ''}
        </div>
      </div>
      <div class="field section"><label for="c-desc">Description</label><textarea id="c-desc" maxlength="4000" ${dis}>${esc(c.description)}</textarea></div>
      <div class="field"><label for="c-int">Interpretation</label><textarea id="c-int" maxlength="4000" ${dis}>${esc(c.interpretation)}</textarea></div>
      ${signed ? '' : '<div class="actions"><button class="btn quiet" type="button" id="save">Save draft</button><button class="btn" type="button" id="sign">Sign out</button></div>'}
      ${c.amendments.length ? `<h2 class="section">Amendments</h2><ul class="small">${c.amendments.map((a) => `<li>From version ${a.fromVersion}, ${fmtDateTime(a.at)} ${esc(a.by)}: ${esc(a.reason)}</li>`).join('')}</ul>` : ''}`;
    pageTop(app);
    const body = () => ({ specimen: $('#c-spec').value, stain: $('#c-stain').value, collectedOn: $('#c-date').value,
      counts: Object.fromEntries($$('[data-cell]', app).map((i) => [i.dataset.cell, i.value])),
      rbc: Object.fromEntries($$('[data-rbc]', app).map((s) => [s.dataset.rbc, s.value])), nrbc: $('#c-nrbc')?.value ?? undefined, platelets: $('#c-plt')?.value ?? undefined,
      description: $('#c-desc').value, interpretation: $('#c-int').value });
    $$('[data-cell]', app).forEach((i) => i.addEventListener('input', () => {
      const counts = $$('[data-cell]', app).map((x) => [x.dataset.cell, Number(x.value) || 0]);
      const total = counts.reduce((n, [, v]) => n + v, 0);
      $('#tot').textContent = total;
      counts.forEach(([k, v]) => { const el = $(`[data-pct="${CSS.escape(k)}"]`, app); if (el) el.textContent = total ? (Math.round((v / total) * 1000) / 10) : ''; });
    }));
    $('#c-spec')?.addEventListener('change', async () => { d = await api('PUT', `/api/bloodwork/cytology/${id}`, body()); draw(); });
    $('#save')?.addEventListener('click', (e) => act(e.currentTarget, async () => { d = await api('PUT', `/api/bloodwork/cytology/${id}`, body()); draw(); }, 'Saved'));
    $('#sign')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('PUT', `/api/bloodwork/cytology/${id}`, body()); d = await api('POST', `/api/bloodwork/cytology/${id}/sign`, {}); draw(); }, 'Signed out'));
    $('#amend')?.addEventListener('click', (e) => act(e.currentTarget, async () => { const reason = prompt('Reason for the amendment'); if (!reason) return; d = await api('POST', `/api/bloodwork/cytology/${id}/amend`, { reason }); draw(); }, 'Amendment started'));
  };
  draw();
}

// ---------- reference ranges ----------
let rangeSpecies = 'MOUSE';
async function rangesTab(box, meta) {
  const r = await api('GET', '/api/bloodwork/ranges');
  const cur = r.ranges[rangeSpecies] || {};
  const row = (a) => `<tr><td>${esc(a.name)} <span class="small muted">${esc(a.code)}</span></td><td class="small">${esc(a.unit)}</td>
    <td><input class="inp" type="number" step="any" style="width:90px" data-lo="${esc(a.code)}" value="${cur[a.code]?.low ?? ''}" aria-label="${esc(a.code)} low"></td>
    <td><input class="inp" type="number" step="any" style="width:90px" data-hi="${esc(a.code)}" value="${cur[a.code]?.high ?? ''}" aria-label="${esc(a.code)} high"></td></tr>`;
  box.innerHTML = `
    <p class="muted">The lab's own reference ranges, by species. A result is flagged against these when they are set, and against the range the analyzer printed when they are not. Importing the Zaphod export fills them from Zaphod's range tables.</p>
    <div class="row"><label for="rsp">Species</label> <select id="rsp" style="width:auto">${options(r.species, rangeSpecies)}</select><span class="spacer"></span><button class="btn" type="button" id="rsave">Save ranges</button></div>
    <div class="split section">
      <div><h2>Hematology</h2><table class="t"><thead><tr><th>Analyte</th><th>Unit</th><th>Low</th><th>High</th></tr></thead><tbody>${meta.bloodwork.hematology.map(row).join('')}</tbody></table></div>
      <div><h2>Chemistry</h2><table class="t"><thead><tr><th>Analyte</th><th>Unit</th><th>Low</th><th>High</th></tr></thead><tbody>${meta.bloodwork.chemistry.map(row).join('')}</tbody></table></div>
    </div>`;
  $('#rsp').addEventListener('change', () => { rangeSpecies = $('#rsp').value; rangesTab(box, meta); });
  $('#rsave').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const ranges = {};
    $$('[data-lo]', box).forEach((i) => { const hi = $(`[data-hi="${CSS.escape(i.dataset.lo)}"]`, box); if (i.value !== '' || hi.value !== '') ranges[i.dataset.lo] = { low: i.value, high: hi.value }; });
    await api('PUT', '/api/bloodwork/ranges', { species: rangeSpecies, ranges });
  }, 'Ranges saved'));
}

// ---------- printable report and study summary ----------
export async function renderBloodReport(app, subjectId) {
  const d = await api('GET', `/api/subjects/${subjectId}/bloodwork`);
  const s = d.subject;
  app.innerHTML = `
    <div class="toolbar no-print"><a href="#/request/${d.request.id}">Back to ${esc(d.request.number)}</a><span class="spacer"></span><button class="btn" type="button" onclick="window.print()">Print</button></div>
    <article class="report">
      <div class="rep-head"><div><div class="rep-lab">Molecular Histopathology Laboratory (MHL)</div><div class="small muted">Laboratory Animal Sciences Program, NCI at Frederick</div></div><div class="rep-title">Bloodwork report</div></div>
      <div class="rep-pilot">Pilot with test data: not a valid report</div>
      <table class="rep-facts"><tbody>
        <tr><th>MHL#</th><td class="code">${esc(s.phl)}</td><th>Animal</th><td>${esc(s.label)}</td><th>Sex</th><td>${s.sex === 'F' ? 'Female' : s.sex === 'M' ? 'Male' : 'Not recorded'}</td></tr>
        <tr><th>Study</th><td>${d.study ? `${esc(d.study.zap)}<br><span class="small">${esc(d.study.title)}</span>` : 'None'}</td><th>Group</th><td>${esc(s.groupCode || 'None')}</td><th>Request</th><td>${esc(d.request.number)}<br><span class="small">${esc(d.request.piName)}</span></td></tr>
      </tbody></table>
      ${d.results.length ? d.results.map((r) => `
        <h2 class="rep-h">${KIND[r.kind]}: ${esc(r.instrumentName)}${r.panel ? `, ${esc(r.panel)}` : ''}</h2>
        <p class="small">Tested ${fmtDate(r.testedOn)} ${esc(r.testedAt)}${r.qc ? `; QC ${esc(r.qc)}` : ''}${r.indices ? `; HEM ${esc(r.indices.hem)}, LIP ${esc(r.indices.lip)}, ICT ${esc(r.indices.ict)}` : ''}.</p>
        <table class="t rep-t"><thead><tr><th>Analyte</th><th class="n">Result</th><th>Unit</th><th class="n">Reference range</th><th>Flag</th></tr></thead><tbody>
          ${r.analytes.map((a) => `<tr><td>${esc(a.name)} (${esc(a.code)})</td><td class="n">${fmtVal(a)}</td><td>${esc(a.unit)}</td><td class="n">${rangeText(a.range)}</td><td>${flagCell(a.labFlag || a.flag)}</td></tr>`).join('')}
        </tbody></table>
        ${r.comment ? `<p><strong>Comment.</strong> ${esc(r.comment)}</p>` : ''}
        <p class="rep-sign">Released by ${esc(r.reviewedBy)} on ${fmtDateTime(r.reviewedAt)}.</p>`).join('') : '<p class="empty">No released hematology or chemistry.</p>'}
      ${d.cytology.map((c) => `
        <h2 class="rep-h">Cytology: ${esc(c.specimen)}</h2>
        <p class="small">Collected ${fmtDate(c.collectedOn)}; ${esc(c.stain)}.${c.summary.total ? ` ${c.summary.total} cells counted${c.summary.me != null ? `; M:E ratio ${c.summary.me}` : ''}.` : ''}</p>
        ${c.summary.total ? `<table class="t rep-t"><thead><tr><th>Cell</th><th class="n">Count</th><th class="n">%</th></tr></thead><tbody>${c.cells.filter((k) => c.counts[k]).map((k) => `<tr><td>${esc(k)}</td><td class="n">${c.counts[k]}</td><td class="n">${c.summary.pct[k]}</td></tr>`).join('')}</tbody></table>` : ''}
        ${Object.keys(c.rbc || {}).length ? `<p class="small"><strong>Red cells:</strong> ${Object.entries(c.rbc).map(([k, v]) => `${esc(k)} ${esc(v)}`).join(', ')}.${c.nrbc != null ? ` Nucleated RBC ${c.nrbc} per 100 WBC.` : ''}${c.platelets ? ` Platelets: ${esc(c.platelets.toLowerCase())}.` : ''}</p>` : ''}
        ${c.description ? `<p>${esc(c.description)}</p>` : ''}
        <p><strong>Interpretation.</strong> ${esc(c.interpretation)}</p>
        <p class="rep-sign">Signed out by ${esc(c.signedBy)} on ${fmtDateTime(c.signedAt)}${c.version > 1 ? ` (amended, version ${c.version})` : ''}.</p>`).join('')}
      <p class="small muted rep-foot">Reference ranges marked * are those printed by the analyzer; the others are the laboratory's.</p>
    </article>`;
  pageTop(app);
}

export function studyBloodworkHtml(sum, studyId) {
  if (!sum.tables.some((t) => t.animals) && !sum.cytology.length) return '<h2>Bloodwork</h2><p class="empty">No released bloodwork for this study yet.</p>';
  return `
    <div class="row"><h2 style="margin:0">Bloodwork</h2><span class="spacer"></span><button class="btn small quiet" type="button" id="bwcsv" data-study="${studyId}">Download bloodwork (CSV)</button></div>
    <p class="small muted">Group mean ± SD (n) of the latest released result for each animal.</p>
    ${sum.tables.filter((t) => t.animals).map((t) => `
      <h3>${KIND[t.kind]} <span class="small muted">${t.animals} animals</span></h3>
      <table class="t"><thead><tr><th>Analyte</th><th>Unit</th>${sum.groupKeys.map((g) => `<th class="n">${esc(g)}</th>`).join('')}</tr></thead><tbody>
        ${t.analytes.map((a) => `<tr><td>${esc(a.name)} <span class="small muted">${esc(a.code)}</span></td><td class="small">${esc(a.unit)}</td>
          ${a.groups.map((g) => `<td class="n">${g.n ? `${g.mean}${g.n > 1 ? ` ± ${g.sd}` : ''} <span class="small muted">(${g.n})</span>` : ''}</td>`).join('')}</tr>`).join('')}
      </tbody></table>`).join('')}
    ${sum.cytology.length ? `<h3>Cytology</h3><ul class="small">${sum.cytology.map((c) => `<li><a href="#/bloodwork/cytology/${c.id}">${esc(c.phl)}: ${esc(c.specimen)}</a> (${c.status === 'SIGNED' ? 'signed' : 'draft'})</li>`).join('')}</ul>` : ''}`;
}
export function wireStudyBloodwork(box) {
  const b = box?.querySelector('#bwcsv');
  b?.addEventListener('click', (e) => act(e.currentTarget, () => download(`/api/studies/${b.dataset.study}/bloodwork.csv`), (f) => `Downloaded ${f.name}`));
}
