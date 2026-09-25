import type { GhostData } from './Ghost';

/** One replay as it rests on disk: `at` orders eviction, oldest recorded first. */
export interface StoredGhost { key: string; ghost: GhostData; at: number }

/* */
export interface GhostStore {
  load(): Promise<StoredGhost[]>;
  put(entry: StoredGhost): Promise<void>;
  delete(key: string): Promise<void>;
}

const DATABASE = 'silicon-rush.ghosts';
const TABLE = 'ghosts';

/** Null where the browser offers no IndexedDB at all; replays then last for this page load only. */
export function indexedDbGhostStore(factory: IDBFactory | undefined = globalThis.indexedDB): GhostStore | null {
  if (!factory) return null;
  let opened: Promise<IDBDatabase> | null = null;
  const database = () => opened ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(TABLE, { keyPath: 'key' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('ghost database blocked'));
  });
  const run = <T>(mode: IDBTransactionMode, work: (table: IDBObjectStore) => IDBRequest<T>) =>
    database().then(db => new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(TABLE, mode);
      const request = work(transaction.objectStore(TABLE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = transaction.onabort = () => reject(transaction.error ?? request.error);
    }));
  return {
    load: () => run('readonly', table => table.getAll() as IDBRequest<StoredGhost[]>),
    put: entry => run('readwrite', table => table.put(entry)).then(() => undefined),
    delete: key => run('readwrite', table => table.delete(key)).then(() => undefined),
  };
}
