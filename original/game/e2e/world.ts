import { expect, type Page } from '@playwright/test';

/* */
export async function expectWorldLoaded(page: Page, where: string): Promise<void> {
  const tiles = await page.evaluate(() => window.game?.report().tiles ?? null);
  expect(tiles, `${where}: the game never reported a tile streamer`).not.toBeNull();
  expect(tiles!.failed, `${where}: ${tiles!.failed} tiles failed to load -- ` +
    'run `python3 tools/assets.py ensure --all`').toBe(0);
  expect(tiles!.loaded, `${where}: no tile is loaded, so this frame is an empty world`)
    .toBeGreaterThan(0);
  const textures = await page.evaluate(() => window.game?.report().textures ?? null);
  expect(textures, `${where}: the game never reported its materials`).not.toBeNull();
  expect(textures!, `${where}: no material is textured, so this frame is the greybox palette -- ` +
    'run `python3 tools/assets.py ensure --all`').toBeGreaterThan(0);
}
