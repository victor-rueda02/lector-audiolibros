/** Lógica pura de la interfaz (sin DOM): estimaciones y selección de capítulos a generar. */
import type { FaseGeneracion } from '../tipos.ts';

export const PALABRAS_POR_MINUTO = 150;
export const BYTES_POR_SEGUNDO = 6000;
export const OPCIONES_N = [1, 2, 3, 5, 10] as const;
export const N_POR_DEFECTO = 3;

export function contarPalabras(parrafos: string[]): number {
  let n = 0;
  for (const p of parrafos) {
    const t = p.trim();
    if (t) n += t.split(/\s+/).length;
  }
  return n;
}

export function duracionEstimadaSeg(palabras: number): number {
  return (palabras / PALABRAS_POR_MINUTO) * 60;
}

/** 45 -> "menos de 1 min"; 600 -> "10 min"; 4000 -> "1 h 07 min". */
export function formatearDuracion(seg: number): string {
  if (!Number.isFinite(seg) || seg < 60) return 'menos de 1 min';
  const min = Math.round(seg / 60);
  if (min < 60) return `${min} min`;
  return `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, '0')} min`;
}

/** Segundos -> "45 s", "2 min 05 s", "1 h 03 min". */
export function formatearReloj(seg: number): string {
  const s = Math.max(0, Math.round(seg));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min ${String(s % 60).padStart(2, '0')} s`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Bytes aproximados que ocupará el audio de un capítulo. */
export function estimarBytes(palabras: number): number {
  return Math.ceil(duracionEstimadaSeg(palabras) * BYTES_POR_SEGUNDO);
}

export function formatearBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1).replace('.', ',')} MB`;
  return `${(bytes / 1024 ** 3).toFixed(2).replace('.', ',')} GB`;
}

export function normalizarN(valor: unknown): number {
  const n = Number(valor);
  return (OPCIONES_N as readonly number[]).includes(n) ? n : N_POR_DEFECTO;
}

/**
 * Los N primeros capítulos que faltan, empezando en el actual (incluido), en orden de lectura.
 * `generados` = ids ya generados con la voz elegida.
 */
export function capitulosAGenerar(
  idsCapitulos: string[],
  indiceActual: number,
  n: number,
  generados: ReadonlySet<string>,
): string[] {
  const res: string[] = [];
  for (let i = Math.max(0, indiceActual); i < idsCapitulos.length && res.length < n; i++) {
    const id = idsCapitulos[i]!;
    if (!generados.has(id)) res.push(id);
  }
  return res;
}

/**
 * Segundos que faltan en total: lo que queda del capítulo en curso (etaCapitulo) más los
 * capítulos pendientes según la tasa observada (segundos de cálculo por palabra). null si no se sabe.
 */
export function estimarRestante(
  etaCapitulo: number | null,
  palabrasPendientes: number,
  tasaSegPorPalabra: number | null,
): number | null {
  if (etaCapitulo === null) return null;
  if (palabrasPendientes <= 0) return etaCapitulo;
  if (tasaSegPorPalabra === null || !(tasaSegPorPalabra > 0)) return null;
  return etaCapitulo + palabrasPendientes * tasaSegPorPalabra;
}

export function etiquetaFase(fase: FaseGeneracion): string {
  switch (fase) {
    case 'descargando-voz':
      return 'Descargando la voz';
    case 'cargando-voz':
      return 'Cargando la voz';
    case 'generando':
      return 'Generando el audio';
    case 'codificando':
      return 'Comprimiendo el audio';
  }
}

export function bufferAHex(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += b.toString(16).padStart(2, '0');
  return s;
}
