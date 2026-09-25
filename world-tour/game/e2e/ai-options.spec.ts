import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {VEHICLES} from '../src/vehicles/catalogue';

test.describe.configure({timeout:120_000});
const out=evidencePath('ai-options');
for(const option of ['none','relaxed','rush'] as const)test(`AI choice ${option} reaches the actual race`,async({page})=>{
 mkdirSync(out,{recursive:true});
 await page.addInitScript(()=>{if(!localStorage.getItem('silicon-rush-world-tour.save.v1'))localStorage.setItem('silicon-rush-world-tour.save.v1',JSON.stringify({language:'en',muted:true,reducedMotion:true}));});
 await page.goto('/?dev=1');await page.locator('.home-go').click();
 await page.locator('[data-track=synth-p2p]').click();await page.locator('.sm-go').click();
 await expect(page.locator('[data-ai-mode]')).toHaveCount(3);
 await expect(page.locator('[data-ai],[data-difficulty]')).toHaveCount(0);
 await page.locator(`[data-ai-mode=${option}]`).click();
 await expect(page.locator('[data-ai-mode][aria-pressed=true]')).toHaveAttribute('data-ai-mode',option);
 await expect.poll(()=>page.locator('.sm-world-shot').evaluate(n=>(n as HTMLImageElement).complete&&(n as HTMLImageElement).naturalWidth>0)).toBe(true);
 await page.screenshot({path:resolve(out,`desktop-en-${option}.png`)});
 await page.locator('.sm-go').click();
 await page.locator('[data-player="0"] [data-vehicle=sports-car]').click();await page.locator('.sm-go').click();
 await page.waitForFunction(()=>['countdown','racing'].includes(window.game.report().phase));
 const roster=await page.evaluate(()=>window.game.session.racers.map(r=>({role:r.role,difficulty:r.difficulty})));
 const ai=roster.filter(r=>r.role==='ai');expect(ai).toHaveLength(option==='none'?0:VEHICLES.length-1);
 expect(ai.every(r=>r.difficulty===option)).toBe(true);
 const choice=await page.evaluate(()=>window.game.report().choice);
 expect(choice).toMatchObject({ai:option!=='none',aiDifficulty:option==='none'?'relaxed':option});
 writeFileSync(resolve(out,`roster-${option}.json`),JSON.stringify({choice,roster},null,2));
 // Existing save fields reload into the same single selector; no save schema migration needed.
 await page.goto('/?dev=1');await page.locator('.home-go').click();await page.locator('.sm-go').click();
 await expect(page.locator('[data-ai-mode][aria-pressed=true]')).toHaveAttribute('data-ai-mode',option);
});
test('phone Chinese AI selector fits and retains three visible choices',async({browser})=>{
 const context=await browser.newContext({viewport:{width:844,height:390},isMobile:true,hasTouch:true,locale:'zh-CN'});
 try{
  const page=await context.newPage();await page.addInitScript(()=>localStorage.setItem('silicon-rush-world-tour.save.v1',JSON.stringify({language:'zh',muted:true,reducedMotion:true})));
  await page.goto('/');await page.locator('.home-go').tap();await page.locator('.sm-go').tap();
  const options=page.locator('[data-ai-mode]');await expect(options).toHaveText(['没有 AI','简单','困难']);
  for(const button of await options.all()){
   await expect(button).toBeVisible();await button.tap();
   const box=(await button.boundingBox())!;expect(box.x).toBeGreaterThanOrEqual(0);expect(box.x+box.width).toBeLessThanOrEqual(844);expect(box.y+box.height).toBeLessThanOrEqual(390);
  }
  await expect.poll(()=>page.locator('.sm-world-shot').evaluate(n=>(n as HTMLImageElement).complete&&(n as HTMLImageElement).naturalWidth>0)).toBe(true);
  await page.screenshot({path:resolve(out,'phone-zh-rush.png')});
 }finally{await context.close();}
});
