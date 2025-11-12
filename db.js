const DB_NAME = 'restocker-db';
const DB_VERSION = 4; // V1.4: add pricePaid & purchaseTs fields (schemaless)
const STORE = 'items';

export function openDB(){
  return new Promise((resolve, reject)=>{
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e)=>{
      const db = e.target.result;
      if(!db.objectStoreNames.contains(STORE)){
        const store = db.createObjectStore(STORE, { keyPath:'id', autoIncrement:true });
        store.createIndex('name','name',{unique:false});
      }
      // No structural migration required (object store is schemaless).
    };
    req.onsuccess = ()=> resolve(req.result);
    req.onerror = ()=> reject(req.error);
  });
}

export async function addItem(item){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).add(item);
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
  });
}

export async function updateItem(item){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).put(item);
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
  });
}

export async function deleteItem(id){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = ()=> resolve(true);
    tx.onerror = ()=> reject(tx.error);
  });
}

export async function listItems(){
  const db = await openDB();
  return new Promise((resolve,reject)=>{
    const tx = db.transaction(STORE,'readonly');
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = ()=> resolve(req.result || []);
    req.onerror = ()=> reject(req.error);
  });
}

export async function upsertByName(items){
  const existing = await listItems();
  const map = new Map(existing.map(it => [norm(it.name), it]));
  for(const raw of items){
    if(!raw || !raw.name) continue;
    const rec = sanitize(raw);
    const key = norm(rec.name);
    if(map.has(key)){
      const current = map.get(key);
      const merged = { ...current, ...rec, id: current.id };
      await updateItem(merged);
    } else {
      await addItem(rec);
    }
  }
}

function sanitize(it){
  return {
    name: String(it.name || '').trim(),
    category: (it.category||'').trim(),
    unit: (it.unit||'unit').trim(),
    quantity: Number(it.quantity||0),
    threshold: Number(it.threshold||0),
    dailyUse: Number(it.dailyUse||0),
    store: (it.store||'').trim(),
    notes: (it.notes||'').trim(),
    // NEW in V1.4
    pricePaid: isNaN(Number(it.pricePaid)) ? null : Number(it.pricePaid),
    purchaseTs: it.purchaseTs || null, // ISO string or null
    dateAdded: it.dateAdded || new Date().toISOString().slice(0,10)
  };
}
const norm = n => String(n||'').trim().toLowerCase();
