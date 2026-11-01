import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extraerLibro, leerPdf } from '../../src/pdf/index.ts';
import type { Libro } from '../../src/tipos.ts';

const cargar = (nombre: string): Uint8Array => new Uint8Array(readFileSync(join(__dirname, '..', 'fixtures', nombre)));
const textoDe = (l: Libro): string => l.capitulos.flatMap((c) => c.parrafos).join('\n');

const P_LLEGADA =
  'La mañana era fría y el viento soplaba con una fuerza inusual sobre los acantilados del norte. Marta bajó del autobús con una maleta desgastada y miró el horizonte: allí, entre la niebla, se adivinaba la silueta del faro.';
const P_CARTA =
  'Aquella noche, mientras la lámpara giraba sobre el agua, escribió una carta a su hermana. Le contó que el trabajo era duro, que el viento no dejaba dormir y que, a pesar de todo, se sentía en casa por primera vez en años.';

const CABECERAS_Y_PIES = ['Ana Ruiz', 'Página', 'Pág.', '/ 99', '— 1 —', '- 3 -'];

describe('libro-simple.pdf (sin índice)', () => {
  it('el fixture realmente contiene palabras partidas con guion', async () => {
    const { paginas } = await leerPdf(cargar('libro-simple.pdf'));
    const conGuion = paginas.flatMap((p) => p.fragmentos).filter((f) => /\p{L}-$/u.test(f.texto));
    expect(conGuion.length).toBeGreaterThanOrEqual(2);
  });

  it('detecta tres capítulos por tamaño de letra', async () => {
    const libro = await extraerLibro(cargar('libro-simple.pdf'));
    expect(libro.origenCapitulos).toBe('titulos');
    expect(libro.escaneado).toBe(false);
    expect(libro.numPaginas).toBe(5);
    expect(libro.capitulos.map((c) => c.titulo)).toEqual(['Capítulo 1. La llegada', 'Capítulo 2. El guardián', 'Capítulo 3. La tormenta']);
    expect(libro.capitulos.map((c) => c.id)).toEqual(['c000', 'c001', 'c002']);
    expect(libro.capitulos.map((c) => c.paginaInicio)).toEqual([1, 3, 5]);
    expect(libro.titulo).toBe('Capítulo 1. La llegada');
  });

  it('no contiene cabeceras, pies ni números de página', async () => {
    const libro = await extraerLibro(cargar('libro-simple.pdf'));
    const texto = textoDe(libro);
    expect(texto).not.toContain('El faro de las nieblas');
    for (const basura of CABECERAS_Y_PIES) expect(texto).not.toContain(basura);
    for (const p of libro.capitulos.flatMap((c) => c.parrafos)) expect(p).not.toMatch(/^[\s\-—\dvxi./]+$/);
    // Los títulos no se repiten como primer párrafo.
    for (const c of libro.capitulos) expect(c.parrafos[0]).not.toContain(c.titulo);
  });

  it('une palabras partidas y reconstruye los párrafos (también entre páginas)', async () => {
    const libro = await extraerLibro(cargar('libro-simple.pdf'));
    const [c1, c2] = libro.capitulos;
    expect(c1!.parrafos).toHaveLength(4);
    expect(c1!.parrafos[0]).toBe(P_LLEGADA);
    expect(c1!.parrafos[2]).toMatch(/^El guardián se llamaba Anselmo/);
    expect(c2!.parrafos).toContain(P_CARTA); // este párrafo cruza el salto de página
    expect(textoDe(libro)).not.toMatch(/\p{L}- \p{L}/u);
    expect(textoDe(libro)).not.toMatch(/\p{L}-$/mu);
  });
});

describe('libro-indice.pdf (con outline)', () => {
  it('usa el índice y crea un capítulo "Inicio" con la portada', async () => {
    const libro = await extraerLibro(cargar('libro-indice.pdf'));
    expect(libro.origenCapitulos).toBe('indice');
    expect(libro.titulo).toBe('El faro de las nieblas');
    expect(libro.capitulos.map((c) => c.titulo)).toEqual([
      'Inicio',
      'Capítulo 1. La llegada',
      'Capítulo 2. El guardián',
      'Capítulo 3. La tormenta',
    ]);
    expect(libro.capitulos.map((c) => c.id)).toEqual(['c000', 'c001', 'c002', 'c003']);
    expect(libro.capitulos.map((c) => c.paginaInicio)).toEqual([1, 2, 4, 6]);
    const inicio = libro.capitulos[0]!.parrafos.join(' ');
    expect(inicio).toContain('Ana Ruiz');
    expect(inicio).toContain('Edición de prueba');
  });

  it('el contenido de los capítulos queda limpio', async () => {
    const libro = await extraerLibro(cargar('libro-indice.pdf'));
    const texto = libro.capitulos
      .slice(1)
      .flatMap((c) => c.parrafos)
      .join('\n');
    for (const basura of CABECERAS_Y_PIES) expect(texto).not.toContain(basura);
    expect(texto).not.toContain('El faro de las nieblas');
    expect(libro.capitulos[1]!.parrafos[0]).toBe(P_LLEGADA);
    expect(libro.capitulos[2]!.parrafos).toContain(P_CARTA);
    for (const c of libro.capitulos.slice(1)) expect(c.parrafos[0]).not.toContain(c.titulo);
  });
});

