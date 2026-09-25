import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { CHASE, ChaseCamera } from '../src/world/ChaseCamera';

const FORWARD = new THREE.Vector3();

function angleBetweenFrames(camera: THREE.PerspectiveCamera, previous: THREE.Vector3): number {
  camera.getWorldDirection(FORWARD);
  const radians = previous.angleTo(FORWARD);
  previous.copy(FORWARD);
  return THREE.MathUtils.radToDeg(radians);
}

describe('ChaseCamera', () => {
  it('cuts between three genuinely different vehicle-relative views', () => {
    const chase = new ChaseCamera(), camera = new THREE.PerspectiveCamera();
    const car = new THREE.Vector3(0, .5, 0), rotation = new THREE.Quaternion();
    const positions: THREE.Vector3[] = [];
    for (const mode of ['chase', 'close', 'hood'] as const) {
      chase.setMode(mode);
      chase.update(camera, car, rotation, new THREE.Vector3(0, 0, -20), 1 / 60);
      positions.push(camera.position.clone());
    }
    expect(positions[0]!.z).toBeGreaterThan(positions[1]!.z);
    expect(positions[1]!.z).toBeGreaterThan(0);
    expect(positions[2]!.z).toBeLessThan(0);
    expect(chase.cycleMode()).toBe('chase');
  });

  it('keeps the hood camera attached when the car advances a metre per frame', () => {
    const chase = new ChaseCamera(), camera = new THREE.PerspectiveCamera();
    const car = new THREE.Vector3(0, .5, 0), rotation = new THREE.Quaternion();
    chase.setMode('hood');
    for (let frame = 0; frame < 30; frame++) {
      car.z -= 1;
      chase.update(camera, car, rotation, new THREE.Vector3(0, 0, -60), 1 / 60);
      expect(camera.position.z).toBeLessThan(car.z);
      expect(car.z - camera.position.z).toBeCloseTo(CHASE.hoodForward);
    }
  });

  it('owns speed, boost, launch and landing feedback and removes it for reduced motion', () => {
    const chase = new ChaseCamera(), camera = new THREE.PerspectiveCamera();
    const car = new THREE.Vector3(0, .5, 0), rotation = new THREE.Quaternion();
    for (let i = 0; i < 60; i++) chase.update(camera, car, rotation,
      new THREE.Vector3(0, 0, -60), 1 / 60, { grounded: true, boost: true });
    expect(chase.feedback.speed).toBeGreaterThan(.9);
    expect(chase.feedback.boost).toBeGreaterThan(.9);
    expect(camera.fov).toBeGreaterThan(80);
    const before = chase.hits;
    chase.update(camera, car, rotation, new THREE.Vector3(0, 10, -10), 1 / 60,
      { grounded: false });
    chase.update(camera, car, rotation, new THREE.Vector3(0, -12, -10), 1 / 60,
      { grounded: false });
    chase.update(camera, car, rotation, new THREE.Vector3(0, 0, -10), 1 / 60,
      { grounded: true });
    expect(chase.hits).toBe(before + 2);
    for (let i = 0; i < 90; i++) chase.update(camera, car, rotation,
      new THREE.Vector3(0, 0, -60), 1 / 60,
      { grounded: true, boost: true, reducedMotion: true });
    expect(chase.feedback.speed).toBeLessThan(.01);
    expect(chase.feedback.boost).toBeLessThan(.01);
    expect(chase.feedback.shake).toBe(0);
  });

  it('uses a route-specific height to reveal scenery below an elevated road', () => {
    const camera = new THREE.PerspectiveCamera();
    const car = new THREE.Vector3(0, 75.8, 0);
    const raised = new ChaseCamera({ ...CHASE, height: 5.2 });

    raised.update(camera, car, new THREE.Quaternion(), new THREE.Vector3(0, 0, -30), 1 / 60);

    expect(camera.position.y - car.y).toBeCloseTo(5.2);
    camera.getWorldDirection(FORWARD);
    expect(FORWARD.y, 'the raised view must look down rather than merely lift the horizon').toBeLessThan(-0.15);
  });

  it('does not shake when a crash leaves speed hovering around drift-following speed', () => {
    const chase = new ChaseCamera();
    const camera = new THREE.PerspectiveCamera();
    const position = new THREE.Vector3(0, 0.5, 0);
    const rotation = new THREE.Quaternion();
    const previous = new THREE.Vector3();

    chase.update(camera, position, rotation, new THREE.Vector3(0, 0, -3.99), 1 / 60);
    camera.getWorldDirection(previous);

    let worstTurn = 0;
    for (let i = 0; i < 120; i++) {
      // After a glancing collision the body can travel almost sideways. Solver and tyre forces
      // move its speed a few centimetres per second either side of the drift-camera threshold.
      const speed = i % 2 === 0 ? 4.01 : 3.99;
      chase.update(camera, position, rotation, new THREE.Vector3(speed, 0, 0), 1 / 60);
      worstTurn = Math.max(worstTurn, angleBetweenFrames(camera, previous));
    }

    expect(worstTurn, 'the camera may ease into a slide, but may not switch direction in one frame')
      .toBeLessThan(3);
  });

  it('smoothly turns to follow a car reversing directly away from its old heading', () => {
    const chase = new ChaseCamera();
    const camera = new THREE.PerspectiveCamera();
    const position = new THREE.Vector3(0, 0.5, 0);
    const rotation = new THREE.Quaternion();
    const previous = new THREE.Vector3();
    chase.update(camera, position, rotation, new THREE.Vector3(0, 0, -9), 1 / 60);
    camera.getWorldDirection(previous);

    let worstTurn = 0;
    for (let i = 0; i < 120; i++) {
      chase.update(camera, position, rotation, new THREE.Vector3(0, 0, 9), 1 / 60);
      worstTurn = Math.max(worstTurn, angleBetweenFrames(camera, previous));
    }
    camera.getWorldDirection(FORWARD);

    expect(worstTurn, 'a direction reversal still turns through a sequence of camera frames')
      .toBeLessThan(25);
    expect(FORWARD.dot(new THREE.Vector3(0, 0, 1)), 'the camera reaches the reverse travel direction')
      .toBeGreaterThan(0.9);
  });

  it('gives a hard collision a larger brief kick without moving its settled spring', () => {
    const pose = new THREE.Vector3(0, 0.5, 0), rotation = new THREE.Quaternion();
    const velocity = new THREE.Vector3(0, 0, -20);
    const displacement = (strength: number) => {
      const chase = new ChaseCamera(), camera = new THREE.PerspectiveCamera();
      chase.update(camera, pose, rotation, velocity, 1 / 60);
      const base = camera.position.y;
      chase.hit(strength);
      chase.update(camera, pose, rotation, velocity, 1 / 60);
      const kicked = Math.abs(camera.position.y - base);
      for (let i = 0; i < 30; i++) chase.update(camera, pose, rotation, velocity, 1 / 60);
      return { kicked, settled: camera.position.y, base, hits: chase.hits };
    };
    const light = displacement(0.15), hard = displacement(0.9);
    expect(hard.kicked).toBeGreaterThan(light.kicked * 2);
    expect(hard.settled).toBeCloseTo(hard.base, 5);
    expect(hard.hits).toBe(1);
  });
});
