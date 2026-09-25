import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const out = evidencePath('support');
const configuredUrl = process.env.VITE_PUBLIC_GAME_URL;

test('configured public page opens and copies without resuming the paused drive', async ({page, context}) => {
 test.skip(!configuredUrl, 'run with a candidate VITE_PUBLIC_GAME_URL before release');
 page.setDefaultTimeout(15_000);
 mkdirSync(out, {recursive: true});
 await context.grantPermissions(['clipboard-read', 'clipboard-write']);
 await context.route(configuredUrl!, route => route.fulfill({contentType: 'text/html', body: 'itch.io game page'}));
 await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
 await page.evaluate(() => window.game.startRace({trackId:'synth-p2p',car:'sedan',slimeDensity:'normal',ai:false}));
 await page.locator('[data-screen=intro] .departure-go').click();
 await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout:15000}).toBe('racing');
 await page.keyboard.press('Escape');
 // One press opens the page -- no dialog -- and the coffee card opens its /purchase tip page.
 // "More Games" opens the author's profile, not this game's own page.
 await context.route(`${configuredUrl!.replace(/\/$/, '')}/purchase`, route => route.fulfill({contentType: 'text/html', body: 'itch.io purchase page'}));
 await context.route(new URL('/', configuredUrl!).href, route => route.fulfill({contentType: 'text/html', body: 'itch.io author profile'}));
 for (const [action, body] of [['homepage', 'itch.io author profile'], ['coffee', 'itch.io purchase page']] as const) {
  const opened = page.waitForEvent('popup');
  await page.locator(`[data-screen=pause] [data-action=${action}]`).click();
  const popup = await opened; await expect(popup.locator('body')).toContainText(body); await popup.close();
  await expect(page.locator('dialog[open]')).toHaveCount(0);
  expect(await page.evaluate(() => window.game.report().phase)).toBe('paused');
 }
 await page.locator('[data-screen=pause] [data-action=settings]').click();
 await page.locator('[data-screen=settings] [data-setting=shortcut]').click();
 await expect(page.locator('.shortcut-dialog a')).toHaveAttribute('href', configuredUrl!);
 await page.locator('.shortcut-dialog').getByRole('button', {name:'Copy game link', exact:true}).click();
 await expect(page.locator('.shortcut-dialog [role=status]')).toContainText('copied');
 expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(configuredUrl);
 await page.locator('.shortcut-dialog button').last().click();
 expect(await page.evaluate(() => window.game.report().phase)).toBe('settings');
 await page.screenshot({path:resolve(out,'configured-url-paused.png')});
});

test('shortcut modal never resumes the drive on combined gamepad buttons or dismissal', async ({page}) => {
 page.setDefaultTimeout(15_000);
 mkdirSync(out, {recursive: true});
 await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
 await page.evaluate(() => window.game.startRace({trackId:'synth-p2p',car:'sedan',slimeDensity:'normal',ai:false}));
 await page.locator('[data-screen=intro] .departure-go').click();
 await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout:15000}).toBe('racing');
 await page.keyboard.press('Escape');
 await expect(page.locator('[data-screen=pause]')).toBeVisible();
 await expect(page.locator('[data-screen=pause] .creator-links button:visible')).toHaveCount(2);
 await page.locator('[data-screen=pause] [data-action=settings]').click();
 await page.locator('[data-screen=settings] [data-setting=shortcut]').focus();
 await page.evaluate(() => Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[{connected:true,axes:[0,0],buttons:Array.from({length:16},(_,i)=>({pressed:i===0||i===1,value:i===0||i===1?1:0}))}]}));
 await expect(page.locator('.shortcut-dialog')).toBeVisible();
 await page.waitForTimeout(200);
 expect(await page.evaluate(() => window.game.report().phase)).toBe('settings');
 await expect(page.locator('.shortcut-dialog a')).toBeHidden();
 await page.screenshot({path:resolve(out,'desktop-shortcut.png')});
 await page.evaluate(() => Object.defineProperty(navigator,'getGamepads',{configurable:true,value:()=>[]}));
 await page.locator('.shortcut-dialog button').last().click();
 expect(await page.evaluate(() => window.game.report().phase)).toBe('settings');
 await page.locator('[data-screen=settings] [data-setting=shortcut]').click();
 await page.keyboard.press('Escape');
 await expect(page.locator('.shortcut-dialog')).toBeHidden();
 expect(await page.evaluate(() => window.game.report().phase)).toBe('settings');
 await page.screenshot({path:resolve(out,'pause-support.png')});
});
test('phone instructions fit and switch language without resuming', async ({browser}) => {
 mkdirSync(out,{recursive:true});
 const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,locale:'zh-CN',userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1'});
 const page=await context.newPage();
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 await page.evaluate(()=>window.game.startRace({trackId:'synth-p2p',car:'sedan',slimeDensity:'normal',ai:false}));
 await page.locator('[data-screen=intro] .departure-go').click();
 await expect.poll(()=>page.evaluate(()=>window.game.report().phase),{timeout:15000}).toBe('racing');
 await page.locator('.hud-pause').click();
 // Moved the price into the coffee line and dropped the itch.io subtitle.
 await expect(page.locator('[data-screen=pause] .creator-links')).toContainText('请作者喝 1/4 杯咖啡');
 await page.screenshot({path:resolve(out,'phone-pause.png')});
 await page.locator('[data-screen=pause] [data-action=settings]').click();
 await page.locator('[data-screen=settings] [data-setting=shortcut]').click();
 await expect(page.locator('.shortcut-dialog')).toContainText('Safari');
 await page.screenshot({path:resolve(out,'phone-shortcut-zh.png')});
 await page.locator('.shortcut-dialog').getByRole('button',{name:'English',exact:true}).click();
 await expect(page.locator('.shortcut-dialog')).toContainText('Add to Home Screen');
 await page.locator('.shortcut-dialog button').last().click();
 expect(await page.evaluate(()=>window.game.report().phase)).toBe('settings');
 await context.close();
});
