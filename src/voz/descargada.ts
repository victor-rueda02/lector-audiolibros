import { resolverVoz } from './catalogo.ts';
import { estaEnCache } from './cacheModelos.ts';

/** true si el modelo y su configuración están en la Cache API (hilo principal, sin cargar el worker). */
export async function vozDescargada(vozId: string): Promise<boolean> {
  const v = resolverVoz(vozId);
  if (!v) return false;
  return (await estaEnCache(v.urlOnnx)) && (await estaEnCache(v.urlConfig));
}
