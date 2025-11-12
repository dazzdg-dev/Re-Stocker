import { addItem, listItems, deleteItem, updateItem, upsertByName } from './db.js';

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* ---- prefs ---- */
const SIMPLE_KEY = 'restocker:simple';
const UNIT_KEY   = 'restocker:lastUnit';
const storeSimple = v => localStorage.setItem(SIMPLE_KEY, v ? '1':'0');
const loadSimple  = () => localStorage.getItem(SIMPLE_KEY)==='1';
const setLastUnit = u => localStorage.setItem(UNIT_KEY, u);
const getLastUnit = () => localStorage.getItem(UNIT_KEY) || 'pcs';

/* ---- utils ---- */
const toast=(m,k='ok',ms=2800)=>{const r=$('#toast-root');const el=document.createElement('div');el.className='toast';el.innerHTML=`<span class="dot ${k==='warn'?'warn':''}"></span><span>${m}</span>`;r.appendChild(el);setTimeout(()=>{el.style.opacity='0'},ms-200);setTimeout(()=>r.removeChild(el),ms);};
const money = n => (typeof n==='number' && !isNaN(n)) ? `ZAR ${n.toFixed(2)}` : '—';
const daysLeft=(q,d)=>(!d||d<=0)?Infinity:q/d;
const low=(q,t,d)=> q<=t || d<=3;
const fmt=n=>(Math.round(n*10)/10).toString();
const toLocalDT=iso=>{const d=new Date(iso);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};

/* ---- PPU ---- */
function computePPU(i){
  const p=i.pricePaid, q=Number(i.quantity||0), u=(i.unit||'').toLowerCase();
  if(!(typeof p==='number')||isNaN(p)||q<=0) return {value:null,label:'—',kind:u};
  if(u==='pcs'){const v=p/q;return{value:v,label:`${money(v)} / pc`,kind:'pcs'};}
  if(u==='g'){const v=p/q*100;return{value:v,label:`${money(v)} / 100g`,kind:'g100'};}
  if(u==='ml'){const v=p/q*100;return{value:v,label:`${money(v)} / 100ml`,kind:'ml100'};}
  if(u==='l'){const v=p/q;return{value:v,label:`${money(v)} / L`,kind:'l'};}
  const v=p/q;return{value:v,label:`${money(v)} / ${u}`,kind:u};
}
function estimateCost(need,ppu){
  if(!ppu||ppu.value===null) return null;
  switch(ppu.kind){case'pcs':case'l':return need*ppu.value;case'g100':case'ml100':return (need/100)*ppu.value;default:return need*ppu.value;}
}

/* ---- DB helpers already imported ---- */

/* ---- UI helpers ---- */
function selectTab(id){
  $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===id));
  $$('.view').forEach(v=>v.classList.toggle('hidden', v.id!==id+'-view'));
}

