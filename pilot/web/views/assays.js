// IHC assay catalog: browse and filter the protocols, see one in full, edit, check, retire or add, and download the
// catalog as an Excel workbook.
import { $, $$, api, esc, fmtDate, fmtDateTime, getMeta, act, pageTop, options, navigate, kindBadge, saveFile } from '../ui.js';
import { ihcTabs } from './ihcviews.js';
import { classify, applyDetection, speciesTags as readSpecies, fixativeTags as readFixatives, catalogSheets } from '../lib/ihc.mjs';
import { writeXlsx, XLSX_TYPE } from '../lib/xlsxwrite.mjs';

const KINDS = [['', 'All'], ['ihc', 'IHC'], ['multiplex', 'Multiplex and double stains'], ['fluorescent', 'Fluorescent (Opal, IF)'], ['other', 'TUNEL and β-gal']];
let timer = null;
// Long multiplex protocols would make rows very tall; show the start and keep the rest for the detail page.
const clip = (v, n) => { const t = String(v ?? ''); return t.length > n ? `<span title="${esc(t)}">${esc(t.slice(0, n - 1).trimEnd())}…</span>` : esc(t); };

// The coding the IHC team gives each protocol, as badges: preferred, not public, and whether it works.
const RESULT_BADGE = { Works: 'complete', Optimizing: 'warn', Failed: 'stat' };
export function codingBadges(a, { showWorks = true } = {}) {
  return [a.preferred ? '<span class="badge complete" title="Preferred protocol">★ Preferred</span>' : '',
    a.visibility === 'Internal' ? '<span class="badge muted" title="Not shown to investigators">Not public</span>' : '',
    a.result && (showWorks || a.result !== 'Works') ? `<span class="badge ${RESULT_BADGE[a.result] || ''}">${esc(a.resultLabel || a.result)}</span>` : ''].filter(Boolean).join(' ');
}

