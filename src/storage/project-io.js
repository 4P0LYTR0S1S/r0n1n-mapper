// Project JSON save/load to localStorage. Video blobs live in IndexedDB (storage/idb.js)
// and are referenced by hash from the project JSON. Autosave runs on a debounce when
// the store reports dirty.

import { SCHEMA_VERSION, migrate } from '../project/schema.js';

const PROJECT_KEY = 'r0n1n-mapper:project';

export function saveProject(state) {
  const json = JSON.stringify({ ...state, version: SCHEMA_VERSION });
  localStorage.setItem(PROJECT_KEY, json);
  return json.length;
}

export function loadProject() {
  const raw = localStorage.getItem(PROJECT_KEY);
  if (!raw) return null;
  try {
    return migrate(JSON.parse(raw));
  } catch (e) {
    console.error('[project-io] failed to parse stored project', e);
    return null;
  }
}

export function exportProjectFile(state, filename = 'project.r0n1n.json') {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

export async function importProjectFile(file) {
  const text = await file.text();
  return migrate(JSON.parse(text));
}

// Debounced autosaver. Returns the listener fn to register with the store.
export function autosaver(store, intervalMs = 500) {
  let timer = null;
  return () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      if (store.dirty) {
        saveProject(store.state);
        store.clean();
      }
    }, intervalMs);
  };
}
