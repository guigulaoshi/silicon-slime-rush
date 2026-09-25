import { Game } from './app/Game';
import './game.css';
import { CHALLENGE_PARAM } from './app/Challenge';
import * as THREE from 'three';
import { WEATHERS, type Weather } from './world/Sky';

window.startup?.stage('boot.prepare');

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const ui = document.getElementById('ui')!;

// ?speed is for the automated run only: it is capped, and it is ignored unless the bot is
// driving. Turbo advances more of the same fixed 60 Hz steps per rendered frame; it never makes
// the physics timestep coarser, and no player can enable it by editing a shared link.
const bot = params.get('bot') === '1';
const speed = bot ? Math.min(Math.max(Number(params.get('speed') ?? 1) || 1, 1), 12) : 1;
const game = new Game(app, ui, params.get('dev') === '1', speed);
/** The startup shell leaves only after the first usable screen is ready, not merely after imports. */
export const ready = game.ready;
document.documentElement.lang = game.i18n.lang;

// The embedded browser cannot reach page globals or localStorage by design. Its performance probe
// therefore takes explicit, inert query inputs instead of asking automation to mutate private page
// state. They only exist when `perf=1`; shared game links cannot change a player's settings.
if (params.get('perf') === '1') {
  const quality = params.get('perfQuality');
  const slimeDensity = params.get('perfSlimes');
  if (quality === 'high' || quality === 'medium' || quality === 'low') {
    game.save.useForSession({ quality });
  }
  if (slimeDensity === 'none' || slimeDensity === 'normal' || slimeDensity === 'many') {
    game.save.useForSession({ slimeDensity });
  }
}

// An embedded in-app browser may deliberately exposes page elements rather than a page's JavaScript
// globals. ?perf=1 puts one honest, finite rAF sample on the page so that embedded-browser runs can
// be measured there instead of being judged by eye. It is inert and absent from ordinary play.
if (params.get('perf') === '1') {
  const readout = document.createElement('output');
  readout.id = 'perf-readout';
  readout.setAttribute('aria-label', 'Performance probe');
  readout.textContent = 'Performance: waiting for race';
  Object.assign(readout.style, {
    position: 'fixed', right: '12px', bottom: '12px', zIndex: '1000', padding: '8px 10px',
    color: '#fff', background: 'rgba(0, 0, 0, 0.8)', font: '12px/1.4 monospace',
    pointerEvents: 'none',
  });
  document.body.append(readout);

  const intervals: number[] = [];
  let started = 0;
  let previous = 0;
  const sample = (now: number): void => {
    if (game.report().phase !== 'racing') {
      intervals.length = 0;
      started = 0;
      previous = 0;
      requestAnimationFrame(sample);
      return;
    }
    if (!started) { started = now; previous = now; }
    else { intervals.push(now - previous); previous = now; }
    const elapsed = now - started;
    if (elapsed < 8_000) { requestAnimationFrame(sample); return; }

    const ordered = intervals.slice().sort((a, b) => a - b);
    const p95 = ordered[Math.min(ordered.length - 1, Math.floor((ordered.length - 1) * 0.95))] ?? 0;
    const fps = intervals.length * 1_000 / elapsed;
    const report = game.report();
    readout.textContent = `Performance ${report.renderQuality}: ${fps.toFixed(1)} FPS · `
      + `p95 ${p95.toFixed(1)} ms · ${innerWidth}×${innerHeight} @${devicePixelRatio}×`;
    readout.dataset.complete = 'true';
  };
  requestAnimationFrame(sample);
}

