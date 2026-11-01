/**
 * Pantalla de Diagnóstico: prueba de velocidad de generación, almacenamiento y entorno.
 * Estilos propios (clases `diag-`), sin depender de la UI de otros módulos.
 */
import type { AlmacenAudio, GeneradorAudio, ProgresoGeneracion, Voz } from '../tipos.ts';
import { CLAVES_LOCAL, VOZ_POR_DEFECTO } from '../tipos.ts';
import {
  formatearBytes,
  formatearSegundos,
  horasQueCaben,
  interpretarVelocidad,
  minutosPorHora,
  velocidad,
} from './calculos.ts';
import { TEXTO_PRUEBA } from './textoPrueba.ts';

const ESTILOS = `
.diag{font:16px/1.45 -apple-system,system-ui,sans-serif;padding:16px;max-width:640px;margin:0 auto}
.diag h2{font-size:22px;margin:0 0 12px}
.diag h3{font-size:18px;margin:24px 0 8px}
.diag-sec{border-top:1px solid #8884;padding-top:4px}
.diag-btn{display:block;width:100%;min-height:52px;margin:8px 0;padding:12px 16px;font-size:17px;font-weight:600;border:0;border-radius:12px;background:#0a6cff;color:#fff}
.diag-btn[disabled]{opacity:.5}
.diag-btn-sec{background:#8883;color:inherit}
.diag select{width:100%;min-height:48px;font-size:17px;border-radius:10px;padding:0 8px}
.diag-barra{height:14px;border-radius:7px;background:#8883;overflow:hidden;margin:8px 0}
.diag-barra>div{height:100%;width:0;background:#0a6cff;transition:width .2s}
.diag-tabla{width:100%;border-collapse:collapse}
.diag-tabla td{padding:6px 4px;border-bottom:1px solid #8883;vertical-align:top}
.diag-tabla td:first-child{opacity:.75;width:46%}
.diag-resultado{background:#8881;border-radius:12px;padding:8px 12px;margin:8px 0}
.diag-error{color:#d12;font-weight:600}
.diag audio{width:100%;margin-top:8px}
.diag-peq{font-size:14px;opacity:.75}
`;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { className?: string } = {},
  ...hijos: (Node | string)[]
): HTMLElementTagNameMap[K] {
  const e = Object.assign(document.createElement(tag), props);
  e.append(...hijos);
  return e;
}

function tabla(filas: [string, string][]): HTMLTableElement {
  const t = el('table', { className: 'diag-tabla' });
  for (const [k, v] of filas) t.append(el('tr', {}, el('td', {}, k), el('td', {}, v)));
  return t;
}

function soportaSimd(): boolean {
  try {
    return WebAssembly.validate(
      new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]),
    );
  } catch {
    return false;
  }
}

function esStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true;
}

const si = (b: boolean) => (b ? 'sí' : 'no');

