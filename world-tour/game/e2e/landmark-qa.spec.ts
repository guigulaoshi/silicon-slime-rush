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
const SAVE_KEY = 'silicon-rush-world-tour.save.v1';

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

// Beijing is the only new track with real named GLB landmarks (game/public/tracks/beijing/track.json),
// so the seven Bay Area silhouette shots below (a, b, c, d, e, i, j) were retargeted to Beijing's seven
// landmarks, one each, in route order. For each, `target` is that landmark's own `pos` from track.json
// (raised ~15-20 m so the camera looks at the building rather than its ground anchor) and `at` is the
// nearest spline sample's arc length to that landmark, minus ~50 m so the approach is from before it
// rather than on top of it -- both read straight out of track.json, not guessed.
const SHOTS: Shot[] = [
  { id: 'a', track: 'beijing', at: 478, target: [-211.81, 64.48, -522.85], fov: 55, up: 8 }, // Great Hall of the People, s=528
  { id: 'b', track: 'beijing', at: 908, target: [123.84, 69.15, -953.53], fov: 45, up: 8 }, // Tiananmen Gate, s=958
  { id: 'c', track: 'beijing', at: 1324, target: [476.83, 68.46, -551.35], fov: 45, up: 8 }, // National Museum, s=1374
  { id: 'd', track: 'beijing', at: 1370, target: [137.83, 66.66, -493.23], fov: 45, up: 8 }, // Monument to the People's Heroes, s=1420
  { id: 'e', track: 'beijing', at: 1602, target: [147.67, 68.81, -261.76], fov: 45, up: 8 }, // Mao Zedong Memorial Hall, s=1652
  { id: 'i', track: 'beijing', at: 2012, target: [154.09, 66.99, -48.23], fov: 45, up: 8 }, // Zhengyangmen Gate, s=2062
  { id: 'j', track: 'beijing', at: 2016, target: [157.63, 67.19, 86.85], fov: 42,
    aerial: { x: 150, y: 200, z: 150 } }, // Zhengyangmen Arrow Tower, s=2066
  // No new track keeps two distinct water-crossing bridges on one route the way fishermans-wharf did, so
  // the lookback/forward pair is split across the two clearest bridge tracks instead: Sydney's Harbour
  // Bridge (the route's very first leg per pipeline/routes/sydney.json: "South across the Harbour
  // Bridge... down the York Street off-ramp") for the lookback, and Shanghai's Waibaidu/Garden Bridge
  // (the route's last leg per pipeline/routes/shanghai.json: "...over the Waibaidu (Garden) Bridge onto
  // Huangpu Road") for the forward approach. `bridge_steel`/`bridge_metal` are the generic bridge-deck
  // materials from pipeline/sr/bridge.py (built for any route's water crossing), not the deleted
  // Golden-Gate/Bay-Bridge-specific procedural landmarks in pipeline/sr/landmarks.py, so this mechanism
  // still applies. `at`/`target`/the headingDot sign were derived from game/public/tracks/{sydney,
  // shanghai}/track.json's spline samples (target = the point at the route's other end, raised to a
  // plausible bridge-deck/tower height) and checked to produce the sign the assertions require -- but
  // whether that target actually falls inside the *built* bridge mesh's silhouette (as opposed to just
  // the open road/water under it) needs a live look, since the bridge geometry itself isn't in these
  // JSON files.
  { id: 'k', track: 'sydney', at: 300,
    // RETARGET-MEASURE: confirm this target frames the harbour bridge's bridge_steel mesh, not just open water/road
    target: [-3.79, 81.19, -35.22], fov: 18, up: 7,
    evidence: 'sydney-bridge-lookback.png' },
  { id: 'l', track: 'shanghai', at: 2550,
    // RETARGET-MEASURE: confirm this target frames the Waibaidu Bridge's bridge_metal mesh, not just open water/road
    target: [38.59, 35.89, -1016.36], fov: 46, up: 7,
    evidence: 'shanghai-bridge-forward.png' },
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
      if (shot.id === 'k') expect(frame.headingDot, 'the Harbour Bridge is a lookback toward the route start').toBeLessThan(-0.5);
      if (shot.id === 'l') expect(frame.headingDot, 'the Waibaidu Bridge is ahead on the Bund').toBeGreaterThan(0.7);
      if (shot.id === 'l') expect(frame.approachDistances,
        'the Waibaidu Bridge grows closer heading north up the Bund')
        .toEqual([...frame.approachDistances].sort((a, b) => b - a));
    }
    writeFileSync(resolve(OUT, shot.evidence ?? `136-${shot.id}.png`),
      Buffer.from(frame.url.split(',')[1]!, 'base64'));
  }
});
