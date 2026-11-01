import { describe, expect, it } from 'vitest';
import {
  bufferAHex,
  capitulosAGenerar,
  contarPalabras,
  duracionEstimadaSeg,
  estimarBytes,
  estimarRestante,
  formatearBytes,
  formatearDuracion,
  formatearReloj,
  normalizarN,
} from './logica.ts';

describe('estimaciones', () => {
  it('cuenta palabras', () => expect(contarPalabras(['hola mundo', '  ', ' uno  dos tres '])).toBe(5));
  it('150 palabras = 60 s', () => expect(duracionEstimadaSeg(150)).toBe(60));
  it('bytes: 150 palabras/min * 6000 B/s', () => expect(estimarBytes(150)).toBe(360000));
  it('formatea duraciones', () => {
    expect(formatearDuracion(30)).toBe('menos de 1 min');
    expect(formatearDuracion(600)).toBe('10 min');
    expect(formatearDuracion(4020)).toBe('1 h 07 min');
    expect(formatearReloj(5)).toBe('5 s');
    expect(formatearReloj(125)).toBe('2 min 05 s');
  });
  it('formatea bytes', () => {
    expect(formatearBytes(2048)).toBe('2 KB');
    expect(formatearBytes(5.5 * 1024 * 1024)).toBe('5,5 MB');
  });
  it('normaliza N', () => {
    expect(normalizarN('5')).toBe(5);
    expect(normalizarN('4')).toBe(3);
    expect(normalizarN(null)).toBe(3);
  });
  it('estima el tiempo restante', () => {
    expect(estimarRestante(null, 100, 0.1)).toBeNull();
    expect(estimarRestante(10, 0, null)).toBe(10);
    expect(estimarRestante(10, 100, null)).toBeNull();
    expect(estimarRestante(10, 100, 0.5)).toBe(60);
  });
});

describe('capitulosAGenerar', () => {
  const ids = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'];
  it('toma los N siguientes desde el actual', () => {
    expect(capitulosAGenerar(ids, 1, 3, new Set())).toEqual(['c1', 'c2', 'c3']);
  });
  it('salta los ya generados', () => {
    expect(capitulosAGenerar(ids, 1, 3, new Set(['c1', 'c3']))).toEqual(['c2', 'c4', 'c5']);
  });
  it('no pasa del final ni mira atrás', () => {
    expect(capitulosAGenerar(ids, 4, 10, new Set())).toEqual(['c4', 'c5']);
    expect(capitulosAGenerar(ids, 0, 2, new Set(ids))).toEqual([]);
  });
});

describe('bufferAHex', () => {
  it('convierte a hexadecimal', () => expect(bufferAHex(new Uint8Array([0, 15, 255]).buffer)).toBe('000fff'));
});
