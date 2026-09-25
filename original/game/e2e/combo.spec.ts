import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';

/** A chain of slimes shows its live combo on the HUD while the robot drives through them. */
const OUT = evidencePath('combo');
test.describe.configure({ timeout: 180_000 });

test('the HUD shows the live combo during a chain of slimes', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, slimeDensity: 'many', best: {} })));
  await page.goto('/?dev=1&track=synth-loop&bot=1&speed=1&time=day&weather=clear');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
  // Line up four small poppers along the centreline ahead so the robot hits them within the window.
  await page.evaluate(() => {
    const s = (window.game as any).session, spline = s.world.spline, at = s.race.progress.value.s;
    s.slimes.addTile('combo', [30, 45, 60, 75].map(d => {
      const p = spline.point(spline.indexAt((at + d) % spline.length));
      return { kind: 'popper', position: [p[0], p[1] + .45, p[2]], scale: [.45, .45, .45], yaw: 0 };
    }));
  });
  await page.waitForFunction(() => {
    const combo = document.querySelector<HTMLElement>('.hud-combo');
    return combo && !combo.hidden && Number(combo.dataset.combo) >= 3;
  }, null, { timeout: 60_000 });
  await page.screenshot({ path: resolve(OUT, 'hud-combo.png') });
  const facts = await page.evaluate(() => {
    const race = (window.game as any).session.race;
    return { score: race.score, ratingScore: race.ratingScore, maxCombo: race.maxCombo,
      awards: race.scoreAwards.filter((a: any) => a.source === 'slime').map((a: any) => [a.combo, a.points]) };
  });
  expect(facts.maxCombo).toBeGreaterThanOrEqual(3);
  expect(facts.score).toBeGreaterThan(facts.ratingScore);
});

test('split screen: the combo clears the nav disc, speedometer and clock, and hides at the finish', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-loop', car: 'sedan', timeOfDay: 'day',
    slimeDensity: 'none', playerVehicles: ['micro-hatch', 'sedan'] }))).toBe(true);
  await page.evaluate(() => (window.game as any).beginCountdown());
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  const chain = () => page.evaluate(() => {
    const race = (window.game as any).session.racers[0].race;
    for (let i = 0; i < 12; i++) race.hitSlime(`combo-split-${Date.now()}-${i}`, [1, 1, 1], 'popper');
  });
  for (const width of [1280, 1024]) {
    await page.setViewportSize({ width, height: 720 });
    await chain();
    await page.waitForFunction(() => Number(document.querySelector<HTMLElement>('.player-hud[data-player="1"] .hud-combo')?.dataset.combo) >= 10);
    await page.waitForTimeout(400);
    expect(await page.locator('.player-hud[data-player="1"] .hud-combo').evaluate(node => getComputedStyle(node).color)).toBe('rgb(255, 122, 69)');
    const boxes = await page.evaluate(() => {
      const hud = document.querySelector('.player-hud[data-player="1"]')!;
      const rect = (selector: string) => { const node = hud.querySelector(selector) as HTMLElement | null;
        if (!node || node.hidden) return null; const r = node.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom]; };
      // The combo lives in the clock column now, so it must clear that column's route lines, not its box.
      return { combo: rect('.hud-combo'), others: ['.hud-nav', '.hud-speed', '.hud-meta', '.hud-remaining', '.hud-map', '.hud-scoreboard', '.hud-score-gain', '.hud-controls']
        .map(selector => [selector, rect(selector)] as const), hudWidth: hud.getBoundingClientRect().width };
    });
    const [l, t, r, b] = boxes.combo! as [number, number, number, number];
    expect(l, `combo inside the left half at ${width}`).toBeGreaterThanOrEqual(0);
    for (const [selector, box] of boxes.others) {
      if (!box) continue;
      const overlap = l < box[2]! && r > box[0]! && t < box[3]! && b > box[1]!;
      expect(overlap, `combo overlaps ${selector} at ${width}: ${JSON.stringify([boxes.combo, box])}`).toBe(false);
    }
    await page.screenshot({ path: resolve(OUT, `split-${width}.png`) });
  }
  // At 1024 an expanded nav drops the minimap to the bottom; the clock column (time and score)
  // must stay on screen above it, clear of the key hints, not slide under the half's bottom edge.
  const nav = page.locator('.player-hud[data-player="1"] .hud-nav');
  await nav.click(); await expect(nav).toHaveAttribute('aria-pressed', 'true');
  const column = await page.evaluate(() => {
    const hud = document.querySelector('.player-hud[data-player="1"]')!;
    const box = (selector: string) => { const r = hud.querySelector(selector)!.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; };
    return { clock: box('.hud-clock'), map: box('.hud-map'), controls: box('.hud-controls') };
  });
  expect(column.clock.top, 'clock column on screen').toBeGreaterThanOrEqual(0);
  expect(column.clock.bottom, 'clock column above the minimap').toBeLessThanOrEqual(column.map.top);
  expect(column.clock.bottom, 'clock column clear of the key hints').toBeLessThanOrEqual(column.controls.top);
  await page.screenshot({ path: resolve(OUT, 'split-1024-nav-expanded.png') });
  await nav.click(); await expect(nav).toHaveAttribute('aria-pressed', 'false');
  await page.evaluate(() => { (window.game as any).session.racers[0].race.state = 'finished'; });
  await expect(page.locator('.player-hud[data-player="1"] .hud-combo')).toBeHidden();
});
