import { listItems, addItem, updateItem, deleteItem, upsertByName, logActivity } from './db.js';

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

const hasBarcodeDetector = 'BarcodeDetector' in window;

async function startScan(targetInputId) {
  if (!hasBarcodeDetector) {
    alert('Barcode scanning is not supported in this browser.\nUse Chrome/Edge on Android over HTTPS.');
    return;
  }

  try {
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'code_128', 'upc_e']
    });

    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });

    const video = document.createElement('video');
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    video.className = 'scanner-video';
    document.body.appendChild(video);

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    let active = true;

    async function tick() {
      if (!active) return;
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const codes = await detector.detect(canvas);
        if (codes.length) {
          const value = codes[0].rawValue;
          document.getElementById(targetInputId).value = value;
          stop();
          return;
        }
      }
      requestAnimationFrame(tick);
    }

    function stop() {
      active = false;
      stream.getTracks().forEach(t => t.stop());
      video.remove();
    }

    tick();
  } catch (err) {
    console.error(err);
    alert('Could not access camera for scanning.');
  }
}


const THEME_KEY = 'restocker:theme';
const LAST_UNIT = 'restocker:last-unit';

function setTheme(t){
  localStorage.setItem(THEME_KEY, t);
  document.body.classList.toggle('theme-dark', t === 'dark');
}
function getTheme(){
  return localStorage.getItem(THEME_KEY) || 'dark';
}
function setLastUnit(u){ localStorage.setItem(LAST_UNIT, u); }
function getLastUnit(){ return localStorage.getItem(LAST_UNIT) || 'pcs'; }

const toastRoot = document.getElementById('toast-root');
function toast(msg, kind='ok'){
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'warn' ? ' warn' : '');
  el.innerHTML = `<span class="dot"></span><span>${msg}</span>`;
  toastRoot.appendChild(el);
  setTimeout(() => el.style.opacity = '0', 2200);
  setTimeout(() => el.remove(), 2700);
}

function blobDownload(filename, mime, text){
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function selectTab(key){
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === key));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== key + '-view'));
}

async function computeLowItems(items){
  return items.filter(i => Number(i.threshold) > 0 && Number(i.quantity) <= Number(i.threshold));
}

async function updateBadge(){
  const items = await listItems();
  const lows = await computeLowItems(items);
  const badge = $('#shopping-badge');
  if (lows.length){
    badge.textContent = lows.length;
    badge.classList.add('show');
  } else {
    badge.classList.remove('show');
  }
}

/* ---------- RENDERERS ---------- */

async function renderInventory(){
  const items = await listItems();
  const host = $('#inventory-view');

  if (!items.length){
    host.innerHTML = '<p class="muted">No items yet. Add your first item in the <strong>Add</strong> tab.</p>';
  } else {
    const rows = items
      .slice()
      .sort((a,b) => (a.name || '').localeCompare(b.name || ''))
      .map(i => {
        const low = Number(i.threshold) > 0 && Number(i.quantity) <= Number(i.threshold);
        return `<div class="card-row${low ? ' low' : ''}">
          <div>
            <strong>${i.name}</strong>
            <div class="meta">${i.quantity} ${(i.unit || '').toUpperCase()} · ${i.store || 'No store'}</div>
          </div>
          <button class="pill-btn pill-small" data-use1="${i.id}">-1</button>
        </div>`;
      }).join('');
    host.innerHTML = `<div class="card">${rows}</div>`;
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

async function renderShopping(){
  const items = await listItems();
  const lows = await computeLowItems(items);
  const host = $('#shopping-view');

  if (!lows.length){
    host.innerHTML = '<p class="muted">Nothing below threshold yet.</p>';
  } else {
    const rows = lows
      .sort((a,b) => (a.name || '').localeCompare(b.name || ''))
      .map(i => {
        const need = (Number(i.threshold) || 0) - (Number(i.quantity) || 0);
        return `<li>${i.name} — need ${need} ${i.unit || ''}</li>`;
      })
      .join('');
    host.innerHTML = `<div class="card"><h3>Below minimum</h3><ul>${rows}</ul></div>`;
  }

  await updateBadge();
}

async function renderAdd(){
  const host = $('#add-view');
  host.innerHTML = `<div class="card">
    <h3>Add / Edit Item</h3>
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
    const qty = parseFloat($('#qty').value || '0');
    const unit = $('#unit').value;
    const store = $('#store').value.trim();
    const threshold = parseFloat($('#threshold').value || '0');
    if (!name){
      toast('Name required','warn');
      return;
    }
    await addItem({ name, quantity: qty, unit, store, threshold });
    setLastUnit(unit);
    $('#name').value = '';
    $('#qty').value = '';
    $('#store').value = '';
    $('#threshold').value = '';
    toast('Item saved');
    await renderInventory();
    await renderShopping();
  };
}

async function renderSummary(){
  const items = await listItems();
  const host = $('#summary-view');
  const total = items.length;
  const lows = await computeLowItems(items);
  host.innerHTML = `<div class="card">
    <h3>Overview</h3>
    <p>Total items: <strong>${total}</strong></p>
    <p>Below minimum: <strong>${lows.length}</strong></p>
  </div>`;
}

/* ---------- CSV EXPORT / IMPORT ---------- */

async function exportCSV(){
  const items = await listItems();
  const headers = ['name','quantity','unit','store','threshold'];
  const lines = [headers.join(',')];

  for (const it of items){
    const row = headers.map(h => {
      const v = it[h] != null ? String(it[h]) : '';
      return `"${v.replace(/"/g,'""')}"`;
    }).join(',');
    lines.push(row);
  }

  blobDownload('restocker-inventory.csv','text/csv', lines.join('\n'));
  toast('CSV exported');
}

