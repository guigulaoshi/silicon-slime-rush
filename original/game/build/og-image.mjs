// Builds public/brand/og-1200x630.jpg, the link-preview picture, from the home hero.
// Run from game/: node build/og-image.mjs   (sharp is already a dev dependency)
import { readFileSync } from 'node:fs';
import sharp from 'sharp';

const hero = await sharp('public/home/goldengate.webp').resize(1200, 630, { fit: 'cover', position: 'centre' }).png().toBuffer();
const mark = readFileSync('public/brand/slime-race-mark-512.png').toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630">
  <defs><linearGradient id="shade" x1="0" x2="1"><stop offset="0" stop-color="#07111c" stop-opacity=".92"/><stop offset=".55" stop-color="#07111c" stop-opacity=".55"/><stop offset="1" stop-color="#07111c" stop-opacity=".05"/></linearGradient></defs>
  <rect width="1200" height="630" fill="url(#shade)"/>
  <image href="data:image/png;base64,${mark}" x="72" y="86" width="96" height="96"/>
  <g font-family="PingFang SC, Hiragino Sans GB, Noto Sans CJK SC, Arial, sans-serif" fill="#f4f6fa">
    <text x="188" y="128" font-size="30" letter-spacing="4" fill="#a4efb3">BAY AREA · DAY ONE</text>
    <text x="72" y="290" font-size="92" font-weight="bold">史莱姆赛车：硅谷</text>
    <text x="72" y="372" font-size="60" font-weight="bold">SILICON SLIME RUSH</text>
    <text x="72" y="470" font-size="34">每天那条上班路，现在多了史莱姆。</text>
    <text x="72" y="520" font-size="30" fill="#d7dde6">Your daily commute. Now with slime.</text>
    <text x="72" y="584" font-size="24" letter-spacing="2" fill="#a4efb3">FREE BROWSER GAME · REAL BAY AREA ROADS</text>
  </g></svg>`;
await sharp(hero).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 84, mozjpeg: true }).toFile('public/brand/og-1200x630.jpg');
console.log('wrote public/brand/og-1200x630.jpg');
