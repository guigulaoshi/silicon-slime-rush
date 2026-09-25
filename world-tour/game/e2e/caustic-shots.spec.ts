import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePathOr } from './evidence';
import { expectWorldLoaded } from './world';
import { slimeGroundFraction } from '../src/world/slimeShape';

/**
 * Evidence, the way the entry asks for it: three frames of one continuous drive -- before,
 * inside, after -- from the driving camera, so the third frame shows the road the player sees once
 * they are out. A static camera from outside the giant is what let 448 miss this.
 * CAUSTIC456_BEFORE=1 captures the old behaviour into its own folder.
 */
const BEFORE = process.env.CAUSTIC456_BEFORE === '1';
const OUT = evidencePathOr(process.env.CAUSTIC456_OUT, 'caustic-exit', BEFORE ? 'before' : 'after');
test.describe.configure({ timeout: 300_000 });

test('three frames of one drive: before, inside, after', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.goto('/?track=synth-p2p&bot=1&dev=1&vehicle=sedan&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'shots');
  const centreHeight = 7.2 * slimeGroundFraction('colossus');
  await page.evaluate(centreHeight => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    g.autopilot = false; layer.fallingLimit = 0;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const at = spline.indexAt(60), p = spline.point(at), t = spline.tangent(at);
    const startAt = spline.indexAt(20), start = spline.point(startAt), startT = spline.tangent(startAt);
    layer.addTile('caustic-shots', [{ kind: 'colossus',
      position: [p[0], p[1] + centreHeight, p[2]], scale: [9.2, 7.2, 9.2], yaw: Math.atan2(-t[0], -t[2]) }]);
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-startT[0], -startT[2]));
    s.race.reacquire(start[0], start[2]);
    // Let the acceptance driver steer: hard-coded full lock straight ahead drove off the road, and an
    // evidence frame of a car in a field is not evidence about the road.
    g.autopilot = true;
    (window as any).__bodyIn = (layer.constructor as any).bodyInColossus;
    const giantAt = spline.indexAt(60);
    (window as any).__giantS = spline.s ? spline.s[giantAt] : 60;
  }, centreHeight);
  const distance = () => page.evaluate(() => {
    const s = (window.game as any).session;
    const live = [...s.slimes.liveByKey.values()].find((l: any) => l.spawn.kind === 'colossus');
    const b = live.outline ?? live.spawn, c = s.car.position;
    return Math.hypot(c.x - b.position[0], c.z - b.position[2]);
  });
  const shot = async (name: string) => { await page.screenshot({ path: resolve(OUT, name) }); };
  // One continuous drive, three moments, chosen by where the car is relative to the giant's centre:
  // short of it, in it, past it. `passed` flips once the car's own progress is beyond the giant's.
  const wait = async (want: 'before' | 'inside' | 'after') => {
    await page.waitForFunction(w => {
      const s = (window.game as any).session;
      const live = [...s.slimes.liveByKey.values()].find((l: any) => l.spawn.kind === 'colossus');
      const b = live.outline ?? live.spawn, c = s.car.position;
      const gap = Math.hypot(c.x - b.position[0], c.z - b.position[2]);
      const passed = s.race.progress.value.s > (window as any).__giantS;
      (window as any).__closest = Math.min((window as any).__closest ?? 99, gap);
      // "inside"/"after" ask the game's own predicate, the one the ripple itself uses. Judged by the
      // car's centre instead, the third shot landed while the boot was still in the body -- and the
      // ripple was still on, correctly, which read as a failure of the fix rather than of the frame.
      const inRig = (m: number) => (window as any).__bodyIn(b, s.car, m)
        || (s.slimes.driver(s.car).transit?.bodies ?? []).some((p: any) => (window as any).__bodyIn(b, p, m));
      // "inside" wants the car well inside the body, not the first frame a corner grazes it: at a graze
      // the crossing has not begun and the ripple is legitimately still off, which made a fine picture
      // into a false red. `gap < 5` against a 9.2 m body is squarely in there.
      return w === 'before' ? (!passed && gap < 20) : w === 'inside' ? (inRig(1) && gap < 5) : (passed && !inRig(1));
    }, want, { timeout: 90_000, polling: 'raf' });
  };
  const lit: number[] = [];
  for (const [name, want] of [['01-before.png', 'before'], ['02-inside.png', 'inside'],
                              ['03-after.png', 'after']] as const) {
    await wait(want);
    lit.push(await page.evaluate(() => (window.game as any).session.slimes.caustics.opacity));
    await shot(name);
  }
  console.log('SHOTS456', OUT, await distance(), 'lit', JSON.stringify(lit));
  // The frames are the point, but a spec that can only fail by timing out is not a test: each shot
  // also records the ripple, so assert what the picture is supposed to show.
  expect(lit[1], 'lit in the giant').toBeGreaterThan(0);
  expect(lit[2], 'dark once out of it').toBe(0);
});
