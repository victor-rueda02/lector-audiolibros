/** Lógica pura del reproductor (sin DOM): tiempos, velocidades, posición y ventana de capítulos. */
import type { PosicionLectura } from '../tipos.ts';
import { CLAVES_LOCAL } from '../tipos.ts';

export interface AlmacenamientoSimple {
  getItem(clave: string): string | null;
  setItem(clave: string, valor: string): void;
}

export const SALTO_SEG = 30;
export const VELOCIDADES = [0.8, 0.9, 1, 1.1, 1.2, 1.3, 1.5, 1.75, 2] as const;
export const CLAVE_VELOCIDAD = 'lector.velocidad';

/** 75 -> "1:15"; 3725 -> "1:02:05". Valores no válidos -> "0:00". */
export function formatearTiempo(seg: number): string {
  if (!Number.isFinite(seg) || seg < 0) seg = 0;
  const total = Math.floor(seg);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

/** 1.75 -> "1,75x" */
export function formatearVelocidad(v: number): string {
  return `${String(v).replace('.', ',')}x`;
}

/** Devuelve la velocidad permitida más cercana (1 si el valor no es válido). */
export function normalizarVelocidad(v: unknown): number {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : typeof v === 'number' ? v : NaN;
  if (!Number.isFinite(n)) return 1;
  let mejor: number = 1;
  let dist = Infinity;
  for (const o of VELOCIDADES) {
    const d = Math.abs(o - n);
    if (d < dist) {
      dist = d;
      mejor = o;
    }
  }
  return mejor;
}

export function limitar(valor: number, min: number, max: number): number {
  return Math.min(Math.max(valor, min), max);
}

export function guardarPosicion(st: AlmacenamientoSimple, pos: PosicionLectura): void {
  try {
    st.setItem(CLAVES_LOCAL.posicion, JSON.stringify(pos));
  } catch {
    /* almacenamiento lleno o bloqueado: no es crítico */
  }
}

export function leerPosicion(st: AlmacenamientoSimple): PosicionLectura | null {
  try {
    const crudo = st.getItem(CLAVES_LOCAL.posicion);
    if (!crudo) return null;
    const p = JSON.parse(crudo) as Partial<PosicionLectura>;
    if (
      typeof p.libroId === 'string' &&
      typeof p.capituloId === 'string' &&
      typeof p.segundo === 'number' &&
      Number.isFinite(p.segundo) &&
      p.segundo >= 0
    ) {
      return {
        libroId: p.libroId,
        capituloId: p.capituloId,
        segundo: p.segundo,
        actualizada: typeof p.actualizada === 'number' ? p.actualizada : 0,
      };
    }
  } catch {
    /* JSON corrupto */
  }
  return null;
}

/** Pistas de capítulos anteriores al actual (ya escuchados): se pueden borrar. */
export function capitulosABorrar(idsCapitulos: string[], indiceActual: number, idsConPista: Iterable<string>): string[] {
  const res: string[] = [];
  for (const id of idsConPista) {
    const i = idsCapitulos.indexOf(id);
    if (i >= 0 && i < indiceActual) res.push(id);
  }
  return res;
}
