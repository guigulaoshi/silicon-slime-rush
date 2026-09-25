import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { DEV_URL } from './server';

/**
 * Billboards exist to be read from a moving car, so what matters is that a face actually carries a
 * picture and that the picture is in the player's language. Both are runtime state hung on shared
 * materials, which is exactly the sort of thing that can quietly stop happening.
 */

// 这个文件真的要开车，所以自己申请预算：默认档是 90 秒（playwright.config.ts），
// 那是「问浏览器一个问题」的价钱。要加载一条真实路线的切片，广告牌才会出现。
test.describe.configure({ timeout: 600_000, mode: 'serial' });
interface FaceInfo { material: string; texture: string | null; width: number; instances: number }
const SHOT_DIR = evidencePath('billboard-language');
// Bay Area tracks deleted; picked by the property each stood for, not the name:
// new-york (dense city, ex fishermans-wharf), sydney (showcase bridge, ex goldengate),
// lhasa (open flat route, ex shoreline), zhangjiajie (winding hill road with switchback hairpins,
// ex twin-peaks and, ex rio too -- rio's own "switchback climb" slot is dropped
// rather than filled by a second track, since it was the same mountain-hairpin property zhangjiajie
// already covers), beijing (a loop, ex wolfe-pruneridge).
const ROUTES = ['new-york', 'sydney',
  'lhasa', 'zhangjiajie', 'beijing'];

const faces = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const out: FaceInfo[] = [];
  window.game.session.world.streamer.root.traverse((o: unknown) => {
    const n = o as { material?: { name?: string; map?: { uuid?: string; image?: { width?: number } } };
      count?: number };
    if (!n.material?.name?.startsWith('billboard_face_')) return;
    out.push({
      material: n.material.name,
      texture: n.material.map?.uuid ?? null,
      width: n.material.map?.image?.width ?? 0,
      instances: n.count ?? 0,
    });
  });
  return out;
});

