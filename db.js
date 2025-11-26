// Re-Stocker V4.Turbo DB (local-first, single store)

const DB_NAME = 'restocker-v4';
const DB_VER  = 1;
const STORE   = 'items';

function withDB(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);

    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        os.createIndex('name_ci', 'name_ci', { unique: false });
      }
    };

    req.onerror = () => reject(req.error);

    req.onsuccess = () => {
      const db  = req.result;
      const tx  = db.transaction(STORE, mode);
      const sto = tx.objectStore(STORE);

      tx.oncomplete = () => resolve();
      tx.onerror    = () => reject(tx.error);

      fn(sto, resolve, reject);
    };
  });
}

function norm(item) {
  const o = { ...item };
  o.name      = (o.name || '').trim();
  o.name_ci   = o.name.toLowerCase();
  o.quantity  = Number(o.quantity || 0);
  o.threshold = Number(o.threshold || 0);
  o.unit      = (o.unit || 'pcs').trim();
  o.store     = (o.store || '').trim();
  o.favorite  = !!o.favorite;
  o.activity  = Array.isArray(o.activity) ? o.activity : [];
  return o;
}

export function listItems() {
  return new Promise((resolve, reject) => {
    withDB('readonly', (store) => {
      const out = [];
      const c = store.openCursor();
      c.onsuccess = () => {
        const cur = c.result;
        if (cur) {
          out.push(cur.value);
          cur.continue();
        } else {
          resolve(out);
        }
      };
      c.onerror = () => reject(c.error);
    }).catch(reject);
  });
}

export function addItem(item) {
  const rec = norm(item);
  return withDB('readwrite', (store, res, rej) => {
    const r = store.add(rec);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

export function updateItem(item) {
  const rec = norm(item);
  return withDB('readwrite', (store, res, rej) => {
    const r = store.put(rec);
    r.onsuccess = () => res(r.result);
    r.onerror   = () => rej(r.error);
  });
}

export function deleteItem(id) {
  return withDB('readwrite', (store, res, rej) => {
    const r = store.delete(Number(id));
    r.onsuccess = () => res();
    r.onerror   = () => rej(r.error);
  });
}

export async function logActivity(id, ev) {
  const items = await listItems();
  const it = items.find(x => x.id === id);
  if (!it) return;
  it.activity.unshift({
    type: ev.type,
    qty:  Number(ev.qty || 0),
    ts:   ev.ts || new Date().toISOString()
  });

  if (ev.type === 'use') {
    it.quantity = Math.max(0, (it.quantity || 0) - ev.qty);
  } else if (ev.type === 'buy') {
    it.quantity = (it.quantity || 0) + ev.qty;
  }
  await updateItem(it);
  return it;
}

export async function upsertByName(arr) {
  const existing = await listItems();
  const map = new Map(existing.map(x => [x.name_ci, x]));
  for (const raw of arr) {
    const rec = norm(raw);
    if (map.has(rec.name_ci)) {
      rec.id = map.get(rec.name_ci).id;
      await updateItem(rec);
    } else {
      await addItem(rec);
    }
  }
}
