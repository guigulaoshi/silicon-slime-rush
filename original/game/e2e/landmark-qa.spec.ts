import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectWorldLoaded } from './world';

/**
 * Fixed route evidence for. The letter-only output names are intentional: the visual
 * reviewer receives paired reference/game images without a route or building name as a hint.
 *
 *   LANDMARK_QA=1 npx playwright test e2e/landmark-qa.spec.ts
 */
test.describe.configure({ timeout: 600_000, mode: 'serial' });
test.use({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true });
test.skip(process.env.LANDMARK_QA !== '1', 'run explicitly to produce landmark review evidence');

const OUT = evidencePath('landmark-qa');
const SAVE_KEY = 'silicon-rush.save.v1';

interface Shot {
  id: string;
  track: string;
  at: number;
  target?: [number, number, number];
  fov: number;
  up?: number;
  aerial?: { x: number; y: number; z: number };
  position?: [number, number, number];
  evidence?: string;
}

const SHOTS: Shot[] = [
  { id: 'a', track: 'goldengate', at: 1600, fov: 62 },
  // Fisherman's Wharf is the route that actually advertises Alcatraz in its blurb, and is 2.2 km
  // from the island rather than the Golden Gate route's five. Keep the evidence at the real route
  // distance; adding the landmark to this backdrop also makes it readable during normal play.
  { id: 'b', track: 'fishermans-wharf', at: 1212,
    target: [-880.4, 56, -2075.6], fov: 8, position: [46.94, 11.42, -62.67] },
  { id: 'c', track: 'twin-peaks', at: 2726, target: [-511.1, 405, -355.2], fov: 35, up: 8 },
  { id: 'd', track: 'twin-peaks', at: 2819, target: [15.6, 267, -278.9], fov: 35, up: 5 },
  { id: 'e', track: 'shoreline', at: 1900, target: [-1732.5, 17, -1341.5], fov: 62, up: 18 },
  { id: 'i', track: 'shoreline', at: 1462, target: [534.8, 30, -326.3], fov: 9, up: 100 },
  { id: 'j', track: 'wolfe-pruneridge', at: 904, target: [-2.6, 75, 7.1], fov: 42,
    aerial: { x: 350, y: 320, z: 350 } },
  // Real route positions for 252: the start looks back west across Aquatic Park, while the later
  // Embarcadero camera faces southeast toward the Bay Bridge west span.
  { id: 'k', track: 'fishermans-wharf', at: 350,
    target: [-5761.8, 140, -1309.5], fov: 18, up: 7,
    evidence: 'golden-gate-lookback.png' },
  { id: 'l', track: 'fishermans-wharf', at: 2400,
    target: [3010.4, 95, 1190.4], fov: 46, up: 7,
    evidence: 'bay-bridge-forward.png' },
];

async function settle(page: Page, at: number): Promise<void> {
  let previous = -1;
  for (let round = 0; round < 40; round++) {
    await page.evaluate(([s, clear]: number[]) => {
      const w = window.game.session.world;
      if (clear) w.streamer.clear();
      const p = w.spline.point(w.spline.indexAt(s!));
      w.follow(s!, p[0]!, p[1]!, p[2]!);
    }, [at, round === 0 ? 1 : 0]);
    await page.waitForFunction(() => (window.game.report().tiles?.loading ?? 1) === 0
      && window.game.session.world.backdrop.ready, null, { timeout: 120_000, polling: 100 });
    const loaded = await page.evaluate(() => window.game.report().tiles?.loaded ?? 0);
    if (loaded === previous) {
      for (let retry = 0; retry < 3; retry++) {
        await page.evaluate((s) => {
          const w = window.game.session.world;
          const p = w.spline.point(w.spline.indexAt(s));
          w.follow(s, p[0]!, p[1]!, p[2]!);
        }, at);
      }
      return;
    }
    previous = loaded;
  }
  throw new Error(`${at} m never settled`);
}

