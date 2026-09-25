import { describe, expect, it } from 'vitest';
import { TileStreamer } from '../src/world/TileStreamer';
import { timeOfDayFor } from '../src/world/World';
import { expectWorldLoaded } from '../e2e/world';
import * as THREE from 'three';
import { RAIN_BOX, SNOW_BOX, Sky, wrapInto } from '../src/world/Sky';
import { MaterialLibrary } from '../src/world/materials';

/**
 * The empty-world guard, tested here rather than left to the specs that use it.
 *
 * Nothing in the delivery gate runs Playwright: it runs vitest, tsc, vite and the two pytest
 * suites (`tools/delivery_gate.py`). So a guard that lives only inside `e2e/*.spec.ts` could be
 * deleted and every gate would stay green -- which is the exact shape of bug this guard exists to
 * stop. `expectWorldLoaded` takes a page and calls `evaluate` on it, so a stand-in page with an
 * `evaluate` that returns a canned report is enough to drive all four of its branches.
 */
const page = (tiles: { loaded: number; loading: number; failed: number } | null,
              textures: number | null = 3) => ({
  evaluate: async (fn: (...args: unknown[]) => unknown) => {
    const w = { game: { report: () => ({ tiles, textures }) } };
    const saved = (globalThis as { window?: unknown }).window;
    (globalThis as { window?: unknown }).window = w;
    try {
      return await fn();
    } finally {
      (globalThis as { window?: unknown }).window = saved;
    }
  },
}) as unknown as Parameters<typeof expectWorldLoaded>[0];

describe('the empty-world guard', () => {
  it('passes a track whose tiles are loaded and none of which failed', async () => {
    await expectWorldLoaded(page({ loaded: 37, loading: 2, failed: 0 }), 'goldengate');
  });

  it('fails when every tile 404s, and names the command that fixes it', async () => {
    // The state an unseeded worktree is in: tiles are a gitignored build artifact, so the game
    // boots off the tracked track.json and every tile request comes back 404. The picture that
    // came out of that was a car flying through an empty sky, and the spec passed.
    await expect(expectWorldLoaded(page({ loaded: 0, loading: 0, failed: 30 }), 'goldengate'))
      .rejects.toThrow(/tools\/assets\.py ensure --all/);
  });

  it('fails when a track is only half built, not just when it is wholly missing', async () => {
    // failed is cumulative, so a track built as far as the toll plaza and no further is caught
    // even though tiles are loaded at the moment of asking.
    await expect(expectWorldLoaded(page({ loaded: 12, loading: 0, failed: 4 }), 'goldengate'))
      .rejects.toThrow(/4 tiles failed to load/);
  });

  it('fails when nothing is resident even though nothing has failed yet', async () => {
    // Early enough in a run, tiles that will never arrive are still retrying, so `failed` is 0.
    await expect(expectWorldLoaded(page({ loaded: 0, loading: 3, failed: 0 }), 'goldengate'))
      .rejects.toThrow(/empty world/);
  });

  it('fails when the game reports no streamer at all', async () => {
    await expect(expectWorldLoaded(page(null), 'goldengate'))
      .rejects.toThrow(/never reported a tile streamer/);
  });

  it('fails when the tiles arrived but no material is textured', async () => {
    // Same shape of hole as the missing tiles, one asset directory along: `game/public/textures/`
    // is generated and gitignored, so a tree that never ran the generator renders every surface in
    // its greybox colour and every ceiling in the baseline is satisfied by it.
    await expect(expectWorldLoaded(page({ loaded: 37, loading: 0, failed: 0 }, 0), 'goldengate'))
      .rejects.toThrow(/no material is textured/);
  });

  it('fails when the game reports no materials at all', async () => {
    await expect(expectWorldLoaded(page({ loaded: 37, loading: 0, failed: 0 }, null), 'goldengate'))
      .rejects.toThrow(/never reported its materials/);
  });
});

describe('who answers "has the world arrived"', () => {
  it('is only the guard above -- the streamer offers no second, wrong answer', () => {
    /* */
    expect(Object.getOwnPropertyNames(TileStreamer.prototype)).not.toContain('isReady');
  });
});

describe('which time of day a race runs in', () => {
  // The track still carries one, because a track
  // built for dusk has to look right when nobody chose; the player's answer simply wins. Without
  // this test the whole path -- start screen to `World` -- could be reverted and every suite stays
  // green, which is how the choice would quietly stop mattering.
  const track = { timeOfDay: 'day' as const };

  it('takes the player answer over the track default', () => {
    expect(timeOfDayFor(track, { timeOfDay: 'night' })).toBe('night');
  });

  it('falls back to the track when nobody chose', () => {
    expect(timeOfDayFor(track, {})).toBe('day');
    expect(timeOfDayFor(track)).toBe('day');
  });
});

