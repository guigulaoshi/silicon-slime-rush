import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { configureEnvironmentNode, environmentCastsShadow, environmentShadowRole,
  SHADOW_RADIUS, SHADOW_TILE_DISTANCE,
  tileWithinShadowDistance } from '../src/world/environmentShadows';

describe('streamed environment sun shadows', () => {
  it('keeps one explicit role table for buildings, trees, rails and roadside facilities', () => {
    expect(environmentShadowRole('buildings_glass')).toBe('major');
    expect(environmentShadowRole('trees_broadleaf_foliage')).toBe('major');
    expect(environmentShadowRole('guardrail')).toBe('major');
    expect(environmentShadowRole('landmark_steel')).toBe('major');
    expect(environmentShadowRole('props_barrier')).toBe('detail');
    expect(environmentShadowRole('props_billboard_pole')).toBe('detail');
    expect(environmentShadowRole('bridgeworks')).toBe('detail');
    expect(environmentShadowRole('road')).toBe('none');
    expect(environmentShadowRole('terrain_grass')).toBe('none');
  });

  it('gives high every environment caster, medium the major silhouettes and low none', () => {
    for (const name of ['buildings', 'trees_palm_trunk', 'guardrail']) {
      expect(environmentCastsShadow(name, 'high')).toBe(true);
      expect(environmentCastsShadow(name, 'medium')).toBe(true);
      expect(environmentCastsShadow(name, 'low')).toBe(false);
    }
    expect(environmentCastsShadow('props_barrier', 'high')).toBe(true);
    expect(environmentCastsShadow('props_barrier', 'medium')).toBe(false);
    expect(environmentCastsShadow('props_barrier', 'low')).toBe(false);
    expect(SHADOW_RADIUS.high).toBeGreaterThan(SHADOW_RADIUS.medium);
    expect(SHADOW_TILE_DISTANCE.high).toBeGreaterThan(SHADOW_TILE_DISTANCE.medium);
  });

  it('updates nested meshes without turning the receiving road into a caster', () => {
    const building = new THREE.Group();
    building.name = 'buildings_stucco';
    const facade = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
    building.add(facade);
    configureEnvironmentNode(building, 'high');
    expect(facade.castShadow).toBe(true);
    expect(facade.receiveShadow).toBe(true);
    expect(facade.userData.environmentShadowRole).toBe('major');

    const road = new THREE.Mesh(new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial());
    road.name = 'road';
    configureEnvironmentNode(road, 'high');
    expect(road.castShadow).toBe(false);
    expect(road.receiveShadow).toBe(true);
  });

  it('measures from the nearest tile edge and gives medium the shorter live window', () => {
    const bounds: [[number, number, number], [number, number, number]] =
      [[100, -5, 200], [356, 40, 456]];
    expect(tileWithinShadowDistance(bounds, 228, 328, 'high')).toBe(true);
    expect(tileWithinShadowDistance(bounds, 441, 328, 'medium')).toBe(true);
    expect(tileWithinShadowDistance(bounds, 442, 328, 'medium')).toBe(false);
    expect(tileWithinShadowDistance(bounds, 500, 328, 'high')).toBe(true);
    expect(tileWithinShadowDistance(bounds, 507, 328, 'high')).toBe(false);
    expect(tileWithinShadowDistance(bounds, 228, 328, 'low')).toBe(false);
  });
});
