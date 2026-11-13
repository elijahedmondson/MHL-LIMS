// Whole-slide imaging: the scan queue (MHL numbers in the Scan area, with the scanner and magnification to use),
// registering images from the scanners' output (files, a folder, or the server reading the folders), review with pass
// or rescan, the four scanners, and one image's page. File headers are read in the browser by /lib/wsi.mjs; the
// images themselves are never uploaded or copied.
import { $, $$, api, esc, fmtDate, fmtDateTime, getMeta, act, pageTop, options, toast } from '../ui.js';
import { readSlideFile, IMAGE_EXTENSIONS, afiChannelFiles, showBytes } from '../lib/wsi.mjs';

const STATUS = { TO_REVIEW: ['warn', 'To review'], UNMATCHED: ['warn', 'Unmatched'], PASSED: ['complete', 'Passed'], RESCAN: ['stat', 'Rescan'] };
const badge = (s) => `<span class="badge ${STATUS[s]?.[0] || ''}">${STATUS[s]?.[1] || esc(s)}</span>`;
const slideText = (x) => [x.block && `block ${x.block}`, x.slide && `slide ${x.slide}`, x.stain].filter(Boolean).join(', ');
const TABS = [['queue', 'Scan queue'], ['review', 'To review'], ['import', 'Register images'], ['scanners', 'Scanners'], ['recent', 'Reviewed']];

function imagesTable(rows, { unmatched = false } = {}) {
  if (!rows.length) return '<p class="empty">None.</p>';
  return `<table class="t"><thead><tr><th>${unmatched ? 'File' : 'MHL#'}</th><th>${unmatched ? 'Why it did not match' : 'Slide'}</th><th>Scanner</th><th>Scanned</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map((x) => `<tr class="click" data-href="#/wsi/image/${x.id}">
      <td class="${unmatched ? '' : 'code'}">${unmatched ? esc(x.fileName) : `${esc(x.phl || '')}${x.zap ? `<br><span class="small muted">${esc(x.zap)}</span>` : ''}`}</td>
      <td class="small">${unmatched ? 'No MHL number in the barcode or file name' : `${esc(slideText(x) || x.label || '')}<br><span class="muted">${esc(x.fileName)}</span>`}</td>
      <td class="small">${esc(x.scannerName)}${x.scannerStated ? '' : ' <span class="badge" title="The file did not say which scanner; check it on the image page">?</span>'}<br><span class="muted">${x.format}${x.mag ? `, ${x.mag}x` : ''}${x.channels ? `, ${x.channels} channels` : ''}</span></td>
      <td class="small">${fmtDate(x.scannedOn)} ${esc(x.scannedAt)}</td><td>${badge(x.status)}${x.reasons.length ? `<br><span class="small muted">${esc(x.reasons.join(', '))}</span>` : ''}</td>
      <td><a class="btn small quiet" href="#/wsi/image/${x.id}">${x.status === 'UNMATCHED' ? 'Assign' : x.status === 'TO_REVIEW' ? 'Review' : 'Open'}</a></td></tr>`).join('')}
  </tbody></table>`;
}

