import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { RenderPose, type PoseSource } from '../src/app/RenderPose';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';

let api: typeof RAPIER;
beforeAll(async () => { api = await initPhysics(); }, 60_000);

class MovingPose implements PoseSource {
  readonly position = new THREE.Vector3();
  readonly quaternion = new THREE.Quaternion();
  poseRevision = 0;
  elapsed = 0;

  advance(dt: number): void {
    this.elapsed += dt;
    this.position.set(this.elapsed * 13, 0.5, -this.elapsed * 4);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), this.elapsed * 0.42);
  }

  reset(): void {
    this.position.set(100, 3, -80);
    this.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), 2.4);
    this.poseRevision++;
  }
}

function runDisplay(hz: number, jitter: readonly number[] = [1]): { distanceErrors: number[]; angleErrors: number[] } {
  const physics = new PhysicsWorld(api, 0);
  const source = new MovingPose();
  const render = new RenderPose(source);
  const distanceErrors: number[] = [];
  const angleErrors: number[] = [];
  let previousPosition: THREE.Vector3 | null = null;
  let previousQuaternion: THREE.Quaternion | null = null;
  let wallTime = 0;
  let previousWallTime = 0;
  for (let frame = 0; frame < Math.ceil(hz * 1.2); frame++) {
    const dt = jitter[frame % jitter.length]! / hz;
    wallTime += dt;
    const result = physics.step(dt, undefined, 5, (step) => {
      source.advance(step);
      render.advance(source);
    });
    const sampled = render.sample(source, result.alpha);
    if (previousWallTime > physics.timestep * 2 && previousPosition && previousQuaternion) {
      const expectedDistance = Math.hypot(13, 4) * dt;
      distanceErrors.push(Math.abs(sampled.position.distanceTo(previousPosition) - expectedDistance));
      const expectedAngle = 0.42 * dt;
      angleErrors.push(Math.abs(sampled.quaternion.angleTo(previousQuaternion) - expectedAngle));
    }
    previousPosition = sampled.position.clone();
    previousQuaternion = sampled.quaternion.clone();
    previousWallTime = wallTime;
  }
  physics.dispose();
  return { distanceErrors, angleErrors };
}

describe('RenderPose fixed-step bridge', () => {
  it.each([60, 75, 120, 144])('moves on every %s Hz display frame without a 60 Hz staircase', (hz) => {
    const errors = runDisplay(hz);
    expect(Math.max(...errors.distanceErrors)).toBeLessThan(1e-4);
    expect(Math.max(...errors.angleErrors)).toBeLessThan(1e-4);
  });

  it('stays continuous through jittered zero-step and multi-step display frames', () => {
    const errors = runDisplay(75, [0.82, 1.18, 0.91, 2.35, 0.74, 1.0]);
    expect(Math.max(...errors.distanceErrors)).toBeLessThan(1e-4);
    expect(Math.max(...errors.angleErrors)).toBeLessThan(1e-4);
  });

  it('collapses both stored states on reset instead of drawing across the teleport', () => {
    const physics = new PhysicsWorld(api, 0);
    const source = new MovingPose();
    const render = new RenderPose(source);
    physics.step(physics.timestep * 2.5, undefined, 5, (step) => {
      source.advance(step);
      render.advance(source);
    });

    source.reset();
    const teleported = render.sample(source, 0.5);
    expect(teleported.position.toArray()).toEqual([100, 3, -80]);
    expect(teleported.quaternion.angleTo(source.quaternion)).toBeLessThan(1e-8);
    const zeroStep = physics.step(physics.timestep * 0.25);
    expect(zeroStep.steps).toBe(0);
    expect(render.sample(source, zeroStep.alpha).position.toArray()).toEqual([100, 3, -80]);
    physics.dispose();
  });
});
