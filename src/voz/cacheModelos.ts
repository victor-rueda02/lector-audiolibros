/**
 * Descarga de modelos con progreso y caché en la Cache API (disponible en
 * Workers y en Safari). Evita OPFS createWritable, poco fiable en WebKit.
 */

export const NOMBRE_CACHE = 'lector-voces-v1';

export async function estaEnCache(url: string): Promise<boolean> {
  if (typeof caches === 'undefined') return false;
  try {
    const cache = await caches.open(NOMBRE_CACHE);
    return (await cache.match(url)) !== undefined;
  } catch {
    return false;
  }
}

export async function borrarDeCache(url: string): Promise<void> {
  if (typeof caches === 'undefined') return;
  try {
    const cache = await caches.open(NOMBRE_CACHE);
    await cache.delete(url);
  } catch {
    /* sin caché: nada que borrar */
  }
}

/**
 * Devuelve el contenido de `url`, desde la caché si está o descargándolo (y
 * guardándolo) si no. `tamanoConocido` se usa si el servidor no envía Content-Length.
 */
export async function obtenerConCache(
  url: string,
  tamanoConocido: number,
  onProgreso?: (fraccion: number) => void,
): Promise<ArrayBuffer> {
  let cache: Cache | null = null;
  try {
    if (typeof caches !== 'undefined') cache = await caches.open(NOMBRE_CACHE);
  } catch {
    cache = null;
  }
  if (cache) {
    const guardada = await cache.match(url);
    if (guardada) {
      const buf = await guardada.arrayBuffer();
      onProgreso?.(1);
      return buf;
    }
  }

  let respuesta: Response;
  try {
    respuesta = await fetch(url);
  } catch {
    throw new Error('No se pudo descargar la voz. Comprueba la conexión a Internet.');
  }
  if (!respuesta.ok) throw new Error(`No se pudo descargar la voz (error ${respuesta.status}).`);

  const total = Number(respuesta.headers.get('Content-Length')) || tamanoConocido;
  let buffer: ArrayBuffer;
  if (respuesta.body) {
    const lector = respuesta.body.getReader();
    const trozos: Uint8Array[] = [];
    let recibido = 0;
    for (;;) {
      const { done, value } = await lector.read();
      if (done) break;
      trozos.push(value);
      recibido += value.length;
      onProgreso?.(Math.min(1, recibido / total));
    }
    const todo = new Uint8Array(recibido);
    let pos = 0;
    for (const t of trozos) {
      todo.set(t, pos);
      pos += t.length;
    }
    buffer = todo.buffer;
  } else {
    buffer = await respuesta.arrayBuffer();
  }
  onProgreso?.(1);

  if (cache) {
    try {
      await cache.put(url, new Response(buffer.slice(0), { headers: { 'Content-Type': 'application/octet-stream' } }));
    } catch {
      /* cuota llena o caché no disponible: se usa igualmente en esta sesión */
    }
  }
  return buffer;
}
