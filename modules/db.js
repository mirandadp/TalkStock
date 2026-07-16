// ══════════════════════════════════════════════
// MÓDULO: BASE DE DATOS LOCAL (INDEXEDDB)
// ══════════════════════════════════════════════

let db;
const DB_NAME = 'StockVozDB'
  , DB_VER = 7;

function initDB() {
    return new Promise( (res, rej) => {
        const req = indexedDB.open(DB_NAME, DB_VER);
        req.onupgradeneeded = e => {
            const d = e.target.result;
            if (!d.objectStoreNames.contains('materiales'))
                d.createObjectStore('materiales', {
                    keyPath: 'id',
                    autoIncrement: true
                });
            if (!d.objectStoreNames.contains('ubicaciones'))
                d.createObjectStore('ubicaciones', {
                    keyPath: 'id',
                    autoIncrement: true
                });
            if (!d.objectStoreNames.contains('movimientos')) {
                const mv = d.createObjectStore('movimientos', {
                    keyPath: 'id',
                    autoIncrement: true
                });
                mv.createIndex('synced', 'synced', {
                    unique: false
                });
            }
            if (!d.objectStoreNames.contains('usuarios'))
                d.createObjectStore('usuarios', {
                    keyPath: 'id',
                    autoIncrement: true
                });
            if (!d.objectStoreNames.contains('pedidos'))
                d.createObjectStore('pedidos', {
                    keyPath: 'id',
                    autoIncrement: true
                });
            if (!d.objectStoreNames.contains('fichajes'))
                d.createObjectStore('fichajes', {
                    keyPath: 'id',
                    autoIncrement: true
                });
            if (!d.objectStoreNames.contains('config'))
                d.createObjectStore('config', {
                    keyPath: 'key'
                });
        }
        ;
        req.onsuccess = e => {
            db = e.target.result;
            res(db);
        }
        ;
        req.onerror = () => rej(req.error);
    }
    );
}

// ── Config global de la app (clave/valor), sincronizable ──
async function getConfigValue(key, defaultVal) {
    try {
        const row = await dbTx('config', 'readonly', s => s.get(key));
        return row ? row.value : defaultVal;
    } catch (e) {
        return defaultVal;
    }
}

async function setConfigValue(key, value) {
    const now = new Date().toISOString();
    await dbPut('config', {
        key,
        value,
        modificadoPor: currentUser?.nombre || '',
        modificadoEn: now,
        synced: 0
    });
    if (typeof scheduleSyncSoon === 'function')
        scheduleSyncSoon();
}

function dbTx(store, mode, fn) {
    return new Promise( (res, rej) => {
        const tx = db.transaction(store, mode)
          , s = tx.objectStore(store)
          , req = fn(s);
        req.onsuccess = () => res(req.result);
        req.onerror = () => rej(req.error);
    }
    );
}

const dbGetAll = store => dbTx(store, 'readonly', s => s.getAll());
const dbAdd = (store, data) => dbTx(store, 'readwrite', s => s.add(data));
const dbPut = (store, data) => dbTx(store, 'readwrite', s => s.put(data));
const dbDelete = (store, key) => dbTx(store, 'readwrite', s => s.delete(key));
function dbClear(store) {
    return new Promise(res => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = res;
    }
    );
}
