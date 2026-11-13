// MHL LIMS pilot: router and app shell.
import { $, $$, getMeta, esc, refreshWho } from './ui.js';
import { renderLookup } from './views/lookup.js';
import { renderRequest } from './views/request.js';
import { renderIntake, renderCreatedPage } from './views/intake.js';
import { renderWorklist, renderNecropsy } from './views/necropsy.js';
import { renderStudy } from './views/studies.js';
import { renderBilling } from './views/billing.js';
import { renderLabels } from './views/labels.js';
import { renderSettings, askInitials } from './views/settings.js';
import { renderIhcHome, renderIhcRequest, renderIhcReview } from './views/ihcviews.js';
import { renderXenium, renderXeniumRun } from './views/xeniumviews.js';
import { renderStudyReport } from './views/studyreports.js';
import { renderAssays, renderAssay, renderAssayEdit } from './views/assays.js';
import { renderCalculator } from './views/calculator.js';
import { renderWsi, renderWsiImage } from './views/wsiviews.js';
import { renderTracking } from './views/tracking.js';
import { renderEstimates, renderEstimate, renderEstimatePrint, renderEstimateEmail } from './views/estimateviews.js';
import { renderPathWorklist, renderPathCase } from './views/pathviews.js';
import { renderReport, renderReportSet } from './views/reports.js';
import { renderProtocols, renderProtocol } from './views/protocolviews.js';
import { renderTerminology } from './views/terms.js';
import { renderBloodwork, renderBloodResult, renderCytology, renderBloodReport } from './views/bloodviews.js';

const app = $('#app');

function setTab(tab) {
  $$('.tabs a').forEach((a) => a.toggleAttribute('aria-current', false));
  const a = $(`.tabs a[data-tab="${tab}"]`);
  if (a) a.setAttribute('aria-current', 'page');
}

async function route() {
  const [path, query] = (location.hash.slice(1) || '/').split('?');
  const params = new URLSearchParams(query || '');
  const parts = path.split('/').filter(Boolean);
  try {
    if (parts[0] === 'request') { setTab('lookup'); return await renderRequest(app, Number(parts[1]), parts[2] || 'overview'); }
    if (parts[0] === 'new' && parts[1] === 'ihc') { setTab('new'); return await renderIhcReview(app, Number(parts[2])); }
    if (parts[0] === 'new' && parts[1] === 'created') { setTab('new'); return await renderCreatedPage(app, Number(parts[2]), { another: params.get('nas') != null }); }
    if (parts[0] === 'new') { setTab('new'); return await renderIntake(app); }
    if (parts[0] === 'studyreport') { setTab(parts[2] === 'pathology' ? 'pathology' : 'necropsy'); return await renderStudyReport(app, Number(parts[1]), parts[2] === 'pathology' ? 'pathology' : 'necropsy'); }
    if (parts[0] === 'necropsy' && parts[1]) { setTab('necropsy'); return await renderNecropsy(app, Number(parts[1])); }
    if (parts[0] === 'necropsy') { setTab('necropsy'); return await renderWorklist(app); }
    if (parts[0] === 'study') { setTab(params.get('view') === 'pathology' ? 'pathology' : 'necropsy'); return await renderStudy(app, Number(parts[1]), params.get('view') || 'absolute'); }
    if (parts[0] === 'billing') { setTab('billing'); return await renderBilling(app, parts[1] || 'queue'); }
    if (parts[0] === 'pathology' && parts[1]) { setTab('pathology'); return await renderPathCase(app, Number(parts[1])); }
    if (parts[0] === 'pathology') { setTab('pathology'); return await renderPathWorklist(app); }
    if (parts[0] === 'wsi' && parts[1] === 'image') { setTab('wsi'); return await renderWsiImage(app, Number(parts[2])); }
    if (parts[0] === 'wsi') { setTab('wsi'); return await renderWsi(app, parts[1] || 'queue'); }
    if (parts[0] === 'protocols') { setTab('necropsy'); return await renderProtocols(app); }
    if (parts[0] === 'protocol') { setTab('necropsy'); return await renderProtocol(app, parts[1] === 'trim' ? 'trim' : 'necropsy', Number(parts[2])); }
    if (parts[0] === 'terminology') { setTab('pathology'); return await renderTerminology(app); }
    if (parts[0] === 'bloodwork' && parts[1] === 'result') { setTab('bloodwork'); return await renderBloodResult(app, Number(parts[2])); }
    if (parts[0] === 'bloodwork' && parts[1] === 'cytology' && parts[2]) { setTab('bloodwork'); return await renderCytology(app, Number(parts[2])); }
    if (parts[0] === 'bloodwork') { setTab('bloodwork'); return await renderBloodwork(app, parts[1] || 'review'); }
    if (parts[0] === 'report' && parts[2] === 'bloodwork') { setTab('bloodwork'); return await renderBloodReport(app, Number(parts[1])); }
    if (parts[0] === 'report') { setTab(parts[2] === 'necropsy' ? 'necropsy' : 'pathology'); return await renderReport(app, Number(parts[1]), parts[2] === 'necropsy' ? 'necropsy' : 'pathology'); }
    if (parts[0] === 'reports') { setTab('pathology'); return await renderReportSet(app, parts[1] === 'study' ? 'study' : 'request', Number(parts[2]), parts[3] === 'necropsy' ? 'necropsy' : 'pathology'); }
    // Molecular (formerly IHC); #/ihc/... addresses still work.
    if (parts[0] === 'molecular' || parts[0] === 'ihc') {
      setTab('molecular');
      if (parts[1] === 'xenium' && parts[2] === 'run') return await renderXeniumRun(app, Number(parts[3]));
      if (parts[1] === 'xenium') return await renderXenium(app);
      if (parts[1] === 'request') return await renderIhcRequest(app, Number(parts[2]));
      if (parts[1] === 'calculator') return await renderCalculator(app, params);
      if (parts[1] === 'new') { location.replace('#/new'); return undefined; }   // new requests are made under New request
      if (parts[1] === 'assays') return await renderAssays(app, params);
      if (parts[1] === 'assay' && parts[2] === 'new') return await renderAssayEdit(app, null);
      if (parts[1] === 'assay' && parts[3] === 'edit') return await renderAssayEdit(app, Number(parts[2]));
      if (parts[1] === 'assay') return await renderAssay(app, Number(parts[2]));
      return await renderIhcHome(app);
    }
    if (parts[0] === 'estimates') {
      setTab('estimates');
      if (parts[1] && parts[2] === 'print') return await renderEstimatePrint(app, Number(parts[1]));
      if (parts[1] && parts[2] === 'email') return await renderEstimateEmail(app, Number(parts[1]));
      if (parts[1]) return await renderEstimate(app, Number(parts[1]));
      return await renderEstimates(app, params);
    }
    if (parts[0] === 'tracking') { setTab('lookup'); return await renderTracking(app, Number(parts[1])); }
    if (parts[0] === 'labels') { setTab('lookup'); return await renderLabels(app, Number(parts[1])); }
    if (parts[0] === 'settings') { setTab(''); return await renderSettings(app); }
    setTab('lookup');
    return await renderLookup(app, params.get('q') || '');
  } catch (e) {
    app.innerHTML = `<h1>That page could not be shown</h1><p class="note">${esc(e.message)}</p><p><a href="#/">Back to lookup</a></p>`;
  }
}

window.addEventListener('hashchange', route);
$('#who').addEventListener('click', () => { location.hash = '#/settings'; });

(async () => {
  const meta = await getMeta();
  if (!meta.settings.initials) await askInitials();
  await refreshWho();
  route();
})();
