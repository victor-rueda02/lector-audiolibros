/**
 * Generador de audio para el hilo principal: delega en un único Web Worker
 * reutilizado (mantiene la voz cargada). Las llamadas se encolan en serie.
 */
import type { Capitulo, GeneradorAudio, ProgresoGeneracion, ResultadoAudio, Voz } from '../tipos.ts';
import { conservarEnCache } from './cacheModelos.ts';
import { listarVocesCatalogo, resolverVoz } from './catalogo.ts';
import { vozDescargada } from './descargada.ts';
import { planificarTexto, type Segmento } from './frases.ts';
import type { MensajeAlWorker, MensajeDelWorker } from './mensajes.ts';

const TIPO_MIME = 'audio/mpeg';

function errorCancelado(): DOMException {
  return new DOMException('Cancelado', 'AbortError');
}

export function crearGeneradorAudio(): GeneradorAudio {
  let worker: Worker | null = null;
  let cola: Promise<unknown> = Promise.resolve();
  let siguienteId = 1;

  void conservarEnCache(
    listarVocesCatalogo().flatMap((v) => {
      const r = resolverVoz(v.id);
      return r ? [r.urlOnnx, r.urlConfig] : [];
    }),
  );

  function obtenerWorker(): Worker {
    worker ??= new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    return worker;
  }

  function descartarWorker(): void {
    worker?.terminate();
    worker = null;
  }

  /** Ejecuta un trabajo en el worker. Resuelve cuando el worker ha terminado del todo (también tras cancelar). */
  function ejecutar(
    segmentos: Segmento[],
    vozId: string,
    onProgreso: ((p: ProgresoGeneracion) => void) | undefined,
    signal: AbortSignal | undefined,
  ): Promise<ResultadoAudio> {
    if (signal?.aborted) return Promise.reject(errorCancelado());
    if (segmentos.length === 0) return Promise.reject(new Error('No hay texto que convertir en audio.'));
    const id = siguienteId++;
    const w = obtenerWorker();

    return new Promise<ResultadoAudio>((resolve, reject) => {
      let terminado = false;
      const limpiar = () => {
        terminado = true;
        w.removeEventListener('message', alMensaje);
        w.removeEventListener('error', alError);
        signal?.removeEventListener('abort', alAbortar);
      };
      const alMensaje = (ev: MessageEvent<MensajeDelWorker>) => {
        const m = ev.data;
        if (m.id !== id || terminado) return;
        switch (m.tipo) {
          case 'progreso':
            onProgreso?.(m.progreso);
            break;
          case 'fin':
            limpiar();
            resolve({
              audio: new Blob([m.mp3], { type: TIPO_MIME }),
              tipoMime: TIPO_MIME,
              duracionSeg: m.duracionSeg,
              segundosCalculo: m.segundosCalculo,
            });
            break;
          case 'cancelado':
            limpiar();
            reject(errorCancelado());
            break;
          case 'error':
            limpiar();
            reject(new Error(m.mensaje));
            break;
        }
      };
      const alError = (ev: ErrorEvent) => {
        if (terminado) return;
        limpiar();
        descartarWorker(); // el worker pudo quedar en mal estado: se recreará
        reject(new Error(`Falló el motor de voz: ${ev.message || 'error desconocido'}`));
      };
      const alAbortar = () => {
        if (terminado) return;
        w.postMessage({ tipo: 'cancelar', id } satisfies MensajeAlWorker);
      };
      w.addEventListener('message', alMensaje);
      w.addEventListener('error', alError);
      signal?.addEventListener('abort', alAbortar);
      w.postMessage({ tipo: 'generar', id, vozId, segmentos } satisfies MensajeAlWorker);
    });
  }

  /** Encola en serie: el siguiente trabajo empieza cuando el anterior terminó (bien o mal). */
  function encolar(
    segmentos: Segmento[],
    vozId: string,
    onProgreso?: (p: ProgresoGeneracion) => void,
    signal?: AbortSignal,
  ): Promise<ResultadoAudio> {
    const resultado = cola.then(
      () => ejecutar(segmentos, vozId, onProgreso, signal),
      () => ejecutar(segmentos, vozId, onProgreso, signal),
    );
    cola = resultado.catch(() => undefined);
    return resultado;
  }

  return {
    async listarVoces(): Promise<Voz[]> {
      return listarVocesCatalogo();
    },
    vozDescargada: vozDescargada,
    generarCapitulo(capitulo: Capitulo, vozId, onProgreso, signal) {
      return encolar(planificarTexto(capitulo.titulo, capitulo.parrafos), vozId, onProgreso, signal);
    },
    generarTexto(texto, vozId, onProgreso, signal) {
      const parrafos = texto.split(/\n{2,}|\r?\n/).filter((p) => p.trim());
      return encolar(planificarTexto(null, parrafos), vozId, onProgreso, signal);
    },
  };
}
