// Outside IHC sources: the "Outside sources" section of an assay page (identifiers, links to the six sources, HPA data,
// saved pages) and Molecular > Outside sources (what each source allows, importing the HPA and Antibody Registry
// files, and reviewing suggested gene symbols and RRIDs in bulk). The rules are in core/outside.mjs.
import { $, $$, api, esc, fmtDate, fmtDateTime, act, pageTop, options, toast, getMeta } from '../ui.js';
import { ihcTabs } from './ihcviews.js';
import { SOURCES, OTHER_SOURCE, readTextChunks, lineSplitter, csvSplitter, hpaReader, registryReader } from '../lib/outside.mjs';

const safeUrl = (u) => (/^https?:\/\//i.test(String(u || '')) ? String(u) : '');
const ext = (url, label) => (safeUrl(url) ? `<a href="${esc(safeUrl(url))}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label));
const useBadge = (use) => (use === 'import' ? '<span class="badge complete" title="Open data: its files can be imported">Import</span>' : '<span class="badge muted" title="Its terms allow linking, not copying">Link only</span>');
const RELIABILITY = {
  Enhanced: 'at least one antibody passed the HPA\'s enhanced validation (such as genetic or independent-antibody methods)',
  Supported: 'the staining agrees with RNA data and what is published',
  Approved: 'the staining partly agrees with RNA data or what is published',
  Uncertain: 'the staining disagrees with RNA data or what is published, or little is known',
};
const relText = (r) => (r ? `<strong>${esc(r)}</strong>${RELIABILITY[r] ? ` <span class="small muted">(${esc(RELIABILITY[r])})</span>` : ''}` : '<span class="muted">Not given</span>');

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall back below */ }
  const t = Object.assign(document.createElement('textarea'), { value: text });
  t.style.cssText = 'position:fixed;left:-10000px;top:0'; document.body.appendChild(t); t.select();
  let ok = false;
  try { ok = document.execCommand('copy'); } catch { ok = false; }
  t.remove();
  return ok;
}

// ---------- the section on an assay page ----------

export function assayOutsideHtml(a, o) {
  const notRecorded = '<span class="muted">Not recorded</span>';
  const suggest = (field, list) => list.map((c) => `<button class="chip" type="button" data-use="${field}" data-value="${esc(c.symbol || c.rrid)}" title="${esc(c.why)}">Use ${esc(c.symbol || c.rrid)}</button>
    <span class="small muted">${esc(c.why)}${c.vendor && field === 'rrid' && !/^HPA antibody/.test(c.why) ? `: ${esc(c.vendor)} ${esc(c.catalog)}${c.clone ? `, clone ${esc(c.clone)}` : ''}${c.name ? ` (${esc(c.name)})` : ''}` : ''}</span>`).join('<br>');
  const ids = o.single ? `
    <dl class="dl wide">
      <dt>Target gene</dt><dd>${o.target ? `<strong>${esc(o.target)}</strong>${o.target === 'N/A' ? ' <span class="small muted">(a tag or reagent: no gene)</span>' : ''}` : notRecorded}
        ${o.targetNotInHpa ? '<br><span class="small muted">Not in the imported HPA data. Import proteinatlas.tsv again (Outside sources) to pick it up, or check the symbol.</span>' : ''}
        ${o.targetSuggestions.length ? `<div class="small" style="margin-top:4px">${suggest('target', o.targetSuggestions)}</div>` : ''}</dd>
      <dt>UniProt</dt><dd>${o.uniprot ? esc(o.uniprot) : notRecorded}${o.uniprotFromHpa ? `<div class="small" style="margin-top:4px"><button class="chip" type="button" data-use="uniprot" data-value="${esc(o.uniprotFromHpa)}">Use ${esc(o.uniprotFromHpa)}</button> <span class="muted">from the HPA (human protein)</span></div>` : ''}</dd>
      <dt>RRID</dt><dd>${o.rrid ? (o.rrid === 'N/A' ? 'N/A <span class="small muted">(no RRID exists)</span>' : `${ext(`https://www.antibodyregistry.org/${o.rrid}`, `RRID:${o.rrid}`)} <span class="small muted">cite as “${esc(a.manufacturer || 'Vendor')} Cat# ${esc(String(a.catalog || '').replace(/\s*\([^)]*\)/g, '').trim())}, RRID:${esc(o.rrid)}”</span>`) : notRecorded}
        ${o.rridSuggestions.length ? `<div class="small" style="margin-top:4px">${suggest('rrid', o.rridSuggestions)}</div>` : !o.rrid && !o.registryLoaded ? '<br><span class="small muted">Import the Antibody Registry list (Outside sources) to have RRIDs suggested, or look it up with the link opposite.</span>' : ''}</dd>
    </dl>
    <div class="actions" style="margin-top:10px"><button class="btn quiet small" type="button" id="ids-edit">Edit identifiers</button></div>
    <form class="form" id="ids-form" hidden style="margin-top:12px">
      <div class="field"><label for="i-target">Target gene (human symbol, e.g. MKI67)</label><input id="i-target" value="${esc(o.target)}" maxlength="20" autocomplete="off" placeholder="MKI67, PTPRC, CD8A"><span class="small muted">The mouse symbol (Mki67) works too. N/A for a tag or reagent.</span></div>
      <div class="field"><label for="i-rrid">RRID</label><input id="i-rrid" value="${esc(o.rrid)}" maxlength="80" autocomplete="off" placeholder="AB_2722"><span class="small muted">AB_…, RRID:AB_…, or the registry address. N/A if none exists.</span></div>
      <div class="field"><label for="i-uniprot">UniProt accession(s)</label><input id="i-uniprot" value="${esc(o.uniprot)}" maxlength="60" autocomplete="off" placeholder="P46013"></div>
      <div class="field full actions" style="margin-top:0"><button class="btn small" type="submit">Save identifiers</button><button class="btn quiet small" type="button" id="ids-cancel">Cancel</button></div>
    </form>`
    : '<p class="small muted">This protocol uses several antibodies. Record the gene, RRID and UniProt on each single-stain protocol; pages about the panel can still be saved below.</p>';

  const h = o.hpa;
  const g = h?.gene; const tis = h?.tissue;
  const hpa = h ? `
    <div class="panel section">
      <h3>Human Protein Atlas: ${esc(g?.gene || tis?.gene || '')}</h3>
      ${h.notHuman ? '<p class="note" style="margin-top:0">This protocol is listed for non-human tissue. The HPA stains human tissue, so this shows where the human protein is found: a guide to control tissues, not evidence that this antibody works.</p>' : ''}
      <dl class="dl wide">
        ${g ? `${g.description ? `<dt>Protein</dt><dd>${esc(g.description)}</dd>` : ''}
        <dt>IHC reliability</dt><dd>${relText(g.reliabilityIH)}</dd>
        ${g.reliabilityIF ? `<dt>IF reliability</dt><dd>${relText(g.reliabilityIF)}</dd>` : ''}
        ${g.evidence ? `<dt>Protein evidence</dt><dd>${esc(g.evidence)}</dd>` : ''}
        ${g.tissueSpecificity ? `<dt>RNA in tissues</dt><dd>${esc(g.tissueSpecificity)}${g.tissueNtpm ? `<br><span class="small muted">${esc(g.tissueNtpm)}</span>` : ''}</dd>` : ''}
        ${g.antibodies?.length ? `<dt>HPA antibodies</dt><dd class="small">${g.antibodies.map((x) => `${esc(x.id)}${x.rrid ? ` (${ext(`https://www.antibodyregistry.org/${x.rrid}`, `RRID:${x.rrid}`)})` : ''}`).join(', ')}</dd>` : ''}` : ''}
        <dt>Normal tissue IHC</dt><dd class="small">${tis?.rows?.length ? ['High', 'Medium', 'Low'].map((lv) => { const r = tis.rows.filter((x) => x.level === lv); return r.length ? `<strong>${lv}:</strong> ${r.map((x) => esc(`${x.tissue} (${x.cell})`)).join('; ')}` : ''; }).filter(Boolean).join('<br>')
          + (tis.reliability ? `<br><span class="muted">Reliability ${esc(tis.reliability)}</span>` : '') : tis ? 'Not detected in the tissues the HPA stained.' : o.hpaTissueLoaded ? '<span class="muted">Not in the imported normal tissue data.</span>' : '<span class="muted">Import normal_tissue.tsv (Outside sources) to see where it stains, as a guide to control tissue.</span>'}</dd>
      </dl>
      <p class="small muted" style="margin-bottom:0">Data from the Human Protein Atlas${h.version ? ` version ${esc(h.version)}` : ''}${h.tissueVersion && h.tissueVersion !== h.version ? ` (normal tissue data version ${esc(h.tissueVersion)})` : ''} (${ext('https://www.proteinatlas.org/', 'proteinatlas.org')}), used under ${esc(h.licence)}. Summarized; see the HPA for the images and full data.</p>
    </div>` : '';

  const linkRows = o.links.map((s) => `<tr>
      <td><strong>${esc(s.name)}</strong> ${useBadge(s.use)}${s.caution ? `<br><span class="small muted">${esc(s.caution)}</span>` : ''}</td>
      <td class="small">${s.links.map((l) => ext(l.url, l.label)).join('<br>')}
        ${s.search ? `<div class="pair" style="margin-top:4px;display:flex;gap:6px;align-items:center"><span class="muted">Search for</span> <code>${esc(s.search)}</code> <button class="link" type="button" data-copy="${esc(s.search)}">Copy</button></div>` : ''}
        ${s.saved.length ? `<div style="margin-top:4px">${s.saved.map((r) => `${ext(r.url, 'Saved page')}${r.note ? `: ${esc(r.note)}` : ''}`).join('<br>')}</div>` : ''}</td></tr>`).join('');

  const srcOpts = [...SOURCES.map((s) => [s.key, s.name]), [OTHER_SOURCE.key, OTHER_SOURCE.name]];
  const refs = o.refs.length ? `<table class="t"><tbody>${o.refs.slice().reverse().map((r) => {
    const src = [...SOURCES, OTHER_SOURCE].find((s) => s.key === r.source);
    return `<tr><td class="small">${esc(src?.name || r.source)}<br><span class="muted">${fmtDate(r.savedOn)} · ${esc(r.by)}</span></td>
      <td class="small">${r.url ? ext(r.url, r.url.length > 70 ? `${r.url.slice(0, 69)}…` : r.url) : ''}${r.note ? `${r.url ? '<br>' : ''}${esc(r.note)}` : ''}</td>
      <td class="n"><button class="link small" type="button" data-unref="${r.id}">Remove</button></td></tr>`;
  }).join('')}</tbody></table>` : '<p class="small muted">None yet.</p>';

  return `
    <h2>Outside sources</h2>
    <p class="small muted" style="max-width:920px">What others publish about this target and antibody. MHL's protocol above stays the record of how the stain is run; nothing here changes it. <a href="#/molecular/outside">What each source allows</a></p>
    <div class="split even">
      <div>
        <h3>Identifiers</h3>
        ${ids}
        ${hpa}
      </div>
      <div>
        <h3>Look it up</h3>
        <table class="t"><tbody>${linkRows}</tbody></table>
        <h3 class="section">Saved pages and notes</h3>
        <p class="small muted">The page you found (a CiteAb product, a NordiQC recommended protocol, an Antibodypedia validation) and a short note in your own words. Antibodypedia and CiteAb do not allow copying their content, so summarize rather than paste.</p>
        ${refs}
        <form class="form" id="ref-form" style="margin-top:10px">
          <div class="field"><label for="r-source">Source</label><select id="r-source">${options(srcOpts, 'citeab')}</select></div>
          <div class="field"><label for="r-url">Page address</label><input id="r-url" maxlength="500" placeholder="https://…" autocomplete="off"></div>
          <div class="field full"><label for="r-note">Note (400 characters)</label><textarea id="r-note" maxlength="400" placeholder="e.g. NordiQC run 63: clone SP7 optimal on BOND III with HIER pH 9"></textarea></div>
          <div class="field full actions" style="margin-top:0"><button class="btn small" type="submit">Save page</button></div>
        </form>
      </div>
    </div>`;
}

export function wireAssayOutside(root, a, reload) {
  const put = (body, msg) => act(null, async () => { await api('PUT', `/api/ihc/assays/${a.id}/identifiers`, body); await reload(); }, msg);
  $$('[data-use]', root).forEach((b) => b.addEventListener('click', () => put({ [b.dataset.use]: b.dataset.value }, `${b.dataset.use === 'target' ? 'Target gene' : b.dataset.use === 'rrid' ? 'RRID' : 'UniProt'} saved`)));
  $('#ids-edit', root)?.addEventListener('click', () => { $('#ids-form', root).hidden = false; $('#ids-edit', root).hidden = true; $('#i-target', root).focus(); });
  $('#ids-cancel', root)?.addEventListener('click', () => { $('#ids-form', root).hidden = true; $('#ids-edit', root).hidden = false; });
  $('#ids-form', root)?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const r = await api('PUT', `/api/ihc/assays/${a.id}/identifiers`, { target: $('#i-target', root).value, rrid: $('#i-rrid', root).value, uniprot: $('#i-uniprot', root).value });
      await reload();
      return r;
    }, (r) => (r.changed ? 'Identifiers saved' : 'Nothing changed'));
  });
  $$('[data-copy]', root).forEach((b) => b.addEventListener('click', async () => { toast(await copyText(b.dataset.copy) ? `Copied “${b.dataset.copy}”` : 'The browser did not allow copying; select the text instead.', 'ok'); }));
  $('#ref-form', root)?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      await api('POST', `/api/ihc/assays/${a.id}/refs`, { source: $('#r-source', root).value, url: $('#r-url', root).value, note: $('#r-note', root).value });
      await reload();
    }, 'Page saved');
  });
  $$('[data-unref]', root).forEach((b) => b.addEventListener('click', () => {
    if (!confirm('Remove this saved page from the assay?')) return;
    act(b, async () => { await api('POST', `/api/ihc/assays/${a.id}/refs/${b.dataset.unref}/remove`, {}); await reload(); }, 'Removed');
  }));
}

// ---------- Molecular > Outside sources ----------

const view = { show: 'all', limit: 100 };

export async function renderOutside(app) {
  const [meta, s] = await Promise.all([getMeta(), api('GET', '/api/ihc/outside')]);
  const c = s.coverage;
  const pct = (n) => (c.single ? Math.round((100 * n) / c.single) : 0);
  const imp = (m, what) => (m ? `<p class="small">${esc(what)} <strong>${esc(m.file)}</strong>${m.version ? ` (version ${esc(m.version)})` : ''}, ${fmtDateTime(m.importedAt)} by ${esc(m.by)}: ${m.rows.toLocaleString('en-US')} rows read, ${m.count.toLocaleString('en-US')} kept.${m.capped ? ' <strong>More matched than the pilot keeps; the rest were left out.</strong>' : ''}${m.missing?.length ? `<br><span class="muted">Columns not in the file: ${esc(m.missing.join(', '))}.</span>` : ''}</p>` : '');
  const rows = s.review.filter((r) => (view.show === 'target' ? r.targetSuggestion : view.show === 'rrid' ? r.rridSuggestion : true));
  const shown = rows.slice(0, view.limit === 'all' ? rows.length : view.limit);
  app.innerHTML = `
    ${ihcTabs('outside', meta)}
    <p style="max-width:920px">Each antibody in the catalog can be linked to six outside sources. Two publish open data, which can be imported here so the LIMS can suggest each antibody's gene and RRID and show HPA staining data beside the protocol. The other four allow links but not copying, so the LIMS links to them and staff can save the page they found with a short note. MHL's own protocols stay the record; outside data is shown beside them, never merged in.</p>

    <h2 class="section">What each source allows</h2>
    <table class="t"><thead><tr><th>Source</th><th>What it offers</th><th>In the LIMS</th><th>Access and terms</th></tr></thead>
      <tbody>${s.sources.map((x) => `<tr><td><strong>${ext(x.home, x.name)}</strong></td><td class="small">${esc(x.what)}${x.caution ? `<br><span class="muted">${esc(x.caution)}</span>` : ''}</td>
        <td>${useBadge(x.use)}</td><td class="small">${esc(x.access)}</td></tr>`).join('')}</tbody></table>
    <p class="small muted">Checked November 2026. Terms change; the IHC team and the NIH Library should confirm before production (open questions 60 to 63).</p>

    <h2 class="section">How much of the catalog is linked</h2>
    <p>${c.single} of the ${c.active} active protocols use a single antibody. Of those, <strong>${c.withTarget}</strong> (${pct(c.withTarget)}%) have a target gene${c.targetNA ? ` and ${c.targetNA} are marked N/A (tags and reagents)` : ''}, and <strong>${c.withRrid}</strong> (${pct(c.withRrid)}%) have an RRID${c.rridNA ? ` (${c.rridNA} marked N/A)` : ''}. ${c.withRefs} protocols have saved pages. Imported data takes ${s.storedKb} KB.</p>

    <div class="split even section">
      <div class="panel">
        <h2>Human Protein Atlas</h2>
        ${s.hpa.summary || s.hpa.tissue ? `${imp(s.hpa.summary, 'Gene summary from')}${imp(s.hpa.tissue, 'Normal tissue IHC from')}<p class="small">${s.hpa.genes} genes in the summary, ${s.hpa.tissueGenes} with normal tissue staining${s.hpa.version ? `; HPA version ${esc(s.hpa.version)}` : ''}. Licence ${esc(s.hpa.licence)}: the version and licence are shown wherever the data appear.</p>` : '<p class="small">Nothing imported yet.</p>'}
        <ol class="small">
          <li>On ${ext('https://www.proteinatlas.org/about/download', 'proteinatlas.org/about/download')}, download <strong>proteinatlas.tsv.zip</strong> (one row per gene) and <strong>normal_tissue.tsv.zip</strong> (IHC staining by tissue and cell type). Free; no sign-in.</li>
          <li>Type the HPA version (on the HPA home page), then choose the gene summary first and the normal tissue file second. The .zip can be chosen as it is.</li>
          <li>The file is read on this computer and only the genes the catalog may need are kept (about ${s.wants.symbols.length.toLocaleString('en-US')} names and symbols to look for).</li>
        </ol>
        <div class="form" style="margin-top:8px">
          <div class="field"><label for="hpa-version">HPA version</label><input id="hpa-version" value="${esc(s.hpa.version)}" maxlength="20" placeholder="e.g. 26.0"></div>
          <div class="field"><label for="hpa-file">HPA file</label><input type="file" id="hpa-file" accept=".tsv,.zip,.gz,.txt,text/tab-separated-values"></div>
        </div>
        <p class="small muted" id="hpa-msg" aria-live="polite"></p>
        ${s.hpa.summary || s.hpa.tissue ? '<button class="btn quiet small" type="button" data-clear="hpa">Remove the HPA data</button>' : ''}
      </div>
      <div class="panel">
        <h2>Antibody Registry (RRIDs)</h2>
        ${s.registry.import ? `${imp(s.registry.import, 'Imported')}<p class="small">${s.registry.rows} registry rows match catalog numbers in the catalog.</p>` : '<p class="small">Nothing imported yet.</p>'}
        <ol class="small">
          <li>Sign in (free) at ${ext('https://www.antibodyregistry.org/', 'antibodyregistry.org')} and download the list of antibodies (CSV). It has millions of rows.</li>
          <li>Choose it here. Only rows whose catalog number matches one of the catalog's ${s.wants.catalogs.length} single catalog numbers are kept.</li>
          <li>RRIDs are then suggested on each assay and below, matched on catalog number and vendor. Accept them after a look: catalog numbers are reused.</li>
        </ol>
        <div class="field" style="max-width:420px"><label for="reg-file">Registry file</label><input type="file" id="reg-file" accept=".csv,.tsv,.zip,.gz,.txt,text/csv"></div>
        <p class="small muted" id="reg-msg" aria-live="polite"></p>
        ${s.registry.import ? '<button class="btn quiet small" type="button" data-clear="registry">Remove the registry data</button>' : ''}
      </div>
    </div>

    <h2 class="section">Suggestions to review</h2>
    <p class="small muted" style="max-width:920px">Gene symbols come from common IHC names and, once imported, the HPA's symbols and synonyms; RRIDs from the registry rows and the HPA's own antibodies. Nothing is filled in until you accept it, and accepting fills only empty fields.</p>
    ${s.review.length ? `
    <div class="row">
      <div class="filters" role="group" aria-label="Show">${[['all', `All (${s.review.length})`], ['target', `Gene symbols (${s.review.filter((r) => r.targetSuggestion).length})`], ['rrid', `RRIDs (${s.review.filter((r) => r.rridSuggestion).length})`]].map(([k, l]) => `<button type="button" data-show="${k}" aria-pressed="${view.show === k}">${esc(l)}</button>`).join('')}</div>
      <span class="spacer"></span>
      <button class="btn quiet small" type="button" id="tick-strong" title="Gene symbols that are the whole name in the HPA, common IHC names, HPA synonyms of one gene only, tags; RRIDs with the same catalog number and vendor">Tick the strong ones shown</button>
      <button class="btn small" type="button" id="accept">Accept ticked</button>
    </div>
    <table class="t" style="margin-top:8px"><thead><tr><th class="n">#</th><th>Antibody</th><th>Catalog number</th><th>Target gene</th><th>RRID</th></tr></thead>
      <tbody>${shown.map((r) => `<tr>
        <td class="n muted">${r.id}</td><td><a href="#/molecular/assay/${r.id}">${esc(r.name)}</a></td>
        <td class="small">${esc(r.catalog)}<br><span class="muted">${esc(r.manufacturer)}</span></td>
        <td class="small">${r.targetSuggestion && view.show !== 'rrid' ? `<label><input type="checkbox" data-acc="${r.id}" data-field="target" data-value="${esc(r.targetSuggestion.symbol)}" data-strong="${r.targetSuggestion.strength >= 2}"> <strong>${esc(r.targetSuggestion.symbol)}</strong></label><br><span class="muted">${esc(r.targetSuggestion.why)}</span>` : r.target ? esc(r.target) : ''}</td>
        <td class="small">${r.rridSuggestion && view.show !== 'target' ? `<label><input type="checkbox" data-acc="${r.id}" data-field="rrid" data-value="${esc(r.rridSuggestion.rrid)}" data-strong="${r.rridSuggestion.level === 'exact'}"> <strong>${esc(r.rridSuggestion.rrid)}</strong></label> ${ext(`https://www.antibodyregistry.org/${r.rridSuggestion.rrid}`, 'check')}<br><span class="muted">${esc(r.rridSuggestion.why)}${r.rridSuggestion.vendor && !/^HPA antibody/.test(r.rridSuggestion.why) ? `: ${esc(r.rridSuggestion.vendor)} ${esc(r.rridSuggestion.catalog)}` : ''}</span>` : r.rrid ? esc(r.rrid) : ''}</td>
      </tr>`).join('')}</tbody></table>
    ${rows.length > shown.length ? `<p class="small muted">Showing ${shown.length} of ${rows.length}. <button class="link" type="button" id="all">Show all</button></p>` : ''}`
    : '<p class="empty">No suggestions waiting. Import the HPA or registry files above for more.</p>'}`;
  pageTop(app);

  const redraw = () => renderOutside(app);
  $$('[data-show]', app).forEach((b) => b.addEventListener('click', () => { view.show = b.dataset.show; view.limit = 100; redraw(); }));
  $('#all')?.addEventListener('click', () => { view.limit = 'all'; redraw(); });
  $('#tick-strong')?.addEventListener('click', () => { $$('[data-acc]', app).forEach((x) => { if (x.dataset.strong === 'true') x.checked = true; }); });
  $('#accept')?.addEventListener('click', (e) => {
    const items = $$('[data-acc]', app).filter((x) => x.checked).map((x) => ({ assayId: Number(x.dataset.acc), field: x.dataset.field, value: x.dataset.value }));
    if (!items.length) { toast('Tick the suggestions to accept first.', 'error'); return; }
    act(e.currentTarget, async () => { const r = await api('POST', '/api/ihc/outside/accept', { items }); await redraw(); return r; },
      (r) => `${r.accepted} accepted${r.skipped.length ? `; ${r.skipped.length} skipped (already filled in or not valid)` : ''}`);
  });
  $$('[data-clear]', app).forEach((b) => b.addEventListener('click', () => {
    if (!confirm(`Remove the imported ${b.dataset.clear === 'hpa' ? 'Human Protein Atlas' : 'Antibody Registry'} data? Identifiers already saved on assays stay.`)) return;
    act(b, async () => { await api('POST', '/api/ihc/outside/clear', { which: b.dataset.clear }); await redraw(); }, 'Removed');
  }));

  // Reading a file of hundreds of megabytes in pieces; only the matching rows go to the LIMS.
  const progress = (box) => { let next = 5e6; return (n) => { if (n >= next) { box.textContent = `Reading… ${Math.round(n / 1e6)} million characters so far`; next += 5e6; } }; };
  $('#hpa-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const msg = $('#hpa-msg'); msg.textContent = 'Reading the file…';
    const res = await act(null, async () => {
      const reader = hpaReader({ wanted: s.wants.symbols, wantedTissue: s.wants.tissueSymbols, wantedAntibodies: s.wants.antibodies });
      const lines = lineSplitter((l) => reader.line(l));
      const tick = progress(msg); let n = 0;
      await readTextChunks(f, (chunk) => { lines.push(chunk); n += chunk.length; tick(n); });
      lines.end();
      const out = reader.result();
      msg.textContent = `Read ${out.rows.toLocaleString('en-US')} rows; saving ${(out.genes || out.tissue).length} genes…`;
      const r = await api('POST', '/api/ihc/outside/hpa', { ...out, version: $('#hpa-version').value, file: f.name });
      await redraw();
      return r;
    }, (r) => `HPA ${r.kind === 'summary' ? 'gene summary' : 'normal tissue data'} imported: ${r.kept} genes kept`);
    if (!res && msg.isConnected) { msg.textContent = ''; e.target.value = ''; }
  });
  $('#reg-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    const msg = $('#reg-msg'); msg.textContent = 'Reading the file…';
    const res = await act(null, async () => {
      const reader = registryReader({ catalogs: s.wants.catalogs });
      const csv = csvSplitter((row) => reader.row(row), 'auto');
      const tick = progress(msg); let n = 0;
      await readTextChunks(f, (chunk) => { csv.push(chunk); n += chunk.length; tick(n); }, { entry: /\.(csv|tsv|txt)$/i });
      csv.end();
      const out = reader.result();
      msg.textContent = `Read ${out.rows.toLocaleString('en-US')} rows; saving ${out.kept.length}…`;
      const r = await api('POST', '/api/ihc/outside/registry', { ...out, file: f.name });
      await redraw();
      return r;
    }, (r) => `Antibody Registry imported: ${r.kept} rows match the catalog`);
    if (!res && msg.isConnected) { msg.textContent = ''; e.target.value = ''; }
  });
}
