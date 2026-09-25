/** Device identity, not viewport width: a narrow desktop window is still a desktop. */
export function isMobileDevice(
  nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator,
  coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false,
  hover = window.matchMedia?.('(hover: hover)').matches ?? true,
): boolean {
  return /Android|iPhone|iPad|iPod/i.test(nav.userAgent)
    || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
    || (coarse && !hover && nav.maxTouchPoints > 0);
}

/**
 * Safari's engine (every iPhone and iPad browser) steers with two hold buttons, not the drag
 * stick. On the player's iPad mini the drag stick worked on a local copy of itch's page but not on the
 * real itch.io page, fullscreen or not, while the press-and-hold brake always worked
 *IPadOS Safari says it is a Mac, so
 * a Mac with more than one touch point counts too. Android keeps the drag stick.
 */
export function steersWithButtons(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator): boolean {
  return isAppleTouchDevice(nav);
}

/** iPhone, iPod or iPad, including iPadOS Safari that reports itself as a Mac but has touch points. */
export function isAppleTouchDevice(nav: Pick<Navigator, 'userAgent' | 'platform' | 'maxTouchPoints'> = navigator): boolean {
  return /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
}
