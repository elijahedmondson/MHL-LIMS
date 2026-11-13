// Billing: QC queue, releasing a billing batch with its extract file, batch history, and the price list.
import { $, $$, api, esc, money, fmtDate, fmtDateTime, getMeta, getPriceList, sectionName, act, pageTop, download } from '../ui.js';

export async function renderBilling(app, sub) {
  const meta = await getMeta();
  app.innerHTML = `
    <h1>Billing</h1>
    <nav class="subtabs" aria-label="Billing sections">
      <a href="#/billing" ${sub === 'queue' ? 'aria-current="page"' : ''}>QC and release</a>
      <a href="#/billing/prices" ${sub === 'prices' ? 'aria-current="page"' : ''}>Price list</a>
    </nav>
    <div id="tab"></div>`;
  const box = $('#tab');
  if (sub === 'prices') await prices(box, meta); else await queue(box, meta, () => renderBilling(app, sub));
  pageTop(app);
}

const firstOfMonth = (iso, back = 0) => { const d = new Date(iso + 'T12:00:00Z'); d.setUTCMonth(d.getUTCMonth() - back, 1); return d.toISOString().slice(0, 10); };

async function queue(box, meta, reload) {
  const [{ requests }, { batches }] = await Promise.all([api('GET', '/api/billing/queue'), api('GET', '/api/billing/batches')]);
  const pendingTotal = requests.reduce((a, r) => a + r.pending.count, 0);
  box.innerHTML = `
    <div class="split even">
      <div>
        <h2>Billing QC</h2>
        <p class="muted">Charges are pending until someone checks them. Approved charges go into the next billing batch for their lab and date.</p>
        ${requests.length ? `<table class="t">
          <thead><tr><th>Request</th><th class="n">Pending</th><th class="n">Approved</th><th>Last QC</th><th></th></tr></thead>
          <tbody>${requests.map((r) => `
            <tr>
              <td><a class="idtxt" href="#/request/${r.id}/charges">${esc(r.number)}</a><br><span class="small muted">${esc(r.pi)}</span></td>
              <td class="n">${r.pending.count ? `${r.pending.count}<br><span class="small muted">${money(r.pending.amount)}</span>` : ''}</td>
              <td class="n">${r.approved.count ? `${r.approved.count}<br><span class="small muted">${money(r.approved.amount)}</span>` : ''}</td>
              <td class="small">${r.lastReview ? `${r.lastReview.outcome === 'OK' ? 'OK' : 'Corrections needed'}, ${esc(r.lastReview.by)}<br><span class="muted">${fmtDate(r.lastReview.date)}</span>` : '<span class="muted">Not reviewed</span>'}</td>
              <td class="mid"><div class="rowbtns">${r.pending.count ? `<button class="btn small" data-approve="${r.id}" type="button">Approve ${r.pending.count}</button>` : ''}<a class="btn small quiet" href="#/request/${r.id}/charges">Review</a></div></td>
            </tr>`).join('')}</tbody></table>`
        : '<p class="empty">No charges are waiting. New charges appear here as work is recorded.</p>'}
        ${pendingTotal ? `<p class="small muted">${pendingTotal} pending charges in total.</p>` : ''}
      </div>
      <div>
        <h2>Release a billing batch</h2>
        <p class="muted">Locks the approved charges for one lab and period and produces the billing file in PHL's Rpt080 format.</p>
        <form class="form three" id="batch" style="align-items:end">
          <div class="field"><label for="lab">Lab</label><select id="lab"><option value="HP">HP (histology)</option><option value="PA">PA (pathology)</option></select></div>
          <div class="field"><label for="start">From</label><input id="start" type="date" value="${firstOfMonth(meta.today, 1)}"></div>
          <div class="field"><label for="end">To</label><input id="end" type="date" value="${meta.today}"></div>
          <div class="full row"><button class="btn quiet" type="submit">Preview</button></div>
        </form>
        <div id="preview"></div>

        <h2 class="section">Released batches</h2>
        ${batches.length ? `<table class="t"><thead><tr><th>File</th><th>Period</th><th class="n">Lines</th><th class="n">Total</th><th>Released</th><th></th></tr></thead><tbody>
          ${batches.map((b) => `<tr><td class="code">${esc(b.fileName)}</td><td class="small">${fmtDate(b.periodStart)} to ${fmtDate(b.periodEnd)}</td><td class="n">${b.lineCount}</td><td class="n">${money(b.total)}</td>
            <td class="small">${fmtDateTime(b.releasedAt)}<br><span class="muted">${esc(b.releasedBy)}</span></td><td class="mid"><button class="btn small quiet" data-file="${b.id}" type="button">Download</button></td></tr>`).join('')}
        </tbody></table>` : '<p class="empty">No batches released yet.</p>'}
      </div>
    </div>`;

  $$('[data-approve]', box).forEach((b) => b.addEventListener('click', () => act(b, async () => { const r = await api('POST', `/api/requests/${b.dataset.approve}/approve-pending`, {}); await reload(); return r; }, (r) => `${r.approved} charges approved`)));
  $$('[data-file]', box).forEach((b) => b.addEventListener('click', () => act(b, () => download(`/api/billing/batches/${b.dataset.file}/file`), (f) => `Downloaded ${f.name}`)));
  $('#batch').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => {
      const lab = $('#lab').value; const start = $('#start').value; const end = $('#end').value;
      const p = await api('GET', `/api/billing/preview?lab=${lab}&start=${start}&end=${end}`);
      const out = $('#preview');
      if (!p.lines.length) { out.innerHTML = `<p class="note">No approved ${lab} charges between ${fmtDate(start)} and ${fmtDate(end)}. Approve charges in the QC list first.</p>`; return; }
      out.innerHTML = `
        <p><strong>${p.lines.length} approved charges, ${money(p.total)}</strong>, from ${new Set(p.lines.map((l) => l.requestNumber)).size} requests.</p>
        <table class="t"><thead><tr><th>Request</th><th>Date</th><th>Code</th><th class="n">Units</th><th class="n">Amount</th></tr></thead><tbody>
          ${p.lines.slice(0, 40).map((l) => `<tr><td>${esc(l.requestNumber)}</td><td>${fmtDate(l.date)}</td><td class="code">${esc(l.code)}</td><td class="n">${l.units}</td><td class="n">${money(l.amount)}</td></tr>`).join('')}
        </tbody></table>${p.lines.length > 40 ? `<p class="small muted">and ${p.lines.length - 40} more lines.</p>` : ''}
        <h3 class="section">Billing file (${p.records.length} lines, units summed per request and code)</h3>
        <pre class="code">${esc(p.file)}</pre>
        <div class="actions"><button class="btn" type="button" id="release">Release batch and lock these charges</button></div>`;
      $('#release').addEventListener('click', (ev) => {
        if (!confirm(`Release ${p.lines.length} charges (${money(p.total)})? Released charges can only be corrected by adjustments.`)) return;
        act(ev.currentTarget, async () => {
          const res = await api('POST', '/api/billing/batches', { lab, start, end });
          await download(`/api/billing/batches/${res.batch.id}/file`);
          await reload();
          return res;
        }, (res) => `Released ${res.batch.fileName}: ${res.batch.lineCount} charges`);
      });
    });
  });
}

async function prices(box, meta) {
  const pl = await getPriceList();
  box.innerHTML = `
    <p class="muted">${esc(pl.name)} prices from the billing worksheet, ${pl.items.length} charge codes. In the pilot they apply to charges dated on or after ${fmtDate(pl.pricingFrom)} (change this in settings). Codes without a price cannot be charged until one is set.</p>
    <table class="t">
      <thead><tr><th>Code</th><th>Description</th><th>Unit</th><th class="n">Price</th><th>Sections</th></tr></thead>
      <tbody>${meta.sections.map((s) => {
        const items = pl.items.filter((i) => i.sections[0] === s.code);
        return items.length ? `<tr class="sec"><td colspan="5">${esc(s.name)}</td></tr>` + items.map((i) => `
          <tr><td class="code">${esc(i.code)}</td><td>${esc(i.description)}${i.requiresDescription ? ' <span class="src">needs a description</span>' : ''}</td><td>${esc(i.unit)}</td>
            <td class="n">${i.price == null ? '<span class="badge warn">not priced</span>' : money(i.price)}</td><td class="small muted">${i.sections.map((x) => esc(sectionName(meta, x))).join(', ')}</td></tr>`).join('') : '';
      }).join('')}</tbody>
    </table>`;
}
