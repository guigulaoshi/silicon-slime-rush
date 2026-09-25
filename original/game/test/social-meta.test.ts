import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { SOCIAL_DESCRIPTION, SOCIAL_IMAGE, socialImageUrl, socialMetaTags } from '../build/socialMeta';
import { PLANNED_GAME_URL } from '../src/app/Publication';

/** A pasted link must unfurl with a title, a sentence and a picture. */
describe('link preview tags', () => {
  it('index.html carries the marker the build fills in', () => {
    const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8');
    expect(html).toContain('<!-- social-meta -->');
    expect(html).not.toMatch(/property="og:/);
  });
  it('emits description, Open Graph and Twitter card pointing at the game page', () => {
    const tags = socialMetaTags(PLANNED_GAME_URL);
    for (const key of ['description', 'twitter:card', 'twitter:title', 'twitter:image']) {
      expect(tags).toMatch(new RegExp(`<meta name="${key}" content="[^"]+"`));
    }
    for (const key of ['og:type', 'og:title', 'og:description', 'og:url', 'og:image', 'og:image:width', 'og:image:height', 'og:locale']) {
      expect(tags).toMatch(new RegExp(`<meta property="${key}" content="[^"]+"`));
    }
    expect(tags).toContain(`content="${PLANNED_GAME_URL}"`);
    expect(tags).toContain(`content="${SOCIAL_IMAGE}"`);
    expect(SOCIAL_DESCRIPTION).toMatch(/史莱姆/);
    expect(SOCIAL_DESCRIPTION).toMatch(/Bay Area/);
  });
  it('the preview picture ships and is the size the tags declare', () => {
    const bytes = readFileSync(resolve(__dirname, '../public/brand/og-1200x630.jpg'));
    expect(bytes.length).toBeGreaterThan(20_000);
    expect(bytes.length).toBeLessThan(400_000);
    // JPEG SOF0/SOF2 marker carries height then width, big-endian.
    const sof = bytes.indexOf(Buffer.from([0xff, 0xc0])) >= 0 ? bytes.indexOf(Buffer.from([0xff, 0xc0])) : bytes.indexOf(Buffer.from([0xff, 0xc2]));
    expect(sof).toBeGreaterThan(0);
    expect(bytes.readUInt16BE(sof + 5)).toBe(630);
    expect(bytes.readUInt16BE(sof + 7)).toBe(1200);
  });
  it('absolutises the picture only when the hosting origin is known and https', () => {
    expect(socialImageUrl(undefined)).toBe(SOCIAL_IMAGE);
    expect(socialImageUrl('')).toBe(SOCIAL_IMAGE);
    expect(socialImageUrl('http://html.itch.zone/html/1')).toBe(SOCIAL_IMAGE);
    expect(socialImageUrl('not a url')).toBe(SOCIAL_IMAGE);
    expect(socialImageUrl('https://html.itch.zone/html/12345678')).toBe('https://html.itch.zone/html/12345678/brand/og-1200x630.jpg');
    expect(socialImageUrl('https://html.itch.zone/html/12345678/')).toBe('https://html.itch.zone/html/12345678/brand/og-1200x630.jpg');
    expect(socialMetaTags('https://guigulaoshi.itch.io/silicon-slime-rush', socialImageUrl('https://html.itch.zone/html/1')))
      .toContain('<meta property="og:image" content="https://html.itch.zone/html/1/brand/og-1200x630.jpg">');
  });
  it('escapes quotes so a slogan cannot break out of the attribute', () => {
    expect(socialMetaTags('https://example.itch.io/x', './a"b.jpg')).toContain('content="./a&quot;b.jpg"');
  });
});
