import { addItem, listItems, deleteItem, updateItem, upsertByName } from './db.js';

const $  = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));

/* ---------- helpers ---------- */
function daysLeft(quantity, dailyUse){ if(!dailyUse || dailyUse<=0) return Infinity; return quantity/dailyUse; }
function lowStock(q,t,d){ return q<=t || d<=3; }
function fmt(n){ return (Math.round(n*10)/10).toString(); }
function money(n){ return (typeof n==='number' && !isNaN(n)) ? `ZAR ${n.toFixed(2)}` : '—'; }
function selectTab(id){ $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===id)); $$('.view').forEach(v=>v.classList.toggle('hidden', v.id!==id+'-view')); }
function toast(msg, kind='ok', ms=3500){ const r=$('#toast-root'); const el=document.createElement('div'); el.className='toast'; el.innerHTML=`<span class="dot ${kind==='warn'?'warn':'ok'}"></span><span>${msg}</span>`; r.appendChild(el); setTimeout(()=>{el.style.opacity='0';el.style.transform='translateY(-6px)';},ms-300); setTimeout(()=>r.removeChild(el),ms); }
function toLocalDT(iso){ const d=new Date(iso); const pad=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; }
function ymKey(date){ const d=new Date(date); if(isNaN(d)) return null; return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`; }

/* price-per-unit (value + label + kind) */
function computePPU(item){
  const p = item.pricePaid;
  const q = Number(item.quantity||0);
  const u = (item.unit||'').toLowerCase();
  if(!(typeof p==='number') || isNaN(p) || q<=0) return { value:null, label:'—', kind:u };

  if(u==='pcs'){ const v = p/q;     return { value:v, label:`${money(v)} / pc`,    kind:'pcs'   }; }
  if(u==='g'){   const v = p/q*100; return { value:v, label:`${money(v)} / 100g`,  kind:'g100'  }; }
  if(u==='ml'){  const v = p/q*100; return { value:v, label:`${money(v)} / 100ml`, kind:'ml100' }; }
  if(u==='l'){   const v = p/q;     return { value:v, label:`${money(v)} / L`,     kind:'l'     }; }
  const v = p/q; return { value:v, label:`${money(v)} / ${u}`, kind:u };
}
function estimateCost(neededQty, ppu){
  if(!ppu || ppu.value===null) return null;
  switch(ppu.kind){
    case 'pcs':  return neededQty * ppu.value;
    case 'g100': return (neededQty/100) * ppu.value;
    case 'ml100':return (neededQty/100) * ppu.value;
    case 'l':    return neededQty * ppu.value;
    default:     return neededQty * ppu.value;
  }
}

/* ---------- unit & store memory ---------- */
const LAST_UNIT_KEY = 'restocker:lastUnit';
const STORE_HISTORY_KEY = 'restocker:storeHistory';
const getLastUnit = ()=> localStorage.getItem(LAST_UNIT_KEY) || 'g';
const setLastUnit = u => localStorage.setItem(LAST_UNIT_KEY,u);
const getStoreHistory = ()=> { try{return JSON.parse(localStorage.getItem(STORE_HISTORY_KEY)||'[]');}catch{return[]} };
function addStoreHistory(v){ v=(v||'').trim(); if(!v) return; const list=getStoreHistory(); const i=list.findIndex(x=>x.toLowerCase()===v.toLowerCase()); if(i>=0) list.splice(i,1); list.unshift(v); while(list.length>20) list.pop(); localStorage.setItem(STORE_HISTORY_KEY, JSON.stringify(list)); }
function renderStoreDatalist(){ const dl=$('#store-list'); if(!dl) return; dl.innerHTML=''; getStoreHistory().forEach(s=>{ const o=document.createElement('option'); o.value=s; dl.appendChild(o); }); }
function renderStoreFilterOptions(){ const sel = $('#store-filter'); if(!sel) return; const current = sel.value || '__ALL__'; sel.innerHTML = `<option value="__ALL__">All stores</option>`; getStoreHistory().forEach(s=>{ const opt=document.createElement('option'); opt.value=s; opt.textContent=s; sel.appendChild(opt); }); sel.value = current; }

/* ---------- Inventory ---------- */
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
      const ppu = computePPU(item);

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
              <div>Price Paid</div><div>${money(item.pricePaid)}</div>
              <div>Price/Unit</div><div>${ppu.label}</div>
              <div>Purchased</div><div>${item.purchaseTs ? new Date(item.purchaseTs).toLocaleString() : '—'}</div>
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

  bindInventoryActions();
}
function bindInventoryActions(){
  const searchVal = $('#search').value;
  $('#inventory-list').querySelectorAll('button[data-del]').forEach(btn=>{
    btn.onclick = async ()=>{ await deleteItem(parseInt(btn.dataset.del,10)); renderList(searchVal); renderShopList(); renderSummary(); };
  });
  $('#inventory-list').querySelectorAll('button[data-minus1]').forEach(btn=> btn.onclick = ()=> quickConsume(btn.dataset.minus1,1));
  $('#inventory-list').querySelectorAll('button[data-minus10]').forEach(btn=> btn.onclick = ()=> quickConsume(btn.dataset.minus10,10));
  $('#inventory-list').querySelectorAll('button[data-consume]').forEach(btn=>{
    btn.onclick = async ()=>{ const id=parseInt(btn.dataset.consume,10); const amt=parseFloat(prompt('Consume amount:','1')||'0'); if(isNaN(amt)||amt<=0) return; await quickConsume(id, amt); };
  });
  $('#inventory-list').querySelectorAll('button[data-topup]').forEach(btn=>{
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
      renderList(searchVal); renderShopList(); renderSummary();
    };
  });
  $('#inventory-list').querySelectorAll('button[data-edit]').forEach(btn=>{
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
async function quickConsume(id, amt){
  const items = await listItems();
  const item = items.find(i=>i.id===parseInt(id,10));
  if(!item) return;
  item.quantity = Math.max(0, (parseFloat(item.quantity)||0) - parseFloat(amt||0));
  await updateItem(item);
  toast(`Consumed ${amt} ${item.unit||''} from ${item.name}`);
  renderList($('#search').value); renderShopList(); renderSummary();
}

/* ---------- Shopping helpers ---------- */
function neededAmount(i){
  const t = Number(i.threshold||0);
  const q = Number(i.quantity||0);
  if(t>0) return Math.max(0, t - q);
  return 1;
}
function bestPPUForItemAcrossStores(items, itemName){
  const matches = items.filter(x => (x.name||'').toLowerCase() === (itemName||'').toLowerCase())
                       .map(x => ({ store: (x.store||'Unspecified').trim()||'Unspecified', ppu: computePPU(x) }))
                       .filter(x => x.ppu.value !== null);
  if(matches.length===0) return null;
  return matches.reduce((best, cur)=> (best==null || cur.ppu.value < best.ppu.value ? cur : best), null);
}
function bestPPUForItemAtStore(items, itemName, store){
  const matches = items.filter(x => (x.name||'').toLowerCase() === (itemName||'').toLowerCase() &&
                                    (x.store||'').toLowerCase() === (store||'').toLowerCase())
                       .map(x => computePPU(x))
                       .filter(ppu => ppu.value !== null);
  if(matches.length===0) return null;
  return matches.reduce((a,b)=> a.value < b.value ? a : b);
}

/* Build basket rows for exports and UI totals */
function buildBasketData(items, selectedStore, lows){
  const rows = [];
  let total = 0;
  lows.forEach(i=>{
    const need = neededAmount(i);
    const ppuStore = selectedStore==='__ALL__' ? null : bestPPUForItemAtStore(items, i.name, selectedStore);
    const overall = bestPPUForItemAcrossStores(items, i.name); // {store, ppu}
    const chosen = ppuStore || (overall ? overall.ppu : null);
    const cost = chosen ? estimateCost(need, chosen) : null;

    if(cost!=null) total += cost;

    rows.push({
      name: i.name,
      need,
      unit: i.unit || '',
      storeUsed: selectedStore==='__ALL__' ? (overall ? overall.store : 'Unknown') : selectedStore,
      ppuLabel: chosen ? chosen.label : '—',
      note: (!ppuStore && overall) ? `best at ${overall.store}` : (ppuStore ? 'store price used' : 'no price data'),
      est: cost
    });
  });
  return { rows, total };
}

/* ---------- Shopping render (filters, totals, best-buys, exports) ---------- */
async function renderShopList(){
  const items = await listItems();
  const root = $('#shop-list');
  const storeTotalEl = $('#store-total');
  const bestBuysEl = $('#best-buys');
  root.innerHTML='';

  const selectedStore = ($('#store-filter')?.value) || '__ALL__';
  const lows = items
    .filter(i=> lowStock(i.quantity, i.threshold, daysLeft(i.quantity, i.dailyUse)))
    .filter(i=> selectedStore==='__ALL__' ? true : (i.store||'').toLowerCase()===selectedStore.toLowerCase())
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''));

  // Render list
  lows.forEach(i=>{
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

  // Bind top-ups
  root.querySelectorAll('button[data-topup]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = parseInt(btn.dataset.topup,10);
      const cur = (await listItems()).find(x=>x.id===id); if(!cur) return;
      const amt = parseFloat(prompt('Add amount to quantity:', '1')||'0');
      if(isNaN(amt) || amt<=0) return;
      cur.quantity = (parseFloat(cur.quantity)||0) + amt;
      cur.dateAdded = new Date().toISOString().slice(0,10);
      await updateItem(cur);
      renderList($('#search').value); renderShopList(); renderSummary();
    };
  });

  // Store total + best-buys card
  const basket = buildBasketData(items, selectedStore, lows);
  storeTotalEl.textContent = `Estimated basket: ${basket.rows.length ? money(basket.total) : '—'}`;

  if(selectedStore==='__ALL__'){
    bestBuysEl.innerHTML = `<h3>Best buy suggestions</h3><small class="muted">Pick a store above to get tailored suggestions.</small>`;
  } else {
    const names = new Set();
    const suggestions = [];
    (lows.length ? lows : items.filter(i=> lowStock(i.quantity, i.threshold, daysLeft(i.quantity, i.dailyUse))))
      .forEach(i=>{
        if(names.has(i.name.toLowerCase())) return;
        names.add(i.name.toLowerCase());
        const here = bestPPUForItemAtStore(items, i.name, selectedStore);
        const any  = bestPPUForItemAcrossStores(items, i.name);
        if(any){
          if(here){
            const diff = here.value - any.ppu.value;
            suggestions.push({ name:i.name, here, best:any.ppu, bestStore:any.store, diff });
          } else {
            suggestions.push({ name:i.name, here:null, best:any.ppu, bestStore:any.store, diff:null });
          }
        }
      });

    if(suggestions.length===0){
      bestBuysEl.innerHTML = `<h3>Best buy at ${selectedStore}</h3><small class="muted">No price data yet. Add prices to see suggestions.</small>`;
    } else {
      const rows = suggestions.slice(0,15).map(s=>{
        if(!s.here){
          return `<div class="list"><div><strong>${s.name}</strong></div><div><span class="badge">No data at ${selectedStore}</span> • Best: ${s.best.label} @ ${s.bestStore}</div></div>`;
        }
        const better = s.diff <= 0;
        const note = better ? `Best here` : `Cheaper @ ${s.bestStore} (Δ ~${money(Math.abs(s.diff))} / unit)`;
        return `<div class="list"><div><strong>${s.name}</strong></div><div>${s.here.label} @ ${selectedStore} • ${note}</div></div>`;
      }).join('');
      bestBuysEl.innerHTML = `<h3>Best buy at ${selectedStore}</h3>${rows}`;
    }
  }

  // Export names (simple)
  $('#export-md').onclick = ()=>{
    const text = Array.from($('#shop-list').querySelectorAll('.item strong'))
      .map(el=> '- '+el.textContent.trim()).join('\n');
    const blob = new Blob([text],{type:'text/markdown'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href=url; a.download='shopping-list.md'; a.click(); URL.revokeObjectURL(url);
    toast('Exported Markdown');
  };

  // Export basket (Markdown)
  $('#export-basket-md').onclick = async ()=>{
    if(!basket.rows.length){ toast('Nothing to export for this filter','warn'); return; }
    const titleStore = selectedStore==='__ALL__' ? 'Best Available' : selectedStore;
    const lines = [
      `# Basket — ${titleStore}`,
      '',
      `Generated: ${new Date().toLocaleString()}`,
      '',
      `| Item | Need | Unit price | Source | Note | Est. cost |`,
      `|---|---:|---:|---|---|---:|`
    ];
    basket.rows.forEach(r=>{
      lines.push(`| ${r.name} | ${r.need} ${r.unit} | ${r.ppuLabel} | ${r.storeUsed} | ${r.note} | ${r.est!=null?money(r.est):'—'} |`);
    });
    lines.push('', `**Estimated total:** ${money(basket.total)}`, '');
    const blob = new Blob([lines.join('\n')], {type:'text/markdown'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fname = `basket-${titleStore.replace(/\s+/g,'_').toLowerCase()}.md`;
    a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url);
    toast('Exported basket (Markdown)');
  };

  // Export basket (CSV) — V1.9 addition
  $('#export-basket-csv').onclick = async ()=>{
    if(!basket.rows.length){ toast('Nothing to export for this filter','warn'); return; }
    const titleStore = selectedStore==='__ALL__' ? 'Best Available' : selectedStore;

    const headers = ['Item','Need','Unit','Unit price','Source','Note','Estimated cost'];
    const escape = v => `"${String(v ?? '').replace(/"/g,'""')}"`;

    const rows = basket.rows.map(r => [
      escape(r.name),
      escape(r.need),
      escape(r.unit),
      escape(r.ppuLabel),
      escape(r.storeUsed),
      escape(r.note),
      escape(r.est!=null ? money(r.est) : '—')
    ].join(','));

    const csv = [
      headers.join(','),
      ...rows,
      '',
      `"Estimated total",${escape(money(basket.total))}`
    ].join('\n');

    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fname = `basket-${titleStore.replace(/\s+/g,'_').toLowerCase()}.csv`;
    a.href = url; a.download = fname; a.click(); URL.revokeObjectURL(url);
    toast('Exported basket (CSV)');
  };
}

