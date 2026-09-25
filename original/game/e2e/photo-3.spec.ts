import {expect,test} from '@playwright/test';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import {watermarkRect} from '../src/ui/ShareWatermark';

test('each photo PNG is exactly its real viewport pixels, and help never triggers a shutter',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 await page.evaluate(async()=>{
  const g=window.game as any;
  await g.startRace({trackId:'synth-loop',car:'sedan',playerVehicles:['micro-hatch','city-pod'],ai:false,slimeDensity:'normal'});
  let pending:any=null;
  Object.defineProperty(g,'captureNextFrame',{configurable:true,get:()=>pending,set:(callback:any)=>{pending=callback?((canvas:HTMLCanvasElement)=>{g.photoTestFull=canvas;callback(canvas);}):null;}});
 });
 await page.locator('.departure-pause').click();await page.locator('[data-screen=pause] [data-action=photo]').click();
 const evidence=[];
 for(const player of [0,1]){
  if(player)await page.locator('[data-photo=player]').click();
  await page.locator('[data-photo=capture]').click();await expect(page.locator('[data-share=save]')).toBeEnabled();
  const download=page.waitForEvent('download');await page.locator('[data-share=save]').click();
  const file=await download;const png=readFileSync((await file.path())!),base64=png.toString('base64');const mark=watermarkRect(png.readUInt32BE(16),png.readUInt32BE(20));
  const result=await page.evaluate(async({base64,player,mark})=>{
   const full=(window.game as any).photoTestFull as HTMLCanvasElement;
   const image=new Image();image.src='data:image/png;base64,'+base64;await image.decode();
   const left=Math.floor(full.width*player/2),right=Math.floor(full.width*(player+1)/2);
   const expected=document.createElement('canvas');expected.width=right-left;expected.height=full.height;
   expected.getContext('2d')!.drawImage(full,left,0,right-left,full.height,0,0,expected.width,expected.height);
   const actual=document.createElement('canvas');actual.width=image.naturalWidth;actual.height=image.naturalHeight;actual.getContext('2d')!.drawImage(image,0,0);
   if(actual.width!==expected.width||actual.height!==expected.height)return{width:actual.width,height:actual.height,expectedWidth:expected.width,expectedHeight:expected.height,mismatches:-1,stamped:0,iconBright:0,iconPixels:1,pixels:0,hash:0};
   const a=actual.getContext('2d')!.getImageData(0,0,actual.width,actual.height).data,b=expected.getContext('2d')!.getImageData(0,0,expected.width,expected.height).data;
   // Stamps the name, icon and address in the bottom-right corner; every other pixel is the real frame.
   let mismatches=0,stamped=0,bright=0,hash=2166136261;for(let i=0;i<a.length;i++){const p=i>>2,x=p%actual.width,y=(p/actual.width)|0;
    const inMark=x>=mark.x-1&&x<=mark.x+mark.width+1&&y>=mark.y-1&&y<=mark.y+mark.height+1;
    if(a[i]!==b[i]){if(inMark)stamped++;else mismatches++;}hash=Math.imul(hash^a[i]!,16777619);
    // The icon is one of the three things the badge must carry: under the dark plate nothing else is this bright.
    if(i%4===0&&x>=mark.icon.x&&x<mark.icon.x+mark.icon.size&&y>=mark.icon.y&&y<mark.icon.y+mark.icon.size&&a[i]!*.3+a[i+1]!*.59+a[i+2]!*.11>150)bright++;}
   return{width:actual.width,height:actual.height,expectedWidth:expected.width,expectedHeight:expected.height,mismatches,stamped,iconBright:bright,iconPixels:Math.round(mark.icon.size**2),pixels:a.length/4,hash:hash>>>0};
  },{base64,player,mark});
  expect(result.pixels).toBeGreaterThan(100_000);expect(result.mismatches).toBe(0);expect(result.stamped).toBeGreaterThan(1000);expect(result.iconBright/result.iconPixels).toBeGreaterThan(.1);evidence.push(result);
  await page.locator('[data-share=close]').click();
 }
 expect(evidence[0]!.hash).not.toBe(evidence[1]!.hash);
 await page.locator('[data-photo=help]').click();await expect(page.locator('.driving-help')).toBeVisible();
 await page.keyboard.press('Escape');await expect(page.locator('.driving-help')).toBeHidden();
 await expect(page.locator('.photo-controls')).toBeVisible();await expect(page.locator('.share-dialog')).toBeHidden();
 await page.locator('[data-photo=help]').click();await page.locator('.driving-help .settings-help').click();
 await expect(page.locator('.photo-controls')).toBeHidden();expect(await page.evaluate(()=>window.game.report().phase)).toBe('settings');
 const out=evidencePath('photo');mkdirSync(out,{recursive:true});writeFileSync(resolve(out,'pixels.json'),JSON.stringify(evidence,null,2));
});
