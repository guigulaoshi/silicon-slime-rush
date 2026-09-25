import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';

for(const [name,width,height,language,dual] of [
 ['single',1280,720,'en',false],['dual',1280,720,'zh',true],['narrow',844,390,'zh',false],
] as const)test(`${name} standings identify every actual car`,async({page})=>{
 await page.setViewportSize({width,height});
 await page.addInitScript(language=>localStorage.setItem('silicon-rush-world-tour.save.v1',JSON.stringify({language,muted:true,reducedMotion:true,best:{}})),language);
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const actual=await page.evaluate(async dual=>{
  const g=window.game as any;
  await g.startRace({trackId:'synth-p2p',vehicleId:'micro-hatch',playerVehicles:dual?['jeep','monster-truck']:undefined,ai:true,slimeDensity:'normal',timeOfDay:'day'});
  g.phase='paused';const s=g.session;
  for(const [i,r] of s.racers.entries()){r.race.state='finished';r.race.time=60+i;r.render(1,1/60);}
  const p=s.humans[0].car.position,w=s.world;w.camera.position.set(p.x+7,p.y+4,p.z+9);w.camera.lookAt(p.x,p.y+.4,p.z);w.sky.follow(p.x,p.y,p.z);
  g.finish(60);
  return g.lastResult.standings.map((r:any)=>({id:r.vehicleId,role:r.role}));
 },dual);
 const details=page.locator('.result-details');
 if(!await details.evaluate((node:HTMLDetailsElement)=>node.open))await details.locator('summary').click();
 // With the panel open, every footer button is still what a click at its left edge, middle and right edge lands on.
 const covered=await page.locator('.result-footer button:not([hidden])').evaluateAll(buttons=>buttons.flatMap(n=>{
  const b=n.getBoundingClientRect(),y=b.top+b.height/2;
  return [b.left+2,b.left+b.width/2,b.right-2].filter(x=>{const hit=document.elementFromPoint(x,y);return !hit||!n.contains(hit);})
   .map(x=>`${(n as HTMLElement).dataset.action}@${Math.round(x)}`);
 }));
 expect(covered).toEqual([]);
 // ...and the copied / failed line that clicking it brings up is not under the panel either.
 await page.locator('.result-footer [data-action=text]').click();
 const status=page.locator('[data-screen=results] main > p[role=status]');await expect(status).toBeVisible();
 expect(await details.evaluate((node:HTMLDetailsElement)=>node.open)).toBe(true);
 expect(await status.evaluate(n=>{const b=n.getBoundingClientRect(),hit=document.elementFromPoint(b.left+8,b.top+b.height/2);return !!hit&&n.contains(hit);})).toBe(true);
 const rows=page.locator('.result-standing');await expect(rows).toHaveCount(actual.length);
 expect(new Set(actual.map((r:any)=>r.id)).size).toBe(9);
 await expect(rows.locator('.result-standing-thumbnail')).toHaveCount(actual.length);
 for(let i=0;i<actual.length;i++){
  const row=rows.nth(i),img=row.locator('img');
  await expect(img).toHaveAttribute('src',`./garage/${actual[i].id}.webp`);
  await expect.poll(()=>img.evaluate((n:HTMLImageElement)=>n.complete&&n.naturalWidth>0)).toBe(true);
  await row.scrollIntoViewIfNeeded();
  const boxes=await row.evaluate(n=>Array.from(n.children).map(c=>{const b=c.getBoundingClientRect();return {left:b.left,right:b.right};}));
  for(let j=1;j<boxes.length;j++)expect(boxes[j]!.left).toBeGreaterThanOrEqual(boxes[j-1]!.right);
 }
 const out=evidencePath('standings');mkdirSync(out,{recursive:true});
 await rows.first().scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,`${name}-first.png`)});
 await rows.last().scrollIntoViewIfNeeded();await page.screenshot({path:resolve(out,`${name}-last.png`)});
 writeFileSync(resolve(out,`${name}.json`),JSON.stringify(actual,null,2));
});
