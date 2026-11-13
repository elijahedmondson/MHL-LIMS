// IHC assay catalog: browse and filter the protocols, see one in full, edit, check, retire or add.
import { $, $$, api, esc, fmtDate, fmtDateTime, getMeta, act, pageTop, options, navigate, kindBadge } from '../ui.js';
import { ihcTabs } from './ihcviews.js';

const KINDS = [['', 'All'], ['ihc', 'IHC'], ['multiplex', 'Multiplex and double stains'], ['fluorescent', 'Fluorescent (Opal, IF)'], ['other', 'TUNEL and β-gal']];
let timer = null;
// Long multiplex protocols would make rows very tall; show the start and keep the rest for the detail page.
const clip = (v, n) => { const t = String(v ?? ''); return t.length > n ? `<span title="${esc(t)}">${esc(t.slice(0, n - 1).trimEnd())}…</span>` : esc(t); };

export async function renderAssays(app, params) {
  const meta = await getMeta(true);
  const f = { q: params.get('q') || '', kind: params.get('kind') || '', species: params.get('species') || '', fix: params.get('fix') || '', status: params.get('status') || 'Active', issues: params.get('issues') || '', limit: params.get('limit') || '100' };
  const c = meta.ihc.catalog;
  app.innerHTML = `
    ${ihcTabs('catalog', meta)}
    <div class="row"><p class="muted" style="margin:0">${c.active} active assays from <strong>${esc(c.source || c.name)}</strong>${c.convertedOn ? `, converted ${fmtDate(c.convertedOn)}` : ''}. ${c.flagged ? `${c.flagged} have something to check (see the catalog review).` : ''}</p>
      <span class="spacer"></span><a class="btn quiet" href="#/molecular/assay/new">Add assay</a></div>
    <form class="toolbar" id="filters" role="search">
      <input id="q" class="inp" value="${esc(f.q)}" placeholder="Antibody, clone, catalog number or manufacturer" aria-label="Search the catalog" autocomplete="off">
      <select id="species" class="inp" aria-label="Species">${options(meta.ihc.speciesTags.map((t) => [t, t]), f.species, { blank: 'Any species' })}</select>
      <select id="fix" class="inp" aria-label="Fixative">${options(meta.ihc.fixTags.map((t) => [t, t === 'Frozen' ? 'Frozen sections' : t]), f.fix, { blank: 'Any fixative' })}</select>
      <select id="status" class="inp" aria-label="Status">${options([['Active', 'Active'], ['Duplicate', 'Duplicates'], ['Retired', 'Retired'], ['all', 'All statuses']], f.status)}</select>
      <label class="small"><input type="checkbox" id="issues" ${f.issues ? 'checked' : ''}> Needs checking</label>
    </form>
    <div class="filters" role="group" aria-label="Kind of assay">${KINDS.map(([k, label]) => `<button type="button" data-kind="${k}" aria-pressed="${k === f.kind}">${esc(label)}</button>`).join('')}</div>
    <div id="list" aria-live="polite"></div>`;
  pageTop(app);

  const read = () => ({ ...f, q: $('#q').value.trim(), species: $('#species').value, fix: $('#fix').value, status: $('#status').value, issues: $('#issues').checked ? '1' : '' });
  const draw = async (state) => {
    Object.assign(f, state);
    const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !(k === 'status' && v === 'Active') && !(k === 'limit' && v === '100')));
    history.replaceState(null, '', `#/molecular/assays${qs.toString() ? `?${qs}` : ''}`);
    const res = await api('GET', `/api/ihc/assays?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`);
    const box = $('#list');
    if (!box) return;
    box.innerHTML = res.total ? `
      <p class="small muted">${res.assays.length < res.total ? `Showing ${res.assays.length} of ${res.total}. <button class="link" type="button" id="all">Show all</button>` : `${res.total} protocol${res.total === 1 ? '' : 's'}`}</p>
      <table class="t assays">
        <thead><tr><th class="n">#</th><th>Antibody</th><th>Species</th><th>Fixative</th><th>Dilution</th><th>Antigen retrieval</th><th>Detection</th><th>Source</th></tr></thead>
        <tbody>${res.assays.map((a) => `
          <tr class="click ${a.status !== 'Active' ? 'dim' : ''}" data-href="#/molecular/assay/${a.id}">
            <td class="n muted">${a.id}</td>
            <td><a href="#/molecular/assay/${a.id}"><strong>${esc(a.name)}</strong></a>${abText(a.antibody) ? `<br><span class="small muted">${esc(abText(a.antibody))}</span>` : ''}<br>${kindBadge(a)}${a.status !== 'Active' ? ` <span class="badge muted">${esc(a.status)}</span>` : ''}${a.flags.filter((x) => x !== 'duplicate').length ? ' <span class="badge warn" title="Something to check">check</span>' : ''}</td>
            <td>${clip(a.species, 40)}</td><td>${clip(a.fixative, 30)}</td><td>${clip(a.dilution, 30)}</td><td>${clip(a.retrieval, 50)}</td>
            <td class="small">${clip(a.kit, 60)}</td>
            <td>${clip(a.manufacturer, 30)}<br><span class="muted small">${clip(a.catalog, 34)}</span></td>
          </tr>`).join('')}</tbody></table>`
      : '<p class="empty">No protocol matches. Clear a filter, or add the assay if it is new.</p>';
    $('#all')?.addEventListener('click', () => draw({ limit: 'all' }));
    $$('tr.click', box).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  };
  $('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => draw({ ...read(), limit: '100' }), 180); });
  $('#filters').addEventListener('submit', (e) => { e.preventDefault(); draw(read()); });
  ['#species', '#fix', '#status', '#issues'].forEach((s) => $(s).addEventListener('change', () => draw({ ...read(), limit: '100' })));
  $$('[data-kind]', app).forEach((b) => b.addEventListener('click', () => {
    $$('[data-kind]', app).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw({ ...read(), kind: b.dataset.kind, limit: '100' });
  }));
  await draw({});
  if (!f.q) $('#q').focus();
}

