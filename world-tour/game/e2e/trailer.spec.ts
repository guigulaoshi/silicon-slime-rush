import { evidencePath } from './evidence';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 240_000 });
test.use({ video: { mode: 'on', size: { width: 1280, height: 720 } } });

test('articulated trailer: sharp turns, reverse, impact, reset and unload on a real road', async ({ page }) => {
  await page.goto('/?track=lhasa&bot=1&dev=1&time=day&vehicle=pickup-travel-trailer');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await page.evaluate(() => {
    const g = window.game as any;
    g.autopilot = false;
    const label = document.createElement('output'); label.id = 'trailer-proof';
    Object.assign(label.style, { position: 'fixed', top: '20px', left: '30%', color: 'white',
      background: '#111b', padding: '12px', font: '20px sans-serif', zIndex: '999' });
    document.body.append(label);
    (window as any).trailerProof = { contacts: 0, gap: 0 };
    setInterval(() => {
      const s = g.session; if (!s?.trailer) return;
      const proof = (window as any).trailerProof;
      if (s.car.scrape || s.trailer.car.scrape) proof.contacts++;
      proof.gap = Math.max(proof.gap, s.trailer.hitchGap);
    }, 16);
  });
  const label = (text: string) => page.locator('#trailer-proof').evaluate((node, value) => {
    node.textContent = value;
  }, text);
  const reset = async () => {
    await page.keyboard.up('ArrowUp'); await page.keyboard.up('ArrowDown');
    await page.keyboard.up('ArrowLeft'); await page.keyboard.up('ArrowRight');
    await page.keyboard.press('KeyR');
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => window.game.report().trailer?.hitchGap)).toBeLessThan(.08);
  };
  await label('急弯 / Sharp turns');
  await page.keyboard.down('ArrowUp'); await page.waitForTimeout(1200);
  await page.keyboard.down('ArrowLeft'); await page.waitForTimeout(800);
  await page.keyboard.up('ArrowLeft'); await page.keyboard.down('ArrowRight');
  await page.waitForTimeout(800);
  expect(await page.evaluate(() => window.game.report().trailer?.hitchGap)).toBeLessThan(.1);
  await reset();
  await label('倒车 / Reverse articulation');
  await page.keyboard.down('ArrowDown'); await page.keyboard.down('ArrowLeft');
  await page.waitForTimeout(2200);
  const reverse = await page.evaluate(() => {
    const s = (window.game as any).session;
    return { speed: s.car.forwardSpeed, angle: s.car.quaternion.angleTo(s.trailer.car.quaternion) };
  });
  expect(reverse.speed).toBeLessThan(-.2);
  expect(reverse.angle).toBeGreaterThan(.03);
  await reset();
  await label('护栏碰撞 / Rail collision');
  await page.keyboard.down('ArrowUp'); await page.keyboard.down('ArrowRight');
  // Shoreline's roadway was 22 m wide; lhasa's is narrower (halfWidth 6.75 m -> a 13.5 m roadway,
  // game/public/tracks/lhasa/track.json), so from rest in the middle the rig reaches the rail
  // sooner, not later -- a fixed sleep raced the frame rate before and would only be
  // more wrong here. Wait for the real scrape instead.
  await page.waitForFunction(() => (window as any).trailerProof.contacts > 0, undefined, { timeout: 10_000 });
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => (window as any).trailerProof.contacts)).toBeGreaterThan(0);
  expect(await page.evaluate(() => (window as any).trailerProof.gap)).toBeLessThan(.15);
  expect(await page.evaluate(() => window.game.report().trailer?.hitchGap)).toBeLessThan(.15);
  await label('整组复位 / Reset both bodies');
  await reset(); await page.waitForTimeout(700);
  const shots = evidencePath('vehicles'); mkdirSync(shots, { recursive: true });
  await page.screenshot({ path: resolve(shots, 'connected-reset.png') });
  await page.evaluate(() => (window.game as any).quit());
  expect(await page.locator('#app > canvas').count()).toBe(0);
  const video = page.video();
  await page.close();
  await video?.saveAs(resolve(shots, 'trailer-manoeuvres.webm'));
});

// Full lhasa completion and the <.15m hitch check share the per-vehicle drive in vehicle-driving.spec.ts.
