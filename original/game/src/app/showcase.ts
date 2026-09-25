/** The home page's orbit around the Golden Gate, shared with the check that aims it. */

/**
 * Radians per second the camera circles. Negative:
 * the view turns left, so what is on the left of the picture comes into its middle.
 */
export const SHOWCASE_SPIN = -.06;

/**
 * Where the orbit starts. The camera sits north of the tower looking south, toward Golden Gate Park, with
 * the bridge's deck running into the Presidio on the left of the picture; turning left brings the bridge to
 * the middle and then San Francisco's skyline in.
 * The eye is at (cos, sin) of this angle round the tower, x east and z south, so it faces a compass
 * bearing of this angle less 90 degrees: 190. Measured, not guessed: e2e/home-skyline.spec.ts.
 */
export const SHOWCASE_START_ANGLE = 280 * Math.PI / 180;
