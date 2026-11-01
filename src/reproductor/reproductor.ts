/**
 * Reproductor de audiolibro: un único <audio>, Media Session, posición guardada,
 * precarga del capítulo siguiente y ventana de capítulos. Independiente de la UI.
 */
import type { AlmacenAudio, Capitulo, LibroGuardado } from '../tipos.ts';
import {
  CLAVE_VELOCIDAD,
  SALTO_SEG,
  capitulosABorrar,
  guardarPosicion,
  leerPosicion,
  limitar,
  normalizarVelocidad,
  type AlmacenamientoSimple,
} from './logica.ts';

export const ALBUM = 'Lector de audiolibros';
const INTERVALO_GUARDADO_MS = 5000;

export class Reproductor {
  readonly audio: HTMLAudioElement;
  /** Mensaje para el usuario (p. ej. "Pulsa play para continuar"), o null. */
  mensaje: string | null = null;

  private libro: LibroGuardado | null = null;
  private idx = -1;
  private pistas = new Set<string>();
  private urlActual: string | null = null;
  private siguiente: { idx: number; url: string } | null = null;
  private precargando = -1;
  private cargado = false;
  private segundoPendiente = 0;
  private token = 0;
  private velocidad: number;
  private ultimoPeriodico = 0;
  private purgadoIdx = -1;
  private readonly oyentes = new Set<() => void>();

  constructor(
    private readonly almacen: AlmacenAudio,
    private readonly storage: AlmacenamientoSimple,
    audio?: HTMLAudioElement,
  ) {
    this.audio = audio ?? document.createElement('audio');
    this.audio.preload = 'auto';
    this.audio.setAttribute('playsinline', '');
    this.audio.setAttribute('webkit-playsinline', '');
    this.velocidad = normalizarVelocidad(storage.getItem(CLAVE_VELOCIDAD));
    this.aplicarVelocidad();
    this.conectarEventos();
    this.conectarMediaSession();
  }

  // ───────────── API pública ─────────────

  alCambiar(fn: () => void): () => void {
    this.oyentes.add(fn);
    return () => this.oyentes.delete(fn);
  }

  get indice(): number {
    return this.idx;
  }
  get libroActual(): LibroGuardado | null {
    return this.libro;
  }
  get capituloActual(): Capitulo | null {
    return this.libro?.libro.capitulos[this.idx] ?? null;
  }
  get velocidadActual(): number {
    return this.velocidad;
  }
  get hayAudioCargado(): boolean {
    return this.urlActual !== null;
  }
  pistaGenerada(capituloId: string): boolean {
    return this.pistas.has(capituloId);
  }

  /** Establece el libro (o null) y restaura la posición guardada, sin reproducir. */
  async abrirLibro(libro: LibroGuardado | null): Promise<void> {
    this.token++;
    this.audio.pause();
    this.soltar();
    this.descartarSiguiente();
    this.libro = libro;
    this.idx = -1;
    this.pistas = new Set();
    this.purgadoIdx = -1;
    this.mensaje = null;
    if (!libro || libro.libro.capitulos.length === 0) {
      this.emitir();
      return;
    }
    try {
      this.pistas = new Set((await this.almacen.listarPistas(libro.id)).map((p) => p.capituloId));
    } catch {
      /* sin pistas */
    }
    const caps = libro.libro.capitulos;
    const pos = leerPosicion(this.storage);
    let idx = 0;
    let seg = 0;
    if (pos && pos.libroId === libro.id) {
      const i = caps.findIndex((c) => c.id === pos.capituloId);
      if (i >= 0) {
        idx = i;
        seg = pos.segundo;
      }
    }
    await this.cargarCapitulo(idx, seg, false);
  }

  /** Vuelve a leer qué capítulos hay generados (llamar tras generar o borrar). */
  async refrescarPistas(): Promise<void> {
    if (!this.libro) return;
    try {
      this.pistas = new Set((await this.almacen.listarPistas(this.libro.id)).map((p) => p.capituloId));
    } catch {
      return;
    }
    const cap = this.capituloActual;
    if (cap && !this.urlActual && this.pistas.has(cap.id)) {
      await this.cargarCapitulo(this.idx, this.segundoPendiente, false);
    } else {
      void this.precargarSiguiente();
      this.emitir();
    }
  }

