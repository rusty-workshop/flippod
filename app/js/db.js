// Small promise wrapper around IndexedDB.
const NAME = 'flippod';
const VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('tracks')) db.createObjectStore('tracks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('art')) db.createObjectStore('art', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'k' });
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
  return dbp;
}

const req = (r) => new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); });

export async function getAll(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).get(key));
}

export async function getAllKeys(store) {
  const db = await open();
  return req(db.transaction(store).objectStore(store).getAllKeys());
}

export async function putMany(store, values) {
  if (!values.length) return;
  const db = await open();
  return new Promise((ok, no) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const v of values) os.put(v);
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
}

export const put = (store, value) => putMany(store, [value]);

export async function delMany(store, keys) {
  if (!keys.length) return;
  const db = await open();
  return new Promise((ok, no) => {
    const tx = db.transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const k of keys) os.delete(k);
    tx.oncomplete = () => ok();
    tx.onerror = () => no(tx.error);
  });
}

export async function clear(store) {
  const db = await open();
  return req(db.transaction(store, 'readwrite').objectStore(store).clear());
}

export async function kvGet(k, dflt) {
  const r = await get('kv', k);
  return r ? r.v : dflt;
}
export const kvSet = (k, v) => put('kv', { k, v });
