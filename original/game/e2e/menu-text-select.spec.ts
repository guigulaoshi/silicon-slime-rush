import { expect, test, type Page } from '@playwright/test';

// A long press on the phone home screen's copy selected a word, and Chrome's text toolbar
// then covered "Choose a route". Menu text is not selectable; typed fields still are.
test.describe.configure({ timeout: 120_000 });

async function longPress(page: Page, selector: string) {
  const box = (await page.locator(selector).first().boundingBox())!;
  const cdp = await page.context().newCDPSession(page);
  const point = { x: box.x + Math.min(40, box.width / 2), y: box.y + box.height / 2, radiusX: 5, radiusY: 5, force: 1 };
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
  await page.waitForTimeout(1200);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
}

test.describe('phone menu text', () => {
  test.use({ isMobile: true, hasTouch: true, viewport: { width: 891, height: 411 } });
  test('a long press or a double tap on the home copy selects nothing', async ({ page }) => {
    page.on('pageerror', error => { throw error; });
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version: 3, language: 'en', muted: true, quality: 'high', slimeDensity: 'none', best: {},
    })));
    await page.goto('/');
    await page.locator('.home-go').waitFor({ state: 'visible' });
    for (const selector of ['.home-story', '.home-slogan', '.home-place', '.home-promise']) {
      await longPress(page, selector);
      expect(await page.evaluate(() => getSelection()?.toString() ?? ''), `${selector} long press`).toBe('');
      await page.locator(selector).first().dblclick();
      expect(await page.evaluate(() => getSelection()?.toString() ?? ''), `${selector} double click`).toBe('');
    }
    // What a browser reads to decide whether to offer selection at all.
    const styles = await page.evaluate(() => ['.home-story', '.home-slogan'].map(s => getComputedStyle(document.querySelector(s)!).userSelect));
    expect(styles).toEqual(['none', 'none']);
    // Typed fields (the player name, the share text a player copies by hand) stay selectable.
    const typed = await page.evaluate(() => {
      const ui = document.getElementById('ui')!, area = document.createElement('textarea'), input = document.createElement('input');
      area.value = 'Silicon Slime Rush'; ui.append(area, input);
      area.select();
      const result = [getComputedStyle(area).userSelect, getComputedStyle(input).userSelect, String(area.selectionEnd - area.selectionStart)];
      area.remove(); input.remove();
      return result;
    });
    expect(typed).toEqual(['text', 'text', '18']);
  });
});