export async function renderWsi(app, tab = 'queue') {
  const [home, meta] = await Promise.all([api('GET', '/api/wsi'), getMeta()]);
  const counts = { review: home.toReview.length + home.unmatched.length, queue: home.queue.reduce((n, q) => n + q.subjects.length, 0) };
  app.innerHTML = `
    <h1>Whole-slide imaging</h1>
    <p class="muted">Slides are scanned on the Aperio AT2, Aperio GT 450, Aperio FL and Akoya PhenoImager HT. Each scanner reads the slide's barcode label and saves an image file; the LIMS reads those files' headers to register each image against its MHL number, then the image is checked and passed (which creates the scan charge) or sent back for rescanning.</p>
    <nav class="subtabs" aria-label="WSI sections">${TABS.map(([k, l]) => `<a href="#/wsi/${k}" ${k === tab ? 'aria-current="page"' : ''}>${l}${counts[k] ? ` <span class="count">${counts[k]}</span>` : ''}</a>`).join('')}</nav>
    <div id="wsi" class="section"></div>`;
  pageTop(app);
  const box = $('#wsi');
  if (tab === 'review') {
    box.innerHTML = `<h2>To review</h2><p class="small muted">Open each image in the viewer, check focus, tissue coverage and the label, then pass it or send the slide for rescanning.</p>${imagesTable(home.toReview)}
      <h2 class="section">Images without an MHL number</h2><p class="small muted">Usually an unreadable barcode or a file named by hand. Open the image and assign it.</p>${imagesTable(home.unmatched, { unmatched: true })}`;
  } else if (tab === 'import') importTab(box, home);
  else if (tab === 'scanners') scannersTab(box, home);
  else if (tab === 'recent') {
    box.innerHTML = `<h2>Reviewed</h2>${imagesTable(home.recent)}
      <h2 class="section">Registrations</h2><table class="t"><thead><tr><th>From</th><th>When</th><th>By</th><th class="n">Images</th><th class="n">Already registered</th></tr></thead><tbody>
      ${home.runs.map((r) => `<tr><td>${esc(r.label)}</td><td class="small">${fmtDateTime(r.importedAt)}</td><td>${esc(r.importedBy)}</td><td class="n">${r.count}</td><td class="n">${r.skipped || ''}</td></tr>`).join('')}</tbody></table>`;
  } else queueTab(box, home, meta);
  $$('tr.click', box).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a,button,input,label')) location.hash = tr.dataset.href; }));
}

// ---------- queue ----------
function queueTab(box, home, meta) {
  const name = (id) => home.scanners.find((s) => s.id === id)?.name || id;
  const sel = new Set();
  box.innerHTML = home.queue.length ? `
    <p class="small muted">MHL numbers waiting in the Scan area, by request. The scanner and magnification come from the request: fluorescent stains go to the PhenoImager HT (Opal) or the Aperio FL, brightfield at 40x to the GT 450 and at 20x to the AT2.</p>
    ${home.queue.map((q) => `
      <div class="panel section">
        <div class="row"><h3 style="margin:0"><a href="#/request/${q.requestId}">${esc(q.number)}</a> <span class="muted small">${esc(q.pi)}, ${esc(q.type)}${q.zap ? `, ${esc(q.zap)}` : ''}</span></h3><span class="spacer"></span>
          <span class="badge info">${esc(name(q.scanner))}</span> <span class="badge">${q.mag}x</span>${q.fluorescent ? ' <span class="badge k-opal">fluorescent</span>' : ''} <span class="small muted">Due ${fmtDate(q.due)}</span></div>
        ${q.stains.length ? `<p class="small muted">Stains: ${esc(q.stains.join(', '))}${q.ihcNumber ? ` (${esc(q.ihcNumber)})` : ''}</p>` : ''}
        <table class="t"><thead><tr><th><span hidden>Select</span></th><th>MHL#</th><th>Animal or sample</th><th>In Scan since</th><th class="n">Passed</th><th class="n">To review</th><th class="n">Rescan</th>${q.expectedPer ? '<th class="n">Expected</th>' : ''}</tr></thead><tbody>
          ${q.subjects.map((s) => `<tr><td><input type="checkbox" data-sel="${s.id}" aria-label="Select ${esc(s.phl)}"></td><td class="code">${esc(s.phl)}${s.priority === 'S' ? ' <span class="badge stat">STAT</span>' : ''}</td><td>${esc(s.label)}</td>
            <td class="small">${fmtDate(s.since)}</td><td class="n">${s.passed || ''}</td><td class="n">${s.toReview ? `<span class="badge warn">${s.toReview}</span>` : ''}</td><td class="n">${s.rescan ? `<span class="badge stat">${s.rescan}</span>` : ''}</td>
            ${q.expectedPer ? `<td class="n small muted">about ${q.expectedPer}</td>` : ''}</tr>`).join('')}
        </tbody></table>
      </div>`).join('')}
    <div class="actions noprint"><button class="btn quiet" type="button" id="print">Print scan list</button><button class="btn" type="button" id="done">Scanning done: move on</button></div>
    <p class="small muted noprint">Expected is the number of scans in the estimate divided by the MHL numbers on the request. Scanning done moves the selected MHL numbers to the next work area.</p>
    <div id="scanlist" class="print-only"></div>`
    : '<p class="empty">Nothing is waiting for scanning. MHL numbers appear here when they are moved to the Scan area.</p>';
  $$('[data-sel]', box).forEach((c) => c.addEventListener('change', () => { if (c.checked) sel.add(Number(c.dataset.sel)); else sel.delete(Number(c.dataset.sel)); }));
  const picked = () => (sel.size ? [...sel] : home.queue.flatMap((q) => q.subjects.map((s) => s.id)));
  $('#print')?.addEventListener('click', () => {
    const ids = new Set(picked());
    $('#scanlist').innerHTML = `<h2>Scan list ${fmtDate(meta.today)}</h2>${home.queue.map((q) => {
      const subs = q.subjects.filter((s) => ids.has(s.id));
      return subs.length ? `<h3>${esc(q.number)}: ${esc(name(q.scanner))}, ${q.mag}x${q.fluorescent ? ', fluorescent' : ''}</h3><table class="t"><thead><tr><th>Done</th><th>MHL#</th><th>Animal or sample</th><th>Slides</th><th>Notes</th></tr></thead><tbody>
        ${subs.map((s) => `<tr><td class="tick"><span class="box"></span></td><td class="code">${esc(s.phl)}</td><td>${esc(s.label)}</td><td>${q.expectedPer ? `about ${q.expectedPer}` : ''}</td><td></td></tr>`).join('')}</tbody></table>` : '';
    }).join('')}`;
    window.print();
  });
  $('#done')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    if (!sel.size) { toast('Select the MHL numbers that are finished.', 'error'); return; }
    try { await api('POST', '/api/wsi/complete', { subjectIds: [...sel] }); }
    catch (err) {
      if (!/no passed slide image/.test(err.message) || !confirm(`${err.message}\n\nMove on anyway?`)) throw err;
      await api('POST', '/api/wsi/complete', { subjectIds: [...sel], force: true, note: 'Confirmed on the scan queue' });
    }
    await getMeta(true); await renderWsi(document.querySelector('#app'), 'queue');
    toast('Moved on to the next work area');
  }));
}

