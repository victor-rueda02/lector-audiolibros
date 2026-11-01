/**
 * Genera los PDFs de prueba de tests/fixtures con pdfkit.
 * Texto inventado (sin derechos). Las líneas se colocan una a una con
 * `doc.text(linea, x, y, { lineBreak: false })` para que las palabras partidas
 * con guion a final de línea sean deterministas.
 *
 * Uso:  npm run fixtures
 */
import PDFDocument from 'pdfkit';
import { createWriteStream, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR_SALIDA = join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures');

const ANCHO_PAG = 400;
const ALTO_PAG = 600;
const MARGEN_X = 50;
const ANCHO_TEXTO = 300;
const INTERLINEADO = 15;
const SANGRIA = 15;

type Doc = InstanceType<typeof PDFDocument>;

interface Parrafo {
  /** Texto del párrafo. Admite llamadas de nota como "{1}" pegadas a una palabra. */
  t: string;
  /** Primera línea con sangría (por defecto sí). */
  sangria?: boolean;
  /** Espacio vertical extra antes del párrafo. */
  hueco?: boolean;
}

// ───────────────────────── Utilidades de texto ─────────────────────────

const VOCAL = /[aeiouáéíóúü]/i;

/** Posiciones donde se puede cortar una palabra (límite de sílaba aproximado V-CV). */
function puntosGuion(palabra: string): number[] {
  const res: number[] = [];
  for (let i = 3; i <= palabra.length - 3; i++) {
    if (VOCAL.test(palabra[i - 1]!) && !VOCAL.test(palabra[i]!) && VOCAL.test(palabra[i + 1]!)) res.push(i);
  }
  return res;
}

function aRomano(n: number): string {
  const tabla: Array<[number, string]> = [[10, 'x'], [9, 'ix'], [5, 'v'], [4, 'iv'], [1, 'i']];
  let r = '';
  for (const [v, s] of tabla) {
    while (n >= v) {
      r += s;
      n -= v;
    }
  }
  return r;
}

/** Ancho de una línea con posibles llamadas "{n}" (que se dibujan pequeñas). */
function anchoLinea(doc: Doc, linea: string, tam: number): number {
  let total = 0;
  for (const [i, parte] of linea.split(/\{(\d+)\}/).entries()) {
    total += doc.fontSize(i % 2 === 0 ? tam : tam * 0.65).widthOfString(parte);
  }
  return total;
}

/** Reparte un párrafo en líneas, cortando palabras con guion cuando hace falta. */
function envolver(doc: Doc, texto: string, ancho: number, anchoPrimera: number, tam: number): string[] {
  const lineas: string[] = [];
  let actual = '';
  let limite = anchoPrimera;
  const cerrar = (l: string): void => {
    lineas.push(l);
    limite = ancho;
  };
  for (const tok of texto.split(' ')) {
    const cand = actual ? `${actual} ${tok}` : tok;
    if (anchoLinea(doc, cand, tam) <= limite) {
      actual = cand;
      continue;
    }
    const m = /^(\p{L}+)([^\p{L}{]*)$/u.exec(tok);
    let partida = false;
    if (m && actual) {
      const pal = m[1]!;
      const resto = m[2]!;
      for (const i of puntosGuion(pal).reverse()) {
        if (anchoLinea(doc, `${actual} ${pal.slice(0, i)}-`, tam) <= limite) {
          cerrar(`${actual} ${pal.slice(0, i)}-`);
          actual = pal.slice(i) + resto;
          partida = true;
          break;
        }
      }
    }
    if (!partida) {
      if (actual) cerrar(actual);
      actual = tok;
    }
  }
  if (actual) lineas.push(actual);
  return lineas;
}

/** Dibuja una línea; las llamadas "{n}" salen como superíndice. */
function dibujarLinea(doc: Doc, linea: string, x: number, y: number, tam: number): void {
  let cx = x;
  for (const [i, parte] of linea.split(/\{(\d+)\}/).entries()) {
    if (parte === '') continue;
    if (i % 2 === 0) {
      doc.fontSize(tam).text(parte, cx, y, { lineBreak: false });
    } else {
      doc.fontSize(tam * 0.65).text(parte, cx, y - tam * 0.4, { lineBreak: false });
    }
    cx += doc.widthOfString(parte);
  }
}

// ───────────────────────── Maquetador de libro ─────────────────────────

interface OpcionesLibro {
  archivo: string;
  titulo?: string;
  conIndice?: boolean;
  portada?: boolean;
  capitulos: Array<{ titulo: string; parrafos: Parrafo[] }>;
}

const CABECERAS = ['El faro de las nieblas', 'Ana Ruiz'];
const FORMATOS_PIE: Array<(n: number) => string> = [
  (n) => `— ${n} —`,
  (n) => `- ${n} -`,
  (n) => `Página ${n}`,
  (n) => `Pág. ${n}`,
  (n) => `${n} / 99`,
  (n) => aRomano(n),
];

function nuevoDoc(archivo: string, titulo?: string): { doc: Doc; fin: Promise<void> } {
  mkdirSync(DIR_SALIDA, { recursive: true });
  const doc = new PDFDocument({
    size: [ANCHO_PAG, ALTO_PAG],
    margin: 0,
    autoFirstPage: false,
    info: titulo ? { Title: titulo, Author: 'Ana Ruiz' } : {},
  });
  const flujo = createWriteStream(join(DIR_SALIDA, archivo));
  doc.pipe(flujo);
  const fin = new Promise<void>((ok, ko) => {
    flujo.on('finish', () => ok());
    flujo.on('error', ko);
  });
  return { doc, fin };
}

function cabeceraYPie(doc: Doc, n: number, cabeceras: string[] = CABECERAS): void {
  const cab = cabeceras[n % cabeceras.length]!;
  doc.font('Times-Italic').fontSize(9);
  const x = n % 2 === 0 ? MARGEN_X : MARGEN_X + ANCHO_TEXTO - doc.widthOfString(cab);
  doc.text(cab, x, 30, { lineBreak: false });
  const pie = FORMATOS_PIE[n % FORMATOS_PIE.length]!(n);
  doc.font('Times-Roman').fontSize(10);
  doc.text(pie, (ANCHO_PAG - doc.widthOfString(pie)) / 2, 565, { lineBreak: false });
}

async function generarLibro(op: OpcionesLibro): Promise<void> {
  const { doc, fin } = nuevoDoc(op.archivo, op.titulo);
  const MAX_LINEAS = 10;
  let numPag = 0;
  let lineasEnPag = 0;
  let y = 0;

  const nuevaPagina = (): void => {
    doc.addPage();
    numPag++;
    cabeceraYPie(doc, numPag);
    lineasEnPag = 0;
    y = 90;
  };

  if (op.portada) {
    doc.addPage();
    numPag++;
    doc.font('Times-Bold').fontSize(26);
    doc.text('El faro de las nieblas', MARGEN_X, 200, { lineBreak: false });
    doc.font('Times-Roman').fontSize(14).text('Ana Ruiz', MARGEN_X, 250, { lineBreak: false });
    doc.font('Times-Roman').fontSize(11);
    doc.text('Edición de prueba con texto inventado.', MARGEN_X + 15, 400, { lineBreak: false });
    doc.text('Sin derechos de autor; solo para pruebas automáticas.', MARGEN_X, 415, { lineBreak: false });
  }

  for (const cap of op.capitulos) {
    nuevaPagina();
    if (op.conIndice) doc.outline.addItem(cap.titulo);
    doc.font('Helvetica-Bold').fontSize(22).text(cap.titulo, MARGEN_X, 95, { lineBreak: false });
    y = 150;
    for (const p of cap.parrafos) {
      const sangria = p.sangria !== false;
      if (p.hueco && lineasEnPag > 0) y += 9;
      const lineas = envolver(doc.font('Times-Roman'), p.t, ANCHO_TEXTO, ANCHO_TEXTO - (sangria ? SANGRIA : 0), 11);
      lineas.forEach((l, i) => {
        if (lineasEnPag >= MAX_LINEAS) nuevaPagina();
        doc.font('Times-Roman');
        dibujarLinea(doc, l, MARGEN_X + (i === 0 && sangria ? SANGRIA : 0), y, 11);
        y += INTERLINEADO;
        lineasEnPag++;
      });
    }
  }
  doc.end();
  await fin;
}

// ───────────────────────── Contenido inventado ─────────────────────────

const CAPITULOS: Array<{ titulo: string; parrafos: Parrafo[] }> = [
  {
    titulo: 'Capítulo 1. La llegada',
    parrafos: [
      { t: 'La mañana era fría y el viento soplaba con una fuerza inusual sobre los acantilados del norte. Marta bajó del autobús con una maleta desgastada y miró el horizonte: allí, entre la niebla, se adivinaba la silueta del faro.' },
      { t: '—¿Es usted la nueva ayudante? —preguntó un hombre de barba blanca—. ¡Llega justo a tiempo! La marea sube deprisa y todavía queda mucho por hacer antes del anochecer.' },
      { t: 'El guardián se llamaba Anselmo y llevaba cuarenta años cuidando de la luz. Conocía cada piedra, cada escalón y cada rincón de aquella torre que, según decía, tenía más recuerdos que ladrillos.', sangria: false, hueco: true },
      { t: 'Subieron juntos por la escalera de caracol, que crujía bajo sus pasos como un barco viejo. Arriba, la gran lámpara dormía detrás de un cristal cubierto de sal, esperando la noche para despertar.' },
    ],
  },
  {
    titulo: 'Capítulo 2. El guardián',
    parrafos: [
      { t: 'Anselmo preparó café en una cocina diminuta, con olor a madera mojada y a pescado seco. Hablaba despacio, como quien ha pasado demasiado tiempo escuchando al mar y poco conversando con la gente.' },
      { t: 'Le explicó a Marta las reglas de la torre: encender la lámpara al ponerse el sol, anotar el estado del tiempo y no subir nunca al balcón durante las tormentas fuertes. ¿Podría recordarlo todo? Marta asintió, aunque sentía un nudo en el estómago.' },
      { t: 'Aquella noche, mientras la lámpara giraba sobre el agua, escribió una carta a su hermana. Le contó que el trabajo era duro, que el viento no dejaba dormir y que, a pesar de todo, se sentía en casa por primera vez en años.' },
    ],
  },
  {
    titulo: 'Capítulo 3. La tormenta',
    parrafos: [
      { t: 'La tormenta llegó una semana después, sin avisar. El cielo se volvió negro en cuestión de minutos y las olas empezaron a golpear la base del faro con un estruendo que hacía vibrar los cristales.' },
      { t: '—¡Hay que mantener la luz encendida! —gritó Anselmo—. Si un solo barco se pierde esta noche, nunca me lo perdonaré. Marta corrió escaleras arriba con el corazón desbocado.' },
      { t: 'Al amanecer, el mar se calmó y el sol iluminó una playa cubierta de algas. En el horizonte, un pequeño pesquero regresaba despacio al puerto. Anselmo sonrió por primera vez, y Marta comprendió por qué aquel lugar merecía tanto esfuerzo.' },
    ],
  },
];

// ───────────────────────── Libro con notas al pie ─────────────────────────

async function generarNotas(): Promise<void> {
  const { doc, fin } = nuevoDoc('libro-notas.pdf', 'Sobre las mareas');
  const pintarPagina = (n: number, parrafos: Parrafo[], notas: Array<[string, string]>, conTitulo: boolean): void => {
    doc.addPage();
    cabeceraYPie(doc, n, ['Ana Ruiz']);
    let y = 90;
    if (conTitulo) {
      doc.font('Helvetica-Bold').fontSize(22).text('Sobre las mareas', MARGEN_X, 95, { lineBreak: false });
      y = 150;
    }
    for (const p of parrafos) {
      const lineas = envolver(doc.font('Times-Roman'), p.t, ANCHO_TEXTO, ANCHO_TEXTO - SANGRIA, 11);
      lineas.forEach((l, i) => {
        doc.font('Times-Roman');
        dibujarLinea(doc, l, MARGEN_X + (i === 0 ? SANGRIA : 0), y, 11);
        y += INTERLINEADO;
      });
    }
    // Separador y notas en letra pequeña (8 pt frente a 11 pt del cuerpo).
    let yn = 478;
    doc.moveTo(MARGEN_X, yn).lineTo(MARGEN_X + 100, yn).lineWidth(0.5).stroke();
    yn += 8;
    for (const [marca, texto] of notas) {
      doc.font('Times-Roman').fontSize(5.5).text(marca, MARGEN_X, yn - 3, { lineBreak: false });
      const lineas = envolver(doc, texto, ANCHO_TEXTO - 8, ANCHO_TEXTO - 8, 8);
      for (const l of lineas) {
        doc.font('Times-Roman').fontSize(8).text(l, MARGEN_X + 8, yn, { lineBreak: false });
        yn += 10;
      }
    }
  };
  pintarPagina(
    1,
    [
      { t: 'Los pescadores del pueblo aseguraban que el mar respiraba dos veces al día.{1} Cada mañana salían con las barcas antes del amanecer, y cada tarde regresaban cargados de sardinas, de redes rotas y de historias increíbles.' },
      { t: 'Nadie sabía explicar por qué las aguas subían con tanta fuerza{2} en las noches de luna llena, pero todos respetaban la costumbre de no zarpar durante esas horas. ¿Superstición o prudencia? Quizá ambas cosas.' },
    ],
    [
      ['1', 'Nota de la edición: la expresión procede de un refrán popular recogido en el almanaque de 1923.'],
      ['2', 'Nota del autor: el fenómeno se explica por la atracción conjunta del Sol y de la Luna.'],
    ],
    true,
  );
  pintarPagina(
    2,
    [
      { t: 'El mapa más antiguo de la bahía, dibujado a mano por un monje, marcaba con una cruz el lugar del naufragio.{3} Nadie volvió a buscar el tesoro, pero la cruz sigue allí, descolorida, entre dos rocas.' },
    ],
    [['3', 'Nota del editor: este mapa se conserva en el archivo municipal.']],
    false,
  );
  doc.end();
  await fin;
}

// ───────────────────────── Libro a dos columnas ─────────────────────────

async function generarColumnas(): Promise<void> {
  const { doc, fin } = nuevoDoc('libro-columnas.pdf', 'Crónica de un invierno');
  const COL_X = [40, 210];
  const COL_ANCHO = 150;
  const MAX = 12;
  const PARRAFOS = [
    'El primer día de invierno amaneció cubierto de escarcha. Los vecinos salieron a la calle con bufandas hasta las orejas y comentaron, entre risas, que nunca habían visto un frío tan puntual.',
    'En la plaza, el viejo reloj se detuvo a las nueve y diez. Nadie supo explicar por qué, pero el relojero aseguró que bastaba un poco de aceite y mucha paciencia para devolverle la vida.',
    'Por la tarde empezó a nevar. Los niños construyeron un muñeco enorme junto a la fuente y le pusieron una zanahoria por nariz. ¡Qué alegría tan sencilla! Hasta los perros parecían contentos.',
    'Durante la noche el viento cambió de dirección y las nubes se abrieron. Quedó un cielo limpio, lleno de estrellas, que dejaba ver hasta la última luz de las casas más lejanas del valle.',
    'A la mañana siguiente, el muñeco había perdido la nariz y ganado un sombrero. Nadie confesó la travesura, aunque más de uno sonreía de manera sospechosa al pasar por delante de la fuente.',
    'Así transcurrió aquel invierno: entre nieves, relojes parados y pequeñas travesuras. Con el tiempo, los vecinos recordarían esos días como los más felices de todo el año.',
  ];
  doc.font('Times-Roman');
  const todas: Array<{ l: string; primera: boolean }> = [];
  for (const p of PARRAFOS) {
    envolver(doc, p, COL_ANCHO, COL_ANCHO - 12, 10).forEach((l, i) => todas.push({ l, primera: i === 0 }));
  }
  let idx = 0;
  let pag = 0;
  while (idx < todas.length) {
    doc.addPage();
    pag++;
    cabeceraYPie(doc, pag, ['Crónica de un invierno']);
    let yIni = 90;
    if (pag === 1) {
      const t = 'Crónica de un invierno';
      doc.font('Helvetica-Bold').fontSize(20);
      doc.text(t, (ANCHO_PAG - doc.widthOfString(t)) / 2, 80, { lineBreak: false });
      yIni = 130;
    }
    for (const cx of COL_X) {
      let y = yIni;
      for (let k = 0; k < MAX && idx < todas.length; k++, idx++) {
        const { l, primera } = todas[idx]!;
        doc.font('Times-Roman');
        dibujarLinea(doc, l, cx + (primera ? 12 : 0), y, 10);
        y += 13;
      }
    }
  }
  doc.end();
  await fin;
}

// ───────────────────────── PDF escaneado ─────────────────────────

async function generarEscaneado(): Promise<void> {
  const { doc, fin } = nuevoDoc('escaneado.pdf');
  for (let i = 0; i < 3; i++) {
    doc.addPage();
    doc.rect(40, 40, 320, 520).fill('#e8e0d0');
    for (let k = 0; k < 20; k++) doc.rect(60, 80 + k * 20, 200 + ((k * 37) % 90), 8).fill('#444444');
  }
  doc.end();
  await fin;
}

// ───────────────────────── Principal ─────────────────────────

await generarLibro({ archivo: 'libro-simple.pdf', capitulos: CAPITULOS });
await generarLibro({ archivo: 'libro-indice.pdf', titulo: 'El faro de las nieblas', conIndice: true, portada: true, capitulos: CAPITULOS });
await generarNotas();
await generarColumnas();
await generarEscaneado();
console.log('Fixtures generados en', DIR_SALIDA);
