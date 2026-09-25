import { describe, expect, it } from 'vitest';
import { AUTO_SAMPLE_SECONDS, AutoQualitySampler, autoQualitySamplerFor, autoQualityStart, QUALITY_LIMITS } from '../src/world/quality';

describe('quality budgets', () => {
  it('caps every slime-owned pool at every quality tier', () => {
    expect(Object.keys(QUALITY_LIMITS)).toEqual(['high', 'medium', 'low']);
    for (const limits of Object.values(QUALITY_LIMITS)) {
      expect(Object.keys(limits).sort()).toEqual(
        ['colossi', 'fallingSlimes', 'groundEffects', 'particles', 'puddles', 'slimes'].sort());
      expect(Object.values(limits).every((n) => Number.isInteger(n) && n > 0)).toBe(true);
    }
    expect(new Set(Object.values(QUALITY_LIMITS).map((limits) => limits.slimes)))
      .toEqual(new Set([512]));
  });
});

describe('automatic quality', () => {
  const measure = (fps: number) => {
    const sampler = new AutoQualitySampler();
    let result = null;
    for (let i = 0; i <= Math.ceil(AUTO_SAMPLE_SECONDS * fps); i++) result = sampler.sample(1 / fps) ?? result;
    return result;
  };

  it('keeps high only with 60 fps headroom', () => expect(measure(60)).toBe('high'));
  it('drops a mid-range renderer to medium', () => expect(measure(45)).toBe('medium'));
  it('drops a phone near the floor to low', () => expect(measure(30)).toBe('low'));
  it('waits for the full opening sample instead of reacting to one frame', () => {
    const sampler = new AutoQualitySampler();
    expect(sampler.sample(1 / 20)).toBeNull();
  });
});

describe('phone auto quality', () => {
  it('keeps a phone at low for the whole race, while desktops still measure their way to high', () => {
    expect(autoQualityStart(true)).toBe('low');
    expect(autoQualityStart(false)).toBe('high');
    // -- nothing measures a phone, so nothing can raise it.
    expect(autoQualitySamplerFor(true)).toBeNull();
    const desktop = autoQualitySamplerFor(false)!;
    let d: string | null = null;
    for (let i = 0; i < AUTO_SAMPLE_SECONDS * 60 + 2; i++) d = desktop.sample(1 / 60);
    expect(d).toBe('high');
  });
});