  /** Va a un capítulo (cargando su audio si está generado). */
  async cargarCapitulo(idx: number, segundo = 0, reproducir = false): Promise<void> {
    const libro = this.libro;
    const cap = libro?.libro.capitulos[idx];
    if (!libro || !cap) return;
    this.audio.pause();
    const tk = ++this.token;
    this.idx = idx;
    this.mensaje = null;
    this.segundoPendiente = segundo;
    this.cargado = false;
    this.purgadoIdx = -1;

    if (!this.pistas.has(cap.id)) {
      this.soltar();
      this.guardarPos();
      this.emitir();
      return;
    }
    let url: string;
    if (this.siguiente && this.siguiente.idx === idx) {
      url = this.siguiente.url;
      this.siguiente = null;
    } else {
      let blob: Blob | null = null;
      try {
        blob = await this.almacen.obtenerAudio(libro.id, cap.id);
      } catch {
        blob = null;
      }
      if (tk !== this.token) return;
      if (!blob) {
        this.pistas.delete(cap.id);
        this.soltar();
        this.mensaje = 'No se encuentra el audio de este capítulo. Vuelve a generarlo.';
        this.emitir();
        return;
      }
      url = URL.createObjectURL(blob);
    }
    this.ponerSrc(url);
    this.guardarPos();
    this.actualizarMetadata();
    this.emitir();
    void this.precargarSiguiente();
    if (reproducir) await this.intentarPlay();
  }

  async reproducir(): Promise<void> {
    const cap = this.capituloActual;
    if (!this.libro || !cap) return;
    const sig = this.libro.libro.capitulos[this.idx + 1];
    if (this.audio.ended && sig && this.pistas.has(sig.id)) {
      await this.cargarCapitulo(this.idx + 1, 0, true);
      return;
    }
    if (!this.pistas.has(cap.id)) {
      this.mensaje = 'Este capítulo aún no está generado.';
      this.emitir();
      return;
    }
    if (!this.urlActual || this.audio.error || this.audio.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
      await this.cargarCapitulo(this.idx, this.segundoGuardado(), true);
      return;
    }
    this.mensaje = null;
    await this.intentarPlay();
  }

  pausar(): void {
    this.audio.pause();
  }

  async alternar(): Promise<void> {
    if (this.audio.paused || this.audio.ended) await this.reproducir();
    else this.pausar();
  }

  saltar(delta: number): void {
    if (!this.urlActual) return;
    this.irA(this.audio.currentTime + delta);
  }

  irA(segundo: number): void {
    if (!this.urlActual) return;
    const dur = this.audio.duration;
    const max = Number.isFinite(dur) ? dur : Infinity;
    this.audio.currentTime = limitar(segundo, 0, max);
  }

  fijarVelocidad(v: number): void {
    this.velocidad = normalizarVelocidad(v);
    try {
      this.storage.setItem(CLAVE_VELOCIDAD, String(this.velocidad));
    } catch {
      /* no crítico */
    }
    this.aplicarVelocidad();
    this.emitir();
  }

  // ───────────── Internos ─────────────

  private emitir(): void {
    for (const fn of this.oyentes) fn();
  }

  private aplicarVelocidad(): void {
    // Safari reinicia playbackRate al cambiar src: se reaplica en varios eventos.
    this.audio.defaultPlaybackRate = this.velocidad;
    this.audio.playbackRate = this.velocidad;
  }

  private ponerSrc(url: string): void {
    const vieja = this.urlActual;
    this.urlActual = url;
    this.audio.src = url;
    this.aplicarVelocidad();
    if (vieja && vieja !== url) URL.revokeObjectURL(vieja);
  }

