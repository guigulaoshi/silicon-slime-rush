import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { expectWorldLoaded } from './world';
import { checkMaximum } from '../test-support/resource-limit';
import { planStreamingFor } from '../src/world/streaming';

/**
 * The pictures and the numbers each version is compared against -- compared, not merely recorded.
 *
 * For four versions this file only ever *wrote* its eight screenshots. Nobody ever diffed them
 * against the previous version, and the only things it judged were three ceilings: triangles,
 * draw calls and resident tiles. Those are all upper bounds, so its real verdict on a change was
 * "the scene did not get much heavier", and an appearance regression -- the thing the whole 0.3
 * version is about -- was invisible to it.
 *
 * Comparison is only worth having if the frame is the same twice. An earlier attempt at this was
 * abandoned because it was not: photographed from behind the moving bot, on one unchanged build,
 * four of the eight milestones differed by 2.4-23.3% between runs. None of that was the renderer.
 * It was everything the shot happened to catch mid-flight -- which tiles had arrived, where the
 * chase camera had swung to, what phase the water was in. So the frame is pinned first and
 * compared second:
 *
 *  - The car stops. Pausing halts the physics, the streamer and the chase camera in one move, and
 *    the HUD is absent from these pictures anyway: they come off the canvas, not off the page.
 *  - Streaming is told to settle at this exact arc length and then waited for, twice, because one
 *    tile's arrival can change the plan and ask for the next.
 *  - The camera is placed from the *spline*, not from the car: at a milestone the bot may be a few
 *    metres and a few degrees from where it was last time, and at 60 m that is a different picture.
 *  - The water clock is pinned. It runs off wall time inside `render`, so two runs of one build
 *    otherwise catch different waves.
 *
 * Re-recording is deliberate and separate: `npm run baseline` compares, `npm run baseline:update`
 * writes. A baseline you can overwrite by accident is not a baseline.
 *
 * Nothing runs this automatically: a Playwright run of three minutes is run on purpose, with
 * `npm run baseline`.
 */

// Static capture owns eight complete tile windows and one draw per view. The timeout only
// catches a hung browser or asset load; it is not a visual or performance acceptance threshold.
test.describe.configure({ timeout: 600_000 });
const OUT = resolve(process.cwd(), '..', 'tools', 'baselines');
/* */
const updating = () => ['all', 'changed'].includes(test.info().config.updateSnapshots);

interface Scene {
  triangles: number;
  drawCalls: number;
  geometries: number;
  textures: number;
  programs: number;
  tilesLoaded: number;
  heapMB: number | null;
}

/**
 * Places on the track worth a picture: the run-up, the bridge end to end, and the climb.
 *
 * These are arc lengths, so they have to be moved whenever the route is: after the route was halved
 * they all still produced pictures, of the wrong places, under the old names.
 */
// Re-anchored to the World Tour showcase route (sydney, game/src/app/showcase.ts): the
// harbour bridge deck runs flat at y=41.2 m from s=0 and its curvature stays under 0.001 out to
// s=1300 (game/public/tracks/sydney/track.json spline.points / spline.curvature); the deck ends
// (height first drops below 40.5 m) at s=1434. The sharpest turn on the descent through The Rocks
// is at s=1902 (curvature 0.066), and the tightest turn of the whole route, into the Opera House
// forecourt turning circle, sits at s=3110 (curvature 0.076) -- the route (p2p) is 3115 m long, so
// the last milestone is placed short of that to leave room for CAM_AHEAD.
const MILESTONES: { at: number; name: string }[] = [
  { at: 40, name: '01-start' },
  { at: 700, name: '02-bridge-mid' },
  { at: 1200, name: '03-bridge-south-end' },
  { at: 1434, name: '04-off-the-bridge' },
  { at: 1902, name: '05-the-rocks-hairpin' },
  { at: 2400, name: '06-circular-quay' },
  { at: 2800, name: '07-macquarie-street' },
  { at: 3050, name: '08-opera-house-forecourt' },
];

/** Where the fixed camera stands relative to its spline point, in metres. */
const CAM_BACK = 9;
const CAM_UP = 3.2;
const CAM_AHEAD = 40;
/** The water is a clock; this is the second of it that every baseline picture is taken at. */
const WATER_PHASE = 12.5;
/** `MAX_RETRIES` in `src/world/TileStreamer.ts`: attempts before a tile counts as failed. */
const TILE_RETRIES = 3;

