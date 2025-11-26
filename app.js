import {
  listItems,
  addItem,
  updateItem,
  deleteItem,
  upsertByName,
  logActivity
} from './db.js';

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const THEME_KEY = 'restocker:theme';
const LAST_UNIT = 'restocker:last-unit';

/* ---------- Theme helpers ---------- */

function setTheme(t) {
  localStorage.setItem(THEME_KEY, t);
  document.body.classList.toggle('theme-dark',  t === 'dark');
  document.body.classList.toggle('theme-light', t === 'light');
}

function getTheme() {
  return localStorage.getItem(THEME_KEY) || 'dark';
}

function setLastUnit(u) {
  localStorage.setItem(LAST_UNIT, u);
}
function getLastUnit() {
  return localStorage.getItem(LAST_UNIT) || 'pcs';
}

/* ---------- Toast ---------- */

const toastRoot = document.getElementById('toast-root');

function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'warn' ? ' warn' : '');
  el.textContent = msg;
  toastRoot.appendChild(el);
  setTimeout(() => el.style.opacity = '0', 2200);
  setTimeout(() => el.remove(), 2700);
}

/* ---------- Sync helpers (local link-based) ---------- */

function encodeB64(str) {
  return btoa(unescape(encodeURIComponent(str)));
}
function decodeB64(str) {
  return decodeURIComponent(escape(atob(str)));
}

async function makeSyncLink() {
  const items = await listItems();
  const json  = JSON.stringify(items);
  const b64   = encodeB64(json);
  return `${location.origin}${location.pathname}#sync=${b64}`;
}

async function importFromHash() {
  if (!location.hash.startsWith('#sync=')) return;
  try {
    const b64  = location.hash.slice('#sync='.length);
    const json = decodeB64(b64);
    const data = JSON.parse(json);
    if (Array.isArray(data)) {
      await upsertByName(data);
      toast('Sync imported');
      history.replaceState(null, '', location.pathname);
    }
  } catch (e) {
    console.error(e);
    toast('Invalid sync link', 'warn');
  }
}

/* ---------- Tab handling ---------- */

function selectTab(key) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== key + '-view'));
}

async function computeLow(items) {
  return items.filter(
    i => Number(i.threshold) > 0 && Number(i.quantity) <= Number(i.threshold)
  );
}

