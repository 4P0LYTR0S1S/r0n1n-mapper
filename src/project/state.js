// Single source of truth for project state. Subscribers register on a path
// (JSON-Pointer-ish, e.g. '/surfaces/0/opacity') or '*' for any change.
// The store is a plain object — callers mutate via set()/update() so changes
// are observable, and emit a 'dirty' flag that triggers autosave + broadcast.

import { emptyProject } from './schema.js';

export function createStore(initial = emptyProject()) {
  let state = initial;
  const subs = new Set();
  let dirty = false;

  function emit(path, value) {
    dirty = true;
    for (const fn of subs) {
      try { fn(path, value, state); } catch (e) { console.error('[state] subscriber error', e); }
    }
  }

  // Resolve a JSON-Pointer-ish path on the state. '/a/b/0' → state.a.b[0].
  // Returns { parent, key, value } so set() can mutate in place.
  function resolve(path) {
    if (path === '' || path === '/') return { parent: null, key: null, value: state };
    const parts = path.split('/').filter(s => s.length > 0);
    let parent = state;
    for (let i = 0; i < parts.length - 1; i++) {
      const k = parts[i];
      parent = parent[k] ?? parent[+k];
      if (parent == null) throw new Error(`path not found: ${path}`);
    }
    const key = parts[parts.length - 1];
    const value = parent[key] ?? parent[+key];
    return { parent, key, value };
  }

  return {
    get state() { return state; },
    get dirty() { return dirty; },
    clean() { dirty = false; },

    subscribe(fn) {
      subs.add(fn);
      return () => subs.delete(fn);
    },

    get(path) { return resolve(path).value; },

    set(path, value) {
      const { parent, key } = resolve(path);
      parent[key] = value;
      emit(path, value);
    },

    // Mutator: caller receives the resolved value and mutates it in place.
    // Useful for array push, nested object updates without rebuilding the tree.
    update(path, mutator) {
      const { value } = resolve(path);
      const result = mutator(value);
      emit(path, result ?? value);
    },

    replace(newState) {
      state = newState;
      emit('', state);
    },
  };
}