/**
 * The field of view every baseline picture is taken at.
 *
 * The chase camera lerps fov from 58 to 76 with speed (`ChaseCamera.ts`), and the bot is doing a
 * different speed at each milestone on every run. Placing the camera by hand without also pinning
 * this left the position identical and the *projection* different: five of eight pictures moved by
 * a fraction of a pixel, which lights up every edge in the frame and reads as a 1% difference.
 */
const FOV = 62;

/**
 * How different two pictures may be before this says so. Both numbers were measured, not guessed.
 *
 * Playwright's default per-pixel colour tolerance is 0.2, which is far too kind for an appearance
 * baseline: at 0.2 -- and still at 0.02 -- the road could be recoloured from 0x37373b to 0x3a3a40
 * across the whole frame and the comparison stayed green. That is a shade nobody would notice, and
 * a net that misses it misses the ones people do notice too.
 *
 * With the frame pinned, zero is affordable: three consecutive runs of one unchanged build produced
 * pixel-identical pictures at `threshold: 0`, and the same road recolour then failed on 26-29% of
 * the pixels. The pixel-ratio slack that remains is for a stray pixel, not for "close enough".
 */
const SENSITIVITY = { threshold: 0, maxDiffPixelRatio: 0.0005 };

/** Stop the car. Physics, streaming and the chase camera all hang off this one flag. */
async function pause(page: Page): Promise<void> {
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.game.report().phase === 'paused', null, { timeout: 30_000 });
}

/**
 * Ask for every tile this arc length needs, and wait until they are all here.
 *
 * In a loop, because the streamer only issues four requests at a time (`MAX_CONCURRENT`): each
 * `follow` starts four, and the window here holds forty-odd. A fixed two rounds looked settled and
 * photographed a world with eight tiles in it -- a third of the triangles, and pictures of nothing
 * much. So it runs until the resident count stops moving.
 */
async function settle(page: Page, at: number): Promise<void> {
  /** One round: ask for this arc length's tiles and wait for everything in flight to land. */
  const ask = async (clearFirst: boolean) => {
    await page.evaluate(([s, first]: number[]) => {
      const w = window.game.session.world;
      // Drop the lot first. The resident set is otherwise a function of the journey, not of the
      // place: unloading runs on a window widened by 300 m of hysteresis, so which tiles are still
      // in memory depends on how fast the bot arrived. That alone left one run holding 43 tiles at
      // the toll plaza and the next 42, and 11,000 triangles with them.
      if (first) w.streamer.clear();
      // From the spline, not from the car: the streamer plans on (s, x, z), and the bot parks a few
      // metres from where it parked last time.
      const p = w.spline.point(w.spline.indexAt(s!));
      w.follow(s!, p[0]!, p[1]!, p[2]!);
    }, [at, clearFirst ? 1 : 0]);
    await page.waitForFunction(
      () => (window.game.report().tiles?.loading ?? 1) === 0
        && window.game.session.world.backdrop.ready,
      null, { timeout: 120_000, polling: 200 });
    return page.evaluate(() => window.game.report().tiles?.loaded ?? 0);
  };

  const state = await page.evaluate(s => {
    const w = window.game.session.world;
    const p = w.spline.point(w.spline.indexAt(s));
    return { tiles: w.track.tiles, window: w.streamer.window, position: { s, x: p[0], z: p[2] } };
  }, at);
  const required = planStreamingFor(state.tiles, new Set(), [state.position], state.window).load.length;
  let previous = -1;
  let stable = 0;
  for (let round = 0; round < 40; round++) {
    const loaded = await ask(round === 0);
    stable = loaded === previous ? stable + 1 : 0;
    previous = loaded;
    // A failed batch can leave the count unchanged. If later retries add tiles, resume filling
    // the window instead of returning after a fixed number of attempts with a partial scene.
    if (stable >= TILE_RETRIES) {
      expect(loaded, `sydney at ${at} m: the complete planned tile window`).toBe(required);
      return;
    }
  }
  throw new Error(`streaming never settled at ${at} m (${previous} tiles and still moving)`);
}

