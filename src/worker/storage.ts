/**
 * Where the game is kept between visits: the SQLite database file, in the browser's IndexedDB (one record).
 */
const DB_NAME = 'frontier';
const STORE = 'games';
const KEY = 'current';

function open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DB_NAME, 1);
        request.onupgradeneeded = () => request.result.createObjectStore(STORE);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

function transact<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    return open().then((db) => new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const request = work(tx.objectStore(STORE));
        tx.oncomplete = () => {
            db.close();
            resolve(request.result);
        };
        tx.onerror = tx.onabort = () => {
            db.close();
            reject(tx.error ?? request.error);
        };
    }));
}

export async function loadGame(): Promise<Uint8Array | null> {
    const value = await transact('readonly', (store) => store.get(KEY));
    return value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
}

export async function saveGame(bytes: Uint8Array): Promise<void> {
    await transact('readwrite', (store) => store.put(bytes, KEY));
}

export async function deleteGame(): Promise<void> {
    await transact('readwrite', (store) => store.delete(KEY));
}
