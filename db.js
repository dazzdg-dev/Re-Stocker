// Re-Stocker DB with per-item activity log + reminders + barcode
const DB_NAME = 'restocker-db';
const DB_VER  = 5;          // bumped for new fields
const STORE   = 'items';

function withDB(mode, fn){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = ()=>{
      const db = req.result;
      if(!db.objectStoreNames.contains(STORE)){
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('name_ci', 'name_ci', { unique: false });
      } else {
        const os = req.transaction.objectStore(STORE);
        if(!os.indexNames.contains('name_ci')) os.createIndex('name_ci', 'name_ci', { unique: false });
      }
    };
    req.onerror = ()=> reject(req.error);
    req.onsuccess = ()=>{
      const db = req.result;
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      tx.oncomplete = ()=> resolve();
      tx.onerror = ()=> reject(tx.error);
      fn(store, resolve, reject);
    };
  });
}

function normalize(it){
  const o = { ...it };
  o.name      = (o.name||'').trim();
  o.name_ci   = o.name.toLowerCase();
  o.category  = (o.category||'').trim();
  o.unit      = (o.unit||'g').trim();
  o.quantity  = Number(o.quantity||0);
  o.threshold = Number(o.threshold||0);
  o.store     = (o.store||'').trim();
  o.notes     = (o.notes||'').trim();
  o.pricePaid = (o.pricePaid===null || o.pricePaid===undefined || o.pricePaid==='') ? null : Number(o.pricePaid);
  o.purchaseTs= o.purchaseTs || null;
  o.dateAdded = o.dateAdded || new Date().toISOString().slice(0,10);
  o.activity  = Array.isArray(o.activity) ? o.activity : [];
  o.barcode   = (o.barcode||'').trim();
  o.notifyBelow = !!o.notifyBelow;
  o.lastNotifyTs = o.lastNotifyTs || null;
  return o;
}

export function addItem(item){
  const rec = normalize(item);
  return withDB('readwrite', (store, resolve, reject)=>{
    const r = store.add(rec);
    r.onsuccess = ()=> resolve(r.result);
    r.onerror = ()=> reject(r.error);
  });
}
export function updateItem(item){
  const rec = normalize(item);
  return withDB('readwrite', (store, resolve, reject)=>{
    const r = store.put(rec);
    r.onsuccess = ()=> resolve(r.result);
    r.onerror = ()=> reject(r.error);
  });
}
export function deleteItem(id){
  return withDB('readwrite', (store, resolve, reject)=>{
    const r = store.delete(Number(id));
    r.onsuccess = ()=> resolve();
    r.onerror = ()=> reject(r.error);
  });
}
export function listItems(){
  return new Promise((resolve, reject)=>{
    withDB('readonly', (store)=>{
      const out = [];
      const req = store.openCursor();
      req.onsuccess = ()=>{
        const cur = req.result;
        if(cur){ out.push(cur.value); cur.continue(); }
        else resolve(out);
      };
      req.onerror = ()=> reject(req.error);
    }).catch(reject);
  });
}

// Log an activity and adjust quantity automatically
export async function logActivity(id, ev){
  const items = await listItems();
  const it = items.find(x=>x.id===id);
  if(!it) return;
  it.activity = Array.isArray(it.activity) ? it.activity : [];
  const entry = {
    type: ev.type,                    // 'use' | 'buy'
    qty: Number(ev.qty||0),
    ts: ev.ts || new Date().toISOString(),
    price: ev.price ?? null,
    store: (ev.store||'').trim() || null,
    note: (ev.note||'').trim() || null
  };
  it.activity.unshift(entry);         // newest first
  if(entry.type==='use') it.quantity = Math.max(0, (it.quantity||0) - entry.qty);
  if(entry.type==='buy') it.quantity = (it.quantity||0) + entry.qty;
  if(entry.type==='buy' && entry.price!=null){ it.pricePaid = entry.price; it.purchaseTs = entry.ts; }
  await updateItem(it);
  return it;
}

// Upsert by name (for imports)
export async function upsertByName(items){
  const existing = await listItems();
  const map = new Map(existing.map(x => [String((x.name||'').trim().toLowerCase()), x]));
  for(const raw of items){
    const rec = normalize(raw);
    const key = rec.name_ci;
    if(map.has(key)){
      rec.id = map.get(key).id;
      await updateItem(rec);
    } else {
      await addItem(rec);
    }
  }
}
