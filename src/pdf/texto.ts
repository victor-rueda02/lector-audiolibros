/** Utilidades puras de texto para la limpieza. */

/** Guion suave (U+00AD): marca un posible corte de palabra. */
export const GUION_SUAVE = String.fromCodePoint(0xad);

const LIGADURAS: Record<number, string> = {
  0xfb00: 'ff',
  0xfb01: 'fi',
  0xfb02: 'fl',
  0xfb03: 'ffi',
  0xfb04: 'ffl',
  0xfb05: 'st',
  0xfb06: 'st',
};

const RE_LIGADURAS = /[\u{FB00}-\u{FB06}]/gu;
const RE_COMILLA_SIMPLE = /[\u{2018}\u{2019}\u{201A}\u{201B}\u{2032}\u{B4}`]/gu;
const RE_COMILLA_DOBLE = /[\u{201C}\u{201D}\u{201E}\u{201F}\u{2033}]/gu;
const RE_GUION_RARO = /[\u{2010}\u{2011}]/gu;
const RE_ESPACIO_RARO = /[\u{A0}\u{1680}\u{2000}-\u{200A}\u{202F}\u{205F}\u{3000}\t]/gu;
const RE_INVISIBLE = /[\u{200B}-\u{200D}\u{2060}\u{FEFF}]/gu;
const RE_CONTROL = /[\u{0}-\u{8}\u{A}-\u{1F}\u{7F}-\u{9F}]/gu;
const RE_GUION_SUAVE = /\u{AD}/gu;

/**
 * Normaliza un fragmento: ligaduras, comillas, espacios raros y caracteres de control.
 * Conserva el guion suave U+00AD (lo necesita la unión de palabras partidas).
 */
export function normalizarTexto(s: string): string {
  return s
    .replace(RE_LIGADURAS, (c) => LIGADURAS[c.codePointAt(0)!] ?? c)
    .replace(RE_COMILLA_SIMPLE, "'")
    .replace(RE_COMILLA_DOBLE, '"')
    .replace(RE_GUION_RARO, '-')
    .replace(RE_ESPACIO_RARO, ' ')
    .replace(RE_INVISIBLE, '')
    .replace(RE_CONTROL, ' ')
    .normalize('NFC');
}

/** Colapsa espacios y quita guiones suaves sobrantes. */
export function limpiarEspacios(s: string): string {
  return s.replace(RE_GUION_SUAVE, '').replace(/\s+/g, ' ').trim();
}

/** Colapsa espacios pero conserva el guion suave (lo usa la unión de líneas). */
export function colapsarEspacios(s: string): string {
  return s.replace(/[^\S\u{AD}]+/gu, ' ').trim();
}

/** Clave para comparar títulos: minúsculas, sin acentos, solo letras y dígitos. */
export function claveComparable(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Clave de cabecera/pie: minúsculas, sin dígitos ni números romanos sueltos, espacios colapsados.
 * Sirve para reconocer la misma cabecera aunque cambie el número de página.
 */
export function claveCabecera(s: string): string {
  return s
    .toLowerCase()
    .replace(/\d+/g, ' ')
    .replace(/(^|[^\p{L}])[ivxlcdm]{1,7}(?![\p{L}])/gu, '$1 ')
    .replace(/[^\p{L}]+/gu, ' ')
    .trim();
}

const DECOR = String.raw`[\s\-–—−·•*\[\](){}|_~.:]*`;
const RE_NUMERO_PAGINA = new RegExp(
  String.raw`^${DECOR}(?:(?:p[áa]g(?:ina|\.)?|page|p\.)\s*)?(?:\d{1,5}|[ivxlcdm]{1,8})(?:\s*(?:/|de|of)\s*\d{1,5})?${DECOR}$`,
  'i',
);

/** "23", "— 23 —", "- 23 -", "Página 23", "Pág. 23", "23 / 300", "xiv"... */
export function esNumeroDePagina(s: string): boolean {
  return RE_NUMERO_PAGINA.test(s.trim());
}

/**
 * Une dos líneas consecutivas de un mismo párrafo, resolviendo palabras partidas con guion.
 * - Guion suave U+00AD al final: siempre se une sin espacio.
 * - "-" al final pegado a una letra y la siguiente línea empieza en minúscula: se une (pala-bra).
 * - Si la siguiente empieza en mayúscula o dígito se conserva el guion (compuesto: "Madrid-Barcelona").
 */
export function unirLineas(a: string, b: string): string {
  if (!a) return b;
  if (!b) return a;
  if (a.endsWith(GUION_SUAVE)) return a.slice(0, -1) + b;
  if (/\p{L}-$/u.test(a)) {
    const sigue = b[0]!;
    if (/\p{Ll}/u.test(sigue)) return a.slice(0, -1) + b;
    if (/[\p{Lu}\p{N}]/u.test(sigue)) return a + b;
  }
  return `${a} ${b}`;
}

/** Terminación de frase (para decidir si una línea corta cierra párrafo). */
export function terminaEnFrase(s: string): boolean {
  return /[.!?…]["')\]»”’]*$/.test(s.trim());
}
