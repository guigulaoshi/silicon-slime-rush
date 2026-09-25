import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { EXPLOSION_LIFETIMES, EXPLOSION_POOL, ExplosionEffects } from '../src/world/Explosions';


describe('bomb explosions', () => {
  it('flash first, fire and ground glow next, smoke last, and nothing left burning', () => {
    const effects = new ExplosionEffects();
    const centre = new THREE.Vector3(0, 1, 0), ground = new THREE.Vector3();
    effects.spawn(centre, ground, 2);
    effects.update(.01);
    expect(new Set(effects.liveLayers)).toEqual(new Set(['flash', 'fire', 'glow']));
    effects.update(.1);
    expect(effects.liveLayers).toContain('smoke');
    effects.update(EXPLOSION_LIFETIMES.flash);
    expect(effects.liveLayers).not.toContain('flash');
    effects.update(EXPLOSION_LIFETIMES.fire);
    expect(effects.liveLayers).not.toContain('fire');
    expect(effects.liveLayers).not.toContain('glow');
    effects.update(Math.max(...Object.values(EXPLOSION_LIFETIMES)));
    expect(effects.liveLayers, 'every layer is gone: no fire keeps burning').toEqual([]);
    effects.dispose();
  });

  it('keeps a chain of bombs within its pool', () => {
    const effects = new ExplosionEffects();
    for (let i = 0; i < 40; i++) effects.spawn(new THREE.Vector3(i, 1, 0), new THREE.Vector3(i, 0, 0), 3);
    effects.update(.2);
    expect(effects.liveLayers.length).toBeLessThanOrEqual(2 * EXPLOSION_POOL);
    expect(effects.liveLayers).toContain('fire');
    effects.dispose();
  });
});
