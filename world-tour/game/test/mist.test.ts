import * as THREE from 'three';
import { expect, it } from 'vitest';
import { Mist } from '../src/world/Mist';
import { MIST_SHEETS } from '../src/world/quality';

const SPEC = { layersM: [815, 800, 830], colour: '#e6eaec', opacity: .8 };

it('draws as many sheets as the quality level allows, most important first, at their elevations', () => {
  for (const quality of ['high', 'medium', 'low'] as const) {
    const mist = new Mist(SPEC, new THREE.Vector3(10, 0, 20), 'day', MIST_SHEETS[quality]);
    expect(mist.sheets).toBe(MIST_SHEETS[quality]);
    expect(mist.root.children.map(m => m.position.y)).toEqual(SPEC.layersM.slice(0, MIST_SHEETS[quality]));
    expect(mist.root.children.every(m => m.position.x === 10 && m.position.z === 20)).toBe(true);
    mist.dispose();
  }
  expect(MIST_SHEETS.low).toBeLessThan(MIST_SHEETS.high);
});

it('is lit only by the sky at night instead of glowing like a lamp', () => {
  const colour = (time: 'day' | 'night') => {
    const mist = new Mist(SPEC, new THREE.Vector3(), time, 1);
    const value = ((mist.root.children[0] as THREE.Mesh).material as THREE.ShaderMaterial).uniforms.uColour!.value as THREE.Color;
    mist.dispose();
    return value.getHSL({ h: 0, s: 0, l: 0 }).l;
  };
  expect(colour('night')).toBeLessThan(colour('day') * .3);
});
