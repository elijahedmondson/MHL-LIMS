// Settings: your initials, pilot pricing date, backup and reset.
import { $, api, esc, getMeta, act, download, pageTop, fmtDate, refreshWho } from '../ui.js';

export function askInitials() {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.innerHTML = `
      <form method="dialog" id="ini-form">
        <h2>Welcome to the MHL LIMS pilot</h2>
        <p>Your initials are stamped on everything you record, as they are on the billing worksheet today.</p>
        <div class="field"><label for="ini">Your initials</label><input id="ini" maxlength="4" autocomplete="off" style="text-transform:uppercase" required></div>
        <p class="small muted">Requests, animals and charges are fictional test data (the IHC assay catalog is MHL's real list). You can reset the data at any time in settings.</p>
        <div class="actions"><button class="btn" type="submit">Start</button></div>
        <p class="small" id="ini-err" style="color:var(--bad)"></p>
      </form>`;
    document.body.appendChild(d);
    d.showModal();
    d.addEventListener('cancel', (e) => e.preventDefault());
    $('#ini-form', d).addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await api('PUT', '/api/settings', { initials: $('#ini', d).value });
        await getMeta(true);
        await refreshWho();
        d.close(); d.remove(); resolve();
      } catch (err) { $('#ini-err', d).textContent = err.message; }
    });
  });
}

export async function renderSettings(app) {
  const meta = await getMeta(true);
  const local = !!window.MHL_LOCAL;
  app.innerHTML = `
    <h1>Settings</h1>
    <div class="split section">
      <div>
        <h2>You</h2>
        <form class="form" id="me" style="grid-template-columns: 1fr auto; max-width: 420px; align-items: end">
          <div class="field"><label for="ini">Your initials</label><input id="ini" maxlength="4" value="${esc(meta.settings.initials)}" style="text-transform:uppercase"></div>
          <button class="btn" type="submit">Save</button>
        </form>

        <h2 class="section">Pricing in the pilot</h2>
        <p>The pilot charges everything at the ${esc(meta.priceList.name)} prices from the billing worksheet (${meta.priceList.codes} codes) for any date on or after:</p>
        <form class="form" id="pricing" style="grid-template-columns: 1fr auto; max-width: 420px; align-items: end">
          <div class="field"><label for="pf">Prices apply from</label><input id="pf" type="date" value="${esc(meta.priceList.pricingFrom)}"></div>
          <button class="btn quiet" type="submit">Save</button>
        </form>
        <p class="small muted">The real start date of contract year 2027 is still an open question. ${meta.priceList.unpriced.length} codes have no price and cannot be charged: ${esc(meta.priceList.unpriced.join(', '))}.</p>
        ${local ? '' : `<h2 class="section">Instrument folders</h2>
        <p class="small">Folders the Bloodwork page reads with "Read new files", like Zaphod's Read Files buttons. Each file read is moved into a Processed folder inside it. Leave blank if you import files by hand.</p>
        <p class="note small">Do not point these at the folders Zaphod reads (its Zaphod Chemistry and Zaphod Hematology shares) while Zaphod is in use: the pilot would move the files and Zaphod would never see them. Use a copy of the files, or a separate folder.</p>
        <form class="form" id="folders" style="max-width:640px">
          <div class="field"><label for="fchem">Chemistry (VS2 and Piccolo PuTTY logs)</label><input id="fchem" value="${esc(meta.settings.instrumentFolders?.chemistry || '')}" placeholder="e.g. C:\\LIMS pilot\\Chemistry"></div>
          <div class="field"><label for="fhem">Hematology (Hemavet DMS exports)</label><input id="fhem" value="${esc(meta.settings.instrumentFolders?.hematology || '')}" placeholder="e.g. C:\\LIMS pilot\\Hematology"></div>
          <div><button class="btn quiet" type="submit">Save folders</button></div>
        </form>`}
      </div>
      <div>
        <h2>Pilot data</h2>
        <p>${local
          ? 'This copy runs entirely in your browser. Data is saved in this browser on this computer only.'
          : 'Data is saved on this computer in the pilot\'s <code>data</code> folder, with a dated copy in <code>data/backups</code> the first time it changes each day.'}</p>
        <div class="actions" style="margin-top:12px">
          <button class="btn quiet" type="button" id="export">Download a backup (JSON)</button>
        </div>
        <h2 class="section">Start over</h2>
        <p>Replace everything with fresh test data dated from today (${fmtDate(meta.today)}). Your initials are kept.</p>
        <div class="actions" style="margin-top:12px"><button class="btn danger" type="button" id="reset">Reset pilot data</button></div>
      </div>
    </div>`;
  pageTop(app);
  $('#me').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { await api('PUT', '/api/settings', { initials: $('#ini').value }); await getMeta(true); await refreshWho(); }, 'Initials saved');
  });
  $('#pricing').addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { await api('PUT', '/api/settings', { pricingFrom: $('#pf').value }); await getMeta(true); }, 'Pricing date saved');
  });
  $('#folders')?.addEventListener('submit', (e) => {
    e.preventDefault();
    act(e.submitter, async () => { await api('PUT', '/api/settings', { instrumentFolders: { chemistry: $('#fchem').value, hematology: $('#fhem').value } }); await getMeta(true); }, 'Folders saved');
  });
  $('#export').addEventListener('click', (e) => act(e.currentTarget, () => download('/api/export'), 'Backup downloaded'));
  $('#reset').addEventListener('click', (e) => {
    if (!confirm('Replace all pilot data with fresh test data? Anything you entered will be lost (download a backup first if you want it).')) return;
    act(e.currentTarget, async () => { await api('POST', '/api/reset', {}); await getMeta(true); location.hash = '#/'; }, 'Pilot data reset');
  });
}
