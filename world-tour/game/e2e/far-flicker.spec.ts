import { expect, test, type Page } from '@playwright/test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { evidencePath } from './evidence';
import { expectWorldLoaded } from './world';

/**
 * Do the far buildings flicker while the car moves? (launch checklist: 远处的楼不闪; rendering.md 闪烁和深度冲突.)
 *
 * The ruler: the menu card's chase framing on the densest skylines, nudged forward half a metre a frame
 * (30 m/s at 60 fps), every frame read back from the canvas. Only pixels more than 200 m from the eye
 * count -- a mask rendered with the same camera. Motion there is smooth: over three frames a pixel moves
 * one way, so the middle frame lies between its neighbours. Flicker is on-off-on: the middle frame falls
 * more than 40 levels outside the range its two neighbours span. That share of far pixels is the number.
 * A still run (no nudge) is the control: it must be zero, or something changes with time instead.
 */
const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = evidencePath('far-flicker');
test.describe.configure({ timeout: 600_000 });
const PLACES: Record<string, { at: number; back: number; up: number; look: number }> =
  JSON.parse(readFileSync(resolve(HERE, 'menu-shots.json'), 'utf8'));
const CASES = [['new-york', 'night'], ['new-york', 'day'], ['shanghai', 'night'], ['dubai', 'night']] as const;
const FAR_M = 200, JUMP = 40, STEP_M = .5, FRAMES = 8;
/**
 * Share of far pixels allowed to flicker per frame. Measured (M4, desktop high): with the
 * grade pass multisampled 0.04-0.21 %; without it 0.08-2.26 % (the far Brooklyn Bridge's cables and truss).
 */
const LIMIT = .004;

async function open(page: Page, track: string, time: string) {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/?dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'menu');
  await page.evaluate(({ track, time }) => (window.game as any).startRace({ trackId: track, car: 'sedan', vehicleId: 'sports-car',
    slimeDensity: 'none', timeOfDay: time, weather: 'clear', ai: false }, true), { track, time });
  await page.waitForFunction(() => window.game.report().phase === 'racing', undefined, { timeout: 120_000 });
}

/** Frames nudged `step` metres apart, plus the far mask, as PNG data URLs. */
async function frames(page: Page, place: { at: number; back: number; up: number; look: number }, step: number) {
  return page.evaluate(async ({ place, step, count, far }) => {
    const g = window.game as any, s = g.session, w = s.world, spline = w.spline;
    g.timeScale = 0;
    const index = spline.indexAt(place.at * spline.length);
    const p = spline.point(index), t = spline.tangent(index);
    const cam = w.camera;
    let nudge = 0;
    s.racers[0].chase.update = () => {
      cam.position.set(p[0] - t[0] * (place.back - nudge), p[1] + place.up, p[2] - t[2] * (place.back - nudge));
      cam.lookAt(p[0] + t[0] * (place.look + nudge), p[1] + 1.2, p[2] + t[2] * (place.look + nudge));
      cam.fov = 58; cam.updateProjectionMatrix();
    };
    const car = s.racers[0].car;
    car.reset([p[0], p[1] + .6, p[2]], Math.atan2(-t[0], -t[2]));
    w.tiles?.update?.(p[0], p[2]);
    for (let i = 0; i < 60; i++) {
      await new Promise(r => setTimeout(r, 500));
      const tiles = g.report().tiles;
      if (tiles && tiles.loading === 0 && tiles.loaded > 0 && i > 6) break;
    }
    const canvas = w.renderer.domElement as HTMLCanvasElement;
    const shots: string[] = [];
    for (let k = 0; k < count; k++) {
      nudge = k * step;
      s.racers[0].chase.update();
      w.render();
      shots.push(canvas.toDataURL('image/png'));
      await new Promise(r => requestAnimationFrame(r));
    }
    // The far mask from the first pose: white where the surface is more than `far` metres from the eye.
    nudge = 0; s.racers[0].chase.update();
    const mat = new (w.sky.dome.material.constructor)({
      vertexShader: `#include <common>\nvarying float vDist;\nvoid main() {\n#include <begin_vertex>\n#include <project_vertex>\nvDist = -mvPosition.z;\n}`,
      fragmentShader: `varying float vDist;\nvoid main() { gl_FragColor = vec4(vec3(vDist > ${far.toFixed(1)} ? 1.0 : 0.0), 1.0); }`,
    });
    const dome = w.sky.dome.visible;
    w.sky.dome.visible = false;
    w.scene.overrideMaterial = mat;
    const bg = w.scene.background, fog = w.scene.fog;
    w.scene.background = null; w.scene.fog = null;
    w.renderer.setClearColor(0x000000, 1);
    w.renderer.render(w.scene, cam);
    const mask = canvas.toDataURL('image/png');
    w.scene.overrideMaterial = null; w.scene.background = bg; w.scene.fog = fog; w.sky.dome.visible = dome;
    return { shots, mask };
  }, { place, step, count: FRAMES, far: FAR_M });
}

const raw = async (url: string) => sharp(Buffer.from(url.split(',')[1]!, 'base64')).removeAlpha().raw().toBuffer({ resolveWithObject: true });

async function jumps(shots: string[], mask: string) {
  const m = await raw(mask);
  const images = await Promise.all(shots.map(raw));
  const farPixels: number[] = [];
  for (let i = 0; i < m.data.length; i += 3) if (m.data[i]! > 127) farPixels.push(i);
  const perFrame: number[] = [];
  for (let k = 1; k < images.length - 1; k++) {
    const a = images[k - 1]!.data, b = images[k]!.data, c = images[k + 1]!.data;
    let n = 0;
    for (const i of farPixels) {
      for (let ch = 0; ch < 3; ch++) {
        const lo = Math.min(a[i + ch]!, c[i + ch]!), hi = Math.max(a[i + ch]!, c[i + ch]!), v = b[i + ch]!;
        if (v < lo - JUMP || v > hi + JUMP) { n++; break; }
      }
    }
    perFrame.push(n / Math.max(1, farPixels.length));
  }
  return { farShare: farPixels.length / (m.info.width * m.info.height), worst: Math.max(...perFrame), mean: perFrame.reduce((x, y) => x + y, 0) / perFrame.length };
}

const results: Record<string, unknown> = {};
for (const [track, time] of CASES) {
  test(`far facades hold still while the car moves: ${track} ${time}`, async ({ page }) => {
    mkdirSync(OUT, { recursive: true });
    await open(page, track, time);
    const place = PLACES[track]!;
    const moving = await frames(page, place, STEP_M);
    const still = await frames(page, place, 0);
    await expectWorldLoaded(page, 'far flicker');
    writeFileSync(resolve(OUT, `${track}-${time}-0.png`), Buffer.from(moving.shots[0]!.split(',')[1]!, 'base64'));
    writeFileSync(resolve(OUT, `${track}-${time}-mask.png`), Buffer.from(moving.mask.split(',')[1]!, 'base64'));
    const move = await jumps(moving.shots, moving.mask), control = await jumps(still.shots, still.mask);
    results[`${track} ${time}`] = { move, control };
    writeFileSync(resolve(OUT, 'results.json'), JSON.stringify(results, null, 1));
    console.log(track, time, JSON.stringify({ move, control }));
    expect(move.farShare, 'the mask found far buildings to measure').toBeGreaterThan(.005);
    expect(control.worst, 'nothing changes in a still frame').toBe(0);
    expect(move.worst, 'far pixels flickering on-off-on by more than 40 levels').toBeLessThan(LIMIT);
  });
}
