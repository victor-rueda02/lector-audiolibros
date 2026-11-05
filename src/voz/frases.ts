/**
 * División de texto en frases y plan de síntesis de un capítulo. Módulo puro (sin DOM).
 */

export const MAX_CARACTERES_FRASE = 250;

/** Pausas objetivo (segundos) tras cada tipo de segmento. */
export const PAUSA_FRASE_SEG = 0.5;
export const PAUSA_PARRAFO_SEG = 0.9;
export const PAUSA_TITULO_SEG = 1.2;

export interface Segmento {
  texto: string;
  /** Silencio deseado después de este segmento, en segundos. */
  pausaDespuesSeg: number;
}

const TIENE_CONTENIDO = /[\p{L}\p{N}]/u;

/** Agrupa las piezas de `texto` (separadas por `separador`) en trozos de como mucho `max` caracteres. */
function partirPor(texto: string, separador: RegExp, max: number): string[] {
  const piezas = texto.split(separador).filter((p) => p.length > 0);
  const salida: string[] = [];
  let actual = '';
  for (const p of piezas) {
    const union = actual ? `${actual} ${p}` : p;
    if (actual && union.length > max) {
      salida.push(actual);
      actual = p;
    } else {
      actual = union;
    }
  }
  if (actual) salida.push(actual);
  return salida;
}

function partirPorEspacios(texto: string, max: number): string[] {
  const salida: string[] = [];
  let resto = texto.trim();
  while (resto.length > max) {
    let corte = resto.lastIndexOf(' ', max);
    if (corte <= 0) corte = max; // palabra gigante: corte duro
    salida.push(resto.slice(0, corte).trim());
    resto = resto.slice(corte).trim();
  }
  if (resto) salida.push(resto);
  return salida;
}

/**
 * Divide en frases de ≤ max caracteres: primero por . ! ? … (con cierres de
 * comillas/paréntesis), y las que sigan siendo largas por ; : , y por último
 * por espacios.
 */
export function dividirEnFrases(texto: string, max = MAX_CARACTERES_FRASE): string[] {
  const limpio = texto.replace(/\s+/g, ' ').trim();
  if (!limpio) return [];
  const frases = limpio.split(/(?<=[.!?…]["'»”’)\]]*)\s+/u);
  const resultado: string[] = [];
  for (const f of frases) {
    const frase = f.trim();
    if (!frase) continue;
    if (frase.length <= max) {
      resultado.push(frase);
      continue;
    }
    for (const trozo of partirPor(frase, /(?<=[;:])\s+/u, max)) {
      if (trozo.length <= max) {
        resultado.push(trozo);
        continue;
      }
      for (const t2 of partirPor(trozo, /(?<=,)\s+/u, max)) {
        if (t2.length <= max) resultado.push(t2);
        else resultado.push(...partirPorEspacios(t2, max));
      }
    }
  }
  return resultado.filter((f) => TIENE_CONTENIDO.test(f));
}

/**
 * Plan de síntesis: título (pausa larga) + párrafos (pausa corta entre frases,
 * media entre párrafos).
 */
export function planificarTexto(titulo: string | null, parrafos: string[], max = MAX_CARACTERES_FRASE): Segmento[] {
  const plan: Segmento[] = [];
  const anadir = (texto: string, pausaFinal: number) => {
    const fs = dividirEnFrases(texto, max);
    fs.forEach((t, i) => plan.push({ texto: t, pausaDespuesSeg: i === fs.length - 1 ? pausaFinal : PAUSA_FRASE_SEG }));
  };
  if (titulo && titulo.trim()) anadir(titulo, PAUSA_TITULO_SEG);
  for (const parrafo of parrafos) anadir(parrafo, PAUSA_PARRAFO_SEG);
  return plan;
}

/** Segundos de silencio (|x| < umbral) al final de un fragmento. */
export function silencioFinalSeg(muestras: Float32Array, frecuencia: number, umbral = 0.005): number {
  let n = 0;
  for (let i = muestras.length - 1; i >= 0 && Math.abs(muestras[i]) < umbral; i--) n++;
  return n / frecuencia;
}
