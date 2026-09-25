import { evidencePath } from './evidence';
import {expect, test} from '@playwright/test';
import {mkdirSync, writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {CATALOGUE, SYNTHETIC} from '../src/app/tracks';
import {driveBudgetGameSeconds} from './driveBudget';

// Every case drives the actual loaded route with unchanged 60 Hz physics substeps, six per frame.
// The 64.8 km highway has its route-derived budget; no precomputed or teleported finishes.
//
// Known once, not reproduced: in the full tier `reverse bayshore-101` went red
// with a rescue, {"reason":"upside-down","progress":6013,"time":247} -- the car rolled at 6013 m of the
// reverse run (about 10,008 m forward: a paved stretch on the ground, 9 m half width, not a bridge).
// Rerun alone it passed. Then ten more, all clean and all crossing 6013 m: five on the code after task
// 457, and -- because 457 changed this very driver's edge throttle (`edgeUse` in Autopilot.ts; the
// `autopilotSettingsFor` driver used here never saw 457's steering change) -- five more with that one
// line put back as it was. So 457 did not hide it. What none of the ten reproduced is the load: the red
// run shared the machine with the whole browser tier, these ran with it quiet. Streamed tiles arrive
// in real time while this car runs at speed=6, so a busy machine is the condition still untried.
// If it goes red again, look at the ground around 6,000 m reverse and at what had loaded by then, before
// loosening anything -- and never make it green by relaxing the rollover rule or adding a rescue.
test.describe.configure({timeout: 1_200_000});
const out=evidencePath('reverse');
for (const track of [...SYNTHETIC,...CATALOGUE.map(t=>t.id)]) test('reverse '+track, async({page})=>{
  mkdirSync(out,{recursive:true});
  const errors:string[]=[];
  page.on('pageerror',e=>errors.push(e.message));
  await page.goto('/?dev=1&bot=1&speed=6&direction=reverse&track='+track);
  await page.waitForFunction(()=>window.game?.report().phase==='racing',null,{timeout:60_000});
  const first=await page.evaluate(()=>window.game.report());
  expect(first.direction).toBe('reverse');
  const budget=driveBudgetGameSeconds(first.length,first.laps);
  const started=Date.now();
  let report=first,mark=0;
  while(report.state!=='finished' && report.time<budget) {
    await page.waitForTimeout(1000);report=await page.evaluate(()=>window.game.report());
    if(Math.floor(report.time/120)>mark) {
      mark=Math.floor(report.time/120);
      console.log(track+': '+report.progress.toFixed(0)+'/'+report.length.toFixed(0)+'m, '+report.time.toFixed(0)+'s, resets '+report.resets);
    }
  }
  writeFileSync(resolve(out,track+'.json'),JSON.stringify({direction:'reverse',wallSeconds:(Date.now()-started)/1000,report,errors},null,2));
  expect(report.state,JSON.stringify(report.resetLog)).toBe('finished');
  expect(report.resets,JSON.stringify(report.resetLog)).toBe(0);
  expect(report.tiles?.loaded).toBeGreaterThan(0);
  expect(report.tiles?.failed).toBe(0);
  expect(report.slimes?.spawned).toBeGreaterThan(0);
  expect(errors).toEqual([]);
  if(track==='synth-p2p'){
    await expect(page.locator('.result-track')).toContainText('Reverse');
    const saved=await page.evaluate(()=>(window.game as any).save.all);
    expect(saved.best['synth-p2p:reverse@micro-hatch']).toBeGreaterThan(0);
    expect(saved.ghosts['synth-p2p:reverse@micro-hatch']).toBeTruthy();
    expect(saved.best['synth-p2p@micro-hatch']).toBeUndefined();
    await page.screenshot({path:resolve(out,'reverse-result.png')});
    await page.evaluate(()=>(window.game as any).save.update({showGhost:true})); // off by default
    await page.reload();
    await page.waitForFunction(()=>window.game?.report().phase==='racing',null,{timeout:60_000});
    await expect.poll(()=>page.evaluate(()=>window.game.report().ghost.visible)).toBe(true);
  }
});
test('forward synthetic sprint still completes after the shared distance lookup change',async({page})=>{
  await page.goto('/?dev=1&bot=1&speed=6&track=synth-p2p');
  await page.waitForFunction(()=>window.game?.report().phase==='results',null,{timeout:120_000});
  const report=await page.evaluate(()=>window.game.report());
  expect(report.direction).toBe('forward');expect(report.state).toBe('finished');expect(report.resets).toBe(0);
});