/** One frame, from a camera nobody drove there, with the water held still. */
async function pinnedFrame(page: Page, at: number): Promise<{ png: Buffer; scene: Scene }> {
  const shot = await page.evaluate(([s, back, up, ahead, water, fov]: number[]) => {
    const g = window.game;
    const w = g.session.world;
    // Auto quality measures the test runner as faithfully as it measures a phone. Under a busy
    // two-worker suite it can choose low, replacing the renderer with an un-antialiased one; on an
    // idle rerun it can stay high. A visual baseline must compare one rendering tier, not how busy
    // the machine was while the bot drove here. Pin high before the camera and water, just as the
    // approved images were recorded.
    w.setQuality('high');
    const i = w.spline.indexAt(s!);
    const p = w.spline.point(i);
    const t = w.spline.tangent(i);
    w.camera.position.set(p[0]! - t[0]! * back!, p[1]! + up!, p[2]! - t[2]! * back!);
    w.camera.lookAt(p[0]! + t[0]! * ahead!, p[1]! + 1.0, p[2]! + t[2]! * ahead!);
    w.camera.fov = fov!;
    w.camera.updateProjectionMatrix();
    w.camera.updateMatrixWorld(true);
    // The car is parked in shot, and its chase camera is not the one taking this picture.
    g.session.mesh.visible = false;
    // The gantries are lit "ahead" and dimmed "behind you", from the race rather than from the
    // camera -- so a milestone that sits near a checkpoint photographs a lit gate on one run and a
    // dimmed one on the next. 03-bridge-south-end sits 0 m from sydney's checkpoint at 1200 m
    // (game/public/tracks/sydney/track.json checkpoints), and the bot overshoots a 500 ms poll by
    // more than that. Pin it to the arc length instead of to where the bot got to.
    g.session.gates.setCleared(
      g.session.track.checkpoints.filter((c: { s: number }) => c.s <= s!).length);
    // The hologram pulses and floats on race time. Pausing freezes whichever fraction of that
    // animation the bot reached, so pin it just like the water rather than tolerating moving pixels.
    g.session.gates.update(water!);
    // Sparks are emitted where the car last rubbed a barrier and then left to fade; pausing freezes
    // whatever was still alight, which is a different handful of glowing quads on every run.
    g.session.sparks.mesh.visible = false;
    // Static road/landmark pictures have their own owner; the slime suite owns actor appearance.
    // Where the bot happened to meet a falling slime changes with machine load, leaving different
    // bodies, eyes and fragments frozen in a nominally pinned frame. Their owner groups every
    // part so future actor details cannot leak into static scenery comparisons.
    const slimeGroup = g.session.slimes?.group;
    const slimeVisibility = slimeGroup?.visible ?? false;
    if (slimeGroup) slimeGroup.visible = false;
    // Its headlights are not, and on a night route they are most of the light in the frame: the
    // beam lands wherever the bot happened to stop, which moved the lit patch of road between runs
    // by more than the whole rest of the picture. Park them on the spline too, facing down it.
    const li = w.spline.indexAt(s!);
    const lp = w.spline.point(li);
    const lt = w.spline.tangent(li);
    w.headlights.group.position.set(lp[0]!, lp[1]! + 0.6, lp[2]!);
    // the car mesh faces -z, so the yaw that points it down the tangent is atan2(-tx, -tz)
    const yaw = Math.atan2(-lt[0]!, -lt[2]!);
    w.headlights.group.quaternion.set(0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2));
    // `render` drives the water off wall time, so pin the phase and then stop it moving for the
    // calls we are about to make. The own property shadows the prototype method; deleting it hands
    // the class back its own.
    const materials = w.materials as { animate(t: number): void };
    (Object.getPrototypeOf(materials) as { animate(t: number): void }).animate.call(materials, water!);
    materials.animate = () => {};

    const r = w.renderer;
    // The scene is frozen; one draw is enough. Real GPU timing belongs to performance.spec.ts.
    w.render();
    const url = r.domElement.toDataURL('image/png');
    delete (materials as { animate?: unknown }).animate;
    g.session.mesh.visible = true;
    g.session.sparks.mesh.visible = true;
    if (slimeGroup) slimeGroup.visible = slimeVisibility;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    return {
      url,
      scene: {
        triangles: r.info.render.triangles,
        drawCalls: r.info.render.calls,
        geometries: r.info.memory.geometries,
        textures: r.info.memory.textures,
        programs: r.info.programs?.length ?? 0,
        tilesLoaded: w.streamer.stats.loaded,
        heapMB: mem ? Math.round(mem.usedJSHeapSize / 1e6) : null,
      },
    };
  }, [at, CAM_BACK, CAM_UP, CAM_AHEAD, WATER_PHASE, FOV]);
  return { png: Buffer.from(shot.url.split(',')[1]!, 'base64'), scene: shot.scene };
}

