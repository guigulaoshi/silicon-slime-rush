import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const out = evidencePath('about');
for (const language of ['en', 'zh']) test(`about credits and return in ${language}`, async ({page}) => {
  mkdirSync(out, {recursive: true});
  if (language === 'zh') await page.setViewportSize({width: 844, height: 390});
  await page.addInitScript(language => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({language})), language);
  await page.goto('/'); await page.waitForFunction(() => window.game);
  await page.locator('.home-go').click();
  await page.locator('.sm-extras button').last().click();
  const about = page.locator('[data-screen=about]'); await expect(about).toBeVisible();
  await expect(about).toContainText('guigulaoshi');
  await about.locator('.panel').evaluate(async node => { await Promise.all(node.getAnimations().map(animation => animation.finished)); });
  // The release version, with no commit revision behind it.
  // The release version and no commit revision. A build from a dirty tree -- any local run --
  // adds its own "includes local changes"; a release never does.
  await expect(about.locator('.about-version')).toHaveText(/^(Version|版本) \d+\.\d+( · (includes local changes|含本地改动))?$/);
  const close = about.locator('.about-close');
  await expect(close).toBeVisible();
  await expect(close).toHaveAccessibleName(language === 'zh' ? '关闭' : 'Close');
  // Five source links plus the creator's eight accounts, each opening its own tab.
  const socials = about.locator('.about-social');
  await expect(socials).toHaveCount(8);
  await expect(socials.first()).toHaveAttribute('href', 'https://guigulaoshi.itch.io/');
  for (const target of await socials.evaluateAll(links => links.map(link => (link as HTMLAnchorElement).target))) expect(target).toBe('_blank');
  expect(await about.locator('a').count()).toBe(13);
  const notices = await page.request.get('/credits.txt'); expect(notices.ok()).toBe(true);
  const text = await notices.text();
  for (const required of ['three', 'Apache License', 'SIL OPEN FONT LICENSE', 'OpenStreetMap']) expect(text).toContain(required);
  await page.screenshot({path: resolve(out, `${language}-top.png`)});
  const back = about.locator('.about-actions button').first(); await back.scrollIntoViewIfNeeded();
  await page.screenshot({path: resolve(out, `${language}-bottom.png`)});
  await close.click(); expect(await page.evaluate(() => window.game.report().phase)).toBe('menu');
});
