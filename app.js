import { addItem, listItems, deleteItem, updateItem, upsertByName, logActivity } from './db.js';

const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));

/* prefs */
const SIMPLE_KEY='restocker:simple';
const UNIT_KEY='restocker:lastUnit';
const AUTO_RATE_KEY='restocker:autoRate';
const setSimple=v=>localStorage.setItem(SIMPLE_KEY,v?'1':'0');
const getSimple=()=>localStorage.getItem(SIMPLE_KEY)==='1';
const setLastUnit=u=>localStorage.setItem(UNIT_KEY,u);
const getLastUnit=()=>localStorage.getItem(UNIT_KEY)||'pcs';
const setAutoRate=v=>localStorage.setItem(AUTO_RATE_KEY,v?'1':'0');
const getAutoRate=()=>localStorage.getItem(AUTO_RATE_KEY)==='1';

/* local barcode map (for unknown codes) */
const BC_KEY = 'restocker:barcodeMap';
const getBCMap = ()=> { try{return JSON.parse(localStorage.getItem(BC_KEY)||'{}');}catch{return{}} };
const setBCMap = m => localStorage.setItem(BC_KEY, JSON.stringify(m));

/* utils */
const toast=(m,k='ok',ms=2800)=>{const r=$('#toast-root');const el=document.createElement('div');el.className='toast';el.innerHTML=`<span class="dot ${k==='warn'?'warn':''}"></span><span>${m}</span>`;r.appendChild(el);setTimeout(()=>{el.style.opacity='0'},ms-200);setTimeout(()=>r.removeChild(el),ms);};
const money = n => (typeof n==='number' && !isNaN(n)) ? `ZAR ${n.toFixed(2)}` : '—';
const fmt=n=>(Math.round(n*10)/10).toString();
const toLocalDT=iso=>{const d=new Date(iso);const p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;};

/* notifications */
async function ensureNotifyPermission(){
  if(!('Notification' in window)) return false;
  if(Notification.permission === 'granted') return true;
  try{
    const p = await Notification.requestPermission();
    return p === 'granted';
  }catch{ return false; }
}
async function maybeNotify(item){
  if(!item.notifyBelow) return;
  const now = Date.now();
  const last = item.lastNotifyTs ? new Date(item.lastNotifyTs).getTime() : 0;
  if(!(item.threshold>0) || !(item.quantity<=item.threshold)) return;
  if(now - last < 12*60*60*1000) return; // throttle 12h
  if(!(await ensureNotifyPermission())) return;

  try{
    const reg = await navigator.serviceWorker.ready;
    await reg.showNotification('Re-Stocker', {
      body: `${item.name} is below threshold (${item.quantity} ${item.unit || ''} ≤ ${item.threshold}).`,
      tag: `low-${item.id}`,
      icon: 'icon-192.png',
      badge: 'icon-192.png'
    });
  }catch{}
  item.lastNotifyTs = new Date().toISOString();
  await updateItem(item);
}
async function runReminderSweep(){
  const items = await listItems();
  await Promise.all(items.map(maybeNotify));
}

/* usage inference */
function inferredDailyUse(item){
  if(!Array.isArray(item.activity) || !item.activity.length) return null;
  const now=Date.now(), window=30*86400000;
  let used=0;
  for(const e of item.activity){
    const dt=new Date(e.ts).getTime();
    if(now - dt > window) continue;
    if(e.type==='use') used += Number(e.qty||0);
  }
  return used>0 ? used/30 : null;
}
function daysLeft(item){
  const rate = getAutoRate() ? (inferredDailyUse(item) ?? null) : null;
  if(!rate || rate<=0) return Infinity;
  return (Number(item.quantity||0)) / rate;
}
function low(item){
  const d = daysLeft(item);
  const t = Number(item.threshold||0);
  return (t>0 && item.quantity<=t) || d<=3;
}

/* price-per-unit helpers for shopping */
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
function need(i){ const t=+i.threshold||0, q=+i.quantity||0; return t>0?Math.max(0,t-q):1; }
function bestAcross(items,name){
  const m=items.filter(x=>(x.name||'').toLowerCase()===(name||'').toLowerCase())
               .map(x=>({store:(x.store||'—'),ppu:computePPU(x)}))
               .filter(x=>x.ppu.value!==null);
  if(!m.length) return null;
  return m.reduce((a,b)=>a.ppu.value<b.ppu.value?a:b);
}

