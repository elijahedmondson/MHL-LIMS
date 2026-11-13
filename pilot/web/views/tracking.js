// The MHL Request Tracking Form: a landscape sheet printed when a request is created, which staff fill in by hand
// (initials, procedure, units and date under each work area) as the samples move through the lab. Laid out like the
// form PHL.exe printed (d_cmp001), with a new page for each priority and six PHL numbers to a page.
import { $, api, esc, money, fmtDate, pageTop, code128Svg } from '../ui.js';

const PER_PAGE = 6;
let showDone = false;
const shortDate = (iso) => (iso ? `${+iso.slice(5, 7)}/${+iso.slice(8, 10)}/${iso.slice(2, 4)}` : '');
const CHARGE = { C: 'C', L: 'L', N: 'N' };
// Long free text is shortened so the header stays the same height and each sheet prints on one page.
const cut = (v, n) => { const t = String(v || '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1).trimEnd()}…` : t; };

function headerHtml(h, group, page, pages) {
  const f = (label, value, cls = '') => `<span class="ts-f ${cls}"><b>${esc(label)}:</b> ${esc(value || '')}</span>`;
  return `
    <div class="ts-head">
      <div class="ts-left">
        <div class="ts-form small">MHL LIMS pilot</div>
        <div class="ts-lab">${esc(h.lab)}</div>
        <div class="ts-req">Request Id: <b>${esc(h.number)}</b></div>
        <div class="ts-bar">${code128Svg(h.number, 34)}</div>
        <div class="ts-bartext">${esc(h.number)}</div>
      </div>
      <div class="ts-mid">
        <div class="ts-title">MHL Request Tracking Form</div>
        <div>${f('Investigator Last', cut([h.investigatorLast, h.investigatorFirst].filter(Boolean).join(', '), 50))}${f('Tissue Disp', h.tissueDisp)}</div>
        <div>${f('Request Type', h.typeCode)}${f('Fixative', h.fixative)}${f('Species', h.species)}</div>
        <div>${f('Contact', h.contact)}${f('Pathologist', cut(h.pathologist, 60), 'strong')}</div>
        <div>${f('ZAP#', h.zap)}${h.studyTitle ? f('Study', cut(h.studyTitle, 70)) : ''}${h.acuc ? f('ACUC', h.acuc) : ''}${h.webRequestNumber ? f('Web Request Id', h.webRequestNumber) : ''}</div>
      </div>
      <div class="ts-right">
        <div>Received Date: <b>${shortDate(h.received)}</b></div>
        <div class="ts-due">Due Date: ${shortDate(h.due)}</div>
        <div>Charge Type: ${esc(CHARGE[h.chargeType] || h.chargeType)}</div>
        <div class="small">Est. turnaround: ${h.estTurnaroundDays} days</div>
      </div>
    </div>
    <div class="ts-desc"><b>Description:</b> ${esc(cut(h.description, 420))}</div>
    <div class="ts-money">${f('NAS#', h.nasNumber)}${f('Approved Budget Amt', h.approvedBudget != null ? money(h.approvedBudget) : '')}${f('Estimated Cost', money(h.estimatedCost))}
      <span class="ts-prio">Priority: ${esc(group.label)}</span><span class="ts-pg">Page ${page} of ${pages}</span></div>`;
}

function tableHtml(columns, rows) {
  const head = `<tr><th class="ts-phl">Phl No</th>${columns.map((c) => `<th class="ts-area ${c.inRequest ? '' : 'ts-off'}">${esc(c.label).replace('/', '/<br>')}</th><th class="ts-date ${c.inRequest ? '' : 'ts-off'}">Date</th>`).join('')}<th class="ts-lbl"></th></tr>`;
  const body = rows.map((r) => {
    const sub = ['inits', 'proc', 'units'].map((k, i) => `<tr class="ts-sub ts-${k}">
      ${i === 0 ? `<td class="ts-phl" rowspan="3"><div class="ts-phlbox"><b>${esc(r.phl)}</b><span>${r.restricted || !/^\d+$/.test(String(r.label)) ? esc(r.label) : `An# ${esc(r.label)}`}${r.groupCode ? ` · ${esc(r.groupCode)}` : ''}${r.sex ? ` ${esc(r.sex)}` : ''}</span></div></td>` : ''}
      ${columns.map((c) => {
        const d = showDone ? r.done[c.code] : null;
        const parts = d ? shortDate(d.date).split('/') : [];
        return `<td class="ts-area ${c.inRequest ? '' : 'ts-off'}">${d && i === 0 ? esc(d.by) : ''}</td><td class="ts-date ${c.inRequest ? '' : 'ts-off'}">${d ? esc(parts[i] || '') : ''}</td>`;
      }).join('')}
      <td class="ts-lbl">${k}</td></tr>`).join('');
    return `<tbody class="ts-row">${sub}</tbody>`;
  }).join('');
  return `<table class="ts-table"><thead>${head}</thead>${body}</table>`;
}

export async function renderTracking(app, requestId) {
  const t = await api('GET', `/api/requests/${requestId}/tracking-sheet`);
  const h = t.header;
  const draw = () => {
    const pages = [];
    for (const g of t.groups) for (let i = 0; i < g.rows.length; i += PER_PAGE) pages.push({ group: g, rows: g.rows.slice(i, i + PER_PAGE) });
    app.innerHTML = `
      <div class="toolbar noprint">
        <a href="#/request/${requestId}">Back to ${esc(h.number)}</a><span class="spacer"></span>
        <label class="small"><input type="checkbox" id="done" ${showDone ? 'checked' : ''}> Fill in work already recorded in the LIMS</label>
        <button class="btn" type="button" id="print">Print tracking sheet</button>
      </div>
      <p class="small muted noprint">${t.count} PHL numbers on ${pages.length} page${pages.length === 1 ? '' : 's'}, a new page for each priority. Print it landscape on letter paper (the page is set to landscape for Edge and Chrome). Shaded columns are work areas this request does not include.</p>
      <div class="ts-sheets">${pages.map((p, i) => `<section class="ts-page">${headerHtml(h, p.group, i + 1, pages.length)}${tableHtml(t.columns, p.rows)}
        <div class="ts-foot">Printed ${fmtDate(h.printedOn)} · Pilot with test data</div></section>`).join('')}</div>`;
    pageTop(app);
    $('#print').addEventListener('click', () => window.print());
    $('#done').addEventListener('change', (e) => { showDone = e.target.checked; draw(); });
  };
  draw();
}