// ---------- registering images ----------
let folderHandle = null;
const fileReaderOf = (f) => ({ size: f.size, readAt: async (o, l) => new Uint8Array(await f.slice(o, Math.min(f.size, o + l)).arrayBuffer()) });

// Reads the headers of the image files in a list of { file, path }. Channel .svs files listed by an .afi are part of
// that image and are not registered on their own.
async function readHeaders(entries, known, progress) {
  const byName = new Map(entries.map((e) => [e.file.name.toLowerCase(), e]));
  const referenced = new Set(); const out = []; let skipped = 0; let done = 0;
  for (const e of entries.filter((x) => /\.afi$/i.test(x.file.name))) for (const n of afiChannelFiles(await e.file.text())) referenced.add(n.toLowerCase());
  const images = entries.filter((e) => IMAGE_EXTENSIONS.includes((e.file.name.match(/\.[^.]+$/) || [''])[0].toLowerCase()) && !referenced.has(e.file.name.toLowerCase()));
  for (const e of images) {
    progress(++done, images.length);
    if (known.has(`${(e.path || e.file.name).toLowerCase()}|${e.file.size}`)) { skipped++; continue; }
    try {
      const info = await readSlideFile({ name: e.file.name, size: e.file.size, readAt: fileReaderOf(e.file).readAt, readText: () => e.file.text(),
        resolve: async (n) => { const g = byName.get(String(n).split(/[\\/]/).pop().toLowerCase()); if (!g) return null; referenced.add(g.file.name.toLowerCase()); return fileReaderOf(g.file); } });
      for (const n of info.refers || []) referenced.add(String(n).split(/[\\/]/).pop().toLowerCase());
      out.push({ ...info, path: e.path || '' });
    } catch (err) { out.push({ fileName: e.file.name, format: 'UNREADABLE', sizeBytes: e.file.size }); }
  }
  return { files: out.filter((f) => !referenced.has(f.fileName.toLowerCase())), skipped, ignored: entries.length - images.length };
}