describe('libro-notas.pdf', () => {
  it('no incluye notas al pie ni sus llamadas', async () => {
    const libro = await extraerLibro(cargar('libro-notas.pdf'));
    const texto = textoDe(libro);
    expect(texto).not.toMatch(/almanaque|atracción conjunta|archivo municipal|Nota del|Nota de la/);
    expect(libro.capitulos).toHaveLength(1);
    expect(libro.capitulos[0]!.parrafos).toEqual([
      'Los pescadores del pueblo aseguraban que el mar respiraba dos veces al día. Cada mañana salían con las barcas antes del amanecer, y cada tarde regresaban cargados de sardinas, de redes rotas y de historias increíbles.',
      'Nadie sabía explicar por qué las aguas subían con tanta fuerza en las noches de luna llena, pero todos respetaban la costumbre de no zarpar durante esas horas. ¿Superstición o prudencia? Quizá ambas cosas.',
      'El mapa más antiguo de la bahía, dibujado a mano por un monje, marcaba con una cruz el lugar del naufragio. Nadie volvió a buscar el tesoro, pero la cruz sigue allí, descolorida, entre dos rocas.',
    ]);
    // Ninguna llamada pegada: "día.1", "fuerza2", "naufragio.3".
    expect(texto).not.toMatch(/[\p{L}.]\d/u);
  });
});

describe('libro-columnas.pdf', () => {
  it('lee título, columna izquierda completa y luego la derecha', async () => {
    const libro = await extraerLibro(cargar('libro-columnas.pdf'));
    expect(libro.capitulos).toHaveLength(1);
    expect(libro.capitulos[0]!.titulo).toBe('Crónica de un invierno');
    const ps = libro.capitulos[0]!.parrafos;
    expect(ps).toHaveLength(6);
    expect(ps[0]).toBe(
      'El primer día de invierno amaneció cubierto de escarcha. Los vecinos salieron a la calle con bufandas hasta las orejas y comentaron, entre risas, que nunca habían visto un frío tan puntual.',
    );
    const orden = ['El primer día', 'En la plaza', 'Por la tarde', 'Durante la noche', 'A la mañana siguiente', 'Así transcurrió'];
    expect(ps.map((p) => orden.findIndex((o) => p.startsWith(o)))).toEqual([0, 1, 2, 3, 4, 5]);
    // El párrafo que cruza de la columna izquierda a la derecha queda entero.
    expect(ps.some((p) => p.startsWith('Por la tarde') && p.endsWith('parecían contentos.'))).toBe(true);
    expect(textoDe(libro)).not.toContain('Crónica de un invierno');
  });
});

describe('escaneado.pdf', () => {
  it('se detecta como escaneado y avisa', async () => {
    const libro = await extraerLibro(cargar('escaneado.pdf'));
    expect(libro.escaneado).toBe(true);
    expect(libro.capitulos).toEqual([]);
    expect(libro.numPaginas).toBe(3);
    expect(libro.avisos).toEqual(['Este PDF parece escaneado: no tiene texto seleccionable. Esta versión no puede leerlo (no hay OCR).']);
  });
});

describe('extraerLibro', () => {
  it('informa del progreso página a página y no consume el buffer de entrada', async () => {
    const datos = cargar('libro-simple.pdf');
    const longitud = datos.byteLength;
    const llamadas: Array<[number, number]> = [];
    await extraerLibro(datos, { onProgreso: (a, t) => llamadas.push([a, t]) });
    expect(llamadas).toEqual([
      [1, 5],
      [2, 5],
      [3, 5],
      [4, 5],
      [5, 5],
    ]);
    expect(datos.byteLength).toBe(longitud);
    const otra = await extraerLibro(datos); // se puede reutilizar
    expect(otra.capitulos).toHaveLength(3);
  });
});
