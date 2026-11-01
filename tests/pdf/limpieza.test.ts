import { describe, expect, it } from 'vitest';
import { procesarPaginas } from '../../src/pdf/limpieza.ts';
import type { EntradaIndice, Fragmento, PaginaPdf } from '../../src/pdf/modelo.ts';
import { esNumeroDePagina, normalizarTexto, unirLineas } from '../../src/pdf/texto.ts';

const W = 400;
const H = 600;
const GS = '\u{AD}'; // guion suave

function frag(texto: string, x: number, y: number, tam = 11): Fragmento {
  return { texto, x, y, ancho: texto.length * tam * 0.42, alto: tam, tam, fuente: 'f' };
}

/** Página con líneas de cuerpo a partir de y=100, interlineado 15. */
function pagina(numero: number, lineas: string[], extra: Fragmento[] = [], x = 50): PaginaPdf {
  const fragmentos = lineas.map((l, i) => frag(l, x, 100 + i * 15));
  return { numero, ancho: W, alto: H, fragmentos: [...fragmentos, ...extra] };
}

const textoLargo = (n: number): string => `Esta es la línea de relleno número ${n} con bastante texto para ocupar ancho de columna.`;

describe('procesarPaginas · texto', () => {
  it('une palabras partidas, respeta compuestos y el guion suave', () => {
    const p = pagina(1, [
      textoLargo(1) + ' pala-',
      'bra partida y también otra inter-',
      'nacional. Un viaje Madrid-',
      `Barcelona largo y un ejem${GS}`,
      'plo con guion suave.',
    ]);
    const libro = procesarPaginas([p], []);
    expect(libro.capitulos).toHaveLength(1);
    const texto = libro.capitulos[0]!.parrafos.join(' ');
    expect(texto).toContain('palabra partida');
    expect(texto).toContain('internacional.');
    expect(texto).toContain('Madrid-Barcelona');
    expect(texto).toContain('ejemplo con guion suave.');
  });

  it('separa párrafos por sangría y por espacio vertical', () => {
    const ys = [100, 115, 130, 145, 160, 190, 205];
    const textos = [
      'Primer párrafo con una línea larga que ocupa casi todo el ancho disponible aquí.',
      'continúa aquí en una segunda línea larga que también llega bastante lejos hacia.',
      'la derecha del todo y termina con punto. Fin del primero con muchas palabras aq.',
      'Segundo párrafo con sangría y mucho texto para llegar al borde derecho de verdad.',
      'sigue sin sangría hasta terminar este párrafo corto.',
      'Tercer párrafo separado por un hueco vertical grande entre líneas del libro aquí.',
      'y su continuación hasta el final.',
    ];
    const xs = [65, 50, 50, 65, 50, 50, 50];
    const fr = textos.map((t, i) => frag(t, xs[i]!, ys[i]!));
    const libro = procesarPaginas([{ numero: 1, ancho: W, alto: H, fragmentos: fr }], []);
    const ps = libro.capitulos[0]!.parrafos;
    expect(ps).toHaveLength(3);
    expect(ps[0]).toMatch(/^Primer párrafo .* continúa aquí .* Fin del primero/);
    expect(ps[1]).toMatch(/^Segundo párrafo .* sigue sin sangría hasta terminar este párrafo corto\.$/);
    expect(ps[2]).toMatch(/^Tercer párrafo .* y su continuación hasta el final\.$/);
  });

  it('cierra párrafo cuando la línea acaba en punto y es claramente corta', () => {
    const largas = [0, 1, 2].map((i) => frag(textoLargo(i), 50, 100 + i * 15));
    const corta = frag('Línea corta final.', 50, 145);
    const sig = frag(textoLargo(9), 50, 160);
    const libro = procesarPaginas([{ numero: 1, ancho: W, alto: H, fragmentos: [...largas, corta, sig] }], []);
    expect(libro.capitulos[0]!.parrafos).toHaveLength(2);
  });

  it('normaliza ligaduras, comillas, espacios y caracteres de control', () => {
    expect(normalizarTexto('o\u{FB03}cial \u{FB01}n \u{FB02}or')).toBe('official fin flor');
    expect(normalizarTexto('\u{201C}hola\u{201D} \u{2018}ok\u{2019}')).toBe('"hola" \'ok\'');
    expect(normalizarTexto('a\u{A0}b\u{200B}c\u{7}d')).toBe('a bc d');
    const libro = procesarPaginas(
      [pagina(1, ['El \u{FB01}n del mundo\u{0} \u{201C}dicen\u{201D}\u{A0}todos con texto suficiente aquí y más.'])],
      [],
    );
    expect(libro.capitulos[0]!.parrafos).toEqual(['El fin del mundo "dicen" todos con texto suficiente aquí y más.']);
  });
});

