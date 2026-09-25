import {test,expect} from '@playwright/test';

test('step transitions include departure and arrival, reduced motion keeps them still',async({page})=>{
 await page.goto('/?dev=1');await page.locator('.home-go').click();
 await page.locator('.sm-go').click();
 const animations=await page.locator('.sm-pane').evaluateAll(nodes=>nodes.flatMap(n=>n.getAnimations().map(a=>({duration:a.effect!.getTiming().duration,delay:a.effect!.getTiming().delay}))));
 expect(animations).toEqual(expect.arrayContaining([{duration:260,delay:0},{duration:390,delay:260}]));
 await expect(page.locator('.sm-pane[data-leaving]')).toHaveCount(0);
 await page.emulateMedia({reducedMotion:'reduce'});await page.locator('.sm-go').click();
 expect(await page.locator('.sm-pane').evaluateAll(nodes=>nodes.reduce((sum,n)=>sum+n.getAnimations().filter(a=>a.playState==='running').length,0))).toBe(0);
 await page.locator('.sm-back').click();
 await page.locator('button[data-direction=reverse]').click();await expect(page.locator('.sm-world-preview')).toHaveAttribute('data-world-direction','reverse');
 await page.locator('[data-weather=snow]').click();await expect(page.locator('.sm-world-shot')).toHaveAttribute('src',/snow.webp$/);

 await page.keyboard.press('ArrowDown');
 // Nothing is folded away any more; every condition is in the right-hand column.
 await expect(page.locator('.startup-world-more')).toHaveCount(0);
 await expect(page.locator('.sm-conditions [data-condition="start.departure"] button[data-direction=reverse]')).toBeVisible();
});