/* scanner */
async function startScan(onCode){
  if('BarcodeDetector' in window){
    let detector;
    try{ detector = new BarcodeDetector({ formats:['ean_13','ean_8','upc_a','upc_e','code_128','code_39','itf','qr_code'] }); }catch{}
    if(detector){
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      const video = document.createElement('video');
      video.playsInline = true; video.srcObject = stream; await video.play();

      const overlay = document.createElement('div');
      Object.assign(overlay.style, {position:'fixed',inset:'0',background:'rgba(0,0,0,.7)',display:'grid',placeItems:'center',zIndex:9999});
      const wrap = document.createElement('div');
      wrap.style.background='#111a'; wrap.style.padding='10px'; wrap.style.border='1px solid #333'; wrap.style.borderRadius='12px';
      video.style.maxWidth='90vw'; video.style.maxHeight='70vh';
      const stopBtn = document.createElement('button'); stopBtn.textContent='Close'; stopBtn.style.marginTop='8px';
      wrap.appendChild(video); wrap.appendChild(stopBtn); overlay.appendChild(wrap); document.body.appendChild(overlay);

      const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d');
      let active = true;
      const loop = async ()=>{
        if(!active) return;
        try{
          canvas.width = video.videoWidth; canvas.height = video.videoHeight;
          ctx.drawImage(video,0,0,canvas.width,canvas.height);
          const bmp = await createImageBitmap(canvas);
          const codes = await detector.detect(bmp);
          if(codes && codes.length){
            const code = codes[0].rawValue || codes[0].raw || '';
            active = false; cleanup();
            onCode && onCode(code); return;
          }
        }catch{}
        requestAnimationFrame(loop);
      };
      const cleanup = ()=>{ try{ stream.getTracks().forEach(t=>t.stop()); }catch{} overlay.remove(); };
      stopBtn.onclick = ()=>{ active=false; cleanup(); };
      loop();
      return;
    }
  }
  const manual = prompt('Camera scanning not supported.\nEnter barcode manually:','');
  if(manual) onCode && onCode(manual.trim());
}

/* -------- Inventory -------- */
async function renderInventory(filter=''){
  const items = await listItems();
  const root = $('#inventory-list'); root.innerHTML='';
  const f = filter.trim().toLowerCase();

  items
    .filter(i=>!f || (i.name||'').toLowerCase().includes(f))
    .sort((a,b)=> (a.name||'').localeCompare(b.name||''))
    .forEach(i=>{
      const d = daysLeft(i);
      const isLow = low(i);
      const lastBuy = (i.activity||[]).find(e=>e.type==='buy');
      const row=document.createElement('div');
      row.className='item';
      row.innerHTML=`
        <div class="row-line">
          <strong>${i.name}</strong>
          <span class="badge">${i.quantity} ${(i.unit||'').toUpperCase()}</span>
        </div>
        <div class="kv">
          <div>Store</div><div>${i.store||'—'}</div>
          <div>Days left</div><div>${d===Infinity?'—':fmt(d)}</div>
          <div>Last purchase</div><div>${lastBuy? new Date(lastBuy.ts).toLocaleString() : '—'}</div>
        </div>
        <div class="btn-row">
          <button class="ghost btn-sm" data-use1="${i.id}">Use −1</button>
          <button class="ghost btn-sm" data-useC="${i.id}">Use − custom</button>
          <button class="btn-sm" data-buy="${i.id}">Buy +</button>
          <button class="ghost btn-sm" data-edit="${i.id}">Edit</button>
          <button class="btn-sm" data-del="${i.id}">Delete</button>
        </div>
        ${isLow?'<small class="muted">Low stock</small>':''}
      `;
      root.appendChild(row);
    });

  root.querySelectorAll('[data-del]').forEach(b=>b.onclick=async()=>{await deleteItem(+b.dataset.del);renderInventory($('#search').value);renderShopping();renderSummary();runReminderSweep();});
  root.querySelectorAll('[data-use1]').forEach(b=>b.onclick=()=>quickLog(+b.dataset.use1,'use',1));
  root.querySelectorAll('[data-useC]').forEach(b=>b.onclick=()=>{
    const amt=parseFloat(prompt('Use amount','1')||'0'); if(amt>0) quickLog(+b.dataset.useC,'use',amt);
  });
  root.querySelectorAll('[data-buy]').forEach(b=>b.onclick=()=>{
    const amt=parseFloat(prompt('Purchase amount','1')||'0'); if(!(amt>0)) return;
    const priceRaw=prompt('Total price paid (optional)',''); const price=priceRaw===''?null:Number(priceRaw);
    quickLog(+b.dataset.buy,'buy',amt,price);
  });
  root.querySelectorAll('[data-edit]').forEach(b=>b.onclick=()=>editItem(+b.dataset.edit));
}

