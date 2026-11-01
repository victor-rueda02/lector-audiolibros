/// <reference lib="webworker" />
/**
 * Web Worker de generación: Piper (un único MotorPiper reutilizado, la voz queda
 * cargada entre llamadas) + codificación MP3 fragmento a fragmento.
 */
import type { ProgresoGeneracion } from '../tipos.ts';
import { crearLimitador, estimarEta } from './eta.ts';
import { silencioFinalSeg } from './frases.ts';
import type { MensajeAlWorker, MensajeDelWorker } from './mensajes.ts';
import { CodificadorMp3 } from './mp3.ts';
import { MotorPiper } from './piper.ts';

const motor = new MotorPiper();
const cancelados = new Set<number>();

function enviar(m: MensajeDelWorker, transferir: Transferable[] = []): void {
  self.postMessage(m, transferir);
}

const cederHilo = () => new Promise<void>((r) => setTimeout(r, 0));

async function generar(id: number, vozId: string, segmentos: { texto: string; pausaDespuesSeg: number }[]): Promise<void> {
  const publicar = crearLimitador(4);
  const progreso = (p: ProgresoGeneracion, forzar = false) => {
    if (publicar(forzar)) enviar({ tipo: 'progreso', id, progreso: p });
  };
  const base = { segundosAudio: 0, segundosCalculo: 0, etaSegundos: null };

  progreso({ fase: 'descargando-voz', fraccion: 0, ...base }, true);
  await motor.prepararVoz(vozId, (f) => progreso({ fase: 'descargando-voz', fraccion: f, ...base }));
  progreso({ fase: 'descargando-voz', fraccion: 1, ...base }, true);
  if (cancelados.has(id)) return void enviar({ tipo: 'cancelado', id });

  if (motor.necesitaCargar) {
    progreso({ fase: 'cargando-voz', fraccion: 0, ...base }, true);
    await motor.cargarSesion();
    progreso({ fase: 'cargando-voz', fraccion: 1, ...base }, true);
  }

  const codificador = new CodificadorMp3(motor.frecuencia);
  const totalCaracteres = segmentos.reduce((s, x) => s + x.texto.length, 0) || 1;
  let hechos = 0;
  const t0 = performance.now();
  progreso({ fase: 'generando', fraccion: 0, ...base }, true);

  for (let i = 0; i < segmentos.length; i++) {
    if (cancelados.has(id)) return void enviar({ tipo: 'cancelado', id });
    const seg = segmentos[i];
    const frag = await motor.sintetizar(seg.texto);
    codificador.anadir(frag.muestras);
    codificador.anadirSilencio(Math.max(0, seg.pausaDespuesSeg - silencioFinalSeg(frag.muestras, frag.frecuencia)));
    hechos += seg.texto.length;
    const transcurrido = (performance.now() - t0) / 1000;
    progreso({
      fase: 'generando',
      fraccion: hechos / totalCaracteres,
      segundosAudio: codificador.duracionSeg,
      segundosCalculo: transcurrido,
      etaSegundos: estimarEta(hechos, totalCaracteres, transcurrido, i + 1),
    });
    await cederHilo(); // permite recibir 'cancelar'
  }

  progreso({ fase: 'codificando', fraccion: 0, ...base, segundosAudio: codificador.duracionSeg }, true);
  const mp3 = codificador.finalizar();
  const segundosCalculo = (performance.now() - t0) / 1000;
  progreso({ fase: 'codificando', fraccion: 1, ...base, segundosAudio: codificador.duracionSeg, segundosCalculo }, true);
  enviar({ tipo: 'fin', id, mp3: mp3.buffer, duracionSeg: codificador.duracionSeg, segundosCalculo }, [mp3.buffer]);
}

self.onmessage = (ev: MessageEvent<MensajeAlWorker>) => {
  const m = ev.data;
  if (m.tipo === 'cancelar') {
    cancelados.add(m.id);
    return;
  }
  generar(m.id, m.vozId, m.segmentos)
    .catch((e: unknown) => {
      enviar({ tipo: 'error', id: m.id, mensaje: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => cancelados.delete(m.id));
};
