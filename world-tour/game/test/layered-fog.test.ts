import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Sky, WEATHERS } from '../src/world/Sky';
import { layeredFogAmount } from '../src/world/LayeredFog';

describe('Layered fog', () => {
  it('is installed in the fog chunks as soon as the sky module loads', () => {
    expect(THREE.ShaderChunk.fog_fragment).toContain('srLayeredFog');
    expect(THREE.ShaderChunk.fog_pars_fragment).toContain('float srLayeredFog(');
    expect(THREE.ShaderChunk.fog_vertex).toContain('vFogView = mvPosition.xyz');
  });

  it('applies fully to the fog weather and not at all to clear, rain or snow, day and night', () => {
    for (const time of ['day', 'night'] as const) for (const weather of WEATHERS) {
      const sky = new Sky(new THREE.Scene(), time, 90, 2100, weather);
      expect(layeredFogAmount(sky.stats.fogFar), `${time} ${weather}`).toBe(weather === 'fog' ? 1 : 0);
      sky.dispose();
    }
  });

  it('keeps the shader ramp and the TypeScript ramp as one rule', () => {
    const ramp = /fogLayer = clamp\( \( ([\d.]+) - fogFar \) \/ ([\d.]+), 0\.0, 1\.0 \)/.exec(THREE.ShaderChunk.fog_fragment)!;
    for (const far of [150, 220, 300, 400, 900])
      expect(Math.min(1, Math.max(0, (Number(ramp[1]) - far) / Number(ramp[2])))).toBeCloseTo(layeredFogAmount(far), 9);
  });
});
