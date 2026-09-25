import {expect,it} from 'vitest';
import {splatterPattern,splatterDrift,coatingFadeRate} from '../src/world/SplatterPattern';
import {causticIntensity} from '../src/world/SlimeCaustics';
it('samples unique ballistic impacts and bounds forward drift across 10 to 300 km/h',()=>{
 const speeds=[10,60,150,300].map(v=>v/3.6),drifts=speeds.map(splatterDrift);
 for(let i=1;i<drifts.length;i++)expect(drifts[i]).toBeGreaterThan(drifts[i-1]!);
 expect(splatterDrift(1e6)).toBe(13);
 for(const speed of speeds){
  const a=splatterPattern(121,speed),b=splatterPattern(122,speed);
  expect(a.blobs.length).toBeGreaterThan(100);
  expect(a.blobs).not.toEqual(b.blobs);expect(a).toEqual(splatterPattern(121,speed));
  expect(a.blobs.some(blob=>blob.weight<0)).toBe(true);
 }
});
it('exposure produces broad coverage, narrow filaments and sparse lee droplets',()=>{
 const [front,side,back]=[1,0,-1].map(exposure=>splatterPattern(12,30,exposure));
 expect(front!.blobs.filter(b=>b.radius>20).length).toBeGreaterThan(20);
 expect(side!.blobs.every(b=>b.radius<10)).toBe(true);
 expect(side!.blobs.length).toBeGreaterThan(back!.blobs.length*2);
 expect(back!.blobs.every(b=>b.radius<=2)).toBe(true);
 expect(coatingFadeRate(83.33)).toBeGreaterThan(coatingFadeRate(10));
 expect(coatingFadeRate(10)).toBeGreaterThan(coatingFadeRate(0));
});
it('the optical tile is periodic across both edges and the full time cycle',()=>{
 let changed=0;
 for(let i=0;i<=256;i++){
  const x=i/256;
  expect(causticIntensity(0,x,1)).toBeCloseTo(causticIntensity(1,x,1),9);
  expect(causticIntensity(x,0,1)).toBeCloseTo(causticIntensity(x,1,1),9);
  expect(causticIntensity(x,.37,0)).toBeCloseTo(causticIntensity(x,.37,8),9);
  if(Math.abs(causticIntensity(x,.37,0)-causticIntensity(x,.37,.2))>.1)changed++;
 }
 expect(changed).toBeGreaterThan(128);
});