/* ---- Inventory ---- */
async function renderInventory(filter=''){
  const items = await listItems();
  const root = $('#inventory-list'); root.innerHTML='';
  const f = filter.trim().toLowerCase();

  items
    .filter(i=>!f || (i.name||'').toLowerCase().includes(f))
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''))
    .forEach(i=>{
      const d=daysLeft(i.quantity,i.dailyUse);
      const isLow = low(i.quantity,i.threshold,d);
      const ppu=computePPU(i);
      const el=document.createElement('div');
      el.className='item';
      el.innerHTML=`
        <div class="row-line">
          <strong>${i.name}</strong>
          <span class="badge">${i.quantity} ${(i.unit||'').toUpperCase()}</span>
        </div>
        <div class="kv">
          <div>Store</div><div>${i.store||'—'}</div>
          <div>Days left</div><div>${d===Infinity?'—':fmt(d)}</div>
          <div>Price/Unit</div><div>${ppu.label}</div>
        </div>
        <div class="btn-row">
          <button class="ghost btn-sm" data-dec="${i.id}">−1</button>
          <button class="ghost btn-sm" data-dec10="${i.id}">−10</button>
          <button class="btn-sm" data-add="${i.id}">+ Restock</button>
          <button class="ghost btn-sm" data-edit="${i.id}">Edit</button>
          <button class="btn-sm" data-del="${i.id}">Delete</button>
        </div>
        ${isLow?'<small class="muted">Low stock</small>':''}
      `;
      root.appendChild(el);
    });

  root.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{await deleteItem(+b.dataset.del);renderInventory($('#search').value);renderShopping();});
  root.querySelectorAll('[data-dec]').forEach(b=>b.onclick=()=>consume(+b.dataset.dec,1));
  root.querySelectorAll('[data-dec10]').forEach(b=>b.onclick=()=>consume(+b.dataset.dec10,10));
  root.querySelectorAll('[data-add]').forEach(b=>b.onclick=()=>topup(+b.dataset.add));
  root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editItem(+b.dataset.edit));
}
async function consume(id,amt){
  const items=await listItems(); const it=items.find(x=>x.id===id); if(!it) return;
  it.quantity=Math.max(0,(+it.quantity||0)-amt); await updateItem(it);
  toast(`−${amt} ${it.unit||''} from ${it.name}`); renderInventory($('#search').value); renderShopping();
}
async function topup(id){
  const items=await listItems(); const it=items.find(x=>x.id===id); if(!it) return;
  const val=parseFloat(prompt('Add amount to quantity','1')||'0'); if(!(val>0)) return;
  it.quantity=(+it.quantity||0)+val; await updateItem(it);
  renderInventory($('#search').value); renderShopping();
}
async function editItem(id){
  const items=await listItems(); const it=items.find(x=>x.id===id); if(!it) return;
  $('#itemId').value=it.id; $('#name').value=it.name||''; $('#quantity').value=it.quantity||0;
  $('#unit').value=it.unit||getLastUnit(); $('#store').value=it.store||'';
  $('#category').value=it.category||''; $('#dailyUse').value=it.dailyUse||'';
  $('#threshold').value=it.threshold||''; $('#pricePaid').value=(typeof it.pricePaid==='number')?it.pricePaid:'';
  $('#purchaseTs').value=it.purchaseTs?toLocalDT(it.purchaseTs):''; $('#notes').value=it.notes||'';
  selectTab('add'); if(!loadSimple()) $('#adv').open=true;
}

/* ---- Quick Add ---- */
async function quickAdd(){
  const name=$('#qName').value.trim(); const qty=parseFloat($('#qQty').value||'0'); const unit=$('#qUnit').value;
  if(!name){ toast('Name required','warn'); return; }
  const item={name,quantity:qty>0?qty:1,unit,threshold:0,dailyUse:0,dateAdded:new Date().toISOString().slice(0,10)};
  await addItem(item);
  $('#qName').value=''; $('#qQty').value=''; setLastUnit(unit);
  await renderInventory($('#search').value); toast('Added');
}

