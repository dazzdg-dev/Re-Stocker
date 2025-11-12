import { addItem, listItems, deleteItem, updateItem, upsertByName } from './db.js';

const $ = (sel)=>document.querySelector(sel);
const $$ = (sel)=>Array.from(document.querySelectorAll(sel));

/* helpers */
function daysLeft(quantity, dailyUse){ if(!dailyUse || dailyUse<=0) return Infinity; return quantity/dailyUse; }
function lowStock(q,t,d){ return q<=t || d<=3; }
function fmt(n){ return (Math.round(n*10)/10).toString(); }
function selectTab(id){ $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===id)); $$('.view').forEach(v=>v.classList.toggle('hidden', v.id!==id+'-view')); }
function toast(msg, kind='ok', ms=3500){ const r=$('#toast-root'); const el=document.createElement('div'); el.className='toast'; el.innerHTML=`<span class="dot ${kind==='warn'?'warn':'ok'}"></span><span>${msg}</span>`; r.appendChild(el); setTimeout(()=>{el.style.opacity='0';el.style.transform='translateY(-6px)';},ms-300); setTimeout(()=>r.removeChild(el),ms); }

/* unit & store memory */
const LAST_UNIT_KEY = 'restocker:lastUnit';
const STORE_HISTORY_KEY = 'restocker:storeHistory';
const getLastUnit = ()=> localStorage.getItem(LAST_UNIT_KEY) || 'g';
const setLastUnit = u => localStorage.setItem(LAST_UNIT_KEY,u);
const getStoreHistory = ()=> { try{return JSON.parse(localStorage.getItem(STORE_HISTORY_KEY)||'[]');}catch{return[]} };
function addStoreHistory(v){ v=(v||'').trim(); if(!v) return; const list=getStoreHistory(); const i=list.findIndex(x=>x.toLowerCase()===v.toLowerCase()); if(i>=0) list.splice(i,1); list.unshift(v); while(list.length>12) list.pop(); localStorage.setItem(STORE_HISTORY_KEY, JSON.stringify(list)); }
function renderStoreDatalist(){ const dl=$('#store-list'); dl.innerHTML=''; getStoreHistory().forEach(s=>{ const o=document.createElement('option'); o.value=s; dl.appendChild(o); }); }