/* ---------- Summary (with monthly deltas) ---------- */
async function renderSummary(){
  const items = await listItems();

  const totalItems = items.length;
  const totalSpend = items.reduce((s,i)=> s + (typeof i.pricePaid==='number' && !isNaN(i.pricePaid) ? i.pricePaid : 0), 0);
  const lowCount = items.filter(i=> lowStock(i.quantity, i.threshold, daysLeft(i.quantity, i.dailyUse))).length;

  $('#summary-cards').innerHTML = `
    <div style="display:flex;gap:12px;flex-wrap:wrap">
      <div class="item" style="flex:1 1 200px"><strong>Total items</strong><div>${totalItems}</div></div>
      <div class="item" style="flex:1 1 200px"><strong>Total spend (snapshot)</strong><div>${money(totalSpend)}</div></div>
      <div class="item" style="flex:1 1 200px"><strong>Low stock</strong><div>${lowCount}</div></div>
    </div>
  `;

  // Spend by store
  const spendByStore = {};
  for(const i of items){
    const s = (i.store||'Unspecified').trim() || 'Unspecified';
    const p = (typeof i.pricePaid==='number' && !isNaN(i.pricePaid)) ? i.pricePaid : 0;
    spendByStore[s] = (spendByStore[s]||0) + p;
  }
  const rowsStore = Object.entries(spendByStore)
    .sort((a,b)=> b[1]-a[1])
    .map(([store,amt])=> `<div class="list"><div><strong>${store}</strong></div><div>${money(amt)}</div></div>`)
    .join('');
  $('#summary-store').innerHTML = `<h3>Spend by store (all-time snapshot)</h3>${rowsStore || '<small class="muted">No spend captured yet.</small>'}`;

  // Best PPU table
  const rowsPPU = items
    .map(i => ({ name:i.name, ppu: computePPU(i) }))
    .filter(x => x.ppu.value !== null)
    .sort((a,b)=> a.ppu.value - b.ppu.value)
    .slice(0, 20)
    .map(x => `<div class="list"><div><strong>${x.name}</strong></div><div>${x.ppu.label}</div></div>`)
    .join('');
  $('#summary-ppu').innerHTML = `<h3>Best price per unit (lower is better)</h3>${rowsPPU || '<small class="muted">Add prices to see this table.</small>'}`;

  // Spend by month (last 12) with deltas
  const now = new Date();
  const months = [];
  for(let k=11;k>=0;k--){
    const d = new Date(now.getFullYear(), now.getMonth()-k, 1);
    months.push({ key: ymKey(d), label: d.toLocaleDateString(undefined, { year:'numeric', month:'short' }), total:0, delta:null });
  }
  for(const i of items){
    if(i.pricePaid==null || isNaN(i.pricePaid) || !i.purchaseTs) continue;
    const key = ymKey(i.purchaseTs); if(!key) continue;
    const slot = months.find(m=>m.key===key); if(slot) slot.total += Number(i.pricePaid);
  }
  for(let idx=1; idx<months.length; idx++){
    const prev = months[idx-1].total;
    const cur  = months[idx].total;
    months[idx].delta = cur - prev;
  }
  const rowsMonth = months
    .map((m,idx) => {
      if(idx===0) return `<div class="list"><div><strong>${m.label}</strong></div><div>${money(m.total)}</div></div>`;
      const d = m.delta || 0;
      const arrow = d>0 ? '▲' : (d<0 ? '▼' : '•');
      const color = d>0 ? 'style="color:#ff8ea1"' : (d<0 ? 'style="color:#76e0a6"' : 'style="color:#a7b0c3"');
      return `<div class="list"><div><strong>${m.label}</strong></div><div>${money(m.total)} <span ${color}>${arrow} ${money(Math.abs(d))}</span></div></div>`;
    })
    .join('');
  $('#summary-month').innerHTML = `<h3>Running spend by month (last 12)</h3>${rowsMonth}`;

  // Best store by category (avg PPU)
  const agg = {};
  for(const i of items){
    const cat = (i.category||'Uncategorized').trim() || 'Uncategorized';
    const store = (i.store||'Unspecified').trim() || 'Unspecified';
    const ppu = computePPU(i).value;
    if(ppu===null) continue;
    agg[cat] ||= {};
    agg[cat][store] ||= { sum:0, count:0 };
    agg[cat][store].sum += ppu;
    agg[cat][store].count += 1;
  }
  const suggestions = Object.entries(agg).map(([cat, stores])=>{
    let best = null;
    for(const [s, stat] of Object.entries(stores)){
      const avg = stat.sum / stat.count;
      if(best===null || avg < best.avg) best = { store:s, avg };
    }
    return { category: cat, store: best?.store, avg: best?.avg ?? null };
  }).filter(x=> x.store);
  const rowsBest = suggestions
    .sort((a,b)=> a.category.localeCompare(b.category))
    .map(x => `<div class="list"><div><strong>${x.category}</strong></div><div>${x.store} • ~${money(x.avg)}</div></div>`)
    .join('');
  $('#summary-beststore').innerHTML = `<h3>Best store by category (avg price-per-unit)</h3>${rowsBest || '<small class="muted">Add prices to see suggestions.</small>'}`;
}

