import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
const out=evidencePath('weather');
// Two real laps per weather; twelve fixed steps per rendered frame keep each drive bounded.
test.describe.configure({timeout:180_000});
for(const weather of ['rain','snow'])test(`robot completes Shoreline in ${weather} with real wheel surfaces`,async({page})=>{
 await page.goto(`/?dev=1&track=shoreline&bot=1&speed=12&weather=${weather}&time=day`);
 await page.waitForFunction(()=>window.game?.report().track==='shoreline');
 await page.evaluate(()=>{
  const e=(window.game as any).session.world.weatherEffects,step=e.step.bind(e);e.seen={};
  e.step=(dt:number,cars:any[])=>{step(dt,cars);for(const car of cars)for(const w of car.wheels)if(w.grounded&&w.weather)e.seen[w.weather.kind]=(e.seen[w.weather.kind]??0)+1;};
 });
 await page.waitForFunction(()=>window.game.report().state==='finished',null,{timeout:160_000});
 const result=await page.evaluate(()=>({report:window.game.report(),seen:(window.game as any).session.world.weatherEffects.seen,effects:(window.game as any).session.world.weatherEffects.stats()}));
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,`robot-${weather}.json`),JSON.stringify(result,null,2));
 expect(result.report.resets,JSON.stringify(result.report.resetLog)).toBe(0);expect(result.report.track).toBe('shoreline');
 expect(result.seen[weather==='rain'?'wet':'snow']).toBeGreaterThan(1000);

});
