import { evidencePath } from './evidence';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

// Each case loads one full road world before producing one collision, not a complete race.
test.describe.configure({ timeout: 120_000 });

const { vehicles } = JSON.parse(readFileSync(resolve('src/vehicles/catalogue.json'), 'utf8')) as {
  vehicles: { id: string }[];
};
for (const vehicle of vehicles) test(`${vehicle.id} receives a real burst collision through the game loop`, async ({ page }) => {
  await page.goto(`/?track=lhasa&bot=1&dev=1&time=day&vehicle=${vehicle.id}`);
  await page.waitForFunction(() => window.game?.report().phase === 'racing');
  const before = await page.evaluate(() => {
    const g = window.game as any; const s = g.session;
    g.autopilot = false;
    const p = s.car.position.addScaledVector(s.car.forward, s.car.tuning.chassisHalf[2]);
    const velocity = s.car.forward.multiplyScalar(20);
    s.car.body.setLinvel(velocity, true); s.trailer?.car.body.setLinvel(velocity, true);
    s.slimes.addTile('vehicle-burst', [{ kind: 'burst', position: p.toArray(), scale: [.7, .7, .7], yaw: 0 }]);
    return s.slimes.stats.feedback.hits.burst;
  });
  await page.waitForFunction(count => {
    const g = window.game as any;
    if (g.report().slimes.feedback.hits.burst <= count) return false;
    g.phase = 'paused'; return true;
  }, before);
  const facts = await page.evaluate(() => {
    const g = window.game as any;
    return { feedback: g.report().slimes.feedback, gap: g.session.trailer?.hitchGap ?? 0,
      windshieldPresent: !g.session.model.windshield.isEmpty() };
  });
  expect(facts.windshieldPresent).toBe(true);
  expect(facts.feedback.hits.burst).toBe(before + 1);
  expect(facts.feedback.windshieldCoverage).toBeGreaterThanOrEqual(0);
  expect(facts.feedback.windshieldCoverage).toBeLessThanOrEqual(1);
  expect(facts.gap).toBeLessThan(.15);
  const directory = evidencePath('vehicles'); mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${vehicle.id}-burst.png`) });
  console.log(`${vehicle.id}: actual burst coverage ${facts.feedback.windshieldCoverage.toFixed(3)}`);
});
