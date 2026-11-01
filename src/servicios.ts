/** Cableado de las implementaciones reales que recibe la UI. */
import type { Servicios } from './tipos.ts';
import { extraerLibro } from './pdf/index.ts';
import { crearGeneradorAudio } from './voz/index.ts';
import { crearAlmacen } from './almacen/index.ts';
import { montarDiagnostico } from './diagnostico/index.ts';

export function crearServicios(): Servicios {
  const generador = crearGeneradorAudio();
  const almacen = crearAlmacen();
  return {
    extraerLibro,
    generador,
    almacen,
    montarDiagnostico: (contenedor) => montarDiagnostico(contenedor, { generador, almacen }),
  };
}
