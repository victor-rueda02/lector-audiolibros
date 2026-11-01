/**
 * Limpieza PURA (sin pdf.js ni DOM): de páginas con fragmentos de texto a un Libro
 * con capítulos y párrafos listos para leer en voz alta.
 *
 * Pasos: tamaño de cuerpo → llamadas de nota → líneas → cabeceras/pies/números de
 * página → notas al pie → columnas y orden de lectura → capítulos → párrafos.
 */
import type { Capitulo, Libro } from '../tipos.ts';
import type { EntradaIndice, Fragmento, OpcionesProcesado, PaginaPdf } from './modelo.ts';
import {
  claveCabecera,
  colapsarEspacios,
  claveComparable,
  esNumeroDePagina,
  limpiarEspacios,
  normalizarTexto,
  terminaEnFrase,
  unirLineas,
} from './texto.ts';

// ───────────────────────── Constantes ─────────────────────────

/** Fracción del alto de página que cuenta como margen superior/inferior. */
const FRANJA_MARGEN = 0.1;
/** Una letra es "pequeña" (nota al pie, llamada) por debajo de esta fracción del cuerpo. */
const FACTOR_PEQUENO = 0.88;
/** Una letra es "de título" por encima de esta fracción del cuerpo. */
const FACTOR_TITULO = 1.25;
/** Caracteres por página por debajo de los cuales el PDF se considera escaneado. */
const MIN_CARACTERES_POR_PAGINA = 20;

export const AVISO_ESCANEADO =
  'Este PDF parece escaneado: no tiene texto seleccionable. Esta versión no puede leerlo (no hay OCR).';

// ───────────────────────── Tipos internos ─────────────────────────

interface Segmento {
  texto: string;
  x0: number;
  x1: number;
  y: number;
  tam: number;
  fila: number;
}

type Zona = 'U' | 'L' | 'R' | 'C';

interface Linea {
  texto: string;
  x0: number;
  x1: number;
  y: number;
  tam: number;
  pagina: number;
  zona: Zona;
  fila: number;
}

interface Corte {
  titulo: string;
  pagina: number;
  inicioTitulo: number;
  inicioContenido: number;
}

// ───────────────────────── Estadística ─────────────────────────

function mediana(v: number[]): number {
  if (v.length === 0) return 0;
  const o = [...v].sort((a, b) => a - b);
  const m = o.length >> 1;
  return o.length % 2 ? o[m]! : (o[m - 1]! + o[m]!) / 2;
}

function percentil(v: number[], p: number): number {
  const o = [...v].sort((a, b) => a - b);
  return o[Math.min(o.length - 1, Math.floor(p * o.length))]!;
}

/** Moda de valores redondeados a `paso`; en empate, el menor. */
function moda(v: number[], paso: number): number {
  const cuenta = new Map<number, number>();
  for (const x of v) {
    const k = Math.round(x / paso) * paso;
    cuenta.set(k, (cuenta.get(k) ?? 0) + 1);
  }
  let mejor = v[0] ?? 0;
  let n = -1;
  for (const [k, c] of cuenta) {
    if (c > n || (c === n && k < mejor)) {
      mejor = k;
      n = c;
    }
  }
  return mejor;
}

// ───────────────────────── Tamaño de cuerpo ─────────────────────────

function caracteres(s: string): number {
  return s.replace(/\s/g, '').length;
}

/** Moda de los tamaños de letra ponderada por número de caracteres. */
export function calcularTamCuerpo(paginas: PaginaPdf[]): number {
  const cuenta = new Map<number, number>();
  for (const p of paginas) {
    for (const f of p.fragmentos) {
      const n = caracteres(f.texto);
      if (n === 0 || !(f.tam > 0)) continue;
      const k = Math.round(f.tam * 2) / 2;
      cuenta.set(k, (cuenta.get(k) ?? 0) + n);
    }
  }
  let mejor = 12;
  let max = 0;
  for (const [k, c] of cuenta) {
    if (c > max || (c === max && k > mejor)) {
      mejor = k;
      max = c;
    }
  }
  return mejor;
}

// ───────────────────────── Fragmentos → segmentos ─────────────────────────

