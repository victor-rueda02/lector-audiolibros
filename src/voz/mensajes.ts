/** Protocolo entre el hilo principal y el Worker de generación. */
import type { ProgresoGeneracion } from '../tipos.ts';
import type { Segmento } from './frases.ts';

export type MensajeAlWorker =
  | { tipo: 'generar'; id: number; vozId: string; segmentos: Segmento[] }
  | { tipo: 'cancelar'; id: number };

export type MensajeDelWorker =
  | { tipo: 'progreso'; id: number; progreso: ProgresoGeneracion }
  | { tipo: 'fin'; id: number; mp3: ArrayBuffer; duracionSeg: number; segundosCalculo: number }
  | { tipo: 'cancelado'; id: number }
  | { tipo: 'error'; id: number; mensaje: string };