/* renderers */
async function renderList(filter=''){
  const items = await listItems();
  const root = $('#inventory-list');
  root.innerHTML='';
  const normalized = filter.trim().toLowerCase();
  items
    .filter(i=>!normalized || (i.name||'').toLowerCase().includes(normalized))
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''))
    .forEach(item=>{
      const dleft = daysLeft(item.quantity, item.dailyUse);
      const percent = Math.max(0, Math.min(100, (item.threshold>0? (item.quantity/item.threshold)*50 : 50)+50));
      const isLow = lowStock(item.quantity, item.threshold, dleft);
      const price = (typeof item.pricePaid==='number' && !isNaN(item.pricePaid)) ? `ZAR ${item.pricePaid.toFixed(2)}` : '—';
      const ts = item.purchaseTs ? new Date(item.purchaseTs).toLocaleString() : '—';

      const row = document.createElement('div');
      row.className='item';
      row.innerHTML = `
        <div class="list">
          <div>
            <div style="display:flex;gap:8px;align-items:center;justify-content:space-between">
              <strong>${item.name}</strong>
              <span class="badge">${(item.store||'').trim() || (item.category||'Uncategorized')}</span>
            </div>
            <div class="kv" style="margin-top:6px">
              <div>Qty</div><div>${item.quantity} ${item.unit||''}</div>
              <div>Daily use</div><div>${item.dailyUse||0}</div>
              <div>Threshold</div><div>${item.threshold||0}</div>
              <div>Days left</div><div>${dleft===Infinity?'—':fmt(dleft)}</div>
              <div>Price Paid</div><div>${price}</div>
              <div>Purchased</div><div>${ts}</div>
            </div>
            <div class="bar" style="margin-top:8px">
              <div class="fill ${isLow?'alert':''}" style="width:${Math.max(2, Math.min(100, percent))}%"></div>
            </div>
            <div class="btn-row">
              <button class="ghost btn-sm" data-minus1="${item.id}">−1</button>
              <button class="ghost btn-sm" data-minus10="${item.id}">−10</button>
              <button class="ghost btn-sm" data-consume="${item.id}">− Custom</button>
              <button class="btn-sm" data-topup="${item.id}">+ Restock</button>
            </div>
            <small class="muted">Added: ${item.dateAdded||'—'} ${item.notes?('• '+item.notes):''}</small>
          </div>
          <div class="actions" style="justify-content:flex-end;align-items:start">
            <button class="ghost" data-edit="${item.id}">Edit</button>
            <button data-del="${item.id}">Delete</button>
          </div>
        </div>`;
      root.appendChild(row);
    });

  // actions
  root.querySelectorAll('button[data-del]').forEach(btn=>{
    btn.onclick = async ()=>{ await deleteItem(parseInt(btn.dataset.del,10)); renderList($('#search').value); renderShopList(); };
  });
  root.querySelectorAll('button[data-minus1]').forEach(btn=> btn.onclick = ()=> quickConsume(btn.dataset.minus1,1));
  root.querySelectorAll('button[data-minus10]').forEach(btn=> btn.onclick = ()=> quickConsume(btn.dataset.minus10,10));
  root.querySelectorAll('button[data-consume]').forEach(btn=>{
    btn.onclick = async ()=>{ const id=parseInt(btn.dataset.consume,10); const amt=parseFloat(prompt('Consume amount:','1')||'0'); if(isNaN(amt)||amt<=0) return; await quickConsume(id, amt); };
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
      renderList($('#search').value); renderShopList();
    };
  });
  root.querySelectorAll('button[data-edit]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = parseInt(btn.dataset.edit,10);
      const items = await listItems();
      const item = items.find(i=>i.id===id); if(!item) return;
      $('#name').value = item.name||''; $('#category').value=item.category||'';
      $('#unit').value = item.unit || getLastUnit(); $('#quantity').value=item.quantity||0;
      $('#threshold').value=item.threshold||0; $('#dailyUse').value=item.dailyUse||0;
      $('#store').value=item.store||''; $('#notes').value=item.notes||'';
      $('#purchaseTs').value = item.purchaseTs ? toLocalDT(item.purchaseTs) : '';
      $('#pricePaid').value = (typeof item.pricePaid==='number' && !isNaN(item.pricePaid)) ? item.pricePaid : '';
      $('#itemId').value = item.id;
      selectTab('add');
    };
  });
}

function toLocalDT(iso){
  // Convert ISO string to value acceptable by <input type="datetime-local">
  const d = new Date(iso);
  const pad = n => String(n).padStart(2,'0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

async function quickConsume(id, amt){
  const items = await listItems();
  const item = items.find(i=>i.id===parseInt(id,10));
  if(!item) return;
  item.quantity = Math.max(0, (parseFloat(item.quantity)||0) - parseFloat(amt||0));
  await updateItem(item);
  toast(`Consumed ${amt} ${item.unit||''} from ${item.name}`);
  renderList($('#search').value); renderShopList();
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
        <div>
          <strong>${i.name}</strong>
          <div class="small muted">Qty ${i.quantity} ${i.unit||''} • ${i.store||'No store'}</div>
        </div>
        <button class="ghost btn-sm" data-topup="${i.id}">+ Restock</button>
      </div>`;
      root.appendChild(li);
    });
  root.querySelectorAll('button[data-topup]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = parseInt(btn.dataset.topup,10);
      const items = await listItems();
      const item = items.find(x=>x.id===id); if(!item) return;
      const amt = parseFloat(prompt('Add amount to quantity:', '1')||'0');
      if(isNaN(amt) || amt<=0) return;
      item.quantity = (parseFloat(item.quantity)||0) + amt;
      item.dateAdded = new Date().toISOString().slice(0,10);
      await updateItem(item);
      renderList($('#search').value); renderShopList();
    };
  });
}

/* exports/imports */
function downloadBlob(name, mime, text){ const b=new Blob([text],{type:mime}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u;a.download=name;a.click();URL.revokeObjectURL(u); }
async function exportJSON(){ const items=await listItems(); downloadBlob('restocker-backup.json','application/json',JSON.stringify(items,null,2)); toast('Exported JSON'); }
async function exportInventoryCSV(){
  const items = await listItems();
  const headers = ['name','category','unit','quantity','threshold','dailyUse','store','pricePaid','purchaseTs','dateAdded','notes'];
  const rows = items.map(i => headers.map(h => String(i[h] ?? '')).map(v => `"${v.replace(/"/g,'""')}"`).join(','));
  const csv = [headers.join(','), ...rows].join('\n');
  downloadBlob('restocker-inventory.csv', 'text/csv', csv);
  toast('Exported CSV');
}
function exportShoppingList(){
  const text = Array.from($('#shop-list').querySelectorAll('.item strong')).map(el=> '- '+el.textContent.trim()).join('\n');
  downloadBlob('shopping-list.md','text/markdown',text); toast('Exported Markdown');
}
async function importJSONFile(file){
  const txt = await file.text();
  let data; try{ data=JSON.parse(txt);}catch(e){ alert('Invalid JSON'); return; }
  if(!Array.isArray(data)){ alert('JSON must be an array of items'); return; }
  await upsertByName(data);
  data.forEach(d => addStoreHistory((d.store||'').trim()));
  renderStoreDatalist();
  toast('Import complete'); selectTab('inventory'); renderList($('#search').value); renderShopList();
}