export async function renderAssays(app, params) {
  const meta = await getMeta(true);
  const f = { q: params.get('q') || '', kind: params.get('kind') || '', species: params.get('species') || '', fix: params.get('fix') || '', status: params.get('status') || 'Active',
    issues: params.get('issues') || '', vis: params.get('vis') || '', pref: params.get('pref') || '', result: params.get('result') || '', limit: params.get('limit') || '100' };
  const c = meta.ihc.catalog;
  app.innerHTML = `
    ${ihcTabs('catalog', meta)}
    <div class="row"><p class="muted" style="margin:0">${c.active} active assays from <strong>${esc(c.source || c.name)}</strong>${c.convertedOn ? `, converted ${fmtDate(c.convertedOn)}` : ''}. ${c.flagged ? `${c.flagged} have something to check (see the catalog review).` : ''}</p>
      <span class="spacer"></span><button class="btn quiet" type="button" id="xlsx">Download Excel</button><a class="btn quiet" href="#/molecular/assay/new">Add assay</a></div>
    <form class="toolbar" id="filters" role="search">
      <input id="q" class="inp" value="${esc(f.q)}" placeholder="Antibody, clone, catalog number or manufacturer" aria-label="Search the catalog" autocomplete="off">
      <select id="species" class="inp" aria-label="Species">${options(meta.ihc.speciesTags.map((t) => [t, t]), f.species, { blank: 'Any species' })}</select>
      <select id="fix" class="inp" aria-label="Fixative">${options(meta.ihc.fixTags.map((t) => [t, t === 'Frozen' ? 'Frozen sections' : t]), f.fix, { blank: 'Any fixative' })}</select>
      <select id="status" class="inp" aria-label="Status">${options([['Active', 'Active'], ['Duplicate', 'Duplicates'], ['Retired', 'Retired'], ['all', 'All statuses']], f.status)}</select>
      <select id="vis" class="inp" aria-label="Public or not">${options([['Public', 'Public'], ['Internal', 'Not public']], f.vis, { blank: 'Public or not' })}</select>
      <select id="result" class="inp" aria-label="Result">${options([['Works', 'Works'], ['Optimizing', 'Being optimized'], ['Failed', 'Did not work'], ['none', 'Result not recorded']], f.result, { blank: 'Any result' })}</select>
      <label class="small"><input type="checkbox" id="pref" ${f.pref ? 'checked' : ''}> Preferred only</label>
      <label class="small"><input type="checkbox" id="issues" ${f.issues ? 'checked' : ''}> Needs checking</label>
    </form>
    <div class="filters" role="group" aria-label="Kind of assay">${KINDS.map(([k, label]) => `<button type="button" data-kind="${k}" aria-pressed="${k === f.kind}">${esc(label)}</button>`).join('')}</div>
    <div id="list" aria-live="polite"></div>`;
  pageTop(app);

  const read = () => ({ ...f, q: $('#q').value.trim(), species: $('#species').value, fix: $('#fix').value, status: $('#status').value, vis: $('#vis').value, result: $('#result').value,
    pref: $('#pref').checked ? '1' : '', issues: $('#issues').checked ? '1' : '' });
  const filtered = () => Object.entries(f).some(([k, v]) => v && !['limit', 'status'].includes(k)) || f.status !== 'Active';
  const draw = async (state) => {
    Object.assign(f, state);
    const qs = new URLSearchParams(Object.entries(f).filter(([k, v]) => v && !(k === 'status' && v === 'Active') && !(k === 'limit' && v === '100')));
    history.replaceState(null, '', `#/molecular/assays${qs.toString() ? `?${qs}` : ''}`);
    const res = await api('GET', `/api/ihc/assays?${new URLSearchParams(Object.entries(f).filter(([, v]) => v))}`);
    const box = $('#list');
    if (!box) return;
    $('#xlsx').textContent = filtered() ? `Download these ${res.total} (Excel)` : 'Download the whole catalog (Excel)';
    box.innerHTML = res.total ? `
      <p class="small muted">${res.assays.length < res.total ? `Showing ${res.assays.length} of ${res.total}. <button class="link" type="button" id="all">Show all</button>` : `${res.total} protocol${res.total === 1 ? '' : 's'}`}</p>
      <table class="t assays">
        <thead><tr><th class="n">#</th><th>Antibody</th><th>Species</th><th>Fixative</th><th>Dilution</th><th>Antigen retrieval</th><th>Detection</th><th>Source</th></tr></thead>
        <tbody>${res.assays.map((a) => `
          <tr class="click ${a.status !== 'Active' || a.result === 'Failed' ? 'dim' : ''}" data-href="#/molecular/assay/${a.id}">
            <td class="n muted">${a.id}</td>
            <td><a href="#/molecular/assay/${a.id}"><strong>${esc(a.name)}</strong></a>${abText(a.antibody) ? `<br><span class="small muted">${esc(abText(a.antibody))}</span>` : ''}<br>${kindBadge(a)} ${codingBadges(a, { showWorks: false })}${a.status !== 'Active' ? ` <span class="badge muted">${esc(a.status)}</span>` : ''}${a.flags.filter((x) => x !== 'duplicate').length ? ' <span class="badge warn" title="Something to check">check</span>' : ''}</td>
            <td>${clip(a.species, 40)}</td><td>${clip(a.fixative, 30)}</td><td>${clip(a.dilution, 30)}</td><td>${clip(a.retrieval, 50)}</td>
            <td class="small">${clip(a.kit, 60)}<br><span class="muted">${esc(a.platform)} · ${esc(a.chromogen)}</span></td>
            <td>${clip(a.manufacturer, 30)}<br><span class="muted small">${clip(a.catalog, 34)}</span></td>
          </tr>`).join('')}</tbody></table>`
      : '<p class="empty">No protocol matches. Clear a filter, or add the assay if it is new.</p>';
    $('#all')?.addEventListener('click', () => draw({ limit: 'all' }));
    $$('tr.click', box).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  };
  $('#q').addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => draw({ ...read(), limit: '100' }), 180); });
  $('#filters').addEventListener('submit', (e) => { e.preventDefault(); draw(read()); });
  ['#species', '#fix', '#status', '#vis', '#result', '#pref', '#issues'].forEach((s) => $(s).addEventListener('change', () => draw({ ...read(), limit: '100' })));
  $$('[data-kind]', app).forEach((b) => b.addEventListener('click', () => {
    $$('[data-kind]', app).forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    draw({ ...read(), kind: b.dataset.kind, limit: '100' });
  }));
  $('#xlsx').addEventListener('click', (e) => act(e.currentTarget, async () => {
    const all = filtered() ? f : { status: 'all' };
    const res = await api('GET', `/api/ihc/assays?${new URLSearchParams(Object.entries({ ...all, limit: 'all', full: '1' }).filter(([, v]) => v))}`);
    const name = `MHL-IHC-assay-catalog${filtered() ? '-selection' : ''}-${meta.today}.xlsx`;
    saveFile(name, XLSX_TYPE, writeXlsx(catalogSheets(res.assays, { filtered: filtered(), today: meta.today, source: c.source || c.name })));
    return res.assays.length;
  }, (n) => `${n} assays downloaded`));
  await draw({});
  if (!f.q) $('#q').focus();
}