test('closed landmarks match their real silhouettes from the route', async ({ page }) => {
  mkdirSync(OUT, { recursive: true });
  await page.addInitScript(({ key }) => localStorage.setItem(key, JSON.stringify({
    version: 1, language: 'en', quality: 'low', volume: 0, muted: true, best: {},
  })), { key: SAVE_KEY });

  const requested = new Set((process.env.LANDMARK_QA_IDS ?? '').split(',').filter(Boolean));
  const known = new Set(SHOTS.map((shot) => shot.id));
  const unknown = [...requested].filter((id) => !known.has(id));
  expect(unknown, 'every requested landmark evidence id must exist').toEqual([]);
  const selected = SHOTS.filter((candidate) => !requested.size || requested.has(candidate.id));
  expect(selected.length, 'landmark evidence must examine at least one frame').toBeGreaterThan(0);
  for (const shot of selected) {
    await page.goto(`/?track=${shot.track}&bot=1&time=day`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null,
      { timeout: 90_000 });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => window.game.report().phase === 'paused');
    await settle(page, shot.at);
    await expectWorldLoaded(page, `landmark evidence ${shot.id}`);

    const frame = await page.evaluate((spec: Shot) => {
      const g = window.game;
      const w = g.session.world;
      const i = w.spline.indexAt(spec.at);
      const p = w.spline.point(i);
      const tangent = w.spline.tangent(i);
      if (spec.position && spec.target) {
        w.camera.position.set(...spec.position);
        w.camera.lookAt(...spec.target);
      } else if (spec.aerial && spec.target) {
        w.camera.position.set(spec.target[0] + spec.aerial.x,
          spec.target[1] + spec.aerial.y, spec.target[2] + spec.aerial.z);
        w.camera.lookAt(...spec.target);
      } else if (spec.target) {
        w.camera.position.set(p[0]!, p[1]! + (spec.up ?? 5), p[2]!);
        w.camera.lookAt(...spec.target);
      } else {
        w.camera.position.set(p[0]! - tangent[0]! * 9, p[1]! + 3.2, p[2]! - tangent[2]! * 9);
        w.camera.lookAt(p[0]! + tangent[0]! * 120, p[1]! + 5, p[2]! + tangent[2]! * 120);
      }
      w.camera.fov = spec.fov;
      w.camera.updateProjectionMatrix();
      w.camera.updateMatrixWorld(true);
      const wantedMaterial = spec.id === 'k' ? 'bridge_steel'
        : spec.id === 'l' ? 'bridge_metal' : '';
      let bridgeMeshes = 0;
      let bridgeMeshesInView = 0;
      w.backdrop.root.updateMatrixWorld(true);
      w.backdrop.root.traverse((object) => {
        const mesh = object as any;
        const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        if (!mesh.isMesh || !materials.some((material: any) => material?.name === wantedMaterial)) return;
        bridgeMeshes++;
        mesh.geometry.computeBoundingSphere();
        const projected = mesh.geometry.boundingSphere.center.clone()
          .applyMatrix4(mesh.matrixWorld).project(w.camera);
        if (Math.abs(projected.x) <= 1 && Math.abs(projected.y) <= 1
          && projected.z >= -1 && projected.z <= 1) bridgeMeshesInView++;
      });
      const dx = spec.target ? spec.target[0] - w.camera.position.x : 0;
      const dy = spec.target ? spec.target[1] - w.camera.position.y : 0;
      const dz = spec.target ? spec.target[2] - w.camera.position.z : 0;
      const targetDistance = Math.hypot(dx, dy, dz);
      const fogFar = (w.scene.fog as any)?.far ?? Infinity;
      const horizontal = Math.hypot(dx, dz);
      const headingDot = horizontal ? (dx * tangent[0]! + dz * tangent[2]!) / horizontal : 0;
      const approachDistances = spec.id === 'l' && spec.target
        ? [1200, 1800, 2400].map(s => {
          const routePoint = w.spline.point(w.spline.indexAt(s));
          return Math.hypot(spec.target![0] - routePoint[0]!, spec.target![2] - routePoint[2]!);
        }) : [];
      g.session.mesh.visible = false;
      g.session.sparks.mesh.visible = false;
      w.render();
      const url = w.renderer.domElement.toDataURL('image/png');
      g.session.mesh.visible = true;
      g.session.sparks.mesh.visible = true;
      return { url, failed: w.streamer.stats.failed, width: w.renderer.domElement.width,
        height: w.renderer.domElement.height, bridgeMeshes, bridgeMeshesInView,
        targetDistance, fogFar, headingDot, approachDistances };
    }, shot);
    expect(frame.failed).toBe(0);
    expect([frame.width, frame.height]).toEqual([932, 430]);
    if (shot.id === 'k' || shot.id === 'l') {
      expect(frame.bridgeMeshes, `${shot.id}: requested bridge exists in the loaded backdrop`).toBeGreaterThan(0);
      expect(frame.bridgeMeshesInView, `${shot.id}: requested bridge intersects the route camera`).toBeGreaterThan(0);
      expect(frame.targetDistance / frame.fogFar, `${shot.id}: bridge stays inside useful fog range`).toBeLessThan(0.82);
      if (shot.id === 'k') expect(frame.headingDot, 'Golden Gate is a westward lookback').toBeLessThan(-0.5);
      if (shot.id === 'l') expect(frame.headingDot, 'Bay Bridge is ahead on the Embarcadero').toBeGreaterThan(0.7);
      if (shot.id === 'l') expect(frame.approachDistances,
        'the Bay Bridge grows closer through the southbound Embarcadero drive')
        .toEqual([...frame.approachDistances].sort((a, b) => b - a));
    }
    writeFileSync(resolve(OUT, shot.evidence ?? `136-${shot.id}.png`),
      Buffer.from(frame.url.split(',')[1]!, 'base64'));
  }
});
