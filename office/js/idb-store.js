// Thin IndexedDB adapter for the outbox store: {put, getAll, delete}. Entries are keyed by `id`.
export function createIdbStore(dbName = 'lmcs-office', storeName = 'outbox') {
  const db = new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(storeName, { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  const run = async (mode, op) => {
    const tx = (await db).transaction(storeName, mode);
    const req = op(tx.objectStore(storeName));
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  };
  return {
    put: (entry) => run('readwrite', (s) => s.put(entry)),
    getAll: () => run('readonly', (s) => s.getAll()),
    delete: (id) => run('readwrite', (s) => s.delete(id)),
  };
}
