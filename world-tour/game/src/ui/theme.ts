/**
 * The interface's colours, and the only place they are written down.
 *
 * World Tour's theme is travel paperwork: passport-navy grounds, boarding-pass cream text and cards,
 * luggage-tag amber for the thing to press, visa-stamp red for what is urgent or picked, harbour blue
 * for water and information, a customs-green for "good". Every colour in the stylesheets is a mix of
 * two of these pairs at the lightness the original design gave it, so the contrast the original tuned
 * survives a change of palette; canvas drawings (share cards, the garage backdrop) call `tone` for the
 * same mixes. Changing a value here re-themes the whole game.
 */
export const THEME = {
  night: '#111a2d',        // passport cover, the darkest ground
  mist: '#f7efdf',         // boarding-pass paper, the lightest text
  accentDeep: '#b97a17',   // luggage-tag amber, dark end
  accentLight: '#ffe6ad',  // luggage-tag amber, light end
  stampDeep: '#8e2716',    // visa-stamp red, dark end
  stampLight: '#ffd8c6',
  goldDeep: '#96701a',     // brass, stars and medals
  goldLight: '#fff0c2',
  goodDeep: '#1d6746',     // customs green
  goodLight: '#d7f0e0',
  seaDeep: '#1c4a73',      // harbour blue
  seaLight: '#d6e9f7',
} as const;

export type ThemeColour = keyof typeof THEME;

function channels(hex: string): [number, number, number] {
  const h = hex.slice(1);
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/** `from` mixed toward `to` by `t` (0..1) in sRGB -- what CSS `color-mix(in srgb, ...)` does -- as hex or rgba. */
export function tone(from: ThemeColour, to: ThemeColour, t: number, alpha = 1): string {
  const a = channels(THEME[from]), b = channels(THEME[to]);
  const c = a.map((v, i) => Math.round(v + (b[i]! - v) * t));
  if (alpha < 1) return `rgba(${c.join(',')},${+alpha.toFixed(3)})`;
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Ticket type: airport codes, gate numbers, times -- the printed parts of the paperwork. */
export const TICKET_FONT = '"SF Mono", "Menlo", "Consolas", "Roboto Mono", monospace';

/** The custom properties every stylesheet mixes from; put in the page head before any other style. */
export function themeCss(): string {
  const vars = Object.entries(THEME).map(([k, v]) => `--${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}:${v};`);
  return `:root{${vars.join('')}--font-ticket:${TICKET_FONT};}`;
}
