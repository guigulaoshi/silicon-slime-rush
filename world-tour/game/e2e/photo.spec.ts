import { evidencePath } from './evidence';
import { expect, test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
const out = evidencePath(process.env.PHOTO_EVIDENCE_ID ?? 'photo');

test('pause countdown, take each driver photo, then resume the same countdown and race', async ({page}) => {
  mkdirSync(out, {recursive: true});
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(async () => {
    await window.game.startRace({trackId: 'synth-loop', car: 'sedan', ai: false, slimeDensity: 'normal', playerVehicles:['micro-hatch', 'city-pod']});
  });
  await page.locator('[data-screen=intro] .departure-go').click(); await page.keyboard.press('Escape');
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('paused');
  const countdown = await page.evaluate(() => (window.game as any).countdown);
  const position = await page.evaluate(() => window.game.report().posX);
  await page.locator('[data-action=photo]').click();
  const canvas = page.locator('#app canvas').first();
  const box = (await canvas.boundingBox())!;
  const beforeDrag = await page.evaluate(() => window.game.session.world.cameras[0]!.position.toArray());
  await page.mouse.move(box.x + box.width * .35, box.y + box.height * .40);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * .67, box.y + box.height * .62, {steps: 9});
  await page.mouse.up();
  expect(await page.evaluate(() => window.game.session.world.cameras[0]!.position.toArray())).not.toEqual(beforeDrag);
  await page.screenshot({path: resolve(out, 'desktop-free-orbit.png')});
  await page.locator('[data-photo=zoom]').focus();
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('Enter');
  await expect(page.locator('.share-dialog')).not.toBeVisible();
  await page.screenshot({path: resolve(out, 'desktop-orbit.png')});
  for (const player of [1, 2]) {
    await page.locator('[data-photo=capture]').click();
    await expect(page.locator('[data-share=save]')).toBeEnabled();
    const download = page.waitForEvent('download'); await page.locator('[data-share=save]').click();
    await (await download).saveAs(resolve(out, 'driver-' + player + '.png'));
    await page.locator('[data-share=close]').click();
    if (player === 1) { await page.locator('[data-photo=player]').click(); await page.locator('[data-photo=zoom]').focus(); await page.keyboard.press('Home'); }
  }
  expect(await page.evaluate(() => (window.game as any).countdown)).toBe(countdown);
  expect(await page.evaluate(() => window.game.report().posX)).toBe(position);
  await page.locator('[data-photo=close]').click(); await page.locator('[data-action=resume]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout: 15_000}).toBe('racing');
});

test('phone photo controls and saving work while the race stays frozen', async ({browser}) => {
  mkdirSync(out, {recursive: true});
  const context = await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,locale:'zh-CN'});
  const page = await context.newPage();
  await page.goto('/?dev=1'); await page.waitForFunction(() => window.game);
  await page.evaluate(async () => { await window.game.startRace({trackId:'synth-p2p',car:'sedan',ai:false,slimeDensity:'normal'}); });
  await page.locator('.departure-pause').click();
  await page.locator('[data-action=photo]').click();
  await page.locator('[data-photo=close]').click();
  await page.locator('[data-action=resume]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase)).toBe('intro');
  await page.locator('[data-screen=intro] .departure-go').click();
  await expect.poll(() => page.evaluate(() => window.game.report().phase), {timeout:15_000}).toBe('racing');
  await page.locator('.hud-pause').click();
  const time = await page.evaluate(() => window.game.report().time);
  await page.locator('[data-action=photo]').click();
  const canvas = page.locator('#app canvas').first(); const box = (await canvas.boundingBox())!;
  const beforeTouch = await page.evaluate(() => window.game.session.world.cameras[0]!.position.toArray());
  const cdp = await context.newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{x:box.x+box.width*.35,y:box.y+box.height*.42}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{x:box.x+box.width*.68,y:box.y+box.height*.65}]});
  await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
  expect(await page.evaluate(() => window.game.session.world.cameras[0]!.position.toArray())).not.toEqual(beforeTouch);
  await page.screenshot({path:resolve(out,'phone-free-orbit.png')});
  await page.locator('[data-photo=zoom]').tap({position:{x:8,y:8}});
  await page.screenshot({path:resolve(out,'phone-orbit.png')});
  await page.locator('[data-photo=capture]').click();
  await expect(page.locator('[data-share=save]')).toBeEnabled();
  const download=page.waitForEvent('download'); await page.locator('[data-share=save]').click();
  await (await download).saveAs(resolve(out,'phone-photo.png'));
  expect(await page.evaluate(() => window.game.report().time)).toBe(time);
  await page.locator('[data-share=close]').click(); await page.locator('[data-photo=close]').click();
  await expect(page.locator('[data-screen=pause]')).toBeVisible();
  await page.locator('[data-action=resume]').click();
  await expect.poll(() => page.evaluate(() => window.game.report().time)).toBeGreaterThan(time);
  await context.close();
});
