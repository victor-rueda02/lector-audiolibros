/**
 * Almacén en IndexedDB nativo. El audio se guarda como ArrayBuffer (no Blob:
 * WebKit tiene fallos con Blobs en IndexedDB) y se devuelve como Blob en memoria.
 */
import type { AlmacenAudio, EstadoAlmacen, LibroGuardado, PistaGuardada } from '../tipos.ts';

const NOMBRE_BD = 'lector-audiolibros';
const VERSION_BD = 1;
const T_LIBRO = 'libro';
const T_PISTAS = 'pistas';
const T_AUDIO = 'audio';
const CLAVE_LIBRO = 'actual';

const claveDe = (libroId: string, capituloId: string) => `${libroId}/${capituloId}`;

function promesa<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Error de IndexedDB'));
  });
}

function terminada(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Error de IndexedDB'));
    tx.onabort = () => reject(tx.error ?? new Error('Transacción cancelada'));
  });
}

export function crearAlmacen(): AlmacenAudio {
  let abierta: Promise<IDBDatabase> | null = null;

  function bd(): Promise<IDBDatabase> {
    abierta ??= new Promise<IDBDatabase>((resolve, reject) => {
      if (typeof indexedDB === 'undefined') {
        reject(new Error('Este navegador no permite guardar datos (IndexedDB no disponible).'));
        return;
      }
      const req = indexedDB.open(NOMBRE_BD, VERSION_BD);
      req.onupgradeneeded = () => {
        const db = req.result;
        db.createObjectStore(T_LIBRO);
        db.createObjectStore(T_AUDIO);
        db.createObjectStore(T_PISTAS).createIndex('libroId', 'libroId');
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          abierta = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        abierta = null;
        reject(req.error ?? new Error('No se pudo abrir la base de datos.'));
      };
    });
    return abierta;
  }

  return {
    async pedirPersistencia(): Promise<boolean> {
      try {
        if (navigator.storage?.persist) return await navigator.storage.persist();
      } catch {
        /* sin soporte */
      }
      return false;
    },

    async estado(): Promise<EstadoAlmacen> {
      let persistente = false;
      let usadoBytes: number | null = null;
      let cuotaBytes: number | null = null;
      try {
        if (navigator.storage?.persisted) persistente = await navigator.storage.persisted();
      } catch {
        /* sin soporte */
      }
      try {
        if (navigator.storage?.estimate) {
          const e = await navigator.storage.estimate();
          usadoBytes = e.usage ?? null;
          cuotaBytes = e.quota ?? null;
        }
      } catch {
        /* sin soporte */
      }
      const libreBytes = usadoBytes !== null && cuotaBytes !== null ? Math.max(0, cuotaBytes - usadoBytes) : null;
      return { persistente, usadoBytes, cuotaBytes, libreBytes };
    },

    async guardarLibro(libro: LibroGuardado): Promise<void> {
      const db = await bd();
      const tx = db.transaction(T_LIBRO, 'readwrite');
      tx.objectStore(T_LIBRO).put(libro, CLAVE_LIBRO);
      await terminada(tx);
    },

    async obtenerLibro(): Promise<LibroGuardado | null> {
      const db = await bd();
      const r = await promesa(db.transaction(T_LIBRO).objectStore(T_LIBRO).get(CLAVE_LIBRO));
      return (r as LibroGuardado | undefined) ?? null;
    },

    async guardarPista(meta: PistaGuardada, audio: Blob): Promise<void> {
      // Se lee el Blob ANTES de abrir la transacción (si no, IndexedDB la cierra por inactividad).
      const buffer = await audio.arrayBuffer();
      const db = await bd();
      const clave = claveDe(meta.libroId, meta.capituloId);
      const tx = db.transaction([T_PISTAS, T_AUDIO], 'readwrite');
      tx.objectStore(T_PISTAS).put({ ...meta, tipoMime: meta.tipoMime || audio.type }, clave);
      tx.objectStore(T_AUDIO).put(buffer, clave);
      await terminada(tx);
    },

    async obtenerAudio(libroId: string, capituloId: string): Promise<Blob | null> {
      const db = await bd();
      const clave = claveDe(libroId, capituloId);
      const tx = db.transaction([T_PISTAS, T_AUDIO]);
      const [meta, buffer] = await Promise.all([
        promesa(tx.objectStore(T_PISTAS).get(clave)) as Promise<PistaGuardada | undefined>,
        promesa(tx.objectStore(T_AUDIO).get(clave)) as Promise<ArrayBuffer | undefined>,
      ]);
      if (!buffer) return null;
      return new Blob([buffer], { type: meta?.tipoMime || 'audio/mpeg' });
    },

    async listarPistas(libroId: string): Promise<PistaGuardada[]> {
      const db = await bd();
      const pistas = await promesa(db.transaction(T_PISTAS).objectStore(T_PISTAS).index('libroId').getAll(libroId));
      return (pistas as PistaGuardada[]).sort((a, b) => a.capituloId.localeCompare(b.capituloId));
    },

    async borrarPista(libroId: string, capituloId: string): Promise<void> {
      const db = await bd();
      const clave = claveDe(libroId, capituloId);
      const tx = db.transaction([T_PISTAS, T_AUDIO], 'readwrite');
      tx.objectStore(T_PISTAS).delete(clave);
      tx.objectStore(T_AUDIO).delete(clave);
      await terminada(tx);
    },

    async borrarTodo(): Promise<void> {
      const db = await bd();
      const tx = db.transaction([T_LIBRO, T_PISTAS, T_AUDIO], 'readwrite');
      tx.objectStore(T_LIBRO).clear();
      tx.objectStore(T_PISTAS).clear();
      tx.objectStore(T_AUDIO).clear();
      await terminada(tx);
    },
  };
}