/* ---------- exports/imports ---------- */
function downloadBlob(name, mime, text){ const b=new Blob([text],{type:mime}); const u=URL.createObjectURL(b); const a=document.createElement('a'); a.href=u;a.download=name;a.click();URL.revokeObjectURL(u); }
async function exportJSON(){ const items=await listItems(); downloadBlob('restocker-backup.json','application/json',JSON.stringify(items,null,2)); toast('Exported JSON'); }
async function exportInventoryCSV(){
  const items = await listItems();
  const headers = ['name','category','unit','quantity','threshold','dailyUse','store','pricePaid','purchaseTs','dateAdded','pricePerUnitDisplay','notes'];
  const rows = items.map(i => {
    const ppu = computePPU(i).label;
    return headers.map(h => {
      const v = (h==='pricePerUnitDisplay') ? ppu : (i[h] ?? '');
      return `"${String(v).replace(/"/g,'""')}"`;
    }).join(',');
  });
  const csv = [headers.join(','), ...rows].join('\n');
  downloadBlob('restocker-inventory.csv', 'text/csv', csv);
  toast('Exported CSV');
}
async function importJSONFile(file){
  const txt = await file.text();
  let data; try{ data=JSON.parse(txt);}catch(e){ alert('Invalid JSON'); return; }
  if(!Array.isArray(data)){ alert('JSON must be an array of items'); return; }
  await upsertByName(data);
  data.forEach(d => addStoreHistory((d.store||'').trim()));
  renderStoreDatalist(); renderStoreFilterOptions();
  toast('Import complete'); selectTab('inventory'); renderList($('#search').value); renderShopList(); renderSummary();
}

