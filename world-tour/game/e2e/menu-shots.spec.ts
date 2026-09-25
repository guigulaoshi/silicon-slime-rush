import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { CATALOGUE } from '../src/app/tracks';
import { expectWorldLoaded } from './world';

/**
 * The route cards and the World step's preview are real frames from the current game, taken at
 * an authored place on each route where its landmark reads at a glance. Opt-in, because it rewrites
 * shipped images: MENU_SHOTS=survey writes contact sheets along each route to choose the places;
 * MENU_SHOTS=render writes public/menu/tracks/<id>.webp and public/menu/world/<id>/<15 variants>.webp
 * from the places recorded in e2e/menu-shots.json.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const MODE = process.env.MENU_SHOTS;
test.skip(MODE !== 'survey' && MODE !== 'render' && MODE !== 'preview', 'MENU_SHOTS=survey|preview|render rewrites menu images');
test.describe.configure({ timeout: 600_000 });
const PLACES: Record<string, { at: number; side: number; back: number; up: number; look: number; turn?: number; car?: string }> =
  JSON.parse(readFileSync(resolve(HERE, 'menu-shots.json'), 'utf8'));
const ONLY = process.env.MENU_TRACK;
const TRACKS = CATALOGUE.map(track => track.id).filter(id => !ONLY || ONLY.split(',').includes(id));
const SURVEY_OUT = resolve(HERE, '..', 'test-results', 'evidence', 'menu-shots');

type Choice = { time: 'day' | 'night'; weather: string; slimes: string; ai: boolean; difficulty?: string };

async function open(page: Page, track: string, choice: Choice, car = 'sports-car') {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  expect(await page.evaluate(({ track, choice, car }) => (window.game as any).startRace({ trackId: track, car: 'sedan',
    vehicleId: car, slimeDensity: choice.slimes, timeOfDay: choice.time, weather: choice.weather,
    ai: choice.ai, aiDifficulty: choice.difficulty ?? 'relaxed' }, true), { track, choice, car })).toBe(true);
  await page.waitForFunction(() => window.game.report().phase === 'racing', undefined, { timeout: 120_000 });
  // Only the 3D frame: the HUD, the language button and every other overlay stay out of a menu image.
  await page.evaluate(() => (window.game as any).session.world.renderer.domElement.setAttribute('data-menu-shot', ''));
  await page.addStyleTag({ content: 'body * { visibility: hidden !important; } [data-menu-shot] { visibility: visible !important; }' });
}

/** Park the field at a fraction of the route and hold a chase camera there until the tiles settle. */
async function frame(page: Page, place: { at: number; side: number; back: number; up: number; look: number; turn?: number }) {
  await page.evaluate(place => {
    const g = window.game as any, s = g.session, spline = s.world.spline;
    g.timeScale = 0;
    const index = spline.indexAt(place.at * s.world.spline.length);
    s.racers.forEach((racer: any, i: number) => {
      const at = spline.indexAt((place.at * spline.length) + (i === 0 ? 0 : 14 + i * 11));
      const p = spline.point(at), t = spline.tangent(at);
      p[1] += 0.6;
      racer.car.reset(p, Math.atan2(-t[0], -t[2])); racer.trailer?.syncReset();
    });
    const p = spline.point(index), t = spline.tangent(index);
    const right = [-t[2], 0, t[0]];
    const cam = s.world.camera;
    s.racers[0].chase.update = () => {
      cam.position.set(p[0] - t[0] * place.back + right[0] * place.side, p[1] + place.up, p[2] - t[2] * place.back + right[2] * place.side);
      // `turn` (degrees, towards `right`) swings the view off the road when the landmark stands beside
      // it: a route that circles a palace keeps the palace off to one side the whole way round.
      const a = (place.turn ?? 0) * Math.PI / 180, c = Math.cos(a), n = Math.sin(a);
      const d = [t[0] * c + right[0]! * n, t[2] * c + right[2]! * n];
      cam.lookAt(p[0] + d[0]! * place.look, p[1] + 1.2, p[2] + d[1]! * place.look);
      cam.fov = 58; cam.updateProjectionMatrix();
    };
    s.world.tiles?.update?.(p[0], p[2]);
  }, place);
  for (let i = 0; i < 40; i++) {
    const t = await page.evaluate(() => window.game.report().tiles);
    if (t && t.loading === 0 && t.loaded > 0) break;
    await page.waitForTimeout(500);
  }
  // Roadside boards carry social-network logos and names; a menu image must show neither
  // 不把商标写进去). Their materials are shared by every tile, so hiding them once hides every board.
  await page.evaluate(() => (window.game as any).session.world.scene.traverse((o: any) => {
    for (const m of [].concat(o.material ?? [])) if ((m as any).name?.startsWith('billboard')) (m as any).visible = false;
    // The checkpoint holograms are gameplay furniture, and one of them can fill the middle of a card
    // (the first World Tour's third Beijing gate stood right across Tiananmen Gate).
    if (typeof o.name === 'string' && o.name.startsWith('checkpoint-')) o.visible = false;
  }));
  await page.waitForTimeout(1500);
  await expectWorldLoaded(page, 'menu shot');
}