describe('procesarPaginas · márgenes', () => {
  it('descarta cabeceras alternas, pies y números en distintos formatos', () => {
    const formatos = ['— 1 —', '- 2 -', 'Página 3', 'Pág. 4', '5 / 300', 'vi', '7', 'viii'];
    const paginas = formatos.map((f, i) =>
      pagina(i + 1, [textoLargo(i), textoLargo(i + 10)], [
        frag(i % 2 ? 'Título del Libro' : 'Capítulo Primero', 50, 35, 9),
        frag(f, 190, 570, 10),
      ]),
    );
    const libro = procesarPaginas(paginas, []);
    const texto = libro.capitulos.flatMap((c) => c.parrafos).join('\n');
    expect(texto).not.toMatch(/Título del Libro|Capítulo Primero|Página|Pág|300|—/);
    expect(texto.match(/línea de relleno/g)).toHaveLength(16);
  });

  it('conserva un número que está en el cuerpo y no en el margen', () => {
    const p = pagina(1, [textoLargo(1), '1984', textoLargo(2)]);
    const libro = procesarPaginas([p], []);
    expect(libro.capitulos[0]!.parrafos.join(' ')).toContain('1984');
  });
});

describe('procesarPaginas · notas al pie', () => {
  it('quita el bloque de letra pequeña inferior y las llamadas en superíndice', () => {
    const lineas = [
      'Los pescadores del pueblo aseguraban que el mar respiraba dos veces al día. Cada',
      'mañana salían con las barcas antes del amanecer y volvían por la tarde cargados.',
    ];
    const p = pagina(1, lineas, [
      frag('1', 50 + 80 * 11 * 0.42, 96, 7), // llamada elevada al final de la 1.ª línea
      frag('2', 52, 400, 5), // marca de nota (pequeña) en el pie
      frag('Nota: texto de la primera nota al pie que no debe leerse.', 58, 405, 8),
      frag('Segunda nota al pie igualmente fuera.', 58, 415, 8),
    ]);
    const libro = procesarPaginas([p], []);
    const texto = libro.capitulos[0]!.parrafos.join(' ');
    expect(texto).not.toMatch(/Nota|nota al pie/);
    expect(texto).not.toMatch(/\d/);
    expect(texto).toContain('al día. Cada mañana salían');
  });

  it('quita superíndices Unicode pegados a una palabra', () => {
    const libro = procesarPaginas(
      [pagina(1, ['El mar respiraba dos veces al día.\u{B9} Y también el mar\u{B2} seguía respirando bien.'])],
      [],
    );
    expect(libro.capitulos[0]!.parrafos[0]).toBe('El mar respiraba dos veces al día. Y también el mar seguía respirando bien.');
  });
});

describe('procesarPaginas · columnas', () => {
  it('lee la columna izquierda entera antes que la derecha, con el título a toda anchura primero', () => {
    const fr: Fragmento[] = [frag('Un título a toda anchura', 100, 90, 20)];
    for (let i = 0; i < 6; i++) fr.push(frag(`Izquierda ${i} texto de la columna izq.`, 40, 130 + i * 13, 10));
    for (let i = 0; i < 6; i++) fr.push(frag(`Derecha ${i} texto de la columna der.`, 210, 130 + i * 13, 10));
    const libro = procesarPaginas([{ numero: 1, ancho: W, alto: H, fragmentos: fr }], []);
    const texto = libro.capitulos.map((c) => c.parrafos.join(' ')).join(' ');
    const pos = (s: string): number => texto.indexOf(s);
    expect(libro.capitulos[0]!.titulo).toBe('Un título a toda anchura');
    expect(pos('Izquierda 0')).toBeGreaterThanOrEqual(0);
    expect(pos('Izquierda 5')).toBeLessThan(pos('Derecha 0'));
    expect(pos('Izquierda 0')).toBeLessThan(pos('Izquierda 1'));
  });

  it('no confunde una página de una columna con dos', () => {
    const p = pagina(1, Array.from({ length: 10 }, (_, i) => textoLargo(i)));
    const libro = procesarPaginas([p], []);
    const texto = libro.capitulos[0]!.parrafos.join(' ');
    expect(texto.indexOf('número 0 ')).toBeLessThan(texto.indexOf('número 1 '));
    expect(texto.indexOf('número 8 ')).toBeLessThan(texto.indexOf('número 9 '));
  });
});

