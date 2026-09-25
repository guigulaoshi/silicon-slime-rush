import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { CATALOGUE } from '../src/app/tracks';

for (const language of ['en', 'zh']) test(`retired route is absent from the ${language} menu and release`, async ({ page, request }) => {
  await page.addInitScript(lang => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: lang, quality: 'low', muted: true, best: {},
  })), language);
  await page.goto('/'); await page.locator('.home-go').click();
  await expect(page.locator('.sm-item')).toHaveCount(CATALOGUE.length);
  await expect(page.locator('.sm-route')).toHaveCount(CATALOGUE.length);
  await expect(page.locator('body')).not.toContainText(/San Tomas|圣托马斯/);
  for (const track of CATALOGUE) {
    const response = await request.get(`/tracks/${track.id}/track.json`);
    expect(response.ok(), track.id).toBe(true);
    expect((await response.json()).id).toBe(track.id);
  }
  const retired = await request.get('/tracks/san-tomas/track.json');
  // Vite's SPA fallback may return index.html with status 200 for an absent asset.
  expect(retired.headers()['content-type']).not.toContain('application/json');
  const out = evidencePath('route-retirement');
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: resolve(out, `menu-${language}.png`) });
});
