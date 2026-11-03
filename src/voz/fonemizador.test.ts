import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { LLAMADAS_POR_MODULO, crearFonemizador, sanearTexto } from './fonemizador.ts';

const require = createRequire(import.meta.url);
const dir = require.resolve('@diffusionstudio/piper-wasm/build/piper_phonemize.js').replace(/piper_phonemize\.js$/, '');
const leer = async (f: string) => {
  const b = await readFile(dir + f);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('fonemizador', () => {
  it('aguanta un capítulo largo: cientos de llamadas seguidas sin abortar', async () => {
    // Regresión: el módulo de espeak pierde memoria en cada llamada y abortaba hacia la llamada 87.
    const fonemizar = crearFonemizador({ cargarDatos: () => leer('piper_phonemize.data'), cargarWasm: () => leer('piper_phonemize.wasm') });
    const frase = 'Subieron juntos por la escalera de caracol, que crujía bajo sus pasos como un barco viejo.';
    const total = LLAMADAS_POR_MODULO * 8;
    for (let i = 0; i < total; i++) {
      const ids = await fonemizar(`${frase} ${i}`, 'es');
      expect(ids.length).toBeGreaterThan(0);
    }
  }, 120_000);

  it('no falla con surrogates sueltos y conserva los pares válidos', async () => {
    expect(sanearTexto('a\uD800b\uDC00c😀')).toBe('a b c😀');
    const fonemizar = crearFonemizador({ cargarDatos: () => leer('piper_phonemize.data'), cargarWasm: () => leer('piper_phonemize.wasm') });
    const ids = await fonemizar('hola \uD800 adiós', 'es');
    expect(ids.length).toBeGreaterThan(0);
  });

  it('se recupera tras un error (voz inexistente) con un módulo nuevo', async () => {
    const fonemizar = crearFonemizador({ cargarDatos: () => leer('piper_phonemize.data'), cargarWasm: () => leer('piper_phonemize.wasm') });
    await expect(fonemizar('hola', 'xx_YY')).rejects.toThrow(/Falló el fonemizador/);
    expect((await fonemizar('hola', 'es')).length).toBeGreaterThan(0);
  });
});
