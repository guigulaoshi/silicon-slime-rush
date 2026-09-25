import {expect,test} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {expectWorldLoaded} from './world';

test.describe.configure({timeout:600_000});
test('three roadside aircraft rows are visible from the normal chase camera and the bot finishes',async({page})=>{
 const out=evidencePath('airshow');mkdirSync(out,{recursive:true});
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('/?track=moffett-field&bot=1&dev=1&speed=6');
 await page.waitForFunction(()=>window.game?.report().phase==='racing',null,{timeout:90_000});
 const rows=[];
 for(const [name,station] of [['runway',500],['hangar',2130],['south',2400]] as const){
  await page.waitForFunction(s=>window.game.report().progress>=s,station,{timeout:180_000});
  await expectWorldLoaded(page,name);
  const report=await page.evaluate(()=>{
   const world=window.game.session.world,camera=world.camera;
   const aircraft=world.landmarks.root.children.filter(o=>o.name.startsWith('moffett-')).map(o=>{
    const centre=o.position.clone();centre.y+=3;centre.project(camera);
    const points:{x:number;y:number}[]=[];
    if(centre.z>=-1&&centre.z<=1)o.traverse(node=>{
     const mesh=node as import('three').Mesh;
     if(!mesh.geometry)return;
     mesh.geometry.computeBoundingBox();const box=mesh.geometry.boundingBox!;
     for(const x of [box.min.x,box.max.x])for(const y of [box.min.y,box.max.y])for(const z of [box.min.z,box.max.z]){
      const p=box.min.clone().set(x,y,z).applyMatrix4(mesh.matrixWorld).project(camera);
      points.push({x:p.x,y:p.y});
     }
    });
    const minX=Math.max(-1,Math.min(...points.map(p=>p.x))),maxX=Math.min(1,Math.max(...points.map(p=>p.x)));
    const minY=Math.max(-1,Math.min(...points.map(p=>p.y))),maxY=Math.min(1,Math.max(...points.map(p=>p.y)));
    const width=Math.max(0,maxX-minX)*innerWidth/2,height=Math.max(0,maxY-minY)*innerHeight/2;
    return{id:o.name,position:o.position.toArray(),width,height,visible:width>=18&&height>=8};
   });
   return {report:window.game.report(),aircraft,render:{...world.renderer.info.render}};
  });
  expect(report.aircraft.filter(a=>a.visible).length,`${name}: aircraft must reach the normal camera, not just load`).toBeGreaterThanOrEqual(2);
  rows.push({name,...report});
  await page.screenshot({path:resolve(out,`${name}-chase.png`),animations:'disabled'});
 }
 await page.waitForFunction(()=>window.game.report().state==='finished',null,{timeout:240_000});
 const report=await page.evaluate(()=>window.game.report());
 expect(report.resets,JSON.stringify(report.resetLog)).toBe(0);
 expect(report.tiles?.failed??0).toBe(0);expect(errors).toEqual([]);
 expect(report.checkpoints).toBe(1%report.totalCheckpoints);expect(report.slimes?.spawned??0).toBeGreaterThan(0);
 writeFileSync(resolve(out,'robot-report.json'),JSON.stringify({report,views:rows},null,2));
});
