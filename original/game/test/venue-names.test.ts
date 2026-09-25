import { expect, it } from 'vitest';
import en from '../src/ui/locales/en.json' with { type: 'json' };
import zh from '../src/ui/locales/zh.json' with { type: 'json' };
import campus from '../../pipeline/routes/shoreline.json' with { type: 'json' };
import rooftop from '../../pipeline/routes/wolfe-pruneridge.json' with { type: 'json' };
import research from '../../pipeline/routes/moffett-field.json' with { type: 'json' };

it('uses generic public venue names without calling the research centre military', () => {
  expect(en['track.moffett-field.name']).toBe('Research Center');
  expect(zh['track.moffett-field.name']).toBe('研究中心');
  expect(research.name).toEqual({ zh: '研究中心', en: 'Research Center' });
  expect(en['track.shoreline.name']).toBe('Big Tech Campus');
  expect(zh['track.shoreline.name']).toBe('大厂园区');
  expect(campus.name).toEqual({ zh: '大厂园区', en: 'Big Tech Campus' });
  expect(en['track.wolfe-pruneridge.name']).toBe('Big Tech Rooftop');
  expect(zh['track.wolfe-pruneridge.name']).toBe('大厂楼顶');
  expect(rooftop.name).toEqual({ zh: '大厂楼顶', en: 'Big Tech Rooftop' });

  const playerCopy = JSON.stringify({ en, zh }).toLowerCase();
  expect(playerCopy).not.toContain('nasa');
  expect(playerCopy).not.toContain('military airfield');
  expect(playerCopy).not.toContain('corporate campus');
});
