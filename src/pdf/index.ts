/**
 * Pipeline PDF → Libro.
 *   1. lectura.ts  (pdf.js): páginas con fragmentos de texto + índice.
 *   2. limpieza.ts (pura):   cabeceras, pies, notas, columnas, capítulos, párrafos.
 */
import type { ExtraerLibro, Libro, OpcionesExtraccion } from '../tipos.ts';
import { leerPdf } from './lectura.ts';
import { procesarPaginas } from './limpieza.ts';

export const extraerLibro: ExtraerLibro = async (datos: Uint8Array, opciones?: OpcionesExtraccion): Promise<Libro> => {
  const lectura = await leerPdf(datos, opciones?.onProgreso);
  return procesarPaginas(lectura.paginas, lectura.indice, { tituloMetadato: lectura.titulo });
};

export { leerPdf } from './lectura.ts';
export { procesarPaginas, AVISO_ESCANEADO } from './limpieza.ts';
export type { EntradaIndice, Fragmento, PaginaPdf, OpcionesProcesado } from './modelo.ts';
export type { LecturaPdf } from './lectura.ts';
