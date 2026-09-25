import { expect, test } from '@playwright/test';

// The two-sided language switch is wider than the old one-word button; the Settings / About
// links beside it in the route-flow header must stay clear of it in both languages and on phones.
test.describe.configure({ timeout: 90_000 });
for (const [label, viewport] of [['desktop', { width: 1440, height: 900 }], ['phone', { width: 844, height: 390 }]] as const)
  for (const language of ['en', 'zh'] as const)
    test(`header links stay clear of the language switch on ${label} in ${language}`, async ({ page }) => {
      await page.setViewportSize(viewport);
      await page.addInitScript(language => localStorage.setItem('silicon-rush-world-tour.save.v1',
        JSON.stringify({ language, muted: true, reducedMotion: true })), language);
      await page.goto('/?dev=1'); await page.locator('.home-go').click();
      const toggle = page.locator('.sm-stage > .lang-toggle');
      await expect(toggle).toBeVisible();
      const boxes = await page.evaluate(() => {
        const rect = (node: Element) => { const r = node.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; };
        return { toggle: rect(document.querySelector('.sm-stage > .lang-toggle')!),
          links: [...document.querySelectorAll('.sm-extras button')].filter(b => (b as HTMLElement).offsetParent).map(b => ({ text: b.textContent, ...rect(b) })) };
      });
      expect(boxes.links.length).toBeGreaterThan(0);
      for (const link of boxes.links) {
        const overlaps = link.right > boxes.toggle.left && link.left < boxes.toggle.right
          && link.bottom > boxes.toggle.top && link.top < boxes.toggle.bottom;
        expect(overlaps, JSON.stringify({ link, toggle: boxes.toggle })).toBe(false);
      }
    });