async function quickLog(id,type,qty,price=null){
  const it = await logActivity(id, {type, qty, price});
  toast(`${type==='use'?'Used −':'Bought +'}${qty} ${it.unit||''} (${it.name})`);
  renderInventory($('#search').value); renderShopping(); renderSummary(); runReminderSweep();
}

async function editItem(id){
  const items=await listItems(); const it=items.find(x=>x.id===id); if(!it) return;
  $('#itemId').value=it.id; $('#name').value=it.name||''; $('#quantity').value=it.quantity||0;
  $('#unit').value=it.unit||getLastUnit(); $('#store').value=it.store||'';
  $('#category').value=it.category||''; $('#threshold').value=it.threshold||'';
  $('#pricePaid').value=(typeof it.pricePaid==='number')?it.pricePaid:''; $('#purchaseTs').value=it.purchaseTs?toLocalDT(it.purchaseTs):'';
  $('#notes').value=it.notes||'';
  $('#barcode').value = it.barcode || '';
  $('#notifyBelow').checked = !!it.notifyBelow;
  renderActivityPanel(it);
  selectTab('add'); if(!getSimple()) $('#adv').open=true;
}
function renderActivityPanel(item){
  const log=(item.activity||[]).slice(0,8);
  const host=$('#actLog'); host.innerHTML = log.length
    ? log.map(e=>`<div>${e.type==='use'?'Used':'Bought'}</div><div>${e.qty} ${item.unit||''} • ${new Date(e.ts).toLocaleString()}</div>`).join('')
    : '<small class="muted">No activity yet.</small>';
}

/* -------- Shopping -------- */
async function renderShopping(){
  const items=await listItems();
  const selected=$('#store-filter').value||'__ALL__';
  const lows=items.filter(i=>low(i)).filter(i=> selected==='__ALL__' ? true : (i.store||'').toLowerCase()===selected.toLowerCase())
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
      <div class="btn-row"><button class="btn-sm" data-top="${i.id}">Buy +</button></div>`;
    root.appendChild(row);
  });

  $('#store-total').textContent=`Estimated: ${lows.length?money(total):'—'}`;
  root.querySelectorAll('[data-top]').forEach(b=>b.onclick=async()=>{
    const id=+b.dataset.top; const amt=parseFloat(prompt('Purchase amount','1')||'0'); if(!(amt>0)) return;
    const priceRaw=prompt('Total price paid (optional)',''); const price=priceRaw===''?null:Number(priceRaw);
    await logActivity(id, {type:'buy', qty:amt, price});
    renderInventory($('#search').value); renderShopping(); renderSummary(); runReminderSweep();
  });

  // Exports
  $('#export-md').onclick = ()=>{
    const text = Array.from(root.querySelectorAll('.row-line strong')).map(el=>'- '+el.textContent).join('\n');
    blobDownload('shopping-list.md','text/markdown',text); toast('Exported MD');
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
    blobDownload(`basket-${titleStore.replace(/\s+/g,'_').toLowerCase()}.md`,'text/markdown',lines.join('\n'));
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
    blobDownload(`basket-${titleStore.replace(/\s+/g,'_').toLowerCase()}.csv`,'text/csv',rows.join('\n'));
    toast('Exported Basket CSV');
  };
}

/* -------- Summary -------- */
async function renderSummary(){
  const items=await listItems();
  const total=items.length;
  const lowCount=items.filter(i=>low(i)).length;
  const spend=items.reduce((s,i)=> s + ((typeof i.pricePaid==='number' && !isNaN(i.pricePaid))?i.pricePaid:0),0);
  $('#summary-cards').innerHTML=`<div class="row">
    <div class="card col"><strong>Total items</strong><div>${total}</div></div>
    <div class="card col"><strong>Low stock</strong><div>${lowCount}</div></div>
    <div class="card col"><strong>Total spend (snap)</strong><div>${money(spend)}</div></div>
  </div>`;

  // last 6 months spend via 'buy' events
  const now=new Date(); const months=[];
  for(let k=5;k>=0;k--){const d=new Date(now.getFullYear(),now.getMonth()-k,1); months.push({key:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`,label:d.toLocaleDateString(undefined,{month:'short'}),total:0});}
  for(const i of items){
    for(const e of (i.activity||[])){
      if(e.type!=='buy' || e.price==null) continue;
      const d=new Date(e.ts); const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
      const m=months.find(x=>x.key===key); if(m) m.total+=Number(e.price);
    }
  }
  $('#summary-month').innerHTML = `<h3>Spend (6 mo)</h3>` + months.map(m=>`<div class="row-line"><div>${m.label}</div><div>${money(m.total)}</div></div>`).join('');
}

