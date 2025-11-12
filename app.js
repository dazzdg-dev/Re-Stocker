
import { addItem, listItems, deleteItem, updateItem } from './js/db.js';

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

function selectTab(id){
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab===id));
  $$('.view').forEach(v => v.classList.toggle('hidden', v.id !== id+'-view'));
}

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
  renderList($('#search').value);
  renderShopList();
}

function exportShoppingList(){
  const text = Array.from($('#shop-list').querySelectorAll('.item strong'))
    .map(el=> '- ' + el.textContent.trim())
    .join('\n');
  const blob = new Blob([text], {type:'text/markdown'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'shopping-list.md'; a.click();
  URL.revokeObjectURL(url);
}

window.addEventListener('load', async ()=>{
  $$('.tab').forEach(t => t.onclick = ()=> selectTab(t.dataset.tab));
  selectTab('inventory');
  $('#form').addEventListener('submit', handleSave);
  $('#export').addEventListener('click', exportShoppingList);
  $('#search').addEventListener('input', (e)=> renderList(e.target.value));
  await renderList();
  await renderShopList();
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./service-worker.js'); }catch(e){}
  }
  $('#notify').addEventListener('click', async ()=>{
    if(!('Notification' in window)) return alert('Notifications not supported');
    const perm = await Notification.requestPermission();
    if(perm !== 'granted') return;
    navigator.serviceWorker.ready.then(reg=>{
      reg.showNotification('Re-Stocker notifications enabled');
    });
  });
});
