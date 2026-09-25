import { evidencePath } from './evidence';
import { test, expect } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEHICLES as SLOTS, forTrack } from '../src/vehicles/catalogue';
// The field is the garage's nine slots, each with this route's own car standing in its slot.
const VEHICLES = SLOTS.map(vehicle => forTrack(vehicle, 'sydney'));

test.describe.configure({ timeout: 240_000 });

// Retargeted from bayshore-101 (deleted, "a 64.8 km highway"; "there is no long route any more").
// Since the whole tile pack downloads once before the race starts (see below), so this no
// longer needs great distances; it needs stations whose road has not streamed in yet, which the test
// finds at run time on the longest point-to-point route.
test('all vehicle combinations retain road across sydney, wait for delayed tiles and regroup', async ({ page }) => {
  const requests = new Map<string, number>();
  await page.route('**/tracks/sydney/tiles.bin', async route => {
    const range = route.request().headers().range ?? 'all';
    requests.set(range, (requests.get(range) ?? 0) + 1);
    await route.continue();
  });
  try {
    await page.goto('/?dev=1');
    await page.waitForFunction(() => window.game);
    expect(await page.evaluate(ids => window.game.startRace({ trackId: 'sydney', car: 'sedan',
      slimeDensity: 'none', playerVehicles: ids.slice(0, 1), ai: true }), SLOTS.map(v => v.id))).toBe(true);
    await page.evaluate(() => (window.game as any).beginCountdown());
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    // Hold the road back inside the page, not on the wire. Since the pack is downloaded
    // whole once, before the race starts, and every tile is sliced out of memory -- so holding the
    // `tiles.bin` request here no longer delays anything: the teleported racers wait only as long as
    // decoding takes and then drive off, and the "stay put" check below measured that drive. The
    // gate sits where the bytes now come from, so the road ahead really is missing until release.
    await page.evaluate(async () => {
      const streamer = window.game.session.world.streamer as unknown as { fetchTile(ref: unknown): Promise<ArrayBuffer> };
      const fetchTile = streamer.fetchTile.bind(streamer);
      const gate = new Promise<void>(resolve => { (window as unknown as { releaseRoad(): void }).releaseRoad = resolve; });
      streamer.fetchTile = async ref => { await gate; return fetchTile(ref); };
      const s = window.game.session, spline = s.world.spline;
      // Stations whose road has not streamed in yet, from the far end back, 60 m apart. Fixed stations
      // (130 m apart from the start) all fell inside the road already loaded around the start once the
      // routes were shorter, so nobody had anything to wait for.
      const stations: number[] = [];
      // From 120 m short of the finish, not 40: since sydney ends on the Opera House promenade
      // the last 40 m carry no road beyond the line to wait for, and that racer never waited.
      for (let at = spline.length - 120; at > 0 && stations.length < s.racers.length - 1; at -= 20) {
        const q = spline.point(spline.indexAt(at));
        // The game holds a car when the road under its own body is missing (Game.ts: a few metres round
        // it), so pick stations by that, not by a 20 m ring: a ring with one missing tile at its edge
        // picked a station whose car already had road and never waited.
        // The road right under the station must be missing, not only somewhere within a few metres: a small
        // car checks less than 6 m round itself, and one put 5 m from a missing tile found its own road
        // loaded and drove off instead of waiting.
        if (!s.world.streamer.collisionReady(q[0], q[2], 1) && stations.every(other => other - at >= 60)) stations.push(at);
      }
      if (stations.length < s.racers.length - 1) throw new Error(`only ${stations.length} stations without road`);
      for (const [i, racer] of s.racers.entries()) {
        if (i === 0) continue;
        const index = spline.indexAt(stations[i - 1]!);
        const p = spline.point(index), t = spline.tangent(index);
        racer.car.reset([p[0], p[1] + 1.3, p[2]], Math.atan2(-t[0], -t[2]));
        racer.trailer?.syncReset(); racer.race.reacquire(p[0], p[2]);
      }
      window.game.setAutopilot(0, true);
    });
    await page.waitForFunction(() => window.game.report().players.slice(1).every(p => p.waitingForRoad), null, { timeout: 60_000 })
      .catch(async error => { throw new Error(`rivals never all waited for road: ${JSON.stringify(await page.evaluate(() => window.game.report().players.map(p => ({ waiting: p.waitingForRoad }))))}; ${error}`); });
    const before = await page.evaluate(() => ({ positions: window.game.session.racers.map(r => r.car.position.toArray()),
      time: window.game.report().time }));
    await page.waitForFunction(time => window.game.report().time > time + 1, before.time, { timeout: 60_000 });
    const held = await page.evaluate(() => window.game.session.racers.map(r => r.car.position.toArray()));
    expect(Math.hypot(...held[0]!.map((x, i) => x - before.positions[0]![i]!))).toBeGreaterThan(1);
    for (let i = 1; i < held.length; i++) expect(Math.hypot(...held[i]!.map((x, j) => x - before.positions[i]![j]!))).toBeLessThan(.02);
    await page.evaluate(() => (window as unknown as { releaseRoad(): void }).releaseRoad());
    await page.waitForFunction(() => window.game.report().players.every(p => !p.waitingForRoad), null, { timeout: 90_000 });
    const spread = await page.evaluate(() => {
      const s = window.game.session;
      return { players: window.game.report().players, tiles: s.world.streamer.stats,
        // Road tiles plus the ground, not counting landmarks: they carry their own collision (landmark:<n>).
        colliderTiles: [...(s.physics as any).tiles.keys()].filter((key: string) => !key.startsWith('landmark:')).length, combinations: s.racers.length, joints: s.physics.world.impulseJoints.len() };
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
      colliderTiles: [...(window.game.session.physics as any).tiles.keys()].filter((key: string) => !key.startsWith('landmark:')).length, cars: window.game.session.racers.length }));
    expect(together.colliderTiles).toBe(together.tiles.loaded + 1);
    expect(together.cars).toBe(VEHICLES.length);
    writeFileSync(resolve(out, 'regroup.json'), JSON.stringify(together, null, 2));
  } finally { await page.unroute('**/tracks/sydney/tiles.bin'); }
});
