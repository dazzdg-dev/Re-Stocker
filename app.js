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
  selectTab('
