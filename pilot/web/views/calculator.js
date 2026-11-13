// IHC antibody dilution calculator: a dilution ratio (1:X), concentrations (C1V1 = C2V2, solving for whichever value
// is missing, like Abcam's calculator), and a prep sheet for a run of slides with antibodies from the catalog or an
// accepted request's worksheet. The arithmetic is in core/dilution.mjs.
import { $, $$, api, esc, getMeta, pageTop, options } from '../ui.js';
import { ihcTabs } from './ihcviews.js';
import { VOLUME_UNITS, CONC_UNITS, toUl, toUgMl, fromUl, fromUgMl, nice, showVolume, showRatio, solveC1V1, byRatio, forSlides, intermediate, parseCatalogDilution, PER_SLIDE_DEFAULT } from '../lib/dilution.mjs';

const VOL = Object.keys(VOLUME_UNITS).filter((u) => u !== 'L' && u !== 'nL');
const CONC = Object.keys(CONC_UNITS);
const calc = {
  mode: 'ratio', minUl: 1,
  ratio: { factor: 200, v2: 1, v2u: 'mL', c1: '', c1u: 'mg/mL' },
  conc: { solveFor: 'v1', c1: 1, c1u: 'mg/mL', v1: '', v1u: 'µL', c2: 5, c2u: 'µg/mL', v2: 1, v2u: 'mL' },
  slides: { extraPct: 10, deadUl: 0, rows: [], source: '' },
};
const num = (v) => (v === '' || v == null ? NaN : Number(v));

const intermediateText = (im) => (!im ? '' : im.k == null ? `<p class="note small">${esc(im.note)}</p>`
  : `<p class="note small">That is less than ${nice(calc.minUl)} µL, too little to pipette accurately. Make a 1:${im.k} intermediate dilution first: ${showVolume(im.stockUl)} antibody + ${showVolume(im.intermediateDiluentUl)} diluent. Then use ${showVolume(im.useUl)} of the intermediate + ${showVolume(im.finalDiluentUl)} diluent.</p>`);

export async function renderCalculator(app, params = new URLSearchParams()) {
  const meta = await getMeta();
  if (params.get('assay') || params.get('request')) await prefill(params);
  app.innerHTML = `
    ${ihcTabs('calculator', meta)}
    <div class="noprint">
      <p class="muted">How much antibody and diluent to mix: from a dilution ratio, from concentrations (C1V1 = C2V2), or for a run of slides with antibodies from the catalog.</p>
      <div class="seg" role="group" aria-label="Kind of calculation" style="margin-top:12px">
        <button type="button" data-mode="ratio" aria-pressed="${calc.mode === 'ratio'}">Dilution ratio (1:X)</button>
        <button type="button" data-mode="conc" aria-pressed="${calc.mode === 'conc'}">Concentration (C1V1 = C2V2)</button>
        <button type="button" data-mode="slides" aria-pressed="${calc.mode === 'slides'}">For a run of slides</button>
      </div>
      <p class="small" style="margin:8px 0 0"><label for="minul">Smallest volume you pipette</label> <input id="minul" class="inp" type="number" min="0.1" step="0.1" style="width:64px" value="${calc.minUl}"> µL</p>
    </div>
    <div id="calc" class="section"></div>
    <details class="section noprint"><summary><strong>How it works</strong></summary>
      <ul class="small">
        <li><strong>1:X</strong> means one part antibody in X parts in total, as on antibody datasheets. Antibody volume = final volume ÷ X; diluent = final volume − antibody volume.</li>
        <li><strong>C1V1 = C2V2</strong>: stock concentration × stock volume = working concentration × final volume. Give three and the fourth is calculated. 1 mg/mL = 1 µg/µL = 1,000 µg/mL.</li>
        <li>For slides: working solution = slides × volume per slide × (1 + spare) + dead volume. Check the volume per slide against your platform's dispense setting; the Leica BOND default used here is 150 µL and manual staining 100 µL.</li>
        <li>Below the smallest volume you pipette, an intermediate dilution is suggested (1:5, 1:10, 1:20 … of the stock), with 20% spare.</li>
      </ul>
    </details>`;
  pageTop(app);
  $$('[data-mode]', app).forEach((b) => b.addEventListener('click', () => { calc.mode = b.dataset.mode; renderCalculator(app); }));
  $('#minul').addEventListener('input', () => { const v = num($('#minul').value); if (v > 0) { calc.minUl = v; draw(); } });
  const box = $('#calc');
  const draw = () => (calc.mode === 'conc' ? concMode(box) : calc.mode === 'slides' ? slidesMode(box) : ratioMode(box));
  draw();
}

