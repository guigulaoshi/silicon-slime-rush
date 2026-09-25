import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import en from '../src/ui/locales/en.json' with { type: 'json' };
import zh from '../src/ui/locales/zh.json' with { type: 'json' };
import { creatorSocials } from '../src/ui/CreatorSocials';
import type { Manifest } from '../src/world/Billboards';

it('lists every account from the creator profile, itch.io on the renamed address', () => {
  const socials = creatorSocials();
  expect(socials.map(social => social.id)).toEqual(
    ['itch', 'youtube', 'x', 'tiktok', 'github', 'douyin', 'bilibili', 'xiaohongshu']);
  expect(socials[0]!.url).toBe('https://guigulaoshi.itch.io/');
  for (const locale of [en, zh] as Record<string, string>[]) for (const {id} of socials) expect(locale[`about.social.${id}`]).toBeTruthy();
  expect(zh['about.social.bilibili']).toBe('B站');
});

it('takes the addresses the billboards already carry from the billboard manifest', () => {
  const manifest = JSON.parse(readFileSync('public/billboards/manifest.json', 'utf8')) as Manifest;
  const target = (platform: string) => manifest.faces.find(face => face.en.platform === platform)!.en.target;
  const url = (id: string) => creatorSocials(manifest).find(social => social.id === id)?.url;
  for (const platform of ['youtube', 'x', 'tiktok', 'bilibili']) expect(url(platform)).toBe(target(platform));
  // A board that loses its address loses the About link too, instead of linking nowhere.
  const without = {...manifest, faces: manifest.faces.filter(face => face.en.platform !== 'x')};
  expect(creatorSocials(without).map(social => social.id)).not.toContain('x');
});