/* -------- Backup / Import / Seed -------- */
async function exportInventoryCSV(){
  const items=await listItems();
  const headers=['name','unit','quantity','store','threshold','pricePaid','purchaseTs','barcode','notifyBelow'];
  const rows=items.map(i=>headers.map(h=>`"${String((i[h]??'')).replace(/"/g,'""')}"`).join(','));
  blobDownload('restocker-inventory.csv','text/csv',[headers.join(','),...rows].join('\n'));
  toast('Exported CSV');
}
function blobDownload(name,type,text){ const blob=new Blob([text],{type}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url;a.download=name;a.click();URL.revokeObjectURL(url); }
async function exportJSON(){ const items=await listItems(); blobDownload('restocker-backup.json','application/json',JSON.stringify(items,null,2)); }
async function importJSONFile(file){
  const txt=await file.text(); let data; try{data=JSON.parse(txt);}catch{alert('Invalid JSON');return;}
  if(!Array.isArray(data)){alert('JSON must be an array'); return;}
  await upsertByName(data); toast('Import complete'); renderInventory($('#search').value); renderShopping(); renderSummary(); runReminderSweep();
}
async function loadSeed(){
  const seed = [
    {"name":"Toilet Paper","unit":"pcs","quantity":12,"threshold":4,"store":"Makro"},
    {"name":"Hand Soap","unit":"ml","quantity":500,"threshold":200,"store":"Checkers"},
    {"name":"Ground Coffee","unit":"g","quantity":250,"threshold":80,"store":"Pick n Pay"},
    {"name":"Rice","unit":"g","quantity":2000,"threshold":600,"store":"Makro"},
    {"name":"Cooking Oil","unit":"ml","quantity":750,"threshold":200,"store":"Checkers"},
    {"name":"Sugar","unit":"g","quantity":1000,"threshold":300,"store":"PnP"},
    {"name":"Milk","unit":"l","quantity":2,"threshold":1,"store":"PnP"},
    {"name":"Eggs","unit":"pcs","quantity":18,"threshold":6,"store":"Checkers"}
  ];
  await upsertByName(seed);
  toast('Starter items added'); renderInventory(); renderShopping(); renderSummary(); runReminderSweep();
}

/* -------- Save (Add/Edit) -------- */
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
    threshold:parseFloat($('#threshold').value||'0'),
    pricePaid:($('#pricePaid').value==='')?null:Number($('#pricePaid').value),
    purchaseTs:$('#purchaseTs').value?new Date($('#purchaseTs').value).toISOString():null,
    notes:$('#notes').value.trim(),
    barcode:$('#barcode').value.trim(),
    notifyBelow:$('#notifyBelow').checked,
    dateAdded:new Date().toISOString().slice(0,10)
  };
  if(!item.name){ toast('Name required','warn'); return; }
  if(id){ await updateItem(item); } else { await addItem(item); }
  // remember barcode mapping for quick-add if both present
  const map = getBCMap();
  if(item.barcode && item.name){ map[item.barcode] = { name:item.name, unit:item.unit }; setBCMap(map); }
  $('#form').reset(); $('#unit').value=getLastUnit(); $('#itemId').value='';
  toast('Saved'); selectTab('inventory'); renderInventory($('#search').value); renderShopping(); renderSummary(); runReminderSweep();
}