// ---------- 1:X ----------
function ratioMode(box) {
  const r = calc.ratio;
  box.innerHTML = `
    <div class="split even">
      <form class="form panel" id="rform" onsubmit="return false" style="grid-template-columns:1fr 1fr">
        <div class="field"><label for="rx">Dilution 1:X (X)</label><input id="rx" type="number" min="1" step="any" value="${esc(r.factor)}"></div>
        <div class="field"><label for="rv">Final volume</label><div class="pair"><input id="rv" type="number" min="0" step="any" value="${esc(r.v2)}"><select id="rvu">${options(VOL, r.v2u)}</select></div></div>
        <div class="field full"><label for="rc">Stock concentration (optional, to show the working concentration)</label><div class="pair"><input id="rc" type="number" min="0" step="any" value="${esc(r.c1)}"><select id="rcu">${options(CONC, r.c1u)}</select></div></div>
      </form>
      <div class="panel" id="rres" aria-live="polite"></div>
    </div>`;
  const update = () => {
    Object.assign(r, { factor: $('#rx').value, v2: $('#rv').value, v2u: $('#rvu').value, c1: $('#rc').value, c1u: $('#rcu').value });
    try {
      const c1 = num(r.c1) > 0 ? toUgMl(num(r.c1), r.c1u) : null;
      const res = byRatio({ factor: num(r.factor), v2: toUl(num(r.v2), r.v2u), c1 });
      $('#rres').innerHTML = `
        <div class="calc-out"><div><b>${showVolume(res.v1)}</b>antibody</div><div><span>+</span></div><div><b>${showVolume(res.diluent)}</b>diluent</div><div><span>=</span></div><div><b>${showVolume(res.v2)}</b>at ${showRatio(res.factor)}</div></div>
        ${res.c2 != null ? `<p class="small">Working concentration: <strong>${nice(fromUgMl(res.c2, 'µg/mL'))} µg/mL</strong> (${nice(res.c2 * 1000)} ng/mL).</p>` : ''}
        ${intermediateText(intermediate({ factor: res.factor, v2: res.v2, minUl: calc.minUl }))}`;
    } catch (e) { $('#rres').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  };
  $$('#rform input, #rform select', box).forEach((el) => el.addEventListener('input', update));
  update();
}

// ---------- C1V1 = C2V2 ----------
const CONC_FIELDS = [['c1', 'Stock concentration (C1)', 'conc'], ['v1', 'Stock volume to use (V1)', 'vol'], ['c2', 'Working concentration (C2)', 'conc'], ['v2', 'Final volume (V2)', 'vol']];
function concMode(box) {
  const c = calc.conc;
  box.innerHTML = `
    <div class="split even">
      <div class="panel">
        <div class="field"><span class="lbl">Calculate</span><div class="checks">${CONC_FIELDS.map(([k, label]) => `<label><input type="radio" name="solve" value="${k}" ${c.solveFor === k ? 'checked' : ''}> ${esc(label.replace(/ \(.*/, ''))}</label>`).join('')}</div></div>
        <form class="form" id="cform" onsubmit="return false" style="grid-template-columns:1fr">
          ${CONC_FIELDS.map(([k, label, kind]) => `<div class="field"><label for="c-${k}">${esc(label)}</label><div class="pair">
            <input id="c-${k}" type="number" min="0" step="any" value="${c.solveFor === k ? '' : esc(c[k])}" ${c.solveFor === k ? 'disabled placeholder="calculated"' : ''}>
            <select id="c-${k}u">${options(kind === 'conc' ? CONC : VOL, c[`${k}u`])}</select></div></div>`).join('')}
        </form>
      </div>
      <div class="panel" id="cres" aria-live="polite"></div>
    </div>`;
  const update = () => {
    for (const [k] of CONC_FIELDS) { if (k !== c.solveFor) c[k] = $(`#c-${k}`).value; c[`${k}u`] = $(`#c-${k}u`).value; }
    try {
      const v = (k, kind) => (k === c.solveFor ? undefined : kind === 'conc' ? toUgMl(num(c[k]), c[`${k}u`]) : toUl(num(c[k]), c[`${k}u`]));
      const res = solveC1V1({ c1: v('c1', 'conc'), v1: v('v1', 'vol'), c2: v('c2', 'conc'), v2: v('v2', 'vol'), solveFor: c.solveFor });
      const k = c.solveFor; const unit = c[`${k}u`];
      const value = k === 'c1' || k === 'c2' ? fromUgMl(res[k], unit) : fromUl(res[k], unit);
      $(`#c-${k}`).placeholder = `${nice(value)} (calculated)`;
      c.lastValue = String(Number(value.toPrecision(6)));
      $('#cres').innerHTML = `
        <p class="calc-big"><span class="muted">${esc(CONC_FIELDS.find(([x]) => x === k)[1])}</span><b>${nice(value)} ${esc(unit)}</b></p>
        <div class="calc-out"><div><b>${showVolume(res.v1)}</b>antibody stock</div><div><span>+</span></div><div><b>${showVolume(res.diluent)}</b>diluent</div><div><span>=</span></div><div><b>${showVolume(res.v2)}</b>working solution</div></div>
        <p class="small">That is a ${showRatio(res.factor)} dilution of the stock (${nice(fromUgMl(res.c1, 'µg/mL'))} µg/mL to ${nice(fromUgMl(res.c2, 'µg/mL'))} µg/mL).</p>
        ${intermediateText(intermediate({ factor: res.factor, v2: res.v2, minUl: calc.minUl }))}`;
    } catch (e) { c.lastValue = null; $('#cres').innerHTML = `<p class="muted">${esc(e.message)}</p>`; }
  };
  // Switching what to calculate keeps the value just calculated in its box.
  $$('input[name="solve"]', box).forEach((r) => r.addEventListener('change', () => {
    const was = c.solveFor; update();
    if (c.lastValue != null) c[was] = c.lastValue;
    c.solveFor = r.value; concMode(box);
  }));
  $$('#cform input, #cform select', box).forEach((el) => el.addEventListener('input', update));
  update();
}

// ---------- a run of slides ----------
function rowFromAssay(a, slides = 1) {
  const parsed = parseCatalogDilution(a.dilution);
  const names = a.name.replace(/^(double stain|duplex|triplex|\d-plex)\s*:?\s*/i, '').split(/\s*\+\s*/);
  const per = PER_SLIDE_DEFAULT[a.platform] || 100;
  if (!parsed.length) return [{ name: a.name, assayId: a.id, group: '', first: true, catalog: a.dilution || 'not recorded', dilution: '', stock: '', stocku: 'mg/mL', slides, perSlide: per }];
  // One antibody with several dilutions listed is a choice, not a panel: use the first and say so.
  if (parsed.length > 1 && (a.plex || 1) === 1 && !parsed.some((p) => /^\d+(st|nd|rd|th)$/i.test(p.label || ''))) {
    const p = parsed[0];
    return [{ name: a.name, assayId: a.id, group: '', first: true, catalog: a.dilution, dilution: p.rtu ? 'RTU' : p.factor ? `1:${p.factor}` : `${p.ugPerMl} µg/mL`,
      stock: '', stocku: 'mg/mL', slides, perSlide: per, note: `The catalog lists alternatives (${a.dilution}); the first is used. Change it if you use another.` }];
  }
  // A panel or double stain gives one row per antibody, named by its marker, with the panel's name on the first row.
  return parsed.map((p, i) => ({
    name: parsed.length > 1 ? (names.length === parsed.length ? names[i] : `Antibody ${p.label}`) : a.name, group: parsed.length > 1 ? a.name : '', first: i === 0,
    assayId: a.id, catalog: a.dilution,
    dilution: p.rtu ? 'RTU' : p.factor ? `1:${p.factor}` : `${p.ugPerMl} µg/mL`, stock: '', stocku: 'mg/mL', slides, perSlide: per,
    note: p.range ? `The catalog gives a range, 1:${p.range[0]} to 1:${p.range[1]}; the stronger end is used.` : '',
  }));
}

async function prefill(params) {
  calc.mode = 'slides';
  if (params.get('assay')) {
    const { assay } = await api('GET', `/api/ihc/assays/${Number(params.get('assay'))}`);
    calc.slides.rows = rowFromAssay(assay, Math.max(1, parseInt(params.get('slides'), 10) || 1));
    calc.slides.source = `${assay.name} (#${assay.id})`;
  } else {
    const d = await api('GET', `/api/requests/${Number(params.get('request'))}/ihc`);
    const slides = d.blocks.length + 1;   // one slide per block plus a control slide
    calc.slides.rows = d.stains.flatMap((s) => (s.protocol ? rowFromAssay(s.protocol, slides)
      : [{ name: `${s.newAntibody.name} (new antibody)`, assayId: null, group: '', first: true, catalog: 'to optimize', dilution: '', stock: '', stocku: 'mg/mL', slides, perSlide: 150 }]));
    calc.slides.source = `${d.request.number} (${d.web.number}): ${d.blocks.length} blocks plus one control slide per stain`;
  }
}

function slidesMode(box) {
  const S = calc.slides;
  box.innerHTML = `
    <div class="noprint">
      <div class="row"><div class="picker" style="flex:1;max-width:560px;margin:0"><input id="sfind" placeholder="Add an antibody from the catalog: CD8, Ki-67, RAM34…" autocomplete="off" aria-label="Search the IHC catalog"><ul id="shits" class="wide" hidden></ul></div>
        <button class="btn small quiet" type="button" id="sadd">Add a row by hand</button></div>
      <p class="small" style="margin:8px 0 0"><label for="sx">Spare</label> <input id="sx" class="inp" type="number" min="0" max="200" style="width:60px" value="${S.extraPct}"> %
        &nbsp; <label for="sd">Dead volume per antibody</label> <input id="sd" class="inp" type="number" min="0" style="width:70px" value="${S.deadUl}"> µL</p>
    </div>
    <h2 class="print-only">Antibody prep sheet</h2>
    ${S.source ? `<p class="small">For ${esc(S.source)}.</p>` : ''}
    <div id="srows" class="section"></div>
    <div class="actions noprint">${S.rows.length ? '<button class="btn quiet" type="button" id="sclear">Clear</button><button class="btn" type="button" id="sprint">Print prep sheet</button>' : ''}</div>`;
  const drawRows = () => {
    const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);
    $('#srows').innerHTML = S.rows.length ? `<div class="scroll-x"><table class="t calc-t"><thead><tr><th>Antibody</th><th>Dilution used</th><th>Stock conc.<br><span class="small muted">for a µg/mL dilution</span></th><th class="n">Slides</th><th class="n">µL per slide</th><th class="n">Working solution</th><th class="n">Antibody</th><th class="n">Diluent</th><th class="noprint"></th></tr></thead><tbody>
      ${S.rows.map((r, i) => `<tr class="${r.group && !r.first ? 'calc-cont' : ''}"><td>${r.assayId ? `<a href="#/molecular/assay/${r.assayId}"><strong>${esc(r.name)}</strong></a>` : `<input data-i="${i}" data-f="name" value="${esc(r.name)}" aria-label="Antibody" placeholder="Antibody">`}
          ${r.first && (r.group || r.catalog) ? `<br><span class="small muted" title="${esc(r.catalog || '')}">${r.group ? `${esc(clip(r.group, 48))}<br>` : ''}${r.catalog ? `Catalog: ${esc(clip(r.catalog, 60))}` : ''}</span>` : ''}</td>
        <td><input data-i="${i}" data-f="dilution" value="${esc(r.dilution)}" style="width:86px" aria-label="Dilution used" placeholder="1:200"></td>
        <td><div class="pair"><input data-i="${i}" data-f="stock" type="number" min="0" step="any" value="${esc(r.stock)}" style="width:58px" aria-label="Stock concentration"><select data-i="${i}" data-f="stocku" aria-label="Stock unit">${options(CONC, r.stocku)}</select></div></td>
        <td class="n"><input data-i="${i}" data-f="slides" type="number" min="1" step="1" value="${esc(r.slides)}" style="width:54px" aria-label="Slides"></td>
        <td class="n"><input data-i="${i}" data-f="perSlide" type="number" min="1" step="any" value="${esc(r.perSlide)}" style="width:58px" aria-label="Microlitres per slide"></td>
        <td class="n" data-out="${i}:v2"></td><td class="n" data-out="${i}:v1"></td><td class="n" data-out="${i}:dil"></td>
        <td class="noprint"><button class="btn small quiet" type="button" data-rm="${i}" aria-label="Remove row">×</button></td></tr>
        <tr class="calc-note"><td colspan="9" data-out="${i}:note">${r.note ? `<span class="small muted">${esc(r.note)}</span>` : ''}</td></tr>`).join('')}
      </tbody></table></div>` : '<p class="empty">Add antibodies from the catalog above, or open the calculator from an assay or an IHC worksheet to fill this in.</p>';
    $$('#srows [data-f]').forEach((el) => el.addEventListener('input', () => { const r = S.rows[Number(el.dataset.i)]; r[el.dataset.f] = el.value; compute(); }));
    $$('#srows [data-rm]').forEach((b) => b.addEventListener('click', () => { S.rows.splice(Number(b.dataset.rm), 1); slidesMode(box); }));
    compute();
  };
  const compute = () => {
    S.rows.forEach((r, i) => {
      const out = (k, html) => { const el = $(`[data-out="${i}:${k}"]`); if (el) el.innerHTML = html; };
      try {
        const slides = parseInt(r.slides, 10); const perSlideUl = num(r.perSlide);
        const p = parseCatalogDilution(r.dilution)[0];
        if (!p) throw new Error('Enter the dilution, for example 1:200 or 5 µg/mL.');
        if (p.rtu) {
          const v = slides * perSlideUl * (1 + (num(S.extraPct) || 0) / 100) + (num(S.deadUl) || 0);
          out('v2', showVolume(v)); out('v1', `${showVolume(v)}<br><span class="small muted">ready to use</span>`); out('dil', '—'); out('note', r.note ? `<span class="small muted">${esc(r.note)}</span>` : '');
          return;
        }
        const c1 = num(r.stock) > 0 ? toUgMl(num(r.stock), r.stocku) : null;
        if (p.ugPerMl && !c1) throw new Error('The dilution is a concentration: enter the stock concentration from the vial or datasheet.');
        const res = forSlides({ slides, perSlideUl, extraPct: num(S.extraPct) || 0, deadUl: num(S.deadUl) || 0, factor: p.factor || null, c1, c2: p.ugPerMl || null, minUl: calc.minUl });
        out('v2', showVolume(res.v2)); out('v1', `<b>${showVolume(res.v1)}</b>${p.ugPerMl ? `<br><span class="small muted">${showRatio(res.factor)}</span>` : ''}`); out('dil', showVolume(res.diluent));
        out('note', [r.note && `<span class="small muted">${esc(r.note)}</span>`, intermediateText(res.intermediate)].filter(Boolean).join(''));
      } catch (e) { out('v2', ''); out('v1', ''); out('dil', ''); out('note', `<span class="small fitnote">${esc(e.message)}</span>`); }
    });
  };
  $('#sx').addEventListener('input', () => { S.extraPct = $('#sx').value; compute(); });
  $('#sd').addEventListener('input', () => { S.deadUl = $('#sd').value; compute(); });
  $('#sadd').addEventListener('click', () => { S.rows.push({ name: '', assayId: null, group: '', first: true, catalog: '', dilution: '', stock: '', stocku: 'mg/mL', slides: 1, perSlide: 150 }); slidesMode(box); });
  $('#sclear')?.addEventListener('click', () => { S.rows = []; S.source = ''; slidesMode(box); });
  $('#sprint')?.addEventListener('click', () => window.print());
  let t = null; let found = [];
  $('#sfind').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(async () => {
      const q = $('#sfind').value.trim(); const list = $('#shits');
      if (q.length < 2) { list.hidden = true; return; }
      found = (await api('GET', `/api/ihc/assays?q=${encodeURIComponent(q)}&limit=8`)).assays;
      list.innerHTML = found.length ? found.map((a, i) => `<li><button type="button" data-pick="${i}"><span>${esc(a.name)} <span class="muted small">#${a.id}</span></span><span class="small muted">${esc(a.dilution || 'no dilution recorded')}</span><span class="small muted">${esc(a.platform)}</span></button></li>`).join('')
        : `<li style="padding:8px 12px" class="muted">No antibody matches “${esc(q)}”.</li>`;
      list.hidden = false;
      $$('[data-pick]', list).forEach((b) => b.addEventListener('click', () => {
        S.rows.push(...rowFromAssay(found[Number(b.dataset.pick)], S.rows[0]?.slides || 1));
        slidesMode(box); $('#sfind').focus();
      }));
    }, 150);
  });
  drawRows();
}
