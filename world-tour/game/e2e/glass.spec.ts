import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {expectWorldLoaded} from './world';
import {mkdirSync} from 'node:fs';
import {VEHICLES,forTrack} from '../src/vehicles/catalogue';
import {evidencePath} from './evidence';
const stage=process.env.GLASS_CAPTURE==='before'?'before':'after';
const out=evidencePath('glass');
test.describe.configure({timeout:180_000});
const shaderErrors:string[]=[];
test.beforeEach(async({page})=>{
 shaderErrors.length=0;
 page.on('pageerror',error=>shaderErrors.push(error.message));
 page.on('console',message=>{if(message.type()==='error' && /WebGLProgram|shader|VALIDATE_STATUS/.test(message.text()))shaderErrors.push(message.text());});
});
test.afterEach(()=>expect(shaderErrors).toEqual([]));
test('all nine garage cars show the same fixed glass viewpoints',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:1440,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('silicon-rush-world-tour.save.v1',JSON.stringify({language:'en',muted:true})));
 await page.goto('/');await page.locator('.home-go').click();
 await page.locator('.sm-go').click();await page.locator('.sm-go').click();
 const hero=page.locator('.sm-carhero');
 // A route with its own car shows it in that car's slot (the button keeps the slot's id).
 const track=(await page.locator('.sm-item.sel').getAttribute('data-track'))!;
 for(const vehicle of VEHICLES){
  await page.locator(`[data-player="0"] [data-vehicle="${vehicle.id}"]`).click();
  await expect(hero).toHaveAttribute('data-model-vehicle',forTrack(vehicle,track).id);await expect(hero).toHaveAttribute('data-state','ready');
  await hero.screenshot({path:resolve(out,`${stage}-garage-${vehicle.id}.png`)});
 }
 expect(VEHICLES).toHaveLength(9);
});
test('glass remains reflective in the chase view and after changing render quality',async({page})=>{
 await page.setViewportSize({width:1440,height:900});
 await page.goto('/?track=lhasa&bot=1&dev=1&time=day&vehicle=micro-hatch&slimes=none');
 await page.waitForFunction(()=>window.game);
 await page.evaluate(async()=>{const g=window.game as any;g.save.useForSession({slimeDensity:'none'});await g.autoRun('lhasa','day','micro-hatch');});
 await page.waitForFunction(()=>window.game?.report().phase==='racing');
 await expectWorldLoaded(page,'chase glass');
 const start=await page.evaluate(()=>window.game.report().progress);
 await page.waitForFunction(start=>{const r=window.game.report(),travelled=(r.progress-start+r.length)%r.length;return travelled>25&&travelled<r.length/2;},start,{timeout:40_000});
 await page.screenshot({path:resolve(out,'after-chase-micro-hatch.png')});
 const result=await page.evaluate(()=>{
  const w=window.game.session.world;const before=w.scene.environment!;
  const renderer=w.renderer;let disposed=false;(w as any).reflection.addEventListener('dispose',()=>{disposed=true;});
  w.setQuality('low');w.render();
  const changed=w.scene.environment!==before && w.renderer!==renderer && !!w.scene.environment;
  w.setQuality('high');w.render();
  return {changed,disposed,restored:!!w.scene.environment};
 });
 expect(result).toEqual({changed:true,disposed:true,restored:true});
});
