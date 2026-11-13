// Printable label sheet for a request: one request label plus one jar label per MHL number.
import { $, api, esc, code128Svg, pageTop, subjectLabel } from '../ui.js';

export async function renderLabels(app, id) {
  const d = await api('GET', `/api/requests/${id}`);
  const r = d.request;
  const labels = [
    { value: r.number, l2: `${r.piName}${d.nas ? `, NAS# ${d.nas.number}` : ''}`, l3: `${d.subjects.length} MHL numbers` },
    ...d.subjects.map((s) => ({ value: s.phl, l2: `${r.number}, ${r.pi.last}`, l3: `${d.study ? `${d.study.zap}, ` : ''}${subjectLabel(s)}${s.groupCode ? `, ${s.groupCode}` : ''}` })),
  ];
  app.innerHTML = `
    <div class="noprint">
      <div class="crumb"><a href="#/request/${r.id}">${esc(r.number)}</a></div>
      <div class="row" style="margin-top:8px"><h1>Labels for ${esc(r.number)}</h1><span class="spacer"></span>
        <button class="btn" type="button" id="print">Print labels</button></div>
      <p class="muted">Prints on any printer from the browser. In production these go to the label printers as ZPL, and slide and cassette labels use DataMatrix codes.</p>
    </div>
    <div class="labels sheet">${labels.map((l) => `
      <div class="label">${code128Svg(l.value)}<div class="l1">${esc(l.value)}</div><div class="l2">${esc(l.l2)}</div><div class="l2">${esc(l.l3)}</div></div>`).join('')}
    </div>`;
  pageTop(app);
  $('#print').addEventListener('click', () => window.print());
}
