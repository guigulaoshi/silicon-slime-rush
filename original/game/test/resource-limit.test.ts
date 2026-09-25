import { describe, expect, it } from 'vitest';
import { checkMaximum, checkMinimum, RESOURCE_LIMITS } from '../test-support/resource-limit';

describe('resource and performance limits', () => {
  it('keeps art below the raised line out of the way', () => {
    expect(() => checkMaximum(RESOURCE_LIMITS.max_triangles, 'max_triangles', 'fighter')).not.toThrow();
    expect(() => checkMinimum(RESOURCE_LIMITS.phone_min_fps, 'phone_min_fps', 'hangar')).not.toThrow();
  });

  it('rejects missing measurements', () => {
    expect(() => checkMaximum(Number.NaN, 'max_triangles', 'scene')).toThrow(/non-finite/);
  });

  it('blocks at the raised hard line and names the discussion fallback', () => {
    expect(() => checkMaximum(RESOURCE_LIMITS.max_triangles + 1,
      'max_triangles', 'runaway scene')).toThrow(/HARD LIMIT/);
    expect(() => checkMaximum(RESOURCE_LIMITS.max_triangles + 1,
      'max_triangles', 'runaway scene')).toThrow(/raise the limit/);
    expect(() => checkMinimum(RESOURCE_LIMITS.phone_min_fps - 1,
      'phone_min_fps', 'unplayable phone')).toThrow(/HARD LIMIT/);
  });
});
