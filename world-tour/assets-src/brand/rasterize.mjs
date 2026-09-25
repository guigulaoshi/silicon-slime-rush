// Rasterise the World Tour icon into the three sizes the game reads (game/public/brand/).
// Run from the repository's world-tour directory: node assets-src/brand/rasterize.mjs
import { createRequire } from 'node:module';
const require = createRequire(new URL('../../game/package.json', import.meta.url));
const sharp = require('sharp');
const svg = new URL('./slime-globe.svg', import.meta.url);
for (const size of [64, 180, 512]) {
  await sharp(svg.pathname, { density: 72 * size / 512 * 4 }).resize(size, size).png({ compressionLevel: 9 })
    .toFile(new URL(`../../game/public/brand/slime-race-mark-${size}.png`, import.meta.url).pathname);
  console.log('wrote', size);
}
