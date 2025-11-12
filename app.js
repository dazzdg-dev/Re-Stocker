import { addItem, listItems, deleteItem, updateItem, upsertByName } from './db.js';

const $ = (sel)=>document.querySelector(sel);
const $$ = (sel)=>Array.from(document.querySelectorAll(sel));

function daysLeft(quantity, dailyUse){
  if(!dailyUse || dailyUse <= 0) return Infinity;
  return quantity / dailyUse;
}
function lowStock(quantity, threshold, dleft){
  return quantity <= threshold || dleft <= 3;
}
function fmt(n){ return (Math.round(n*10)/10).toString(); }

/* ---------- UI helpers ---------- */
function selectTab(id){
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab===id));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== id+'-view'));
}
function toast(msg, kind='ok', ms=3500){
  const root = $('#toast-root');
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = `<span class="dot ${kind==='warn'?'warn':'ok'}"></span><span>${msg}</span>`;
  root.appendChild(el);
  setTimeout(()=>{ el.style.opacity='0'; el.style.transform='translateY(-6px)'; }, ms-300);
  setTimeout(()=> root.removeChild(el), ms);
}

/* ---------- Rendering ---------- */
async function renderList(filter=''){
  const items = await listItems();
  const root = $('#inventory-list');
  root.innerHTML='';
  const normalized = filter.trim().toLowerCase();
  items
    .filter(i => !normalized || (i.name||'').toLowerCase().includes(normalized))
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''))
    .forEach(item=>{
      const dleft = daysLeft(item.quantity, item.dailyUse);
      const percent = Math.max(0, Math.min(100, (item.threshold>0? (item.quantity/item.threshold)*50 : 50) + 50));
      const isLow = lowStock(item.quantity, item.threshold, dleft);

      const row = document.createElement('div');
      row.className='item';

      row.innerHTML = `
        <div class="list">
          <div>
            <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
              <strong>${item.name}</strong>
              <span class="badge">${item.category||'Uncategorized'}</span>
            </div>
            <div class="kv" style="margin-top:6px">
              <div>Qty</div><div>${item.quantity} ${item.unit||''}</div>
              <div>Daily use</div><div>${item.dailyUse||0}</div>
              <div>Threshold</div><div>${item.threshold||0}</div>
              <div>Days left</div><div>${dleft===Infinity?'—':fmt(dleft)}</div>
            </div>
            <div class="bar" style="margin-top:8px">
              <div class="fill ${isLow?'alert':''}" style="width:${Math.max(2, Math.min(100, percent))}%"></div>
            </div>
            <small class="muted">Added: ${item.dateAdded||'—'} ${item.notes?('• '+item.notes):''}</small>
          </div>
          <div class="actions" style="justify-content:flex-end;align-items:start">
            <button class="ghost" data-edit="${item.id}">Edit</button>
            <button class="ghost" data-consume="${item.id}">- Consume</button>
            <button data-del="${item.id}">Delete</button>
          </div>
        </div>
      `;
      root.appendChild(row);
    });

  // actions
  root.querySelectorAll('button[data-del]').forEach(btn=>{
    btn.onclick = async ()=>{
      await deleteItem(parseInt(btn.dataset.del,10));
      renderList($('#search').value);
      renderShopList();
    };
  });
  root.querySelectorAll('button[data-consume]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = parseInt(btn.dataset.consume,10);
      const items = await listItems();
      const item = items.find(i=>i.id===id);
      if(!item) return;
      const amt = parseFloat(prompt('Consume amount:', '1')||'0');
      if(isNaN(amt) || amt<=0) return;
      item.quantity = Math.max(0, (parseFloat(item.quantity)||0) - amt);
      await updateItem(item);
      renderList($('#search').value);
      renderShopList();
    };
  });
  root.querySelectorAll('button[data-edit]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = parseInt(btn.dataset.edit,10);
      const items = await listItems();
      const item = items.find(i=>i.id===id);
      if(!item) return;
      $('#name').value = item.name || '';
      $('#category').value = item.category || '';
      $('#unit').value = item.unit || '';
      $('#quantity').value = item.quantity || 0;
      $('#threshold').value = item.threshold || 0;
      $('#dailyUse').value = item.dailyUse || 0;
      $('#notes').value = item.notes || '';
      $('#dateAdded').value = item.dateAdded || '';
      $('#itemId').value = item.id;
      selectTab('add');
    };
  });
}