test('the sydney baseline still looks like the sydney baseline', { tag: ['@version', '@pixel'] }, async ({ page }) => {
  mkdirSync(resolve(OUT, 'sydney'), { recursive: true });
  await page.goto('/?track=sydney&bot=1&dev=1');
  await page.waitForFunction(() => window.game?.report().track != null, null, { timeout: 120_000 });
  await page.waitForFunction(() => (window.game?.report().tiles?.loaded ?? 0) > 0, null,
    { timeout: 120_000 }).catch(() => {});
  await expectWorldLoaded(page, 'sydney at the start');
  await page.waitForFunction(() => window.game.report().phase === 'racing', null, { timeout: 30_000 });
  await pause(page);
  // Pausing simulation still redraws continuously. Static capture owns every draw below;
  // stop the background RAF just as the fixed weather screenshots do.
  await page.evaluate(() => cancelAnimationFrame((window.game as unknown as { raf: number }).raf));

  await page.waitForFunction(() => window.game.session.world.billboards.ready, null, { timeout: 30_000 });

  const samples: (Scene & { s: number; name: string })[] = [];
  const shots: { name: string; png: Buffer }[] = [];
  for (const target of MILESTONES) {
    // A scenery check is not a drive. Load the tile window for the named arc length and put the
    // camera there directly; robot completion and real-time streaming have their own test.
    await settle(page, target.at);
    // Every milestone, not only the ends: `settle` clears the streamer, so a track that 404s from
    // here on would otherwise look like an empty world that nothing had failed in yet.
    await expectWorldLoaded(page, `sydney at ${target.name}`);
    const { png, scene } = await pinnedFrame(page, target.at);
    shots.push({ name: target.name, png });
    samples.push({ ...scene, s: target.at, name: target.name });
    console.log(target.name, JSON.stringify(scene));
  }

  // Asked again at the end, because `failed` is cumulative and the first ask only saw the start
  // line. A track built as far as the toll plaza and no further passes the opening check, and then
  // photographs seven empty skies -- and every ceiling below is an upper bound that an empty world
  // clears more comfortably than a real one. Half a track is the likelier accident of the two: the
  // tiles are gitignored per track, so an interrupted `sr.cli build` leaves exactly this.
  await expectWorldLoaded(page, 'sydney at the finish');

  // Performance under real driving has its own test. These numbers describe the exact static
  // frames above, so the visual record and its geometry budget cannot disagree about what was seen.
  const peak = {
    triangles: Math.max(...samples.map((s) => s.triangles)),
    drawCalls: Math.max(...samples.map((s) => s.drawCalls)),
    tilesLoaded: Math.max(...samples.map((s) => s.tilesLoaded)),
    heapMB: Math.max(...samples.map((s) => s.heapMB ?? 0)),
  };
  // What is compared, and only what is reproducible. `geometries` is a live-object count for the
  // whole renderer rather than a fact about this frame, and it moved by one between two runs of an
  // unchanged build; it stays in `samples` as a record and out of the comparison.
  const pinned = samples.map((s) => ({
    name: s.name, s: s.s, triangles: s.triangles, drawCalls: s.drawCalls,
    tilesLoaded: s.tilesLoaded,
  }));
  const record = resolve(OUT, 'sydney.json');
  if (updating()) {
    writeFileSync(record,
      JSON.stringify({ recorded: new Date().toISOString().slice(0, 10), peak, pinned, samples }, null, 2) + '\n');
  }
  console.log('peak', JSON.stringify(peak));

  expect(samples.length, 'every milestone should be reached').toBe(MILESTONES.length);

  // The pictures. Compared after the drive rather than during it, so one early difference does not
  // hide the other seven: a version-gate report wants the whole list, not the first casualty.
  for (const { name, png } of shots) {
    expect.soft(png, name).toMatchSnapshot(`${name}.png`, SENSITIVITY);
  }

  // The counts, compared rather than only filed, and compared against the one file that holds them.
  // Once the frame is pinned these are exact: the same build draws the same triangles from the same
  // camera. Heap and frame time stay out of it -- one is the garbage collector's business and the
  // other is the machine's.
  if (!updating()) {
    const stored = JSON.parse(readFileSync(record, 'utf-8')) as { pinned?: unknown };
    expect.soft(pinned, 'the pinned scene counts moved').toEqual(stored.pinned);
  }

  checkMaximum(peak.triangles, 'max_triangles', 'pinned high-quality visual baseline');
  checkMaximum(peak.drawCalls, 'max_draw_calls', 'pinned high-quality visual baseline');
  checkMaximum(peak.tilesLoaded, 'max_loaded_tiles', 'pinned high-quality visual baseline');
});