async function walkDirectory(handle, prefix = '', depth = 0, out = []) {
  for await (const entry of handle.values()) {
    const p = `${prefix}${handle.name}\\`;
    if (entry.kind === 'file') out.push({ file: await entry.getFile(), path: `${p}${entry.name}` });
    else if (entry.kind === 'directory' && depth < 4) await walkDirectory(entry, p, depth + 1, out);
  }
  return out;
}

function importTab(box, home) {
  const server = !window.MHL_LOCAL;
  const canPick = typeof window.showDirectoryPicker === 'function';
  box.innerHTML = `
    <div class="split even">
      <div class="panel">
        <h2>From a scanner's output folder</h2>
        <p class="small">Choose the folder a scanner saves to (for example the GT 450's image share). Every .svs, .afi and .qptiff in it and its subfolders is read; images already registered are skipped, so a folder can be read again after each run. Only the start of each file is read, so large images are quick.</p>
        <div class="field"><label for="wscan">Scanner</label><select id="wscan">${options([['', 'Work it out from each file'], ...home.scanners.map((s) => [s.id, s.name])], '')}</select></div>
        <div class="actions">${canPick ? `<button class="btn" type="button" id="pick">Choose a folder</button>${folderHandle ? `<button class="btn quiet" type="button" id="again">Read ${esc(folderHandle.name)} again</button>` : ''}`
          : '<label class="btn" for="wdir">Choose a folder</label><input id="wdir" type="file" webkitdirectory multiple hidden>'}</div>
        <h3 class="section">Or choose files</h3>
        <input type="file" id="wfiles" multiple accept="${IMAGE_EXTENSIONS.join(',')}" aria-label="Slide image files">
        <p class="small muted">For an Aperio FL image, choose the .afi together with its channel .svs files. Sample files are in the pilot's <code>samples/scanners</code> folder.</p>
        <div id="wres" class="section" aria-live="polite"></div>
      </div>
      <div>
        ${server ? `<div class="panel"><h2>Read the scanner folders</h2>
          <p class="small">The pilot server reads the output folder set for each scanner under Scanners and registers new images. Files changed in the last two minutes are left until the next read, in case the scanner is still writing them.</p>
          <ul class="small">${home.scanners.map((s) => `<li>${esc(s.name)}: <code>${esc(s.folder || 'no folder set')}</code></li>`).join('')}</ul>
          <div class="actions"><button class="btn quiet" type="button" id="readsrv" ${home.scanners.some((s) => s.folder) ? '' : 'disabled'}>Read new images</button></div></div>` : ''}
        <div class="panel ${server ? 'section' : ''}"><h2>How images are matched</h2>
          <p class="small">The MHL number is looked for in the barcode the scanner read, then in the slide ID and the file name. Slide labels printed by the LIMS read like <code>26000305A-B2-S01</code>: MHL number, block 2, slide 1; anything after (H&amp;E, CD8) is kept as the stain. An image whose barcode was unreadable waits under To review until someone assigns it.</p>
          <p class="small">The scanner comes from the instrument ID in the file (set each scanner's IDs under Scanners), then the model the file states, then your choice here, then a guess from the file type. If your choice disagrees with the file, the image says so.</p></div>
      </div>
    </div>`;
  const out = $('#wres');
  const send = async (entries, label, source) => {
    out.innerHTML = '<p class="small muted">Reading…</p>';
    const { keys } = await api('GET', '/api/wsi/known');
    const { files, skipped, ignored } = await readHeaders(entries, new Set(keys), (i, n) => { out.innerHTML = `<p class="small muted">Reading ${i} of ${n}…</p>`; });
    if (!files.length) { out.innerHTML = `<p class="small">No new images${skipped ? `: ${skipped} already registered` : ''}${ignored ? `; ${ignored} other files ignored` : ''}.</p>`; return; }
    const res = await api('POST', '/api/wsi/register', { source, label, scannerId: $('#wscan').value, files });
    await getMeta(true);
    out.innerHTML = `<p class="small"><strong>${res.imported} registered</strong> (${res.matched} matched to MHL numbers${res.unmatched ? `, <a href="#/wsi/review">${res.unmatched} without an MHL number</a>` : ''})${res.duplicates + skipped ? `, ${res.duplicates + skipped} already registered` : ''}${res.unreadable ? `, ${res.unreadable} could not be read` : ''}${ignored ? `, ${ignored} other files ignored` : ''}.</p>
      ${res.results.length ? `<ul class="small">${res.results.slice(0, 20).map((x) => `<li><a href="#/wsi/image/${x.id}">${esc(x.fileName)}</a>: ${x.phl ? `${esc(x.phl)}${slideText(x) ? `, ${esc(slideText(x))}` : ''}` : '<span class="fitnote">no MHL number</span>'} · ${esc(x.scannerName)}</li>`).join('')}</ul>` : ''}`;
  };
  $('#wfiles').addEventListener('change', (e) => act(null, async () => { await send([...e.target.files].map((file) => ({ file, path: '' })), `${e.target.files.length} chosen file${e.target.files.length === 1 ? '' : 's'}`, 'files'); e.target.value = ''; }));
  $('#pick')?.addEventListener('click', () => act(null, async () => {
    try { folderHandle = await window.showDirectoryPicker({ mode: 'read' }); } catch (err) { if (err.name === 'AbortError') return; throw err; }
    await send(await walkDirectory(folderHandle), `Folder ${folderHandle.name}`, 'folder');
    importTab(box, home);
  }));
  $('#again')?.addEventListener('click', () => act(null, () => walkDirectory(folderHandle).then((entries) => send(entries, `Folder ${folderHandle.name}`, 'folder'))));
  $('#wdir')?.addEventListener('change', (e) => act(null, () => send([...e.target.files].map((file) => ({ file, path: file.webkitRelativePath.replace(/\//g, '\\') })), 'Chosen folder', 'folder')));
  $('#readsrv')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await api('POST', '/api/wsi/read-folders', {});
    await getMeta(true);
    out.innerHTML = res.scanners.map((r) => `<p class="small"><strong>${esc(r.scanner)}</strong>: ${r.error ? `<span class="fitnote">${esc(r.error)}</span>` : `${r.imported || 0} registered${r.unmatched ? ` (${r.unmatched} without an MHL number)` : ''}${r.duplicates ? `, ${r.duplicates} already registered` : ''}${r.recent ? `, ${r.recent} still being written` : ''}${r.errors ? `, ${r.errors} could not be read` : ''}`}</p>`).join('') || '<p class="small muted">No scanner has a folder set.</p>';
  }));
}

// ---------- scanners ----------
function scannersTab(box, home) {
  const server = !window.MHL_LOCAL;
  box.innerHTML = `<div class="scanners">${home.scanners.map((s) => `
    <form class="panel form" data-scanner="${s.id}" style="grid-template-columns:1fr 1fr">
      <div class="full row"><h3 style="margin:0">${esc(s.name)}</h3><span class="spacer"></span><span class="badge ${s.status === 'Available' ? 'complete' : s.status === 'In use' ? 'info' : 'warn'}">${esc(s.status)}</span></div>
      <p class="full small muted" style="margin:0">${esc(s.about)} ${esc(s.modes.join(', '))}; ${s.mags.map((m) => `${m}x`).join(', ')}.</p>
      <div class="field"><label for="st-${s.id}">Status</label><select id="st-${s.id}" data-f="status">${options(['Available', 'In use', 'Maintenance', 'Out of service'], s.status)}</select></div>
      <div class="field"><label for="se-${s.id}">Instrument IDs in its files</label><input id="se-${s.id}" data-f="serials" value="${esc(s.serials.join(', '))}" placeholder="ScanScope ID, serial or computer name"></div>
      <div class="field full"><label for="fo-${s.id}">Output folder${server ? '' : ' (used by the server version)'}</label><input id="fo-${s.id}" data-f="folder" value="${esc(s.folder)}" placeholder="e.g. S:\\Scans\\${esc(s.id)}"></div>
      <div class="field full"><label for="no-${s.id}">Notes</label><input id="no-${s.id}" data-f="notes" value="${esc(s.notes)}" maxlength="500"></div>
      <div class="full row"><span class="small muted">${s.toReview ? `${s.toReview} to review · ` : ''}${s.lastScan.trim() ? `last image ${esc(s.lastScan)}` : 'no images registered yet'}</span><span class="spacer"></span><button class="btn small quiet" type="submit">Save</button></div>
    </form>`).join('')}</div>
    <p class="small muted section">Instrument IDs: the Aperio files carry a ScanScope ID, and PhenoImager HT files a computer name. With them set, each image is put on the right scanner even when files are read from a shared folder. The IDs shown in the pilot are examples that match the sample files.</p>`;
  $$('form[data-scanner]', box).forEach((f) => f.addEventListener('submit', (e) => {
    e.preventDefault();
    const body = Object.fromEntries($$('[data-f]', f).map((el) => [el.dataset.f, el.value]));
    act(e.submitter, async () => { await api('PUT', `/api/wsi/scanners/${f.dataset.scanner}`, body); await getMeta(true); await renderWsi(document.querySelector('#app'), 'scanners'); }, 'Scanner saved');
  }));
}

// ---------- one image ----------
export async function renderWsiImage(app, id) {
  const meta = await getMeta();
  const d = await api('GET', `/api/wsi/images/${id}`);
  const x = d.image;
  const open = x.status === 'TO_REVIEW' || x.status === 'UNMATCHED';
  app.innerHTML = `
    <p class="crumb"><a href="#/wsi/review">Whole-slide imaging</a></p>
    <div class="head"><h1 class="code">${esc(x.fileName)}</h1>${badge(x.status)}</div>
    <div class="facts"><span>${esc(x.scannerName)}${x.scannerStated ? '' : ' (not stated in the file)'}</span><span>${esc(x.format)}</span>${x.mag ? `<span>${x.mag}x</span>` : ''}${x.mpp ? `<span>${x.mpp} µm/pixel</span>` : ''}
      ${x.width && x.height ? `<span>${x.width.toLocaleString('en-US')} × ${x.height.toLocaleString('en-US')} px</span>` : ''}${x.sizeBytes ? `<span>${showBytes(x.sizeBytes)}</span>` : ''}<span>Scanned ${fmtDate(x.scannedOn)} ${esc(x.scannedAt)}</span>
      ${x.serial ? `<span>Instrument ${esc(x.serial)}</span>` : ''}${x.operator ? `<span>Operator ${esc(x.operator)}</span>` : ''}</div>
    ${d.subject ? `<p>Slide: <strong class="code">${esc(d.subject.phl)}</strong> ${esc(slideText(x))} · ${esc(d.subject.label)} · <a href="#/request/${d.request.id}/images">${esc(d.request.number)}</a> ${esc(d.request.piName)}
      <span class="small muted">(found in the ${esc(x.idFrom)} “${esc(x.idText)}”)</span></p>` : '<p class="note">No MHL number was found in the barcode, slide ID or file name. Assign it below.</p>'}
    ${x.status === 'PASSED' ? `<div class="locked">Passed by ${esc(x.qc.by)} on ${fmtDateTime(x.qc.at)}.${d.charge ? ` Charge ${esc(d.charge.code)} ${esc(d.charge.codeDescription)} (${d.charge.status.toLowerCase()}).` : ' No charge (no-charge request).'}${x.qc.note ? `<br>${esc(x.qc.note)}` : ''}</div>` : ''}
    ${x.status === 'RESCAN' ? `<div class="note">Sent for rescanning by ${esc(x.qc.by)} on ${fmtDateTime(x.qc.at)}: ${esc(x.qc.reasons.join(', '))}${x.qc.note ? `. ${esc(x.qc.note)}` : ''}</div>` : ''}
    <div class="split wide-left section">
      <div>
        <dl class="dl wide">
          <dt>File</dt><dd>${x.path ? `<code>${esc(x.path)}</code> <button class="btn small quiet" type="button" id="copy">Copy path</button>` : esc(x.fileName)}</dd>
          <dt>Barcode</dt><dd>${esc(x.barcode) || '<span class="muted">not in the file</span>'}</dd>
          ${x.slideId ? `<dt>Slide ID</dt><dd>${esc(x.slideId)}</dd>` : ''}${x.internalName ? `<dt>Name in the file</dt><dd>${esc(x.internalName)}</dd>` : ''}
          <dt>Label and overview</dt><dd>${x.format === 'QPTIFF' || x.format === 'AFI' ? '<span class="muted">Not read for this file type</span>' : `${x.hasLabel ? 'Label image' : 'No label image'}${x.hasMacro ? ', slide overview' : ''}`}</dd>
          <dt>Viewer link</dt><dd><form id="lform" class="pair"><input id="link" value="${esc(x.link)}" placeholder="HALO Link or eSlide Manager address" aria-label="Viewer link"><button class="btn small quiet" type="submit">Save</button></form>
            ${x.link ? `<a href="${esc(x.link)}" target="_blank" rel="noopener noreferrer">Open in the viewer</a>` : '<span class="small muted">Open the file in ImageScope, Phenochart or HALO from its path.</span>'}</dd>
        </dl>
        ${x.channels.length ? (() => {
          const has = (k) => x.channels.some((c) => c[k]);
          return `<h2 class="section">Channels</h2><table class="t"><thead><tr><th>Channel</th>${has('biomarker') ? '<th>Marker</th>' : ''}${has('exposure') ? '<th>Exposure</th>' : ''}${has('file') ? '<th>File</th>' : ''}</tr></thead><tbody>
            ${x.channels.map((c) => `<tr><td>${esc(c.name)}</td>${has('biomarker') ? `<td>${esc(c.biomarker || '')}</td>` : ''}${has('exposure') ? `<td>${esc(c.exposure || '')}</td>` : ''}${has('file') ? `<td class="small">${esc(c.file || '')}</td>` : ''}</tr>`).join('')}</tbody></table>`;
        })() : ''}
        ${x.warnings.length ? x.warnings.map((w) => `<p class="note small">${esc(w)}</p>`).join('') : ''}
        ${x.description ? `<details class="section"><summary>What the scanner wrote in the file</summary><pre class="code">${esc(x.description)}</pre></details>` : ''}
      </div>
      <div>
        ${open ? `<h2>${x.status === 'UNMATCHED' ? 'Assign to a slide' : 'Wrong slide?'}</h2>
          <form class="form" id="assign" style="grid-template-columns:2fr 1fr 1fr"><div class="field"><label for="aphl">MHL# or slide ID</label><input id="aphl" value="${esc(d.subject?.phl || '')}" placeholder="26000305A-B2-S01" style="text-transform:uppercase"></div>
            <div class="field"><label for="ablk">Block</label><input id="ablk" value="${esc(x.block)}" maxlength="6"></div><div class="field"><label for="asl">Slide</label><input id="asl" value="${esc(x.slide)}" maxlength="6"></div>
            <div class="full"><button class="btn ${x.status === 'UNMATCHED' ? '' : 'quiet'} small" type="submit">Assign</button></div></form>
          <div class="field section"><label for="wsc">Scanner</label><select id="wsc">${options(d.scanners.map((s) => [s.id, s.name]), x.scannerId)}</select></div>` : ''}
        ${x.status === 'TO_REVIEW' ? `
          <h2 class="section">Quality check</h2>
          <p class="small">Passing creates <strong>${esc(d.plannedCharge.code)}</strong> ${esc(d.plannedCharge.description)}${d.request?.chargeType === 'C' ? '' : ' (not on a no-charge request)'}.${d.plannedCharge.assumption ? ` <span class="muted">${esc(d.plannedCharge.assumption)}</span>` : ''}</p>
          <div class="field"><label for="qnote">Note (optional)</label><input id="qnote" maxlength="500"></div>
          <div class="actions"><button class="btn" type="button" id="pass">Pass</button></div>
          <h3 class="section">Or send for rescanning</h3>
          <div class="checks" style="flex-direction:column;align-items:flex-start">${meta.wsi.rescanReasons.map((r) => `<label><input type="checkbox" data-reason="${esc(r)}"> ${esc(r)}</label>`).join('')}</div>
          <div class="actions"><button class="btn quiet" type="button" id="rescan">Rescan</button></div>` : ''}
        ${x.status === 'PASSED' || x.status === 'RESCAN' ? '<div class="actions"><button class="btn quiet" type="button" id="reopen">Reopen</button></div>' : ''}
        ${d.others.length ? `<h2 class="section">Other images of ${esc(d.subject.phl)}</h2><ul class="small">${d.others.map((o) => `<li><a href="#/wsi/image/${o.id}">${esc(o.fileName)}</a> ${badge(o.status)}</li>`).join('')}</ul>` : ''}
        <h2 class="section">History</h2><ul class="small muted">${x.history.slice().reverse().map((h) => `<li>${fmtDateTime(h.at)} ${esc(h.by)}: ${esc(h.action)}</li>`).join('')}</ul>
      </div>
    </div>`;
  pageTop(app);
  const reload = () => renderWsiImage(app, id);
  $('#copy')?.addEventListener('click', async () => { try { await navigator.clipboard.writeText(x.path); toast('Path copied'); } catch { toast('Copy the path from the box.', 'error'); } });
  $('#lform').addEventListener('submit', (e) => { e.preventDefault(); act(null, async () => { await api('POST', `/api/wsi/images/${id}/link`, { link: $('#link').value }); await reload(); }, 'Link saved'); });
  $('#assign')?.addEventListener('submit', (e) => { e.preventDefault(); act(e.submitter, async () => { await api('POST', `/api/wsi/images/${id}/assign`, { phl: $('#aphl').value, block: $('#ablk').value, slide: $('#asl').value }); await getMeta(true); await reload(); }, 'Assigned'); });
  $('#wsc')?.addEventListener('change', (e) => act(null, async () => { await api('POST', `/api/wsi/images/${id}/scanner`, { scannerId: e.target.value }); await reload(); }, 'Scanner set'));
  $('#pass')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/wsi/images/${id}/pass`, { note: $('#qnote').value }); await getMeta(true); await reload(); }, 'Passed'));
  $('#rescan')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const reasons = $$('[data-reason]:checked', app).map((c) => c.dataset.reason);
    await api('POST', `/api/wsi/images/${id}/rescan`, { reasons, note: $('#qnote').value }); await getMeta(true); await reload();
  }, 'Sent for rescanning'));
  $('#reopen')?.addEventListener('click', (e) => act(e.currentTarget, async () => { const reason = prompt('Why reopen it?'); if (!reason) return; await api('POST', `/api/wsi/images/${id}/reopen`, { reason }); await getMeta(true); await reload(); }, 'Reopened'));
}

// The request page's Slide images tab.
export function requestImagesHtml(d) {
  const by = d.subjects.map((s) => ({ s, imgs: d.images.filter((x) => x.subjectId === s.id) }));
  return `<div class="row"><p class="muted" style="margin:0">Slide images registered from the scanners for each MHL number.</p><span class="spacer"></span><a class="btn small quiet" href="#/wsi">Whole-slide imaging</a></div>
    <table class="t section"><thead><tr><th>MHL#</th><th>Animal or sample</th><th>Images</th></tr></thead><tbody>
    ${by.map(({ s, imgs }) => `<tr><td class="code">${esc(s.phl)}</td><td>${esc(s.label)}</td><td>${imgs.length ? imgs.map((x) => `<a href="#/wsi/image/${x.id}">${esc(slideText(x) || x.fileName)}</a> <span class="small muted">${esc(x.scannerName)}${x.mag ? ` ${x.mag}x` : ''}</span> ${badge(x.status)}`).join('<br>') : '<span class="muted">—</span>'}</td></tr>`).join('')}
    </tbody></table>`;
}
