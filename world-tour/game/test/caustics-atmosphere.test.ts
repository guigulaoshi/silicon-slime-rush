import * as THREE from 'three';
import { expect, it } from 'vitest';
import { FarAtmosphere } from '../src/world/FarAtmosphere';
import { SlimeCaustics } from '../src/world/SlimeCaustics';

// A GPU run found the terrain's far-atmosphere clone failing to compile: SlimeCaustics patched both the
// base terrain material and its clone, and the clone calls the base's callback first, so the caustic
// varying and locals were declared twice ("'vSlimeCausticWorld' : redefinition"). Software rendering
// never attaches the caustics, which is why the suite had not seen it.
it('declares the caustic shader code once in a far-atmosphere clone of a patched material', () => {
  const base = new THREE.MeshStandardMaterial({ name: 'terrain' });
  const clone = new FarAtmosphere('clear', new THREE.Fog(0xffffff, 10, 100)).material(base);
  const world = new THREE.Scene();
  world.add(new THREE.Mesh(new THREE.BoxGeometry(), base), new THREE.Mesh(new THREE.BoxGeometry(), clone));
  const caustics = new SlimeCaustics();
  caustics.attach(world);
  expect(caustics.surfaces).toBe(2);
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: '#include <common>\nvoid main(){\n#include <project_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main(){\n#include <opaque_fragment>\n#include <fog_fragment>\n}',
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  clone.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  const count = (text: string, token: string) => text.split(token).length - 1;
  expect(count(shader.vertexShader, 'varying vec3 vSlimeCausticWorld')).toBe(1);
  expect(count(shader.vertexShader, 'vec4 causticPosition')).toBe(1);
  expect(count(shader.fragmentShader, 'varying vec3 vSlimeCausticWorld')).toBe(1);
  expect(count(shader.fragmentShader, 'float slimeCausticBand')).toBe(1);
  expect(count(shader.vertexShader, 'varying float vAirDistance')).toBe(1);
  caustics.dispose();
});
