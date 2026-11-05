/** Servicios falsos para desarrollar y probar la UI sin PDF real, voz real ni IndexedDB. */
import type {
  AlmacenAudio,
  Capitulo,
  ExtraerLibro,
  GeneradorAudio,
  Libro,
  LibroGuardado,
  PistaGuardada,
  ProgresoGeneracion,
  ResultadoAudio,
  Servicios,
  Voz,
} from '../tipos.ts';

const esperar = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((ok, ko) => {
    if (signal?.aborted) return ko(new DOMException('Cancelado', 'AbortError'));
    const t = setTimeout(ok, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      ko(new DOMException('Cancelado', 'AbortError'));
    });
  });

/** WAV PCM 16 bit mono con un tono suave (volumen bajo, con fundido de entrada y salida). */
export function crearWav(segundos: number, frecuenciaHz: number, sr = 8000): Blob {
  const n = Math.floor(segundos * sr);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const txt = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  txt(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  txt(8, 'WAVE');
  txt(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sr, true);
  v.setUint32(28, sr * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  txt(36, 'data');
  v.setUint32(40, n * 2, true);
  const fundido = Math.floor(0.05 * sr);
  for (let i = 0; i < n; i++) {
    const env = Math.min(1, i / fundido, (n - i) / fundido);
    v.setInt16(44 + i * 2, Math.round(Math.sin((2 * Math.PI * frecuenciaHz * i) / sr) * 0.12 * env * 32767), true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

const FRASES = [
  'La mañana llegó despacio sobre los tejados de la ciudad, y con ella el rumor de las primeras tiendas que abrían sus puertas.',
  'Nadie sabía todavía que aquel día cambiaría la vida de todos los habitantes del pequeño valle.',
  'El viejo relojero levantó la vista de su mesa de trabajo y observó a través de la ventana el movimiento incesante de la plaza.',
  'Entre los papeles amarillentos apareció una carta que nadie había abierto en más de cuarenta años.',
  'Caminaron juntos hasta el río, hablando de cosas pequeñas, porque las grandes pesaban demasiado para decirlas en voz alta.',
];

function parrafo(sem: number): string {
  const frases: string[] = [];
  for (let i = 0; i < 4; i++) frases.push(FRASES[(sem + i) % FRASES.length]!);
  return frases.join(' ');
}

export function crearLibroDeEjemplo(): Libro {
  const titulos = ['Primera parte: El valle', 'Segunda parte: La carta', 'Tercera parte: El río', 'Cuarta parte: El regreso'];
  const capitulos: Capitulo[] = titulos.map((titulo, i) => ({
    id: `c${String(i).padStart(3, '0')}`,
    titulo,
    parrafos: Array.from({ length: 6 + i }, (_, j) => parrafo(i + j)),
    paginaInicio: 1 + i * 3,
  }));
  return {
    titulo: 'Libro de ejemplo (falso)',
    numPaginas: 12,
    capitulos,
    escaneado: false,
    origenCapitulos: 'indice',
    avisos: ['Este es un libro de ejemplo generado por los servicios falsos.'],
  };
}

export function crearServiciosFalsos(): Servicios {
  const extraerLibro: ExtraerLibro = async (_datos, opciones) => {
    const total = 12;
    for (let p = 1; p <= total; p++) {
      await esperar(60);
      opciones?.onProgreso?.(p, total);
    }
    return crearLibroDeEjemplo();
  };

  const voces: Voz[] = [
    {
      id: 'es_ES-carlfm-x_low',
      nombre: 'Dave · masculina · calidad media',
      calidad: 'medium',
      tamanoMB: 63,
      urlMuestra: URL.createObjectURL(crearWav(3, 330)),
    },
    {
      id: 'es_ES-sharvard-medium#F',
      nombre: 'Sharvard · femenina · calidad media',
      calidad: 'medium',
      tamanoMB: 77,
      urlMuestra: URL.createObjectURL(crearWav(3, 440)),
    },
    { id: 'es_ES-mls_10246-low', nombre: 'MLS · masculina · calidad baja', calidad: 'low', tamanoMB: 28, urlMuestra: null },
  ];
  const descargadas = new Set<string>(['es_ES-carlfm-x_low']);

  const generador: GeneradorAudio = {
    listarVoces: async () => {
      await esperar(150);
      return voces;
    },
    vozDescargada: async (id) => descargadas.has(id),
    async generarCapitulo(capitulo, vozId, onProgreso, signal) {
      const emitir = (p: Partial<ProgresoGeneracion> & Pick<ProgresoGeneracion, 'fase' | 'fraccion'>) =>
        onProgreso?.({ segundosAudio: 0, segundosCalculo: 0, etaSegundos: null, ...p });
      if (!descargadas.has(vozId)) {
        for (let i = 1; i <= 5; i++) {
          await esperar(120, signal);
          emitir({ fase: 'descargando-voz', fraccion: i / 5 });
        }
        descargadas.add(vozId);
      }
      emitir({ fase: 'cargando-voz', fraccion: 1 });
      await esperar(150, signal);
      const pasos = 20;
      const total = 2.4;
      for (let i = 1; i <= pasos; i++) {
        await esperar((total * 1000) / pasos, signal);
        const f = i / pasos;
        emitir({
          fase: 'generando',
          fraccion: f,
          segundosAudio: 12 * f,
          segundosCalculo: total * f,
          etaSegundos: total * (1 - f),
        });
      }
      emitir({ fase: 'codificando', fraccion: 1, segundosAudio: 12, segundosCalculo: total, etaSegundos: 0 });
      await esperar(150, signal);
      const n = Number(capitulo.id.replace(/\D/g, '')) || 0;
      return { audio: crearWav(12, 220 + n * 55), tipoMime: 'audio/wav', duracionSeg: 12, segundosCalculo: total } satisfies ResultadoAudio;
    },
    async generarTexto(_t, _v, _p, signal) {
      await esperar(500, signal);
      return { audio: crearWav(3, 262), tipoMime: 'audio/wav', duracionSeg: 3, segundosCalculo: 0.5 };
    },
  };

  // Almacén "en memoria"; libro y metadatos de pistas se guardan también en localStorage
  // para poder recargar la página y seguir probando (el audio se regenera, es un tono).
  const CL_LIBRO = 'falso.libro';
  const CL_PISTAS = 'falso.pistas';
  const leer = <T>(k: string, def: T): T => {
    try {
      const c = localStorage.getItem(k);
      return c ? (JSON.parse(c) as T) : def;
    } catch {
      return def;
    }
  };
  const escribir = (k: string, v: unknown) => {
    try {
      localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* ignorar */
    }
  };
  let libro: LibroGuardado | null = leer<LibroGuardado | null>(CL_LIBRO, null);
  let pistas: PistaGuardada[] = leer<PistaGuardada[]>(CL_PISTAS, []);
  const blobs = new Map<string, Blob>();
  const clave = (l: string, c: string) => `${l}/${c}`;

  const almacen: AlmacenAudio = {
    pedirPersistencia: async () => true,
    estado: async () => {
      const usado = pistas.reduce((s, p) => s + p.bytes, 0) + 40_000_000;
      return { persistente: true, usadoBytes: usado, cuotaBytes: 2_000_000_000, libreBytes: 2_000_000_000 - usado };
    },
    guardarLibro: async (l) => {
      libro = l;
      escribir(CL_LIBRO, l);
    },
    obtenerLibro: async () => libro,
    guardarPista: async (meta, audio) => {
      pistas = pistas.filter((p) => !(p.libroId === meta.libroId && p.capituloId === meta.capituloId));
      pistas.push(meta);
      blobs.set(clave(meta.libroId, meta.capituloId), audio);
      escribir(CL_PISTAS, pistas);
    },
    obtenerAudio: async (l, c) => {
      const p = pistas.find((x) => x.libroId === l && x.capituloId === c);
      if (!p) return null;
      let b = blobs.get(clave(l, c));
      if (!b) {
        const n = Number(c.replace(/\D/g, '')) || 0;
        b = crearWav(p.duracionSeg, 220 + n * 55);
        blobs.set(clave(l, c), b);
      }
      return b;
    },
    listarPistas: async (l) => pistas.filter((p) => p.libroId === l),
    borrarPista: async (l, c) => {
      pistas = pistas.filter((p) => !(p.libroId === l && p.capituloId === c));
      blobs.delete(clave(l, c));
      escribir(CL_PISTAS, pistas);
    },
    borrarTodo: async () => {
      libro = null;
      pistas = [];
      blobs.clear();
      localStorage.removeItem(CL_LIBRO);
      localStorage.removeItem(CL_PISTAS);
    },
  };

  return {
    extraerLibro,
    generador,
    almacen,
    montarDiagnostico: (contenedor) => {
      contenedor.textContent = 'Diagnóstico (falso)';
    },
  };
}
