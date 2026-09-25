import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Landmarks } from '../src/world/Landmarks';

describe('separately loaded landmarks', () => {
  it('cast the sun shadow by the streamed-building rule, and stop on low quality', () => {
    const landmarks = new Landmarks([], '.', 'day', undefined, 'high');
    const model = new THREE.Group(); model.name = 'gate';
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
    model.add(mesh);
    (landmarks as any).shade(model);
    expect(mesh.castShadow).toBe(true);
    expect(mesh.receiveShadow).toBe(true);
    const state = { key: 'k', wanted: true, model } as any;
    (landmarks as any).states.set({} as any, state);
    landmarks.setQuality('low');
    expect(mesh.castShadow).toBe(false);
  });
});

import { landmarkSurface, lightAuthoredLandmark } from '../src/world/materials';
describe('authored landmark surfaces', () => {
  it('reads the material by name and adds world-space detail by day, stone floodlight by night', () => {
    expect(landmarkSurface('zhangjiajie-pillar_sandstone')).toBe('rock');
    expect(landmarkSurface('colosseum_travertine')).toBe('masonry');
    expect(landmarkSurface('eiffel-tower_steel')).toBeNull();
    for (const time of ['day', 'night'] as const) {
      const m = new THREE.MeshStandardMaterial({ name: 'pillar_rock' });
      lightAuthoredLandmark(m, time);
      const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <worldpos_vertex>',
        fragmentShader: ['common', 'color_fragment', 'normal_fragment_maps', 'emissivemap_fragment'].map(x => `#include <${x}>`).join('\n') };
      m.onBeforeCompile(shader as any, undefined as any);
      expect(shader.fragmentShader).toContain('lmHeight');
      expect(shader.vertexShader).toContain('vLandmarkWorld =');
      expect(shader.fragmentShader.includes('totalEmissiveRadiance')).toBe(time === 'night');
    }
    const steel = new THREE.MeshStandardMaterial({ name: 'tower_steel' });
    lightAuthoredLandmark(steel, 'day');
    expect(steel.onBeforeCompile.toString()).not.toContain('lmHeight');
  });
});
