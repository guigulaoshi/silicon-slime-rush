import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
const out=evidencePath('weather');
// lhasa is p2p with laps=1 (game/public/tracks/lhasa/track.json): one real lap per weather.
// Twelve fixed steps per rendered frame keep each drive bounded. (This test never actually
// asserted a lap count -- the old comment's "two" described shoreline, not something checked here.)
test.describe.configure({timeout:180_000});
for(const weather of ['rain','snow'])test(`robot completes Lhasa in ${weather} with real wheel surfaces`,async({page})=>{
 await page.goto(`/?dev=1&track=lhasa&bot=1&speed=12&weather=${weather}&time=day`);
 await page.waitForFunction(()=>window.game?.report().track==='lhasa');
 await page.evaluate(()=>{
  const e=(window.game as any).session.world.weatherEffects,step=e.step.bind(e);e.seen={};
  e.step=(dt:number,cars:any[])=>{step(dt,cars);for(const car of cars)for(const w of car.wheels)if(w.grounded&&w.weather)e.seen[w.weather.kind]=(e.seen[w.weather.kind]??0)+1;};
 });
 await page.waitForFunction(()=>window.game.report().state==='finished',null,{timeout:160_000});
 const result=await page.evaluate(()=>({report:window.game.report(),seen:(window.game as any).session.world.weatherEffects.seen,effects:(window.game as any).session.world.weatherEffects.stats()}));
 mkdirSync(out,{recursive:true});writeFileSync(resolve(out,`robot-${weather}.json`),JSON.stringify(result,null,2));
 expect(result.report.resets,JSON.stringify(result.report.resetLog)).toBe(0);expect(result.report.track).toBe('lhasa');
 // RETARGET-MEASURE: confirm a full lhasa drive still accumulates >1000 wheel/weather-surface
 // contact frames by finish -- this depends on lhasa's runtime weather-patch layout and race
 // duration (physics steps), which cannot be derived from track.json alone.
 expect(result.seen[weather==='rain'?'wet':'snow']).toBeGreaterThan(1000);

});
