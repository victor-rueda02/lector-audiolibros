import type { PistaGuardada, ProgresoGeneracion } from '../tipos.ts';
import type { Contexto, Vista } from './contexto.ts';
import { el } from './dom.ts';
import {
  OPCIONES_N,
  capitulosAGenerar,
  contarPalabras,
  estimarBytes,
  estimarRestante,
  etiquetaFase,
  formatearBytes,
  formatearReloj,
  normalizarN,
} from './logica.ts';

const CLAVE_N = 'lector.nGenerar';
const CLAVE_PERSISTENCIA = 'lector.persistenciaPedida';

export function crearVistaGenerar(ctx: Contexto): Vista {
  let generando = false;
  let ac: AbortController | null = null;
  let wake: WakeLockSentinel | null = null;

  const resumen = el('p', { class: 'nota' });
  const selectN = el('select', { class: 'selector', testid: 'selector-cantidad', 'aria-label': 'Cuántos capítulos generar' },
    ...OPCIONES_N.map((n) => el('option', { value: String(n), text: n === 1 ? '1 capítulo' : `${n} capítulos` })),
  );
  selectN.value = String(normalizarN(localStorage.getItem(CLAVE_N)));
  selectN.addEventListener('change', () => {
    try {
      localStorage.setItem(CLAVE_N, selectN.value);
    } catch {
      /* no crítico */
    }
  });
  const botonGenerar = el('button', { type: 'button', class: 'boton boton-principal', testid: 'boton-generar', text: 'Generar audio' });
  const avisoPantalla = el('p', { class: 'aviso', text: 'Mantén Safari abierto y la pantalla encendida mientras se genera.', testid: 'aviso-pantalla' });
  const mensaje = el('p', { class: 'aviso', role: 'status', hidden: true, testid: 'mensaje-generar' });

  const tCapitulo = el('p', { class: 'ffuerte', testid: 'texto-capitulo-generando' });
  const tFase = el('p', { class: 'nota' });
  const barraCap = el('progress', { class: 'barra', max: '1', value: '0', testid: 'barra-capitulo' });
  const tTotal = el('p', { class: 'nota', text: 'Total' });
  const barraTotal = el('progress', { class: 'barra', max: '1', value: '0', testid: 'barra-total' });
  const tTiempos = el('p', { class: 'nota', testid: 'texto-tiempos' });
  const botonCancelar = el('button', { type: 'button', class: 'boton boton-peligro', testid: 'boton-cancelar', text: 'Cancelar' });
  const panel = el('div', { class: 'panel', testid: 'progreso-generacion', hidden: true },
    tCapitulo, tFase, barraCap, tTotal, barraTotal, tTiempos, botonCancelar,
  );
  const terminada = el('p', { class: 'aviso aviso-ok', role: 'status', hidden: true, testid: 'generacion-terminada' });

  function decir(msg: string | null) {
    mensaje.hidden = msg === null;
    mensaje.textContent = msg ?? '';
  }

  async function pedirWake() {
    try {
      if (!generando || wake || !('wakeLock' in navigator)) return;
      wake = await navigator.wakeLock.request('screen');
      wake.addEventListener('release', () => {
        wake = null;
      });
    } catch {
      wake = null;
    }
  }
  function soltarWake() {
    try {
      void wake?.release();
    } catch {
      /* no crítico */
    }
    wake = null;
  }
  document.addEventListener('visibilitychange', () => {
    if (!generando) return;
    if (document.visibilityState === 'visible') {
      void pedirWake();
      decir('Safari estuvo en segundo plano: la generación puede haberse ralentizado. Mantén la pantalla encendida.');
    }
  });

  async function generar() {
    const g = ctx.libro;
    if (!g || g.libro.capitulos.length === 0) {
      decir('Primero abre un libro con texto en la pestaña Libro.');
      return;
    }
    decir(null);
    terminada.hidden = true;
    const caps = g.libro.capitulos;
    const voz = ctx.vozId();
    const n = normalizarN(selectN.value);
    let pistas: PistaGuardada[] = [];
    try {
      pistas = await ctx.servicios.almacen.listarPistas(g.id);
    } catch {
      /* se genera todo */
    }
    const hechos = new Set(pistas.filter((p) => p.vozId === voz).map((p) => p.capituloId));
    const lista = capitulosAGenerar(caps.map((c) => c.id), Math.max(0, ctx.reproductor.indice), n, hechos);
    if (lista.length === 0) {
      terminada.hidden = false;
      terminada.textContent = 'Los capítulos que vienen ya están generados con esta voz. Ve a Escuchar.';
      return;
    }

    generando = true;
    ac = new AbortController();
    const signal = ac.signal;
    botonGenerar.disabled = true;
    selectN.disabled = true;
    panel.hidden = false;
    if (!localStorage.getItem(CLAVE_PERSISTENCIA)) {
      try {
        localStorage.setItem(CLAVE_PERSISTENCIA, '1');
      } catch {
        /* no crítico */
      }
      void ctx.servicios.almacen.pedirPersistencia().catch(() => false);
    }
    void pedirWake();

    const inicio = Date.now();
    const palabrasDe = (id: string) => contarPalabras(caps.find((c) => c.id === id)!.parrafos);
    let calculoSeg = 0;
    let calculoPalabras = 0;
    let k = 0;
    let ultimo: ProgresoGeneracion | null = null;

    const pintar = () => {
      const p = ultimo;
      const id = lista[Math.min(k, lista.length - 1)]!;
      const cap = caps.find((c) => c.id === id)!;
      tCapitulo.textContent = `Capítulo ${Math.min(k + 1, lista.length)} de ${lista.length}: ${cap.titulo}`;
      const fraccion = p ? (p.fase === 'generando' ? p.fraccion : p.fase === 'codificando' ? 1 : p.fraccion) : 0;
      const fraccionTotal = p ? (p.fase === 'generando' ? p.fraccion : p.fase === 'codificando' ? 1 : 0) : 0;
      tFase.textContent = p ? `${etiquetaFase(p.fase)} (${Math.round(fraccion * 100)} %)` : 'Preparando…';
      barraCap.value = fraccion;
      barraTotal.value = (k + fraccionTotal) / lista.length;
      tTotal.textContent = `Total: ${Math.round(barraTotal.value * 100)} %`;
      const pendientes = lista.slice(k + 1).reduce((s, i) => s + palabrasDe(i), 0);
      let tasa: number | null = calculoPalabras > 0 ? calculoSeg / calculoPalabras : null;
      if (tasa === null && p && p.fase === 'generando' && p.fraccion > 0.05 && p.segundosCalculo > 0) {
        tasa = p.segundosCalculo / (p.fraccion * palabrasDe(id));
      }
      const resto = p ? estimarRestante(p.etaSegundos, pendientes, tasa) : null;
      tTiempos.textContent =
        `Transcurrido: ${formatearReloj((Date.now() - inicio) / 1000)} · ` +
        (resto === null ? 'Restante: calculando…' : `Restante: unos ${formatearReloj(resto)}`);
    };
    const reloj = setInterval(pintar, 1000);
    pintar();

    let completados = 0;
    try {
      for (; k < lista.length; k++) {
        const id = lista[k]!;
        const cap = caps.find((c) => c.id === id)!;
        const palabras = palabrasDe(id);
        ultimo = null;
        try {
          const est = await ctx.servicios.almacen.estado();
          const necesario = estimarBytes(palabras);
          if (est.libreBytes !== null && est.libreBytes < necesario) {
            decir(
              `No hay espacio suficiente para "${cap.titulo}": hacen falta unos ${formatearBytes(necesario)} y quedan ${formatearBytes(Math.max(0, est.libreBytes))}. Libera espacio en el iPhone.`,
            );
            break;
          }
        } catch {
          /* sin datos de cuota: se intenta igualmente */
        }
        pintar();
        const r = await ctx.servicios.generador.generarCapitulo(
          cap,
          voz,
          (p) => {
            ultimo = p;
            pintar();
          },
          signal,
        );
        calculoSeg += r.segundosCalculo;
        calculoPalabras += palabras;
        await ctx.servicios.almacen.guardarPista(
          {
            libroId: g.id,
            capituloId: cap.id,
            vozId: voz,
            duracionSeg: r.duracionSeg,
            bytes: r.audio.size,
            tipoMime: r.tipoMime,
            creada: Date.now(),
          },
          r.audio,
        );
        completados++;
        await ctx.reproductor.refrescarPistas();
      }
      if (completados > 0) {
        terminada.hidden = false;
        terminada.textContent =
          completados === lista.length
            ? `Listo: ${completados} ${completados === 1 ? 'capítulo generado' : 'capítulos generados'}. Ya puedes escuchar.`
            : `Se generaron ${completados} de ${lista.length} capítulos.`;
      }
    } catch (e) {
      if (signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) {
        decir('Generación cancelada. Lo que ya se generó se conserva.');
        if (completados > 0) {
          terminada.hidden = false;
          terminada.textContent = `Se generaron ${completados} de ${lista.length} capítulos antes de cancelar.`;
        }
      } else {
        decir(`Error al generar: ${e instanceof Error ? e.message : String(e)}`);
      }
    } finally {
      clearInterval(reloj);
      generando = false;
      ac = null;
      soltarWake();
      panel.hidden = true;
      botonGenerar.disabled = false;
      selectN.disabled = false;
      refrescar();
    }
  }

  botonGenerar.addEventListener('click', () => void generar());
  botonCancelar.addEventListener('click', () => ac?.abort());

  function refrescar() {
    const g = ctx.libro;
    if (generando) return;
    botonGenerar.disabled = !g;
    if (!g) {
      resumen.textContent = 'Primero abre un libro en la pestaña Libro.';
      return;
    }
    const cap = ctx.reproductor.capituloActual;
    void ctx.voces().then(
      (voces) => {
        const v = voces.find((x) => x.id === ctx.vozId());
        resumen.textContent = `Empieza en: ${cap?.titulo ?? '—'} · Voz: ${v?.nombre ?? ctx.vozId()}`;
      },
      () => {
        resumen.textContent = `Empieza en: ${cap?.titulo ?? '—'} · Voz: ${ctx.vozId()}`;
      },
    );
  }

  const raiz = el('section', { class: 'vista' },
    el('h2', { text: 'Generar' }),
    resumen,
    el('label', { class: 'campo' }, el('span', { text: 'Cuántos capítulos generar' }), selectN),
    botonGenerar,
    avisoPantalla,
    mensaje,
    panel,
    terminada,
  );
  return { raiz, refrescar };
}
