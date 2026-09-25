import { beforeAll, beforeEach, afterEach, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { orbitOffset, PhotoMode } from '../src/ui/PhotoMode';
import { I18n } from '../src/ui/i18n';
import { shareLines } from '../src/ui/ShareDialog';

let api: Awaited<ReturnType<typeof initPhysics>>;
beforeAll(async () => { api = await initPhysics(); });
beforeEach(() => vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }));
afterEach(() => vi.unstubAllGlobals());

it('orbit reaches below its subject and almost directly overhead with a bounded range', () => {
  const low = orbitOffset(0, -10, 100);
  expect(low.length()).toBeCloseTo(35);
  expect(low.y).toBeLessThan(-34.9);
  expect(orbitOffset(0, 10, 8).y).toBeGreaterThan(7.99);
  expect(orbitOffset(Math.PI / 2, 0.3, 3).x).toBeGreaterThan(2);
});
it('photo controls reach ground level without crossing it and can rise directly overhead', () => {
  const physics = new PhysicsWorld(api);
  const floor = physics.createCollider(api.ColliderDesc.cuboid(50, .5, 50).setTranslation(0, -.5, 0));
  // No physics step: entering photo mode directly from the intro must still see the ground.
  physics.registerCollider(floor, 'ground');
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 3, 8);
  const photo = new PhotoMode(new I18n('en'), () => {});
  photo.show([camera], [{position: new THREE.Vector3(), height: 1.5}], physics);
  for (let i=0;i<30;i++) {
    photo.action('down');
    expect(camera.position.y).toBeGreaterThanOrEqual(.4);
  }
  expect(camera.position.y).toBeLessThan(.5);
  for (let i=0;i<30;i++) photo.action('up');
  expect(camera.position.y).toBeGreaterThan(9);
  expect(Math.hypot(camera.position.x,camera.position.z)).toBeLessThan(.02);
  photo.dispose(); physics.dispose();
});
it('camera volume stops before walls and ground, including after origin rebasing', () => {
  const physics = new PhysicsWorld(api);
  const wall = physics.createCollider(api.ColliderDesc.cuboid(0.5, 20, 20).setTranslation(5, 0, 0));
  const floor = physics.createCollider(api.ColliderDesc.cuboid(20, 0.5, 20).setTranslation(0, -0.5, 0));
  physics.registerCollider(wall, 'wall'); physics.registerCollider(floor, 'ground');
  physics.world.step();
  const blocked = physics.cameraPosition({x: 0, y: 2, z: 0}, {x: 10, y: 2, z: 0});
  expect(blocked.x).toBeLessThan(4.1); expect(blocked.x).toBeGreaterThan(3.9);
  const ground = physics.cameraPosition({x: 0, y: 2, z: 0}, {x: 0, y: -10, z: 0});
  expect(ground.y).toBeGreaterThanOrEqual(0.4);
  expect(physics.cameraPosition({x: 0, y: 2, z: 0}, {x: -10, y: 2, z: 0}).x).toBe(-10);
  // Same local collider arrangement, shifted world origin as on long real routes.
  (physics as any).origin.x = 1024;
  expect(physics.cameraPosition({x: 1024, y: 2, z: 0}, {x: 1034, y: 2, z: 0}).x).toBeCloseTo(1024 + blocked.x);
  physics.dispose();
});
it('each player orbits independently and exit restores both cameras exactly', () => {
  const cameras = [new THREE.PerspectiveCamera(), new THREE.PerspectiveCamera()];
  cameras[0]!.position.set(0, 3, 8); cameras[1]!.position.set(5, 4, 9);
  const originals = cameras.map(c => c.clone());
  const photo = new PhotoMode(new I18n('en'), () => {});
  const physics = new PhysicsWorld(api);
  photo.show(cameras, [{position: new THREE.Vector3(), height: 1.5}, {position: new THREE.Vector3(5, 0, 0), height: 1.5}], physics);
  const first = cameras[0]!.position.clone(), second = cameras[1]!.position.clone();
  photo.action('right', 1);
  expect(cameras[0]!.position.equals(first)).toBe(true);
  expect(cameras[1]!.position.equals(second)).toBe(false);
  photo.close();
  cameras.forEach((camera, index) => {
    expect(camera.position.equals(originals[index]!.position)).toBe(true);
    expect(camera.quaternion.equals(originals[index]!.quaternion)).toBe(true);
    expect(camera.near).toBe(originals[index]!.near);
  });
  photo.dispose(); physics.dispose();
});
it.each(['mouse', 'touch'])('%s drag continuously changes yaw and pitch outside the controls', pointerType => {
  const camera = new THREE.PerspectiveCamera(); camera.position.set(0, 3, 8);
  const photo = new PhotoMode(new I18n('en'), () => {});
  const physics = new PhysicsWorld(api);
  photo.show([camera], [{position: new THREE.Vector3(), height: 1.5}], physics);
  const before = camera.position.clone();
  const fire = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true, cancelable: true });
    Object.defineProperties(event, { pointerId: { value: 7 }, pointerType: { value: pointerType },
      isPrimary: { value: true }, button: { value: 0 }, clientX: { value: x }, clientY: { value: y } });
    window.dispatchEvent(event);
  };
  fire('pointerdown', 120, 90); fire('pointermove', 193, 127); fire('pointerup', 193, 127);
  expect(camera.position.equals(before)).toBe(false);
  expect(camera.position.x).not.toBeCloseTo(0);
  expect(document.documentElement.classList.contains('photo-dragging')).toBe(false);
  photo.dispose(); physics.dispose();
});
it('photo captions contain route, date and current score without inventing a finished rating', () => {
  const t = new I18n('zh');
  const lines = shareLines(t, {trackId: 'synth-loop', time: 12, score: 123, slimeHits: 2,
    best: null, isBest: false, capturedAt: '2026/9/11'}, null);
  expect(lines).toContain('打卡 · 2026/9/11');
  expect(lines.some(line => line.includes('123'))).toBe(true);
  expect(lines.some(line => line.includes('评级'))).toBe(false);
});

