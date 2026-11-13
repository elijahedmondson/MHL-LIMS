// The pathology library: organs and diagnoses with their INHAND organ system and SEND mapping, importing the
// official SEND controlled terminology from NCI EVS, and adding or correcting terms.
import { $, $$, api, esc, fmtDateTime, getMeta, act, pageTop, options, download } from '../ui.js';
import { parseEvsTerminology, SEND_LISTS } from '../lib/terminology.mjs';

let view = { tab: 'diagnoses', system: '', organ: '', q: '', unchecked: false };

const sendBadge = (send) => (!send?.term && !send?.spec ? '<span class="muted small">none</span>'
  : send.verified ? `<span class="badge complete" title="NCI code ${esc(send.code)}">SEND ✓</span>` : '<span class="badge warn" title="Not yet checked against the official SEND terminology">to check</span>');

export async function renderTerminology(app) {
  const meta = await getMeta();
  const lib = await api('GET', '/api/library');
  const sys = (k) => lib.systems.find((s) => s.key === k)?.name || 'Any tissue';
  const organNames = lib.organs.map((o) => o.name);
  const draw = () => {
    const words = view.q.toLowerCase().split(/\s+/).filter(Boolean);
    const dx = lib.diagnoses.filter((d) => (!view.system || d.system === view.system) && (!view.organ || d.organs.includes(view.organ) || d.organs[0] === '*')
      && (!view.unchecked || !d.send?.verified) && words.every((w) => `${d.term} ${d.send?.term || ''}`.toLowerCase().includes(w)));
    const organs = lib.organs.filter((o) => (!view.system || o.system === view.system) && (!view.unchecked || (o.send?.spec && !o.send.verified))
      && words.every((w) => `${o.name} ${o.send?.spec || ''}`.toLowerCase().includes(w)));
    app.innerHTML = `
      <p class="crumb"><a href="#/pathology">Pathology</a></p>
      <h1>Organ and diagnosis library</h1>
      <p class="muted">The terms offered when entering diagnoses. The starter list follows INHAND nomenclature, grouped by the INHAND organ-system guides; each term carries the SEND value it would be submitted as. ${esc(lib.source)}${lib.updatedAt ? `, changed ${fmtDateTime(lib.updatedAt)}` : ''}.</p>
      <div class="split wide-left">
        <div>
          <div class="toolbar">
            <nav class="subtabs" aria-label="Library sections">
              <a href="#" data-t="diagnoses" ${view.tab === 'diagnoses' ? 'aria-current="page"' : ''}>Diagnoses (${lib.counts.diagnoses})</a>
              <a href="#" data-t="organs" ${view.tab === 'organs' ? 'aria-current="page"' : ''}>Organs (${lib.counts.organs})</a>
            </nav>
          </div>
          <div class="filters">
            <input id="q" value="${esc(view.q)}" placeholder="Search terms or SEND values" aria-label="Search">
            <select id="sys" aria-label="INHAND system">${options(lib.systems.map((s) => [s.key, s.name]), view.system, { blank: 'All organ systems' })}</select>
            ${view.tab === 'diagnoses' ? `<select id="org" aria-label="Organ">${options(organNames, view.organ, { blank: 'Any organ' })}</select>` : ''}
            <label class="small"><input type="checkbox" id="unc" ${view.unchecked ? 'checked' : ''}> Not yet checked against SEND</label>
          </div>
          ${view.tab === 'diagnoses' ? `
          <table class="t"><thead><tr><th>Term</th><th>Organs</th><th>INHAND system</th><th>SEND</th><th class="n">Used</th><th></th></tr></thead><tbody>
            ${dx.slice(0, 300).map((d) => `<tr class="${d.active === false ? 'muted' : ''}"><td><strong>${esc(d.term)}</strong>${d.neoplasm ? ' <span class="badge">neoplasm</span>' : ''}${d.active === false ? ' <span class="badge muted">inactive</span>' : ''}
                <br><span class="small muted">${esc(d.source === 'zaphod' ? 'from Zaphod' : d.source === 'lab' ? 'added by the lab' : d.source === 'inhand' ? 'INHAND starter' : 'pilot starter')}</span></td>
              <td class="small">${d.organs[0] === '*' ? 'Any tissue' : esc(d.organs.join(', '))}</td><td class="small">${esc(sys(d.system))}</td>
              <td class="small">${esc(d.send?.list || '')} ${esc(d.send?.term || '')} ${sendBadge(d.send)}${d.send?.code ? `<br><span class="muted">${esc(d.send.code)}</span>` : ''}</td>
              <td class="n">${d.usedIn || ''}</td><td><button class="btn small quiet" type="button" data-edx="${esc(d.term)}">Edit</button></td></tr>`).join('') || '<tr><td colspan="6" class="muted">Nothing matches.</td></tr>'}
          </tbody></table>${dx.length > 300 ? `<p class="small muted">Showing 300 of ${dx.length}; narrow the search.</p>` : ''}
          <div class="actions" style="margin-top:8px"><button class="btn small quiet" type="button" id="newdx">Add a diagnosis</button></div>`
          : `
          <table class="t"><thead><tr><th>Organ</th><th>Sex</th><th>Paired</th><th>INHAND system</th><th>SEND specimen</th><th></th></tr></thead><tbody>
            ${organs.map((o) => `<tr><td><strong>${esc(o.name)}</strong></td><td>${o.sex === 'M' ? 'Male' : o.sex === 'F' ? 'Female' : 'Both'}</td><td>${o.paired ? 'Yes' : ''}</td>
              <td class="small">${esc(sys(o.system))}</td><td class="small">${esc(o.send?.spec || '')} ${sendBadge(o.send)}${o.send?.code ? `<br><span class="muted">${esc(o.send.code)}</span>` : ''}</td>
              <td><button class="btn small quiet" type="button" data-eorg="${esc(o.name)}">Edit</button></td></tr>`).join('')}
          </tbody></table>
          <div class="actions" style="margin-top:8px"><button class="btn small quiet" type="button" id="neworg">Add an organ</button></div>`}
          <div id="editor"></div>
        </div>
        <div>
          <div class="panel">
            <h2>SEND controlled terminology</h2>
            ${lib.sendCt ? `<p class="small">Loaded <strong>${esc(lib.sendCt.fileName)}</strong> on ${fmtDateTime(lib.sendCt.importedAt)} by ${esc(lib.sendCt.importedBy)}:
              ${Object.entries(lib.sendCt.lists).map(([k, l]) => `${esc(k)} ${l.terms}`).join(', ')} terms.</p>
              <p class="small">${lib.counts.verified} library entries match it; ${lib.counts.unverified} need a SEND value chosen.</p>`
              : '<p class="small">Not loaded yet, so every SEND value here is the pilot\'s best guess. Load the official file to check them all and add the NCI codes.</p>'}
            <ol class="small">
              <li>Download <strong>SEND Terminology.txt</strong> from the NCI EVS CDISC page (evs.nci.nih.gov, CDISC, SEND). It is free and public.</li>
              <li>Choose it here. The file is read on this computer; only the codelists the library uses (${SEND_LISTS.join(', ')}) are kept.</li>
            </ol>
            <input type="file" id="evs" accept=".txt,text/plain" aria-label="SEND Terminology.txt">
            <p class="small muted" id="evsmsg"></p>
          </div>
          <div class="panel section">
            <h2>INHAND guides</h2>
            <p class="small">The diagnostic criteria behind each term are in the INHAND guide for its organ system, published in Toxicologic Pathology and the Journal of Toxicologic Pathology, and online with images at goRENI (goreni.org, free registration).</p>
            <ul class="small">${lib.systems.filter((s) => s.guide).map((s) => `<li>${esc(s.name)}: ${esc(s.guide)}</li>`).join('')}</ul>
          </div>
          <div class="actions section"><button class="btn quiet" type="button" id="csv">Download the library (CSV)</button></div>
          ${lib.zaphodLists ? `<div class="panel section"><h2>Zaphod lists</h2><p class="small">Severity: ${esc(lib.zaphodLists.severity.join(', ') || 'none')}<br>Distribution: ${esc(lib.zaphodLists.distribution.join(', ') || 'none')}<br>Neoplasm: ${esc(lib.zaphodLists.neoplasm.join(', ') || 'none')}<br>H/N: ${esc(lib.zaphodLists.hn.join(', ') || 'none')}</p></div>` : ''}
        </div>
      </div>`;
    pageTop(app);
    $$('[data-t]', app).forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); view.tab = a.dataset.t; draw(); }));
    let t = null;
    $('#q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { view.q = $('#q').value; draw(); $('#q').focus(); $('#q').setSelectionRange(view.q.length, view.q.length); }, 250); });
    $('#sys').addEventListener('change', () => { view.system = $('#sys').value; draw(); });
    $('#org')?.addEventListener('change', () => { view.organ = $('#org').value; draw(); });
    $('#unc').addEventListener('change', () => { view.unchecked = $('#unc').checked; draw(); });
    $('#csv').addEventListener('click', (e) => act(e.currentTarget, () => download('/api/library/export.csv')));
    $$('[data-edx]', app).forEach((b) => b.addEventListener('click', () => editDiagnosis(lib.diagnoses.find((d) => d.term === b.dataset.edx))));
    $('#newdx')?.addEventListener('click', () => editDiagnosis(null));
    $$('[data-eorg]', app).forEach((b) => b.addEventListener('click', () => editOrgan(lib.organs.find((o) => o.name === b.dataset.eorg))));
    $('#neworg')?.addEventListener('click', () => editOrgan(null));
    $('#evs').addEventListener('change', async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      $('#evsmsg').textContent = 'Reading the file…';
      await act(null, async () => {
        const parsed = parseEvsTerminology(await f.text());
        $('#evsmsg').textContent = `Found ${parsed.totalCodelists} codelists; keeping ${Object.keys(parsed.codelists).join(', ')} (${parsed.terms} terms).`;
        const res = await api('POST', '/api/library/send-ct', { fileName: f.name, codelists: parsed.codelists });
        await getMeta(true);
        await renderTerminology(app);
        return res;
      }, (res) => `SEND terminology loaded: ${res.verified} library entries matched, ${res.unmatched} to review.`);
    });
  };

  const sendPicker = (list, current) => `
    <div class="field full"><label for="e-send">SEND value (${esc(list)})</label><input id="e-send" value="${esc(current || '')}" maxlength="300" style="text-transform:uppercase">
      ${lib.sendCt ? `<span class="small muted">Type to search the official ${esc(list)} codelist.</span><ul class="found-list" id="e-hits"></ul>` : '<span class="small muted">Load the SEND terminology to search and check it.</span>'}</div>`;
  const wireSendSearch = (listOf) => {
    if (!lib.sendCt) return;
    let st = null;
    $('#e-send').addEventListener('input', () => {
      clearTimeout(st);
      st = setTimeout(async () => {
        const q = $('#e-send').value.trim();
        if (q.length < 3) { $('#e-hits').innerHTML = ''; return; }
        const res = await api('GET', `/api/library/send-search?list=${listOf()}&q=${encodeURIComponent(q)}`);
        $('#e-hits').innerHTML = res.terms.map((x) => `<li><div><strong>${esc(x.value)}</strong> <span class="small muted">${esc(x.code)}</span>${x.synonyms.length ? `<br><span class="small muted">${esc(x.synonyms.join('; '))}</span>` : ''}</div>
          <div><button class="btn small quiet" type="button" data-use="${esc(x.value)}">Use</button></div></li>`).join('') || '<li class="small muted">No match.</li>';
        $$('[data-use]', app).forEach((b) => b.addEventListener('click', () => { $('#e-send').value = b.dataset.use; $('#e-hits').innerHTML = ''; }));
      }, 200);
    });
  };

  function editDiagnosis(d) {
    $('#editor').innerHTML = `
      <div class="panel section"><h3>${d ? `Edit ${esc(d.term)}` : 'Add a diagnosis'}</h3>
      ${d?.usedIn ? `<p class="small muted">Used in ${d.usedIn} diagnoses. Cases keep the wording they were signed with; renaming affects new entries.</p>` : ''}
      <form class="form" id="dxform" style="grid-template-columns:1fr 1fr">
        <div class="field full"><label for="e-term">Term (INHAND style: lesion, then qualifier)</label><input id="e-term" value="${esc(d?.term || '')}" maxlength="160" required></div>
        <div class="field"><label for="e-sys">INHAND organ system</label><select id="e-sys">${options(lib.systems.map((s) => [s.key, s.name]), d?.system || 'general')}</select></div>
        <div class="field"><label><input type="checkbox" id="e-neo" ${d?.neoplasm ? 'checked' : ''}> Neoplasm (SEND NEOPLASM list)</label><label><input type="checkbox" id="e-act" ${d?.active === false ? '' : 'checked'}> Offered when entering diagnoses</label></div>
        <div class="field full"><label for="e-org">Organs (hold Ctrl to choose several; none = any tissue)</label>
          <select id="e-org" multiple size="6">${options(organNames, '')}</select></div>
        ${sendPicker(d?.send?.list || 'NONNEO', d?.send?.term)}
        <div class="full"><button class="btn" type="submit">Save</button> <button class="btn quiet" type="button" id="e-cancel">Cancel</button></div>
      </form></div>`;
    const sel = $('#e-org');
    [...sel.options].forEach((o) => { o.selected = !!d && d.organs.includes(o.value); });
    wireSendSearch(() => ($('#e-neo').checked ? 'NEOPLASM' : 'NONNEO'));
    $('#e-cancel').addEventListener('click', () => { $('#editor').innerHTML = ''; });
    $('#dxform').addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        const res = await api('POST', '/api/library/diagnoses', { original: d?.term || '', term: $('#e-term').value, system: $('#e-sys').value, neoplasm: $('#e-neo').checked,
          active: $('#e-act').checked, organs: [...sel.selectedOptions].map((o) => o.value), sendTerm: $('#e-send').value });
        await getMeta(true);
        await renderTerminology(app);
        return res;
      }, (res) => (res.diagnosis.send.verified ? `Saved; matches SEND ${res.diagnosis.send.term}` : 'Saved'));
    });
    $('#e-term').focus();
  }

  function editOrgan(o) {
    $('#editor').innerHTML = `
      <div class="panel section"><h3>${o ? `Edit ${esc(o.name)}` : 'Add an organ'}</h3>
      <form class="form" id="orgform" style="grid-template-columns:1fr 1fr">
        <div class="field"><label for="o-name">Organ</label><input id="o-name" value="${esc(o?.name || '')}" maxlength="80" required></div>
        <div class="field"><label for="o-sys">INHAND organ system</label><select id="o-sys">${options(lib.systems.map((s) => [s.key, s.name]), o?.system || 'general')}</select></div>
        <div class="field"><label for="o-sex">Sex</label><select id="o-sex">${options([['N', 'Both'], ['M', 'Male only'], ['F', 'Female only']], o?.sex || 'N')}</select></div>
        <div class="field"><label><input type="checkbox" id="o-pair" ${o?.paired ? 'checked' : ''}> Paired (left and right)</label><label><input type="checkbox" id="o-act" ${o?.active === false ? '' : 'checked'}> In use</label></div>
        ${sendPicker('SPEC', o?.send?.spec)}
        <div class="full"><button class="btn" type="submit">Save</button> <button class="btn quiet" type="button" id="e-cancel">Cancel</button></div>
      </form></div>`;
    wireSendSearch(() => 'SPEC');
    $('#e-cancel').addEventListener('click', () => { $('#editor').innerHTML = ''; });
    $('#orgform').addEventListener('submit', (e) => {
      e.preventDefault();
      act(e.submitter, async () => {
        const res = await api('POST', '/api/library/organs', { original: o?.name || '', name: $('#o-name').value, system: $('#o-sys').value, sex: $('#o-sex').value,
          paired: $('#o-pair').checked, active: $('#o-act').checked, spec: $('#e-send').value });
        await getMeta(true);
        await renderTerminology(app);
        return res;
      }, 'Saved');
    });
  }
  draw();
  return meta;
}
