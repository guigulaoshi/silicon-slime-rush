import { expect, it } from 'vitest';
import { I18n } from '../src/ui/i18n';
import { visaStamp } from '../src/ui/ResultsScreen';
import { CATALOGUE } from '../src/app/tracks';

it('stamps the result card with the route\'s airport code and the day, in both languages', () => {
  const day = new Date(2026, 8, 23);
  const en = visaStamp(new I18n('en'), 'beijing', day);
  expect(en.querySelector('.visa-stamp-code')!.textContent).toBe('PEK');
  expect(en.querySelector('.visa-stamp-word')!.textContent).toBe('ARRIVED');
  expect(en.querySelector('.visa-stamp-date')!.textContent).toBe('23 SEP 2026');
  const zh = visaStamp(new I18n('zh'), 'sydney', day);
  expect(zh.querySelector('.visa-stamp-code')!.textContent).toBe('SYD');
  expect(zh.querySelector('.visa-stamp-word')!.textContent).toBe('已抵达');
  expect(zh.querySelector('.visa-stamp-date')!.textContent).toContain('2026');
  // every route has a code to stamp, and no two share one
  const codes = CATALOGUE.map(entry => entry.code);
  expect(codes.every(code => /^[A-Z]{3}$/.test(code))).toBe(true);
  expect(new Set(codes).size).toBe(codes.length);
});
