import { expect, test } from '@playwright/test';
import { cargarYGenerar } from './ayudas';

type A = HTMLAudioElement;

test('PDF -> generar capitulo -> audio MP3 valido (y reproduccion en Chromium)', async ({ page, browserName }) => {
  await cargarYGenerar(page);
  const audio = page.getByTestId('audio-reproductor');

  // La pista generada esta cargada en el <audio> como blob:
  await expect.poll(() => audio.evaluate((a: A) => a.src)).toMatch(/^blob:/);

  // El blob es un MP3 valido y de tamano razonable (se comprueba dentro de la pagina).
  const info = await audio.evaluate(async (a: A) => {
    const b = new Uint8Array(await (await fetch(a.src)).arrayBuffer());
    return { tam: b.length, b0: b[0], b1: b[1], id3: b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33 };
  });
  expect(info.tam).toBeGreaterThan(30_000);
  if (!info.id3) {
    expect(info.b0).toBe(0xff);
    expect(info.b1 & 0xe0).toBe(0xe0); // sincronia de trama MPEG: 0xFF 0xE?/0xF?
  }

  // WebKit de escritorio de Playwright (Windows) no decodifica <audio> (MediaError 4, incluso con
  // MP3 oficiales de terceros y WAV): limitacion de ese build, no de la app. Por eso la reproduccion
  // solo se exige en Chromium; en WebKit se valida hasta tener el audio generado y cargado.
  if (browserName !== 'chromium') return;

  await expect.poll(() => audio.evaluate((a: A) => a.duration)).toBeGreaterThan(3);
  await page.getByTestId('boton-play').click();
  await expect.poll(() => audio.evaluate((a: A) => a.currentTime), { timeout: 20_000 }).toBeGreaterThan(1);

  // +30 s / -30 s (se acotan a la duracion de la pista)
  const dur = await audio.evaluate((a: A) => a.duration);
  await page.getByTestId('boton-play').click(); // pausa para medir con precision
  await audio.evaluate((a: A) => { a.currentTime = 0; });
  await page.getByTestId('boton-adelante-30').click();
  const t1 = await audio.evaluate((a: A) => a.currentTime);
  expect(t1).toBeGreaterThan(Math.min(29, dur - 1.5));
  await page.getByTestId('boton-atras-30').click();
  const t2 = await audio.evaluate((a: A) => a.currentTime);
  expect(t2).toBeLessThan(t1);

  // Velocidad
  await page.getByTestId('selector-velocidad').selectOption('1.5');
  expect(await audio.evaluate((a: A) => a.playbackRate)).toBe(1.5);

  // Reproducir un poco, recargar y comprobar que se retoma capitulo y posicion
  await audio.evaluate((a: A) => { a.currentTime = 0; });
  await page.getByTestId('boton-play').click();
  await expect.poll(() => audio.evaluate((a: A) => a.currentTime), { timeout: 20_000 }).toBeGreaterThan(2);
  await page.getByTestId('boton-play').click();
  const capAntes = await page.getByTestId('escuchar-capitulo').textContent();
  await page.waitForTimeout(1500); // margen para que se guarde la posicion
  await page.reload();
  await page.getByTestId('pestana-escuchar').click();
  await expect(page.getByTestId('escuchar-capitulo')).toHaveText(capAntes ?? '');
  await expect(page.getByTestId('audio-reproductor')).toHaveAttribute('src', /^blob:/);
  await expect
    .poll(() => page.getByTestId('audio-reproductor').evaluate((a: A) => a.currentTime))
    .toBeGreaterThan(0);
});
