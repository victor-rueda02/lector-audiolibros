import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { FIXTURES } from './ayudas';

test('UI con servicios simulados: pestanas y vista previa', async ({ page }) => {
  page.on('dialog', (d) => void d.accept());
  await page.goto('./?falsos');
  await page.getByTestId('entrada-pdf').setInputFiles(join(FIXTURES, 'libro-indice.pdf'));
  await expect(page.getByTestId('titulo-libro')).toBeVisible();
  const cap = page.getByTestId('capitulo-c000');
  await expect(cap).toBeVisible();
  await cap.locator('summary').click(); // vista previa del texto
  await expect(cap.locator('.texto p').first()).toBeVisible();

  await page.getByTestId('pestana-voz').click();
  await expect(page.getByTestId('lista-voces')).toBeVisible();
  await page.getByTestId('pestana-generar').click();
  await expect(page.getByTestId('boton-generar')).toBeVisible();
  await page.getByTestId('pestana-escuchar').click();
  await expect(page.getByTestId('boton-play')).toBeVisible();
});

test('aviso de PDF escaneado (extractor real)', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('entrada-pdf').setInputFiles(join(FIXTURES, 'escaneado.pdf'));
  await expect(page.getByTestId('aviso-escaneado')).toBeVisible({ timeout: 60_000 });
});

test('la pestana Diagnostico monta su contenido', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('pestana-diagnostico').click();
  const vista = page.locator('section.vista:visible');
  await expect(vista.locator('h2').first()).toHaveText('Diagnóstico');
  await expect(vista.locator('.diag').first()).toBeVisible({ timeout: 30_000 });
});
