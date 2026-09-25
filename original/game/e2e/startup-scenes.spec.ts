import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {expectWorldLoaded} from './world';

test.describe.configure({timeout:240_000});
test('capture clean real Golden Gate startup backgrounds',async({page})=>{
 const out=evidencePath('startup-scenes');mkdirSync(out,{recursive:true});
 await page.setViewportSize({width:1280,height:720});await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const scenes=[...['day','night'].flatMap(time=>['clear','rain','fog','snow'].map(weather=>({key:`${time}-${weather}`,time,weather,slimes:'normal',ai:false,difficulty:'relaxed',home:false}))),
 ...['none','normal','many'].map(slimes=>({key:`slimes-${slimes}`,time:'day',weather:'clear',slimes,ai:false,difficulty:'relaxed',home:false})),
 ...['off','relaxed','rush'].map(difficulty=>({key:`ai-${difficulty}`,time:'day',weather:'clear',slimes:'normal',ai:difficulty!=='off',difficulty:difficulty==='off'?'relaxed':difficulty,home:false})),
 {key:'home',time:'day',weather:'clear',slimes:'normal',ai:false,difficulty:'relaxed',home:true}];
 for(const scene of scenes){
  if(process.env.STARTUP_SCENE && scene.key!==process.env.STARTUP_SCENE)continue;
  await page.evaluate(async v=>{
   const g=window.game as any;await g.startRace({trackId:'goldengate',vehicleId:'sports-car',ai:v.ai,aiDifficulty:v.difficulty,timeOfDay:v.time,weather:v.weather,slimeDensity:v.slimes});
   const s=g.session,w=s.world;g.phase='paused';g.autopilot=false;
   const at=v.home?950:1450,i=w.spline.indexAt(at),p=w.spline.point(i),t=w.spline.tangent(i);
   s.car.body.setTranslation({x:p[0],y:p[1]+1,z:p[2]},true);s.mesh.position.set(p[0],p[1]+.7,p[2]);s.mesh.rotation.y=Math.atan2(-t[0],-t[2]);
   for(let n=0;n<10;n++){w.streamer.update(at,p[0],p[2]);while(w.streamer.stats.loading)await new Promise(r=>setTimeout(r,25));}
   s.slimes?.update(1/60);
   for(let n=0;n<s.racers.length;n++){const racer=s.racers[n];if(racer===s.humans[0])continue;const q=w.spline.point(w.spline.indexAt(at+25+n*17));racer.mesh.position.set(q[0]+(n%2?2:-2),q[1]+.7,q[2]);}
   const behind=v.home?100:8,height=v.home?70:3.5,ahead=v.home?400:100;
   w.camera.position.set(p[0]-t[0]*behind,p[1]+height,p[2]-t[2]*behind);w.camera.lookAt(p[0]+t[0]*ahead,p[1]+(v.home?0:1.2),p[2]+t[2]*ahead);w.camera.fov=60;w.camera.updateProjectionMatrix();w.sky.follow(...p);w.render();
  },scene);
  await expectWorldLoaded(page,scene.key);
  const data=await page.evaluate(async()=>new Promise<string>(resolve=>{(window.game as any).captureNextFrame=(canvas:HTMLCanvasElement)=>resolve(canvas.toDataURL('image/png'));}));
  expect(data).toMatch(/^data:image\/png;base64,/);writeFileSync(resolve(out,scene.key+'.png'),Buffer.from(data.split(',')[1]!,'base64'));
 }
});
