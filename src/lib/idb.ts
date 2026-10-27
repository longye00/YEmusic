/** 极简 IndexedDB 封装。数据库 yemusic2；旧版 0.1.x 的 yemusic 库只读迁移。 */
const DB_NAME = 'yemusic2';
const DB_VERSION = 1;
export type StoreName = 'kv' | 'tracks' | 'playlists' | 'lyrics' | 'covers' | 'sources';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, DB_VERSION);
        req.onupgradeneeded = () => {
            const db = req.result;
            for (const name of ['kv', 'tracks', 'playlists', 'lyrics', 'covers', 'sources']) {
                if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === 'kv' ? 'key' : 'id' });
            }
        };
        req.onsuccess = () => {
            const db = req.result;
            db.onversionchange = () => db.close();
            resolve(db);
        };
        req.onerror = () => reject(req.error ?? new Error('IndexedDB 打开失败'));
    });
    return dbPromise;
}

const wrap = <T>(req: IDBRequest<T>) => new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
});

const done = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
});

export async function getAll<T>(store: StoreName): Promise<T[]> {
    return wrap((await open()).transaction(store, 'readonly').objectStore(store).getAll()) as Promise<T[]>;
}

export async function get<T>(store: StoreName, key: string): Promise<T | undefined> {
    return wrap((await open()).transaction(store, 'readonly').objectStore(store).get(key)) as Promise<T | undefined>;
}

export async function put(store: StoreName, value: unknown): Promise<void> {
    const tx = (await open()).transaction(store, 'readwrite');
    tx.objectStore(store).put(value);
    await done(tx);
}

export async function putMany(store: StoreName, values: unknown[]): Promise<void> {
    if (!values.length) return;
    const tx = (await open()).transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const value of values) os.put(value);
    await done(tx);
}

export async function del(store: StoreName, key: string): Promise<void> {
    const tx = (await open()).transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx);
}

export async function delMany(store: StoreName, keys: string[]): Promise<void> {
    if (!keys.length) return;
    const tx = (await open()).transaction(store, 'readwrite');
    const os = tx.objectStore(store);
    for (const key of keys) os.delete(key);
    await done(tx);
}

export async function clear(store: StoreName): Promise<void> {
    const tx = (await open()).transaction(store, 'readwrite');
    tx.objectStore(store).clear();
    await done(tx);
}

export async function kvGet<T>(key: string, fallback: T): Promise<T> {
    const row = await get<{ key: string; value: T }>('kv', key).catch(() => undefined);
    return row ? row.value : fallback;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
    await put('kv', { key, value });
}

/** 读取旧版（0.1.x）数据库，用于一次性迁移；不存在时返回 null。 */
export async function readLegacyDb(): Promise<Record<string, unknown[]> | null> {
    try {
        const list = await indexedDB.databases?.();
        if (!list?.some(item => item.name === 'yemusic')) return null;
    } catch {
        return null;
    }
    return new Promise(resolve => {
        const req = indexedDB.open('yemusic');
        req.onupgradeneeded = () => {
            // 数据库其实不存在，放弃并删除刚刚创建的空库
            req.transaction?.abort();
            resolve(null);
        };
        req.onerror = () => resolve(null);
        req.onsuccess = async () => {
            const db = req.result;
            const out: Record<string, unknown[]> = {};
            for (const name of ['sources', 'playlists', 'songs']) {
                if (!db.objectStoreNames.contains(name)) continue;
                try {
                    out[name] = (await wrap(db.transaction(name, 'readonly').objectStore(name).getAll())) as unknown[];
                } catch {
                    out[name] = [];
                }
            }
            db.close();
            resolve(out);
        };
    });
}
