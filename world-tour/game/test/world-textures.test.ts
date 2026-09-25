import * as THREE from 'three';
import { expect, it } from 'vitest';
import { parseManifest } from '../src/world/textures';
import { installWorldMap } from '../src/world/materials';

const base = { material: 'terrain', map: 'terrain.webp', px: 1024, metres: 2, repeat: [1, 1], tier: 'core', bytes: 1 };

it('reads normal maps and world-space mapping, and refuses a world mapping without a size', () => {
  const m = parseManifest({ version: 1, textures: [{ ...base, normalMap: 'terrain_normal.webp', mapping: 'world' }] });
  expect(m.textures[0]).toMatchObject({ normalMap: 'terrain_normal.webp', mapping: 'world' });
  expect(() => parseManifest({ version: 1, textures: [{ ...base, mapping: 'spherical' }] })).toThrow(/mapping/);
  expect(() => parseManifest({ version: 1, textures: [{ ...base, metres: 0, mapping: 'world' }] })).toThrow(/metres/);
});

it('lays a world-mapped material by world position and breaks the repeat with a second, larger sample', () => {
  const material = new THREE.MeshStandardMaterial();
  material.userData.worldMap = { metres: 2, mode: 'triplanar' };
  installWorldMap(material);
  const shader = { vertexShader: '#include <common>\n#include <uv_vertex>',
    fragmentShader: '#include <uv_pars_fragment>\nvoid main() {\n#include <map_fragment>\n}', uniforms: {} };
  material.onBeforeCompile(shader as never, {} as never);
  expect(shader.vertexShader).toContain('instanceMatrix');           // trees are instanced
  // picked per pixel, not per vertex: a per-vertex pick smeared round crowns into stripes
  expect(shader.fragmentShader).toContain('wmN.y > max(wmN.x, wmN.z)');
  expect(shader.fragmentShader).toContain('#define vNormalMapUv wmUvF');
  expect(shader.fragmentShader).toContain('0.500000');
  expect(shader.fragmentShader).toContain('wmFar');
  expect(material.customProgramCacheKey()).toContain('world2-triplanar');
});
