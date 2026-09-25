import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {evidencePath} from './evidence';
import {expectWorldLoaded} from './world';
test.describe.configure({timeout:120_000});
for(const language of ['en','zh'])for(const device of ['solo','dual','mobile'])test(`joined Garage ${language} ${device}`,async({browser})=>{
 const context=await browser.newContext({viewport:device==='mobile'?{width:932,height:430}:{width:1440,height:900},...(device==='mobile'?{userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)',hasTouch:true,isMobile:true}:{})});
 await context.addInitScript(lang=>localStorage.setItem('silicon-rush-world-tour.save.v1',JSON.stringify({version:3,language:lang,muted:true})),language);
 const page=await context.newPage();await page.emulateMedia({reducedMotion:'reduce'});await page.goto('/?dev=1&bot=1&speed=6');await page.locator('.home-go').click();
 await page.locator('[data-track="synth-p2p"]').click();
 for(let i=1;i<=2;i++){await page.locator('.sm-go').click();await expect(page.locator('.sm')).toHaveAttribute('data-step',String(i));}
 await expect(page.locator('.sm-rail')).toHaveCount(0);await expect(page.locator('.sm-players')).toHaveCount(0);
 await expect(page.locator('.startup-recap-step[data-state="on"] small')).toHaveText(language==='en'?'03 Garage':'03 车库');
 const out=evidencePath('garage');mkdirSync(out,{recursive:true});
 const left=page.locator('.sm-player[data-player="0"]');
 await left.locator('[data-vehicle="micro-hatch"]').click();await expect(left.locator('.sm-carhero')).toHaveAttribute('data-state','ready');
 //A phone on auto quality builds the preview at low, without multisampling; a desktop keeps it.
 expect(await left.locator('.sm-carhero canvas').evaluate((c:HTMLCanvasElement)=>(c.getContext('webgl2')??c.getContext('webgl'))!.getContextAttributes()!.antialias),'garage antialias follows quality').toBe(device!=='mobile');
 await expect(left.locator('.startup-car-details .sm-bars .sm-bar')).toHaveCount(3);
 for(const n of [left.locator('.startup-car-details')]){const b=(await n.boundingBox())!,stage=(await left.locator('.startup-car-stage').boundingBox())!;expect(b.x).toBeGreaterThanOrEqual(stage.x);expect(b.y+b.height).toBeLessThanOrEqual(stage.y+stage.height+.5);expect(b.x+b.width).toBeLessThanOrEqual(stage.x+stage.width+.5);}
 if(device==='mobile')await expect(page.locator('.startup-add-player')).toHaveCount(0);
 else {
  await expect(page.locator('.startup-add-player')).toHaveText(language==='en'?'+ Add 2P':'+ 加入 2P');
  await page.locator('.startup-add-player').click();
  await expect(page.locator('.sm')).toHaveAttribute('data-players','2');
  const right=page.locator('.sm-player[data-player="1"]');
  expect(await right.locator('.sm-car.sel').getAttribute('data-vehicle')).not.toBe('micro-hatch');
  await expect(right.locator('.sm-carhero')).toHaveAttribute('data-state','ready');
  await expect(page.locator('.sm-go')).toBeEnabled();await expect(page.locator('.sm-confirm,[data-browse]')).toHaveCount(0);
  await expect(page.locator('.startup-garage-header .startup-remove-player')).toBeVisible();
  // 389: the details card is always open, so the bars show without a click and follow each driver's car.
  for(const player of [left,right]){await expect(player.locator('.startup-car-details summary')).toHaveCount(0);await expect(player.locator('.startup-car-details .sm-bars')).toBeVisible();}
  expect((await right.locator('.startup-car-details .sm-barval').allTextContents()).join('|')).not.toBe((await left.locator('.startup-car-details .sm-barval').allTextContents()).join('|'));
  await page.screenshot({path:`${out}/${language}-${device}-garage-details.png`});
  await page.locator('.startup-remove-player').click();
  await expect(left.locator('.sm-car.sel')).toHaveAttribute('data-vehicle','micro-hatch');
  await expect(page.locator('.sm-go')).toBeEnabled();
  if(device==='dual'){
   await page.locator('.startup-add-player').click();
   await right.locator('[data-vehicle="sports-car"]').click();await expect(right.locator('.sm-carhero')).toHaveAttribute('data-state','ready');
   await expect(page.locator('.sm-go')).toBeEnabled();
  }
 }
 for(const selector of ['.startup-add-player','.startup-remove-player','.sm-car.sel'])for(const n of await page.locator(selector).all()){
  const b=await n.boundingBox();expect(b).not.toBeNull();expect(b!.x).toBeGreaterThanOrEqual(0);expect(b!.y).toBeGreaterThanOrEqual(0);
  const v=(await page.locator('.sm-viewport').boundingBox())!;expect(b!.x+b!.width).toBeLessThanOrEqual(v.x+v.width+.5);expect(b!.y+b!.height).toBeLessThanOrEqual(v.y+v.height+.5);
 }
 await page.screenshot({path:`${out}/${language}-${device}-garage-after.png`});
 if(language==='en'){
  await page.locator('.sm-go').click();
  await page.waitForFunction(()=>['countdown','racing'].includes(window.game.report().phase));
  expect(await page.evaluate(()=>window.game.session.humans.length)).toBe(device==='dual'?2:1);
  await page.evaluate(()=>window.game.session.humans.forEach((_,i)=>window.game.setAutopilot(i,true)));
  expect(await page.evaluate(()=>window.game.session.humans.every(r=>r.autopilot))).toBe(true);
  await expectWorldLoaded(page,`346 ${device}`);
  if(device!=='mobile'){
   await page.waitForFunction(()=>window.game.report().phase==='results',null,{timeout:90_000});
   const report=await page.evaluate(()=>window.game.report());expect(report.resets).toBe(0);expect(report.tiles?.failed).toBe(0);
   writeFileSync(`${out}/${device}-finish.json`,JSON.stringify(report,null,2));await page.screenshot({path:`${out}/${device}-finish.png`});
  }
 }
 await context.close();
});