/* ---- Shopping (keep only essentials) ---- */
function need(i){ const t=+i.threshold||0, q=+i.quantity||0; return t>0?Math.max(0,t-q):1; }
function bestAcross(items,name){
  const m=items.filter(x=>(x.name||'').toLowerCase()===(name||'').toLowerCase())
               .map(x=>({store:(x.store||'—'),ppu:computePPU(x)}))
               .filter(x=>x.ppu.value!==null);
  if(!m.length) return null;
  return m.reduce((a,b)=>a.ppu.value<b.ppu.value?a:b);
}
async function renderShopping(){
  const items=await listItems();
  const selected=$('#store-filter').value||'__ALL__';
  const lows=items.filter(i=>low(i.quantity,i.threshold,daysLeft(i.quantity,i.dailyUse)))
                  .filter(i=> selected==='__ALL__' ? true : (i.store||'').toLowerCase()===selected.toLowerCase())
                  .sort((a,b)=>(a.name||'').localeCompare(b.name||''));
  const root=$('#shop-list'); root.innerHTML='';
  let total=0;

  lows.forEach(i=>{
    const needAmt=need(i);
    const best=bestAcross(items,i.name);
    const est=best?estimateCost(needAmt,best.ppu):null;
    if(est!=null) total+=est;

    const row=document.createElement('div');
    row.className='item';
    row.innerHTML=`<div class="row-line"><strong>${i.name}</strong><span class="badge">need ${needAmt} ${i.unit||''}</span></div>
      <div class="kv"><div>Store</div><div>${i.store||'—'}</div><div>Best</div><div>${best?best.ppu.label+' @ '+best.store:'—'}</div></div>
      <div class="btn-row"><button class="btn-sm" data-top="${i.id}">+ Restock</button></div>`;
    root.appendChild(row);
  });

  $('#store-total').textContent=`Estimated: ${lows.length?money(total):'—'}`;

  root.querySelectorAll('[data-top]').forEach(b=>b.onclick=()=>topup(+b.dataset.top));

  // Export handlers (reused from previous version)
  $('#export-md').onclick = ()=>{
    const text = Array.from(root.querySelectorAll('.row-line strong')).map(el=>'- '+el.textContent).join('\n');
    download('shopping-list.md','text/markdown',text); toast('Exported MD');
  };
  $('#export-basket-md').onclick = ()=>{
    if(!lows.length){ toast('Nothing to export','warn'); return; }
    const titleStore = selected==='__ALL__' ? 'Best Available' : selected;
    const lines=[`# Basket — ${titleStore}`,'',`Generated: ${new Date().toLocaleString()}`,'',`| Item | Need | Best (ppu) | Est. |`,`|---|---:|---|---:|`];
    lows.forEach(i=>{
      const n=need(i), best=bestAcross(items,i.name); const est=best?estimateCost(n,best.ppu):null;
      lines.push(`| ${i.name} | ${n} ${i.unit||''} | ${best?best.ppu.label+' @ '+best.store:'—'} | ${est!=null?money(est):'—'} |`);
    });
    lines.push('',`**Estimated total:** ${$('#store-total').textContent.replace('Estimated: ','')}`);
    download(`basket-${titleStore.replace(/\s+/g,'_').toLowerCase()}.md`,'text/markdown',lines.join('\n'));
    toast('Exported Basket MD');
  };
  $('#export-basket-csv').onclick = ()=>{
    if(!lows.length){ toast('Nothing to export','warn'); return; }
    const titleStore = selected==='__ALL__' ? 'Best Available' : selected;
    const esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const rows=[`Item,Need,Unit,Best (ppu),Best store,Estimated`];
    lows.forEach(i=>{
      const n=need(i), best=bestAcross(items,i.name); const est=best?estimateCost(n,best.ppu):null;
      rows.push([esc(i.name),esc(n),esc(i.unit||''),esc(best?best.ppu.label:'—'),esc(best?best.store:'—'),esc(est!=null?money(est):'—')].join(','));
    });
    rows.push('',`"Estimated total",${esc($('#store-total').textContent.replace('Estimated: ',''))}`);
    download(`basket-${titleStore.replace(/\s+/g,'_').toLowerCase()}.csv`,'text/csv',rows.join('\n'));
    toast('Exported Basket CSV');
  };
}

