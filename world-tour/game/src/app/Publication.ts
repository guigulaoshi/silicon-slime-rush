/** The release build supplies this only after its public itch.io page has been verified. */
export function publicGameUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && /^[a-z0-9-]+\.itch\.io$/.test(url.hostname)
      && /^\/[a-z0-9-]+\/?$/.test(url.pathname) && !url.search && !url.hash && !url.username && !url.password
      ? url.href : null;
  } catch { return null; }
}
export const PUBLIC_GAME_URL = publicGameUrl(import.meta.env?.VITE_PUBLIC_GAME_URL);

/**
 * The page publishes to. Only shared pictures print it, and only while the release build
 * has no verified address of its own -- check it again before 1.0 ships.
 */
/** The hosting origin as a base for relative addresses: https only, with its trailing slash; null otherwise. */
export function assetOriginBase(assetOrigin: unknown): string | null {
  if (typeof assetOrigin !== 'string' || !assetOrigin) return null;
  try {
    const origin = new URL(assetOrigin);
    return origin.protocol === 'https:' ? (origin.href.endsWith('/') ? origin.href : `${origin.href}/`) : null;
  } catch { return null; }
}

export const PLANNED_GAME_URL = 'https://guigulaoshi.itch.io/silicon-slime-rush-world-tour';

/** The address a shared picture carries, scheme-less as a reader would type it off the image. */
export function watermarkAddress(home: string | null = PUBLIC_GAME_URL): string {
  return (home ?? PLANNED_GAME_URL).replace(/^https:\/\//, '').replace(/\/$/, '');
}

/** itch.io's own pay/tip page for a project, derived from its verified page. */
export function supportUrl(home: string | null): string | null {
  return home ? new URL('purchase', home.endsWith('/') ? home : `${home}/`).href : null;
}

/** The author's itch.io profile, which lists every game, derived from the verified game page (no second address). */
export function creatorProfileUrl(home: string | null): string | null {
  return home ? new URL('/', home).href : null;
}

/* */
export function creatorLinkUrl(kind: 'homepage' | 'coffee', home: string | null = PUBLIC_GAME_URL): string | null {
  return kind === 'coffee' ? supportUrl(home) : creatorProfileUrl(home);
}

/** Every saved picture and clip starts with the game's own name (a remix renames it here, once). */
export const SHARE_FILE_STEM = 'silicon-slime-rush-world-tour';
