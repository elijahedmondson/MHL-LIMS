// Look up: one search across requests, PHL numbers, ZAP numbers, NAS numbers and investigators.
import { $, $$, api, esc, money, fmtDate, getMeta, areaName, pageTop, kindBadge } from '../ui.js';

let timer = null;

// Charged so far against the estimate sent to NAS: amounts, a small bar, and the NAS authorization.
function billingCell(b) {
  if (!b) return '';
  const pct = b.estimate ? Math.min(100, (b.charged / b.estimate) * 100) : 0;
  const cls = b.state === 'OVER_AUTHORIZED' ? 'over-auth' : b.state === 'OVER_ESTIMATE' ? 'over' : '';
  const label = `Charged ${money(b.charged)} of the ${money(b.estimate)} estimate${b.authorized != null ? `; ${money(b.authorized)} authorized by NAS` : '; no NAS request linked'}`;
  return `<div class="bill ${cls}" title="${esc(label)}">
    <div class="bill-amt"><b>${money(b.charged)}</b> <span class="muted">of ${money(b.estimate)}</span></div>
    <div class="bill-bar" role="img" aria-label="${esc(label)}"><span style="width:${pct}%"></span></div>
    <div class="small muted">${b.state === 'OVER_AUTHORIZED' ? '<b class="hi">Over the NAS authorization</b>' : b.state === 'OVER_ESTIMATE' ? `<b class="warn-text">${Math.round(b.pctOfEstimate)}%: over the estimate</b>` : b.estimate ? `${Math.round(b.pctOfEstimate)}% of estimate` : 'No estimate'}<br>${b.authorized != null ? `${money(b.authorized)} authorized` : 'NAS not linked'}</div>
  </div>`;
}

export async function renderLookup(app, q) {
  const [meta, open] = await Promise.all([getMeta(), api('GET', '/api/requests?status=Open')]);
  const sample = open.requests.slice(0, 1)[0];
  const examples = [];
  if (sample) examples.push(sample.number);
  const firstStudy = open.requests.find((r) => r.zap);
  if (firstStudy) examples.push(firstStudy.zap);
  examples.push('Okafor');
  app.innerHTML = `
    <section class="finder">
      <h1>Find any request, animal or study</h1>
      <p class="muted">One search across request numbers, PHL numbers, ZAP numbers, NAS numbers, IHC request numbers, investigators and the IHC antibody catalog.</p>
      <form class="search" role="search">
        <label class="sr" for="q" hidden>Search</label>
        <input id="q" name="q" autocomplete="off" placeholder="PHL#, ZAP#, NAS#, request #, investigator or antibody" value="${esc(q)}" aria-label="Search">
        <button class="btn" type="submit">Search</button>
      </form>
      <div class="try">Try ${examples.map((e) => `<button class="chip" type="button" data-q="${esc(e)}">${esc(e)}</button>`).join('')}</div>
    </section>
    <div id="results" aria-live="polite"></div>
    <section class="section" id="open">
      <h2>Open requests</h2>
      ${open.requests.length ? `<p class="small muted">Charged so far counts every charge that is not void, released for billing or not. The estimate is the one sent back to NAS when the request was created.</p>
      <div class="scroll-x"><table class="t">
        <thead><tr><th>Request</th><th>Investigator</th><th>Type</th><th>Due</th><th>Where the PHL numbers are</th><th>Charged so far vs NAS estimate</th><th class="n">Charges to review</th></tr></thead>
        <tbody>${open.requests.map((r) => `
          <tr class="click" data-href="#/request/${r.id}">
            <td><a class="idtxt" href="#/request/${r.id}">${esc(r.number)}</a>${r.restricted ? ' <span class="restricted">Restricted</span>' : ''}</td>
            <td>${esc(r.pi)}</td>
            <td>${esc(r.type)}${r.zap ? `<br><span class="muted small">${esc(r.zap)}</span>` : ''}</td>
            <td>${r.due < meta.today ? `<span class="overdue" title="Past the due date">${fmtDate(r.due)}</span>` : fmtDate(r.due)}</td>
            <td><div class="areas-mini">${Object.entries(r.areas).map(([a, n]) => `<span>${esc(areaName(meta, a))} ${n}</span>`).join('')}</div></td>
            <td>${billingCell(r.billing)}</td>
            <td class="n">${r.pending ? `<span class="badge warn">${r.pending}</span>` : ''}</td>
          </tr>`).join('')}</tbody></table></div>`
      : '<p class="empty">No open requests. Start one from an approved NAS request under New request.</p>'}
    </section>`;
  pageTop(app);

  const input = $('#q');
  const show = async (term) => {
    const box = $('#results');
    if (!term.trim()) { box.innerHTML = ''; $('#open').hidden = false; return; }
    const { hits, assays } = await api('GET', `/api/search?q=${encodeURIComponent(term)}`);
    $('#open').hidden = true;
    const assayBox = assays.count ? `
      <section class="section"><h2>In the IHC assay catalog</h2>
        <div class="results">${assays.top.map((a) => `
          <a class="hit" href="#/molecular/assay/${a.id}"><span class="id">#${a.id}</span><span><span class="who">${esc(a.name)}</span><br><span class="what">${esc(a.species || 'species not recorded')}, ${esc(a.catalog)}</span></span><span>${kindBadge(a)}</span><span></span></a>`).join('')}</div>
        ${assays.count > assays.top.length ? `<p><a href="#/molecular/assays?q=${encodeURIComponent(term)}">See all ${assays.count} protocols matching “${esc(term)}”</a></p>` : ''}</section>` : '';
    box.innerHTML = (hits.length
      ? `<div class="results">${hits.map((h) => `
          <a class="hit" href="${h.href || `#/request/${h.id}`}">
            <span class="id">${esc(h.number)}</span>
            <span><span class="who">${esc(h.pi)}</span><br><span class="what">${esc(h.type)}${h.zap ? `, ${esc(h.zap)}` : ''}, received ${fmtDate(h.received)}</span></span>
            <span class="matched">${esc(h.matched)}${h.billing ? `<br>${billingCell(h.billing)}` : ''}</span>
            <span><span class="badge ${h.status === 'Complete' || h.status === 'Accepted' ? 'complete' : h.status === 'Declined' ? 'muted' : 'open'}">${esc(h.status)}</span></span>
          </a>`).join('')}</div>`
      : assays.count ? '' : `<p class="empty">Nothing matches “${esc(term)}”. Check the number, or search by the investigator’s last name or an antibody.</p>`) + assayBox;
  };
  $('form.search').addEventListener('submit', (e) => { e.preventDefault(); history.replaceState(null, '', `#/?q=${encodeURIComponent(input.value)}`); show(input.value); });
  input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(() => show(input.value), 160); });
  $$('.chip', app).forEach((c) => c.addEventListener('click', () => { input.value = c.dataset.q; show(c.dataset.q); input.focus(); }));
  $$('tr.click', app).forEach((tr) => tr.addEventListener('click', (e) => { if (e.target.tagName !== 'A') location.hash = tr.dataset.href; }));
  if (q) show(q); else input.focus();
}
