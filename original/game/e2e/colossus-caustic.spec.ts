import { expect, test } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';
import { expectWorldLoaded } from './world';
import { slimeGroundFraction } from '../src/world/slimeShape';

/**
 * Replaces the rule on both counts:
 *   - the lit area is the patch where the body actually meets the road, not the body's widest ring
 *     projected straight down, and
 *   - its brightness follows the world's own light, so a clear noon is bright, an overcast day is
 *     middling and night is nearly dark, instead of one fixed glow at every hour.
 *
 * CAUSTIC_BEFORE=1 only captures, so the same harness can record the previous behaviour.
 */
const BEFORE = process.env.CAUSTIC_BEFORE === '1';
const OUT = evidencePathOr(process.env.CAUSTIC_OUT, 'colossus-caustic', BEFORE ? 'before' : 'after');
test.describe.configure({ timeout: 300_000 });

/** Places a giant the way the game does -- sunk into the road by its ground fraction -- and pins the camera. */
async function lookAtGiant(page: import('@playwright/test').Page, label: string) {
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, `caustic ${label}`);
  const centreHeight = 7.2 * slimeGroundFraction('colossus');
  const entries = await page.evaluate(centreHeight => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    g.autopilot = false; layer.fallingLimit = 0;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const at = spline.indexAt(46), p = spline.point(at), t = spline.tangent(at);
    const startAt = spline.indexAt(27), start = spline.point(startAt), startT = spline.tangent(startAt);
    layer.addTile('colossus-caustic', [{ kind: 'colossus',
      position: [p[0], p[1] + centreHeight, p[2]], scale: [9.2, 7.2, 9.2], yaw: Math.atan2(-t[0], -t[2]) }]);
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-startT[0], -startT[2]));
    s.car.body.setLinvel({ x: startT[0] * 13, y: 0, z: startT[2] * 13 }, true);
    s.race.reacquire(start[0], start[2]);
    return layer.stats.colossusEntries;
  }, centreHeight);
  await page.waitForFunction(e => (window.game as any).session.slimes.stats.colossusTransit
    && (window.game as any).session.slimes.stats.colossusEntries > e, entries, { timeout: 20_000, polling: 'raf' });
  await page.waitForTimeout(600);
  const shot = await page.evaluate(() => {
    const g = window.game as any, s = g.session, w = s.world, cam = w.camera;
    g.timeScale = 0;
    const live = [...s.slimes.liveByKey.values()].find((l: any) => l.spawn.kind === 'colossus');
    const c = live.spawn.position;
    s.racers[0].chase.update = () => { cam.position.set(c[0] + 16, c[1] + 22, c[2] + 26); cam.lookAt(c[0], c[1] - 7, c[2]); };
    return { spawn: live.spawn, outline: live.outline ?? null };
  });
  await page.waitForTimeout(500);
  return shot;
}

/** The same frame with the ripple off and on: how much of the view it lights, and how hard. */
async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const s = (window.game as any).session, w = s.world, gl = w.renderer.getContext();
    const strength = s.slimes.caustics.strength;
    const size = w.renderer.getDrawingBufferSize(new (w.camera.position.constructor)());
    const grab = (value: number) => {
      strength.value = value; w.renderer.render(w.scene, w.camera);
      const out = new Uint8Array(size.x * size.y * 4); gl.readPixels(0, 0, size.x, size.y, gl.RGBA, gl.UNSIGNED_BYTE, out); return out;
    };
    const on = strength.value, dark = grab(0), bright = grab(on);
    strength.value = on;
    let pixels = 0, added = 0;
    for (let i = 0; i < dark.length; i += 4) {
      const gain = bright[i]! + bright[i + 1]! + bright[i + 2]! - dark[i]! - dark[i + 1]! - dark[i + 2]!;
      if (gain > 24) { pixels++; added += gain; }
    }
    return { strength: Number(on.toFixed(4)), daylight: Number(w.sky.daylight.toFixed(4)),
      pixels, brightness: pixels ? Math.round(added / pixels) : 0, of: size.x * size.y };
  });
}

const CONDITIONS = [
  { id: 'day-clear', query: 'time=day', label: 'clear noon' },
  { id: 'day-fog', query: 'time=day&weather=fog', label: 'overcast' },
  { id: 'night-clear', query: 'time=night', label: 'night' },
] as const;

test('the giant ripple covers only the contact patch, and dims with the weather and the hour', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  const seen: Record<string, Awaited<ReturnType<typeof measure>>> = {};
  for (const condition of CONDITIONS) {
    await page.goto(`/?track=synth-p2p&bot=1&dev=1&vehicle=sedan&${condition.query}`);
    const shot = await lookAtGiant(page, condition.label);
    await page.screenshot({ path: resolve(OUT, `${condition.id}.png`) });
    seen[condition.id] = await measure(page);
    if (condition.id === 'day-clear') {
      writeFileSync(resolve(OUT, 'outline.json'), JSON.stringify({ ...shot, lit: seen[condition.id] }, null, 2));
    }
  }
  writeFileSync(resolve(OUT, 'conditions.json'), JSON.stringify(seen, null, 2));
  console.log('448 CAUSTIC', JSON.stringify(seen));
  if (BEFORE) return;

  // Other half, which 448 keeps: the ripple is placed from the giant's drawn outline,
  // not from its spawn, so a giant that grew a skirt lights the road it actually covers. Without
  // these two the outline could quietly stop being recorded and everything else would still pass.
  const shot = JSON.parse(readFileSync(resolve(OUT, 'outline.json'), 'utf8'));
  expect(shot.outline, 'the giant records its drawn outline').not.toBeNull();
  expect(Math.max(shot.outline.scale[0], shot.outline.scale[2]), 'outline is the drawn widest half-extent')
    .toBeGreaterThan(9.2);   // sphere 9.2 m plus the drawn skirt

  const day = seen['day-clear']!, fog = seen['day-fog']!, night = seen['night-clear']!;
  // The contact patch: the body's cut through the road is about 69% of its widest radius at the
  // height the game sinks a giant to, so under half the area lit. Same frame, same camera,
  // measured on this machine: 22,862 lit pixels before 448, and the pre footprint was 11,714.
  expect(day.pixels, 'the ripple still reaches the road at all').toBeGreaterThan(4_000);
  expect(day.pixels, 'but only where the body meets it, not its widest ring').toBeLessThan(18_000);

  // Brightness follows the world's own light. `daylight` is Sky's single number for it, so assert on
  // the strength the shader actually multiplies by rather than on eyeballed pixels.
  expect(day.daylight).toBeCloseTo(1, 2);
  expect(fog.strength, 'overcast sits below a clear noon').toBeLessThan(day.strength * .8);
  expect(fog.strength, 'and above night').toBeGreaterThan(night.strength * 1.5);
  expect(night.strength, 'night is nearly dark').toBeLessThan(day.strength * .25);
  expect(night.pixels, 'and it is still the same patch, just faint').toBeLessThan(day.pixels);
});
