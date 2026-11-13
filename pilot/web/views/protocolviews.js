// Necropsy and trim protocols (Zaphod's model): the list, import from Zaphod or from a pasted table, and the editor.
import { $, $$, api, esc, fmtDate, fmtDateTime, getMeta, act, pageTop, options, navigate, toast } from '../ui.js';

const flagBadges = (p) => `${p.obsolete ? '<span class="badge muted">Obsolete</span>' : p.approved ? '<span class="badge complete">Approved</span>' : '<span class="badge warn">Not approved</span>'}
  ${p.source === 'zaphod' ? '<span class="badge info">From Zaphod</span>' : p.source === 'starter' ? '<span class="badge">Pilot placeholder</span>' : ''}`;

export async function renderProtocols(app) {
  const list = await api('GET', '/api/protocols');
  const table = (kind, rows) => `
    <table class="t"><thead><tr><th>Name</th><th class="n">${kind === 'trim' ? 'Organs' : 'Steps'}</th><th class="n">Studies</th><th>Status</th></tr></thead><tbody>
      ${rows.map((p) => `<tr class="click" data-href="#/protocol/${kind}/${p.id}"><td><a href="#/protocol/${kind}/${p.id}">${esc(p.name)}</a>${p.description ? `<br><span class="small muted">${esc(p.description)}</span>` : ''}</td>
        <td class="n">${p.rows}</td><td class="n">${p.studies}</td><td>${flagBadges(p)}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">None yet.</td></tr>'}
    </tbody></table>
    <div class="actions" style="margin-top:8px"><button class="btn small quiet" type="button" data-new="${kind}">New ${kind} protocol</button></div>`;
  app.innerHTML = `
    <p class="crumb"><a href="#/necropsy">Necropsy</a></p>
    <h1>Protocols</h1>
    <p class="muted">As in Zaphod, a study names a <strong>necropsy protocol</strong> (the organs to collect, in order, with fixative, freezing and whether to weigh or measure) and a <strong>trim protocol</strong> (which block each organ goes in, by sex). When a necropsy starts, the animal's organ list is built from both.</p>
    <div class="split even section">
      <div><h2>Necropsy protocols</h2>${table('necropsy', list.necropsy)}</div>
      <div><h2>Trim protocols</h2>${table('trim', list.trim)}</div>
    </div>
    <h2 class="section">Import</h2>
    <div class="split even">
      <div class="panel">
        <h3>From Zaphod</h3>
        <p class="small">Run <code>lims/tools/zaphod-export/export_zaphod_reference.sql</code> against the Zaphod database (it only reads) and choose the JSON file it saves. It brings every protocol, which study uses which, Zaphod's dictionaries and the bloodwork reference ranges. You see what would change before anything is imported.</p>
        <input type="file" id="zfile" accept=".json,.txt,application/json" aria-label="Zaphod export file">
        <div id="zplan"></div>
      </div>
      <div class="panel">
        <h3>From a table</h3>
        <p class="small">Copy a protocol table from Excel (for example Zaphod's Necropsy Protocol or Trim Protocol report, exported to Excel or CSV) with its header row, and paste it here. Columns are recognized by name: Organ, Sequence, Fixative, Freeze, Weigh Organ, Measure Organ, Block No., Sex, Description.</p>
        <form class="form" id="tform" style="grid-template-columns:1fr 1fr">
          <div class="field"><label for="tname">Protocol name</label><input id="tname" maxlength="120" placeholder="Used if the table has no ProtocolName column"></div>
          <div class="field"><label for="tkind">Import as</label><select id="tkind">${options([['', 'Whatever the columns show'], ['necropsy', 'Necropsy protocol'], ['trim', 'Trim protocol']], '')}</select></div>
          <div class="field full"><label for="ttext">Table</label><textarea id="ttext" style="min-height:120px;font-family:var(--mono, monospace)" placeholder="Organ&#9;Fixative&#9;Weigh Organ&#10;Brain&#9;10% NBF&#9;Yes"></textarea></div>
          <div class="full"><button class="btn quiet" type="submit">Import table</button></div>
        </form>
      </div>
    </div>`;
  pageTop(app);
  $$('tr.click', app).forEach((tr) => tr.addEventListener('click', (e) => { if (!e.target.closest('a')) location.hash = tr.dataset.href; }));
  $$('[data-new]', app).forEach((b) => b.addEventListener('click', () => act(b, async () => {
    const name = prompt(`Name of the new ${b.dataset.new} protocol`);
    if (!name) return undefined;
    const res = await api('POST', `/api/protocols/${b.dataset.new}`, { name });
    navigate(`#/protocol/${b.dataset.new}/${res.id}`);
    return res;
  }, 'Protocol created')));

  let zText = '';
  $('#zfile').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    zText = await f.text();
    await act(null, async () => {
      const { plan } = await api('POST', '/api/protocols/import?preview=1', { format: 'zaphod', text: zText });
      const d = plan.dictionaries;
      $('#zplan').innerHTML = `
        <h4 class="section">What this file would change</h4>
        <p class="small muted">${plan.database ? `Database ${esc(plan.database)}, ` : ''}${plan.exportedAt ? `exported ${esc(plan.exportedAt.replace('T', ' '))}` : ''}</p>
        <ul class="small">
          <li>${plan.necropsy.length} necropsy protocols (${plan.necropsy.filter((p) => p.action === 'add').length} new, ${plan.necropsy.filter((p) => p.action === 'update').length} replacing ones with the same name)</li>
          <li>${plan.trim.length} trim protocols (${plan.trim.filter((p) => p.action === 'add').length} new, ${plan.trim.filter((p) => p.action === 'update').length} replacing)</li>
          <li>${plan.studies.length} studies in Zaphod, ${plan.studies.filter((s) => s.inPilot).length} of them also in the pilot</li>
          ${d ? `<li>${d.organs} organs (${d.newOrgans} new) and ${d.diagnoses} diagnoses (${d.newDiagnoses} new)</li>
          <li>Necropsy lists: ${Object.entries(d.lists).filter(([, n]) => n).map(([k, n]) => `${esc(k)} ${n}`).join(', ') || 'none'}</li>
          <li>Reference ranges for ${d.chemistryRanges} chemistry and ${d.hematologyRanges} hematology species</li>` : ''}
        </ul>
        <div class="checks" style="flex-direction:column;align-items:flex-start">
          <label><input type="checkbox" id="zo-link" checked> Point matching pilot studies (same ZAP#) at their Zaphod protocols</label>
          ${d ? `<label><input type="checkbox" id="zo-dict" checked> Add Zaphod's organs and diagnoses to the library and use its necropsy lists</label>
          <label><input type="checkbox" id="zo-ranges" checked> Load the bloodwork reference ranges</label>` : ''}
        </div>
        <div class="actions"><button class="btn" type="button" id="zgo">Import</button></div>`;
      $('#zgo').addEventListener('click', (ev) => act(ev.currentTarget, async () => {
        const res = await api('POST', '/api/protocols/import', { format: 'zaphod', text: zText,
          options: { linkStudies: $('#zo-link').checked, dictionaries: !!$('#zo-dict')?.checked, ranges: !!$('#zo-ranges')?.checked } });
        await getMeta(true);
        await renderProtocols(app);
        return res;
      }, (res) => `Imported. ${res.linked} studies linked, ${res.organsAdded} organs and ${res.diagnosesAdded} diagnoses added, ${res.rangesLoaded} reference ranges.`));
    });
  });
  $('#tform').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const res = await api('POST', '/api/protocols/import', { format: 'table', text: $('#ttext').value, name: $('#tname').value, kind: $('#tkind').value });
      await getMeta(true);
      await renderProtocols(app);
      return res;
    }, (res) => `Imported ${res.plan.necropsy.length ? 'a necropsy protocol' : ''}${res.plan.necropsy.length && res.plan.trim.length ? ' and ' : ''}${res.plan.trim.length ? 'a trim protocol' : ''}. Approve it before studies use it.`);
  });
}