// a direct link to a track is how a shared link gets in; ?bot=1 is how the automated run does
const wanted = params.get('track');
// ?time=day|night overrides the track's own default. Like ?speed it is only read on the automated
// run: a shared link is the game as its route defines it, and this exists so an appearance
// screenshot of a night route can be taken in daylight.
const asked = params.get('time');
const timeOfDay = asked === 'day' || asked === 'night' ? asked : undefined;
const weatherParam = params.get('weather');
const weather: Weather = WEATHERS.includes(weatherParam as Weather) ? weatherParam as Weather : 'clear';
const inspection = params.get('dev') === '1' ? params.get('inspect') : null;
if (wanted) {
  const start = bot
    ? game.autoRun(wanted, timeOfDay, params.get('vehicle') ?? undefined,
      params.get('direction') === 'reverse' ? 'reverse' : 'forward', weather)
    : game.openLinkedTrack(wanted);
  start.then(() => {
    if (inspection === 'vehicle') {
      const initialProgress = game.report().progress;
      const inspectWhenDriving = (): void => {
        const report = game.report();
        const travelled = (report.progress - initialProgress + report.length) % report.length;
        if (report.phase === 'racing' && travelled > 10 && travelled < report.length / 2) {
          beginInspection(game, 'vehicle');
        }
        else if (game.report().track) requestAnimationFrame(inspectWhenDriving);
      };
      inspectWhenDriving();
    }
    if (inspection === 'colossus' || inspection === 'slimes' || inspection === 'boost'
      || inspection === 'flowers' || inspection === 'lights' || inspection === 'billboard-social'
      || inspection === 'billboard-space') {
      beginInspection(game, inspection);
    }
  }).catch((e: unknown) => console.error(e));
}

// A friend's challenge link: a bad or tampered code is simply ignored.
const challenge = params.get(CHALLENGE_PARAM);
if (challenge && !wanted) game.acceptChallenge(challenge);

Object.assign(window as unknown as Record<string, unknown>, { game });

/**
 * Direct scenery inspection for embedded in-app browsers, which may not read page
 * JavaScript globals. It walks streaming windows instead of driving the car there, freezes the
 * first matching place, and exposes completion as ordinary accessible text. Inert unless both
 * `dev=1` and an explicit `inspect` query are present.
 */
