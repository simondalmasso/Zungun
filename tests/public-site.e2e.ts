import { test } from '@e2e-dev/web';
import { expect } from 'e2e';

test('homepage explains the product and its primary navigation works', async ({ app, screen }) => {
  await app.open('/');
  await expect(screen.getByRole('heading', 'Know what actually happened.')).toBeVisible();
  await expect(screen.getByRole('link', 'Explore the developer guide')).toBeVisible();
  await expect(screen.getByRole('link', 'Open the field demo')).toBeVisible();
  await expect(screen.getByRole('link', 'View source on GitHub')).toBeVisible();

  await screen.getByRole('link', 'Explore the developer guide').click();
  await expect(screen.getByRole('heading', 'Durability without optimistic claims.')).toBeVisible();
});

test('developer guide renders its scope and execution-evidence route', async ({ app, screen }) => {
  await app.open('/developers');
  await expect(screen.getByRole('heading', 'Durability without optimistic claims.')).toBeVisible();
  await expect(screen.getByRole('link', 'Open execution evidence')).toBeVisible();
});

test('interactive surfaces render without submitting forms or creating demo data', async ({ app, screen }) => {
  const pages = [
    ['/control', 'Assign work. See proof.'],
    ['/messages', 'Text. No pretend presence.'],
    ['/ops', 'Inspect what supports the claim.'],
  ];

  for (const [route, heading] of pages) {
    await app.open(route);
    await expect(screen.getByRole('heading', heading)).toBeVisible();
  }
});

test('Pocket beta stores a draft locally and offers explicit SMS and WhatsApp routes', async ({ app, screen }) => {
  await app.open('/chat/');
  await expect(screen.getByRole('heading', 'Mensajes pequeños. Estados honestos.')).toBeVisible();
  await expect(screen.getByText('No se verifica el número por SMS. Se valida solamente el formato y el destino se guarda localmente. No introduzcas códigos de verificación.')).toBeVisible();

  await screen.getByRole('textbox', 'Número de destino en formato internacional').fill('+543420123456');
  await screen.getByRole('button', 'Guardar destino').click();
  await expect(screen.getByText('+543420123456')).toBeVisible();

  await screen.getByRole('textbox', 'Mensaje').fill('Zungun E2E routing draft');
  await screen.getByRole('button', 'Guardar borrador').click();
  await expect(screen.getByText('Zungun E2E routing draft')).toBeVisible();
  await expect(screen.getByText('Borrador local · no enviado')).toBeVisible();
  await expect(screen.getByRole('button', 'Abrir SMS')).toBeVisible();
  await expect(screen.getByRole('button', 'Abrir WhatsApp')).toBeVisible();
  await expect(screen.getByRole('heading', 'WhatsApp')).toBeVisible();
});