  private soltar(): void {
    if (this.urlActual) {
      const u = this.urlActual;
      this.urlActual = null;
      this.audio.removeAttribute('src');
      this.audio.load();
      URL.revokeObjectURL(u);
    }
    this.cargado = false;
  }

  private descartarSiguiente(): void {
    if (this.siguiente) URL.revokeObjectURL(this.siguiente.url);
    this.siguiente = null;
  }

  private async intentarPlay(): Promise<void> {
    try {
      await this.audio.play();
    } catch {
      this.mensaje = 'Pulsa play para continuar';
      this.emitir();
    }
  }

  private segundoGuardado(): number {
    if (this.cargado && !this.audio.error && Number.isFinite(this.audio.currentTime) && this.audio.currentTime > 0) {
      return this.audio.currentTime;
    }
    const pos = leerPosicion(this.storage);
    const cap = this.capituloActual;
    if (pos && this.libro && cap && pos.libroId === this.libro.id && pos.capituloId === cap.id) return pos.segundo;
    return this.segundoPendiente;
  }

  private guardarPos(segundoForzado?: number): void {
    const cap = this.capituloActual;
    if (!this.libro || !cap) return;
    let seg = segundoForzado ?? (this.cargado ? this.audio.currentTime : this.segundoPendiente);
    if (!Number.isFinite(seg) || seg < 0) seg = 0;
    guardarPosicion(this.storage, {
      libroId: this.libro.id,
      capituloId: cap.id,
      segundo: seg,
      actualizada: Date.now(),
    });
  }

  private async precargarSiguiente(): Promise<void> {
    const libro = this.libro;
    const n = this.idx + 1;
    const cap = libro?.libro.capitulos[n];
    if (!libro || !cap || !this.pistas.has(cap.id)) return;
    if (this.siguiente?.idx === n || this.precargando === n) return;
    this.descartarSiguiente();
    this.precargando = n;
    const tk = this.token;
    let blob: Blob | null = null;
    try {
      blob = await this.almacen.obtenerAudio(libro.id, cap.id);
    } catch {
      blob = null;
    }
    this.precargando = -1;
    if (!blob || tk !== this.token || this.idx + 1 !== n) return;
    this.siguiente = { idx: n, url: URL.createObjectURL(blob) };
  }

  /** Borra las pistas de capítulos anteriores al que suena (ventana de capítulos). */
  private async purgar(): Promise<void> {
    if (!this.libro || this.purgadoIdx === this.idx) return;
    this.purgadoIdx = this.idx;
    const ids = capitulosABorrar(
      this.libro.libro.capitulos.map((c) => c.id),
      this.idx,
      this.pistas,
    );
    for (const id of ids) {
      try {
        await this.almacen.borrarPista(this.libro.id, id);
        this.pistas.delete(id);
      } catch {
        /* se reintentará más adelante */
      }
    }
    if (ids.length) this.emitir();
  }

  private onEnded(): void {
    const libro = this.libro;
    const caps = libro?.libro.capitulos;
    if (!libro || !caps) return;
    const n = this.idx + 1;
    const sig = this.siguiente;
    if (sig && sig.idx === n && caps[n]) {
      // Todo síncrono: cambiar src y play() sin awaits (permite seguir con la pantalla bloqueada).
      this.token++;
      this.idx = n;
      this.siguiente = null;
      this.cargado = false;
      this.segundoPendiente = 0;
      this.purgadoIdx = -1;
      this.mensaje = null;
      this.ponerSrc(sig.url);
      const p = this.audio.play();
      p.catch(() => {
        this.mensaje = 'Pulsa play para continuar';
        this.emitir();
      });
      this.actualizarMetadata();
      this.guardarPos(0);
      this.emitir();
      void this.precargarSiguiente();
      return;
    }
    this.guardarPos(0);
    const cap = caps[n];
    if (!cap) this.mensaje = 'Has llegado al final del libro.';
    else if (!this.pistas.has(cap.id)) this.mensaje = 'El siguiente capítulo aún no está generado. Genéralo en la pestaña Generar.';
    else this.mensaje = 'Pulsa play para continuar';
    this.estadoReproduccion('paused');
    this.emitir();
  }

