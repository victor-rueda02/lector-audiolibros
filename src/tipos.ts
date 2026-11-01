/**
 * Contratos entre módulos. Este archivo es del coordinador: los subagentes
 * lo leen pero no lo modifican (si necesitan un cambio, lo piden en su informe).
 *
 * Flujo:  PDF ──extraerLibro──▶ Libro ──GeneradorAudio──▶ MP3 por capítulo
 *         ──AlmacenAudio──▶ IndexedDB ──Reproductor (<audio> + Media Session)
 */

// ───────────────────────── Libro (src/pdf) ─────────────────────────

export interface Capitulo {
  /** Identificador estable dentro del libro: "c000", "c001", ... (orden de lectura). */
  id: string;
  titulo: string;
  /** Párrafos de texto limpio, listos para leer en voz alta (sin cabeceras, pies, notas...). */
  parrafos: string[];
  /** Página (base 1) donde empieza el capítulo. Informativo. */
  paginaInicio: number;
}

export interface Libro {
  titulo: string;
  numPaginas: number;
  capitulos: Capitulo[];
  /** true si el PDF no tiene capa de texto útil (escaneado). Entonces capitulos puede ir vacío. */
  escaneado: boolean;
  /** De dónde sale la división en capítulos. */
  origenCapitulos: 'indice' | 'titulos' | 'unico';
  /** Avisos legibles para el usuario (en español). */
  avisos: string[];
}

export interface OpcionesExtraccion {
  onProgreso?: (paginaActual: number, totalPaginas: number) => void;
}

/** Implementado en src/pdf/index.ts como `export const extraerLibro: ExtraerLibro`. */
export type ExtraerLibro = (datos: Uint8Array, opciones?: OpcionesExtraccion) => Promise<Libro>;

/** Libro tal como lo guarda la app (un único libro a la vez). */
export interface LibroGuardado {
  /** Huella del PDF: SHA-256 en hexadecimal de sus bytes. */
  id: string;
  nombreArchivo: string;
  libro: Libro;
  guardado: number;
}

// ───────────────────────── Voz (src/voz) ─────────────────────────

export interface Voz {
  /** Id de Piper, p. ej. "es_ES-davefx-medium". Si el modelo tiene varios hablantes: "es_ES-sharvard-medium#F". */
  id: string;
  /** Nombre para mostrar, p. ej. "Dave · masculina · calidad media". */
  nombre: string;
  calidad: 'x_low' | 'low' | 'medium' | 'high';
  /** Tamaño aproximado de descarga del modelo, en MB. */
  tamanoMB: number;
  /** URL de una muestra de audio de ~10 s (no requiere descargar el modelo), o null. */
  urlMuestra: string | null;
}

/** Audio PCM mono en coma flotante [-1, 1]. */
export interface FragmentoAudio {
  muestras: Float32Array;
  frecuencia: number;
}

/**
 * Motor de síntesis intercambiable (Piper hoy, otro mañana). Se usa DENTRO del
 * Web Worker de generación; el resto de la app no lo ve directamente.
 */
export interface MotorVoz {
  readonly nombre: string;
  listarVoces(): Promise<Voz[]>;
  /** Descarga (si no está en caché) y carga en memoria la voz. */
  prepararVoz(vozId: string, onProgreso?: (fraccion: number) => void): Promise<void>;
  /** Sintetiza un texto corto (una o pocas frases) con la voz preparada. */
  sintetizar(texto: string): Promise<FragmentoAudio>;
  liberar(): Promise<void>;
}

export type FaseGeneracion = 'descargando-voz' | 'cargando-voz' | 'generando' | 'codificando';

export interface ProgresoGeneracion {
  fase: FaseGeneracion;
  /** Avance de la fase actual, 0..1 (en 'generando': fracción del texto ya sintetizado). */
  fraccion: number;
  /** Segundos de audio generados hasta ahora. */
  segundosAudio: number;
  /** Segundos de reloj transcurridos desde que empezó la síntesis. */
  segundosCalculo: number;
  /** Estimación de segundos que faltan, o null si aún no se puede estimar. */
  etaSegundos: number | null;
}