/* -------- Activity buttons on Add/Edit -------- */
async function actUse(){
  const id=parseInt($('#itemId').value||'0',10); if(!id){ toast('Save item first','warn'); return; }
  const qty=parseFloat($('#actAmount').value||'0'); if(!(qty>0)){ toast('Enter amount','warn'); return; }
  await logActivity(id, {type:'use', qty}); $('#actAmount').value=''; toast('Usage recorded');
  const items=await listItems(); const it=items.find(x=>x.id===id); if(it) renderActivityPanel(it);
  renderInventory($('#search').value); renderShopping(); renderSummary(); runReminderSweep();
}
async function actBuy(){
  const id=parseInt($('#itemId').value||'0',10); if(!id){ toast('Save item first','warn'); return; }
  const qty=parseFloat($('#actAmount').value||'0'); if(!(qty>0)){ toast('Enter amount','warn'); return; }
  const priceRaw=prompt('Total price paid (optional)',''); const price=priceRaw===''?null:Number(priceRaw);
  await logActivity(id, {type:'buy', qty, price}); $('#actAmount').value=''; toast('Purchase recorded');
  const items=await listItems(); const it=items.find(x=>x.id===id); if(it) renderActivityPanel(it);
  renderInventory($('#search').value); renderShopping(); renderSummary(); runReminderSweep();
}

/* -------- Tabs & boot -------- */
function selectTab(id){
  $$('.tab').forEach(t=>t.classList.toggle('active', t.dataset.tab===id));
  $$('.view').forEach(v=>v.classList.toggle('hidden', v.id!==id+'-view'));
}
window.addEventListener('load', async ()=>{
  $$('.tab').forEach(t=>t.onclick=()=>selectTab(t.dataset.tab));

  // simple mode
  $('#simple-toggle').checked=getSimple(); document.body.classList.toggle('simple', getSimple());
  $('#simple-toggle').addEventListener('change', e=>{ setSimple(e.target.checked); document.body.classList.toggle('simple', e.target.checked); });

  // settings
  $('#auto-rate').checked = getAutoRate();
  $('#auto-rate').addEventListener('change', e=>{ setAutoRate(e.target.checked); renderInventory($('#search').value); renderShopping(); renderSummary(); });

  // quick add
  $('#qUnit').value=getLastUnit();
  $('#qSave').addEventListener('click', async ()=>{
    const name=$('#qName').value.trim(); const qty=parseFloat($('#qQty').value||'0'); const unit=$('#qUnit').value;
    if(!name){ toast('Name required','warn'); return; }
    await addItem({name,quantity:qty>0?qty:1,unit,threshold:0,dateAdded:new Date().toISOString().slice(0,10)});
    $('#qName').value=''; $('#qQty').value=''; setLastUnit(unit);
    renderInventory($('#search').value); toast('Added');
  });
  $('#qScan').addEventListener('click', ()=> startScan(code=>{
    const map=getBCMap();
    if(map[code]){ $('#qName').value=map[code].name||''; $('#qUnit').value=map[code].unit||$('#qUnit').value; toast(`Filled from ${code}`); }
    else{
      const name=prompt(`Unknown code ${code}. Item name?`,''); if(!name) return;
      const unit=(prompt('Unit (pcs/g/ml/l)?','pcs')||'pcs').toLowerCase();
      map[code]={name,unit}; setBCMap(map); $('#qName').value=name; $('#qUnit').value=unit; toast('Barcode saved');
    }
  }));

  // add/edit
  $('#form').addEventListener('submit', handleSave);
  $('#btnUse').addEventListener('click', actUse);
  $('#btnBuy').addEventListener('click', actBuy);
  $('#scan').addEventListener('click', ()=> startScan(code=>{
    $('#barcode').value=code; const map=getBCMap(); if(map[code]){ if(!$('#name').value) $('#name').value=map[code].name; if(!$('#unit').value) $('#unit').value=map[code].unit; } toast(`Scanned ${code}`); 
  }));

  // search + exports
  $('#search').addEventListener('input', e=>renderInventory(e.target.value));
  $('#export-csv').addEventListener('click', exportInventoryCSV);
  $('#export-json').addEventListener('click', exportJSON);
  $('#import-json').addEventListener('click', ()=>$('#import-file').click());
  $('#import-file').addEventListener('change', e=>{ const f=e.target.files?.[0]; if(f) importJSONFile(f); e.target.value=''; });
  $('#load-seed').addEventListener('click', loadSeed);

  // shopping filters
  $('#store-filter').addEventListener('change', renderShopping);
  $('#clear-filter').addEventListener('click', ()=>{ $('#store-filter').value='__ALL__'; renderShopping(); });

  // initial render
  await renderInventory();
  await renderShopping();
  await renderSummary();
  if('serviceWorker' in navigator){ try{ await navigator.serviceWorker.register('./service-worker.js'); }catch{} }

  // reminders
  runReminderSweep();
  setInterval(runReminderSweep, 10*60*1000); // every 10 mins
});
