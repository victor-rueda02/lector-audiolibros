import type { LibroGuardado } from '../tipos.ts';
import type { Contexto, Vista } from './contexto.ts';
import { el, vaciar } from './dom.ts';
import { bufferAHex, contarPalabras, duracionEstimadaSeg, formatearDuracion } from './logica.ts';

async function huellaSha256(datos: Uint8Array): Promise<string> {
  const copia = datos.slice();
  return bufferAHex(await crypto.subtle.digest('SHA-256', copia));
}

export function crearVistaLibro(ctx: Contexto): Vista {
  const entrada = el('input', {
    type: 'file',
    accept: 'application/pdf,.pdf',
    class: 'oculto-visual',
    id: 'entrada-pdf',
    testid: 'entrada-pdf',
  });
  const botonAbrir = el('label', { class: 'boton boton-principal', for: 'entrada-pdf', text: 'Abrir PDF' });
  const progreso = el('progress', { max: '1', value: '0', class: 'barra', testid: 'progreso-lectura', hidden: true });
  const textoProgreso = el('p', { class: 'nota', role: 'status', hidden: true });
  const error = el('p', { class: 'aviso aviso-error', role: 'alert', hidden: true });
  const info = el('div', {});
  const lista = el('ul', { class: 'lista', testid: 'lista-capitulos' });
  let leyendo = false;

  function mostrarError(msg: string | null) {
    error.hidden = msg === null;
    error.textContent = msg ?? '';
  }

  async function alElegir() {
    const archivo = entrada.files?.[0];
    if (!archivo || leyendo) return;
    mostrarError(null);
    leyendo = true;
    botonAbrir.classList.add('desactivado');
    try {
      const datos = new Uint8Array(await archivo.arrayBuffer());
      const id = await huellaSha256(datos);
      if (ctx.libro && ctx.libro.id !== id) {
        const ok = confirm(
          `Ya tienes guardado "${ctx.libro.libro.titulo}". Si abres otro libro se borrará el anterior y todo su audio. ¿Continuar?`,
        );
        if (!ok) return;
        await ctx.servicios.almacen.borrarTodo();
        ctx.libro = null;
        await ctx.reproductor.abrirLibro(null);
        ctx.libroCambiado();
      }
      progreso.hidden = false;
      textoProgreso.hidden = false;
      progreso.value = 0;
      textoProgreso.textContent = 'Leyendo el PDF…';
      const libro = await ctx.servicios.extraerLibro(datos, {
        onProgreso: (p, t) => {
          progreso.value = t > 0 ? p / t : 0;
          textoProgreso.textContent = `Leyendo página ${p} de ${t}`;
        },
      });
      const guardado: LibroGuardado = { id, nombreArchivo: archivo.name, libro, guardado: Date.now() };
      await ctx.servicios.almacen.guardarLibro(guardado);
      ctx.libro = guardado;
      await ctx.reproductor.abrirLibro(guardado);
      ctx.libroCambiado();
    } catch (e) {
      mostrarError(`No se pudo leer el PDF: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      leyendo = false;
      botonAbrir.classList.remove('desactivado');
      progreso.hidden = true;
      textoProgreso.hidden = true;
      entrada.value = '';
    }
  }
  entrada.addEventListener('change', () => void alElegir());

  function refrescar() {
    vaciar(info);
    vaciar(lista);
    const g = ctx.libro;
    if (!g) {
      info.append(el('p', { class: 'nota', text: 'Aún no has abierto ningún libro. Pulsa "Abrir PDF" y elige un archivo.' }));
      return;
    }
    const l = g.libro;
    info.append(el('h2', { class: 'titulo-libro', testid: 'titulo-libro', text: l.titulo }));
    info.append(el('p', { class: 'nota', text: `${g.nombreArchivo} · ${l.numPaginas} páginas · ${l.capitulos.length} capítulos` }));
    if (l.escaneado) {
      info.append(
        el('div', { class: 'aviso aviso-error aviso-grande', role: 'alert', testid: 'aviso-escaneado' },
          el('strong', { text: 'Este PDF parece un escaneo (imágenes sin texto).' }),
          el('p', { text: 'No se puede leer en voz alta porque no tiene texto. Prueba con otro PDF que tenga texto seleccionable.' }),
        ),
      );
    }
    for (const a of l.avisos) info.append(el('p', { class: 'aviso', text: a }));
    if (l.capitulos.length === 0) return;
    const actual = ctx.reproductor.capituloActual?.id ?? null;
    l.capitulos.forEach((cap) => {
      const palabras = contarPalabras(cap.parrafos);
      const esActual = cap.id === actual;
      lista.append(
        el('li', { class: `capitulo-item${esActual ? ' actual' : ''}` },
          el('details', { class: 'capitulo', testid: `capitulo-${cap.id}` },
            el('summary', {},
              el('span', { class: 'cap-titulo', text: cap.titulo }),
              el('span', { class: 'cap-meta', text: `${palabras} palabras · ${formatearDuracion(duracionEstimadaSeg(palabras))}` }),
            ),
            el('div', { class: 'texto' }, ...cap.parrafos.map((p) => el('p', { text: p }))),
          ),
          el('button', {
            type: 'button',
            class: 'boton',
            testid: `empezar-${cap.id}`,
            text: esActual ? 'Empiezas aquí ✓' : 'Empezar aquí',
            onclick: () => {
              const i = l.capitulos.findIndex((c) => c.id === cap.id);
              void ctx.reproductor.cargarCapitulo(i, 0, false).then(() => refrescar());
            },
          }),
        ),
      );
    });
    info.append(el('h3', { text: 'Capítulos' }), lista);
  }

  ctx.reproductor.alCambiar(() => {
    // Solo para marcar el capítulo de inicio cuando cambia desde fuera de esta pestaña.
    if (!raiz.hidden) return;
    refrescar();
  });

  const raiz = el('section', { class: 'vista' },
    el('h2', { text: 'Libro' }),
    botonAbrir,
    entrada,
    progreso,
    textoProgreso,
    error,
    info,
  );
  return { raiz, refrescar };
}
