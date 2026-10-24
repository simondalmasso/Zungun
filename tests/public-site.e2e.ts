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

test('Pocket opens on a clean chat entry screen without an explainer', async ({ app, screen }) => {
  await app.open('/chat/');
  await expect(screen.getByRole('heading', 'Hablemos.')).toBeVisible();
  await expect(screen.getByRole('textbox', 'Tu nombre')).toBeVisible();
  await expect(screen.getByRole('button', 'Entrar al chat')).toBeVisible();
});
