import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';
import { slimeGroundFraction } from '../src/world/slimeShape';


/**
 * Drive one car clean through a giant and watch the
 * ground ripple against the car's own position, frame by frame. Inside it must be lit; once out the
 * far side it must be dark, and this measures how long "once out" actually takes.
 */
test.describe.configure({ timeout: 300_000 });

test('the ground ripple ends when the car leaves the giant', async ({ page }) => {
  await page.goto('/?track=synth-p2p&bot=1&dev=1&vehicle=sedan&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  await expectWorldLoaded(page, 'caustic exit');
  const centreHeight = 7.2 * slimeGroundFraction('colossus');
  await page.evaluate(centreHeight => {
    const g = window.game as any, s = g.session, layer = s.slimes, spline = s.world.spline;
    g.autopilot = false; layer.fallingLimit = 0;
    for (const tile of [...layer.tileSpawns.keys()]) layer.removeTile(tile);
    const at = spline.indexAt(60), p = spline.point(at), t = spline.tangent(at);
    const startAt = spline.indexAt(20), start = spline.point(startAt), startT = spline.tangent(startAt);
    layer.addTile('caustic-exit', [{ kind: 'colossus',
      position: [p[0], p[1] + centreHeight, p[2]], scale: [9.2, 7.2, 9.2], yaw: Math.atan2(-t[0], -t[2]) }]);
    s.car.reset([start[0], start[1] + .8, start[2]], Math.atan2(-startT[0], -startT[2]));
    s.race.reacquire(start[0], start[2]);
    const w = window as any;
    w.trace = [];
    const live = [...layer.liveByKey.values()].find((l: any) => l.spawn.kind === 'colossus');
    (window as any).__bodyIn = (layer.constructor as any).bodyInColossus;
    g.autopilot = true;
    const update = s.car.update.bind(s.car);
    s.car.update = (dt: number, input: any) => {
      update(dt, input);
      // The game's own predicate, imported in the page: a copy of the skirt maths here would agree
      // with the code under test by construction and keep measuring the old body if the shape is retuned.
      const shape = live.outline ?? live.spawn;
      const inRig = (margin: number) => (window as any).__bodyIn(shape, s.car, margin)
        || (s.slimes.driver(s.car).transit?.bodies ?? []).some((part: any) => (window as any).__bodyIn(shape, part, margin));
      w.trace.push({ inside: inRig(1), out12: !inRig(1.2),
        lit: +s.slimes.caustics.opacity.toFixed(4), transit: s.slimes.stats.colossusTransit,
        s: +s.race.progress.value.s.toFixed(1) });
    };
  }, centreHeight);
  await page.waitForFunction(() => {
    const t = (window as any).trace;
    return t.some((x: any) => x.inside) && t.length > 40 && t.at(-1).out12 && !t.at(-1).inside;
  }, undefined, { timeout: 60_000, polling: 'raf' });
  const trace = await page.evaluate(() => (window as any).trace);
  const left = trace.slice(trace.findLastIndex((t: any) => t.inside) + 1);
  const litAfter = left.filter((t: any) => t.lit > 0);
  console.log('CAUSTIC456', JSON.stringify({ frames: trace.length,
    insideLit: trace.filter((t: any) => t.inside && t.lit > 0).length,
    framesAfterLeaving: left.length, stillLit: litAfter.length,
    metresStillLit: litAfter.length ? +(litAfter.at(-1).s - left[0].s).toFixed(1) : 0 }));
  // Inside the body the ripple is on -- that half is by design.
  expect(trace.some((t: any) => t.inside && t.lit > 0), 'lit inside the giant').toBe(true);
  // Out of it, dark from the first frame outside.
  expect(litAfter.length, `still lit for ${litAfter.length} frames after leaving`).toBe(0);
});