// Clone, host and isotype as read from the catalog text (see antibodyInfo in core/ihc.mjs).
const abText = (ab) => (!ab ? '' : ab.several ? 'Several antibodies' : [ab.clone && `Clone ${ab.clone}`, [ab.host, ab.clonality && ab.clonality.toLowerCase()].filter(Boolean).join(' '), ab.isotype, ab.conjugate && `${ab.conjugate}-conjugated`].filter(Boolean).join(', '));
const shortList = (list) => (list.length ? `<table class="t"><tbody>${list.map((a) => `<tr><td class="n muted">${a.id}</td><td><a href="#/molecular/assay/${a.id}">${esc(a.name)}</a> ${kindBadge(a)}${a.status !== 'Active' ? ` <span class="badge muted">${esc(a.status)}</span>` : ''}</td><td>${esc(a.species)}</td><td>${esc(a.fixative)}</td><td>${esc(a.dilution)}</td><td>${esc(a.catalog)}</td></tr>`).join('')}</tbody></table>` : '');

export async function renderAssay(app, id) {
  const [meta, d] = await Promise.all([getMeta(), api('GET', `/api/ihc/assays/${id}`)]);
  const a = d.assay;
  const flags = a.flags.filter((x) => x !== 'duplicate');
  const repairNote = (flag) => (flag === 'dilution-recovered' && a.repairs.dilution ? ` The export had <code>${esc(a.repairs.dilution)}</code>; shown as <strong>${esc(a.dilution)}</strong>.`
    : flag === 'name-recovered' && a.repairs.name ? ` The export had <code>${esc(a.repairs.name)}</code>; shown as <strong>${esc(a.name)}</strong>.`
      : flag === 'species-unrecognized' ? ` The species text is “${esc(a.species)}”.` : '');
  app.innerHTML = `
    <div class="crumb"><a href="#/molecular/assays">Assay catalog</a></div>
    <div class="head"><h1 class="assay-name">${esc(a.name)}</h1>${kindBadge(a)}<span class="badge ${a.status === 'Active' ? 'complete' : 'muted'}">${esc(a.status)}</span></div>
    <div class="facts"><span>#${a.id}</span><span>${esc(a.platform)}</span><span>Chromogen: ${esc(a.chromogen)}</span>
      ${a.sourceLine ? `<span>Export line ${a.sourceLine}${a.list ? `, list ${a.list}` : ''}</span>` : '<span>Added in the LIMS</span>'}${a.updatedAt ? `<span>Last changed ${fmtDateTime(a.updatedAt)}</span>` : ''}</div>
    ${flags.length ? `<div class="section">${flags.map((x) => `<p class="note">${esc(meta.ihc.flagText[x] || x)}${repairNote(x)}</p>`).join('')}
      <div class="actions" style="margin-top:10px"><button class="btn quiet" type="button" id="check">Mark as checked</button></div></div>` : ''}
    ${d.duplicateOf ? `<p class="note info section">An exact copy of <a href="#/molecular/assay/${d.duplicateOf.id}">#${d.duplicateOf.id} ${esc(d.duplicateOf.name)}</a>. It is hidden from the request form.</p>` : ''}
    <div class="split section">
      <div>
        <h2>Protocol</h2>
        <dl class="dl wide">
          ${meta.ihc.fields.map(([k, label]) => `<dt>${esc(label)}</dt><dd>${esc(a[k]) || '<span class="muted">Not recorded</span>'}</dd>`).join('')}
          <dt>Antibody</dt><dd>${esc(abText(a.antibody)) || '<span class="muted">Clone and host not recorded; add them in Edit (Notes) if known</span>'}</dd>
          <dt>Read as</dt><dd>${a.speciesTags.map((t) => `<span class="badge info">${esc(t)}</span>`).join(' ') || '<span class="muted">no species</span>'} ${a.fixTags.map((t) => `<span class="badge">${esc(t)}</span>`).join(' ')}</dd>
          ${a.notes ? `<dt>Notes</dt><dd>${esc(a.notes)}</dd>` : ''}
        </dl>
        <div class="actions">
          <a class="btn quiet" href="#/molecular/assay/${a.id}/edit">Edit</a>
          ${a.status === 'Active' ? `<button class="btn quiet" type="button" id="retire">Retire</button><a class="btn quiet" href="#/molecular/calculator?assay=${a.id}&slides=1">Dilution calculator</a>` : '<button class="btn quiet" type="button" id="restore">Make active</button>'}
        </div>
      </div>
      <div>
        ${d.components.length ? `<h2>The two stains in this double stain</h2>${shortList(d.components)}` : ''}
        ${d.partOf.length ? `<h2>Used in double stain</h2>${shortList(d.partOf)}` : ''}
        ${d.sameName.length ? `<h2 class="${d.components.length || d.partOf.length ? 'section' : ''}">Other protocols for ${esc(a.name)}</h2>${shortList(d.sameName)}` : ''}
        <h2 class="section">Requested in</h2>
        ${d.usedIn.length ? `<table class="t"><tbody>${d.usedIn.map((u) => `<tr><td><a class="idtxt" href="#/molecular/request/${u.id}">${esc(u.number)}</a></td><td>${esc(u.investigator)}</td><td>${fmtDate(u.submittedOn)}</td><td>${esc(u.status)}</td></tr>`).join('')}</tbody></table>` : '<p class="muted">Not requested in the pilot yet.</p>'}
        <h2 class="section">Changes</h2>
        ${d.history.length ? `<table class="t"><tbody>${d.history.map((h) => `<tr><td>${fmtDateTime(h.at)}</td><td>${esc(h.by)}</td><td>${esc(h.action.replace(/^ASSAY_/, '').toLowerCase())}<br><span class="small muted">${esc(h.detail)}</span></td></tr>`).join('')}</tbody></table>` : '<p class="muted">No changes since it was imported.</p>'}
      </div>
    </div>`;
  pageTop(app);
  const reload = () => renderAssay(app, id);
  $('#check')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/ihc/assays/${a.id}/check`, {}); await getMeta(true); await reload(); }, 'Marked as checked'));
  $('#retire')?.addEventListener('click', (e) => {
    const reason = prompt(`Retire ${a.name} (#${a.id})? It stays in the catalog but can no longer be requested. Reason:`, '');
    if (!reason) return;
    act(e.currentTarget, async () => { await api('POST', `/api/ihc/assays/${a.id}/retire`, { reason }); await getMeta(true); await reload(); }, 'Assay retired');
  });
  $('#restore')?.addEventListener('click', (e) => act(e.currentTarget, async () => { await api('POST', `/api/ihc/assays/${a.id}/restore`, {}); await getMeta(true); await reload(); }, 'Assay is active again'));
}