const RE_LLAMADA = /^\s*(?:[\d*†‡§#]{1,3}|\(?\d{1,3}\)?|[⁰¹²³⁴⁵⁶⁷⁸⁹]+)\s*$/;

/** Quita las llamadas de nota: números/símbolos pequeños y elevados pegados a un fragmento de cuerpo. */
function quitarLlamadas(frags: Fragmento[], cuerpo: number): Fragmento[] {
  const normales = frags.filter((f) => f.tam >= cuerpo * FACTOR_PEQUENO && !RE_LLAMADA.test(f.texto));
  return frags.filter((f) => {
    if (f.tam >= cuerpo * FACTOR_PEQUENO || !RE_LLAMADA.test(f.texto)) return true;
    const esLlamada = normales.some((g) => {
      const elevacion = g.y - f.y;
      return (
        f.tam < g.tam * 0.85 &&
        elevacion > 0.12 * g.tam &&
        elevacion < 1.0 * g.tam &&
        f.x >= g.x - 1 &&
        f.x <= g.x + g.ancho + 0.6 * g.tam
      );
    });
    return !esLlamada;
  });
}

function unirFragmentos(a: string, aFinX: number, b: Fragmento, tam: number): string {
  if (/\s$/.test(a) || /^\s/.test(b.texto)) return a + b.texto;
  return b.x - aFinX > 0.12 * tam ? `${a} ${b.texto}` : a + b.texto;
}

/** Agrupa fragmentos en filas (misma línea base) y las parte en segmentos por huecos grandes. */
function segmentarPagina(frags: Fragmento[], cuerpo: number): Segmento[] {
  const ord = [...frags].sort((a, b) => a.y - b.y || a.x - b.x);
  const filas: Fragmento[][] = [];
  let ultY = -Infinity;
  const tol = 0.4 * cuerpo;
  for (const f of ord) {
    if (filas.length === 0 || f.y - ultY > tol) filas.push([f]);
    else filas[filas.length - 1]!.push(f);
    ultY = f.y;
  }
  const segs: Segmento[] = [];
  filas.forEach((fila, idFila) => {
    fila.sort((a, b) => a.x - b.x);
    let actual: (Segmento & { mejor: number }) | null = null;
    for (const f of fila) {
      const n = caracteres(f.texto);
      if (actual && f.x - actual.x1 <= 0.9 * Math.max(f.tam, actual.tam)) {
        actual.texto = unirFragmentos(actual.texto, actual.x1, f, actual.tam);
        actual.x1 = Math.max(actual.x1, f.x + f.ancho);
        if (n > actual.mejor) {
          actual.mejor = n;
          actual.y = f.y;
          actual.tam = f.tam;
        }
      } else {
        if (actual) segs.push(actual);
        actual = { texto: f.texto, x0: f.x, x1: f.x + f.ancho, y: f.y, tam: f.tam, fila: idFila, mejor: n };
      }
    }
    if (actual) segs.push(actual);
  });
  return segs
    .map(({ texto, x0, x1, y, tam, fila }) => ({ texto: colapsarEspacios(texto), x0, x1, y, tam, fila }))
    .filter((s) => s.texto.length > 0);
}

// ───────────────────────── Márgenes: cabeceras, pies, números ─────────────────────────

function enMargen(s: Segmento, alto: number): boolean {
  return s.y < alto * FRANJA_MARGEN || s.y > alto * (1 - FRANJA_MARGEN);
}

/** Quita cabeceras/pies repetidos y números de página sueltos de los márgenes. */
function quitarMargenes(paginas: PaginaPdf[], segs: Segmento[][], cuerpo: number): Segmento[][] {
  const n = paginas.length;
  // Con cabeceras alternas cada variante aparece en ~la mitad de las páginas.
  const minRepeticiones = Math.max(2, Math.min(3, Math.ceil(n * 0.3)));
  const paginasPorClave = new Map<string, Set<number>>();
  segs.forEach((lista, i) => {
    const alto = paginas[i]!.alto;
    for (const s of lista) {
      if (!enMargen(s, alto) || s.tam > cuerpo * FACTOR_TITULO) continue;
      const k = claveCabecera(s.texto);
      if (!k) continue;
      let set = paginasPorClave.get(k);
      if (!set) paginasPorClave.set(k, (set = new Set()));
      set.add(i);
    }
  });
  const repetidas = new Set<string>();
  for (const [k, set] of paginasPorClave) if (set.size >= minRepeticiones) repetidas.add(k);

  return segs.map((lista, i) => {
    const alto = paginas[i]!.alto;
    return lista.filter((s) => {
      if (!enMargen(s, alto)) return true;
      if (esNumeroDePagina(s.texto)) return false;
      const k = claveCabecera(s.texto);
      if (!k) return false; // solo dígitos/símbolos/romanos en el margen
      return !(repetidas.has(k) && s.tam <= cuerpo * FACTOR_TITULO);
    });
  });
}

// ───────────────────────── Notas al pie ─────────────────────────

/** Quita el bloque de letra pequeña situado por debajo de todo el texto de cuerpo. */
function quitarNotasAlPie(lista: Segmento[], cuerpo: number, alto: number): Segmento[] {
  const grandes = lista.filter((s) => s.tam >= cuerpo * FACTOR_PEQUENO && !enMargen(s, alto));
  if (grandes.length === 0) return lista;
  const ultimaY = Math.max(...grandes.map((s) => s.y));
  return lista.filter((s) => s.tam >= cuerpo * FACTOR_PEQUENO || s.y <= ultimaY);
}

// ───────────────────────── Columnas y orden de lectura ─────────────────────────

/** Devuelve la x del canal central si la página tiene dos columnas, o null. */
function detectarCanal(lista: Segmento[], ancho: number, cuerpo: number): number | null {
  const estrechos = lista.filter((s) => s.x1 - s.x0 < 0.55 * ancho && s.tam <= cuerpo * 1.2);
  if (estrechos.length < 8) return null;
  const cubierto = new Uint8Array(Math.ceil(ancho) + 2);
  for (const s of estrechos) {
    for (let x = Math.max(0, Math.floor(s.x0)); x <= Math.ceil(s.x1) && x < cubierto.length; x++) cubierto[x] = 1;
  }
  const desde = Math.floor(ancho * 0.3);
  const hasta = Math.ceil(ancho * 0.7);
  let mejorIni = -1;
  let mejorLen = 0;
  let ini = -1;
  for (let x = desde; x <= hasta + 1; x++) {
    const libre = x <= hasta && cubierto[x] === 0;
    if (libre && ini < 0) ini = x;
    if (!libre && ini >= 0) {
      if (x - ini > mejorLen) {
        mejorLen = x - ini;
        mejorIni = ini;
      }
      ini = -1;
    }
  }
  if (mejorLen < Math.max(8, 0.025 * ancho)) return null;
  const xc = mejorIni + mejorLen / 2;
  const izq = lista.filter((s) => s.x1 <= xc);
  const der = lista.filter((s) => s.x0 >= xc);
  const cruzan = lista.length - izq.length - der.length;
  if (izq.length < 4 || der.length < 4 || cruzan > 0.15 * lista.length) return null;
  // La columna derecha debe empezar alineada.
  const modaX = moda(der.map((s) => s.x0), 4);
  const alineadas = der.filter((s) => Math.abs(s.x0 - modaX) <= 5).length;
  if (alineadas < 0.5 * der.length) return null;
  return xc;
}

/** Ordena los segmentos de una página en orden de lectura y los convierte en líneas. */
function ordenarPagina(lista: Segmento[], pagina: PaginaPdf, cuerpo: number): Linea[] {
  const xc = detectarCanal(lista, pagina.ancho, cuerpo);
  const marcados = lista.map((s) => {
    let zona: Zona = 'U';
    if (xc !== null) zona = s.x1 <= xc ? 'L' : s.x0 >= xc ? 'R' : 'C';
    return { s, zona };
  });
  marcados.sort((a, b) => a.s.fila - b.s.fila || a.s.x0 - b.s.x0);

  let ordenados: typeof marcados = marcados;
  if (xc !== null) {
    ordenados = [];
    let izq: typeof marcados = [];
    let der: typeof marcados = [];
    const volcar = (): void => {
      ordenados.push(...izq, ...der);
      izq = [];
      der = [];
    };
    for (const m of marcados) {
      if (m.zona === 'C') {
        volcar();
        ordenados.push(m);
      } else if (m.zona === 'L') izq.push(m);
      else der.push(m);
    }
    volcar();
  }

  const lineas: Linea[] = [];
  for (const { s, zona } of ordenados) {
    const ult = lineas[lineas.length - 1];
    if (ult && ult.fila === s.fila && ult.zona === zona && ult.pagina === pagina.numero) {
      ult.texto = `${ult.texto} ${s.texto}`;
      ult.x1 = Math.max(ult.x1, s.x1);
    } else {
      lineas.push({ texto: s.texto, x0: s.x0, x1: s.x1, y: s.y, tam: s.tam, pagina: pagina.numero, zona, fila: s.fila });
    }
  }
  return lineas;
}

// ───────────────────────── Títulos ─────────────────────────

function esTitulo(l: Linea, cuerpo: number): boolean {
  const letras = (l.texto.match(/\p{L}/gu) ?? []).length;
  return l.tam >= Math.max(cuerpo * FACTOR_TITULO, cuerpo + 2) && letras >= 2 && l.texto.length <= 140;
}

interface GrupoTitulo {
  ini: number;
  fin: number;
  texto: string;
  pagina: number;
}

/** Líneas grandes consecutivas (misma página) forman un único título. */
function detectarTitulos(lineas: Linea[], cuerpo: number): GrupoTitulo[] {
  const grupos: GrupoTitulo[] = [];
  let i = 0;
  while (i < lineas.length) {
    if (!esTitulo(lineas[i]!, cuerpo)) {
      i++;
      continue;
    }
    let j = i;
    let texto = lineas[i]!.texto;
    while (
      j + 1 < lineas.length &&
      esTitulo(lineas[j + 1]!, cuerpo) &&
      lineas[j + 1]!.pagina === lineas[i]!.pagina &&
      lineas[j + 1]!.y - lineas[j]!.y < 2.2 * Math.max(lineas[j]!.tam, lineas[j + 1]!.tam)
    ) {
      j++;
      texto = unirLineas(texto, lineas[j]!.texto);
    }
    grupos.push({ ini: i, fin: j, texto: limpiarEspacios(texto), pagina: lineas[i]!.pagina });
    i = j + 1;
  }
  return grupos;
}

// ───────────────────────── Capítulos ─────────────────────────

function elegirEntradasIndice(indice: EntradaIndice[], numPaginas: number): EntradaIndice[] {
  const validas = indice.filter((e) => e.pagina >= 1 && e.pagina <= numPaginas && e.titulo.trim() !== '');
  if (validas.length === 0) return [];
  const nivelMin = Math.min(...validas.map((e) => e.nivel));
  const primero = validas.filter((e) => e.nivel === nivelMin);
  if (primero.length === 1) {
    const segundo = validas.filter((e) => e.nivel === nivelMin + 1);
    if (segundo.length >= 2) return segundo;
  }
  return primero;
}

function cortesPorIndice(entradas: EntradaIndice[], lineas: Linea[], cuerpo: number): Corte[] {
  const ordenadas = entradas
    .map((e, i) => ({ e, i }))
    .sort((a, b) => a.e.pagina - b.e.pagina || a.i - b.i)
    .map((x) => x.e);
  const cortes: Corte[] = [];
  for (const e of ordenadas) {
    const titulo = limpiarEspacios(normalizarTexto(e.titulo));
    const clave = claveComparable(titulo);
    let inicio = lineas.findIndex((l) => l.pagina >= e.pagina);
    if (inicio < 0) continue;
    const pag = lineas[inicio]!.pagina;
    for (let k = inicio; k < lineas.length && lineas[k]!.pagina === pag; k++) {
      const kl = claveComparable(lineas[k]!.texto);
      if (!kl) continue;
      const grande = esTitulo(lineas[k]!, cuerpo);
      if (kl === clave || (grande && kl.length >= 3 && (clave.startsWith(kl) || clave.endsWith(kl) || kl.startsWith(clave)))) {
        inicio = k;
        break;
      }
    }
    const previo = cortes[cortes.length - 1];
    if (previo && inicio <= previo.inicioTitulo) continue;
    // Saltar las líneas del título que el PDF repite al comienzo del capítulo.
    let k = inicio;
    while (k < lineas.length && k - inicio < 4 && lineas[k]!.pagina === lineas[inicio]!.pagina) {
      const kl = claveComparable(lineas[k]!.texto);
      const parteDelTitulo = kl.length >= 3 && clave.includes(kl);
      if (!(esTitulo(lineas[k]!, cuerpo) || parteDelTitulo)) break;
      k++;
    }
    cortes.push({ titulo: titulo || `Capítulo ${cortes.length + 1}`, pagina: e.pagina, inicioTitulo: inicio, inicioContenido: k });
  }
  return cortes;
}

function cortesPorTitulos(grupos: GrupoTitulo[]): Corte[] {
  return grupos.map((g) => ({ titulo: g.texto, pagina: g.pagina, inicioTitulo: g.ini, inicioContenido: g.fin + 1 }));
}

// ───────────────────────── Párrafos ─────────────────────────

interface Bordes {
  izq: number;
  der: number;
}

function calcularBordes(lineas: Linea[], cuerpo: number): Map<string, Bordes> {
  const bordes = new Map<string, Bordes>();
  const ultimo = new Map<Zona, Bordes>();
  const porClave = new Map<string, Linea[]>();
  const orden: string[] = [];
  for (const l of lineas) {
    const k = `${l.pagina}|${l.zona}`;
    if (!porClave.has(k)) {
      porClave.set(k, []);
      orden.push(k);
    }
    if (l.tam >= cuerpo * FACTOR_PEQUENO && l.tam <= cuerpo * 1.15) porClave.get(k)!.push(l);
  }
  for (const k of orden) {
    const ls = porClave.get(k)!;
    const zona = k.split('|')[1] as Zona;
    let b: Bordes | undefined;
    if (ls.length >= 4) {
      b = { izq: moda(ls.map((l) => l.x0), 2), der: percentil(ls.map((l) => l.x1), 0.9) };
    } else if (ultimo.has(zona)) {
      b = ultimo.get(zona);
    } else if (ls.length > 0) {
      b = { izq: Math.min(...ls.map((l) => l.x0)), der: Math.max(...ls.map((l) => l.x1)) };
    }
    if (b) {
      bordes.set(k, b);
      if (ls.length >= 4) ultimo.set(zona, b);
    }
  }
  return bordes;
}

function interlineadoNormal(lineas: Linea[], cuerpo: number): number {
  const dys: number[] = [];
  for (let i = 1; i < lineas.length; i++) {
    const a = lineas[i - 1]!;
    const b = lineas[i]!;
    if (a.pagina !== b.pagina || a.zona !== b.zona || Math.abs(a.tam - b.tam) > 0.1 * cuerpo) continue;
    const dy = b.y - a.y;
    if (dy > 0 && dy < 1.8 * cuerpo) dys.push(dy);
  }
  return dys.length ? mediana(dys) : 1.2 * cuerpo;
}

interface ContextoParrafos {
  cuerpo: number;
  interlineado: number;
  bordes: Map<string, Bordes>;
}

function bordesDe(l: Linea, ctx: ContextoParrafos): Bordes {
  return ctx.bordes.get(`${l.pagina}|${l.zona}`) ?? { izq: l.x0, der: l.x1 };
}

function empiezaParrafo(prev: Linea | null, l: Linea, ctx: ContextoParrafos): boolean {
  if (!prev) return true;
  if (Math.abs(l.tam - prev.tam) > 0.15 * ctx.cuerpo) return true;
  if (l.zona === 'C' || prev.zona === 'C') return !(l.zona === prev.zona && l.pagina === prev.pagina && l.y - prev.y < 1.35 * ctx.interlineado);
  const bl = bordesDe(l, ctx);
  if (l.x0 - bl.izq > 0.7 * ctx.cuerpo) return true; // sangría
  const mismoBloque = prev.pagina === l.pagina && prev.zona === l.zona;
  if (mismoBloque && l.y - prev.y > 1.35 * ctx.interlineado) return true; // espacio vertical
  const bp = bordesDe(prev, ctx);
  const ancho = bp.der - bp.izq;
  // Línea anterior que cierra frase y queda claramente corta.
  return terminaEnFrase(prev.texto) && prev.x1 < bp.der - 0.2 * ancho;
}

function construirParrafos(lineas: Linea[], ctx: ContextoParrafos): string[] {
  const parrafos: string[] = [];
  let actual: string | null = null;
  let prev: Linea | null = null;
  for (const l of lineas) {
    if (actual === null || empiezaParrafo(prev, l, ctx)) {
      if (actual !== null) parrafos.push(actual);
      actual = l.texto;
    } else {
      actual = unirLineas(actual, l.texto);
    }
    prev = l;
  }
  if (actual !== null) parrafos.push(actual);
  return parrafos
    .map((p) => limpiarEspacios(p))
    .filter((p) => /[\p{L}\p{N}]/u.test(p));
}

// ───────────────────────── Función principal ─────────────────────────

const TITULO_BASURA = /^(untitled|sin t[ií]tulo|document\d*|microsoft word.*)$|\.(pdf|docx?|indd|tex)$/i;

/** Quita superíndices Unicode pegados a una palabra o signo ("palabra¹"). */
function quitarSuperindicesUnicode(s: string): string {
  return s.replace(/(?<=[\p{L}.,;:!?)»"'])[⁰¹²³⁴⁵⁶⁷⁸⁹]+/gu, '');
}

export function procesarPaginas(
  paginasEntrada: PaginaPdf[],
  indice: EntradaIndice[] = [],
  opciones: OpcionesProcesado = {},
): Libro {
  const numPaginas = paginasEntrada.length;
  const tituloMeta = limpiarEspacios(normalizarTexto(opciones.tituloMetadato ?? ''));
  const tituloMetaValido = tituloMeta !== '' && !TITULO_BASURA.test(tituloMeta) ? tituloMeta : '';

  // Normalizar el texto de todos los fragmentos y descartar los vacíos.
  const paginas: PaginaPdf[] = paginasEntrada.map((p) => ({
    ...p,
    fragmentos: p.fragmentos
      .map((f) => ({ ...f, texto: quitarSuperindicesUnicode(normalizarTexto(f.texto)) }))
      .filter((f) => f.texto.trim() !== '' && f.tam > 0),
  }));

  // PDF escaneado: casi sin texto.
  const totalCaracteres = paginas.reduce((a, p) => a + p.fragmentos.reduce((b, f) => b + caracteres(f.texto), 0), 0);
  if (numPaginas === 0 || totalCaracteres / numPaginas < MIN_CARACTERES_POR_PAGINA) {
    return {
      titulo: tituloMetaValido || 'Libro sin título',
      numPaginas,
      capitulos: [],
      escaneado: true,
      origenCapitulos: 'unico',
      avisos: [AVISO_ESCANEADO],
    };
  }

  const cuerpo = calcularTamCuerpo(paginas);

  // Segmentos por página, sin márgenes ni notas al pie, y en orden de lectura.
  const segsBrutos = paginas.map((p) => segmentarPagina(quitarLlamadas(p.fragmentos, cuerpo), cuerpo));
  const segsSinMargen = quitarMargenes(paginas, segsBrutos, cuerpo);
  const lineas: Linea[] = [];
  paginas.forEach((p, i) => {
    const limpios = quitarNotasAlPie(segsSinMargen[i]!, cuerpo, p.alto);
    lineas.push(...ordenarPagina(limpios, p, cuerpo));
  });

  const avisos: string[] = [];
  if (lineas.length === 0) {
    return {
      titulo: tituloMetaValido || 'Libro sin título',
      numPaginas,
      capitulos: [],
      escaneado: false,
      origenCapitulos: 'unico',
      avisos: ['No se ha encontrado texto legible en este PDF.'],
    };
  }

  const grupos = detectarTitulos(lineas, cuerpo);
  const titulo = tituloMetaValido || grupos[0]?.texto || 'Libro sin título';

  // Capítulos: índice → títulos grandes → único.
  let origen: Libro['origenCapitulos'] = 'unico';
  let cortes: Corte[] = [];
  const entradas = elegirEntradasIndice(indice, numPaginas);
  if (entradas.length > 0) {
    const porIndice = cortesPorIndice(entradas, lineas, cuerpo);
    if (porIndice.length >= 2 || (porIndice.length === 1 && grupos.length < 2)) {
      cortes = porIndice;
      origen = 'indice';
    }
  }
  if (origen === 'unico' && grupos.length > 0) {
    cortes = cortesPorTitulos(grupos);
    origen = 'titulos';
  }

  const ctx: ContextoParrafos = {
    cuerpo,
    interlineado: interlineadoNormal(lineas, cuerpo),
    bordes: calcularBordes(lineas, cuerpo),
  };

  const borradores: Array<{ titulo: string; pagina: number; parrafos: string[] }> = [];
  if (origen === 'unico') {
    borradores.push({ titulo, pagina: lineas[0]!.pagina, parrafos: construirParrafos(lineas, ctx) });
  } else {
    const previas = lineas.slice(0, cortes[0]!.inicioTitulo);
    borradores.push({ titulo: 'Inicio', pagina: previas[0]?.pagina ?? 1, parrafos: construirParrafos(previas, ctx) });
    cortes.forEach((c, i) => {
      const fin = i + 1 < cortes.length ? cortes[i + 1]!.inicioTitulo : lineas.length;
      borradores.push({
        titulo: c.titulo,
        pagina: c.pagina,
        parrafos: construirParrafos(lineas.slice(c.inicioContenido, Math.max(c.inicioContenido, fin)), ctx),
      });
    });
  }

  const capitulos: Capitulo[] = borradores
    .filter((b) => b.parrafos.length > 0)
    .map((b, i) => ({ id: `c${String(i).padStart(3, '0')}`, titulo: b.titulo, parrafos: b.parrafos, paginaInicio: b.pagina }));

  if (capitulos.length === 0) avisos.push('No se ha encontrado texto legible en este PDF.');

  return { titulo, numPaginas, capitulos, escaneado: false, origenCapitulos: origen, avisos };
}