export async function renderProtocol(app, kind, id) {
  const meta = await getMeta();
  const d = await api('GET', `/api/protocols/${kind}/${id}`);
  const p = d.protocol;
  const trim = kind === 'trim';
  let rows = structuredClone(trim ? p.organs : p.steps);
  const fixatives = [...new Set(['', ...(meta.protocols.fixatives || []), ...rows.map((r) => r.fixative || '')])];
  const freezes = [...new Set(['', ...(meta.protocols.freezes || []), ...rows.map((r) => r.freeze || '')])];
  const locked = p.obsolete;
  const draw = () => {
    app.innerHTML = `
      <p class="crumb"><a href="#/necropsy">Necropsy</a> › <a href="#/protocols">Protocols</a></p>
      <h1>${esc(p.name)} <span class="small muted">${trim ? 'Trim protocol' : 'Necropsy protocol'} #${p.id}</span></h1>
      <p>${flagBadges(p)} ${p.approved ? `<span class="small muted">Approved by ${esc(p.approvedBy)} on ${fmtDate(p.dateApproved)}</span>` : ''}</p>
      ${d.problems.length ? `<p class="note">${d.problems.map(esc).join(' ')}</p>` : ''}
      ${p.approved ? '<p class="small muted">Saving a change to an approved protocol takes its approval away until someone approves it again. Necropsies already started keep the organ list they began with.</p>' : ''}
      <form class="form" id="pform" style="grid-template-columns:1fr 1fr">
        <div class="field"><label for="pn">Name</label><input id="pn" value="${esc(p.name)}" maxlength="120" ${locked ? 'disabled' : ''}></div>
        <div class="field"><label for="pd">Description</label><input id="pd" value="${esc(p.description)}" maxlength="500" ${locked ? 'disabled' : ''}></div>
        ${trim ? '' : `<div class="field"><label><input type="checkbox" id="pw" ${p.weighAnimal ? 'checked' : ''} ${locked ? 'disabled' : ''}> Weigh the animal</label></div>
          <div class="field"><label for="pp">Perfusion (pilot)</label><select id="pp" ${locked ? 'disabled' : ''}>${options([['', 'None'], ['whole', 'Whole animal'], ['lung', 'Lung'], ['liver', 'Liver']], p.perfusion)}</select></div>`}
        <div class="field full"><label for="pi">General instructions</label><textarea id="pi" maxlength="2000" ${locked ? 'disabled' : ''}>${esc(p.instructions)}</textarea></div>
      </form>
      <h2 class="section">${trim ? 'Organs and blocks' : 'Steps'}</h2>
      <table class="t" id="rows"><thead><tr>${trim ? '<th>Block</th><th>Organ</th><th>Sex</th><th>Description</th>' : '<th>#</th><th>Organ</th><th>Fixative</th><th>Freeze</th><th>Weigh</th><th>Measure</th><th>Description</th>'}<th></th></tr></thead>
        <tbody>${rows.map((r, i) => (trim ? `<tr>
          <td><input data-r="${i}" data-f="block" value="${esc(r.block)}" maxlength="10" style="width:60px" aria-label="Block" ${locked ? 'disabled' : ''}></td>
          <td><input data-r="${i}" data-f="organ" value="${esc(r.organ)}" list="porgans" maxlength="80" aria-label="Organ" ${locked ? 'disabled' : ''}></td>
          <td><select data-r="${i}" data-f="sex" aria-label="Sex" ${locked ? 'disabled' : ''}>${options([['N', 'Both'], ['M', 'Male'], ['F', 'Female']], r.sex)}</select></td>
          <td><input data-r="${i}" data-f="description" value="${esc(r.description)}" maxlength="300" aria-label="Description" ${locked ? 'disabled' : ''}></td>`
          : `<tr><td class="n">${i + 1}</td>
          <td><input data-r="${i}" data-f="organ" value="${esc(r.organ)}" list="porgans" maxlength="80" aria-label="Organ" ${locked ? 'disabled' : ''}></td>
          <td><select data-r="${i}" data-f="fixative" aria-label="Fixative" ${locked ? 'disabled' : ''}>${options(fixatives.map((f) => [f, f || 'None']), r.fixative)}</select></td>
          <td><select data-r="${i}" data-f="freeze" aria-label="Freeze" ${locked ? 'disabled' : ''}>${options(freezes.map((f) => [f, f || 'None']), r.freeze)}</select></td>
          <td class="mid"><input type="checkbox" data-r="${i}" data-f="weigh" ${r.weigh ? 'checked' : ''} aria-label="Weigh" ${locked ? 'disabled' : ''}></td>
          <td class="mid"><input type="checkbox" data-r="${i}" data-f="measure" ${r.measure ? 'checked' : ''} aria-label="Measure" ${locked ? 'disabled' : ''}></td>
          <td><input data-r="${i}" data-f="description" value="${esc(r.description)}" maxlength="300" aria-label="Description" ${locked ? 'disabled' : ''}></td>`)
          + `<td class="rowbtns">${locked ? '' : `<button class="btn small quiet" type="button" data-up="${i}" aria-label="Move up" ${i ? '' : 'disabled'}>↑</button><button class="btn small quiet" type="button" data-rm="${i}" aria-label="Remove row">×</button>`}</td></tr>`).join('')}</tbody>
      </table>
      <datalist id="porgans">${d.organs.map((o) => `<option value="${esc(o.name)}">`).join('')}</datalist>
      ${locked ? '' : `<div class="actions" style="margin-top:8px"><button class="btn small quiet" type="button" id="addrow">Add ${trim ? 'organ' : 'step'}</button></div>`}
      <div class="actions section">
        ${locked ? '<button class="btn" type="button" id="restore">Restore</button>' : `<button class="btn" type="button" id="save">Save</button>
          ${p.approved ? '' : '<button class="btn quiet" type="button" id="approve">Approve</button>'}
          <button class="btn quiet" type="button" id="copy">Copy</button><button class="btn quiet" type="button" id="obsolete">Make obsolete</button>`}
      </div>
      <div class="split section">
        <div><h2>Studies using it</h2>${d.studies.length ? `<ul>${d.studies.map((s) => `<li><a href="#/study/${s.id}">${esc(s.zap)}</a> ${esc(s.title)}</li>`).join('')}</ul>` : '<p class="muted">None.</p>'}</div>
        <div><h2>History</h2>${d.history.length ? `<ul class="small muted">${d.history.map((h) => `<li>${fmtDateTime(h.at)} ${esc(h.by)}: ${esc(h.action.replace('PROTOCOL_', '').toLowerCase())} ${esc(h.detail)}</li>`).join('')}</ul>` : '<p class="muted small">No changes in the pilot yet.</p>'}</div>
      </div>`;
    pageTop(app);
    const readRows = () => {
      $$('[data-r]', app).forEach((el) => { const r = rows[Number(el.dataset.r)]; r[el.dataset.f] = el.type === 'checkbox' ? el.checked : el.value; });
    };
    $('#addrow')?.addEventListener('click', () => { readRows(); rows.push(trim ? { block: '', organ: '', sex: 'N', description: '' } : { organ: '', fixative: '10% NBF', freeze: '', weigh: false, measure: false, description: '' }); draw(); $$(`[data-f="organ"]`, app).at(-1)?.focus(); });
    $$('[data-rm]', app).forEach((b) => b.addEventListener('click', () => { readRows(); rows.splice(Number(b.dataset.rm), 1); draw(); }));
    $$('[data-up]', app).forEach((b) => b.addEventListener('click', () => { readRows(); const i = Number(b.dataset.up); [rows[i - 1], rows[i]] = [rows[i], rows[i - 1]]; draw(); }));
    $('#save')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      readRows();
      const body = { name: $('#pn').value, description: $('#pd').value, instructions: $('#pi').value, [trim ? 'organs' : 'steps']: rows };
      if (!trim) Object.assign(body, { weighAnimal: $('#pw').checked, perfusion: $('#pp').value });
      await api('PUT', `/api/protocols/${kind}/${id}`, body);
      await getMeta(true);
      await renderProtocol(app, kind, id);
    }, 'Protocol saved'));
    const flag = (sel, action, msg, ask) => $(sel)?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      const reason = ask ? prompt(ask) : '';
      if (ask && reason === null) return;
      await api('POST', `/api/protocols/${kind}/${id}/${action}`, { reason });
      await getMeta(true);
      await renderProtocol(app, kind, id);
    }, msg));
    flag('#approve', 'approve', 'Protocol approved');
    flag('#obsolete', 'obsolete', 'Protocol is obsolete', 'Why is it obsolete? (optional)');
    flag('#restore', 'restore', 'Protocol restored');
    $('#copy')?.addEventListener('click', (e) => act(e.currentTarget, async () => {
      const name = prompt('Name of the copy', `${p.name} (copy)`);
      if (!name) return;
      const res = await api('POST', `/api/protocols/${kind}`, { copyFrom: id, name });
      await getMeta(true);
      navigate(`#/protocol/${kind}/${res.id}`);
    }, 'Copied'));
  };
  draw();
  if (!rows.length && !locked) toast('Add the organs, then save and approve.');
}
