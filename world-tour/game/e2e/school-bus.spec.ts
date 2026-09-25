import {test,expect} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {CATALOGUE} from '../src/app/tracks';
import {forTrack, VEHICLES} from '../src/vehicles/catalogue';
const stage=process.env.BUS_CAPTURE==='before'?'before':'after';
// The garage opens on the menu's default track (CATALOGUE's first entry, beijing); on its home
// track the school-bus slot shows the local car (catalogue.ts forTrack), not the generic body.
const busSlot=VEHICLES.find(v=>v.id==='school-bus')!;
const expectedBus=forTrack(busSlot,CATALOGUE[0]!.id).id;
test('school bus uses its current model and thumbnail in the garage',async({page})=>{
 const out=evidencePath('school-bus');mkdirSync(out,{recursive:true});
 await page.setViewportSize({width:1440,height:900});
 await page.emulateMedia({reducedMotion:'reduce'});
 await page.addInitScript(()=>localStorage.setItem('silicon-rush-world-tour.save.v1',JSON.stringify({language:'en',muted:true})));
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/');await page.locator('.home-go').click();
 await page.locator('.sm-go').click();await page.locator('.sm-go').click();
 const card=page.locator('[data-player="0"] [data-vehicle="school-bus"]');
 await card.click();const hero=page.locator('.sm-carhero');
 await expect(hero).toHaveAttribute('data-model-vehicle',expectedBus);
 await expect(hero).toHaveAttribute('data-state','ready');
 await expect(card.locator('img')).toHaveAttribute('src',new RegExp(`${expectedBus}\\.webp$`));
 expect(await card.locator('img').evaluate((img:HTMLImageElement)=>img.complete&&img.naturalWidth>0)).toBe(true);
 await page.screenshot({path:resolve(out,`${stage}-garage.png`)});
 await card.screenshot({path:resolve(out,`${stage}-card.png`)});
 await hero.evaluate(node=>{node.style.height='360px';node.style.minHeight='360px';});
 await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
 const canvas=hero.locator('canvas'),b=await canvas.boundingBox();expect(b).not.toBeNull();
 // OrbitControls measures pointer rotation in units of canvas height. Use the same side view
 // before and after, with reduced motion keeping the production turntable stationary.
 const height=await canvas.evaluate(node=>node.clientHeight);
 const theta=Math.atan2(1.5,-2.3),phi=Math.acos(.58/Math.hypot(1.5,.58,2.3));
 const x=b!.x+b!.width*.25,y=b!.y+b!.height*.55;
 await page.mouse.move(x,y);await page.mouse.down();
 await page.mouse.move(x+height*(theta+Math.PI/2)/(2*Math.PI),y+height*(phi-1.48)/(2*Math.PI),{steps:12});
 await page.mouse.up();await hero.screenshot({path:resolve(out,`${stage}-side.png`)});
 expect(errors).toEqual([]);
});