async function importCSVFile(file){
  const text = await file.text();
  const rows = text.split(/\r?\n/).map(r => r.trim()).filter(r => r.length);

  if (!rows.length){
    toast('CSV is empty','warn');
    return;
  }

  const first = rows[0].split(',');
  const normalizedHeader = first.map(h => h.replace(/^"|"$/g,'').trim().toLowerCase());
  const hasHeader = normalizedHeader.includes('name');

  let header;
  let dataRows;
  if (hasHeader){
    header = normalizedHeader;
    dataRows = rows.slice(1);
  } else {
    header = ['name','quantity','unit','store','threshold'];
    dataRows = rows;
  }

  const idx = name => header.indexOf(name);

  const items = [];

  for (const line of dataRows){
    if (!line.trim()) continue;
    const cols = line.split(',').map(c => c.replace(/^"|"$/g,'').trim());
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

  if (!items.length){
    toast('No valid rows found','warn');
    return;
  }

  await upsertByName(items);
  toast('CSV imported');
  await renderInventory();
  await renderShopping();
  await renderSummary();
}

async function renderSettings(){
  const host = $('#settings-view');
  host.innerHTML = `
    <div class="card">
      <h3>Display</h3>
      <p>Current theme: <strong>${getTheme()}</strong></p>
      <p class="muted">Dark / light toggle in the header button.</p>
      <hr>
      <h3>Data</h3>
      <p class="muted">Export or import your inventory as CSV.</p>
      <div class="settings-actions">
        <button id="export-csv" class="pill-btn" type="button">Export CSV</button>
        <button id="import-csv" class="pill-btn" type="button">Import CSV</button>
        <input id="import-csv-file" type="file" accept=".csv,text/csv" style="display:none">
      </div>
    </div>
  `;

  const exportBtn = $('#export-csv');
  const importBtn = $('#import-csv');
  const fileInput = $('#import-csv-file');

  exportBtn.onclick = () => { exportCSV(); };

  importBtn.onclick = () => {
    fileInput.value = '';
    fileInput.click();
  };

  fileInput.onchange = async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file) return;
    await importCSVFile(file);
  };
}

/* ---------- THEME TOGGLE ---------- */

function initThemeToggle(){
  const current = getTheme();
  setTheme(current);
  const btn = document.getElementById('theme-toggle');
  btn.textContent = current === 'dark' ? '☾' : '☀';
  btn.onclick = () => {
    const next = getTheme() === 'dark' ? 'light' : 'dark';
    setTheme(next);
    btn.textContent = next === 'dark' ? '☾' : '☀';
  };
}

/* ---------- BOOT ---------- */

window.addEventListener('load', async () => {
  // Tabs
  $$('.tab').forEach(t => t.onclick = () => selectTab(t.dataset.tab));

  // Theme
  initThemeToggle();

  // Service worker
  if ('serviceWorker' in navigator){
    try { await navigator.serviceWorker.register('./service-worker.js'); } catch (e) {}
  }

  // Initial renders
  await renderInventory();
  await renderShopping();
  await renderAdd();
  await renderSummary();
  await renderSettings();
});
