// ===== Persistencia local con IndexedDB =====
// Guarda los STL ya convertidos (datos pesados precalculados) para poder
// recuperarlos y descargarlos sin volver a ejecutar la conversión.

'use strict';

const BaseDatos = (function () {
  const NOMBRE_DB = 'conversorDB';
  const STORE = 'conversiones';
  const VERSION = 1;
  let dbPromise = null;

  function abrir() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(NOMBRE_DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  /** Guarda un registro {nombre, nTris, size, fecha, blob}. Devuelve su id. */
  async function guardar(registro) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      const req = tx.objectStore(STORE).add(registro);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Devuelve todos los registros guardados. */
  async function listar() {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  /** Borra un registro por id. */
  async function borrar(id) {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  /** Vacía todo el historial. */
  async function vaciar() {
    const db = await abrir();
    return new Promise((resolve, reject) => {
      const req = db.transaction(STORE, 'readwrite').objectStore(STORE).clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  }

  return { guardar, listar, borrar, vaciar };
})();
