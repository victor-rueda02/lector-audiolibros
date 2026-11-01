import type { Contexto, Vista } from './contexto.ts';
import { el, vaciar } from './dom.ts';
import { VELOCIDADES, formatearTiempo, formatearVelocidad, SALTO_SEG } from '../reproductor/logica.ts';

export function crearVistaEscuchar(ctx: Contexto): Vista {
  const r = ctx.reproductor;
  const a = r.audio;

  const tLibro = el('p', { class: 'nota', testid: 'escuchar-libro' });
  const tCapitulo = el('h2', { class: 'titulo-capitulo', testid: 'escuchar-capitulo' });
  const mensaje = el('p', { class: 'aviso', role: 'status', hidden: true, testid: 'mensaje-reproductor' });
  const botonIrGenerar = el('button', {
    type: 'button',
    class: 'boton boton-principal',
    testid: 'ir-generar',
    text: 'Ir a Generar',
    onclick: () => ctx.ir('generar'),
  });
  const avisoNoGenerado = el('div', { class: 'aviso', testid: 'aviso-no-generado', hidden: true },
    el('p', { text: 'Este capítulo aún no está generado.' }),
    botonIrGenerar,
  );

  const botonPlay = el('button', { type: 'button', class: 'boton-play', testid: 'boton-play', 'aria-label': 'Reproducir', text: '▶' });
  const botonAtras = el('button', { type: 'button', class: 'boton boton-salto', testid: 'boton-atras-30', text: `−${SALTO_SEG} s`, 'aria-label': `Retroceder ${SALTO_SEG} segundos` });
  const botonAdelante = el('button', { type: 'button', class: 'boton boton-salto', testid: 'boton-adelante-30', text: `+${SALTO_SEG} s`, 'aria-label': `Adelantar ${SALTO_SEG} segundos` });
  const barra = el('input', { type: 'range', min: '0', max: '1', step: '1', value: '0', class: 'deslizador', testid: 'barra-progreso', 'aria-label': 'Posición' });
  const tActual = el('span', { testid: 'tiempo-actual', text: '0:00' });
  const tTotal = el('span', { testid: 'tiempo-total', text: '0:00' });
  const selector = el('select', { class: 'selector', testid: 'selector-velocidad', 'aria-label': 'Velocidad' },
    ...VELOCIDADES.map((v) => el('option', { value: String(v), text: formatearVelocidad(v) })),
  );
  const lista = el('ul', { class: 'lista', testid: 'lista-pistas' });
  let arrastrando = false;

  botonPlay.addEventListener('click', () => void r.alternar());
  botonAtras.addEventListener('click', () => r.saltar(-SALTO_SEG));
  botonAdelante.addEventListener('click', () => r.saltar(SALTO_SEG));
  selector.addEventListener('change', () => r.fijarVelocidad(Number(selector.value)));
  barra.addEventListener('input', () => {
    arrastrando = true;
    tActual.textContent = formatearTiempo(Number(barra.value));
  });
  barra.addEventListener('change', () => {
    arrastrando = false;
    r.irA(Number(barra.value));
  });

  function pintarTiempo() {
    const dur = Number.isFinite(a.duration) ? a.duration : 0;
    barra.max = String(Math.max(1, Math.floor(dur)));
    barra.disabled = !r.hayAudioCargado;
    if (!arrastrando) {
      barra.value = String(Math.floor(a.currentTime || 0));
      tActual.textContent = formatearTiempo(a.currentTime);
    }
    tTotal.textContent = formatearTiempo(dur);
  }

  function pintar() {
    const g = ctx.libro;
    const cap = r.capituloActual;
    tLibro.textContent = g ? g.libro.titulo : 'Sin libro';
    tCapitulo.textContent = cap ? cap.titulo : g ? 'Sin capítulos' : 'Abre un libro en la pestaña Libro';
    const generado = !!cap && r.pistaGenerada(cap.id);
    avisoNoGenerado.hidden = !(g && cap && !generado);
    botonPlay.disabled = !generado;
    const sonando = !a.paused && !a.ended;
    botonPlay.textContent = sonando ? '⏸' : '▶';
    botonPlay.setAttribute('aria-label', sonando ? 'Pausar' : 'Reproducir');
    botonAtras.disabled = botonAdelante.disabled = !generado;
    selector.value = String(r.velocidadActual);
    mensaje.hidden = !r.mensaje;
    mensaje.textContent = r.mensaje ?? '';
    pintarTiempo();

    vaciar(lista);
    if (g) {
      g.libro.capitulos.forEach((c, i) => {
        if (!r.pistaGenerada(c.id)) return;
        lista.append(
          el('li', { class: 'pista' },
            el('button', {
              type: 'button',
              class: `boton${i === r.indice ? ' boton-principal' : ''}`,
              testid: `escuchar-${c.id}`,
              text: `${i === r.indice ? '▶ ' : ''}${c.titulo}`,
              onclick: () => void r.cargarCapitulo(i, 0, true),
            }),
          ),
        );
      });
    }
  }

  r.alCambiar(pintar);
  for (const ev of ['play', 'pause', 'playing', 'ended', 'ratechange', 'loadedmetadata', 'durationchange', 'seeked']) {
    a.addEventListener(ev, pintar);
  }
  a.addEventListener('timeupdate', pintarTiempo);

  const raiz = el('section', { class: 'vista' },
    tLibro,
    tCapitulo,
    mensaje,
    avisoNoGenerado,
    el('div', { class: 'centrado' }, botonPlay),
    el('div', { class: 'fila' }, botonAtras, botonAdelante),
    barra,
    el('div', { class: 'tiempos' }, tActual, tTotal),
    el('label', { class: 'campo' }, el('span', { text: 'Velocidad' }), selector),
    el('h3', { text: 'Capítulos generados' }),
    lista,
  );
  return { raiz, refrescar: pintar };
}
