/**
 * Capa 1: lectura con pdf.js. Devuelve estructuras propias y serializables
 * (PaginaPdf[] + EntradaIndice[]); no limpia nada.
 * Usa la build "legacy" de pdf.js (polyfills): la normal falla en Node 24 y en Safari antiguos.
 * Funciona en el navegador (worker de Vite) y en Node (worker "falso" de pdf.js).
 */
import type { EntradaIndice, Fragmento, PaginaPdf } from './modelo.ts';

type PdfJs = typeof import('pdfjs-dist/legacy/build/pdf.mjs');

export interface LecturaPdf {
  paginas: PaginaPdf[];
  indice: EntradaIndice[];
  /** Metadato Title del PDF, si lo hay. */
  titulo?: string | undefined;
}

let promesaPdfJs: Promise<PdfJs> | null = null;

function cargarPdfJs(): Promise<PdfJs> {
  promesaPdfJs ??= (async () => {
    const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
    // En el navegador hay que indicar dónde está el worker; en Node pdf.js lo resuelve solo.
    if (typeof document !== 'undefined') {
      const { default: urlWorker } = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = urlWorker;
    }
    return pdfjs;
  })();
  return promesaPdfJs;
}

interface ItemTexto {
  str: string;
  transform: number[];
  width: number;
  height: number;
  fontName: string;
}

function esItemTexto(i: unknown): i is ItemTexto {
  return typeof i === 'object' && i !== null && 'str' in i && 'transform' in i;
}

/** Multiplica dos matrices afines de pdf.js ([a, b, c, d, e, f]). */
function multiplicar(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

export async function leerPdf(datos: Uint8Array, onProgreso?: (pagina: number, total: number) => void): Promise<LecturaPdf> {
  const pdfjs = await cargarPdfJs();
  // pdf.js transfiere (neutraliza) el buffer que recibe: se le pasa una copia.
  const tarea = pdfjs.getDocument({ data: new Uint8Array(datos), verbosity: 0 });
  const pdf = await tarea.promise;
  try {
    const total = pdf.numPages;
    const paginas: PaginaPdf[] = [];
    for (let n = 1; n <= total; n++) {
      const pagina = await pdf.getPage(n);
      const vista = pagina.getViewport({ scale: 1 });
      const contenido = await pagina.getTextContent();
      const fragmentos: Fragmento[] = [];
      for (const item of contenido.items) {
        if (!esItemTexto(item) || item.str.trim() === '') continue;
        const t = multiplicar(vista.transform, item.transform);
        // Texto girado (marcas de agua, márgenes verticales): fuera.
        if (Math.abs(t[1]!) > Math.abs(t[0]!) * 0.5) continue;
        const tam = Math.hypot(t[2]!, t[3]!) || item.height;
        fragmentos.push({
          texto: item.str,
          x: t[4]!,
          y: t[5]!,
          ancho: item.width * vista.scale,
          alto: item.height * vista.scale,
          tam,
          fuente: item.fontName,
        });
      }
      paginas.push({ numero: n, ancho: vista.width, alto: vista.height, fragmentos });
      pagina.cleanup();
      onProgreso?.(n, total);
    }

    const indice = await leerIndice(pdf).catch(() => []);
    let titulo: string | undefined;
    try {
      const meta = await pdf.getMetadata();
      const t = (meta.info as { Title?: unknown } | undefined)?.Title;
      if (typeof t === 'string') titulo = t;
    } catch {
      /* sin metadatos */
    }
    return { paginas, indice, titulo };
  } finally {
    await tarea.destroy();
  }
}

type DocPdf = Awaited<ReturnType<PdfJs['getDocument']>['promise']>;

interface NodoIndice {
  title: string;
  dest: string | unknown[] | null;
  items?: NodoIndice[];
}

/** Aplana el outline resolviendo cada destino a número de página (base 1). */
async function leerIndice(pdf: DocPdf): Promise<EntradaIndice[]> {
  const raiz = (await pdf.getOutline()) as NodoIndice[] | null;
  if (!raiz) return [];
  const res: EntradaIndice[] = [];
  const recorrer = async (nodos: NodoIndice[], nivel: number): Promise<void> => {
    for (const nodo of nodos) {
      const pagina = await resolverPagina(pdf, nodo.dest);
      if (pagina !== null) res.push({ titulo: nodo.title ?? '', pagina, nivel });
      if (nodo.items?.length) await recorrer(nodo.items, nivel + 1);
    }
  };
  await recorrer(raiz, 0);
  return res;
}

async function resolverPagina(pdf: DocPdf, dest: NodoIndice['dest']): Promise<number | null> {
  try {
    const destino = typeof dest === 'string' ? await pdf.getDestination(dest) : dest;
    if (!Array.isArray(destino) || destino.length === 0) return null;
    const ref = destino[0] as unknown;
    if (typeof ref === 'number') return ref + 1;
    if (ref && typeof ref === 'object') return (await pdf.getPageIndex(ref as { num: number; gen: number })) + 1;
  } catch {
    /* destino roto */
  }
  return null;
}
