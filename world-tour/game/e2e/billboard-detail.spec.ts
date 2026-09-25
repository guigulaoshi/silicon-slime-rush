import { evidencePathOr } from './evidence';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {expect,test} from '@playwright/test';
const capture=process.env.BILLBOARD_DETAIL_CAPTURE;
test.skip(!capture,'opt-in billboard geometry comparison');
test.describe.configure({timeout:180000});
for(const style of ['ground','pole'])test(`billboard ${style} structural detail`,async({page})=>{
 const out=evidencePathOr(process.env.BILLBOARD_DETAIL_OUTPUT, 'billboard');mkdirSync(out,{recursive:true});
 await page.goto(`/?track=sydney&bot=1&dev=1&time=${process.env.BILLBOARD_TIME ?? 'day'}&perf=1&perfSlimes=none`);
 await page.waitForFunction(()=>window.game?.report().phase==='racing');
 const reference=process.env.BILLBOARD_DETAIL_REFERENCE
  ? JSON.parse(readFileSync(resolve('..',process.env.BILLBOARD_DETAIL_REFERENCE,`after-${style}.json`),'utf8')) : null;
 const facts=await page.evaluate(async ({style,reference})=>{
  const g=window.game as any,w=g.session.world;g.phase='paused';
  let found:any=null;
  for(let step=0;step<20&&!found;step++){
   const s=w.spline.length*step/20,p=w.spline.point(w.spline.indexAt(s));
   for(let batch=0;batch<5&&!found;batch++){
    w.streamer.update(s,p[0],p[2]);
    for(let n=0;n<100&&w.streamer.stats.loading>0;n++)await new Promise(r=>setTimeout(r,30));
    w.streamer.root.updateMatrixWorld(true);
    const poles:any[]=[];const faces:any[]=[];
    w.streamer.root.traverse((o:any)=>{if(!o.isInstancedMesh)return;
     if(o.name===`props_billboard_${style}`)poles.push(o);
     if(o.material?.name?.startsWith('billboard_face_'))faces.push(o);
    });
    for(const post of poles)for(let i=0;i<post.count&&!found;i++){
     const pm=post.matrixWorld.clone();post.getMatrixAt(i,pm);pm.premultiply(post.matrixWorld);
     const foot=w.camera.position.clone().setFromMatrixPosition(pm);
     post.geometry.computeBoundingBox();foot.y=post.geometry.boundingBox.clone().applyMatrix4(pm).min.y;
     for(const face of faces)for(let j=0;j<face.count&&!found;j++){
      const fm=face.matrixWorld.clone();face.getMatrixAt(j,fm);fm.premultiply(face.matrixWorld);
      const pos=foot.clone().setFromMatrixPosition(fm),rot=w.camera.quaternion.clone(),size=foot.clone();fm.decompose(pos,rot,size);
      const delta=foot.clone().sub(pos).applyQuaternion(rot.clone().invert());
      const expected=style==='ground'?4.5:0;
      if(Math.abs(Math.abs(delta.x)-expected)<.05 && Math.abs(delta.z)<.05){
       face.geometry.computeBoundingBox();size.multiply(face.geometry.boundingBox.getSize(size.clone()));
       found={foot,pos,rot,size};break;}
     }
    }
   }
  }
  if(!found)throw new Error(`No actual ${style} billboard found`);
  const {foot,pos,rot,size}=found;
  const referenceFoot=reference?foot.clone().fromArray(reference.foot):foot;
  const referenceSize=reference?size.clone().fromArray(reference.size):size;
  const referenceFace=reference?pos.clone().fromArray(reference.face):pos;
  const cameraHeight=referenceFace.y-referenceFoot.y+referenceSize.y/2;
  const centre=referenceFace.clone();centre.y=referenceFoot.y+cameraHeight/2;
  const offset=pos.clone().set(referenceSize.x*.75,cameraHeight*.2,-Math.max(referenceSize.x,cameraHeight)*1.55).applyQuaternion(rot);
  w.camera.position.copy(centre).add(offset);w.camera.lookAt(centre);w.camera.fov=45;w.camera.updateProjectionMatrix();
  document.querySelectorAll<HTMLElement>('#ui,.touch-controls,.tuning-panel,#perf-readout').forEach(n=>n.style.display='none');
  w.render();return {style,foot:foot.toArray(),face:pos.toArray(),size:size.toArray(),calls:w.renderer.info.render.calls,triangles:w.renderer.info.render.triangles};
 },{style,reference});
 expect(facts.size[0]).toBeGreaterThan(5);expect(facts.triangles).toBeGreaterThan(0);
 await page.screenshot({path:resolve(out,`${capture}-${style}.png`)});
 writeFileSync(resolve(out,`${capture}-${style}.json`),JSON.stringify(facts,null,2));
});
