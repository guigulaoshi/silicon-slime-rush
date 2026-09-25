import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { VEHICLES } from '../src/vehicles/catalogue';

test.describe.configure({ timeout: 240_000 });
test('strong AI roster finishes and preserves difficulty through restart and reload', async ({ page }) => {
  await page.goto('/?dev=1&bot=1&speed=6'); await page.waitForFunction(() => window.game);
  const out = evidencePath('ai-browser'); mkdirSync(out, { recursive: true });
  const evidence = [];
  for (const difficulty of ['rush'] as const) {
    expect(await page.evaluate(aiDifficulty => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
      playerVehicles: ['micro-hatch'], ai: true, aiDifficulty, slimeDensity: 'none' }), difficulty)).toBe(true);
    expect(await page.evaluate(() => window.game.report().choice!.aiDifficulty)).toBe(difficulty);
    const plans = await page.evaluate(() => window.game.session.racers.map(r => ({ role: r.role,
      difficulty: r.difficulty, id: r.vehicle.id, settings: r.bot.settings })));
    expect(plans.filter(p => p.role === 'ai').every(p => p.difficulty === difficulty)).toBe(true);
    await page.evaluate(() => {
      const s=window.game.session;
      (window as any).aiBarrierEvents=[];
      (window as any).aiBarrierHits=Object.fromEntries(s.racers.filter(r=>r.role==='ai').map(r=>[r.id,0]));
      for(const racer of s.racers.filter(r=>r.role==='ai')) {
        const update=racer.car.update.bind(racer.car);
        racer.car.update=(dt,input)=>{
          update(dt,input);
          if(racer.race.state==='racing'&&racer.car.impactFeedback?.kind==='barrier') {
            (window as any).aiBarrierHits[racer.id]++;
            (window as any).aiBarrierEvents.push({id:racer.id,time:racer.race.time,
              at:racer.race.progress.value,speed:racer.car.speed,input,
              traffic:racer.bot.trafficFollowing,own:racer.trafficBodies()});
          }
        };
      }
      (window.game as any).beginCountdown();
    });
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    expect(await page.evaluate(() => window.game.timeScale)).toBe(6);
    expect(await page.evaluate(() => window.game.report().players[0]!.autopilot)).toBe(false);
    await page.waitForFunction(() => window.game.report().time > 3);
    await page.screenshot({ path: resolve(out, difficulty + '.png'), animations: 'disabled' });
    await page.waitForFunction(() => {
      const ai = window.game.report().players.filter(r => r.role === 'ai');
      return ai.every(r => r.state === 'finished') || ai.some(r => r.time > 180);
    }, null, { timeout: 60_000 });
    const players = await page.evaluate(() => window.game.report().players.filter(r => r.role === 'ai'));
    const barrierHits=await page.evaluate(()=> (window as any).aiBarrierHits as Record<string,number>);
    const barrierEvents=await page.evaluate(()=>(window as any).aiBarrierEvents);
    writeFileSync(resolve(out, difficulty + '.json'), JSON.stringify({ plans, players, barrierHits, barrierEvents }, null, 2));
    expect(players).toHaveLength(VEHICLES.length - 1);
    expect(players.every(r => r.state === 'finished' && r.resets.length === 0)).toBe(true);
    expect(Object.values(barrierHits).reduce((sum,n)=>sum+n,0),difficulty+' barrier hits').toBe(0);
    evidence.push({ difficulty, plans, players, barrierHits });
    await page.keyboard.press('Escape'); await page.evaluate(() => (window.game as any).restart());
    expect(await page.evaluate(() => window.game.session.racers.filter(r => r.role === 'ai').map(r => r.difficulty)))
      .toEqual(Array(VEHICLES.length - 1).fill(difficulty));
    await page.evaluate(() => (window.game as any).quit());
  }
  // Elapsed-time calibration belongs to the unobstructed physical runs, not a mixed-car grid.
  // This browser journey verifies the actual eight-opponent race, collisions and persistence.
  await page.reload(); await page.waitForFunction(() => window.game);
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
    playerVehicles: ['sports-car', 'sports-car'], ai: true, slimeDensity: 'none' }))).toBe(true);
  expect(await page.evaluate(() => window.game.report().choice!.aiDifficulty)).toBe('rush');
  expect(await page.evaluate(() => window.game.session.racers.map(r => r.role)))
    .toEqual(['human', 'human', ...Array(VEHICLES.length - 1).fill('ai')]);
  writeFileSync(resolve(out, 'profiles.json'), JSON.stringify({ evidence }, null, 2));
  await page.evaluate(() => (window.game as any).quit());
  expect(await page.evaluate(() => window.game.startRace({ trackId: 'synth-p2p', car: 'sedan',
    playerVehicles: ['jeep'], ai: false, aiDifficulty: 'relaxed', slimeDensity: 'none' }))).toBe(true);
  expect(await page.evaluate(() => window.game.session.racers.map(r => r.role))).toEqual(['human']);
});
