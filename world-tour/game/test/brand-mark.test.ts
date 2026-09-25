import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import sharp from 'sharp';
import { expect, it } from 'vitest';

// The brief (「图标用矢量图自绘」「史莱姆本身就是一颗地球」): every size the page ships is the globe
// slime -- an ocean-blue body with green continents on it -- rendered by assets-src/brand/build_icon.py
// and rasterize.mjs, not the original's slime.
const share = async (file: string) => {
  const { data, info } = await sharp(readFileSync(resolve(__dirname, '../public/brand', file)))
    .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let body = 0, ocean = 0, land = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i]!, data[i + 1]!, data[i + 2]!, data[i + 3]!];
    if (a < 200) continue;
    body++;
    if (b > r + 40 && b > g) ocean++;
    if (g > r + 30 && g > b + 30) land++;
  }
  return { ocean: ocean / body, land: land / body, size: [info.width, info.height] };
};

it.each([64, 180, 512])('the %i px mark is the slime as a globe: ocean and continents', async (size) => {
  const { ocean, land, size: got } = await share(`slime-race-mark-${size}.png`);
  expect(got).toEqual([size, size]);
  expect(ocean, 'the body is the ocean').toBeGreaterThan(0.3);
  expect(land, 'continents cover a real share of it').toBeGreaterThan(0.1);
});