export async function renderAssayEdit(app, id) {
  const meta = await getMeta();
  const a = id ? (await api('GET', `/api/ihc/assays/${id}`)).assay : null;
  const v = (k) => esc(a?.[k] ?? '');
  const long = new Set(['kit', 'control', 'retrieval']);
  app.innerHTML = `
    <div class="crumb"><a href="#/molecular/assays">Assay catalog</a>${a ? ` / <a href="#/molecular/assay/${a.id}">#${a.id}</a>` : ''}</div>
    <h1 style="margin-top:8px">${a ? `Edit ${esc(a.name)}` : 'Add an assay'}</h1>
    <p class="muted">The same columns as the IHC database. Species, fixative and kind of assay are worked out from what you type, so the request form can match assays to samples.</p>
    <form class="form" id="edit">
      ${meta.ihc.fields.map(([k, label]) => `<div class="field ${long.has(k) ? 'full' : ''}"><label for="f-${k}">${esc(label)}${k === 'name' ? ' (required)' : ''}</label>
        ${long.has(k) ? `<textarea id="f-${k}" maxlength="600">${v(k)}</textarea>` : `<input id="f-${k}" value="${v(k)}" maxlength="200" ${k === 'name' ? 'required' : ''}>`}</div>`).join('')}
      <div class="field full"><label for="f-notes">Notes (validation, lot, who to ask)</label><textarea id="f-notes" maxlength="1000">${v('notes')}</textarea></div>
      <div class="full actions" style="margin-top:6px"><button class="btn" type="submit">${a ? 'Save changes' : 'Add assay'}</button><a class="btn quiet" href="${a ? `#/molecular/assay/${a.id}` : '#/molecular/assays'}">Cancel</a></div>
    </form>`;
  pageTop(app);
  $('#f-name').focus();
  $('#edit').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = Object.fromEntries([...meta.ihc.fields.map(([k]) => [k, $(`#f-${k}`).value]), ['notes', $('#f-notes').value]]);
    act(e.submitter, async () => {
      const res = a ? await api('PATCH', `/api/ihc/assays/${a.id}`, body) : await api('POST', '/api/ihc/assays', body);
      await getMeta(true);
      navigate(`#/molecular/assay/${res.id}`);
      return res;
    }, a ? 'Saved' : 'Assay added');
  });
}