test('boards along the road carry a face, and the face follows the language', async ({ page }) => {
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // zhangjiajie: winding mountain road (game/public/tracks/zhangjiajie/track.json), replacing
  // twin-peaks (deleted) as the winding-hill-road test bed.
  await page.goto('/?track=zhangjiajie&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().track != null, null, { timeout: 60_000 });
  await page.waitForFunction(() => (window.game.report().tiles?.loaded ?? 0) > 2, null, { timeout: 60_000 });
  await page.waitForFunction(() => window.game.session.world.billboards.ready);

  // pin the language first: the browser locale decides it otherwise, and the second half of this
  // test is that switching away repaints every board
  await page.evaluate(() => window.game.session.world.billboards.setLanguage('en'));
  const manifest = await page.evaluate(() => window.game.session.world.billboards.faces.map(
    (face: { kind: string; zh: { image?: string; headline?: string; platform?: string };
      en: { image?: string; headline?: string; platform?: string } }) => ({
      kind: face.kind, zh: face.zh.image ?? face.zh.headline, en: face.en.image ?? face.en.headline,
      zhHeadline: face.zh.headline, enHeadline: face.en.headline,
      zhPlatform: face.zh.platform, enPlatform: face.en.platform,
    }),
  ));
  expect(manifest).toHaveLength(14);
  expect(manifest.filter((face) => face.kind === 'social')).toHaveLength(7);
  expect(manifest.filter((face) => face.kind === 'space')).toHaveLength(7);
  expect(manifest.filter((face) => face.kind === 'space').every((face) => face.zh !== face.en)).toBe(true);
  // Chinese boards show the four Chinese platforms, English boards the three English ones.
  const social = manifest.filter((face) => face.kind === 'social');
  expect(new Set(social.map((face) => face.zhPlatform))).toEqual(new Set(['bilibili', 'xiaohongshu', 'douyin', 'wechat']));
  expect(new Set(social.map((face) => face.enPlatform))).toEqual(new Set(['x', 'youtube', 'tiktok']));
  const before = await faces(page);
  const canvases = () => page.evaluate(() => {
    const materials = window.game.session.world.materials;
    return 'bdfhjln'.split('').map(slot => {
      const texture = (materials.get(`billboard_face_${slot}`) as any).map;
      if (!(texture?.image instanceof HTMLCanvasElement)) throw new Error(`missing bilingual canvas ${slot}`);
      return texture.image.toDataURL();
    });
  });
  const availableBefore = await canvases();
  expect(before.length, 'no billboard faces in the loaded tiles').toBeGreaterThan(0);
  for (const f of before) {
    expect(f.texture, `${f.material} has no picture on it`).toBeTruthy();
    expect(f.width, `${f.material} drew an empty canvas`).toBeGreaterThan(0);
    expect(f.instances).toBeGreaterThan(0);
  }

  const repainted = await page.evaluate(() => {
    const world = window.game.session.world;
    const materials = 'abcdefghijklmn'.split('').map(slot =>
      world.materials.get(`billboard_face_${slot}`) as any);
    const previous = materials.map(material => material.map.uuid);
    world.billboards.setLanguage('zh');
    return materials.map((material, i) => Boolean(material.map?.uuid && material.map.uuid !== previous[i]));
  });
  expect(repainted, 'switching language must repaint all fourteen shared faces').toEqual(Array(14).fill(true));
  expect(await canvases(), 'available-space faces must keep identical bilingual pixels').toEqual(availableBefore);

  expect(errors, errors.join('\n')).toHaveLength(0);
});

/** Load the part of the route that owns a slot, then put the camera on its real road approach. */
async function focusFromRoad(page: import('@playwright/test').Page, material: string, lang: 'zh' | 'en') {
  return page.evaluate(async ({ wanted, language }) => {
    const game = window.game as unknown as { phase: string; session: any };
    const world = game.session.world;
    const length = game.session.track.spline.length as number;
    game.phase = 'paused';
    world.billboards.setLanguage(language);

    let hit: { object: any; index: number } | null = null;
    for (let step = 1; step <= 16 && !hit; step++) {
      const s = length * step / 17;
      const point = world.spline.point(world.spline.indexAt(s));
      // One call starts four loads. Repeat after they finish until the local window is complete.
      for (let batch = 0; batch < 4 && !hit; batch++) {
        world.streamer.update(s, point[0], point[2]);
        for (let wait = 0; wait < 60 && world.streamer.stats.loading > 0; wait++) {
          await new Promise((resolveWait) => setTimeout(resolveWait, 50));
        }
        world.streamer.root.updateMatrixWorld(true);
        world.streamer.root.traverse((object: any) => {
          if (hit || object.material?.name !== wanted || !object.isInstancedMesh) return;
          if (object.count > 0) hit = { object, index: 0 };
        });
      }
    }
    if (!hit) throw new Error(`could not stream a face using ${wanted}`);

    const object = (hit as { object: any }).object;
    const instance = object.matrixWorld.clone();
    object.getMatrixAt((hit as { index: number }).index, instance);
    const matrix = object.matrixWorld.clone().multiply(instance);
    const face = world.camera.position.clone();
    const rotation = world.camera.quaternion.clone();
    const scale = world.camera.position.clone();
    matrix.decompose(face, rotation, scale);

    // The closest spline point is the road beside the board. Walk backwards through the real
    // sampled centreline, rather than placing the camera on the verge directly in front of it.
    const points = game.session.track.spline.points as [number, number, number][];
    let nearest = 0;
    let nearestD2 = Infinity;
    points.forEach((p, i) => {
      const d2 = (p[0] - face.x) ** 2 + (p[2] - face.z) ** 2;
      if (d2 < nearestD2) { nearest = i; nearestD2 = d2; }
    });
    const back = scale.y > 7 ? 55 : 30;
    const closed = game.session.track.spline.closed as boolean;
    const approach = closed ? (nearest - back + points.length) % points.length : Math.max(0, nearest - back);
    world.camera.position.set(points[approach]![0], points[approach]![1] + 2.1, points[approach]![2]);
    world.camera.fov = 52;
    world.camera.updateProjectionMatrix();
    world.camera.lookAt(face);
    document.querySelectorAll<HTMLElement>('#ui, .tuning-panel, .touch-controls')
      .forEach((node) => { node.style.display = 'none'; });
    world.render();
    return { material: wanted, language, face: [face.x, face.y, face.z], road: points[approach] };
  }, { wanted: material, language: lang });
}

test('day and night road views show every localized social face without crossing braces', async ({ page }) => {
  mkdirSync(SHOT_DIR, { recursive: true });
  for (const time of ['day', 'night']) {
    // lhasa: open flat route (game/public/tracks/lhasa/track.json), replacing shoreline.
    await page.goto(`/?track=lhasa&bot=1&dev=1&time=${time}`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
    for (const lang of ['zh', 'en'] as const) {
      for (const slot of 'acegikm') {
        const material = `billboard_face_${slot}`;
        const social = await focusFromRoad(page, material, lang);
        expect(social.material).toBe(material);
        await page.screenshot({ path: resolve(SHOT_DIR, `${time}-social-${lang}-${slot}.png`) });
      }
      const space = await focusFromRoad(page, 'billboard_face_b', lang);
      expect(space.material).toBe('billboard_face_b');
      await page.screenshot({ path: resolve(SHOT_DIR, `${time}-space-${lang}.png`) });
      const image = await page.evaluate(() => {
        const material = window.game.session.world.materials.get('billboard_face_b') as any;
        return (material.map.image as HTMLCanvasElement).toDataURL().split(',')[1]!;
      });
      writeFileSync(resolve(SHOT_DIR, `${time}-face-${lang}.png`), Buffer.from(image, 'base64'));
    }
  }
});

test('every billboard on every shipped route is reached first by all five road-view rays', async ({ page }) => {
  for (const route of ROUTES) {
    await page.goto(`${DEV_URL}/?track=${route}&bot=1&dev=1`);
    await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 90_000 });
    const length = await page.evaluate(() => {
      (window.game as unknown as { phase: string }).phase = 'paused';
      return window.game.session.track.spline.length as number;
    });
    const seen = new Map<string, {
      material: string; side: -1 | 1; blockedSamples: number; blockers: string[];
    }>();
    for (let s = 0; s <= length + 1; s += 700) {
      const batch = await page.evaluate(async (at) => {
        const game = window.game as unknown as { session: any };
        const world = game.session.world;
        const clamped = Math.min(at, game.session.track.spline.length);
        const point = world.spline.point(world.spline.indexAt(clamped));
        // Drain the local streaming window without driving the course. This visits scenery points,
        // not game time, so eight routes take seconds rather than eight complete races.
        for (let pass = 0; pass < 16; pass++) {
          const before = world.streamer.stats.loaded;
          world.streamer.update(clamped, point[0], point[2]);
          for (let wait = 0; wait < 80 && world.streamer.stats.loading > 0; wait++) {
            await new Promise((resolveWait) => setTimeout(resolveWait, 25));
          }
          if (world.streamer.stats.loaded === before && world.streamer.stats.loading === 0) break;
        }
        const modulePath = '/e2e/billboard-audit.ts';
        const { auditLoadedBillboards } = await import(/* @vite-ignore */ modulePath);
        return auditLoadedBillboards(world.scene);
      }, s);
      for (const item of batch) seen.set(item.key, item);
    }
    expect(seen.size, `${route}: not every required billboard was streamed`).toBeGreaterThanOrEqual(10);
    const materials = new Set([...seen.values()].map((item) => item.material));
    if (seen.size >= 14) {
      expect(materials, `${route}: incomplete 14-slot cycle`).toEqual(
        new Set(Array.from({ length: 14 }, (_, i) => `billboard_face_${String.fromCharCode(97 + i)}`)),
      );
    } else {
      expect(seen.size, `${route}: constrained fallback must contain exactly ten boards`).toBe(10);
      expect(materials).toEqual(new Set('acbegdikfm'.split('').map((slot) => `billboard_face_${slot}`)));
    }
    const blocked = [...seen.values()].filter((item) => item.blockedSamples > 0);
    expect(blocked, `${route}: ${JSON.stringify(blocked)}`).toHaveLength(0);
    const byKind = (social: boolean) => [...seen.values()].filter((item) => {
      const slot = item.material.at(-1)!;
      return ('acegikm'.includes(slot)) === social;
    });
    for (const social of [true, false]) {
      expect(new Set(byKind(social).map((item) => item.side)),
        `${route}: ${social ? 'owner adverts' : 'available-space faces'} must use both verges`)
        .toEqual(new Set([-1, 1]));
    }
  }
});