export function montarDiagnostico(
  contenedor: HTMLElement,
  deps: { generador: GeneradorAudio; almacen: AlmacenAudio },
): void {
  const { generador, almacen } = deps;
  contenedor.replaceChildren();
  contenedor.append(el('style', {}, ESTILOS));
  const raiz = el('div', { className: 'diag' }, el('h2', {}, 'Diagnóstico'));
  contenedor.append(raiz);

  // ───────── Prueba de generación ─────────
  const selector = el('select');
  const info = el('div', { className: 'diag-peq' });
  const boton = el('button', { className: 'diag-btn', textContent: 'Generar 1 minuto de prueba' });
  const botonCancelar = el('button', { className: 'diag-btn diag-btn-sec', textContent: 'Cancelar', hidden: true });
  const estado = el('div', {});
  const barraInterna = el('div');
  const barra = el('div', { className: 'diag-barra', hidden: true }, barraInterna);
  const resultado = el('div', { hidden: true });
  raiz.append(
    el('div', { className: 'diag-sec' }, el('h3', {}, 'Prueba de velocidad'), selector, info, boton, botonCancelar, barra, estado, resultado),
  );

  let voces: Voz[] = [];
  const guardada = localStorage.getItem(CLAVES_LOCAL.vozId) ?? VOZ_POR_DEFECTO;

  const actualizarInfo = async () => {
    const v = voces.find((x) => x.id === selector.value);
    if (!v) return;
    const baja = await generador.vozDescargada(v.id).catch(() => false);
    info.textContent = baja ? 'Voz ya descargada en este dispositivo.' : `Se descargarán unos ${v.tamanoMB} MB la primera vez.`;
  };
  selector.addEventListener('change', () => void actualizarInfo());
  generador
    .listarVoces()
    .then((lista) => {
      voces = lista;
      for (const v of lista) selector.append(el('option', { value: v.id, textContent: `${v.nombre} (${v.tamanoMB} MB)` }));
      selector.value = lista.some((v) => v.id === guardada) ? guardada : (lista.find((v) => v.id === VOZ_POR_DEFECTO) ?? lista[0]).id;
      void actualizarInfo();
    })
    .catch(() => (info.textContent = 'No se pudo leer la lista de voces.'));

  let urlAudio: string | null = null;
  let control: AbortController | null = null;

  botonCancelar.addEventListener('click', () => control?.abort());

  boton.addEventListener('click', async () => {
    const vozId = selector.value;
    control = new AbortController();
    boton.disabled = true;
    selector.disabled = true;
    botonCancelar.hidden = false;
    barra.hidden = false;
    resultado.hidden = true;
    resultado.replaceChildren();
    estado.className = '';
    barraInterna.style.width = '0';

    const t0 = performance.now();
    let tGenerando: number | null = null;
    const alProgreso = (p: ProgresoGeneracion) => {
      if (p.fase === 'generando' && tGenerando === null) tGenerando = performance.now();
      const etiqueta: Record<ProgresoGeneracion['fase'], string> = {
        'descargando-voz': 'Descargando la voz',
        'cargando-voz': 'Cargando la voz en memoria',
        generando: 'Generando audio',
        codificando: 'Comprimiendo a MP3',
      };
      let txt = `${etiqueta[p.fase]}… ${Math.round(p.fraccion * 100)} %`;
      if (p.fase === 'generando') {
        txt += ` · ${formatearSegundos(p.segundosAudio)} de audio en ${formatearSegundos(p.segundosCalculo)}`;
        if (p.etaSegundos !== null) txt += ` · faltan ~${formatearSegundos(p.etaSegundos)}`;
      }
      estado.textContent = txt;
      barraInterna.style.width = `${Math.round(p.fraccion * 100)}%`;
    };

    try {
      const r = await generador.generarTexto(TEXTO_PRUEBA, vozId, alProgreso, control.signal);
      const tCarga = ((tGenerando ?? performance.now()) - t0) / 1000;
      const v = velocidad(r.duracionSeg, r.segundosCalculo);
      const min = minutosPorHora(v);
      if (urlAudio) URL.revokeObjectURL(urlAudio);
      urlAudio = URL.createObjectURL(r.audio);
      resultado.replaceChildren(
        el('div', { className: 'diag-resultado' }, tabla([
          ['Descarga + carga de la voz', formatearSegundos(tCarga)],
          ['Duración del audio', formatearSegundos(r.duracionSeg)],
          ['Segundos de cálculo', formatearSegundos(r.segundosCalculo)],
          ['Velocidad', `${v.toLocaleString('es-ES', { maximumFractionDigits: 2 })} s de audio por s de cálculo`],
          ['Tamaño del MP3', formatearBytes(r.audio.size)],
          ...(min !== null ? ([['1 hora de libro', `tardará ~${Math.round(min).toLocaleString('es-ES')} min en generarse`]] as [string, string][]) : []),
        ])),
        el('p', {}, interpretarVelocidad(v)),
        el('audio', { controls: true, src: urlAudio }),
      );
      resultado.hidden = false;
      estado.textContent = 'Prueba terminada.';
    } catch (e) {
      const cancelado = e instanceof DOMException && e.name === 'AbortError';
      estado.textContent = cancelado ? 'Prueba cancelada.' : `Error: ${e instanceof Error ? e.message : String(e)}`;
      if (!cancelado) estado.className = 'diag-error';
    } finally {
      boton.disabled = false;
      selector.disabled = false;
      botonCancelar.hidden = true;
      barra.hidden = true;
      control = null;
      void actualizarInfo();
      void pintarAlmacenamiento();
    }
  });

  // ───────── Almacenamiento ─────────
  const cajaAlm = el('div');
  const botonPersistir = el('button', { className: 'diag-btn diag-btn-sec', textContent: 'Pedir almacenamiento persistente' });
  raiz.append(el('div', { className: 'diag-sec' }, el('h3', {}, 'Almacenamiento'), cajaAlm, botonPersistir));

  async function pintarAlmacenamiento() {
    const e = await almacen.estado();
    const horas = horasQueCaben(e.libreBytes);
    cajaAlm.replaceChildren(
      tabla([
        ['Persistente', si(e.persistente)],
        ['Usado', formatearBytes(e.usadoBytes)],
        ['Cuota', formatearBytes(e.cuotaBytes)],
        ['Libre', formatearBytes(e.libreBytes)],
        ['Caben aprox.', horas === null ? 'desconocido' : `${Math.floor(horas).toLocaleString('es-ES')} horas de audio (48 kbps ≈ 21,6 MB/h)`],
      ]),
    );
    botonPersistir.hidden = e.persistente;
  }
  botonPersistir.addEventListener('click', async () => {
    const ok = await almacen.pedirPersistencia();
    botonPersistir.textContent = ok ? 'Almacenamiento persistente concedido' : 'El navegador no lo ha concedido (puede que lo conceda más adelante)';
    await pintarAlmacenamiento();
    if (ok) botonPersistir.hidden = true;
  });
  void pintarAlmacenamiento().catch(() => (cajaAlm.textContent = 'No se pudo consultar el almacenamiento.'));

  // ───────── Entorno ─────────
  raiz.append(
    el('div', { className: 'diag-sec' }, el('h3', {}, 'Entorno'), tabla([
      ['Navegador', navigator.userAgent],
      ['Modo standalone', si(esStandalone())],
      ['WebAssembly', si(typeof WebAssembly === 'object')],
      ['WebAssembly SIMD', si(soportaSimd())],
      ['crossOriginIsolated', si(self.crossOriginIsolated === true)],
      ['Wake Lock', si('wakeLock' in navigator)],
      ['Media Session', si('mediaSession' in navigator)],
      ['Cache API', si(typeof caches !== 'undefined')],
    ])),
  );
}
