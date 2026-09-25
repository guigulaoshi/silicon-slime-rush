import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {expectWorldLoaded} from './world';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {evidencePath,baselinePath} from './evidence';
import {captureFrames,rendererFacts,SOFTWARE_RENDERER,reportDesktopFrames} from './frame-sample';
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
test('office and residential facade glass follows viewpoint and night use within the GPU budget',async({page})=>{
 mkdirSync(out,{recursive:true});await page.setViewportSize({width:1440,height:900});
 const views=JSON.parse(readFileSync(baselinePath('windows/views.json'),'utf8'));
 const report:unknown[]=[];
 for(const track of ['fishermans-wharf','wolfe-pruneridge'])for(const time of ['day','night']){
  await page.goto(`/?track=${track}&bot=1&dev=1&time=${time}&slimes=none`);
  await page.waitForFunction(()=>window.game?.report().phase==='racing');
  let reference=views[track];
  await page.evaluate(async v=>{
   const g=window.game as any,w=g.session.world;g.phase='paused';g.autopilot=false;
   const i=w.spline.indexAt(v.at),p=w.spline.point(i);
   for(let pass=0;pass<10;pass++){
    w.streamer.update(v.at,p[0],p[2]);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));
   }
   g.session.mesh.visible=false;g.session.mesh.position.set(...p);w.sky.follow(p[0],p[1],p[2]);
   document.querySelectorAll<HTMLElement>('#ui,.tuning-panel').forEach(n=>n.style.display='none');
  },reference);
  if(track==='wolfe-pruneridge'&&stage==='before'){
   reference=JSON.parse(readFileSync(resolve(out,'after-performance.json'),'utf8')).find((r:any)=>r.track===track&&r.time===time&&r.view).view;
  }
  if(track==='wolfe-pruneridge'&&stage==='after'){
   const home=await page.evaluate(()=>{
    const w=window.game.session.world,p=window.game.session.mesh.position;
    let selected:any=null,closest=Infinity;w.streamer.root.updateMatrixWorld(true);
    w.streamer.root.traverse((o:any)=>{
     if(!o.isMesh||o.material?.name!=='building_stucco')return;
     const a=o.geometry.attributes.position,n=o.geometry.attributes.normal,uv=o.geometry.attributes.uv,ix=o.geometry.index;
     if(!a||!n||!uv||!ix)return;
     for(let k=0;k<ix.count;k+=3){
      const ids=[ix.getX(k),ix.getX(k+1),ix.getX(k+2)];
      const identity=o.geometry.attributes.uv1;if(!identity||!ids.every(i=>identity.getY(i)>.5))continue;
      if(!ids.every(i=>Math.abs(n.getY(i))<.1)||ids.every(i=>Math.abs(uv.getX(i)-.02)<.001&&Math.abs(uv.getY(i)-.02)<.001))continue;
      const centre=p.clone().set(0,0,0);
      for(const i of ids)centre.add(p.clone().set(a.getX(i),a.getY(i),a.getZ(i)));
      centre.multiplyScalar(1/3).applyMatrix4(o.matrixWorld);
      const normal=p.clone().set(n.getX(ids[0]),n.getY(ids[0]),n.getZ(ids[0])).transformDirection(o.matrixWorld);
      const delta=p.clone().sub(centre),distance=Math.hypot(delta.x,delta.z);
      if(distance<10||distance>600||delta.dot(normal)<=0||centre.y<p.y-40||centre.y>p.y+80)continue;
      if(distance<closest){closest=distance;selected={centre:centre.toArray(),normal:normal.toArray()};}
     }
    });return selected;
   });
   expect(home,'a nearby stucco residential facade is visible').not.toBeNull();
   reference={...reference,...home};report.push({track,time,view:reference});
  }
  await expectWorldLoaded(page,`291 ${track} ${time}`);
  if(stage==='after'){
   const coverage=await page.evaluate(()=>{
    const w=window.game.session.world;let vertices=0,homes=0,offices=0;const identities=new Set<number>();
    w.streamer.root.traverse((o:any)=>{if(!o.isMesh||!o.name.includes('building'))return;
     const a=o.geometry.getAttribute('uv1');if(!a)return;
     for(let i=0;i<a.count;i++){const seed=Math.round(a.getX(i)*1024);if(!seed)continue;
      vertices++;identities.add(seed);if(a.getY(i)>.5)homes++;else offices++;
     }
    });
    return {vertices,homes,offices,identities:identities.size,environment:!!w.scene.environment};
   });
   expect(coverage.environment).toBe(true);expect(coverage.vertices).toBeGreaterThan(100);
   expect(coverage.identities).toBeGreaterThan(5);
   expect(track==='wolfe-pruneridge'?coverage.homes:coverage.offices).toBeGreaterThan(0);report.push({track,time,coverage});
  }
  for(const [angle,side] of [0,12].entries()){
   await page.evaluate(({v,side,home})=>{
    const w=window.game.session.world,c=v.centre,n=v.normal;
    w.camera.position.set(c[0]+n[0]*(home?18:35)-n[2]*side,c[1]+(home?1:-10),c[2]+n[2]*(home?18:35)+n[0]*side);
    w.camera.lookAt(c[0],c[1]+(home?0:-7),c[2]);w.camera.fov=62;w.camera.updateProjectionMatrix();w.render();
   },{v:reference,side,home:track==='wolfe-pruneridge'});
   await page.screenshot({path:resolve(out,`${stage}-${track}-${time}-${angle}.png`)});
  }
  if(track==='fishermans-wharf'&&time==='day'){
   const gpu=await rendererFacts(page);expect(gpu.renderer).not.toMatch(SOFTWARE_RENDERER);
   const original=await captureFrames(page,reference.at,4000);reportDesktopFrames(original.fps,original.p95Ms,'glass');
   const memory=await page.evaluate(()=>{
    const w=window.game.session.world,image=w.scene.environment?.image as {width?:number;height?:number}|undefined;
    return {...w.renderer.info.memory,environmentWidth:image?.width??0,environmentHeight:image?.height??0,
     environmentBytes:(image?.width??0)*(image?.height??0)*8};
   });
   let disabled=null;
   if(stage==='after'){
    await page.evaluate(()=>{const w=window.game.session.world;(window as any).__glassEnvironment=w.scene.environment;w.scene.environment=null;w.render();w.renderer.getContext().finish();});
    disabled=await captureFrames(page,reference.at,4000);
    await page.evaluate(()=>{window.game.session.world.scene.environment=(window as any).__glassEnvironment;});
   }
   report.push({track,time,gpu,original,disabled,memory});
  }
 }
 writeFileSync(resolve(out,`${stage}-performance.json`),JSON.stringify(report,null,2));
});
