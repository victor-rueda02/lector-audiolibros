/**
 * Fonemizador: espeak-ng compilado a WebAssembly (paquete @diffusionstudio/piper-wasm,
 * MIT; espeak-ng es GPL-3.0). Los archivos .wasm/.data se sirven desde nuestro origen
 * (los empaqueta Vite con ?url), nunca desde un CDN.
 */
import crearPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import urlDatos from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url';
import urlWasm from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url';

interface ModuloPhonemize {
  callMain(args: string[]): number;
}

let modulo: Promise<ModuloPhonemize> | null = null;
let salida: string[] = [];
let errores: string[] = [];

function cargarModulo(): Promise<ModuloPhonemize> {
  modulo ??= crearPiperPhonemize({
    print: (linea: string) => salida.push(linea),
    printErr: (linea: string) => errores.push(linea),
    locateFile: (ruta: string) => (ruta.endsWith('.wasm') ? urlWasm : ruta.endsWith('.data') ? urlDatos : ruta),
  }) as Promise<ModuloPhonemize>;
  return modulo;
}

/**
 * Convierte un texto en secuencias de ids de fonemas de Piper. Devuelve un array por
 * cada oración que espeak detecte dentro del texto (normalmente una).
 */
export async function fonemizar(texto: string, vozEspeak: string): Promise<number[][]> {
  const m = await cargarModulo();
  salida = [];
  errores = [];
  try {
    m.callMain(['-l', vozEspeak, '--input', JSON.stringify([{ text: texto }]), '--espeak_data', '/espeak-ng-data']);
  } catch (e) {
    // Emscripten lanza al terminar main con código distinto de 0.
    if (salida.length === 0) throw new Error(`Falló el fonemizador: ${errores.join(' ') || String(e)}`);
  }
  const resultado: number[][] = [];
  for (const linea of salida) {
    try {
      const ids = (JSON.parse(linea) as { phoneme_ids?: number[] }).phoneme_ids;
      if (ids && ids.length > 0) resultado.push(ids);
    } catch {
      /* línea que no es JSON: se ignora */
    }
  }
  return resultado;
}
