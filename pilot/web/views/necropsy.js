// Necropsy: worklist, studies list, and Zaphod-style necropsy entry with approval that creates charges.
import { $, $$, api, esc, money, fmtDate, fmtDateTime, getMeta, getPriceList, act, toast, pageTop, options, navigate, animalDetails } from '../ui.js';

export async function renderWorklist(app) {
  const meta = await getMeta();
  const [{ requests }, { studies }] = await Promise.all([api('GET', '/api/necropsy/worklist'), api('GET', '/api/studies')]);
  app.innerHTML = `
    <h1>Necropsy</h1>
    <div class="split section">
      <div>
        <h2>Waiting for necropsy</h2>
        ${requests.length ? requests.map((r) => `
          <section class="panel" style="margin-bottom:14px">
            <div class="row"><a class="idtxt" href="#/request/${r.requestId}">${esc(r.number)}</a><span class="muted">${esc(r.pi)}</span><span class="spacer"></span>
              ${r.zap ? `<a href="#/study/${r.studyId}">${esc(r.zap)}</a>` : '<span class="badge warn">No study</span>'}<span class="small muted">${r.done} of ${r.total} done</span></div>
            ${r.studyTitle ? `<p class="small muted" style="margin:4px 0 8px">${esc(r.studyTitle)}</p>` : ''}
            <table class="t"><thead><tr><th>PHL#</th><th>Animal</th><th>Group</th><th>Status</th><th></th></tr></thead><tbody>
              ${r.subjects.map((s) => `<tr class="click" data-href="#/necropsy/${s.id}">
                <td class="code">${esc(s.phl)} ${s.priority === 'S' ? '<span class="badge stat">STAT</span>' : ''}</td><td>${esc(s.label)}</td>
                <td>${esc(s.groupCode || '')}${s.sex ? ` (${esc(s.sex)})` : ''}</td>
                <td>${s.status === 'DRAFT' ? '<span class="badge warn">Draft</span>' : '<span class="muted">Not started</span>'}</td>
                <td class="mid"><a class="btn small" href="#/necropsy/${s.id}">${s.status === 'DRAFT' ? 'Continue' : 'Start'}</a></td></tr>`).join('')}
            </tbody></table>
          </section>`).join('')
        : '<p class="empty">No animals are waiting. Animals appear here when a request with necropsy is created.</p>'}
      </div>
      <div>
        <h2>Studies</h2>
        <p class="small"><a href="#/protocols">Necropsy and trim protocols</a> · <a href="#/terminology">Organ and diagnosis library</a></p>
        <table class="t"><thead><tr><th>ZAP#</th><th>Title</th><th class="n">Necropsied</th></tr></thead><tbody>
          ${studies.map((s) => `<tr class="click" data-href="#/study/${s.id}"><td><a class="idtxt" href="#/study/${s.id}">${esc(s.zap)}</a></td>
            <td>${esc(s.title)}<br><span class="small muted">${esc(s.pi)}, ${esc(s.protocol)}</span></td><td class="n">${s.necropsied} of ${s.animals}</td></tr>`).join('')}
        </tbody></table>
        <details class="section">
          <summary><strong>New study</strong></summary>
          <form class="form section" id="newstudy" style="grid-template-columns:1fr 1fr">
            <div class="field"><label for="z">ZAP# (blank to number it)</label><input id="z" placeholder="e.g. ZAP2240"></div>
            <div class="field"><label for="ac">ACUC protocol</label><input id="ac"></div>
            <div class="field full"><label for="ti">Title</label><input id="ti" required></div>
            <div class="field"><label for="pl">Investigator last name</label><input id="pl"></div>
            <div class="field"><label for="pf">First name</label><input id="pf"></div>
            <div class="field"><label for="pr">Necropsy protocol</label><select id="pr">${options(meta.protocols.necropsy.filter((p) => !p.obsolete).map((p) => [p.id, p.name]), (meta.protocols.necropsy.find((p) => p.approved && !p.obsolete) || {}).id)}</select></div>
            <div class="field"><label for="pt">Trim protocol</label><select id="pt">${options(meta.protocols.trim.filter((p) => !p.obsolete).map((p) => [p.id, p.name]), (meta.protocols.trim.find((p) => p.approved && !p.obsolete) || {}).id, { blank: 'None' })}</select></div>
            <div class="full"><button class="btn quiet" type="submit">Create study</button></div>
          </form>
          <p class="small muted">Animals join a study when a request is created for it under New request.</p>
        </details>
      </div>
    </div>`;
  pageTop(app);
  $$('tr.click', app).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  $('#newstudy').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const res = await api('POST', '/api/studies', { zap: $('#z').value, title: $('#ti').value, acuc: $('#ac').value, piLast: $('#pl').value, piFirst: $('#pf').value,
        necropsyProtocolId: Number($('#pr').value), trimProtocolId: $('#pt').value ? Number($('#pt').value) : '' });
      location.hash = `#/study/${res.id}`;
      return res;
    }, (res) => `${res.zap} created`);
  });
}

