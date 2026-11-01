import { describe, expect, it } from 'vitest';
import {
  capitulosABorrar,
  formatearTiempo,
  formatearVelocidad,
  guardarPosicion,
  leerPosicion,
  normalizarVelocidad,
  type AlmacenamientoSimple,
} from './logica.ts';

function memoria(): AlmacenamientoSimple {
  const datos = new Map<string, string>();
  return { getItem: (k) => datos.get(k) ?? null, setItem: (k, v) => void datos.set(k, v) };
}

describe('formatearTiempo', () => {
  it('formatea minutos y horas', () => {
    expect(formatearTiempo(0)).toBe('0:00');
    expect(formatearTiempo(75.9)).toBe('1:15');
    expect(formatearTiempo(3725)).toBe('1:02:05');
  });
  it('tolera valores no válidos', () => {
    expect(formatearTiempo(NaN)).toBe('0:00');
    expect(formatearTiempo(-5)).toBe('0:00');
    expect(formatearTiempo(Infinity)).toBe('0:00');
  });
});

describe('velocidad', () => {
  it('formatea con coma', () => expect(formatearVelocidad(1.75)).toBe('1,75x'));
  it('normaliza al valor permitido más cercano', () => {
    expect(normalizarVelocidad('1.5')).toBe(1.5);
    expect(normalizarVelocidad(3)).toBe(2);
    expect(normalizarVelocidad(0.1)).toBe(0.8);
    expect(normalizarVelocidad(null)).toBe(1);
    expect(normalizarVelocidad('abc')).toBe(1);
  });
});

describe('posición', () => {
  it('guarda y restaura', () => {
    const st = memoria();
    const pos = { libroId: 'abc', capituloId: 'c001', segundo: 42.5, actualizada: 1 };
    guardarPosicion(st, pos);
    expect(leerPosicion(st)).toEqual(pos);
  });
  it('ignora datos corruptos o incompletos', () => {
    const st = memoria();
    expect(leerPosicion(st)).toBeNull();
    st.setItem('lector.posicion', '{no json');
    expect(leerPosicion(st)).toBeNull();
    st.setItem('lector.posicion', JSON.stringify({ libroId: 'a', capituloId: 'b', segundo: -3 }));
    expect(leerPosicion(st)).toBeNull();
  });
  it('no falla si el almacenamiento lanza', () => {
    const roto: AlmacenamientoSimple = {
      getItem: () => {
        throw new Error('x');
      },
      setItem: () => {
        throw new Error('x');
      },
    };
    expect(() => guardarPosicion(roto, { libroId: 'a', capituloId: 'b', segundo: 1, actualizada: 0 })).not.toThrow();
    expect(leerPosicion(roto)).toBeNull();
  });
});

describe('capitulosABorrar', () => {
  const ids = ['c000', 'c001', 'c002', 'c003'];
  it('borra solo los anteriores al actual', () => {
    expect(capitulosABorrar(ids, 2, ['c000', 'c001', 'c002', 'c003'])).toEqual(['c000', 'c001']);
    expect(capitulosABorrar(ids, 0, ['c000', 'c001'])).toEqual([]);
  });
  it('ignora pistas desconocidas', () => {
    expect(capitulosABorrar(ids, 3, ['zzz', 'c001'])).toEqual(['c001']);
  });
});
