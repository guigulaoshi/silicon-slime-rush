import { evidencePath } from './evidence';
import { test, expect } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VehicleDefinition } from '../src/vehicles/catalogue';
const { vehicles: VEHICLES } = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8')) as { vehicles: VehicleDefinition[] };

test.describe.configure({ timeout: 240_000 });

test('all vehicle combinations retain road across the 101 corridor, wait for delayed tiles and regroup', async ({ page }) => {
  const requests = new Map<string, number>();
  await page.route('**/tracks/bayshore-101/tiles.bin', async route => {
    const range = route.request().headers().range ?? 'all';
    requests.set(range, (requests.get(range) ?? 0) + 1);
    await route.continue();
  });
  try {
    await page.goto('/?dev=1');
    await page.waitForFunction(() => window.game);
    expect(await page.evaluate(ids => window.game.startRace({ trackId: 'bayshore-101', car: 'sedan',
      slimeDensity: 'none', playerVehicles: ids.slice(0, 1), ai: true }), VEHICLES.map(v => v.id))).toBe(true);
    await page.evaluate(() => (window.game as any).beginCountdown());
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    // Hold the road back inside the page, not on the wire. Since the pack is downloaded
    // whole once, before the race starts, and every tile is sliced out of memory -- so holding the
    // `tiles.bin` request here no longer delays anything: the teleported racers wait only as long as
    // decoding takes and then drive off, and the "stay put" check below measured that drive. The
    // gate sits where the bytes now come from, so the road ahead really is missing until release.
    await page.evaluate(() => {
      const streamer = window.game.session.world.streamer as unknown as { fetchTile(ref: unknown): Promise<ArrayBuffer> };
      const fetchTile = streamer.fetchTile.bind(streamer);
      const gate = new Promise<void>(resolve => { (window as unknown as { releaseRoad(): void }).releaseRoad = resolve; });
      streamer.fetchTile = async ref => { await gate; return fetchTile(ref); };
      const s = window.game.session;
      for (const [i, racer] of s.racers.entries()) {
        if (i === 0) continue;
        const index = s.world.spline.indexAt(i * 8000);
        const p = s.world.spline.point(index), t = s.world.spline.tangent(index);
        racer.car.reset([p[0], p[1] + 1.3, p[2]], Math.atan2(-t[0], -t[2]));
        racer.trailer?.syncReset(); racer.race.reacquire(p[0], p[2]);
      }
      window.game.setAutopilot(0, true);
    });
    await page.waitForFunction(() => window.game.report().players.slice(1).every(p => p.waitingForRoad));
    const before = await page.evaluate(() => ({ positions: window.game.session.racers.map(r => r.car.position.toArray()),
      time: window.game.report().time }));
    await page.waitForFunction(time => window.game.report().time > time + 1, before.time);
    const held = await page.evaluate(() => window.game.session.racers.map(r => r.car.position.toArray()));
    expect(Math.hypot(...held[0]!.map((x, i) => x - before.positions[0]![i]!))).toBeGreaterThan(1);
    for (let i = 1; i < held.length; i++) expect(Math.hypot(...held[i]!.map((x, j) => x - before.positions[i]![j]!))).toBeLessThan(.02);
    await page.evaluate(() => (window as unknown as { releaseRoad(): void }).releaseRoad());
    await page.waitForFunction(() => window.game.report().players.every(p => !p.waitingForRoad), null, { timeout: 90_000 });
    const spread = await page.evaluate(() => {
      const s = window.game.session;
      return { players: window.game.report().players, tiles: s.world.streamer.stats,
        colliderTiles: s.physics.tileCount, combinations: s.racers.length, joints: s.physics.world.impulseJoints.len() };
    });
    expect(spread.combinations).toBe(VEHICLES.length);
    expect(spread.joints).toBe(VEHICLES.filter(v => v.trailer).length);
    expect(spread.colliderTiles).toBe(spread.tiles.loaded + 1);
    expect(Math.max(...requests.values())).toBe(1);
    const out = evidencePath('shared-streaming'); mkdirSync(out, { recursive: true });
    writeFileSync(resolve(out, 'spread.json'), JSON.stringify({ before, held, spread, requests: [...requests] }, null, 2));
    await page.screenshot({ path: resolve(out, 'spread.png') });
    await page.evaluate(() => {
      for (const racer of window.game.session.racers) { racer.reset(); racer.race.start(); }
    });
    await page.waitForFunction(loaded => window.game.session.world.streamer.stats.loaded < loaded,
      spread.tiles.loaded, { timeout: 30_000 });
    const together = await page.evaluate(() => ({ tiles: window.game.session.world.streamer.stats,
      colliderTiles: window.game.session.physics.tileCount, cars: window.game.session.racers.length }));
    expect(together.colliderTiles).toBe(together.tiles.loaded + 1);
    expect(together.cars).toBe(VEHICLES.length);
    writeFileSync(resolve(out, 'regroup.json'), JSON.stringify(together, null, 2));
  } finally { await page.unroute('**/tracks/bayshore-101/tiles.bin'); }
});