/* ---- Summary (minimal) ---- */
async function renderSummary(){
  const items=await listItems();
  const total=items.length;
  const lowCount=items.filter(i=>low(i.quantity,i.threshold,daysLeft(i.quantity,i.dailyUse))).length;
  const spend=items.reduce((s,i)=> s + ((typeof i.pricePaid==='number' && !isNaN(i.pricePaid))?i.pricePaid:0),0);
  $('#summary-cards').innerHTML=`<div class="row">
    <div class="card col"><strong>Total items</strong><div>${total}</div></div>
    <div class="card col"><strong>Low stock</strong><div>${lowCount}</div></div>
    <div class="card col"><strong>Total spend (snap)</strong><div>${money(spend)}</div></div>
  </div>`;

  // last 6 months snapshot
  const now=new Date(); const months=[];
  for(let k=5;k>=0;k--){const d=new Date(now.getFullYear(),now.getMonth()-k,1); months.push({key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:d.toLocaleDateString(undefined,{month:'short'}) ,total:0});}
  for(const i of items){ if(i.pricePaid==null||!i.purchaseTs) continue; const key= (d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`)(new Date(i.purchaseTs)); const m=months.find(x=>x.key===key); if(m) m.total+=Number(i.pricePaid); }
  $('#summary-month').innerHTML = `<h3>Spend (6 mo)</h3>` + months.map(m=>`<div class="row-line"><div>${m.label}</div><div>${money(m.total)}</div></div>`).join('');
}

/* ---- Backup / Import ---- */
async function exportInventoryCSV(){
  const items=await listItems();
  const headers=['name','unit','quantity','store','pricePaid','purchaseTs'];
  const rows=items.map(i=>headers.map(h=>`"${String((i[h]??'')).replace(/"/g,'""')}"`).join(','));
  download('restocker-inventory.csv','text/csv',[headers.join(','),...rows].join('\n'));
  toast('Exported CSV');
}
function download(name,type,text){ const blob=new Blob([text],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;a.download=name;a.click();URL.revokeObjectURL(url); }
async function exportJSON(){ const items=await listItems(); download('restocker-backup.json','application/json',JSON.stringify(items,null,2)); }
async function importJSONFile(file){
  const txt=await file.text(); let data; try{data=JSON.parse(txt);}catch{alert('Invalid JSON');return;}
  if(!Array.isArray(data)){alert('JSON must be an array'); return;}
  await upsertByName(data); toast('Import complete'); renderInventory($('#search').value); renderShopping(); renderSummary();
}

/* ---- Save (Add/Edit) ---- */
async function handleSave(e){
  e.preventDefault();
  const id=parseInt($('#itemId').value||'0',10)||null;
  const unit=$('#unit').value||getLastUnit(); setLastUnit(unit);

  const item={
    id:id||undefined,
    name:$('#name').value.trim(),
    quantity:parseFloat($('#quantity').value||'0'),
    unit,
    store:$('#store').value.trim(),
    category:$('#category').value.trim(),
    dailyUse:parseFloat($('#dailyUse').value||'0'),
    threshold:parseFloat($('#threshold').value||'0'),
    pricePaid:($('#pricePaid').value==='')?null:Number($('#pricePaid').value),
    purchaseTs:$('#purchaseTs').value?new Date($('#purchaseTs').value).toISOString():null,
    notes:$('#notes').value.trim(),
    dateAdded:new Date().toISOString().slice(0,10)
  };
  if(!item.name){ toast('Name required','warn'); return; }
  if(id){ await updateItem(item); } else { await addItem(item); }
  $('#form').reset(); $('#unit').value=getLastUnit(); $('#itemId').value='';
  toast('Saved'); selectTab('inventory'); renderInventory($('#search').value); renderShopping(); renderSummary();
}

/* ---- boot ---- */
window.addEventListener('load', async ()=>{
  // tabs
  $$('.tab').forEach(t=>t.onclick=()=>selectTab(t.dataset.tab));

  // simple mode
  const simple=loadSimple(); $('#simple-toggle').checked=simple;
  document.body.classList.toggle('simple', simple);
  $('#simple-toggle').addEventListener('change', e=>{
    storeSimple(e.target.checked);
    document.body.classList.toggle('simple', e.target.checked);
  });

  // quick add defaults
  $('#qUnit').value=getLastUnit();
  $('#qSave').addEventListener('click', quickAdd);

  // search
  $('#search').addEventListener('input', e=>renderInventory(e.target.value));

  // add/edit form
  $('#form').addEventListener('submit', handleSave);

  // settings
  $('#export-json').addEventListener('click', exportJSON);
  $('#import-json').addEventListener('click', ()=>$('#import-file').click());
  $('#import-file').addEventListener('change', e=>{const f=e.target.files?.[0]; if(f) importJSONFile(f); e.target.value='';});
  $('#export-csv').addEventListener('click', exportInventoryCSV);

  // shopping filters
  $('#store-filter').addEventListener('change', renderShopping);
  $('#clear-filter').addEventListener('click', ()=>{ $('#store-filter').value='__ALL__'; renderShopping(); });

  // initial
  await renderInventory();
  await renderShopping();
  await renderSummary();

  // PWA
  if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./service-worker.js'); }catch{} }
});
