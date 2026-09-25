import * as THREE from 'three';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { MATERIAL_NAMES } from '../src/track/types';
import { FACADE_UV_METRES, MaterialLibrary } from '../src/world/materials';

describe('the material library', () => {
  it('has every name the contract lists, and each material carries that name', () => {
    const lib = new MaterialLibrary();
    for (const name of MATERIAL_NAMES) {
      const m = lib.get(name);
      expect(m, name).not.toBe(lib.missing);
      expect(m.name, `${name} should carry its contract name`).toBe(name);
    }
    lib.dispose();
  });

  it('gives an unknown name the magenta material rather than a silent default', () => {
    const lib = new MaterialLibrary();
    expect(lib.get('no-such-material')).toBe(lib.missing);
    expect(lib.get(undefined)).toBe(lib.missing);
    expect(lib.unknown(['road', 'no-such-material'])).toEqual(['no-such-material']);
    lib.dispose();
  });

  it('ripples the water: the shader is patched and its clock moves', () => {
    // The bay is half of what this game looks at and flat colour reads as painted card. The patch
    // is applied at compile time, so the test drives onBeforeCompile the way three.js would.
    const lib = new MaterialLibrary();
    const water = lib.get('water') as THREE.MeshStandardMaterial;
    expect(water.onBeforeCompile).toBeTypeOf('function');
    expect(water.customProgramCacheKey()).toBe('ripple-water');

    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: '#include <common>\nvoid main(){\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main(){\n#include <normal_fragment_maps>\n}',
    };
    water.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer);
    expect(shader.uniforms.uTime).toBeTruthy();
    expect(shader.vertexShader).toContain('vWaterPos');
    expect(shader.fragmentShader).toContain('uTime');

    expect(shader.uniforms.uTime!.value).toBe(0);
    lib.animate(12.5);
    expect(shader.uniforms.uTime!.value).toBe(12.5);
    lib.dispose();
  });

  it('draws building windows from the wall uv and a world-space normal', () => {
    /* */
    const lib = new MaterialLibrary();
    const building = lib.get('building') as THREE.MeshStandardMaterial;
    expect(building.onBeforeCompile).toBeTypeOf('function');
    expect(building.customProgramCacheKey()).toBe('windowed-building');

    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: '#include <common>\nvoid main(){\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n#include <emissivemap_fragment>\n}',
    };
    building.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer);

    expect(shader.vertexShader).toContain('vFacadeUv = uv;');
    expect(shader.vertexShader).toContain('mat3(modelMatrix) * objectNormal');
    // objectNormal only exists after beginnormal_vertex, so the write has to land after it
    expect(shader.vertexShader.indexOf('vFacadeNormal ='))
      .toBeGreaterThan(shader.vertexShader.indexOf('#include <beginnormal_vertex>'));

    const pattern = shader.fragmentShader.slice(shader.fragmentShader.indexOf('#include <color_fragment>'));
    expect(pattern).toContain('vFacadeUv');
    expect(pattern, 'the pattern must not depend on where the camera is').not.toContain('vNormal');
    expect(pattern, 'floors must be measured from the building, not from sea level')
      .not.toContain('vWallPos');
    expect(shader.fragmentShader).toContain('totalEmissiveRadiance +=');
    expect(shader.uniforms.uNight?.value).toBe(0);
    lib.lightFor('night');
    expect(shader.uniforms.uNight?.value).toBe(1);
    lib.lightFor('day');
    expect(shader.uniforms.uNight?.value).toBe(0);
    lib.dispose();
  });

  it('gives every facade material the pattern, not just the untextured fallback', () => {
    // Since a footprint's OSM tag picks one of five facade materials, and `building` is
    // only what an unrecognised tag falls back to. adds five dedicated landmark facades;
    // a tree that has not generated its textures -- or a moment before they load -- renders all
    // eleven, and if the pattern were wired to one name the others would be blank slabs.
    const lib = new MaterialLibrary();
    const facades = MATERIAL_NAMES.filter((n) => n.startsWith('building'));
    expect(facades).toEqual([
      'building', 'building_glass', 'building_stucco', 'building_concrete', 'building_metal',
      'building_parking', 'building_landmark_glass', 'building_landmark_pale',
      'building_landmark_solar', 'building_landmark_metal', 'building_landmark_roof',
    ]);
    for (const name of facades) {
      const m = lib.get(name) as THREE.MeshStandardMaterial;
      expect(m.customProgramCacheKey(), `${name} has no window pattern`).toBe('windowed-building');
    }
    lib.dispose();
  });

  it('stands the pattern down once the facade carries its own texture', () => {
    // `map` and the pattern both draw windows. Two sets at two different sizes on one wall is
    // worse than either alone, so the injected block is compiled out wherever USE_MAP is defined.
    const lib = new MaterialLibrary();
    const shader = {
      uniforms: {} as Record<string, { value: number }>,
      vertexShader: '#include <common>\nvoid main(){\n#include <beginnormal_vertex>\n#include <begin_vertex>\n}',
      fragmentShader: '#include <common>\nvoid main(){\n#include <color_fragment>\n#include <emissivemap_fragment>\n}',
    };
    const m = lib.get('building_glass') as THREE.MeshStandardMaterial;
    m.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer);
    const pattern = shader.fragmentShader.slice(shader.fragmentShader.indexOf('#include <color_fragment>'));
    expect(pattern).toContain('#ifndef USE_MAP');
    expect(pattern.indexOf('#endif')).toBeGreaterThan(pattern.indexOf('vFacadeUv'));
    lib.dispose();
  });

  it('uses one pane mask for reflections and building-stable grouped night lights', () => {
    const lib = new MaterialLibrary();
    const material = lib.get('building_glass') as THREE.MeshStandardMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: ['common', 'color_fragment', 'roughnessmap_fragment',
        'metalnessmap_fragment', 'emissivemap_fragment'].map(s => `#include <${s}>`).join('\n'),
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer);
    expect(shader.vertexShader).toContain('vFacadeIdentity = uv1');
    expect(shader.fragmentShader).toContain('vMapUv * uFacadePanes.xy');
    expect(shader.fragmentShader).toContain('roughnessFactor = mix(roughnessFactor, .075, facadeGlass)');
    expect(shader.fragmentShader).toContain('floor(vFacadeIdentity.x * 1024.0 + .5)');
    expect(shader.fragmentShader).toContain('residential ? room : vec2(floor(room.x / 4.0), room.y)');
    expect(shader.fragmentShader).toContain('brightness * facadeGlass * occupied * uNight');
    expect(shader.uniforms.uFacadePanes!.value).toEqual(new THREE.Vector3());
    lib.dispose();
  });

  it('fades distant windows to their average instead of sampling them per pixel', () => {
    // At phone resolution a far row of windows had less than a pixel each, so which pane
    // or lit room a pixel hit changed with every centimetre of camera travel. The footprint of one
    // pixel on the pane grid decides how much of the per-window pattern survives.
    const lib = new MaterialLibrary();
    const material = lib.get('building_glass') as THREE.MeshStandardMaterial;
    const shader = {
      uniforms: {} as Record<string, { value: unknown }>,
      vertexShader: '#include <common>\n#include <begin_vertex>',
      fragmentShader: ['common', 'color_fragment', 'emissivemap_fragment'].map(s => `#include <${s}>`).join('\n'),
    };
    material.onBeforeCompile(shader as unknown as THREE.WebGLProgramParametersWithUniforms,
      undefined as unknown as THREE.WebGLRenderer);
    const fragment = shader.fragmentShader;
    // declared outside the USE_MAP split, because the night lights read it with or without a map
    expect(fragment.indexOf('float facadeFar = 0.0;')).toBeLessThan(fragment.indexOf('#ifndef USE_MAP'));
    expect(fragment).toContain('smoothstep(vec2(.3), vec2(.75), fwidth(grid))');
    // both the textured walls and the untextured fallback the far skylines use, each axis on its own
    expect(fragment).toContain('pane = mix(pane, frameEdge, far);');
    expect(fragment).toContain('pane = mix(pane, vec2(.54, .40), far);');
    expect(fragment).toContain('occupied = mix(occupied, residential ? .52 : .64, facadeFar);');
    lib.dispose();
  });

  it('takes the facade uv scale from the contract, like the pipeline does', () => {
    // The window pattern is drawn straight onto the wall uv and the shopfront band is compared
    // against absolute metres, so a producer using a scale of its own gets windows of another size
    // and a band stretched to match. The number has one owner and both sides read it back.
    const doc = readFileSync(resolve(process.cwd(), '..', 'docs', 'CONTRACT.md'), 'utf-8');
    const stated = /facade_uv_metres = ([0-9.]+)/.exec(doc);
    expect(stated, 'docs/CONTRACT.md no longer states facade_uv_metres').toBeTruthy();
    expect(FACADE_UV_METRES).toBe(Number(stated![1]));
  });

  it('leaves everything but the water still', () => {
    const lib = new MaterialLibrary();
    for (const name of MATERIAL_NAMES) {
      if (name === 'water') continue;
      expect((lib.get(name) as THREE.MeshStandardMaterial).onBeforeCompile.toString(),
        `${name} should not be animated`).not.toContain('uTime');
    }
    lib.dispose();
  });
});
