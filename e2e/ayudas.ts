import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export const FIXTURES = join(import.meta.dirname, '..', 'tests', 'fixtures');
export const VOZ = 'es_ES-carlfm-x_low';
const CACHE = join(import.meta.dirname, '.cache');

/**
 * Cachea en disco (e2e/.cache, ignorado por git) lo que se descarga de HuggingFace
 * (modelo de voz). La primera ejecucion descarga de verdad; las siguientes van mas rapido.
 */
export async function cachearModelos(page: Page) {
  mkdirSync(CACHE, { recursive: true });
  await page.route(/huggingface\.co\//, async (route) => {
    const req = route.request();
    if (req.method() !== 'GET' || req.headers()['range']) return route.fallback();
    const f = join(CACHE, createHash('sha1').update(req.url()).digest('hex'));
    if (existsSync(f + '.json')) {
      const meta = JSON.parse(readFileSync(f + '.json', 'utf8')) as { type: string };
      return route.fulfill({
        status: 200,
        body: readFileSync(f),
        headers: { 'content-type': meta.type, 'access-control-allow-origin': '*' },
      });
    }
    const resp = await route.fetch();
    if (resp.status() === 200) {
      writeFileSync(f, await resp.body());
      writeFileSync(f + '.json', JSON.stringify({ type: resp.headers()['content-type'] ?? 'application/octet-stream' }));
    }
    return route.fulfill({ response: resp });
  });
}

/** Flujo real: PDF -> voz pequena -> generar 1 capitulo. Deja la app en la pestana Escuchar. */
export async function cargarYGenerar(page: Page) {
  page.on('dialog', (d) => void d.accept());
  await cachearModelos(page);
  await page.goto('./');
  await page.getByTestId('entrada-pdf').setInputFiles(join(FIXTURES, 'libro-indice.pdf'));
  await page.getByTestId('titulo-libro').waitFor();
  await page.getByTestId('capitulo-c000').waitFor();
  await page.getByTestId('pestana-voz').click();
  await page.getByTestId(`elegir-${VOZ}`).click();
  await page.getByTestId('pestana-generar').click();
  await page.getByTestId('selector-cantidad').selectOption('1');
  await page.getByTestId('boton-generar').click();
  await page.getByTestId('generacion-terminada').waitFor({ timeout: 4 * 60_000 });
  await page.getByTestId('pestana-escuchar').click();
}
