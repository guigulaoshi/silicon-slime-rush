import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { GhostRecorder } from '../src/app/Ghost';
import { slimeScale, slimeGroundFraction } from '../src/world/slimeShape';

// Everything a race can show for the first time is prepared behind the loading screen.
// The countdown, the start (with a personal-best ghost), every slime kind, a colossus, and the same
// again after a restart must not create a new GPU program. Before the fix: 5 programs at the start,
// 1 at the first bounce and 28 at the first colossus entry (a 150 ms frame on an M-series GPU).
test.describe.configure({ timeout: 300_000 });
test.use({ viewport: { width: 1280, height: 720 } });
const out = evidencePath('first-use');
const KINDS = ['slick', 'popper', 'burst', 'boost', 'colossus'] as const;

function ghost() {
  const recorder = new GhostRecorder('micro-hatch', false);
  for (let t = 0; t <= 120; t++) recorder.sample(t, { position: { x: t, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }, 0);
  return recorder.finish(120);
}

async function programs(page: Page): Promise<string[]> {
  return page.evaluate(() => ((window.game as any).session.world.renderer.info.programs ?? [])
    .map((p: any) => `${p.name}|${p.type ?? ''}#${p.id}#${String(p.cacheKey)}`));
}

/** Frame times until a condition, plus the strongest caustic value a road program actually received. */
async function frames(page: Page, until: string, limitMs: number) {
  return page.evaluate(async ({ until, limitMs }) => {
    const done = new Function('g', `return (${until})`) as (g: any) => boolean;
    const g = window.game as any;
    const road = g.session.world.scene.getObjectByName('road');
    const dts: number[] = [];
    let last = performance.now(), caustic = 0;
    const start = last;
    await new Promise<void>((finish) => {
      const tick = () => {
        const now = performance.now();
        dts.push(now - last); last = now;
        const uniform = road && g.session.world.renderer.properties.get(road.material).uniforms?.uSlimeCausticStrength;
        caustic = Math.max(caustic, uniform?.value ?? 0);
        if (done(g) || now - start > limitMs) finish(); else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    return { reached: done(g), maxMs: Math.round(Math.max(...dts)), frames: dts.length, over50: dts.filter(d => d > 50).length, caustic };
  }, { until, limitMs });
}

test('no GPU program is created for the first time after the loading screen @version', async ({ page }) => {
  mkdirSync(out, { recursive: true });
  const saved = { language: 'en', quality: 'high', muted: true, best: { shoreline: 120 }, ghosts: { shoreline: ghost() } };
  await page.addInitScript((save) => localStorage.setItem('silicon-rush.save.v1', JSON.stringify(save)), saved);
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game);
  const facts: Record<string, unknown> = {};
  const loadStart = Date.now();
  // The menu's own path: the countdown begins in the same task the load finishes, so anything still
  // loading then (the ghost's models) would compile during the countdown.
  const loaded: string[] = await page.evaluate(async () => {
    const g = window.game as any;
    g.autopilot = true;
    g.save.update({ showGhost: true }); // the ghost starts off for players; this test measures loading it
    await g.startRace({ trackId: 'shoreline', car: 'sedan', playerVehicles: ['micro-hatch'], ai: false, slimeDensity: 'normal', timeOfDay: 'day' }, true);
    return g.session.world.renderer.info.programs.map((p: any) => `${p.name}|${p.type ?? ''}#${p.id}#${String(p.cacheKey)}`);
  });
  facts.loadMs = Date.now() - loadStart;
  const seen = new Set(loaded);
  facts.loadedPrograms = seen.size;
  const added = async () => {
    const fresh = (await programs(page)).filter(name => !seen.has(name));
    fresh.forEach(name => seen.add(name));
    // Name what compiled late, so a red run says where to look.
    const owners = await page.evaluate((ids: number[]) => {
      const g = window.game as any, r = g.session.world.renderer, found: string[] = [];
      g.session.world.scene.traverse((node: any) => {
        for (const m of [node.material].flat()) {
          const program = m && r.properties.get(m).currentProgram;
          if (program && ids.includes(program.id)) found.push(`${node.name || node.parent?.name}:${m.type}:${m.name}`);
        }
      });
      return [...new Set(found)];
    }, fresh.map(name => Number(name.split('#')[1])));
    return { fresh: fresh.map(name => name.split('#').slice(0, 2).join('#')), owners };
  };
  const steps: any[] = [];
  const start = async (step: string, begin: boolean) => {
    if (begin) await page.evaluate(() => { const g = window.game as any; g.autopilot = true; g.beginCountdown(); });
    const sample = await frames(page, "g.phase==='racing' && g.session.race.time>4", 20_000);
    const ghostVisible = await page.evaluate(() => (window.game as any).report().ghost.visible);
    steps.push({ step, ghostVisible, ...sample, ...(await added()) });
  };
  const hit = async (kind: typeof KINDS[number], step: string) => {
    const scale = slimeScale(kind, kind === 'colossus' ? .35 : .6);
    await page.evaluate(({ kind, step, scale, groundFraction }) => {
      const g = window.game as any;
      const s = g.session, layer = s.slimes, spline = s.world.spline;
      const ahead = s.race.progress.current.s;
      const p = spline.point(spline.indexAt(ahead + 40)), t = spline.tangent(spline.indexAt(ahead + 40));
      const from = spline.point(spline.indexAt(ahead + 22));
      g.autopilot = false;
      s.car.reset([from[0], from[1] + .8, from[2]], Math.atan2(-t[0], -t[2]));
      s.car.body.setLinvel({ x: t[0] * 14, y: 0, z: t[2] * 14 }, true);
      for (const key of [...layer.tileSpawns.keys()]) layer.removeTile(key);
      layer.addTile(`probe-${step}`, [{ kind, position: [p[0], p[1] + scale[1] * groundFraction, p[2]], scale, yaw: 0 }]);
      g.__probe373 = { hits: s.race.slimeHits, entries: layer.stats.colossusEntries };
    }, { kind, step, scale, groundFraction: slimeGroundFraction(kind) });
    const until = kind === 'colossus'
      ? '(g.__probe373.seen = g.__probe373.seen || g.session.slimes.stats.colossusTransit) && !g.session.slimes.stats.colossusTransit'
      : 'g.session.race.slimeHits>g.__probe373.hits';
    const sample = await frames(page, until, 15_000);
    const settle = await frames(page, 'false', 1500);
    await page.evaluate(() => { (window.game as any).autopilot = true; });
    steps.push({ step, ...sample, settleMaxMs: settle.maxMs, ...(await added()) });
  };

  await start('countdown+start', false);
  for (const kind of KINDS) await hit(kind, kind);
  await page.evaluate(() => { const g = window.game as any; g.show('paused'); g.restart(); });
  // A restart rebuilds the slime layer's programs before its countdown; that is the preparation, not a first use.
  facts.restartPrepared = (await added()).fresh.length;
  await start('restart', false);
  await hit('burst', 'burst-after-restart');
  await hit('colossus', 'colossus-after-restart');

  facts.steps = steps;
  writeFileSync(resolve(out, 'first-use.json'), JSON.stringify(facts, null, 2));
  expect(steps.map(step => [step.step, step.reached])).toEqual(steps.map(step => [step.step, true]));
  expect(steps.filter(step => step.step.startsWith('colossus')).map(step => step.caustic > .1)).toEqual([true, true]);
  expect(steps.find(step => step.step === 'countdown+start').ghostVisible).toBe(true);
  expect(steps.flatMap(step => step.fresh)).toEqual([]);
});
