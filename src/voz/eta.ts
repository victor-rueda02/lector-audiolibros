/**
 * Cálculo de ETA y limitación de mensajes de progreso. Módulo puro (sin DOM).
 */

/**
 * Segundos restantes según el ritmo de caracteres por segundo; null hasta tener
 * al menos `minFrases` frases sintetizadas.
 */
export function estimarEta(
  caracteresHechos: number,
  caracteresTotales: number,
  segundosTranscurridos: number,
  frasesHechas: number,
  minFrases = 3,
): number | null {
  if (frasesHechas < minFrases || caracteresHechos <= 0 || segundosTranscurridos <= 0) return null;
  const ritmo = caracteresHechos / segundosTranscurridos;
  return Math.max(0, (caracteresTotales - caracteresHechos) / ritmo);
}

/** Deja pasar como mucho `maxPorSegundo` avisos por segundo (`forzar` siempre pasa). */
export function crearLimitador(maxPorSegundo = 4, reloj: () => number = () => Date.now()) {
  const intervalo = 1000 / maxPorSegundo;
  let ultimo = -Infinity;
  return (forzar = false): boolean => {
    const ahora = reloj();
    if (forzar || ahora - ultimo >= intervalo) {
      ultimo = ahora;
      return true;
    }
    return false;
  };
}
