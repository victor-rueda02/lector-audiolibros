import type { LibroGuardado, Servicios, Voz } from '../tipos.ts';
import type { Reproductor } from '../reproductor/reproductor.ts';

export type Pestana = 'libro' | 'voz' | 'generar' | 'escuchar' | 'diagnostico';

export interface Contexto {
  servicios: Servicios;
  reproductor: Reproductor;
  libro: LibroGuardado | null;
  ir(p: Pestana): void;
  /** Avisa a todas las vistas de que cambió el libro guardado. */
  libroCambiado(): void;
  /** Id de la voz elegida (o la de por defecto). */
  vozId(): string;
  /** Lista de voces (se pide una sola vez salvo error). */
  voces(): Promise<Voz[]>;
}

export interface Vista {
  raiz: HTMLElement;
  /** Se llama al mostrar la pestaña y cuando cambia el libro. */
  refrescar(): void;
}