// ---------- entry ----------
let n = null;          // the necropsy being edited
let dirty = false;
let editing = null;    // { o: organ index, f: finding index or -1 for new }

export async function renderNecropsy(app, subjectId) {
  const [d, meta, pl] = await Promise.all([api('GET', `/api/necropsy/${subjectId}`), getMeta(), getPriceList()]);
  n = structuredClone(d.necropsy); dirty = false; editing = null;
  draw(app, d, meta, pl);
  pageTop(app);
}

function draw(app, d, meta, pl) {
  const s = d.subject;
  const approved = n.status === 'APPROVED';
  const dis = approved ? 'disabled' : '';
  const dict = meta.dictionaries;
  const group = d.study?.groups.find((g) => g.code === s.groupCode);
  const price = (code) => pl.items.find((i) => i.code === code);
  const willCharge = chargePlan(meta);
  app.innerHTML = `
    <div class="crumb"><a href="#/necropsy">Necropsy</a> <span class="muted">/</span> <a href="#/request/${d.request.id}">${esc(d.request.number)}</a>${d.study ? ` <span class="muted">/</span> <a href="#/study/${d.study.id}">${esc(d.study.zap)}</a>` : ''}</div>
    <div class="nec-head" style="margin-top:8px">
      <h1>${esc(s.phl)}</h1>
      ${s.priority === 'S' ? '<span class="badge stat">STAT</span>' : ''}
      ${approved ? '<span class="badge complete">Approved</span>' : '<span class="badge warn">Draft</span>'}
      <span class="muted">Animal ${esc(s.label)}${s.groupCode ? `, group ${esc(s.groupCode)}${group?.name ? ` (${esc(group.name)})` : ''}` : ''}${s.sex ? `, ${s.sex === 'F' ? 'female' : s.sex === 'M' ? 'male' : 'sex unknown'}` : ''}${animalDetails(s) ? `; ${esc(animalDetails(s))}` : ''}</span>
      <span class="spacer"></span>
      <button class="btn small quiet" type="button" id="prev" ${d.prevId ? '' : 'disabled'}>Previous animal</button>
      <button class="btn small quiet" type="button" id="next" ${d.nextId ? '' : 'disabled'}>Next animal</button>
    </div>
    ${s.notes ? `<p class="note info" style="margin-top:6px">From the investigator's animal list: ${esc(s.notes)}</p>` : ''}
    <p class="muted small">${esc(d.request.piName)}. Necropsy protocol: <a href="#/protocol/necropsy/${d.protocol.necropsyId}">${esc(d.protocol.name)}</a>${d.protocol.trimId ? `; trim protocol: <a href="#/protocol/trim/${d.protocol.trimId}">${esc(d.protocol.trimName)}</a>` : ''}.${d.study ? '' : ' This request has no study, so the standard protocol is used.'}</p>
    ${d.protocol.instructions ? `<p class="note info small">${esc(d.protocol.instructions)}</p>` : ''}
    ${approved ? `<div class="locked">Approved by ${esc(n.approvedBy)} on ${fmtDateTime(n.approvedAt)}. ${d.charges.length ? `It created ${d.charges.length} charges: ${d.charges.map((c) => `${esc(c.code)} ${esc(c.codeDescription)} (${c.status.toLowerCase()})`).join('; ')}.` : 'No charges were created.'}
      <div class="actions" style="margin-top:10px"><a class="btn" href="#/report/${s.id}/necropsy">Necropsy report</a>${d.request.areas?.includes('PATHO') ? `<a class="btn quiet" href="#/pathology/${s.id}">Pathology</a>` : ''}<button class="btn quiet" type="button" id="unapprove">Unapprove to correct</button></div></div>` : ''}

    <h2 class="section">Animal</h2>
    <div class="form three">
      <div class="field"><label for="f-date">Necropsy date</label><input id="f-date" type="date" data-k="date" value="${esc(n.date)}" ${dis}></div>
      <div class="field"><label for="f-pros">Prosector (initials)</label><input id="f-pros" data-k="prosector" maxlength="4" value="${esc(n.prosector)}" ${dis} style="text-transform:uppercase"></div>
      <div class="field"><label for="f-bw">Body weight (g)</label><input id="f-bw" data-k="bodyWeight" type="number" step="0.1" min="0" value="${n.bodyWeight ?? ''}" ${dis}></div>
      <div class="field"><label for="f-fate">Fate</label><select id="f-fate" data-k="fate" ${dis}>${options(dict.fates, n.fate)}</select></div>
      <div class="field"><label for="f-cond">Condition</label><select id="f-cond" data-k="condition" ${dis}>${options(dict.conditions, n.condition)}</select></div>
      <div class="field"><label for="f-id">Identification</label><select id="f-id" data-k="physicalId" ${dis}>${options(dict.physicalIds, n.physicalId)}</select></div>
      <div class="field"><span class="lbl">Checks</span><div class="checks">
        <label><input type="checkbox" data-k="matchesCageCard" ${n.matchesCageCard ? 'checked' : ''} ${dis}> Matches cage card</label>
        <label><input type="checkbox" data-k="partial" ${n.partial ? 'checked' : ''} ${dis}> Partial necropsy</label></div></div>
      <div class="field"><label for="f-perf">Perfusion</label><select id="f-perf" data-k="perfusion" ${dis}>${options([['', 'None'], ['whole', 'Whole animal'], ['lung', 'Lung'], ['liver', 'Liver']], n.perfusion)}</select></div>
    </div>

    <h2 class="section">Organs</h2>
    <table class="organs">
      <thead><tr><th>Organ</th><th>Weight (g)</th><th>% of body weight</th><th>Block</th><th>Gross findings</th><th></th><th>Not collected</th></tr></thead>
      <tbody>${n.organs.map((o, oi) => organRow(o, oi, dis, dict)).join('')}</tbody>
    </table>
    ${approved ? '' : '<p class="small muted">Tip: press Enter in a weight box to jump to the next organ.</p>'}

    <div class="split section">
      <div>
        <h2>Procedures</h2>
        <div class="checks" style="flex-direction:column; align-items:flex-start; gap:8px">
          ${meta.extras.map((e) => e.kind === 'check'
            ? `<label><input type="checkbox" data-x="${e.key}" ${n.extras[e.key] ? 'checked' : ''} ${dis}> ${esc(e.label)} <span class="small muted">${esc(e.code)}</span></label>`
            : `<label>${esc(e.label)} <input type="number" class="inp" style="width:80px" min="0" max="200" data-x="${e.key}" value="${n.extras[e.key] || 0}" ${dis}> <span class="small muted">${esc(e.code)}</span></label>`).join('')}
        </div>
        <h3 class="section">Observations</h3>
        <div class="field"><textarea data-k="observations" maxlength="2000" aria-label="Observations" ${dis}>${esc(n.observations)}</textarea></div>
      </div>
      <div>
        <h2>${approved ? 'Charged at approval' : 'Charges on approval'}</h2>
        <p class="small muted">${approved ? 'These went to billing QC when the necropsy was approved.' : 'Approving the necropsy records the work and creates these charges for billing QC. Nothing is charged for a no-charge request.'}</p>
        <table class="t" id="plan"><tbody>${willCharge.map(([code, units]) => {
          const it = price(code);
          return `<tr><td class="code">${esc(code)}</td><td>${esc(it?.description || '')}</td><td class="n">${units}</td><td class="n">${it?.price == null ? '' : money(it.price * units)}</td></tr>`;
        }).join('')}</tbody></table>
        ${n.history?.length ? `<h3 class="section">History</h3><ul class="small muted" style="padding-left:18px">${n.history.slice().reverse().map((h) => `<li>${fmtDateTime(h.at)} ${esc(h.by)}: ${esc(h.action)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>

    ${approved ? '' : `<div class="actions"><button class="btn quiet" type="button" id="save">Save draft</button><button class="btn" type="button" id="approve">Approve necropsy</button></div>`}`;

  wire(app, d, meta, pl);
}

function findingChip(f, oi, fi, dis) {
  const size = f.sizeMm ? `${f.sizeMm} mm` : '';
  const txt = [f.site, [f.qty > 1 ? f.qty : '', f.morphology].filter(Boolean).join(' '), f.shape, f.color, f.consistency, size].filter(Boolean).join(', ') + (f.fixation?.length ? ` (${f.fixation.join(', ')})` : '');
  return `<span class="finding">${esc(txt || 'Incomplete finding')}${dis ? '' : `<button type="button" data-edit="${oi}:${fi}" aria-label="Edit finding">Edit</button><button type="button" data-del="${oi}:${fi}" aria-label="Remove finding">×</button>`}</span>`;
}

// The protocol's instructions for an organ; formalin is the default and not repeated on every row.
const organNotes = (o) => [o.fixative && !/^(10% ?NBF|10% neutral buffered formalin|NBF|formalin)$/i.test(o.fixative) ? o.fixative : '', o.freeze, o.measure ? 'measure' : '', o.instructions].filter(Boolean).join('; ');

function organRow(o, oi, dis, dict) {
  const rel = o.weight > 0 && n.bodyWeight > 0 ? ((o.weight / n.bodyWeight) * 100).toFixed(3) : '';
  const row = `
    <tr class="${o.notCollected ? 'nc' : ''}">
      <td class="organ">${esc(o.organ)}${organNotes(o) ? `<br><span class="small muted">${esc(organNotes(o))}</span>` : ''}</td>
      <td>${o.weigh ? `<input class="w" type="number" step="0.001" min="0" data-ow="${oi}" value="${o.weight ?? ''}" aria-label="${esc(o.organ)} weight in grams" ${dis || (o.notCollected ? 'disabled' : '')}>` : '<span class="muted small">not weighed</span>'}</td>
      <td class="muted" data-rel="${oi}">${rel}</td>
      <td><input class="blk" maxlength="6" data-ob="${oi}" value="${o.block ?? ''}" aria-label="${esc(o.organ)} block number" ${dis}></td>
      <td>${o.findings.length ? o.findings.map((f, fi) => findingChip(f, oi, fi, dis)).join('') : '<span class="nsf">No significant findings</span>'}</td>
      <td>${dis || o.notCollected ? '' : `<button class="btn small quiet" type="button" data-add="${oi}">Add finding</button>`}</td>
      <td class="mid"><input type="checkbox" data-onc="${oi}" ${o.notCollected ? 'checked' : ''} aria-label="${esc(o.organ)} not collected" ${dis}></td>
    </tr>`;
  if (!editing || editing.o !== oi) return row;
  const f = editing.f >= 0 ? o.findings[editing.f] : { site: '', morphology: '', shape: '', color: '', consistency: '', qty: '', sizeMm: '', fixation: ['NBF'], notes: '' };
  return row + `
    <tr class="fedit"><td></td><td colspan="6">
      <div class="form" id="fform">
        <div class="field"><label for="fe-m">Morphology</label><select id="fe-m">${options(dict.morphology, f.morphology, { blank: 'Choose' })}</select></div>
        <div class="field"><label for="fe-s">Site</label><select id="fe-s">${options(dict.sites, f.site, { blank: 'None' })}</select></div>
        <div class="field"><label for="fe-q">Number</label><input id="fe-q" type="number" min="1" value="${f.qty ?? ''}"></div>
        <div class="field"><label for="fe-z">Size (mm)</label><input id="fe-z" type="number" min="0" step="0.5" value="${f.sizeMm ?? ''}"></div>
        <div class="field"><label for="fe-sh">Shape</label><select id="fe-sh">${options(dict.shapes, f.shape, { blank: 'None' })}</select></div>
        <div class="field"><label for="fe-c">Color</label><select id="fe-c">${options(dict.colors, f.color, { blank: 'None' })}</select></div>
        <div class="field"><label for="fe-co">Consistency</label><select id="fe-co">${options(dict.consistencies, f.consistency, { blank: 'None' })}</select></div>
        <div class="field"><span class="lbl">Fixation</span><div class="checks">${dict.fixation.map((x) => `<label><input type="checkbox" class="fe-fx" value="${x}" ${f.fixation?.includes(x) ? 'checked' : ''}> ${x}</label>`).join('')}</div></div>
        <div class="field full"><label for="fe-n">Notes</label><input id="fe-n" maxlength="300" value="${esc(f.notes || '')}"></div>
        <div class="full row"><button class="btn small" type="button" id="fe-save">Save finding</button><button class="btn small quiet" type="button" id="fe-cancel">Cancel</button></div>
      </div>
    </td></tr>`;
}

function chargePlan(meta) {
  const plan = [[n.partial ? 'HP002022' : 'HP002001', 1]];
  if (n.perfusion) plan.push([meta.perfusionCodes[n.perfusion], 1]);
  for (const e of meta.extras) {
    const v = n.extras[e.key];
    if (e.kind === 'check' && v) plan.push([e.code, 1]);
    if (e.kind === 'count' && v > 0) plan.push([e.code, v]);
  }
  return plan;
}

function wire(app, d, meta, pl) {
  // Redraw the page but keep keyboard focus on the same control.
  const redraw = () => {
    const a = document.activeElement;
    const sel = a && a.dataset && Object.keys(a.dataset).length
      ? Object.entries(a.dataset).map(([k, v]) => `[data-${k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())}="${v}"]`).join('') : null;
    draw(app, d, meta, pl);
    if (sel) $(sel, app)?.focus();
  };
  const mark = () => { dirty = true; };
  const numOrNull = (v) => (v === '' ? null : Number(v));

  $$('[data-k]', app).forEach((el) => el.addEventListener(el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : 'input', () => {
    const k = el.dataset.k;
    n[k] = el.type === 'checkbox' ? el.checked : k === 'bodyWeight' ? numOrNull(el.value) : el.value;
    mark();
    if (k === 'bodyWeight') n.organs.forEach((o, oi) => { const c = $(`[data-rel="${oi}"]`, app); if (c) c.textContent = o.weight > 0 && n.bodyWeight > 0 ? ((o.weight / n.bodyWeight) * 100).toFixed(3) : ''; });
    if (k === 'partial' || k === 'perfusion') redraw();
  }));
  $$('[data-x]', app).forEach((el) => el.addEventListener('change', () => {
    n.extras[el.dataset.x] = el.type === 'checkbox' ? el.checked : Math.max(0, parseInt(el.value, 10) || 0);
    mark(); redraw();
  }));
  const weights = $$('[data-ow]', app);
  weights.forEach((el, i) => {
    el.addEventListener('input', () => {
      const oi = Number(el.dataset.ow);
      n.organs[oi].weight = numOrNull(el.value); mark();
      const o = n.organs[oi];
      $(`[data-rel="${oi}"]`, app).textContent = o.weight > 0 && n.bodyWeight > 0 ? ((o.weight / n.bodyWeight) * 100).toFixed(3) : '';
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); (weights[i + 1] || $('#save') || el).focus(); } });
  });
  $$('[data-ob]', app).forEach((el) => el.addEventListener('input', () => { const v = el.value.trim().toUpperCase(); n.organs[Number(el.dataset.ob)].block = v === '' ? null : (/^\d+$/.test(v) ? Number(v) : v); mark(); }));
  $$('[data-onc]', app).forEach((el) => el.addEventListener('change', () => { const o = n.organs[Number(el.dataset.onc)]; o.notCollected = el.checked; if (el.checked) o.weight = null; mark(); redraw(); }));
  $$('[data-add]', app).forEach((b) => b.addEventListener('click', () => { editing = { o: Number(b.dataset.add), f: -1 }; redraw(); $('#fe-m')?.focus(); }));
  $$('[data-edit]', app).forEach((b) => b.addEventListener('click', () => { const [o, f] = b.dataset.edit.split(':').map(Number); editing = { o, f }; redraw(); $('#fe-m')?.focus(); }));
  $$('[data-del]', app).forEach((b) => b.addEventListener('click', () => { const [o, f] = b.dataset.del.split(':').map(Number); n.organs[o].findings.splice(f, 1); mark(); redraw(); }));
  $('#fe-cancel')?.addEventListener('click', () => { editing = null; redraw(); });
  $('#fe-save')?.addEventListener('click', () => {
    const m = $('#fe-m').value;
    if (!m) { toast('Choose a morphology for the finding.', 'error'); $('#fe-m').focus(); return; }
    const f = { site: $('#fe-s').value, morphology: m, qty: numOrNull($('#fe-q').value), sizeMm: numOrNull($('#fe-z').value), shape: $('#fe-sh').value,
      color: $('#fe-c').value, consistency: $('#fe-co').value, fixation: $$('.fe-fx:checked', app).map((x) => x.value), notes: $('#fe-n').value };
    const list = n.organs[editing.o].findings;
    if (editing.f >= 0) list[editing.f] = { ...list[editing.f], ...f }; else list.push(f);
    editing = null; mark(); redraw();
  });

  const save = async () => { const res = await api('PUT', `/api/necropsy/${d.subject.id}`, n); dirty = false; return res; };
  const go = async (id) => { if (dirty && n.status !== 'APPROVED') await save(); navigate(`#/necropsy/${id}`); };
  $('#prev')?.addEventListener('click', (e) => act(e.currentTarget, () => go(d.prevId)));
  $('#next')?.addEventListener('click', (e) => act(e.currentTarget, () => go(d.nextId)));
  $('#save')?.addEventListener('click', (e) => act(e.currentTarget, async () => { const res = await save(); Object.assign(d, res); n = structuredClone(res.necropsy); redraw(); }, 'Draft saved'));
  $('#approve')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
    const res = await api('POST', `/api/necropsy/${d.subject.id}/approve`, n);
    dirty = false; Object.assign(d, res); n = structuredClone(res.necropsy); redraw();
    return res;
  }, (res) => `Necropsy approved. ${res.charges.length} charges created for billing QC.${res.nextId ? ' Use Next animal to continue.' : ''}`));
  $('#unapprove')?.addEventListener('click', (e) => {
    const reason = prompt('Why does this necropsy need correcting? Its pending charges will be voided.', '');
    if (!reason) return;
    act(e.currentTarget, async () => { const res = await api('POST', `/api/necropsy/${d.subject.id}/unapprove`, { reason }); Object.assign(d, res); n = structuredClone(res.necropsy); redraw(); }, 'Necropsy unapproved; you can edit it now');
  });
}