export interface ResultadoAudio {
  /** Audio comprimido listo para <audio> (MP3 CBR mono). */
  audio: Blob;
  tipoMime: string;
  duracionSeg: number;
  /** Segundos de reloj dedicados a sintetizar (sin contar la descarga de la voz). */
  segundosCalculo: number;
}

/**
 * API de generación para el hilo principal. Implementada en src/voz/ sobre un
 * Web Worker que ejecuta MotorVoz + codificación MP3.
 */
export interface GeneradorAudio {
  listarVoces(): Promise<Voz[]>;
  /** true si el modelo de la voz ya está descargado en la caché del navegador. */
  vozDescargada(vozId: string): Promise<boolean>;
  /** Genera el audio completo de un capítulo (título + párrafos, con pausas entre párrafos). */
  generarCapitulo(
    capitulo: Capitulo,
    vozId: string,
    onProgreso?: (p: ProgresoGeneracion) => void,
    signal?: AbortSignal,
  ): Promise<ResultadoAudio>;
  /** Genera audio de un texto suelto (Diagnóstico, pruebas). */
  generarTexto(
    texto: string,
    vozId: string,
    onProgreso?: (p: ProgresoGeneracion) => void,
    signal?: AbortSignal,
  ): Promise<ResultadoAudio>;
}

// ───────────────────────── Almacén (src/almacen) ─────────────────────────

export interface PistaGuardada {
  libroId: string;
  capituloId: string;
  vozId: string;
  duracionSeg: number;
  bytes: number;
  tipoMime: string;
  creada: number;
}

export interface EstadoAlmacen {
  /** navigator.storage.persisted() */
  persistente: boolean;
  usadoBytes: number | null;
  cuotaBytes: number | null;
  libreBytes: number | null;
}

/** Todo vive en el navegador (IndexedDB). Nunca se sube nada a ningún servidor. */
export interface AlmacenAudio {
  pedirPersistencia(): Promise<boolean>;
  estado(): Promise<EstadoAlmacen>;

  guardarLibro(libro: LibroGuardado): Promise<void>;
  obtenerLibro(): Promise<LibroGuardado | null>;

  guardarPista(meta: PistaGuardada, audio: Blob): Promise<void>;
  /** Devuelve un Blob en memoria (no ligado a IndexedDB) listo para URL.createObjectURL. */
  obtenerAudio(libroId: string, capituloId: string): Promise<Blob | null>;
  listarPistas(libroId: string): Promise<PistaGuardada[]>;
  borrarPista(libroId: string, capituloId: string): Promise<void>;
  /** Borra el libro guardado y todas las pistas (al cargar un libro nuevo). */
  borrarTodo(): Promise<void>;
}

// ───────────────────────── Preferencias y posición (src/ui) ─────────────────────────

export interface PosicionLectura {
  libroId: string;
  capituloId: string;
  segundo: number;
  actualizada: number;
}

// ───────────────────────── Cableado ─────────────────────────

/** Implementaciones reales que la UI recibe (ver src/servicios.ts). La UI no importa módulos de otros directamente. */
export interface Servicios {
  extraerLibro: ExtraerLibro;
  generador: GeneradorAudio;
  almacen: AlmacenAudio;
  /** Monta la pantalla de Diagnóstico (src/diagnostico) dentro del contenedor. */
  montarDiagnostico: (contenedor: HTMLElement) => void;
}

// ───────────────────────── Constantes compartidas ─────────────────────────

/** Claves de localStorage compartidas entre módulos. */
export const CLAVES_LOCAL = {
  /** Id de la voz elegida (string). */
  vozId: 'lector.vozId',
  /** PosicionLectura en JSON. */
  posicion: 'lector.posicion',
} as const;

/** Voz que se usa si el usuario aún no ha elegido ninguna. */
export const VOZ_POR_DEFECTO = 'es_ES-davefx-medium';
