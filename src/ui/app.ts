import './estilos.css';
import { CLAVES_LOCAL, VOZ_POR_DEFECTO } from '../tipos.ts';
import type { LibroGuardado, Servicios, Voz } from '../tipos.ts';
import { Reproductor } from '../reproductor/reproductor.ts';
import type { Contexto, Pestana, Vista } from './contexto.ts';
import { el } from './dom.ts';
import { crearVistaEscuchar } from './vista-escuchar.ts';
import { crearVistaGenerar } from './vista-generar.ts';
import { crearVistaLibro } from './vista-libro.ts';
import { crearVistaVoz } from './vista-voz.ts';

const PESTANAS: { id: Pestana; texto: string; icono: string }[] = [
  { id: 'libro', texto: 'Libro', icono: '📖' },
  { id: 'voz', texto: 'Voz', icono: '🗣️' },
  { id: 'generar', texto: 'Generar', icono: '⚙️' },
  { id: 'escuchar', texto: 'Escuchar', icono: '🎧' },
  { id: 'diagnostico', texto: 'Diagnóstico', icono: '🩺' },
];

export async function iniciarApp(contenedor: HTMLElement, servicios: Servicios): Promise<void> {
  // Único <audio> de toda la app.
  const audio = el('audio', { testid: 'audio-reproductor', preload: 'auto', playsinline: true, class: 'audio-oculto' });
  const reproductor = new Reproductor(servicios.almacen, localStorage, audio);

  let vocesPromesa: Promise<Voz[]> | null = null;
  const vistas = {} as Record<Pestana, Vista>;
  let pestanaActual: Pestana = 'libro';
  let diagnosticoMontado = false;

  const ctx: Contexto = {
    servicios,
    reproductor,
    libro: null as LibroGuardado | null,
    ir: (p) => mostrar(p),
    libroCambiado: () => {
      for (const id of ['libro', 'generar', 'escuchar'] as const) vistas[id].refrescar();
    },
    vozId: () => {
      try {
        return localStorage.getItem(CLAVES_LOCAL.vozId) || VOZ_POR_DEFECTO;
      } catch {
        return VOZ_POR_DEFECTO;
      }
    },
    voces: () => {
      if (!vocesPromesa) {
        vocesPromesa = servicios.generador.listarVoces();
        vocesPromesa.catch(() => {
          vocesPromesa = null;
        });
      }
      return vocesPromesa;
    },
  };

  const diagnostico = el('section', { class: 'vista' }, el('h2', { text: 'Diagnóstico' }));
  const cuerpoDiagnostico = el('div', {});
  diagnostico.append(cuerpoDiagnostico);
  vistas.libro = crearVistaLibro(ctx);
  vistas.voz = crearVistaVoz(ctx);
  vistas.generar = crearVistaGenerar(ctx);
  vistas.escuchar = crearVistaEscuchar(ctx);
  vistas.diagnostico = { raiz: diagnostico, refrescar: () => {} };

  const botones = new Map<Pestana, HTMLButtonElement>();
  const barra = el('nav', { class: 'pestanas', role: 'tablist', 'aria-label': 'Secciones' });
  for (const p of PESTANAS) {
    const b = el('button', {
      type: 'button',
      role: 'tab',
      class: 'pestana',
      testid: `pestana-${p.id}`,
      onclick: () => mostrar(p.id),
    },
      el('span', { class: 'icono', 'aria-hidden': 'true', text: p.icono }),
      el('span', { text: p.texto }),
    );
    botones.set(p.id, b);
    barra.append(b);
  }

  const principal = el('main', { class: 'principal' }, ...PESTANAS.map((p) => vistas[p.id].raiz));
  contenedor.replaceChildren(principal, barra, audio);

  function mostrar(p: Pestana) {
    pestanaActual = p;
    for (const t of PESTANAS) {
      const activa = t.id === p;
      vistas[t.id].raiz.hidden = !activa;
      const b = botones.get(t.id)!;
      b.setAttribute('aria-selected', String(activa));
      b.classList.toggle('activa', activa);
    }
    if (p === 'diagnostico' && !diagnosticoMontado) {
      diagnosticoMontado = true;
      try {
        servicios.montarDiagnostico(cuerpoDiagnostico);
      } catch (e) {
        cuerpoDiagnostico.textContent = `No se pudo abrir el diagnóstico: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    vistas[p].refrescar();
    window.scrollTo(0, 0);
  }

  mostrar('libro');
  try {
    ctx.libro = await servicios.almacen.obtenerLibro();
  } catch {
    ctx.libro = null;
  }
  if (ctx.libro) await reproductor.abrirLibro(ctx.libro);
  ctx.libroCambiado();
  // Si hay un libro con audio listo, se abre directamente en Escuchar.
  const cap = reproductor.capituloActual;
  if (ctx.libro && cap && reproductor.pistaGenerada(cap.id) && pestanaActual === 'libro') mostrar('escuchar');
}
