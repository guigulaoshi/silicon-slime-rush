import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {expectWorldLoaded} from './world';
// Each case streams two physical endpoints in one direction and checks the road outside both.
test.describe.configure({timeout:180_000});
for(const track of ['fishermans-wharf','goldengate','bayshore-101','twin-peaks','lombard','shoreline','wolfe-pruneridge','moffett-field']){
 for(const direction of ['forward','reverse'])test(`350 ${track} ${direction} endpoint roads`,async({page})=>{
  const out=evidencePath('endpoints/after');mkdirSync(out,{recursive:true});const rows=[];
  await page.goto(`/?track=${track}&direction=${direction}&bot=1&dev=1&time=day&slimes=0`);
  await page.waitForFunction(()=>window.game?.report().phase==='racing',null,{timeout:90_000});
  for(const end of ['start','finish']){
   const facts=await page.evaluate(async end=>{
    const g=window.game as any,s=g.session,w=s.world;g.phase='paused';g.autopilot=false;
    const at=end==='start'?0:w.spline.length,index=w.spline.indexAt(at),p=w.spline.point(index),t=w.spline.tangent(index);
    const sign=end==='start'?-1:1;p[1]+=1.2;s.car.reset(p,Math.atan2(-t[0]*sign,-t[2]*sign));
    s.mesh.position.copy(s.car.position);s.mesh.quaternion.copy(s.car.quaternion);
    for(let i=0;i<10;i++){w.follow(at,...p);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));}
    await w.landmarks.prepare([{x:p[0],z:p[2]}]);s.chase.setMode('chase');s.chase.reset();
    // The paused scene has just streamed new colliders; publish them to Rapier's query index.
    s.physics.step(1/60);
    s.chase.update(w.camera,s.car.position,s.car.quaternion,s.mesh.position.clone().set(0,0,0),1/60,{grounded:true,reducedMotion:true});
    document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(n=>n.style.display='none');w.render();
    const road=s.track.endRoads?.[end];
    const guide=road?new w.spline.constructor({...s.track,spline:road}):null;
    const probes=road?[0,15,50,100,200].flatMap(at=>{
     let i=0;while(i<road.s.length-1&&road.s[i]<at)i++;
     const right=guide.right(i);
     return [-.8,0,.8].map(side=>{
      const p=[...road.points[i]];p[0]+=right[0]*road.halfWidth[i]*side;p[2]+=right[2]*road.halfWidth[i]*side;
      const hit=s.physics.surfaceAt(p[0],p[2],p[1]+3,p[1]-3);
      return {at,side,point:p,ground:hit?.point.y??null,gap:hit?hit.point.y-p[1]:null};
     });
    }):[];
    return {closed:w.spline.closed,roadLength:road?.length??null,probes};
   },end);
   await expectWorldLoaded(page,`${track} ${direction} ${end}`);
   await page.screenshot({path:resolve(out,`${track}-${direction}-${end}.png`)});
   if(facts.closed){expect(facts.roadLength).toBeNull();}
   else{
    expect(facts.roadLength).toBeGreaterThanOrEqual(200);expect(facts.probes).toHaveLength(15);
    for(const probe of facts.probes){expect(probe.ground,JSON.stringify(probe)).not.toBeNull();expect(Math.abs(probe.gap!),JSON.stringify(probe)).toBeLessThan(.25);}
   }
   rows.push({end,...facts});
  }
  if(!rows[0]!.closed){
   const previous=await page.evaluate(()=>window.game.report().resets);
   await page.evaluate(()=>{
    const g=window.game as any,s=g.session,p=s.world.spline.point(0),t=s.world.spline.tangent(0);
    p[0]-=t[0]*20;p[2]-=t[2]*20;p[1]+=1;s.car.reset(p,Math.atan2(t[0],t[2]));
    s.race.reacquire(p[0],p[2]);g.autopilot=false;g.phase='racing';
   });
   await page.waitForFunction(count=>window.game.report().resets>count,previous,{timeout:5000});
   expect((await page.evaluate(()=>window.game.report())).resetLog.at(-1)?.reason).toBe('off-track');
  }
  writeFileSync(resolve(out,`${track}-${direction}.json`),JSON.stringify(rows,null,2));
 });
}