function beginInspection(owner: Game, kind: 'colossus' | 'slimes' | 'boost' | 'flowers' | 'lights'
  | 'billboard-social' | 'billboard-space' | 'vehicle'): void {
  const gameSurface = owner as unknown as { phase: string; show(value: string): void; session: any };
  const session = gameSurface.session;
  if (!session) return;
  gameSurface.show('paused');
  const output = document.createElement('output');
  output.id = 'inspection-ready';
  output.setAttribute('aria-label', 'Direct scenery inspection');
  output.textContent = `Inspecting ${kind}`;
  Object.assign(output.style, {
    position: 'fixed', left: '12px', bottom: '12px', zIndex: '1000', padding: '7px 10px',
    color: '#fff', background: 'rgba(0,0,0,.72)', font: '12px/1.4 monospace',
  });
  document.body.append(output);

  const world = session.world;
  const boardSlot = kind === 'billboard-social' ? 'a' : kind === 'billboard-space' ? 'b' : null;
  const boardLanguage = params.get('inspectLang') === 'zh' ? 'zh' : 'en';
  if (boardSlot) {
    owner.i18n.set(boardLanguage);
    document.documentElement.lang = boardLanguage;
    world.billboards.setLanguage(boardLanguage);
  }
  let at = 0;
  let previous = -1;
  let stable = 0;
  const seek = (): void => {
    const index = world.spline.indexAt(at);
    const point = world.spline.point(index);
    world.follow(at, point[0], point[1], point[2]);
    const stats = world.streamer.stats;
    if (stats.failed) {
      output.textContent = `Inspection failed: ${stats.failed} tile loads failed`;
      output.dataset.complete = 'error';
      return;
    }
    if (stats.loading || stats.loaded !== previous || (boardSlot && !world.billboards.ready)) {
      previous = stats.loaded;
      stable = 0;
      setTimeout(seek, 120);
      return;
    }
    if (++stable < 2) { setTimeout(seek, 120); return; }

    const colossus = session.slimes?.lives.find((live: any) => live.active
      && live.spawn.kind === 'colossus');
    const roundedSlime = session.slimes?.lives.filter((live: any) => live.active
      && (live.spawn.kind === 'popper' || live.spawn.kind === 'burst'))
      .sort((a: any, b: any) => {
        if (!colossus) return 0;
        const [cx, , cz] = colossus.spawn.position;
        const [ax, , az] = a.spawn.position;
        const [bx, , bz] = b.spawn.position;
        return Math.hypot(bx - cx, bz - cz) - Math.hypot(ax - cx, az - cz);
      })[0];
    const boost = session.slimes?.lives.find((live: any) => live.active
      && live.spawn.kind === 'boost');
    const flowerObjects: THREE.Object3D[] = [];
    world.scene.traverse((object: THREE.Object3D) => {
      if (object.name?.startsWith('flowers_flower_')) flowerObjects.push(object);
    });
    // The lights check needs the lit chain: by day a named lamp style has posts but no pools (592).
    const lampBodies = world.nightScenery.root.getObjectByName('night-light-pools')
      ? world.nightScenery.root.getObjectByName('night-lamp-bodies') as THREE.InstancedMesh | undefined
      : undefined;
    let board: THREE.InstancedMesh | undefined;
    if (boardSlot) world.streamer.root.traverse((object: THREE.Object3D) => {
      if (object instanceof THREE.InstancedMesh && object.count > 0 &&
        !Array.isArray(object.material) && object.material.name === `billboard_face_${boardSlot}`) board = object;
    });
    const found = kind === 'vehicle' ? true : kind === 'colossus' ? !!colossus
      : kind === 'slimes' ? !!roundedSlime : kind === 'boost' ? !!boost
        : kind === 'lights' ? !!lampBodies?.count : boardSlot ? !!board : flowerObjects.length >= 4;
    if (!found && at < world.spline.length - 1) {
      at = Math.min(world.spline.length - 1, at + 90);
      world.streamer.clear();
      previous = -1;
      stable = 0;
      setTimeout(seek, 0);
      return;
    }
    if (!found) {
      output.textContent = `Inspection failed: ${kind} not found`;
      output.dataset.complete = 'error';
      return;
    }

    if (kind === 'vehicle') {
      output.textContent = `Inspection ready: vehicle ${session.vehicle.id} · live chase camera · `
        + `${session.model.wheels.length + (session.trailerModel?.wheels.length ?? 0)} moving wheels`;
    } else if (board) {
      world.scene.updateMatrixWorld(true);
      const instance = new THREE.Matrix4();
      board.getMatrixAt(0, instance);
      const centre = new THREE.Vector3().setFromMatrixPosition(instance.premultiply(board.matrixWorld));
      let nearest = 0;
      let nearestDistance = Infinity;
      for (let i = 0; i < world.spline.count; i++) {
        const point = world.spline.point(i);
        const distance = Math.hypot(point[0] - centre.x, point[2] - centre.z);
        if (distance < nearestDistance) { nearestDistance = distance; nearest = i; }
      }
      const road = world.spline.point(world.spline.indexAt(world.spline.s[nearest] - 35));
      world.camera.position.set(road[0], road[1] + 1.8, road[2]);
      world.camera.lookAt(centre);
      world.camera.fov = 52;
      output.textContent = `Inspection ready: ${kind} · ${boardLanguage} · road approach · current content`;
    } else if (kind === 'colossus') {
      session.slimes.updateSlimeDecorations();
      session.slimes.mesh.getMatrixAt(colossus.index, session.slimes.matrix);
      const elements = session.slimes.matrix.elements as number[];
      const x = Number(elements[12]);
      const y = Number(elements[13]);
      const z = Number(elements[14]);
      const frontX = Math.sin(colossus.spawn.yaw);
      const frontZ = Math.cos(colossus.spawn.yaw);
      const viewDistance = Math.max(...colossus.spawn.scale) * 2.8;
      world.camera.position.set(x + frontX * viewDistance, y + 0.8, z + frontZ * viewDistance);
      world.camera.lookAt(x, y - 0.2, z);
      world.camera.fov = 55;
      const distance = Math.hypot(world.camera.position.x - x, world.camera.position.y - y,
        world.camera.position.z - z);
      const carParts = session.slimes.colossusDebris.count + session.slimes.colossusWheels.count
        + session.slimes.colossusSeatBacks.count;
      output.textContent = `Inspection ready: colossus ${colossus.spawn.scale.join('×')} · `
        + `${carParts} car parts · camera ${distance.toFixed(1)}m · `
        + `body ${x.toFixed(1)},${y.toFixed(1)},${z.toFixed(1)}`;
    } else if (kind === 'slimes' || kind === 'boost') {
      session.slimes.updateSlimeDecorations();
      const target = kind === 'boost' ? boost : roundedSlime;
      const [x, y, z] = target.spawn.position;
      const bodyMatrix = new THREE.Matrix4();
      session.slimes.mesh.getMatrixAt(target.index, bodyMatrix);
      const face = new THREE.Vector3(0, 0, 1).transformDirection(bodyMatrix);
      const frontX = face.x;
      const frontZ = face.z;
      const distance = Math.max(2.5, target.spawn.scale[2] * (kind === 'boost' ? 2.0 : 4.2));
      world.camera.position.set(x + frontX * distance, y + target.spawn.scale[1] * 0.15,
        z + frontZ * distance);
      world.camera.lookAt(x, y - target.spawn.scale[1] * 0.08, z);
      world.camera.fov = 48;
      output.textContent = kind === 'boost'
        ? 'Inspection ready: red rocket boost slime'
        : `Inspection ready: surface-tension ${target.spawn.kind} slime`;
    } else if (kind === 'flowers') {
      world.scene.updateMatrixWorld(true);
      const bounds = new THREE.Box3();
      for (const object of flowerObjects) bounds.expandByObject(object, true);
      const centre = bounds.getCenter(new THREE.Vector3());
      const span = bounds.getSize(new THREE.Vector3());
      let roadIndex = 0;
      let roadDistance = Infinity;
      for (let i = 0; i < world.spline.count; i++) {
        const p = world.spline.point(i);
        const d = (p[0] - centre.x) ** 2 + (p[2] - centre.z) ** 2;
        if (d < roadDistance) { roadDistance = d; roadIndex = i; }
      }
      const road = world.spline.point(roadIndex);
      const tangent = world.spline.tangent(roadIndex);
      world.camera.position.set(road[0] - tangent[0] * 3, road[1] + 1.35,
        road[2] - tangent[2] * 3);
      world.camera.lookAt(road[0] + tangent[0] * 20, road[1] + 0.65,
        road[2] + tangent[2] * 20);
      world.camera.fov = 62;
      output.textContent = `Inspection ready: road-view flowers · `
        + `${new Set(flowerObjects.map((object) => object.name)).size} colours · `
        + `${span.x.toFixed(0)}×${span.z.toFixed(0)}m bed`;
    } else {
      const instance = new THREE.Matrix4();
      lampBodies!.getMatrixAt(0, instance);
      const [headX, headY, headZ] = world.nightScenery.root.userData.headLocal as [number, number, number];
      const head = new THREE.Vector3(headX, headY, headZ).applyMatrix4(instance);
      const alongRoad = new THREE.Vector3(0, 0, 1).transformDirection(instance);
      const pool = world.nightScenery.root.getObjectByName('night-light-pools') as THREE.InstancedMesh;
      pool.getMatrixAt(0, instance);
      const litCentre = new THREE.Vector3().setFromMatrixPosition(instance);
      world.camera.position.copy(litCentre).addScaledVector(alongRoad, 15);
      world.camera.position.y += 3;
      world.camera.lookAt(head.clone().lerp(litCentre, 0.70));
      world.camera.fov = 68;
      output.textContent = `Inspection ready: ${lampBodies!.count} road lights · curved arms · `
        + `${world.nightScenery.drawCalls} draws · ${world.nightScenery.dynamicLights} dynamic lights`;
    }
    world.camera.updateProjectionMatrix();
    world.camera.updateMatrixWorld(true);
    session.mesh.visible = kind === 'vehicle';
    if (session.trailerModel) session.trailerModel.group.visible = kind === 'vehicle';
    ui.style.display = 'none';
    world.render();
    output.dataset.complete = 'true';
  };
  seek();
}
