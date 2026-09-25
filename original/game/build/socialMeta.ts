/**
 * The link-preview tags for `index.html`: description, Open Graph and Twitter card.
 *
 * One owner for the page's public face: the address comes from `Publication.ts` exactly as the
 * shared-picture watermark reads it, so a link pasted into a chat and a picture posted
 * from the game can never point at two different places. The copy is bilingual on purpose -- a
 * preview card has no language switch, and the same link travels through 微信 and Discord alike.
 */
import { assetOriginBase } from '../src/app/Publication';

export const SOCIAL_TITLE = 'Silicon Slime Rush · 史莱姆赛车：硅谷';
export const SOCIAL_DESCRIPTION =
  '开上真实的湾区公路，撞穿史莱姆，闯过末日第一天的早高峰。'
  + 'Race real Bay Area roads through the slime apocalypse. Free in your browser.';
/**
 * Under `public/`, so it ships beside the page. Discord, Slack and Telegram resolve a relative
 * picture against the page; X, Facebook and LinkedIn only accept an absolute one, and the page's
 * real origin (itch's embed host) is not known until the build has been uploaded. So the build
 * takes `VITE_PUBLIC_ASSET_ORIGIN` when it is known and ships the relative path otherwise
 * sets it once the embed address exists).
 */
export const SOCIAL_IMAGE = './brand/og-1200x630.jpg';
export const SOCIAL_IMAGE_SIZE = { width: 1200, height: 630 } as const;

/** The picture address a preview card gets: absolute when the hosting origin is known. */
export function socialImageUrl(assetOrigin: unknown): string {
  const base = assetOriginBase(assetOrigin);
  return base ? new URL(SOCIAL_IMAGE, base).href : SOCIAL_IMAGE;
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

/** `home` is the verified public page, or the planned one while none is verified. */
export function socialMetaTags(home: string, image: string = SOCIAL_IMAGE): string {
  const tags: [string, string, string][] = [
    ['name', 'description', SOCIAL_DESCRIPTION],
    ['property', 'og:type', 'website'],
    ['property', 'og:site_name', 'Silicon Slime Rush'],
    ['property', 'og:title', SOCIAL_TITLE],
    ['property', 'og:description', SOCIAL_DESCRIPTION],
    ['property', 'og:url', home],
    ['property', 'og:image', image],
    ['property', 'og:image:width', String(SOCIAL_IMAGE_SIZE.width)],
    ['property', 'og:image:height', String(SOCIAL_IMAGE_SIZE.height)],
    ['property', 'og:locale', 'zh_CN'],
    ['property', 'og:locale:alternate', 'en_US'],
    ['name', 'twitter:card', 'summary_large_image'],
    ['name', 'twitter:title', SOCIAL_TITLE],
    ['name', 'twitter:description', SOCIAL_DESCRIPTION],
    ['name', 'twitter:image', image],
  ];
  return tags.map(([attr, key, value]) => `<meta ${attr}="${key}" content="${escape(value)}">`).join('\n    ');
}