// Clone, host and isotype as shown in lists (see antibodyInfo in core/ihc.mjs).
const abText = (ab) => (!ab ? '' : ab.several ? 'Several antibodies' : [ab.clone ? `Clone ${ab.clone}` : ab.cloneNotApplicable ? 'Clone N/A' : '',
  [ab.host && ab.host !== 'Not applicable' ? ab.host : '', ab.clonality && ab.clonality !== 'Not applicable' ? ab.clonality.toLowerCase() : ''].filter(Boolean).join(' '),
  ab.isotype, ab.conjugate && `${ab.conjugate}-conjugated`].filter(Boolean).join(', '));
const shortList = (list) => (list.length ? `<table class="t"><tbody>${list.map((a) => `<tr><td class="n muted">${a.id}</td><td><a href="#/molecular/assay/${a.id}">${esc(a.name)}</a> ${kindBadge(a)} ${codingBadges(a, { showWorks: false })}${a.status !== 'Active' ? ` <span class="badge muted">${esc(a.status)}</span>` : ''}</td><td>${esc(a.species)}</td><td>${esc(a.fixative)}</td><td>${esc(a.dilution)}</td><td>${esc(a.catalog)}</td></tr>`).join('')}</tbody></table>` : '');

export async function renderAssay(app, id) {
  const [meta, d] = await Promise.all([getMeta(), api('GET', `/api/ihc/assays/${id}`)]);
  const a = d.assay;
  const ab = a.antibody;
  const flags = a.flags.filter((x) => x !== 'duplicate');
  const repairNote = (flag) => (flag === 'dilution-recovered' && a.repairs.dilution ? ` The export had <code>${esc(a.repairs.dilution)}</code>; shown as <strong>${esc(a.dilution)}</strong>.`
    : flag === 'name-recovered' && a.repairs.name ? ` The export had <code>${esc(a.repairs.name)}</code>; shown as <strong>${esc(a.name)}</strong>.`
      : flag === 'species-unrecognized' ? ` The species text is “${esc(a.species)}”.` : '');
  const notRecorded = '<span class="muted">Not recorded; add it with Edit</span>';
  const readNote = (k) => (ab.from?.[k] === 'text' ? ' <span class="small muted">(read from the antibody name and catalog number)</span>' : '');
  const abRows = ab.several ? '<dt>Antibody clone</dt><dd><span class="muted">Several antibodies: see the protocols in the panel</span></dd>' : `
    <dt>Antibody clone</dt><dd>${ab.clone ? `${esc(ab.clone)}${readNote('clone')}` : ab.cloneNotApplicable ? 'N/A' : notRecorded}</dd>
    <dt>Antibody host</dt><dd>${ab.host ? `${esc(ab.host)}${readNote('host')}` : notRecorded}</dd>
    <dt>Clonality</dt><dd>${ab.clonality ? `${esc(ab.clonality)}${ab.from?.clonality === 'text' ? ` <span class="small muted">(${ab.from.clone === 'text' || a.clone ? 'worked out from the clone' : 'read from the catalog number'})</span>` : ''}` : notRecorded}</dd>
    ${ab.isotype || ab.conjugate ? `<dt>Isotype</dt><dd>${esc([ab.isotype, ab.conjugate && `${ab.conjugate}-conjugated`].filter(Boolean).join(', '))}</dd>` : ''}`;
  const detection = (label, value, set, auto) => `<dt>${label}</dt><dd>${esc(value)} <span class="small muted">${set ? '(set by hand)' : `(worked out from the detection kit${label === 'Platform' ? ' and dilution' : ''})`}</span>${set && auto !== value ? `<br><span class="small muted">The text alone would give ${esc(auto)}.</span>` : ''}</dd>`;
  app.innerHTML = `
    <div class="crumb"><a href="#/molecular/assays">Assay catalog</a></div>
    <div class="head"><h1 class="assay-name">${esc(a.name)}</h1>${kindBadge(a)}<span class="badge ${a.status === 'Active' ? 'complete' : 'muted'}">${esc(a.status)}</span> ${codingBadges(a)}</div>
    <div class="facts"><span>#${a.id}</span><span title="${a.platformSet ? 'Set by hand' : 'Worked out from the detection kit and dilution'}">${esc(a.platform)}</span><span title="${a.chromogenSet ? 'Set by hand' : 'Worked out from the detection kit'}">Chromogen: ${esc(a.chromogen)}</span>
      ${a.sourceLine ? `<span>Export line ${a.sourceLine}${a.list ? `, list ${a.list}` : ''}</span>` : '<span>Added in the LIMS</span>'}${a.updatedAt ? `<span>Last changed ${fmtDateTime(a.updatedAt)}</span>` : ''}</div>
    ${flags.length ? `<div class="section">${flags.map((x) => `<p class="note">${esc(meta.ihc.flagText[x] || x)}${repairNote(x)}</p>`).join('')}
      <div class="actions" style="margin-top:10px"><button class="btn quiet" type="button" id="check">Mark as checked</button></div></div>` : ''}
    ${a.result === 'Failed' ? '<p class="note section">Marked <strong>Did not work</strong>. It is listed last when staff search for a stain, and choosing it gives a warning.</p>' : ''}
    ${d.duplicateOf ? `<p class="note info section">An exact copy of <a href="#/molecular/assay/${d.duplicateOf.id}">#${d.duplicateOf.id} ${esc(d.duplicateOf.name)}</a>. It is hidden from the request form.</p>` : ''}
    <div class="split section">
      <div>
        <h2>Protocol</h2>
        <dl class="dl wide">
          ${meta.ihc.fields.map(([k, label]) => `<dt>${esc(label)}</dt><dd>${esc(a[k]) || '<span class="muted">Not recorded</span>'}</dd>`).join('')}
          ${abRows}
          ${detection('Platform', a.platform, a.platformSet, a.auto.platform)}
          ${detection('Chromogen', a.chromogen, a.chromogenSet, a.auto.chromogen)}
          <dt>Read as</dt><dd>${a.speciesTags.map((t) => `<span class="badge info">${esc(t)}</span>`).join(' ') || '<span class="muted">no species</span>'} ${a.fixTags.map((t) => `<span class="badge">${esc(t)}</span>`).join(' ')}</dd>
          ${a.notes ? `<dt>Notes</dt><dd>${esc(a.notes)}</dd>` : ''}
        </dl>
        <h2 class="section">Coding</h2>
        <dl class="dl wide">
          <dt>Public</dt><dd>${a.visibility === 'Internal' ? 'Not public: MHL staff only' : 'Public: investigators can request it'}</dd>
          <dt>Preferred</dt><dd>${a.preferred ? 'Yes: offered first among protocols for this target' : 'No'}</dd>
          <dt>Result</dt><dd>${esc(a.resultLabel)}</dd>
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

// ---------- add or edit an assay ----------
// Labels for the fixative check boxes, in the words the catalog uses.
const FIX_LABEL = { NBF: '10% NBF', PFA: '4% PFA', Ethanol: '70% ethanol', Frozen: 'Frozen (OCT)' };
// Adds or removes one term in a list such as "Mouse, Human" or "4% PFA/ sucrose/ OCT", keeping the separators and
// anything else as written. Removing takes out only the parts that carry that term and nothing else the LIMS reads.
function toggleTerm(textValue, term, on, tagsOfPart, tag) {
  const tokens = String(textValue || '').split(/(\s*[,;\/]\s*)/);   // [part, sep, part, sep, ...]
  const parts = tokens.filter((_, i) => i % 2 === 0);
  const has = parts.some((p) => tagsOfPart(p).includes(tag));
  if (on) return has ? textValue : [String(textValue || '').trim(), term].filter(Boolean).join(', ');
  const out = [];
  for (let i = 0; i < tokens.length; i += 2) {
    const p = tokens[i]; const tags = tagsOfPart(p);
    if (tags.includes(tag) && tags.every((t) => t === tag)) continue;
    if (out.length) out.push(tokens[i - 1] || ', ');
    out.push(p);
  }
  return out.join('').trim();
}

export async function renderAssayEdit(app, id) {
  const [meta, choices] = await Promise.all([getMeta(), api('GET', '/api/ihc/choices')]);
  const a = id ? (await api('GET', `/api/ihc/assays/${id}`)).assay : null;
  const v = (k) => esc(a?.[k] ?? '');
  const list = (k) => `<datalist id="dl-${k}">${(choices[k] || []).map((x) => `<option value="${esc(x)}">`).join('')}</datalist>`;
  const text = (k, label, { required = false, max = 200, hint = '', full = false, placeholder = '' } = {}) => `<div class="field ${full ? 'full' : ''}"><label for="f-${k}">${esc(label)}${required ? ' (required)' : ''}</label>
    <input id="f-${k}" value="${v(k)}" maxlength="${max}" ${required ? 'required' : ''} ${choices[k] ? `list="dl-${k}"` : ''} autocomplete="off" placeholder="${esc(placeholder)}">${choices[k] ? list(k) : ''}${hint ? `<span class="small muted">${hint}</span>` : ''}</div>`;
  const area = (k, label) => `<div class="field full"><label for="f-${k}">${esc(label)}</label>
    <div class="pair"><select id="pick-${k}" aria-label="Common ${esc(label.toLowerCase())}" style="max-width:46%">${options((choices[k] || []).map((x) => [x, x.length > 70 ? `${x.slice(0, 69)}…` : x]), '', { blank: 'Choose a common one…' })}</select></div>
    <textarea id="f-${k}" maxlength="600" style="margin-top:6px">${v(k)}</textarea></div>`;
  const select = (k, label, opts, value, { hint = '' } = {}) => `<div class="field"><label for="f-${k}">${esc(label)}</label><select id="f-${k}">${options(opts, value)}</select>${hint ? `<span class="small muted">${hint}</span>` : ''}</div>`;
  const keep = (opts, value) => (value && !opts.some(([k]) => k === value) ? [...opts, [value, value]] : opts);
  const hostOpts = keep([['', 'Not recorded'], ...choices.hosts.map((x) => [x, x])], a?.host);
  const checks = (k, tags, labelOf, have) => `<div class="field full"><span class="lbl">${k === 'species' ? 'Species' : 'Fixative'}</span>
    <div class="checks" id="chk-${k}">${tags.map((t) => `<label><input type="checkbox" value="${esc(t)}" ${have.includes(t) ? 'checked' : ''}> ${esc(labelOf(t))}</label>`).join('')}</div>
    <input id="f-${k}" value="${v(k)}" maxlength="200" style="margin-top:6px" aria-label="${k === 'species' ? 'Species' : 'Fixative'} as written" placeholder="Tick above, or type">
    <span class="small muted">Ticking a box adds it to the text; the text is what is saved, so anything else (such as "frozen only") can be typed.</span>
    <span class="small fitnote" id="note-${k}" aria-live="polite"></span></div>`;

  app.innerHTML = `
    <div class="crumb"><a href="#/molecular/assays">Assay catalog</a>${a ? ` / <a href="#/molecular/assay/${a.id}">#${a.id}</a>` : ''}</div>
    <h1 style="margin-top:8px">${a ? `Edit ${esc(a.name)}` : 'Add an assay'}</h1>
    <p class="muted">The columns of the IHC database, plus the antibody details and coding the database has no columns for. Lists offer the values already in the catalog; you can still type a new one.</p>
    <form class="form" id="edit">
      <h2 class="full">Antibody</h2>
      ${text('name', 'Antibody (target)', { required: true, hint: 'The target as investigators search for it, e.g. CD8, Ki-67, F4/80.' })}
      ${text('clone', 'Antibody clone', { max: 60, placeholder: 'e.g. SP7, D8A8Y', hint: 'Type N/A for a polyclonal antibody or a kit.' })}
      ${select('host', 'Antibody host', hostOpts, a?.host || '')}
      ${select('clonality', 'Clonality', [['', 'Not recorded'], ...choices.clonalities.map((x) => [x, x === 'Not applicable' ? 'Not applicable (kit or reagent)' : x])], a?.clonality || '')}
      ${text('manufacturer', 'Manufacturer')}
      ${text('catalog', 'Catalog number')}
      <h2 class="full section">Protocol</h2>
      ${text('dilution', 'Dilution and time', { placeholder: 'e.g. 1:200 30\', 1:2000 ONRT' })}
      ${text('digestion', 'Proteolytic digestion')}
      ${area('retrieval', 'Antigen retrieval')}
      ${area('kit', 'Secondary antibody / detection kit')}
      ${select('platformSet', 'Platform', [['', 'Work out from the text'], ...choices.platforms.map((x) => [x, x])], a?.platformSet || '')}
      ${a?.components ? '<div class="field"><span class="lbl">Chromogen</span><div class="ro">From its two protocols</div><input type="hidden" id="f-chromogenSet" value=""></div>'
        : select('chromogenSet', 'Chromogen', [['', 'Work out from the text'], ...choices.chromogens.map((x) => [x, x])], a?.chromogenSet || '')}
      <p class="full small" id="readas" aria-live="polite"></p>
      ${checks('fixative', choices.fixTags, (t) => FIX_LABEL[t] || t, a?.fixTags || [])}
      ${checks('species', choices.speciesTags, (t) => t, a?.speciesTags || [])}
      ${text('control', 'Control tissue', { full: true, max: 600 })}
      <h2 class="full section">Coding</h2>
      ${select('visibility', 'Public', choices.visibility, a?.visibility || 'Public')}
      ${select('preferred', 'Preferred', [['false', 'No'], ['true', 'Yes: offer it first for this target']], a?.preferred ? 'true' : 'false')}
      ${select('result', 'Result', choices.results, a?.result || '')}
      <div class="field full"><label for="f-notes">Notes (validation, lot, who to ask)</label><textarea id="f-notes" maxlength="1000">${v('notes')}</textarea></div>
      <div class="full actions" style="margin-top:6px"><button class="btn" type="submit">${a ? 'Save changes' : 'Add assay'}</button><a class="btn quiet" href="${a ? `#/molecular/assay/${a.id}` : '#/molecular/assays'}">Cancel</a></div>
    </form>`;
  pageTop(app);
  $('#f-name').focus();

  // Picking a common value fills the box; it can still be edited.
  for (const k of ['retrieval', 'kit']) $(`#pick-${k}`).addEventListener('change', (e) => { if (e.target.value) { $(`#f-${k}`).value = e.target.value; e.target.value = ''; preview(); } });
  // Check boxes for species and fixative edit the text; typing in the text updates the boxes.
  const wire = (k, labelOf, tagsOf) => {
    const box = $(`#chk-${k}`); const input = $(`#f-${k}`); const note = $(`#note-${k}`);
    const sync = () => { const have = tagsOf(input.value); $$('input', box).forEach((c) => { c.checked = have.includes(c.value); }); return have; };
    $$('input', box).forEach((c) => c.addEventListener('change', () => {
      const want = c.checked;
      input.value = toggleTerm(input.value, labelOf(c.value), want, tagsOf, c.value);
      const have = sync();
      note.textContent = want && !have.includes(c.value) ? `"${labelOf(c.value)}" was added, but the text as written is not read that way; edit the text.`
        : !want && have.includes(c.value) ? `"${labelOf(c.value)}" is part of a longer phrase; edit the text to remove it.` : '';
    }));
    input.addEventListener('input', () => { sync(); note.textContent = ''; });
  };
  wire('species', (t) => t, (s) => readSpecies(s).tags);
  wire('fixative', (t) => FIX_LABEL[t] || t, (s) => readFixatives(s));
  // What the LIMS will read the protocol as, so a wrong guess can be corrected with the two lists above it.
  const preview = () => {
    const f = { name: $('#f-name').value, kit: $('#f-kit').value, dilution: $('#f-dilution').value };
    const auto = classify(f);
    const d = applyDetection(auto, { platformSet: $('#f-platformSet').value, chromogenSet: $('#f-chromogenSet').value });
    $('#f-platformSet').options[0].textContent = a?.components ? `As built from its two protocols (${a.platformBuilt || a.platform})` : `Work out from the text (now ${auto.platform})`;
    if (!a?.components) $('#f-chromogenSet').options[0].textContent = `Work out from the text (now ${auto.chromogen})`;
    $('#readas').innerHTML = a?.components ? '<span class="muted">A double stain keeps the kind built from its two protocols; only a platform set by hand changes it.</span>'
      : `Read as: <strong>${esc(d.kind === 'TUNEL' && d.chromogen === 'Fluorescent' ? 'TUNEL (fluorescent)' : d.kind)}${d.plex > 1 ? ` ${d.plex}-plex` : ''}</strong>, ${esc(d.platform)}, ${esc(d.chromogen)}.`;
  };
  ['#f-name', '#f-kit', '#f-dilution'].forEach((s) => $(s).addEventListener('input', preview));
  ['#f-platformSet', '#f-chromogenSet'].forEach((s) => $(s).addEventListener('change', preview));
  preview();

  $('#edit').addEventListener('submit', (e) => {
    e.preventDefault();
    const body = Object.fromEntries([...meta.ihc.fields.map(([k]) => [k, $(`#f-${k}`).value]), ...['clone', 'host', 'clonality', 'platformSet', 'chromogenSet', 'visibility', 'result'].map((k) => [k, $(`#f-${k}`).value]),
      ['preferred', $('#f-preferred').value === 'true'], ['notes', $('#f-notes').value]]);
    act(e.submitter, async () => {
      const res = a ? await api('PATCH', `/api/ihc/assays/${a.id}`, body) : await api('POST', '/api/ihc/assays', body);
      await getMeta(true);
      navigate(`#/molecular/assay/${res.id}`);
      return res;
    }, a ? 'Saved' : 'Assay added');
  });
}

