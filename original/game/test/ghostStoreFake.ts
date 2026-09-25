import type { GhostStore, StoredGhost } from '../src/app/GhostStore';

/** An in-memory stand-in for IndexedDB, which jsdom does not have. `fail` refuses every call. */
export function memoryGhostStore(fail = false): GhostStore & { rows: Map<string, StoredGhost> } {
  const rows = new Map<string, StoredGhost>();
  const act = <T>(work: () => T) => fail ? Promise.reject(new Error('store unavailable')) : Promise.resolve().then(work);
  return {
    rows,
    load: () => act(() => [...rows.values()].map(row => structuredClone(row))),
    put: entry => act(() => { rows.set(entry.key, structuredClone(entry)); }),
    delete: key => act(() => { rows.delete(key); }),
  };
}
