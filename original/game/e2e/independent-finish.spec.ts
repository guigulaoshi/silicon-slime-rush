import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

test.describe.configure({ timeout: 180_000 });
for (const first of [0, 1]) test(`driver ${first + 1} finishes first while the other rig keeps its race`,
  { tag: '@long' }, async ({ page }) => {
  const out = evidencePath('independent-finish'); mkdirSync(out, { recursive: true });
  await page.addInitScript(lang => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
    version: 1, language: lang, quality: 'high', volume: 0, muted: true,
    best: { 'synth-p2p': 9999 },
  })), first === 0 ? 'en' : 'zh');
  // ?speed is only honoured with ?bot=1 (src/main.ts); without it this ran at 1x and outlived its
  // 180 s budget. No ?track is given, so bot=1 starts no automatic run of its own.
  await page.goto('/?dev=1&bot=1&speed=6'); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
    slimeDensity: 'none', playerVehicles: ['micro-hatch', 'pickup-travel-trailer'] }))).toBe(true);
  await page.evaluate(first => {
    window.game.setAutopilot(first, true); (window.game as any).beginCountdown();
  }, first);
  await page.waitForFunction(first => window.game.report().players[first]!.state === 'finished', first);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('racing');
  const finished = await page.evaluate(first => ({ player: window.game.report().players[first],
    revision: window.game.session.racers[first]!.car.poseRevision }), first);
  const other = 1 - first;
  const before = await page.evaluate(other => ({ time: window.game.report().players[other]!.time,
    revision: window.game.session.racers[other]!.car.poseRevision }), other);
  await page.keyboard.press(first === 0 ? 'r' : '/');
  await page.waitForFunction(({ other, time }) => window.game.report().players[other]!.time > time + 2,
    { other, time: before.time });
  const frozen = await page.evaluate(first => ({ player: window.game.report().players[first],
    revision: window.game.session.racers[first]!.car.poseRevision }), first);
  expect(frozen.revision).toBe(finished.revision);
  expect(frozen.player!.time).toBe(finished.player!.time);
  expect(frozen.player!.checkpoints).toBe(finished.player!.checkpoints);
  await expect(page.locator(`[data-player="${first + 1}"] .hud-notice`)).toContainText(first === 0 ? 'waiting' : '等待');
  // The one home first does not stand on the line in the partner's way; it drives on to a berth.
  await page.waitForFunction(first => window.game.report().players[first]!.parking?.stopped === true
    && window.game.report().players[first]!.speedKmh < .5, first);
  await page.screenshot({ animations: 'disabled', path: resolve(out, `waiting-${first + 1}.png`) });
  await page.keyboard.press(other === 0 ? 'r' : '/');
  await page.waitForFunction(({ other, revision }) => window.game.session.racers[other]!.car.poseRevision > revision,
    { other, revision: before.revision });
  expect(await page.evaluate(() => window.game.session.racers[1]!.trailer!.hitchGap)).toBeLessThan(.3);
  await page.evaluate(other => window.game.setAutopilot(other, true), other);
  await page.waitForFunction(() => window.game.report().phase === 'results');
  const result = await page.evaluate(() => ({ players: window.game.report().players,
    best: (window.game as any).save.best('synth-p2p@micro-hatch'), facts: (window.game as any).lastResult }));
  expect(result.players.map(p => p.state)).toEqual(['finished', 'finished']);
  expect(result.best).toBe(9999);
  expect(result.facts.players).toHaveLength(2);
  expect(result.facts.isBest).toBe(false);
  await expect(page.locator('.result-player')).toHaveCount(2);
  await page.screenshot({ animations: 'disabled', path: resolve(out, `results-${first + 1}.png`) });
  writeFileSync(resolve(out, `finish-${first + 1}.json`), JSON.stringify({ finished, frozen, result }, null, 2));
  await page.evaluate(() => (window.game as any).restart());
  expect(await page.evaluate(() => window.game.report().players.map(p => p.state))).toEqual(['ready', 'ready']);
});
