/**
 * Does the map data in front of the player actually match the game asking for it?
 *
 * we opened the game and found a car floating in a blue sky: the HUD, the clock and
 * the minimap were all fine, and there was no road, no building and not one word about why. The
 * cause was a tracked `track.json` next to build products that are not tracked -- a git fast-forward
 * had handed one tree a new index and left it the old data -- and both fallbacks behaved
 * impeccably: the streamer retried three times and gave up, the material library kept the greybox
 * palette. Two polite silences add up to a blue sky.
 *
 * `tools/assets.py` is the fix: nothing runs until the products match the code that wrote
 * them. This is the net under it, and a net that never catches anything is exactly what it should
 * be. It is deliberately dumb -- it reads two numbers the runtime already keeps and says one
 * sentence with the command in it.
 */
export interface WorldHealth {
  /** tiles the streamer gave up on, after its own retries */
  tilesFailed: number;
  /** tiles standing in the scene right now */
  tilesLoaded: number;
  /** textures actually applied, or null while the load is still in flight -- see below */
  texturesApplied: number | null;
}

/**
 * The i18n key to put on screen, or null when there is nothing to say.
 *
 * `tilesFailed` is already the count of tiles the streamer *gave up on* -- it retries three times
 * and only then counts one. So the threshold here is not about retries, it is about how many
 * separate tiles have to die before this is the data rather than one bad request: one 404 on an
 * edge tile is a hole a car drives past, three is a tree holding an index its files do not match.
 *
 * Textures are all-or-nothing -- the manifest either arrived or it did not -- but the load takes a
 * moment, and during that moment "nothing applied yet" and "nothing will ever apply" look
 * identical. Reporting then would flash「贴图没跟上」across a perfectly healthy boot, so the caller
 * passes null until the load settles and this says nothing while it does.
 */
export function staleAssetsKey(health: WorldHealth): string | null {
  if (health.tilesFailed >= 3) return 'hud.staleTiles';
  if (health.texturesApplied === 0 && health.tilesLoaded > 0) return 'hud.staleTextures';
  return null;
}

/**
 * The rebuild command, for the person who can run it and nobody else.
 *
 * The uploaded build carries no development details, and a hint to run
 * tools/assets.py is one. The sentence a player reads says what is wrong; a development build adds
 * what to run about it. `import.meta.env.DEV` is a constant in a production build, so the branch --
 * and the command inside it -- is not in the file that ships.
 */
export function devHint(text: string, fix: 'assets' | 'menu-map'): string {
  // The early return is what keeps the commands out of the build: with `DEV` folded to false, everything
  // below it is unreachable and the strings go with it. Passing a command in as an argument did not --
  // the constants stayed in the bundle for the call sites to hand over.
  if (!import.meta.env.DEV) return text;
  const command = fix === 'assets' ? 'python3 tools/assets.py ensure --all' : 'python -m sr.cli menu-map';
  return `${text} · ${command}`;
}
