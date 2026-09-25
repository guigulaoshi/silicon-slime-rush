import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {expectWorldLoaded} from './world';
import {captureFrames,rendererFacts,reportDesktopFrames,SOFTWARE_RENDERER} from './frame-sample';
test.describe.configure({timeout:180_000});
// Track ids retargeted from the deleted Bay Area set (old -> new, one line why):
// wolfe-pruneridge (loop, was the default/weather-variant track here) -> beijing (the only real loop)
// shoreline / fishermans-wharf (both fed the west-extreme-point search below) -> lhasa / new-york
// moffett-field (flat wide open, fed the north-extreme-point search) -> dubai
// bayshore-101 (64.8 km highway, no equivalent) -> giza, a plain generic-view case (desert, no special search)
// goldengate (default/showcase) -> sydney; twin-peaks (winding hill road) -> zhangjiajie ('east' view)
// lombard (steep switchbacks, fed the highest-point search) -> rio -> zhangjiajie again ('north' view;
// rio deleted along with machu-picchu). zhangjiajie has the widest height range of any
// remaining track (70.6 m, game/public/tracks/zhangjiajie/track.json spline.points y), so it is also
// the best remaining stand-in for a real highest-point search.
const views:[string,string,number,number][]=[
 ['beijing','west',-1,0],['beijing','bay',-.5,-.866],['beijing','east',1,0],
 ['lhasa','west',-1,0],['lhasa','bay',.5,-.866],['dubai','west',-.7,.7],
 ['giza','east',1,0],['sydney','north',0,-1],['zhangjiajie','east',1,0],
 ['new-york','north',0,-1],['zhangjiajie','north',0,-1]];
const cases=views.map(([track,view,x,z])=>({track,view,x,z,weather:'clear',time:'day'}));
for(const [weather,time] of [['rain','day'],['snow','day'],['fog','day'],['clear','night']])cases.push({track:'beijing',view:'bay',x:-.5,z:-.866,weather:weather!,time:time!});
for(const {track,view,x,z,weather,time} of cases)test(`356 ${track} ${view} ${weather} ${time}`,async({page})=>{
 const out=evidencePath('horizon/after');mkdirSync(out,{recursive:true});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 page.on('console',m=>{if(m.type()==='error'&&/THREE|WebGL|shader/i.test(m.text()))errors.push(m.text());});
 await page.goto(`/?track=${track}&bot=1&dev=1&time=${time}&weather=${weather}&perf=1&perfSlimes=none`);
 await page.waitForFunction(()=>window.game?.report().phase==='racing');
 const camera=await page.evaluate(async({x,z,track,view})=>{
  const g=window.game as any,s=g.session,w=s.world;g.phase='paused';g.autopilot=false;
  await w.sceneryReady;
  let index=w.spline.indexAt(w.spline.length*.1);
  if((track==='beijing'&&view==='bay')||['lhasa','new-york'].includes(track)){
   for(let i=0;i<w.spline.count;i++){
    const a=w.spline.point(i),b=w.spline.point(index);
    if(a[0]*x+a[2]*z>b[0]*x+b[2]*z)index=i;
   }
  }
  if(track==='dubai'){
   for(let i=0;i<w.spline.count;i++)if(w.spline.point(i)[2]<w.spline.point(index)[2])index=i;
  }
  if(track==='zhangjiajie'&&view==='north'){
   for(let i=0;i<w.spline.count;i++)if(w.spline.point(i)[1]>w.spline.point(index)[1])index=i;
  }
  const at=w.spline.s[index],p=w.spline.point(index);
  s.car.reset([p[0],p[1]+1,p[2]],0);
  for(let i=0;i<10;i++){w.follow(at,...p);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));}
  await w.landmarks.prepare([{x:p[0],z:p[2]}]);
  s.chase.update=()=>{};
  w.camera.position.set(p[0],p[1]+3.5,p[2]);w.camera.lookAt(p[0]+x*1000,p[1]+23.5,p[2]+z*1000);
  document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(n=>n.style.display='none');
  const nodes:{name:string,materials:{name:string,fog:boolean}[]}[]=[];
  w.backdrop.root.traverse((o:any)=>{if(o.name.startsWith('backdrop_horizon')){
   const materials:{name:string,fog:boolean}[]=[];o.traverse((m:any)=>{if(m.isMesh)materials.push({name:m.material.name,fog:m.material.fog});});
   nodes.push({name:o.name,materials});
  }});
  w.render();return {nodes,radius:s.track.backdrop.horizonRadiusM,position:w.camera.position.toArray(),target:[p[0]+x*1000,p[1]+23.5,p[2]+z*1000],far:w.camera.far};
 },{x,z,track,view});
 await expectWorldLoaded(page,`${track} ${view}`);
 const frames=await captureFrames(page,0,2000);const renderer=await rendererFacts(page);
 await page.screenshot({path:resolve(out,`${track}-${view}-${weather}-${time}.png`)});
 writeFileSync(resolve(out,`${track}-${view}-${weather}-${time}.json`),JSON.stringify({camera,frames,renderer},null,2));
 expect(camera.radius).toBeGreaterThanOrEqual(35000);
 // Land always; a water layer only where the horizon holds sea (the Bay Area always did; Beijing, Lhasa, Giza have none).
 expect(camera.nodes.map(n=>n.name)).toContain('backdrop_horizon_land');
 for(const node of camera.nodes){expect(node.materials.length).toBeGreaterThan(0);for(const mat of node.materials){expect(mat.name).toMatch(/-atmosphere$/);expect(mat.fog).toBe(false);}}
 expect(camera.far).toBeGreaterThan(camera.radius);expect(frames.drawCalls).toBeGreaterThan(0);
 expect(errors).toEqual([]);
 if(process.env.PERF_REAL_GPU==='1'){expect(renderer.renderer).not.toMatch(SOFTWARE_RENDERER);reportDesktopFrames(frames.fps,frames.p95Ms,`${track} ${view}`);}
});
