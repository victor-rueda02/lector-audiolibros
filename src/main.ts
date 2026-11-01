import { iniciarApp } from './ui/app.ts';
import type { Servicios } from './tipos.ts';

// Con ?falsos en la URL se usan servicios simulados (desarrollo de la interfaz sin PDF ni modelos de voz).
async function obtenerServicios(): Promise<Servicios> {
  if (new URLSearchParams(location.search).has('falsos')) {
    return (await import('./ui/falsos.ts')).crearServiciosFalsos();
  }
  return (await import('./servicios.ts')).crearServicios();
}

void obtenerServicios().then((servicios) => iniciarApp(document.querySelector<HTMLElement>('#app')!, servicios));
