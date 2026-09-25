import { expect, test } from 'vitest';
import zh from '../src/ui/locales/zh.json' with { type: 'json' };

// Every player-facing Chinese string names the place 硅谷.
test('Chinese copy says 硅谷, never 湾区', () => {
  const offenders = Object.entries(zh as Record<string, string>).filter(([, text]) => text.includes('湾区'));
  expect(offenders).toEqual([]);
});