async function renderShopList(){
  const items = await listItems();
  const root = $('#shop-list');
  root.innerHTML='';
  items
    .filter(i=> lowStock(i.quantity, i.threshold, daysLeft(i.quantity, i.dailyUse)))
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''))
    .forEach(i=>{
      const li = document.createElement('div');
      li.className='item';
      li.innerHTML = `<div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div><strong>${i.name}</strong><div class="small muted">Qty ${i.quantity} ${i.unit||''}</div></div>
        <button class="ghost" data-topup="${i.id}">+ Restock</button>
      </div>`;
      root.appendChild(li);
    });

  root.querySelectorAll('button[data-topup]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = parseInt(btn.dataset.topup,10);
      const items = await listItems();
      const item = items.find(x=>x.id===id);
      if(!item) return;
      const amt = parseFloat(prompt('Add amount to quantity:', '1')||'0');
      if(isNaN(amt) || amt<=0) return;
      item.quantity = (parseFloat(item.quantity)||0) + amt;
      item.dateAdded = new Date().toISOString().slice(0,10);
      await updateItem(item);
      renderList($('#search').value);
      renderShopList();
    };
  });
}

/* ---------- Forms & exports ---------- */
async function handleSave(e){
  e.preventDefault();
  const id = parseInt($('#itemId').value || '0', 10) || null;
  const item = {
    id: id || undefined,
    name: $('#name').value.trim(),
    category: $('#category').value.trim(),
    unit: $('#unit').value.trim() || 'unit',
    quantity: parseFloat($('#quantity').value||'0'),
    threshold: parseFloat($('#threshold').value||'0'),
    dailyUse: parseFloat($('#dailyUse').value||'0'),
    notes: $('#notes').value.trim(),
    dateAdded: $('#dateAdded').value || new Date().toISOString().slice(0,10),
  };
  if(!item.name){ alert('Name is required'); return; }
  if(id){ await updateItem(item); } else { await addItem(item); }
  $('#form').reset();
  $('#itemId').value='';
  selectTab('inventory');
  toast('Item saved');
  renderList($('#search').value);
  renderShopList();
}

function downloadBlob(name, mime, text){
  const blob = new Blob([text], {type:mime});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name; a.click();
  URL.revokeObjectURL(url);
}

async function exportJSON(){
  const items = await listItems();
  downloadBlob('restocker-backup.json', 'application/json', JSON.stringify(items, null, 2));
  toast('Exported JSON');
}
async function exportInventoryCSV(){
  const items = await listItems();
  const headers = ['name','category','unit','quantity','threshold','dailyUse','dateAdded','notes'];
  const rows = items.map(i => headers.map(h => String(i[h] ?? '')).map(v => `"${v.replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  downloadBlob('restocker-inventory.csv', 'text/csv', csv);
  toast('Exported CSV');
}
function exportShoppingList(){
  const text = Array.from($('#shop-list').querySelectorAll('.item strong'))
    .map(el=> '- ' + el.textContent.trim())
    .join('\n');
  downloadBlob('shopping-list.md', 'text/markdown', text);
  toast('Exported Markdown');
}

async function importJSONFile(file){
  const text = await file.text();
  let data;
  try { data = JSON.parse(text); } catch(e){ alert('Invalid JSON'); return; }
  if(!Array.isArray(data)){ alert('JSON must be an array of items'); return; }
  await upsertByName(data);
  toast('Import complete');
  selectTab('inventory');
  renderList($('#search').value);
  renderShopList();
}

/* ---------- Launch flow ---------- */
async function lowStockCheck(){
  const items = await listItems();
  const lows = items.filter(i => lowStock(i.quantity, i.threshold, daysLeft(i.quantity, i.dailyUse)));
  if(lows.length > 0){
    toast(`${lows.length} item${lows.length>1?'s':''} low on stock`, 'warn', 4500);
    // also fire a notification if allowed
    if('Notification' in window && Notification.permission === 'granted'){
      try {
        const reg = await navigator.serviceWorker.ready;
        reg.showNotification('Re-Stocker', { body: `${lows.length} item(s) low on stock`, tag:'lowstock' });
      } catch(e) {}
    }
  } else {
    toast('All stocked up');
  }
}

window.addEventListener('load', async ()=>{
  // Tabs
  $$('.tab').forEach(t => t.onclick = ()=> selectTab(t.dataset.tab));
  selectTab('inventory');

  // Form
  $('#form').addEventListener('submit', handleSave);

  // Exports / Imports
  $('#export-md').addEventListener('click', exportShoppingList);
  $('#export-csv').addEventListener('click', exportInventoryCSV);
  $('#export-json').addEventListener('click', exportJSON);
  $('#import-json').addEventListener('click', ()=> $('#import-file').click());
  $('#import-file').addEventListener('change', (e)=> {
    const f = e.target.files && e.target.files[0];
    if(f) importJSONFile(f);
    e.target.value = '';
  });

  // Search
  $('#search').addEventListener('input', (e)=> renderList(e.target.value));

  // Render
  await renderList();
  await renderShopList();

  // PWA
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./service-worker.js'); }catch(e){}
  }

  // Notifications toggle
  $('#notify').addEventListener('click', async ()=>{
    if(!('Notification' in window)) return alert('Notifications not supported');
    const perm = await Notification.requestPermission();
    if(perm !== 'granted') return;
    const reg = await navigator.serviceWorker.ready;
    reg.showNotification('Re-Stocker notifications enabled');
  });

  // Low stock toast on launch
  lowStockCheck();
});