  private conectarEventos(): void {
    const a = this.audio;
    a.addEventListener('loadstart', () => this.aplicarVelocidad());
    a.addEventListener('loadedmetadata', () => {
      this.cargado = true;
      this.aplicarVelocidad();
      const dur = a.duration;
      const seg = this.segundoPendiente;
      if (seg > 0 && (!Number.isFinite(dur) || seg < dur - 1)) {
        try {
          a.currentTime = seg;
        } catch {
          /* se ignora */
        }
      }
      this.segundoPendiente = 0;
      this.posicionMediaSession();
      this.emitir();
    });
    a.addEventListener('playing', () => {
      if (a.playbackRate !== this.velocidad) this.aplicarVelocidad();
      this.estadoReproduccion('playing');
      this.posicionMediaSession();
      void this.purgar();
    });
    a.addEventListener('play', () => this.estadoReproduccion('playing'));
    a.addEventListener('pause', () => {
      if (!a.ended) this.estadoReproduccion('paused');
      this.guardarPos();
      this.posicionMediaSession();
    });
    a.addEventListener('ratechange', () => this.posicionMediaSession());
    a.addEventListener('seeked', () => {
      this.guardarPos();
      this.posicionMediaSession();
    });
    a.addEventListener('timeupdate', () => {
      const ahora = Date.now();
      if (!a.paused && ahora - this.ultimoPeriodico >= INTERVALO_GUARDADO_MS) {
        this.ultimoPeriodico = ahora;
        this.guardarPos();
        this.posicionMediaSession();
      }
    });
    a.addEventListener('ended', () => this.onEnded());
    a.addEventListener('error', () => {
      if (!this.urlActual) return;
      this.mensaje = 'Error al reproducir el audio. Pulsa play para recargarlo.';
      this.emitir();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.guardarPos();
    });
    window.addEventListener('pagehide', () => this.guardarPos());
  }

  // ───────────── Media Session (todo protegido: no todos los navegadores la soportan) ─────────────

  private conectarMediaSession(): void {
    try {
      if (!('mediaSession' in navigator)) return;
      const ms = navigator.mediaSession;
      const poner = (accion: MediaSessionAction, fn: MediaSessionActionHandler) => {
        try {
          ms.setActionHandler(accion, fn);
        } catch {
          /* acción no soportada */
        }
      };
      poner('play', () => void this.reproducir());
      poner('pause', () => this.pausar());
      poner('seekbackward', (d) => this.saltar(-(d.seekOffset ?? SALTO_SEG)));
      poner('seekforward', (d) => this.saltar(d.seekOffset ?? SALTO_SEG));
      poner('seekto', (d) => {
        if (d.seekTime !== undefined && d.seekTime !== null) this.irA(d.seekTime);
      });
      // No se registran previoustrack/nexttrack: así iOS muestra los botones de ±segundos.
    } catch {
      /* sin Media Session */
    }
  }

  private actualizarMetadata(): void {
    try {
      if (!('mediaSession' in navigator) || typeof MediaMetadata === 'undefined') return;
      const cap = this.capituloActual;
      if (!cap || !this.libro) return;
      navigator.mediaSession.metadata = new MediaMetadata({
        title: cap.titulo,
        artist: this.libro.libro.titulo,
        album: ALBUM,
      });
    } catch {
      /* no crítico */
    }
  }

  private estadoReproduccion(estado: MediaSessionPlaybackState): void {
    try {
      if ('mediaSession' in navigator) navigator.mediaSession.playbackState = estado;
    } catch {
      /* no crítico */
    }
  }

  private posicionMediaSession(): void {
    try {
      if (!('mediaSession' in navigator)) return;
      const d = this.audio.duration;
      if (!Number.isFinite(d) || d <= 0) return;
      navigator.mediaSession.setPositionState({
        duration: d,
        playbackRate: this.audio.playbackRate || 1,
        position: limitar(this.audio.currentTime || 0, 0, d),
      });
    } catch {
      /* no crítico */
    }
  }
}
