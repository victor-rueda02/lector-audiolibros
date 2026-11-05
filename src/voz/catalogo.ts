/**
 * Catálogo de voces Piper en español y construcción de URLs.
 * Módulo puro (sin DOM).
 */
import type { Voz } from '../tipos.ts';

export const BASE_MODELOS = 'https://huggingface.co/rhasspy/piper-voices/resolve/main/es';
export const BASE_MUESTRAS = 'https://rhasspy.github.io/piper-samples/samples/es';

interface DefinicionModelo {
  /** Variante del idioma en piper-voices. */
  region: 'es_ES' | 'es_MX' | 'es_AR';
  /** Nombre del modelo en piper-voices, p. ej. "davefx". */
  nombre: string;
  calidad: Voz['calidad'];
  tamanoMB: number;
  /** Hablantes: clave del speaker_id_map → etiqueta para mostrar. Ausente si es monohablante. */
  hablantes?: { clave: string; etiqueta: string; indiceMuestra: number }[];
  /** Nombre visible (monohablante). */
  titulo: string;
  /** length_scale propio (> 1 habla más despacio). Ausente: el del modelo. */
  escalaDuracion?: number;
}

// Solo la voz que usa el lector. Para añadir otra basta con una entrada más.
const MODELOS: DefinicionModelo[] = [
  { region: 'es_ES', nombre: 'carlfm', calidad: 'x_low', tamanoMB: 28, titulo: 'Carlfm · España · masculina · ritmo pausado', escalaDuracion: 1.12 },
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
  escalaDuracion: number | null;
}

function idModelo(m: DefinicionModelo): string {
  return `${m.region}-${m.nombre}-${m.calidad}`;
}

function urlBase(m: DefinicionModelo): string {
  return `${BASE_MODELOS}/${m.region}/${m.nombre}/${m.calidad}/${idModelo(m)}`;
}

/** Las muestras speaker_<n>.mp3 existen (comprobado con curl) para n=0 en todas y n=1 en sharvard. */
function urlMuestra(m: DefinicionModelo, n: number): string {
  return `${BASE_MUESTRAS}/${m.region}/${m.nombre}/${m.calidad}/speaker_${n}.mp3`;
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
    escalaDuracion: m.escalaDuracion ?? null,
  };
}
