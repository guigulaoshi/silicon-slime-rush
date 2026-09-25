import * as THREE from 'three';
import { expect, it } from 'vitest';
import { compileEverything } from '../src/world/compileEverything';
import { SlimeCaustics } from '../src/world/SlimeCaustics';

// CompileAsync skips hidden objects and never builds shadow programs, so pooled effects
// compiled on first appearance mid-race. The warmup must see everything and leave the scene as it was.
it('compiles and draws hidden and culled objects once, then restores them, without switching on lights', async () => {
  const scene = new THREE.Scene();
  const splash = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  splash.visible = false;
  const road = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial());
  const lamp = new THREE.SpotLight();
  lamp.visible = false;
  scene.add(splash, road, lamp);
  const seen: string[] = [];
  const look = (step: string) => seen.push(`${step}:${splash.visible}/${splash.frustumCulled}/${road.frustumCulled}/${lamp.visible}/${scene.children.length}`);
  const renderer = {
    compileAsync: async () => look('compile'),
    render: () => look('render'),
  } as unknown as THREE.WebGLRenderer;
  await compileEverything(renderer, scene, new THREE.PerspectiveCamera());
  expect(seen).toEqual(['compile:true/false/false/false/9', 'render:true/false/false/false/9']);
  expect([splash.visible, splash.frustumCulled, road.visible, road.frustumCulled, lamp.visible, scene.children.length])
    .toEqual([false, true, true, true, false, 3]);
});

it('keeps the caustic pass out of shaders while no giant volume is active', () => {
  const material = new THREE.MeshStandardMaterial();
  const world = new THREE.Scene();
  world.add(new THREE.Mesh(new THREE.BoxGeometry(), material));
  const caustics = new SlimeCaustics();
  caustics.attach(world);
  const shader = {
    uniforms: {} as Record<string, THREE.IUniform>,
    vertexShader: '#include <common>\nvoid main(){\n#include <project_vertex>\n}',
    fragmentShader: '#include <common>\nvoid main(){\n#include <opaque_fragment>\n}',
  } as unknown as THREE.WebGLProgramParametersWithUniforms;
  material.onBeforeCompile(shader, {} as THREE.WebGLRenderer);
  expect(shader.fragmentShader).toContain('if(uSlimeCausticStrength>0.0){');
  expect((shader.uniforms.uSlimeCausticStrength as THREE.IUniform).value).toBe(0);
  caustics.dispose();
});
