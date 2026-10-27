// YEmusic shim (replaces Folia's Dexie-backed src/services/db.ts).
// Folia keeps user-imported visualizer images (e.g. Tempera canvas art) in IndexedDB through
// getFromCache / saveToCache / removeFromCache. YEmusic only needs that key/value surface, so it is
// implemented directly on top of IndexedDB (structured clone keeps Blob values intact).

const DB_NAME = 'yemusic-folia';
const STORE_NAME = 'cache';

let dbPromise: Promise<IDBDatabase> | null = null;

const openDb = (): Promise<IDBDatabase> => {
    if (!dbPromise) {
        dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
            if (typeof indexedDB === 'undefined') {
                reject(new Error('IndexedDB is not available'));
                return;
            }
            const request = indexedDB.open(DB_NAME, 1);
            request.onupgradeneeded = () => {
                if (!request.result.objectStoreNames.contains(STORE_NAME)) {
                    request.result.createObjectStore(STORE_NAME);
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => {
                dbPromise = null;
                reject(request.error ?? new Error('Failed to open IndexedDB'));
            };
        });
    }
    return dbPromise;
};

const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> => {
    const db = await openDb();
    return new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, mode);
        const request = work(tx.objectStore(STORE_NAME));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error ?? request.error);
        tx.onabort = () => reject(tx.error ?? request.error);
    });
};

export const saveToCache = async (key: string, data: unknown): Promise<void> => {
    await run('readwrite', store => store.put(data, key));
};

export const getFromCache = async <T>(key: string): Promise<T | null> => {
    try {
        const value = await run<unknown>('readonly', store => store.get(key));
        return (value ?? null) as T | null;
    } catch {
        return null;
    }
};

export const removeFromCache = async (key: string): Promise<void> => {
    await run('readwrite', store => store.delete(key));
};
