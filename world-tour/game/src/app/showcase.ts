/**
 * The home page's orbit, shared with the check that aims it: which route, where along it,
 * and the picture that stands in until the live scene is up. One owner, because the route's name was
 * written in five places and a remix renames it.
 */

/** Sydney: the camera circles above the Harbour Bridge's deck with the arch and the Opera House in turn. */
export const SHOWCASE_TRACK = 'sydney';
/**
 * Where along that route the camera circles: the middle of the arch, not the approach at the start --
 * 109 m south of the bridge landmark's centre, as before the route moved (the start moved 310 m
 * south and the route grew to 3274 m, so 0.2 of it had left the bridge).
 */
export const SHOWCASE_AT = .096;
/** The shipped frame of that orbit (written by e2e/home-picture.spec.ts). */
export const SHOWCASE_IMAGE = './home/showcase.webp';

/**
 * Radians per second the camera circles. Negative:
 * the view turns left, so what is on the left of the picture comes into its middle.
 */
export const SHOWCASE_SPIN = -.06;

/**
 * Where the orbit starts: east of the bridge facing west
 * along the harbour, the arch side-on across the picture with its south pylons on the left and no towers yet.
 * Turning left brings the span's city end to the middle about 9 s in and the city's towers in behind it about
 * 5 s later; the Opera House follows. Measured every 5 degrees round the orbit: the skyline is only
 * out of the open picture while the camera looks north-west to west, and 10 degrees is where the arch fills it.
 * The eye is at (cos, sin) of this angle round the orbit centre, x east and z south.
 */
export const SHOWCASE_START_ANGLE = 10 * Math.PI / 180;