/* ---------- save handler ---------- */
async function handleSave(e){
  e.preventDefault();
  const id = parseInt($('#itemId').value || '0', 10) || null;
  const unit = $('#unit').value || getLastUnit(); setLastUnit(unit);
  const storeVal = ($('#store').value || '').trim(); if(storeVal) addStoreHistory(storeVal); renderStoreDatalist(); renderStoreFilterOptions();

  const pricePaidRaw = $('#pricePaid').value;
  const purchaseTsRaw = $('#purchaseTs').value;

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
    pricePaid: pricePaidRaw === '' ? null : Number(pricePaidRaw),
    purchaseTs: purchaseTsRaw ? new Date(purchaseTsRaw).toISOString() : null,
    dateAdded: new Date().toISOString().slice(0,10)
  };

  if(!item.name){ alert('Name is required'); return; }
  if(id){ await updateItem(item); } else { await addItem(item); }
  $('#form').reset(); $('#unit').value=getLastUnit(); $('#itemId').value='';
  selectTab('inventory'); toast('Item saved');
  renderList($('#search').value); renderShopList(); renderSummary();
}

/* ---------- low-stock check ---------- */
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

/* ---------- boot ---------- */
window.addEventListener('load', async ()=>{
  $$('.tab').forEach(t => t.onclick = ()=> selectTab(t.dataset.tab));
  selectTab('inventory');

  $('#unit').value=getLastUnit();
  renderStoreDatalist();
  renderStoreFilterOptions();

  $('#form').addEventListener('submit', handleSave);

  $('#export-md').addEventListener('click', ()=>{}); // wired inside renderShopList
  $('#export-csv').addEventListener('click', exportInventoryCSV);
  $('#export-json').addEventListener('click', exportJSON);
  $('#import-json').addEventListener('click', ()=> $('#import-file').click());
  $('#import-file').addEventListener('change', (e)=>{ const f=e.target.files&&e.target.files[0]; if(f) importJSONFile(f); e.target.value=''; });

  $('#search').addEventListener('input', (e)=> renderList(e.target.value));
  $('#store-filter').addEventListener('change', ()=> renderShopList());
  $('#clear-filter').addEventListener('click', ()=> { $('#store-filter').value='__ALL__'; renderShopList(); });

  await renderList();
  await renderShopList();
  await renderSummary();

  if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./service-worker.js'); }catch(e){} }

  $('#notify').addEventListener('click', async ()=>{
    if(!('Notification' in window)) return alert('Notifications not supported');
    const perm = await Notification.requestPermission();
    if(perm !== 'granted') return;
    (await navigator.serviceWorker.ready).showNotification('Re-Stocker notifications enabled');
  });

  lowStockCheck();
});
