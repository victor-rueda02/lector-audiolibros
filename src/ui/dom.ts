/** Utilidades mínimas para construir DOM sin framework. */

type Hijo = Node | string | null | undefined | false;
type Props = Record<string, unknown>;

/**
 * Crea un elemento. Props especiales: `class`, `text`, `testid` (data-testid), `on<evento>` (listener).
 * `true` -> atributo vacío; `false`/null/undefined -> sin atributo.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  etiqueta: K,
  props: Props = {},
  ...hijos: Hijo[]
): HTMLElementTagNameMap[K] {
  const nodo = document.createElement(etiqueta);
  for (const [k, v] of Object.entries(props)) {
    if (v === false || v === null || v === undefined) continue;
    if (k === 'class') nodo.className = String(v);
    else if (k === 'text') nodo.textContent = String(v);
    else if (k === 'testid') nodo.setAttribute('data-testid', String(v));
    else if (k.startsWith('on') && typeof v === 'function') nodo.addEventListener(k.slice(2), v as EventListener);
    else nodo.setAttribute(k, v === true ? '' : String(v));
  }
  for (const h of hijos) {
    if (h === null || h === undefined || h === false) continue;
    nodo.append(h);
  }
  return nodo;
}

export function vaciar(nodo: HTMLElement): void {
  nodo.replaceChildren();
}
