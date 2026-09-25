import { DEV_URL } from './server';
import {test,expect} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
const out=evidencePath('splatter');
test('actual collisions at four speeds produce bounded directional road splashes',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const shots=[];
 for(const speed of [10,60,150,300]){
  const shot=await page.evaluate(async speed=>{
   const path='/node_modules/three/build/three.module.js';await import(path);const g=window.game as any;
   await g.startRace({trackId:'synth-p2p',vehicleId:'micro-hatch',ai:false,slimeDensity:'normal'});g.phase='paused';
   const s=g.session,l=s.slimes,w=s.world,r=w.renderer;
   for(const tile of [...l.tileSpawns.keys()])l.removeTile(tile);l.fallingLimit=0;
   const index=w.spline.indexAt(60),p=w.spline.point(index),t=w.spline.tangent(index),yaw=Math.atan2(-t[0],-t[2]);
   s.car.reset([p[0],p[1]+.7,p[2]],yaw);s.car.body.setLinvel({x:t[0]*speed/3.6,y:0,z:t[2]*speed/3.6},true);
   l.addTile('speed',[{kind:'popper',position:[p[0]+t[0]*1.2,p[1]+1,p[2]+t[2]*1.2],scale:[1.5,1,1.5],yaw:0}]);
   const input={throttle:0,brake:0,steer:0,handbrake:false};
   for(let i=0;i<4;i++)s.physics.step(1/60,(h:number)=>{l.prepareCar(s.car);s.car.update(h,input);l.handleCar(s.car,input);},5,(h:number)=>l.update(h));
   const pending=l.groundSplatter.pending[0],velocity=pending?.velocity.length();
   for(let i=0;i<180;i++)s.physics.step(1/60,(h:number)=>{l.prepareCar(s.car);s.car.update(h,input);l.handleCar(s.car,input);},5,(h:number)=>l.update(h));
   while(l.groundSplatter.stats.pending)l.renderEffects(r);s.humans[0].render(1,1/60);s.mesh.visible=false;
   w.camera.position.set(p[0]+2,p[1]+10,p[2]+4);w.camera.lookAt(p[0]+t[0]*2,p[1],p[2]+t[2]*2);w.sky.follow(...p);
   r.setScissorTest(false);r.render(w.scene,w.camera);
   return {speed,velocity,hits:l.stats.feedback.hits.popper,stats:l.groundSplatter.stats,url:r.domElement.toDataURL()};
  },speed);
  expect(shot.hits).toBe(1);expect(shot.velocity).toBeGreaterThan(speed/3.6*.8);
  expect(shot.stats.pending).toBe(0);shots.push(shot);
  mkdirSync(out,{recursive:true});writeFileSync(resolve(out,`road-speed-${speed}.png`),Buffer.from(shot.url.split(',')[1]!,'base64'));
 }
 writeFileSync(resolve(out,'actual-speeds.json'),JSON.stringify(shots.map(({url,...rest})=>rest),null,2));
});

// These GPU probes import source modules; the full suite already starts this dev server.
test.use({ baseURL: DEV_URL });
