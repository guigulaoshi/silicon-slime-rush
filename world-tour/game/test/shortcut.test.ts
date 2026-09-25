import { expect, it } from 'vitest';
import { shortcutGuide } from '../src/ui/HomeShortcut';
it.each([
 ['iPhone Safari', 'iPhone', 1, 'safari'],
 ['Macintosh Safari', 'MacIntel', 5, 'safari'],
 ['iPhone CriOS Safari', 'iPhone', 1, 'embedded'],
 ['Android Chrome', 'Linux', 1, 'chrome'],
 ['Android Chrome MicroMessenger', 'Linux', 1, 'embedded'],
 ['Android Chrome aweme', 'Linux', 1, 'embedded'],
 ['Android SamsungBrowser Chrome', 'Linux', 1, 'embedded'],
 ['Windows Chrome', 'Win32', 0, 'desktop'],
])('shows the correct browser steps for %s', (userAgent, platform, maxTouchPoints, guide) => {
 expect(shortcutGuide({userAgent, platform, maxTouchPoints})).toBe(`shortcut.${guide}`);
});
