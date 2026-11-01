/**
 * Motor Piper (VITS) sobre onnxruntime-web, un solo hilo, sin SharedArrayBuffer.
 * Implementa MotorVoz: cambiar de motor = sustituir esta clase. Se usa dentro del Worker.
 */
import * as ort from 'onnxruntime-web/wasm';
import urlOrtWasm from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import type { FragmentoAudio, MotorVoz, Voz } from '../tipos.ts';
import { listarVocesCatalogo, resolverVoz, type VozResuelta } from './catalogo.ts';
import { obtenerConCache } from './cacheModelos.ts';
import { fonemizar } from './fonemizador.ts';

interface ConfigPiper {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
  speaker_id_map: Record<string, number>;
}

ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;
ort.env.wasm.wasmPaths = { wasm: urlOrtWasm };

export class MotorPiper implements MotorVoz {
  readonly nombre = 'Piper (onnxruntime-web)';

  private sesion: ort.InferenceSession | null = null;
  private idModeloCargado: string | null = null;
  private config: ConfigPiper | null = null;
  private idHablante: number | null = null;

  /** Frecuencia de muestreo del modelo cargado (22050 o 16000 Hz). */
  get frecuencia(): number {
    if (!this.config) throw new Error('No hay ninguna voz cargada.');
    return this.config.audio.sample_rate;
  }

  async listarVoces(): Promise<Voz[]> {
    return listarVocesCatalogo();
  }

  /**
   * `onProgreso` recibe la fracción de DESCARGA (0..1). Devuelve cuando el modelo
   * está descargado; `cargarSesion` (más lenta) se hace en una segunda llamada
   * para que el worker pueda indicar la fase 'cargando-voz'.
   */
  async prepararVoz(vozId: string, onProgreso?: (fraccion: number) => void): Promise<void> {
    const voz = this.resolver(vozId);
    if (this.idModeloCargado === voz.idModelo && this.sesion && this.config) {
      this.fijarHablante(voz);
      onProgreso?.(1);
      return;
    }
    const bufConfig = await obtenerConCache(voz.urlConfig, 8_000);
    const config = JSON.parse(new TextDecoder().decode(bufConfig)) as ConfigPiper;
    const modelo = await obtenerConCache(voz.urlOnnx, voz.tamanoBytesAprox, onProgreso);
    this.pendiente = { voz, config, modelo };
  }

  private pendiente: { voz: VozResuelta; config: ConfigPiper; modelo: ArrayBuffer } | null = null;

  /** Crea la sesión ONNX con el modelo ya descargado por prepararVoz. */
  async cargarSesion(): Promise<void> {
    const p = this.pendiente;
    if (!p) return; // ya estaba cargada
    this.pendiente = null;
    await this.liberarSesion();
    this.sesion = await ort.InferenceSession.create(new Uint8Array(p.modelo), {
      executionProviders: ['wasm'],
      graphOptimizationLevel: 'all',
    });
    this.config = p.config;
    this.idModeloCargado = p.voz.idModelo;
    this.fijarHablante(p.voz);
    // Calienta el fonemizador (carga espeak-ng-data) para que el primer cálculo no cargue con ello.
    await fonemizar('hola', p.config.espeak.voice);
  }

  get necesitaCargar(): boolean {
    return this.pendiente !== null;
  }

  async sintetizar(texto: string): Promise<FragmentoAudio> {
    if (!this.sesion || !this.config) throw new Error('No hay ninguna voz cargada.');
    const { config, sesion } = this;
    const oraciones = await fonemizar(texto, config.espeak.voice);
    const partes: Float32Array[] = [];
    let total = 0;
    for (const ids of oraciones) {
      const entradas: Record<string, ort.Tensor> = {
        input: new ort.Tensor('int64', BigInt64Array.from(ids, (n) => BigInt(n)), [1, ids.length]),
        input_lengths: new ort.Tensor('int64', BigInt64Array.of(BigInt(ids.length)), [1]),
        scales: new ort.Tensor('float32', Float32Array.of(config.inference.noise_scale, config.inference.length_scale, config.inference.noise_w), [3]),
      };
      if (this.idHablante !== null) entradas.sid = new ort.Tensor('int64', BigInt64Array.of(BigInt(this.idHablante)), [1]);
      const resultado = await sesion.run(entradas);
      const salida = resultado.output ?? Object.values(resultado)[0];
      const datos = (salida.data as Float32Array).slice(); // copia: el tensor se libera
      salida.dispose();
      partes.push(datos);
      total += datos.length;
    }
    const muestras = new Float32Array(total);
    let pos = 0;
    for (const p of partes) {
      muestras.set(p, pos);
      pos += p.length;
    }
    // Evita saturar: solo se atenúa si el pico supera 1.
    let pico = 0;
    for (let i = 0; i < muestras.length; i++) pico = Math.max(pico, Math.abs(muestras[i]));
    if (pico > 1) for (let i = 0; i < muestras.length; i++) muestras[i] /= pico;
    return { muestras, frecuencia: config.audio.sample_rate };
  }

  async liberar(): Promise<void> {
    await this.liberarSesion();
    this.pendiente = null;
  }

  private async liberarSesion(): Promise<void> {
    if (this.sesion) {
      try {
        await this.sesion.release();
      } catch {
        /* ya liberada */
      }
    }
    this.sesion = null;
    this.config = null;
    this.idModeloCargado = null;
    this.idHablante = null;
  }

  private resolver(vozId: string): VozResuelta {
    const v = resolverVoz(vozId);
    if (!v) throw new Error(`Voz desconocida: ${vozId}`);
    return v;
  }

  private fijarHablante(voz: VozResuelta): void {
    const cfg = this.config ?? this.pendiente?.config;
    if (!cfg) return;
    if (voz.hablante !== null) {
      const id = cfg.speaker_id_map[voz.hablante];
      if (id === undefined) throw new Error(`La voz ${voz.id} no tiene el hablante ${voz.hablante}.`);
      this.idHablante = id;
    } else {
      this.idHablante = cfg.num_speakers > 1 ? 0 : null;
    }
  }
}
