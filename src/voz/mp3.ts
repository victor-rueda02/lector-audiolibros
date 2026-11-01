/**
 * Envoltorio del codificador MP3 (lamejs): un codificador por pista, mono, CBR.
 * Recibe PCM Float32 por fragmentos y solo acumula los bytes MP3. Sin DOM.
 */
import { Mp3Encoder } from '@breezystack/lamejs';

export const KBPS_MP3 = 48;
const BLOQUE = 1152 * 8;

export class CodificadorMp3 {
  private readonly codificador: Mp3Encoder;
  private readonly partes: Uint8Array[] = [];
  private bytes = 0;
  private muestrasTotales = 0;

  constructor(
    readonly frecuencia: number,
    kbps = KBPS_MP3,
  ) {
    this.codificador = new Mp3Encoder(1, frecuencia, kbps);
  }

  /** Añade PCM mono en [-1, 1]. */
  anadir(muestras: Float32Array): void {
    const pcm = new Int16Array(BLOQUE);
    for (let i = 0; i < muestras.length; i += BLOQUE) {
      const n = Math.min(BLOQUE, muestras.length - i);
      for (let j = 0; j < n; j++) {
        const x = muestras[i + j];
        pcm[j] = x >= 1 ? 32767 : x <= -1 ? -32768 : Math.round(x * 32767);
      }
      this.guardar(this.codificador.encodeBuffer(n === BLOQUE ? pcm : pcm.subarray(0, n)));
    }
    this.muestrasTotales += muestras.length;
  }

  /** Añade silencio de `segundos`. */
  anadirSilencio(segundos: number): void {
    const n = Math.round(segundos * this.frecuencia);
    if (n > 0) this.anadir(new Float32Array(n));
  }

  get duracionSeg(): number {
    return this.muestrasTotales / this.frecuencia;
  }

  get bytesAcumulados(): number {
    return this.bytes;
  }

  /** Cierra el flujo y devuelve todos los bytes MP3 en un único buffer. */
  finalizar(): Uint8Array<ArrayBuffer> {
    this.guardar(this.codificador.flush());
    const salida = new Uint8Array(this.bytes);
    let pos = 0;
    for (const p of this.partes) {
      salida.set(p, pos);
      pos += p.length;
    }
    this.partes.length = 0;
    return salida;
  }

  private guardar(trozo: Uint8Array): void {
    if (trozo.length > 0) {
      // lamejs puede reutilizar su buffer interno: copiamos.
      this.partes.push(trozo.slice());
      this.bytes += trozo.length;
    }
  }
}
