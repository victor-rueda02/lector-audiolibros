/**
 * Estructuras propias (serializables) entre la lectura con pdf.js y la limpieza pura.
 * Coordenadas en puntos, con origen arriba a la izquierda (y crece hacia abajo).
 */

/** Fragmento de texto tal como lo da pdf.js. */
export interface Fragmento {
  texto: string;
  /** Borde izquierdo. */
  x: number;
  /** Línea base, medida desde el borde superior de la página. */
  y: number;
  ancho: number;
  alto: number;
  /** Tamaño de letra. */
  tam: number;
  fuente: string;
}

export interface PaginaPdf {
  /** Número de página, base 1. */
  numero: number;
  ancho: number;
  alto: number;
  fragmentos: Fragmento[];
}

/** Entrada del índice (outline) ya aplanada y con la página resuelta. */
export interface EntradaIndice {
  titulo: string;
  /** Página, base 1. */
  pagina: number;
  /** 0 = primer nivel, 1 = segundo, ... */
  nivel: number;
}

export interface OpcionesProcesado {
  /** Metadato Title del PDF, si existe. */
  tituloMetadato?: string | undefined;
}