async function updateBadge() {
  const items = await listItems();
  const lows  = await computeLow(items);
  const badge = $('#shopping-badge');
  if (lows.length) {
    badge.textContent = lows.length;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

/* ---------- Renders ---------- */

async function renderInventory() {
  const items = await listItems();
  const host  = $('#inventory-view');

  if (!items.length) {
    host.innerHTML = `<div class="card">
      <p class="muted">No items yet. Add something in the <strong>Add</strong> tab.</p>
    </div>`;
  } else {
    const rows = items
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => {
        const low = Number(i.threshold) > 0 && Number(i.quantity) <= Number(i.threshold);
        return `<div class="card-row${low ? ' low' : ''}">
          <div>
            <strong>${i.name}</strong>
            <div class="meta">${i.quantity} ${(i.unit || '').toUpperCase()} · ${i.store || 'No store'}</div>
          </div>
          <button class="pill-btn pill-small" data-use1="${i.id}">-1</button>
        </div>`;
      })
      .join('');

    host.innerHTML = `<div class="card">
      <h3>Inventory</h3>
      ${rows}
    </div>`;
  }

  await updateBadge();

  host.querySelectorAll('[data-use1]').forEach(btn => {
    btn.onclick = async () => {
      const id = Number(btn.dataset.use1);
      await logActivity(id, { type: 'use', qty: 1 });
      await renderInventory();
      await renderShopping();
      toast('Used 1 unit');
    };
  });
}

async function renderShopping() {
  const items = await listItems();
  const lows  = await computeLow(items);
  const host  = $('#shopping-view');

  if (!lows.length) {
    host.innerHTML = `<div class="card">
      <p class="muted">Nothing below minimum level yet.</p>
    </div>`;
  } else {
    const rows = lows
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(i => {
        const need = (i.threshold || 0) - (i.quantity || 0);
        return `<li>${i.name} — need ${need} ${i.unit || ''}</li>`;
      })
      .join('');
    host.innerHTML = `<div class="card">
      <h3>Below minimum</h3>
      <ul>${rows}</ul>
    </div>`;
  }

  await updateBadge();
}

async function renderAdd() {
  const host = $('#add-view');
  host.innerHTML = `<div class="card">
    <h3>Add Item</h3>
    <div class="form-grid">
      <input id="name" placeholder="Item name">
      <input id="qty" type="number" step="0.01" placeholder="Quantity">
      <select id="unit">
        <option value="pcs">pcs</option>
        <option value="g">g</option>
        <option value="ml">ml</option>
        <option value="l">l</option>
      </select>
      <input id="store" placeholder="Store (optional)">
      <input id="threshold" type="number" step="0.01" placeholder="Min level (for alerts)">
      <button id="save-btn" class="pill-btn" type="button">Save</button>
    </div>
  </div>`;

  $('#unit').value = getLastUnit();

  $('#save-btn').onclick = async () => {
    const name = $('#name').value.trim();
    const qty  = parseFloat($('#qty').value || '0');
    const unit = $('#unit').value;
    const store= $('#store').value.trim();
    const th   = parseFloat($('#threshold').value || '0');

    if (!name) {
      toast('Name required', 'warn');
      return;
    }

    await addItem({ name, quantity: qty, unit, store, threshold: th });
    setLastUnit(unit);

    $('#name').value      = '';
    $('#qty').value       = '';
    $('#store').value     = '';
    $('#threshold').value = '';

    toast('Item saved');
    await renderInventory();
    await renderShopping();
  };
}

async function renderSummary() {
  const items = await listItems();
  const lows  = await computeLow(items);
  $('#summary-view').innerHTML = `<div class="card">
    <h3>Overview</h3>
    <p>Total items: <strong>${items.length}</strong></p>
    <p>Below minimum: <strong>${lows.length}</strong></p>
  </div>`;
}

/* ---------- CSV Export / Import ---------- */

async function exportCSV() {
  const items = await listItems();
  const headers = ['name', 'quantity', 'unit', 'store', 'threshold'];
  const lines = [headers.join(',')];

  for (const it of items) {
    const row = headers
      .map(h => {
        const v = it[h] != null ? String(it[h]) : '';
        return `"${v.replace(/"/g, '""')}"`;
      })
      .join(',');
    lines.push(row);
  }

  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = 'restocker-inventory.csv';
  a.click();
  URL.revokeObjectURL(url);

  toast('CSV exported');
}

async function importCSVFile(file) {
  const text = await file.text();
  const rows = text.split(/\r?\n/).map(r => r.trim()).filter(Boolean);
  if (!rows.length) {
    toast('CSV empty', 'warn');
    return;
  }

  const first = rows[0].split(',').map(c => c.replace(/^"|"$/g, '').trim().toLowerCase());
  const hasHeader = first.includes('name');
  let header, dataRows;

  if (hasHeader) {
    header   = first;
    dataRows = rows.slice(1);
  } else {
    header   = ['name', 'quantity', 'unit', 'store', 'threshold'];
    dataRows = rows;
  }

  const idx = name => header.indexOf(name);

  const items = [];
  for (const line of dataRows) {
    if (!line.trim()) continue;
    const cols = line.split(',').map(c => c.replace(/^"|"$/g, '').trim());
    const nameIdx = idx('name');
    const qIdx    = idx('quantity');
    const uIdx    = idx('unit');
    const sIdx    = idx('store');
    const tIdx    = idx('threshold');

    const name = nameIdx >= 0 ? cols[nameIdx] : cols[0] || '';
    if (!name) continue;

    const quantity  = qIdx >= 0 ? parseFloat(cols[qIdx] || '0') : 0;
    const unit      = uIdx >= 0 ? (cols[uIdx] || 'pcs') : 'pcs';
    const store     = sIdx >= 0 ? (cols[sIdx] || '') : '';
    const threshold = tIdx >= 0 ? parseFloat(cols[tIdx] || '0') : 0;

    items.push({ name, quantity, unit, store, threshold });
  }

  if (!items.length) {
    toast('No valid rows', 'warn');
    return;
  }

  await upsertByName(items);
  toast('CSV imported');

  await renderInventory();
  await renderShopping();
  await renderSummary();
}

/* ---------- Settings (with CSV + Sync at bottom) ---------- */

async function renderSettings() {
  const host = $('#settings-view');
  host.innerHTML = `
    <div class="card">
      <h3>Display</h3>
      <p>Current theme: <strong>${getTheme()}</strong></p>
      <p class="muted">Toggle theme using the moon/sun button in the header.</p>
    </div>

    <div class="card">
      <h3>Data</h3>
      <p class="muted">Export or import your inventory as CSV (for backups or Excel).</p>
      <button id="export-csv" class="pill-btn">Export CSV</button>
      <button id="import-csv" class="pill-btn">Import CSV</button>
      <input id="import-csv-file" type="file" accept=".csv,text/csv" hidden>
    </div>

    <div class="card">
      <h3>Sync (offline)</h3>
      <p class="muted">Create a link containing your current data. Open it on another device to import.</p>
      <button id="sync-make" class="pill-btn">Create Sync Link</button>
      <button id="sync-copy" class="pill-btn">Copy</button>
      <button id="sync-share" class="pill-btn">Share…</button>
      <p id="sync-out" class="muted" style="word-wrap:break-word;margin-top:8px"></p>
    </div>
  `;

  // CSV
  $('#export-csv').onclick = () => exportCSV();

  $('#import-csv').onclick = () => {
    $('#import-csv-file').value = '';
    $('#import-csv-file').click();
  };

  $('#import-csv-file').onchange = async e => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    await importCSVFile(file);
  };

  // Sync
  $('#sync-make').onclick = async () => {
    const url = await makeSyncLink();
    $('#sync-out').textContent = url;
    toast('Sync link created');
  };

  $('#sync-copy').onclick = async () => {
    const t = $('#sync-out').textContent.trim();
    if (!t) {
      toast('Create a link first', 'warn');
      return;
    }
    await navigator.clipboard.writeText(t);
    toast('Copied');
  };

  $('#sync-share').onclick = async () => {
    const t = $('#sync-out').textContent.trim();
    if (!t) {
      toast('Create a link first', 'warn');
      return;
    }
    if (navigator.share) {
      try {
        await navigator.share({
          title: 'Re-Stocker Sync',
          text: 'Open this link to import my Re-Stocker data.',
          url: t
        });
      } catch (e) {
        // user cancelled – ignore
      }
    } else {
      await navigator.clipboard.writeText(t);
      toast('Copied');
    }
  };
}

/* ---------- Theme toggle ---------- */

function initThemeToggle() {
  const current = getTheme();
  setTheme(current);
  const btn = $('#theme-toggle');
  btn.textContent = current === 'dark' ? '☾' : '☀';
  btn.onclick = () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    btn.textContent = next === 'dark' ? '☾' : '☀';
  };
}

/* ---------- Boot ---------- */

window.addEventListener('load', async () => {
  // Tabs
  $$('.tab').forEach(t => {
    t.onclick = () => selectTab(t.dataset.tab);
  });

  // Theme
  initThemeToggle();

  // Auto-import from sync link (if used)
  await importFromHash();

  // Service worker
  if ('serviceWorker' in navigator) {
    try {
      await navigator.serviceWorker.register('./service-worker.js');
    } catch (e) {
      console.warn('SW registration failed', e);
    }
  }

  // Initial renders
  await renderInventory();
  await renderShopping();
  await renderAdd();
  await renderSummary();
  await renderSettings();
});
