import { evidencePath } from './evidence';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect, test} from '@playwright/test';

// Real multi-finger browser input, actual acceleration/braking, pause and focus-loss cleanup.
test.describe.configure({timeout:120_000});
const out = evidencePath('phone-stick');

// Replaced the ◀ ▶ buttons with a floating left/right stick on the lower-left half.
test.describe('phone stick', () => {
  test.use({isMobile:true, hasTouch:true, viewport:{width:844,height:390}});
  for (const lang of ['en', 'zh']) test(`steers by dragging and brakes with a second finger in ${lang}`, async ({page}) => {
    page.on('pageerror', error => { throw error; });
    await page.addInitScript(language => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version:3, language, muted:true, quality:'high', slimeDensity:'none', best:{},
    })), lang);
    await page.goto('/?track=shoreline&time=day');
    await page.waitForFunction(() => window.game?.report().phase === 'intro');
    await expect(page.locator('.first-drive-tip')).toBeHidden();
    await page.locator('[data-screen="intro"] button').first().tap();
    // First phone races: the countdown plays the drag-to-steer hint, and it is gone at the start.
    await page.waitForFunction(() => window.game.report().phase === 'countdown');
    const guide = page.locator('.touch-guide');
    await expect(guide).toBeVisible();
    await expect(guide).toHaveText(new RegExp(lang === 'en' ? 'Drag to steer' : '拖动转向'));
    mkdirSync(out,{recursive:true}); await page.screenshot({path:resolve(out,`${lang}-countdown-guide.png`)});
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    await expect(guide).toBeHidden();
    const stick = page.locator('.touch-stick'), zone = page.locator('[data-touch-control="steer"]');
    const brake = page.locator('[data-touch-control="brake"]');
    await expect(stick).toBeVisible(); await expect(brake).toHaveText(lang === 'en' ? 'Brake' : '刹车');
    const zoneBox = (await zone.boundingBox())!, brakeBox = (await brake.boundingBox())!;
    expect(zoneBox.x).toBeLessThanOrEqual(0); expect(zoneBox.width).toBeGreaterThanOrEqual(844 / 2 - 80);   // stops short of the centred language button
    expect(brakeBox.x).toBeGreaterThan(844 / 2); expect(brakeBox.width).toBeGreaterThanOrEqual(100);
    // The drawn pedal rests up and in from the home-swipe corner, inside a wider brake zone,
    // and the time and score have left the top centre, where the road meets the horizon.
    const pedalBox = (await page.locator('.touch-brake').boundingBox())!;
    expect(390 - (pedalBox.y + pedalBox.height)).toBeGreaterThanOrEqual(40);
    expect(844 - (pedalBox.x + pedalBox.width)).toBeGreaterThanOrEqual(24);
    expect(brakeBox.width * brakeBox.height).toBeGreaterThan(pedalBox.width * pedalBox.height * 3);
    expect(390 - (await stick.boundingBox())!.y).toBeGreaterThanOrEqual(90);
    /* */
    const boardBox = (await page.locator('#hud .hud-scoreboard').boundingBox())!;
    expect(boardBox.x + boardBox.width, 'scoreboard stays left of the top centre').toBeLessThan(844 / 2);
    // Nothing sits on the speedometer any more.
    await expect(page.locator('.touch-camera')).toHaveCount(0);
    const speedBox = (await page.locator('.hud-speed').first().boundingBox())!;
    const overSpeed = await page.evaluate(({x, y}) => [...document.querySelectorAll('[data-touch-control]')]
      .some(node => { const b = node.getBoundingClientRect(); return b.width > 0 && b.left < x.r && b.right > x.l && b.top < y.b && b.bottom > y.t; }),
      {x: {l: speedBox.x, r: speedBox.x + speedBox.width}, y: {t: speedBox.y, b: speedBox.y + speedBox.height}});
    expect(overSpeed, 'no touch control covers the speedometer').toBe(false);
    await page.screenshot({path:resolve(out,`${lang}-resting.png`)});
    await page.waitForFunction(() => window.game.report().speedKmh > 40);
    const cdp = await page.context().newCDPSession(page);
    const thumb = {id:1, x:260, y:300, radiusX:5, radiusY:5, force:1};
    // Centre of the zone, which is off the drawn pedal: a thumb that misses the pedal still brakes.
    const brakeFinger = {id:2, x:brakeBox.x + brakeBox.width / 2, y:brakeBox.y + brakeBox.height / 2, radiusX:5, radiusY:5, force:1};
    expect(brakeFinger.x < pedalBox.x || brakeFinger.y < pedalBox.y).toBe(true);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[thumb]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{...thumb, x:thumb.x - 40}]});
    await page.waitForFunction(() => window.game.report().input.steer < -.3 && window.game.report().input.steer > -.7);
    const half = await page.evaluate(() => window.game.report().input.steer);
    // the bar sits under the finger, not at its resting place
    const stickBox = (await stick.boundingBox())!;
    expect(Math.abs(stickBox.x + stickBox.width / 2 - thumb.x)).toBeLessThan(4);
    await expect(stick).toHaveAttribute('data-held', 'true');
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{...thumb, x:thumb.x + 420}]});
    await page.waitForFunction(() => window.game.report().input.steer === 1);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[{...thumb, x:thumb.x + 420}, brakeFinger]});
    await page.waitForFunction(() => window.game.report().input.brake === 1 && window.game.report().input.steer === 1);
    expect((await page.evaluate(() => window.game.report())).input.throttle).toBe(0);
    await page.screenshot({path:resolve(out,`${lang}-drag-and-brake.png`)});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd', touchPoints:[]});
    await page.waitForFunction(() => window.game.report().input.brake === 0 && window.game.report().input.steer === 0);
    await expect(stick).toHaveAttribute('data-held', 'false');
    await expect(page.locator('[data-touch-control][data-held]')).toHaveCount(0);
    // Pause while a finger holds the stick clears it.
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart', touchPoints:[thumb]});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchMove', touchPoints:[{...thumb, x:thumb.x + 60}]});
    await page.waitForFunction(() => window.game.report().input.steer > .5);
    await page.locator('.hud-pause').click();
    await page.waitForFunction(() => window.game.report().phase === 'paused');
    expect((await page.evaluate(() => window.game.report())).input).toMatchObject({brake:0,steer:0});
    await cdp.send('Input.dispatchTouchEvent', {type:'touchEnd',touchPoints:[]});
    await page.locator('[data-screen="pause"] [data-action="resume"]').tap();
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    await cdp.send('Input.dispatchTouchEvent', {type:'touchStart',touchPoints:[brakeFinger]});
    await page.waitForFunction(() => window.game.report().input.brake === 1);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await page.waitForFunction(() => window.game.report().input.brake === 0 && window.game.report().input.steer === 0);
    await cdp.send('Input.dispatchTouchEvent', {type:'touchCancel',touchPoints:[]});
    await page.waitForFunction(() => window.game.report().input.throttle === 1);
    writeFileSync(resolve(out,`${lang}.json`),JSON.stringify({half,after:await page.evaluate(()=>window.game.report())},null,2));
    await cdp.detach();
  });

  test('the countdown hint stops after the first three phone races', async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version:3, language:'en', muted:true, quality:'high', slimeDensity:'none', best:{}, touchGuideRaces:2,
    })));
    await page.goto('/?track=shoreline&time=day');
    await page.waitForFunction(() => window.game?.report().phase === 'intro');
    await page.locator('[data-screen="intro"] button').first().tap();
    await page.waitForFunction(() => window.game.report().phase === 'countdown');
    await expect(page.locator('.touch-guide')).toBeVisible();
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('silicon-rush.save.v1')!).touchGuideRaces);
    expect(saved).toBe(3);
    await page.reload();
    await page.waitForFunction(() => window.game?.report().phase === 'intro');
    await page.locator('[data-screen="intro"] button').first().tap();
    await page.waitForFunction(() => window.game.report().phase === 'countdown');
    await expect(page.locator('.touch-guide')).toBeHidden();
  });

  test('a driver who has not touched the stick and drifts to the edge is reminded once', async ({page}) => {
    await page.addInitScript(() => localStorage.setItem('silicon-rush.save.v1', JSON.stringify({
      version:3, language:'zh', muted:true, quality:'high', slimeDensity:'none', best:{}, touchGuideRaces:3,
    })));
    await page.goto('/?track=shoreline&time=day');
    await page.waitForFunction(() => window.game?.report().phase === 'intro');
    await page.locator('[data-screen="intro"] button').first().tap();
    await page.waitForFunction(() => window.game.report().phase === 'racing');
    const guide = page.locator('.touch-guide');
    await expect(guide).toBeHidden();
    await page.waitForTimeout(5400);
    await expect(guide).toBeHidden();                 // idle alone is not enough
    await page.evaluate(() => {
      const s = (window.game as any).session, race = s.humans[0].race, spline = race.spline;
      const at = race.progress.value.index, p = spline.point(at), t = spline.tangent(at);
      const edge = (spline.halfWidth[at] ?? 4) - .6, right = [-t[2], 0, t[0]];
      s.car.reset([p[0] + right[0] * edge, p[1] + .6, p[2] + right[2] * edge], Math.atan2(-t[0], -t[2]));
      s.car.body.setLinvel({ x: t[0] * 8, y: 0, z: t[2] * 8 }, true);
    });
    await expect(guide).toBeVisible();
    await expect(guide).toHaveAttribute('data-kind', 'reminder');
    mkdirSync(out,{recursive:true}); await page.screenshot({path:resolve(out,'zh-reminder.png')});
    await expect(guide).toBeHidden({timeout: 4000});
  });
});

test('desktop driving keeps its keyboard controls without mobile buttons or automatic throttle', async ({page}) => {
  await page.goto('/?track=shoreline&time=day');
  await page.waitForFunction(() => window.game?.report().phase === 'intro');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => window.game.report().phase === 'racing');
  await expect(page.locator('.touch-controls')).toBeHidden();
  expect((await page.evaluate(() => window.game.report())).input.throttle).toBe(0);
  await page.keyboard.down('KeyW'); await page.keyboard.down('KeyA');
  await page.waitForFunction(() => window.game.report().input.throttle === 1 && window.game.report().input.steer < -.2);
  await page.keyboard.up('KeyA'); await page.keyboard.up('KeyW');
  await page.waitForFunction(() => window.game.report().input.throttle === 0 && window.game.report().input.steer === 0);
});
