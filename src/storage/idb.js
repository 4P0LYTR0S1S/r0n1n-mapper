// IndexedDB blob store. Three stores: 'videos', 'images', 'luts'. DB v3 in M5.

const DB_NAME = 'r0n1n-mapper';
const DB_VERSION = 3;
const VIDEO_STORE = 'videos';
const IMAGE_STORE = 'images';
const LUT_STORE   = 'luts';

let dbPromise = null;
function db() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const idb = req.result;
      if (!idb.objectStoreNames.contains(VIDEO_STORE)) idb.createObjectStore(VIDEO_STORE, { keyPath: 'id' });
      if (!idb.objectStoreNames.contains(IMAGE_STORE)) idb.createObjectStore(IMAGE_STORE, { keyPath: 'id' });
      if (!idb.objectStoreNames.contains(LUT_STORE))   idb.createObjectStore(LUT_STORE,   { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror   = () => reject(req.error);
  });
  return dbPromise;
}

function put(store, id, blob, name) {
  return db().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).put({ id, blob, name });
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
}

function get(store, id) {
  return db().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(id);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror   = () => reject(req.error);
  }));
}

function list(store) {
  return db().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readonly');
    const req = tx.objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror   = () => reject(req.error);
  }));
}

function del(store, id) {
  return db().then(d => new Promise((resolve, reject) => {
    const tx = d.transaction(store, 'readwrite');
    tx.objectStore(store).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror    = () => reject(tx.error);
  }));
}

export const putVideo    = (id, blob, name) => put(VIDEO_STORE, id, blob, name);
export const getVideo    = (id) => get(VIDEO_STORE, id);
export const listVideos  = () => list(VIDEO_STORE);
export const deleteVideo = (id) => del(VIDEO_STORE, id);

export const putImage    = (id, blob, name) => put(IMAGE_STORE, id, blob, name);
export const getImage    = (id) => get(IMAGE_STORE, id);
export const listImages  = () => list(IMAGE_STORE);
export const deleteImage = (id) => del(IMAGE_STORE, id);

export const putLut      = (id, blob, name) => put(LUT_STORE, id, blob, name);
export const getLut      = (id) => get(LUT_STORE, id);
export const listLuts    = () => list(LUT_STORE);
export const deleteLut   = (id) => del(LUT_STORE, id);

const PROJECT_KEY = 'r0n1n-mapper:project';
export function saveProject(json) { localStorage.setItem(PROJECT_KEY, JSON.stringify(json)); }
export function loadProject() {
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}
