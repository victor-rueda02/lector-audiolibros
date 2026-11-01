/**
 * Catálogo de voces Piper es_ES y construcción de URLs. Módulo puro (sin DOM).
 */
import type { Voz } from '../tipos.ts';

export const BASE_MODELOS = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es/es_ES';
export const BASE_MUESTRAS = 'https://rhasspy.github.io/piper-samples/samples/es/es_ES';

interface DefinicionModelo {
  /** Nombre del modelo en piper-voices, p. ej. "davefx". */
  nombre: string;
  calidad: Voz['calidad'];
  tamanoMB: number;
  /** Hablantes: clave del speaker_id_map → etiqueta para mostrar. Ausente si es monohablante. */
  hablantes?: { clave: string; etiqueta: string; indiceMuestra: number }[];
  /** Nombre visible (monohablante). */
  titulo: string;
}

const MODELOS: DefinicionModelo[] = [
  { nombre: 'carlfm', calidad: 'x_low', tamanoMB: 28, titulo: 'Carlfm · calidad básica' },
  { nombre: 'davefx', calidad: 'medium', tamanoMB: 63, titulo: 'Dave · masculina · calidad media' },
  { nombre: 'mls_10246', calidad: 'low', tamanoMB: 63, titulo: 'MLS 10246 · calidad baja' },
  { nombre: 'mls_9972', calidad: 'low', tamanoMB: 63, titulo: 'MLS 9972 · calidad baja' },
  {
    nombre: 'sharvard',
    calidad: 'medium',
    tamanoMB: 77,
    titulo: 'Sharvard',
    hablantes: [
      { clave: 'M', etiqueta: 'Sharvard · masculina · calidad media', indiceMuestra: 0 },
      { clave: 'F', etiqueta: 'Sharvard · femenina · calidad media', indiceMuestra: 1 },
    ],
  },
];

export interface VozResuelta {
  /** Id completo, p. ej. "es_ES-sharvard-medium#F". */
  id: string;
  /** Id del modelo sin hablante: "es_ES-sharvard-medium". */
  idModelo: string;
  /** Clave de hablante en speaker_id_map ("M", "F") o null. */
  hablante: string | null;
  urlOnnx: string;
  urlConfig: string;
  tamanoBytesAprox: number;
}

function idModelo(m: DefinicionModelo): string {
  return `es_ES-${m.nombre}-${m.calidad}`;
}

function urlBase(m: DefinicionModelo): string {
  return `${BASE_MODELOS}/${m.nombre}/${m.calidad}/${idModelo(m)}`;
}

/** Las muestras speaker_<n>.mp3 existen (comprobado con curl) para n=0 en todas y n=1 en sharvard. */
function urlMuestra(m: DefinicionModelo, n: number): string {
  return `${BASE_MUESTRAS}/${m.nombre}/${m.calidad}/speaker_${n}.mp3`;
}

export function listarVocesCatalogo(): Voz[] {
  const voces: Voz[] = [];
  for (const m of MODELOS) {
    if (m.hablantes) {
      for (const h of m.hablantes) {
        voces.push({
          id: `${idModelo(m)}#${h.clave}`,
          nombre: h.etiqueta,
          calidad: m.calidad,
          tamanoMB: m.tamanoMB,
          urlMuestra: urlMuestra(m, h.indiceMuestra),
        });
      }
    } else {
      voces.push({
        id: idModelo(m),
        nombre: m.titulo,
        calidad: m.calidad,
        tamanoMB: m.tamanoMB,
        urlMuestra: urlMuestra(m, 0),
      });
    }
  }
  return voces;
}

/** Devuelve null si la voz no existe en el catálogo. */
export function resolverVoz(vozId: string): VozResuelta | null {
  const [base, hablante] = vozId.split('#');
  const m = MODELOS.find((x) => idModelo(x) === base);
  if (!m) return null;
  if (m.hablantes && !m.hablantes.some((h) => h.clave === hablante)) return null;
  if (!m.hablantes && hablante !== undefined) return null;
  return {
    id: vozId,
    idModelo: base,
    hablante: hablante ?? null,
    urlOnnx: `${urlBase(m)}.onnx`,
    urlConfig: `${urlBase(m)}.onnx.json`,
    tamanoBytesAprox: m.tamanoMB * 1024 * 1024,
  };
}
