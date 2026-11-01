import { CLAVES_LOCAL } from '../tipos.ts';
import type { Voz } from '../tipos.ts';
import type { Contexto, Vista } from './contexto.ts';
import { el, vaciar } from './dom.ts';

export function crearVistaVoz(ctx: Contexto): Vista {
  const lista = el('ul', { class: 'lista', testid: 'lista-voces' });
  const estado = el('p', { class: 'nota', role: 'status' });
  const muestra = new Audio();
  muestra.preload = 'none';
  let sonando: string | null = null;
  let cargada = false;
  let cargando = false;
  const botonesMuestra = new Map<string, HTMLButtonElement>();

  function pintarMuestras() {
    for (const [id, b] of botonesMuestra) b.textContent = id === sonando ? '■ Parar' : '▶ Muestra';
  }
  muestra.addEventListener('ended', () => {
    sonando = null;
    pintarMuestras();
  });
  muestra.addEventListener('error', () => {
    if (sonando === null) return;
    sonando = null;
    estado.textContent = 'No se pudo reproducir la muestra (¿sin conexión?).';
    pintarMuestras();
  });

  function alternarMuestra(v: Voz) {
    if (!v.urlMuestra) return;
    if (sonando === v.id) {
      muestra.pause();
      sonando = null;
    } else {
      muestra.pause();
      muestra.src = v.urlMuestra;
      sonando = v.id;
      estado.textContent = '';
      muestra.play().catch(() => {
        sonando = null;
        estado.textContent = 'No se pudo reproducir la muestra.';
        pintarMuestras();
      });
    }
    pintarMuestras();
  }

  function elegir(v: Voz) {
    try {
      localStorage.setItem(CLAVES_LOCAL.vozId, v.id);
    } catch {
      /* no crítico */
    }
    void pintar();
  }

  async function pintar() {
    let voces: Voz[];
    try {
      voces = await ctx.voces();
    } catch (e) {
      estado.textContent = `No se pudo cargar la lista de voces: ${e instanceof Error ? e.message : String(e)}`;
      cargada = false;
      return;
    }
    const elegida = ctx.vozId();
    const descargadas = await Promise.all(voces.map((v) => ctx.servicios.generador.vozDescargada(v.id).catch(() => false)));
    vaciar(lista);
    botonesMuestra.clear();
    estado.textContent = '';
    voces.forEach((v, i) => {
      const esElegida = v.id === elegida;
      const bMuestra = el('button', {
        type: 'button',
        class: 'boton',
        testid: `muestra-${v.id}`,
        disabled: v.urlMuestra === null,
        text: '▶ Muestra',
        onclick: () => alternarMuestra(v),
      });
      botonesMuestra.set(v.id, bMuestra);
      lista.append(
        el('li', { class: `voz-item${esElegida ? ' elegida' : ''}`, testid: `voz-${v.id}` },
          el('div', { class: 'voz-nombre', text: v.nombre }),
          el('div', { class: 'nota', text: `Descarga: ${v.tamanoMB} MB · ${descargadas[i] ? 'ya descargada' : 'se descargará al generar'}` }),
          esElegida ? el('div', { class: 'etiqueta', text: 'Voz elegida ✓' }) : null,
          el('div', { class: 'fila' },
            bMuestra,
            el('button', {
              type: 'button',
              class: `boton${esElegida ? '' : ' boton-principal'}`,
              testid: `elegir-${v.id}`,
              text: esElegida ? 'Elegida' : 'Elegir',
              onclick: () => elegir(v),
            }),
          ),
        ),
      );
    });
    pintarMuestras();
  }

  function refrescar() {
    if (cargando) return;
    cargando = true;
    estado.textContent = cargada ? '' : 'Cargando voces…';
    void pintar().then(() => {
      cargada = true;
      cargando = false;
    });
  }

  const raiz = el('section', { class: 'vista' }, el('h2', { text: 'Voz' }), estado, lista);
  return { raiz, refrescar };
}
