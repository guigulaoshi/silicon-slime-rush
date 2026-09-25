import { chromium, expect, firefox, test, webkit, type Browser, type BrowserType, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { servePackage, stagedByThisRelease } from './packageServer';

/**
 * The release QA pass, on the package that gets uploaded and in each engine the game claims.
 *
 * `browsers.spec.ts` asks whether an engine can load and drive at all, on the ordinary test build.
 * This one is the other question: in the build that ships, does the whole journey a player takes hold
 * up -- menus and their transitions, the drive, the pause, the result, sharing, settings and about --
 * with nothing in the console and every engine sounding like the others.
 */
test.describe.configure({ timeout: 600_000 });

const ENGINES: [string, BrowserType][] = [['chromium', chromium], ['firefox', firefox], ['webkit', webkit]];

/** What the mix is doing right now, as the audio graph sees it. */
const mix = (page: Page) => page.evaluate(() => {
  const audio = window.game.audio;
  // The three buses the mix actually has (src/audio/Audio.ts): the engine, the music and the effects,
  // all under one master. Reading a name the graph does not have would report `null` and prove nothing.
  const graph = audio.graph;
  return { state: audio.ctx?.state ?? 'none', engine: graph?.engine.gain.value ?? null,
    music: graph?.music.gain.value ?? null, effects: graph?.effects.gain.value ?? null,
    master: graph?.master.gain.value ?? null };
});

for (const [engine, type] of ENGINES) {
  test(`${engine} plays the release package end to end`, async () => {
    // A package is staged once and stays on disk, so an ordinary suite could judge a build nobody made
    // today. Only the package that matches the current build is worth testing; anything else skips.
    test.skip(!stagedByThisRelease(), 'not a release packaging run: python3 tools/release_package.py');
    const out = evidencePath('release-qa');
    mkdirSync(out, { recursive: true });
    const server = await servePackage();
    let browser: Browser | null = null;
    try {
      // Explicitly headless: a spec that launches its own browser does not inherit the project's
      // `use.headless`, and a window that opens on top of whatever the player is doing is a bug in the
      // test, not a feature.
      // Headless and muted: a spec that launches its own browser inherits neither the project's
      // `use.headless` nor its `--mute-audio`, and both a window and a sound land on whatever the player
      // is doing.
      browser = await type.launch({ headless: true, args: engine === 'chromium' ? ['--mute-audio'] : undefined,
        ...(engine === 'firefox' ? { firefoxUserPrefs: { 'webgl.disabled': false, 'webgl.force-enabled': true,
          'media.volume_scale': '0.0' } } : {}) });
      const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
      const errors: string[] = [];
      page.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`); });
      page.on('pageerror', error => errors.push(`page: ${String(error)}`));
      page.on('response', answer => {
        if (answer.status() >= 400) errors.push(`${answer.status()} ${answer.url().replace(server.base, '')}`);
      });
      // Every screen here arrives with an enter animation. A shot taken the instant a panel becomes
      // "visible" can catch it at opacity 0 -- which is how the About page first came out blank in
      // Chrome and Safari and full in Firefox. So each shot waits for the animations to finish, and a
      // screen that never settles fails the test instead of producing an empty picture.
      const shot = async (name: string) => {
        await page.evaluate(async () => {
          // Only the animations that end: the home page and the loading bar run looping ones, and waiting
          // for a loop to finish waits forever. A 1.5 s ceiling keeps a slow enter from hanging the run.
          const settling = [...document.querySelectorAll('[data-screen]:not([hidden]), .panel, dialog[open]')]
            .flatMap(node => node.getAnimations({ subtree: true }))
            .filter(animation => Number.isFinite(animation.effect?.getComputedTiming().iterations ?? Infinity))
            .map(animation => animation.finished.catch(() => undefined));
          await Promise.race([Promise.all(settling), new Promise(done => setTimeout(done, 1500))]);
        });
        await page.screenshot({ path: resolve(out, `${engine}-${name}.png`) });
      };

      await page.goto(`${server.base}/`);
      await page.waitForFunction(() => window.game, null, { timeout: 180_000 });
      await expect(page.locator('.home-go')).toBeVisible({ timeout: 180_000 });
      await shot('01-home');

      // The three menu steps, walked by their own primary button: whatever the flow's shape is, the
      // next button is the way through it, and every screen has to arrive before the next click.
      await page.locator('.home-go').click();
      for (let step = 0; step < 4; step++) {
        const next = page.locator('.sm-go').first();
        if (!await next.isVisible().catch(() => false)) break;
        await expect(next).toBeEnabled({ timeout: 60_000 });
        await shot(`0${2 + step}-step${step + 1}`);
        await next.click();
        await page.waitForTimeout(400);       // the panel's own enter animation, so the shot is not mid-fade
      }
      await page.waitForFunction(() => ['boot', 'intro', 'countdown', 'racing'].includes(window.game.report().phase),
        null, { timeout: 120_000 });
      await page.waitForFunction(() => ['intro', 'countdown', 'racing'].includes(window.game.report().phase),
        null, { timeout: 300_000 });
      await shot('06-intro');
      await page.keyboard.press('Enter');
      await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 60_000 });
      await page.keyboard.down('ArrowUp');
      await page.waitForFunction(() => window.game.report().speedKmh > 30, null, { timeout: 60_000 });
      const driving = await mix(page);
      await shot('07-racing');
      await page.keyboard.up('ArrowUp');

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.game.report().phase === 'paused', null, { timeout: 20_000 });
      await page.waitForTimeout(600);         // the engine fade is 60 ms, with room to spare
      const paused = await mix(page);
      await shot('08-paused');
      // Whatever the engine did about autoplay, the two states have to differ in the same direction:
      // a running context makes noise while driving and none behind the pause menu.
      console.log(`MIX502 ${engine} driving=${JSON.stringify(driving)} paused=${JSON.stringify(paused)}`);
      // An engine that refuses to start an audio context is a skip the report shows, not a quiet pass:
      // this is the only check Firefox's and Safari's audio has, so "measured nothing" must not read
      // like "measured and fine" (audio.spec.ts does the same with a skip).
      test.skip(driving.state !== 'running', `${engine} will not start an audio context`);
      expect(driving.engine, `${engine} audio graph`).not.toBeNull();
      {
        expect(driving.engine, `${engine} engine while driving`).toBeGreaterThan(0.05);
        expect(paused.engine, `${engine} engine behind the pause menu`).toBeLessThan(0.005);
        // The mix is one master with three buses under it; music and effects are audible while driving
        // and the master stays open, so a silent pause is the engine's fade and not a muted game.
        expect(driving.master, `${engine} master`).toBeGreaterThan(0);
        expect(driving.effects, `${engine} effects bus`).toBeGreaterThan(0);
        expect(driving.music, `${engine} music bus`).toBeGreaterThan(0);
        expect(paused.master, `${engine} master behind the pause menu`).toBeGreaterThan(0);
      }

      await page.keyboard.press('Escape');
      await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 20_000 });
      await page.evaluate(() => {
        const game = window.game as any, race = game.session.humans[0].race;
        race.time = race.spline.length * race.totalLaps / 22;      // a plausible finish, not a driven one
        game.finish(race.time);
      });
      await page.waitForFunction(() => window.game.report().phase === 'results', null, { timeout: 30_000 });
      await shot('09-results');
      await page.locator('[data-screen=results] [data-action=share]').click({ timeout: 20_000 });
      /* */
      await expect(page.locator('dialog[open]')).toBeVisible({ timeout: 20_000 });
      // The package carries the verified address, so the result card offers the game link too.
      await expect(page.locator('dialog[open] [data-share=link]')).toBeVisible({ timeout: 20_000 });
      await shot('10-share');
      await page.keyboard.press('Escape');

      await page.evaluate(() => (window.game as any).quit?.());
      await page.waitForFunction(() => window.game.report().phase === 'menu', null, { timeout: 60_000 });
      // Leaving a race lands on the route step, not the home page; the home page is where Settings and
      // About live, and Back is the player's way to it.
      for (let step = 0; step < 4 && !await page.locator('.home-footer').isVisible().catch(() => false); step++) {
        await page.locator('.sm-back').first().click({ timeout: 30_000 });
        await page.waitForTimeout(400);
      }
      await expect(page.locator('.home-footer')).toBeVisible({ timeout: 30_000 });
      await page.locator('.home-footer button').first().click();
      await expect(page.locator('input[data-setting=name]')).toBeVisible({ timeout: 30_000 });
      await shot('11-settings');
      // The settings screen's own Done button carries `data-setting=back` (SettingsScreen.ts).
      await page.locator('[data-setting=back]').first().click({ timeout: 30_000 });
      await expect(page.locator('.home-footer')).toBeVisible({ timeout: 30_000 });
      await page.locator('.home-footer button').nth(1).click();
      await expect(page.locator('[data-screen=about]')).toBeVisible({ timeout: 30_000 });
      await shot('12-about');

      expect(server.ranges(), 'tile packs are fetched whole, never as byte ranges').toBe(0);
      expect(errors, `${engine}: ${errors.join(' | ')}`).toEqual([]);
    } finally {
      await browser?.close();
      await server.close();
    }
  });
}