describe('independent weather', () => {
  it('makes fog short but drivable and scales rain streaks by quality', () => {
    const fogScene = new THREE.Scene();
    const fog = new Sky(fogScene, 'day', 90, 2100, 'fog');
    expect(fog.stats).toMatchObject({ weather: 'fog', rainStreaks: 0 });
    expect(fog.stats.fogNear).toBeLessThan(30);
    expect(fog.stats.fogFar).toBeGreaterThanOrEqual(150);
    fog.dispose();

    const rainScene = new THREE.Scene();
    const rain = new Sky(rainScene, 'night', 90, 2100, 'rain');
    rain.setShadowQuality('low');
    expect(rain.stats).toMatchObject({ weather: 'rain', rainStreaks: 260 });
    let thunder = false;
    for (let i = 0; i < 30; i++) thunder ||= rain.update(.1);
    expect(thunder).toBe(true);
    expect(rain.stats.lightning).toBeGreaterThan(0);
    const camera = new THREE.PerspectiveCamera();
    camera.lookAt(1, 0, 0); camera.updateMatrixWorld();
    rain.beforeCamera(camera, 45);
    const fastX = (rain.rain.geometry.getAttribute('position').array as Float32Array).slice(0, 6);
    camera.lookAt(0, 0, -1); camera.updateMatrixWorld();
    rain.beforeCamera(camera, 45);
    const fastZ = (rain.rain.geometry.getAttribute('position').array as Float32Array).slice(0, 6);
    rain.beforeCamera(camera, 0);
    const stopped = (rain.rain.geometry.getAttribute('position').array as Float32Array).slice(0, 6);
    expect(Math.abs(fastX[3]! - fastX[0]!)).toBeGreaterThan(3);
    expect(Math.abs(fastZ[5]! - fastZ[2]!)).toBeGreaterThan(3);
    expect(Math.abs(stopped[3]! - stopped[0]!)).toBeCloseTo(.22);
    rain.dispose();
  });

  it('draws cheaper drifting snow on low quality without thunder', () => {
    const scene = new THREE.Scene();
    const snow = new Sky(scene, 'day', 90, 2100, 'snow');
    snow.setShadowQuality('low');
    expect(snow.stats).toMatchObject({ weather: 'snow', rainStreaks: 0, snowFlakes: 350, lightning: 0 });
    const camera = new THREE.PerspectiveCamera(); camera.position.set(12, 8, -4); camera.updateMatrixWorld();
    const flakes = () => (snow.snow.geometry.getAttribute('position').array as Float32Array).slice();
    snow.beforeCamera(camera, 20);
    const before = flakes();
    let thunder = false;
    for (let i = 0; i < 30; i++) thunder ||= snow.update(.1);
    snow.beforeCamera(camera, 20);
    const after = flakes();
    expect(thunder).toBe(false);
    expect(after[1]).toBeLessThan(before[1]!);
    expect(after[0]).not.toBeCloseTo(before[0]!);
    expect(snow.snow.position.toArray()).toEqual([12, 8, -4]);
    snow.dispose();
  });

  // The camera drives through the precipitation instead of carrying it along.
  for (const weather of ['snow', 'rain'] as const) it(`${weather} comes at a moving camera and passes it, faster at speed`, () => {
    const sky = new Sky(new THREE.Scene(), 'day', 90, 2100, weather);
    const object = weather === 'snow' ? sky.snow : sky.rain;
    const stride = weather === 'snow' ? 3 : 6;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(3000, 40, -2000); camera.lookAt(3000, 40, -2001); camera.updateMatrixWorld();
    const local = () => (object.geometry.getAttribute('position').array as Float32Array).slice();
    // How far, along the camera's own forward axis, the median flake moved relative to the camera
    // over one second driven at `speed` (negative = came towards and past the lens).
    const drift = (speed: number) => {
      sky.beforeCamera(camera, speed);
      const start = local();
      for (let i = 0; i < 60; i++) {
        sky.update(1 / 60);
        camera.position.z -= speed / 60; camera.updateMatrixWorld();
      }
      sky.beforeCamera(camera, speed);
      const end = local();
      const moved: number[] = [];
      for (let i = 0; i < start.length; i += stride) moved.push(start[i + 2]! - end[i + 2]!);
      return moved.sort((a, b) => a - b)[moved.length >> 1]!;
    };
    expect(Math.abs(drift(0))).toBeLessThan(1);
    expect(drift(30)).toBeCloseTo(-30, 0);
    // Wrapped around the camera: nothing is flung out of the box however far it drives.
    const box = weather === 'snow' ? SNOW_BOX : RAIN_BOX;
    const end = local();
    for (let i = 0; i < end.length; i += stride) {
      expect(Math.abs(end[i]!)).toBeLessThanOrEqual(box.half);
      expect(Math.abs(end[i + 2]!)).toBeLessThanOrEqual(box.half);
    }
    sky.dispose();
  });

  it('wraps a coordinate into the box by whole periods', () => {
    expect(wrapInto(105, 0, -50, 100)).toBeCloseTo(5);
    expect(wrapInto(-55, 0, -50, 100)).toBeCloseTo(45);
    expect(wrapInto(1003, 1000, -8, 48)).toBeCloseTo(3);
  });

  it('makes only paved driving surfaces wet without changing their identity', () => {
    const materials = new MaterialLibrary();
    materials.weatherFor('rain');
    const road = materials.get('road') as THREE.MeshStandardMaterial;
    const grass = materials.get('terrain_grass') as THREE.MeshStandardMaterial;
    expect(road.roughness).toBe(.28);
    expect(road.metalness).toBe(.08);
    expect(grass.roughness).toBeGreaterThan(.28);
    materials.weatherFor('clear');
    expect(road.roughness).toBe(.95);
    materials.dispose();
  });

  it('covers roads and shoulders with snow, then restores their original palette', () => {
    const materials = new MaterialLibrary();
    const road = materials.get('road') as THREE.MeshStandardMaterial;
    const grass = materials.get('terrain_grass') as THREE.MeshStandardMaterial;
    materials.weatherFor('snow');
    expect(road.color.getHex()).toBe(0xe1e9ec);
    expect(grass.color.getHex()).toBe(0xe1e9ec);
    expect(road.emissive.getHex()).toBe(0x7d898d);
    expect(road.roughness).toBe(.82);
    materials.weatherFor('clear');
    expect(road.color.getHex()).toBe(0x37373b);
    expect(grass.color.getHex()).toBe(0x5f7a3f);
    expect(road.emissive.getHex()).toBe(0x000000);
    expect(road.roughness).toBe(.95);
    materials.dispose();
  });
});
