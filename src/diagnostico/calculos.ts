/** Cálculos y formatos puros de la pantalla de Diagnóstico (sin DOM). */

/** 48 kbps = 6000 bytes/s = 21,6 MB por hora. */
export const BYTES_POR_HORA_MP3 = 6000 * 3600;

/** Velocidad = segundos de audio generados por segundo de cálculo. */
export function velocidad(duracionSeg: number, segundosCalculo: number): number {
  return segundosCalculo > 0 ? duracionSeg / segundosCalculo : 0;
}

export function interpretarVelocidad(v: number): string {
  if (v > 1.5) return 'Va sobrado: genera bastante más rápido que el tiempo real.';
  if (v >= 1) return 'Justo: genera apenas más rápido que el tiempo real.';
  return 'Más lento que tiempo real: un libro tardará más en prepararse de lo que dura.';
}

/** Minutos que tardará en generarse 1 hora de audio. */
export function minutosPorHora(v: number): number | null {
  return v > 0 ? 60 / v : null;
}

export function horasQueCaben(libreBytes: number | null): number | null {
  return libreBytes === null ? null : libreBytes / BYTES_POR_HORA_MP3;
}

export function formatearBytes(b: number | null): string {
  if (b === null) return 'desconocido';
  const mb = b / 1024 / 1024;
  if (mb >= 1024) return `${(mb / 1024).toLocaleString('es-ES', { maximumFractionDigits: 2 })} GB`;
  return `${mb.toLocaleString('es-ES', { maximumFractionDigits: 1 })} MB`;
}

export function formatearSegundos(s: number): string {
  if (s < 90) return `${s.toLocaleString('es-ES', { maximumFractionDigits: 1 })} s`;
  const m = Math.floor(s / 60);
  return `${m} min ${Math.round(s - m * 60)} s`;
}
