import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from './evidence';
import { slimeScale, slimeGroundFraction } from '../src/world/slimeShape';

// Two real-time traversals retain the complete ascent and fall for visual review.
test.describe.configure({timeout:180_000});
test.use({video:{mode:'on',size:{width:1280,height:720}},viewport:{width:1280,height:720}});
const out=evidencePath('colossus-lift');
test('slow and fast crossings float at the same height and fall as soon as they leave',async({page})=>{
  mkdirSync(out,{recursive:true});
  await page.addInitScript(()=>localStorage.setItem('silicon-rush.save.v1',JSON.stringify({language:'en',quality:'high',muted:true})));
  await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
  const facts:Record<string,any>={};
  for(const mode of ['slow','fast']) {
    const scale=slimeScale('colossus',.35);
    await page.evaluate(async({scale,groundFraction,speed})=>{
      const g=window.game as any;
      await g.startRace({trackId:'shoreline',car:'sedan',playerVehicles:['micro-hatch'],ai:false,slimeDensity:'normal',timeOfDay:'day'});
      const s=g.session,layer=s.slimes,spline=s.world.spline;
      g.timeScale=1;g.autopilot=false;g.phase='paused';layer.fallingLimit=0;
      for(const key of [...layer.tileSpawns.keys()])layer.removeTile(key);
      const at=spline.indexAt(180),p=spline.point(at),t=spline.tangent(at);
      const start=spline.point(spline.indexAt(158));
      layer.addTile('lift',[{kind:'colossus',position:[p[0],p[1]+scale[1]*groundFraction,p[2]],scale,yaw:0}]);
      s.car.reset([start[0],start[1]+.8,start[2]],Math.atan2(-t[0],-t[2]));
      s.car.body.setLinvel({x:t[0]*speed,y:0,z:t[2]*speed},true);
      s.race.reacquire(start[0],start[2]);s.race.start();s.chase.reset();
      g.__lift340={samples:[],landing:[],exit:null,ground:p[1]};
      const sound=layer.onSound;
      layer.onSound=(kind:any,strength:any,phase:any)=>{
        sound(kind,strength,phase);
        if(kind==='colossus'&&phase==='exit')g.__lift340.exit={height:s.car.position.y-p[1],time:s.race.time};
      };
      const update=layer.update.bind(layer);
      layer.update=(dt:number)=>{
        update(dt);
        const driver=layer.drivers.get(s.car);
        if(g.__lift340.exit)g.__lift340.landing.push({time:s.race.time,grounded:s.car.grounded,upright:s.car.upright,vy:s.car.body.linvel().y});
        if(driver?.transit)g.__lift340.samples.push({elapsed:driver.transit.elapsed,height:s.car.position.y-p[1],vy:s.car.body.linvel().y});
      };
      g.show('racing');
    },{scale,groundFraction:slimeGroundFraction('colossus'),speed:mode==='slow'?7:14});
    await page.waitForFunction(()=>(window.game as any).session.slimes.stats.colossusTransit);
    if(mode==='slow')await page.keyboard.down('KeyS');
    await page.screenshot({path:resolve(out,`${mode}-entry.png`)});
    await page.waitForFunction(()=>(window.game as any).__lift340.samples.at(-1)?.elapsed>1.2);
    await page.screenshot({path:resolve(out,`${mode}-rising.png`)});
    await page.waitForFunction(()=>(window.game as any).__lift340.exit!==null);
    await page.keyboard.up('KeyS');
    await page.screenshot({path:resolve(out,`${mode}-exit.png`)});
    await page.waitForFunction(()=>{const g=window.game as any;return g.session.car.grounded && g.session.slimes.drivers.get(g.session.car).settledFor>=.5;});
    const result=await page.evaluate(()=>{
      const g=window.game as any;
      return {...g.__lift340,grounded:g.session.car.grounded,upright:g.session.car.upright,resets:g.report().resets,failed:g.report().tiles.failed};
    });
    expect(result.exit.height).toBeGreaterThan(1);
    expect(result.upright).toBeGreaterThan(.9);
    const firstContact=result.landing.findIndex((sample:any)=>sample.grounded);
    expect(firstContact).toBeGreaterThanOrEqual(0);
    expect(Math.min(...result.landing.slice(firstContact).map((sample:any)=>sample.upright))).toBeGreaterThan(.8);expect(result.resets).toBe(0);expect(result.failed).toBe(0);
    facts[mode]=result;
    await page.screenshot({path:resolve(out,`${mode}-landed.png`)});
  }
  // Retired 340's "slower goes higher": both crossings float at the same height.
  expect(Math.abs(facts.slow.exit.height-facts.fast.exit.height)).toBeLessThan(.5);
  writeFileSync(resolve(out,'browser-crossings.json'),JSON.stringify(facts,null,2));
});