async function webp(page: Page, path: string, width: number) {
  const png = await page.screenshot();
  await sharp(png).resize(width, Math.round(width * 9 / 16)).webp({ quality: 80 }).toFile(path);
}

// The route card is the landmark: shot on a clear day with no slimes, because a giant slime parked at
// the authored place filled the middle of four cards and hid the landmark behind it. The World step's
// variants still show every slime density.
const CARD = 'slimes-none';

for (const track of TRACKS) test(`menu shots ${track}`, async ({ page }) => {
  if (MODE === 'survey') {
    mkdirSync(SURVEY_OUT, { recursive: true });
    await open(page, track, { time: 'day', weather: 'clear', slimes: 'normal', ai: false });
    const tiles: Buffer[] = [];
    for (let k = 0; k < 12; k++) {
      await frame(page, { at: (k + .5) / 12, side: 0, back: 9, up: 4, look: 30 });
      tiles.push(await sharp(await page.screenshot()).resize(480, 270).png().toBuffer());
    }
    const sheet = sharp({ create: { width: 480 * 4, height: 270 * 3, channels: 3, background: '#000' } })
      .composite(tiles.map((input, k) => ({ input, left: (k % 4) * 480, top: Math.floor(k / 4) * 270 })));
    await sheet.png().toFile(resolve(SURVEY_OUT, `${track}.png`));
    return;
  }
  const place = PLACES[track]!;
  expect(place, `${track} has no authored place in menu-shots.json`).toBeTruthy();
  const out = resolve(HERE, '..', 'public', 'menu', 'world', track);
  if (MODE === 'render') mkdirSync(out, { recursive: true });
  const variants: [string, Choice][] = [];
  for (const time of ['day', 'night'] as const) for (const weather of ['clear', 'fog', 'rain', 'snow'])
    variants.push([`${time}-${weather}`, { time, weather, slimes: 'normal', ai: false }]);
  for (const slimes of ['none', 'normal', 'many']) variants.push([`slimes-${slimes}`, { time: 'day', weather: 'clear', slimes, ai: false }]);
  variants.push(['ai-off', { time: 'day', weather: 'clear', slimes: 'normal', ai: false }]);
  for (const difficulty of ['relaxed', 'rush']) variants.push([`ai-${difficulty}`, { time: 'day', weather: 'clear', slimes: 'normal', ai: true, difficulty }]);
  if (MODE === 'preview') {
    mkdirSync(SURVEY_OUT, { recursive: true });
    await open(page, track, variants.find(([name]) => name === CARD)![1], place.car);
    await frame(page, place);
    await webp(page, resolve(SURVEY_OUT, `${track}-preview.webp`), 960);
    return;
  }
  for (const [name, choice] of variants) {
    await open(page, track, choice, place.car);
    await frame(page, place);
    await webp(page, resolve(out, `${name}.webp`), 1280);
    if (name === CARD) await webp(page, resolve(HERE, '..', 'public', 'menu', 'tracks', `${track}.webp`), 960);
  }
});
