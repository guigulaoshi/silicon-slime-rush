import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type RAPIER from '@dimforge/rapier3d-compat';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { MaterialLibrary } from '../src/world/materials';
import { GUARDRAIL_SHIELD, readTile } from '../src/world/tileContent';

/** A vertical strip from y0 to y1 along x, as the pipeline's `wall()` draws a rail beam. */
function strip(name: string, material: string, y0: number, y1: number): THREE.Mesh {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(
    [0, y0, 0, 10, y0, 0, 10, y1, 0, 0, y1, 0], 3));
  geometry.setIndex([0, 1, 2, 0, 2, 3]);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ name: material }));
  mesh.name = name;
  mesh.userData = { collider: 'trimesh' };
  return mesh;
}

describe('the invisible wall above the guardrail', () => {
  it('collides as a guardrail and is never drawn, while the beam under it still is', () => {
    const scene = new THREE.Scene();
    scene.add(strip('guardrail', 'guardrail', .4, .72));
    scene.add(strip(GUARDRAIL_SHIELD, GUARDRAIL_SHIELD, .72, 1.8));
    const tile = readTile(scene, new MaterialLibrary());
    expect(tile.group.getObjectByName(GUARDRAIL_SHIELD)!.visible).toBe(false);
    expect(tile.group.getObjectByName('guardrail')!.visible).toBe(true);
    expect(tile.colliders.trimeshes).toHaveLength(2);
    expect(tile.colliders.trimeshes.every(t => t.role === 'guardrail'), 'the shield stops a car like the rail does').toBe(true);
    expect(tile.colliders.trimeshes.map(t => !!t.invisible)).toEqual([false, true]);
  });

  it('stops the photo camera at the beam but lets it look through the wall above it', async () => {
    const api: typeof RAPIER = await initPhysics();
    const scene = new THREE.Scene();
    scene.add(strip('guardrail', 'guardrail', .4, .72));
    scene.add(strip(GUARDRAIL_SHIELD, GUARDRAIL_SHIELD, .72, 1.8));
    const physics = new PhysicsWorld(api, -9.81);
    physics.add('tile', readTile(scene, new MaterialLibrary()).colliders);
    // the strips stand in the plane z = 0 from x 0 to 10
    const over = physics.cameraPosition({ x: 5, y: 1.3, z: 3 }, { x: 5, y: 1.3, z: -3 });
    expect(over.z, 'a camera swung through the invisible wall is not stopped at it').toBeCloseTo(-3, 3);
    const low = physics.cameraPosition({ x: 5, y: .56, z: 3 }, { x: 5, y: .56, z: -3 });
    expect(low.z, 'the beam you can see still stops it').toBeGreaterThan(0);
    physics.dispose();
  });
});
