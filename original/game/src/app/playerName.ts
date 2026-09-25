/**
 * A player's optional nickname for share cards, the text card, the results card and challenge links
 *There is no server, so no word filter: the player sends their own card. What it does
 * guard is the card itself -- no line breaks, no invisible or direction-flipping characters, and a
 * length a card has room for.
 */
export const MAX_PLAYER_NAME = 16;

export function cleanPlayerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  const flat = value.normalize('NFC')
    .replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  // Code points, not UTF-16 units, so an emoji or a CJK character is never cut in half.
  return Array.from(flat).slice(0, MAX_PLAYER_NAME).join('').trim();
}
