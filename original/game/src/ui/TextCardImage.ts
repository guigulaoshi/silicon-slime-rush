import { formatTime } from '../track/Race';
import { starGlyphs } from '../track/Rating';
import type { I18n } from './i18n';
import { routeName } from './routeName';
import { recordText, resultRecord, type ResultFacts } from './screens';
import { textCardPlayers } from './TextCard';
import { challengeLines } from './ShareDialog';

/** Portrait, the shape a phone feed shows biggest. */
export const TEXT_CARD_IMAGE = { width: 1080, height: 1350 } as const;

// The slime colours as drawn squares, not emoji: an emoji font differs per phone and is missing on some.
const HIT_COLOURS: Record<string, string> = { popper: '#6fd34b', slick: '#a45be0', burst: '#101418', boost: '#e8452f', colossus: '#3e8fe6', other: '#e8eef2' };
const SECTION_COLOURS = { fast: '#c8f57a', slow: '#ffb36b', none: '#3a4f5c' } as const;
const FONT = 'Arial,"PingFang SC","Microsoft YaHei",sans-serif';

/** Safari only grew `ctx.roundRect` in 16.4, and the build targets older than that (vite.config target es2022). */
export function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/**
 * Where each slime colour and its count go: left to right, measured before drawing, onto a second row
 * when the next one would cross the margin -- a run can hit all six kinds and every one is drawn.
 */
export function hitLayout(labels: readonly string[], square: number, left: number, right: number,
  measure: (text: string) => number): { x: number; row: number }[] {
  let x = left, row = 0;
  return labels.map(label => {
    const width = square + 12 + measure(label);
    if (x > left && x + width > right) { x = left; row++; }
    const spot = { x, row };
    x += width + 34;
    return spot;
  });
}

/** A slime colour swatch; the black bomb gets an outline so it shows on the dark ground. */
function square(ctx: CanvasRenderingContext2D, kind: string, x: number, y: number, size: number, radius: number): void {
  ctx.fillStyle = HIT_COLOURS[kind]!; roundRect(ctx, x, y, size, size, radius); ctx.fill();
  if (kind === 'burst') { ctx.strokeStyle = '#6f7f8a'; ctx.lineWidth = Math.max(2, size / 28); ctx.stroke(); }
}

/** The text card as a picture: the same rows the copied text carries, drawn big enough to read in a feed. */
export function drawTextCardImage(canvas: HTMLCanvasElement, t: I18n, result: ResultFacts): void {
  const { width, height } = TEXT_CARD_IMAGE;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const ground = ctx.createLinearGradient(0, 0, 0, height);
  ground.addColorStop(0, '#12293a'); ground.addColorStop(1, '#07111a');
  ctx.fillStyle = ground; ctx.fillRect(0, 0, width, height);
  const left = 72, inner = width - left * 2;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = '#dcfca6'; ctx.font = `bold 60px ${FONT}`; ctx.fillText(t.t('app.title'), left, 140, inner);
  ctx.fillStyle = '#eef3f8'; ctx.font = `36px ${FONT}`; ctx.fillText(routeName(t, result.trackId, result.direction), left, 200, inner);
  // The record badge rides under the route, in the card's own colour language.
  const feat = resultRecord(result);
  if (feat) {
    ctx.font = `bold 34px ${FONT}`;
    const label = recordText(t, feat);
    const pad = 16, box = Math.min(inner, ctx.measureText(label).width + pad * 2);
    ctx.fillStyle = feat.kind === 'best' ? '#c8f57a' : '#7fd3ff';
    roundRect(ctx, left, 224, box, 56, 12); ctx.fill();
    ctx.fillStyle = '#0f2230'; ctx.fillText(label, left + pad, 262, box - pad * 2);
  }
  const players = textCardPlayers(t, result);
  const duo = players.length > 1;
  // Solo fills the portrait with larger rows; two drivers share the same space.
  const size = { time: duo ? 54 : 92, stars: duo ? 50 : 84, square: duo ? 70 : 118, bar: duo ? 46 : 84,
    starGap: duo ? 70 : 112, squareGap: duo ? 40 : 70, barGap: duo ? 40 : 80, block: duo ? 380 : 0 };
  let bottom = 0;
  players.forEach((player, index) => {
    let y = (duo ? 300 : 380) + (feat ? 64 : 0) + index * size.block;
    ctx.fillStyle = '#ffffff'; ctx.font = `bold ${size.time}px ${FONT}`;
    ctx.fillText((player.label ? `${player.label} · ` : '') + formatTime(player.time), left, y, inner);
    if (player.rating) { ctx.fillStyle = '#ffe594'; ctx.font = `${size.stars}px ${FONT}`; y += size.starGap; ctx.fillText(starGlyphs(player.rating), left, y, inner); }
    // Slimes hit: a coloured square per kind with its count.
    y += size.squareGap;
    if (!player.hits.length) { ctx.fillStyle = '#b9c8d2'; ctx.font = `36px ${FONT}`; ctx.fillText(t.t('textCard.noHits'), left, y + size.square * .65, inner); }
    ctx.font = `bold ${Math.round(size.square * .45)}px ${FONT}`;
    const placed = hitLayout(player.hits.map(hit => `×${hit.count}`), size.square, left, width - left, text => ctx.measureText(text).width);
    placed.forEach((spot, k) => {
      const hit = player.hits[k]!;
      square(ctx, hit.kind, spot.x, y + spot.row * (size.square + 14), size.square, 14);
      ctx.fillStyle = '#eef3f8'; ctx.fillText(`×${hit.count}`, spot.x + size.square + 12, y + spot.row * (size.square + 14) + size.square * .66);
    });
    y += (placed.length ? placed[placed.length - 1]!.row : 0) * (size.square + 14);
    // Eight equal route sections, the copied text's ⏩ 🐢 ▫️ as bars.
    y += size.square + size.barGap;
    const gap = 12, cell = (inner - gap * 7) / 8;
    player.sections.forEach((section, i) => {
      ctx.fillStyle = SECTION_COLOURS[section]; roundRect(ctx, left + i * (cell + gap), y, cell, size.bar, 12); ctx.fill();
    });
    bottom = y + size.bar;
  });
  // The dare this run passes on, in words: a picture cannot carry a clickable link.
  // It follows the rows rather than sitting at a fixed height: a second row of colours pushes them down.
  if (result.challengeCode && !duo) {
    ctx.fillStyle = '#dcfca6'; ctx.font = `bold 38px ${FONT}`;
    ctx.fillText(challengeLines(t, result)[0]!.replace(/[:：]\s*$/, ''), left, Math.min(bottom + 54, height - 252), inner);
  }
  // The legend, so the picture reads on its own without the copied text beside it.
  let y = height - 222;
  ctx.font = `26px ${FONT}`;
  let x = left;
  for (const kind of ['popper', 'slick', 'burst', 'boost', 'colossus'] as const) {
    square(ctx, kind, x, y - 24, 28, 6);
    const label = t.t(`textCard.legend.${kind}`);
    ctx.fillStyle = '#cfdae3'; ctx.fillText(label, x + 38, y); x += 38 + ctx.measureText(label).width + 30;
  }
  y += 46; x = left;
  for (const section of ['fast', 'slow', 'none'] as const) {
    ctx.fillStyle = SECTION_COLOURS[section]; roundRect(ctx, x, y - 22, 44, 24, 6); ctx.fill();
    const label = t.t(`textCard.legend.${section}`);
    ctx.fillStyle = '#cfdae3'; ctx.fillText(label, x + 54, y); x += 54 + ctx.measureText(label).width + 30;
  }
}
