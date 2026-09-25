import { describe, expect, it } from 'vitest';
import { hitLayout, TEXT_CARD_IMAGE } from '../src/ui/TextCardImage';

/** The picture version of the text card never drops a slime colour the copied text lists. */
describe('text card picture layout', () => {
  it('places all six slime colours inside the margins, wrapping to a second row when needed', () => {
    const measure = (text: string) => text.length * 30;
    const labels = ['×12', '×8', '×3', '×27', '×1', '×4'];
    const spots = hitLayout(labels, 118, 72, TEXT_CARD_IMAGE.width - 72, measure);
    expect(spots).toHaveLength(6);
    for (const [k, spot] of spots.entries()) expect(spot.x + 118 + 12 + measure(labels[k]!)).toBeLessThanOrEqual(TEXT_CARD_IMAGE.width - 72);
    expect(Math.max(...spots.map(spot => spot.row))).toBeGreaterThan(0);
    expect(hitLayout(['×1', '×1'], 70, 72, 1008, measure).every(spot => spot.row === 0)).toBe(true);
  });
});
