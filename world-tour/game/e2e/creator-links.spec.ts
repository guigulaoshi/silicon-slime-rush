import { expect, test, type Page } from '@playwright/test';

// "More Games" and the one-sentence coffee link with its price sit side by side on the
// pause and results screens; each text stays inside its button (at most two lines, wrapped at a word, never
// through 咖啡), in both languages on desktop and phone-landscape frames.
test.describe.configure({ timeout: 120_000 });

async function lines(page: Page) {
  return page.locator('.replica-screen:visible .creator-links').evaluate(group => {
    const [home, coffee] = [...group.children] as HTMLElement[];
    const box = (el: Element) => el.getBoundingClientRect();
    const words = (el: HTMLElement) => {
      const text = el.querySelector('strong')!, node = text.firstChild!, value = node.textContent ?? '';
      const at = value.indexOf('咖啡');
      if (at < 0) return true;
      const range = document.createRange();
      const top = (i: number) => { range.setStart(node, i); range.setEnd(node, i + 1); return range.getBoundingClientRect().top; };
      return Math.abs(top(at) - top(at + 1)) < 2;
    };
    return [home!, coffee!].map(button => {
      const text = button.querySelector('strong') as HTMLElement, b = box(button), t = box(text);
      return { text: text.textContent, lines: Math.round(text.offsetHeight / parseFloat(getComputedStyle(text).lineHeight)),
        inside: t.left >= b.left - 1 && t.right <= b.right + 1 && t.top >= b.top - 1 && t.bottom <= b.bottom + 1
          && text.scrollWidth <= text.clientWidth + 1,
        wordKept: words(button), top: b.top, left: b.left, right: b.right };
    });
  });
}

for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 844, height: 390 }]] as const)
  for (const language of ['en', 'zh'] as const)
    test(`creator links sit side by side and fit on the ${label} pause and results screens in ${language}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(language => localStorage.setItem('silicon-rush-world-tour.save.v1',
        JSON.stringify({ language, muted: true, reducedMotion: true })), language);
      await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
      expect(await page.evaluate(async () => {
        const g = window.game as any;
        // lhasa: a flat open route (game/public/tracks/lhasa/track.json), replacing shoreline;
        // this UI test only needs a race running behind the pause/results screens.
        const ready = await g.startRace({ trackId: 'lhasa', car: 'sedan', playerVehicles: ['micro-hatch'], ai: false,
          slimeDensity: 'none', timeOfDay: 'day' });
        if (ready) { g.session.racers.forEach((r: any) => r.race.start()); g.show('racing'); }
        return ready;
      })).toBe(true);
      await page.evaluate(() => (window.game as any).show('paused'));
      await expect(page.locator('.replica-screen:visible .coffee strong')).toBeVisible();
      const pause = await lines(page);
      await page.evaluate(() => {
        const g = window.game as any; g.show('racing');
        g.session.racers.forEach((r: any) => { r.race.state = 'finished'; r.race.time = 48; }); g.finish(48);
      });
      await expect(page.locator('.result-standing-name, .results-replica').first()).toBeVisible();
      const results = await lines(page);
      for (const [home, coffee] of [pause, results]) {
        expect(Math.abs(home!.top - coffee!.top), 'side by side').toBeLessThan(2);
        expect(home!.right, 'itch.io left of coffee').toBeLessThanOrEqual(coffee!.left);
        for (const line of [home!, coffee!]) {
          expect(line.inside, JSON.stringify(line)).toBe(true);
          expect(line.lines, JSON.stringify(line)).toBeLessThanOrEqual(2);
          expect(line.wordKept, JSON.stringify(line)).toBe(true);
        }
      }
    });
