import { evidencePath } from './evidence';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { expectWorldLoaded } from './world';

test.describe.configure({ timeout: 180_000 });
test.use({ viewport: { width: 932, height: 430 }, deviceScaleFactor: 3,
  isMobile: true, hasTouch: true });

const OUT = evidencePath('checkpoint-hologram');

interface GateState { language: string; textures: string[]; labels: string[] }

const gateState = (page: import('@playwright/test').Page) => page.evaluate(() => {
  const game = window.game as unknown as {
    session: { gates: { group: { children: { children: unknown[] }[] } } };
  };
  const textures: string[] = [];
  const labels: string[] = [];
  for (const hologram of game.session.gates.group.children) {
    for (const child of hologram.children) {
      const mesh = child as { material?: { map?: { uuid?: string; userData?: { checkpointLabel?: string } };
        userData?: { checkpointLabel?: boolean } } };
      if (!mesh.material?.userData?.checkpointLabel) continue;
      if (mesh.material?.map?.uuid) {
        textures.push(mesh.material.map.uuid);
        labels.push(mesh.material.map.userData?.checkpointLabel ?? '');
      }
    }
  }
  return { language: document.documentElement.lang, textures, labels } satisfies GateState;
});

test('checkpoint banners follow a language change during the race', async ({ context, page }) => {
  await context.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'high', volume: 0, muted: true, best: {},
  })));
  // beijing: the new loop route (game/public/tracks/beijing/track.json, 3 checkpoints),
  // replacing wolfe-pruneridge for this checkpoint-hologram language test.
  await page.goto('/?track=beijing&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 60_000 });
  const before = await gateState(page);
  expect(before.language).toBe('en');
  expect(before.textures.length, 'no checkpoint label faces were built').toBeGreaterThan(0);
  expect(new Set(before.textures).size).toBe(before.textures.length / 2);
  expect(new Set(before.labels)).toEqual(new Set(['CHECKPOINT']));

  await page.evaluate(() => {
    const game = window.game as unknown as { pickSetting(item: { id: string; label: string }): void };
    game.pickSetting({ id: 'language', label: 'Language' });
  });
  const after = await gateState(page);
  expect(after.language).toBe('zh');
  expect(after.textures).toHaveLength(before.textures.length);
  expect(new Set(after.textures).size).toBe(after.textures.length / 2);
  after.textures.forEach((uuid, index) => expect(uuid).not.toBe(before.textures[index]));
  expect(new Set(after.labels)).toEqual(new Set(['检查点']));
});

test('numbered hologram hangs over the road in the phone view', async ({ context, page }) => {
  test.skip(process.env.CHECKPOINT_QA !== '1', 'run explicitly to produce visual evidence');
  mkdirSync(OUT, { recursive: true });
  await context.addInitScript(() => localStorage.setItem('silicon-rush-world-tour.save.v1', JSON.stringify({
    version: 1, language: 'en', quality: 'low', volume: 0, muted: true, best: {},
  })));
  await page.goto('/?track=beijing&bot=1&time=night');
  await page.waitForFunction(() => window.game?.report().phase === 'racing', null, { timeout: 60_000 });
  // The mobile control only becomes visible after touch input; Escape exercises the same pause
  // action without spending the whole test waiting on a deliberately hidden button.
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.report().phase === 'paused');
  await page.evaluate(() => {
    const g = window.game;
    const cp = g.session.track.checkpoints[1]!;
    g.session.world.follow(cp.s, cp.pos[0], cp.pos[1], cp.pos[2]);
  });
  await page.waitForFunction(() => (window.game.report().tiles?.loading ?? 1) === 0);
  await expectWorldLoaded(page, 'checkpoint hologram evidence');
  const frame = await page.evaluate(() => {
    const g = window.game;
    const w = g.session.world;
    const marker = g.session.gates.group.children.find((child) => child.userData.hologram)!;
    const forwardX = Math.sin(marker.rotation.y);
    const forwardZ = Math.cos(marker.rotation.y);
    w.camera.position.set(marker.position.x - forwardX * 22, marker.position.y + 2.4,
      marker.position.z - forwardZ * 22);
    w.camera.lookAt(marker.position.x, marker.position.y + 4.6, marker.position.z);
    w.camera.fov = 52;
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld(true);
    g.session.mesh.visible = false;
    w.render();
    const labels = marker.children.filter((child) => child.name.startsWith('checkpoint-label'));
    const map = (labels[0] as import('three').Mesh).material as import('three').MeshBasicMaterial;
    const image = map.map!.image as HTMLCanvasElement;
    return {
      url: w.renderer.domElement.toDataURL('image/png'),
      childNames: marker.children.map((child) => child.name),
      labelFaces: labels.length,
      texture: [image.width, image.height],
      canvas: [w.renderer.domElement.width, w.renderer.domElement.height],
    };
  });
  expect(frame.childNames).toEqual([
    'checkpoint-hologram-glow', 'checkpoint-label-front', 'checkpoint-label-back',
  ]);
  expect(frame.labelFaces).toBe(2);
  expect(frame.texture).toEqual([1024, 256]);
  expect(frame.canvas).toEqual([932, 430]);
  writeFileSync(resolve(OUT, 'phone-night.png'), Buffer.from(frame.url.split(',')[1]!, 'base64'));
});