/* save handler */
async function handleSave(e){
  e.preventDefault();
  const id = parseInt($('#itemId').value || '0', 10) || null;
  const unit = $('#unit').value || getLastUnit(); setLastUnit(unit);
  const storeVal = ($('#store').value || '').trim(); if(storeVal) addStoreHistory(storeVal); renderStoreDatalist();

  const pricePaidRaw = $('#pricePaid').value;
  const purchaseTsRaw = $('#purchaseTs').value; // local format

  const item = {
    id: id || undefined,
    name: $('#name').value.trim(),
    category: $('#category').value.trim(),
    unit,
    quantity: parseFloat($('#quantity').value||'0'),
    threshold: parseFloat($('#threshold').value||'0'),
    dailyUse: parseFloat($('#dailyUse').value||'0'),
    store: storeVal,
    notes: $('#notes').value.trim(),
    // NEW
    pricePaid: pricePaidRaw === '' ? null : Number(pricePaidRaw),
    purchaseTs: purchaseTsRaw ? new Date(purchaseTsRaw).toISOString() : null,
    dateAdded: new Date().toISOString().slice(0,10)
  };

  if(!item.name){ alert('Name is required'); return; }
  if(id){ await updateItem(item); } else { await addItem(item); }
  $('#form').reset(); $('#unit').value=getLastUnit(); $('#itemId').value='';
  selectTab('inventory'); toast('Item saved'); renderList($('#search').value); renderShopList();
}

/* low-stock toast on launch */
async function lowStockCheck(){
  const items = await listItems();
  const lows = items.filter(i=> lowStock(i.quantity,i.threshold,daysLeft(i.quantity,i.dailyUse)));
  if(lows.length>0){
    toast(`${lows.length} item${lows.length>1?'s':''} low on stock`,'warn',4500);
    if('Notification' in window && Notification.permission==='granted'){
      try{ (await navigator.serviceWorker.ready).showNotification('Re-Stocker',{body:`${lows.length} item(s) low on stock`,tag:'lowstock'});}catch(e){}
    }
  } else { toast('All stocked up'); }
}

/* boot */
window.addEventListener('load', async ()=>{
  $$('.tab').forEach(t=> t.onclick=()=>selectTab(t.dataset.tab));
  selectTab('inventory');
  $('#unit').value=getLastUnit(); renderStoreDatalist();
  $('#form').addEventListener('submit', handleSave);
  $('#export-md').addEventListener('click', exportShoppingList);
  $('#export-csv').addEventListener('click', exportInventoryCSV);
  $('#export-json').addEventListener('click', exportJSON);
  $('#import-json').addEventListener('click', ()=> $('#import-file').click());
  $('#import-file').addEventListener('change', (e)=>{ const f=e.target.files&&e.target.files[0]; if(f) importJSONFile(f); e.target.value=''; });
  $('#search').addEventListener('input', (e)=> renderList(e.target.value));
  await renderList(); await renderShopList();
  if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./service-worker.js'); }catch(e){} }
  $('#notify').addEventListener('click', async ()=>{ if(!('Notification' in window)) return alert('Notifications not supported'); const perm=await Notification.requestPermission(); if(perm!=='granted') return; (await navigator.serviceWorker.ready).showNotification('Re-Stocker notifications enabled'); });
  lowStockCheck();
});
