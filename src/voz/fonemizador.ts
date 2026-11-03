/**
 * Fonemizador: espeak-ng compilado a WebAssembly (paquete @diffusionstudio/piper-wasm,
 * MIT; espeak-ng es GPL-3.0). Los archivos .wasm/.data se sirven desde nuestro origen
 * (los empaqueta Vite con ?url), nunca desde un CDN.
 *
 * Ojo: el módulo tiene la memoria fija (16 MB) y cada llamada a callMain pierde memoria
 * (reinicializa espeak); hacia la llamada 85–110 aborta con "Aborted()". Por eso se
 * recicla el módulo cada LLAMADAS_POR_MODULO llamadas, reutilizando el .data descargado
 * y el wasm ya compilado (crear un módulo nuevo cuesta unas decenas de ms).
 */
import crearPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import urlDatos from '@diffusionstudio/piper-wasm/build/piper_phonemize.data?url';
import urlWasm from '@diffusionstudio/piper-wasm/build/piper_phonemize.wasm?url';

/** Muy por debajo del límite observado (~86 llamadas con frases normales). */
export const LLAMADAS_POR_MODULO = 40;

interface ModuloPhonemize {
  callMain(args: string[]): number;
}

export interface RecursosFonemizador {
  /** Contenido de piper_phonemize.data (datos de espeak-ng). */
  cargarDatos(): Promise<ArrayBuffer>;
  /** Binario piper_phonemize.wasm. */
  cargarWasm(): Promise<ArrayBuffer>;
}

export type Fonemizar = (texto: string, vozEspeak: string) => Promise<number[][]>;

/** Sustituye los surrogates sueltos (UTF-16 mal formado), que hacen fallar a espeak-ng. */
export function sanearTexto(texto: string): string {
  let r = '';
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = texto.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        r += texto[i] + texto[i + 1];
        i++;
      } else r += ' ';
    } else if (c >= 0xdc00 && c <= 0xdfff) r += ' ';
    else r += texto[i];
  }
  return r;
}

export function crearFonemizador(recursos: RecursosFonemizador): Fonemizar {
  let datos: Promise<ArrayBuffer> | null = null;
  let wasm: Promise<WebAssembly.Module> | null = null;
  let modulo: Promise<ModuloPhonemize> | null = null;
  let llamadas = 0;
  let salida: string[] = [];
  let errores: string[] = [];

  async function nuevoModulo(): Promise<ModuloPhonemize> {
    datos ??= recursos.cargarDatos();
    wasm ??= recursos.cargarWasm().then((b) => WebAssembly.compile(b));
    const [bufDatos, moduloWasm] = await Promise.all([datos, wasm]);
    return (await crearPiperPhonemize({
      print: (linea: string) => salida.push(linea),
      printErr: (linea: string) => errores.push(linea),
      // Reutiliza el .data ya descargado (solo se lee: se puede compartir entre módulos).
      getPreloadedPackage: () => bufDatos,
      // Reutiliza el wasm ya compilado.
      instantiateWasm: (imports, recibir) => {
        void WebAssembly.instantiate(moduloWasm, imports).then((instancia) => recibir(instancia, moduloWasm));
        return {};
      },
      locateFile: (ruta: string) => ruta,
    })) as ModuloPhonemize;
  }

  function obtenerModulo(): Promise<ModuloPhonemize> {
    if (!modulo || llamadas >= LLAMADAS_POR_MODULO) {
      llamadas = 0;
      modulo = nuevoModulo();
      // Si falla la creación, que el siguiente intento vuelva a probar.
      modulo.catch(() => {
        modulo = null;
      });
    }
    return modulo;
  }

  async function llamar(texto: string, vozEspeak: string): Promise<string[]> {
    const m = await obtenerModulo();
    llamadas++;
    salida = [];
    errores = [];
    try {
      m.callMain(['-l', vozEspeak, '--input', JSON.stringify([{ text: texto }]), '--espeak_data', '/espeak-ng-data']);
    } catch (e) {
      // Emscripten lanza al terminar main con código distinto de 0 o al abortar.
      if (salida.length === 0) {
        modulo = null; // el módulo puede haber quedado inservible: se recrea
        throw new Error(errores.join(' ') || String(e));
      }
    }
    return salida;
  }

  return async (texto, vozEspeak) => {
    const limpio = sanearTexto(texto);
    let lineas: string[];
    try {
      lineas = await llamar(limpio, vozEspeak);
    } catch (e1) {
      // Un reintento con un módulo nuevo.
      try {
        lineas = await llamar(limpio, vozEspeak);
      } catch (e2) {
        throw new Error(`Falló el fonemizador: ${e2 instanceof Error ? e2.message : String(e2)} (primer intento: ${e1 instanceof Error ? e1.message : String(e1)})`);
      }
    }
    const resultado: number[][] = [];
    for (const linea of lineas) {
      try {
        const ids = (JSON.parse(linea) as { phoneme_ids?: number[] }).phoneme_ids;
        if (ids && ids.length > 0) resultado.push(ids);
      } catch {
        /* línea que no es JSON: se ignora */
      }
    }
    return resultado;
  };
}

async function descargar(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`No se pudo descargar ${url} (${r.status})`);
  return r.arrayBuffer();
}

/**
 * Convierte un texto en secuencias de ids de fonemas de Piper. Devuelve un array por
 * cada oración que espeak detecte dentro del texto (normalmente una).
 */
export const fonemizar: Fonemizar = crearFonemizador({
  cargarDatos: () => descargar(urlDatos),
  cargarWasm: () => descargar(urlWasm),
});
