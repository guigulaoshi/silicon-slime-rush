import { evidencePath } from './evidence';
import {expect,test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';

test.describe.configure({timeout:120_000});
for(const mobile of [false,true]) test.describe(mobile?'touch':'desktop',()=>{
  test.use({isMobile:mobile,hasTouch:mobile,viewport:mobile?{width:844,height:390}:{width:1280,height:720}});
  test('selects reverse before departure and keeps the direction on the intro',async({page})=>{
    const out=evidencePath('reverse');mkdirSync(out,{recursive:true});
    await page.goto('/?dev=1');
    await page.locator('.home-go').click();
    await page.locator('.sm-item').filter({hasText:'Synthetic Sprint'}).click();
    await page.locator('.sm-go').click();
   
    await page.locator('[data-direction=reverse]').click();
    await expect(page.locator('[data-direction=reverse]')).toHaveClass(/on/);
    await expect(page.locator('.sm-world-preview')).toHaveAttribute('data-world-direction','reverse');
    await expect(page.locator('.sm-direction-cue')).toHaveCount(0);
    await page.screenshot({animations:'disabled',path:resolve(out,mobile?'touch-conditions.png':'desktop-conditions.png')});
    await page.locator('.sm-go').click(); await page.locator('.sm-go').click();
    await page.waitForFunction(() => ['countdown','racing'].includes(window.game.report().phase));
    expect(await page.evaluate(()=>window.game.report().direction)).toBe('reverse');
    await page.screenshot({animations:'disabled',path:resolve(out,mobile?'touch-intro.png':'desktop-intro.png')});
  });
});
