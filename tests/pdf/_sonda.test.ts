import { readFileSync } from 'node:fs';
import { test } from 'vitest';
import { extraerLibro } from '../../src/pdf/index.ts';
import { leerPdf } from '../../src/pdf/lectura.ts';
test('sonda', async () => {
  for (const f of ['libro-simple', 'libro-indice', 'libro-notas', 'libro-columnas', 'escaneado']) {
    const d = readFileSync(`tests/fixtures/${f}.pdf`);
    const l = await extraerLibro(d);
    console.log(f, JSON.stringify(l, null, 1));
  }
  const r = await leerPdf(readFileSync('tests/fixtures/libro-indice.pdf'));
  console.log(JSON.stringify(r.indice), r.titulo, JSON.stringify(r.paginas[1]!.fragmentos.slice(0,4)));
});