describe('procesarPaginas · capítulos', () => {
  const dosCapitulos = (): PaginaPdf[] => [
    pagina(1, [textoLargo(1)], [frag('Primera parte', 50, 80, 24)]),
    pagina(2, [textoLargo(2)]),
    pagina(3, [textoLargo(3)], [frag('Segunda parte', 50, 80, 24)]),
  ];

  it('detecta títulos grandes y no los repite como párrafo', () => {
    const libro = procesarPaginas(dosCapitulos(), []);
    expect(libro.origenCapitulos).toBe('titulos');
    expect(libro.capitulos.map((c) => c.titulo)).toEqual(['Primera parte', 'Segunda parte']);
    expect(libro.capitulos[0]!.parrafos).toHaveLength(1);
    expect(libro.capitulos.map((c) => c.paginaInicio)).toEqual([1, 3]);
  });

  it('con índice usa el primer nivel; si solo hay una entrada, el segundo', () => {
    const paginas = dosCapitulos();
    const indice1: EntradaIndice[] = [
      { titulo: 'Uno', pagina: 1, nivel: 0 },
      { titulo: 'Dos', pagina: 3, nivel: 0 },
      { titulo: 'Sub', pagina: 2, nivel: 1 },
    ];
    const l1 = procesarPaginas(paginas, indice1);
    expect(l1.origenCapitulos).toBe('indice');
    expect(l1.capitulos.map((c) => c.titulo)).toEqual(['Uno', 'Dos']);

    const indice2: EntradaIndice[] = [
      { titulo: 'Libro', pagina: 1, nivel: 0 },
      { titulo: 'Cap A', pagina: 1, nivel: 1 },
      { titulo: 'Cap B', pagina: 3, nivel: 1 },
    ];
    const l2 = procesarPaginas(paginas, indice2);
    expect(l2.origenCapitulos).toBe('indice');
    expect(l2.capitulos.map((c) => c.titulo)).toEqual(['Cap A', 'Cap B']);
  });

  it('sin índice ni títulos devuelve un capítulo único', () => {
    const libro = procesarPaginas([pagina(1, [textoLargo(1), textoLargo(2)]), pagina(2, [textoLargo(3)])], [], {
      tituloMetadato: 'Mi libro',
    });
    expect(libro.origenCapitulos).toBe('unico');
    expect(libro.titulo).toBe('Mi libro');
    expect(libro.capitulos).toHaveLength(1);
    expect(libro.capitulos[0]!.id).toBe('c000');
  });

  it('el título sale del primer título detectado y, si no hay, de "Libro sin título"', () => {
    expect(procesarPaginas(dosCapitulos(), []).titulo).toBe('Primera parte');
    expect(procesarPaginas([pagina(1, [textoLargo(1)])], []).titulo).toBe('Libro sin título');
    expect(procesarPaginas([pagina(1, [textoLargo(1)])], [], { tituloMetadato: 'Untitled' }).titulo).toBe('Libro sin título');
  });

  it('el texto previo al primer capítulo va a "Inicio"', () => {
    const paginas = [pagina(1, [textoLargo(0)]), ...dosCapitulos().map((p) => ({ ...p, numero: p.numero + 1 }))];
    const libro = procesarPaginas(paginas, []);
    expect(libro.capitulos.map((c) => c.titulo)).toEqual(['Inicio', 'Primera parte', 'Segunda parte']);
    expect(libro.capitulos.map((c) => c.id)).toEqual(['c000', 'c001', 'c002']);
  });
});

describe('procesarPaginas · escaneado', () => {
  it('detecta PDFs sin texto', () => {
    const vacias: PaginaPdf[] = [1, 2, 3].map((n) => ({ numero: n, ancho: W, alto: H, fragmentos: [] }));
    const libro = procesarPaginas(vacias, []);
    expect(libro.escaneado).toBe(true);
    expect(libro.capitulos).toEqual([]);
    expect(libro.avisos[0]).toMatch(/escaneado/);
  });

  it('un PDF con texto real no se marca como escaneado', () => {
    expect(procesarPaginas([pagina(1, [textoLargo(1)])], []).escaneado).toBe(false);
  });
});

describe('texto', () => {
  it('reconoce formatos de número de página', () => {
    for (const s of ['23', '— 23 —', '- 23 -', 'Página 23', 'Pág. 23', 'pag 23', '23 / 300', 'xiv', 'XIV', '[ 7 ]']) {
      expect(esNumeroDePagina(s), s).toBe(true);
    }
    for (const s of ['Capítulo 1', 'El año 1984 fue', 'Hola', '']) expect(esNumeroDePagina(s), s).toBe(false);
  });

  it('unirLineas', () => {
    expect(unirLineas('una pala-', 'bra')).toBe('una palabra');
    expect(unirLineas('Madrid-', 'Barcelona')).toBe('Madrid-Barcelona');
    expect(unirLineas('hola', 'mundo')).toBe('hola mundo');
    expect(unirLineas(`ejem${GS}`, 'plo')).toBe('ejemplo');
    expect(unirLineas('dijo —', 'adiós')).toBe('dijo — adiós');
  });
});
