import { describe, expect, it } from 'vitest';
import { formatearBytes, horasQueCaben, interpretarVelocidad, minutosPorHora, velocidad } from './calculos.ts';
import { TEXTO_PRUEBA } from './textoPrueba.ts';

describe('diagnóstico: cálculos', () => {
  it('velocidad e interpretación', () => {
    expect(velocidad(60, 30)).toBe(2);
    expect(interpretarVelocidad(2)).toMatch(/sobrado/);
    expect(interpretarVelocidad(1.2)).toMatch(/Justo/);
    expect(interpretarVelocidad(0.5)).toMatch(/lento/);
    expect(minutosPorHora(2)).toBe(30);
  });
  it('horas que caben a 21,6 MB/h', () => {
    expect(horasQueCaben(21_600_000 * 10)).toBeCloseTo(10, 5);
    expect(horasQueCaben(null)).toBeNull();
  });
  it('formatea bytes', () => {
    expect(formatearBytes(null)).toBe('desconocido');
    expect(formatearBytes(2 * 1024 * 1024 * 1024)).toMatch(/GB/);
  });
  it('el texto de prueba tiene unas 150-170 palabras', () => {
    const n = TEXTO_PRUEBA.split(/\s+/).length;
    expect(n).toBeGreaterThanOrEqual(150);
    expect(n).toBeLessThanOrEqual(175);
  });
});
