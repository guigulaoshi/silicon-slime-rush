import {describe,it,expect} from 'vitest';
import * as THREE from 'three';
import {FarAtmosphere} from '../src/world/FarAtmosphere';
import {Sky} from '../src/world/Sky';

describe('real distant scenery',()=>{
 it('feeds clear, rain, snow and dense fog settings to the actual shader after output conversion',()=>{
  const scales:number[]=[];
  for(const weather of ['clear','rain','snow','fog'] as const){
   const fog=new THREE.Fog(0xbdd0e6,28,220),base=new THREE.MeshStandardMaterial();
   const air=new FarAtmosphere(weather,fog),mat=air.material(base);
   const shader={uniforms:{} as Record<string,{value:any}>,vertexShader:THREE.ShaderLib.standard.vertexShader,
    fragmentShader:THREE.ShaderLib.standard.fragmentShader};
   mat.onBeforeCompile(shader as any,{} as THREE.WebGLRenderer);
   scales.push(shader.uniforms.uFarScatter!.value);
   expect(shader.uniforms.uFarFog!.value).toBe(weather==='fog'?1:0);
   expect(shader.uniforms.uFarEnd!.value).toBe(220);
   expect(shader.uniforms.uFarAir!.value).toBe(fog.color);
   expect(shader.fragmentShader.indexOf('float haze =')).toBeGreaterThan(shader.fragmentShader.indexOf('#include <colorspace_fragment>'));
   expect(shader.fragmentShader).toContain('1.0 - exp(-vAirDistance / uFarScatter)');
   air.dispose();base.dispose();
  }
  expect(scales[0]).toBeGreaterThan(24000); // 32 km mountain keeps over 26% contrast.
  expect(scales[1]).toBeLessThan(scales[0]!);expect(scales[2]).toBeLessThan(scales[1]!);
 });
 it('owns atmospheric clones while preserving shared street materials and water animation',()=>{
  const base=new THREE.MeshStandardMaterial({name:'water'});
  base.onBeforeCompile=shader=>{shader.uniforms.waterClock={value:7};};
  const air=new FarAtmosphere('clear',new THREE.Fog(0xbdd0e6,420,2820));
  const clone=air.material(base);
  expect(clone).not.toBe(base);expect(base.fog).toBe(true);expect(clone.fog).toBe(false);
  expect(air.material(base)).toBe(clone);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,
   fragmentShader:THREE.ShaderLib.standard.fragmentShader};
  clone.onBeforeCompile(shader as any,{} as THREE.WebGLRenderer);
  expect(shader.uniforms).toHaveProperty('waterClock.value',7);
  expect(shader.vertexShader).toContain('vAirDistance = length(mvPosition.xyz)');
  expect(shader.fragmentShader).toContain('linearToOutputTexel(vec4(uFarAir, 1.0)).rgb, haze');
  air.dispose();base.dispose();
 });
 it('expands the sky enclosure while retaining the near-weather visibility range',()=>{
  const scene=new THREE.Scene(),sky=new Sky(scene,'day',90,3000,'clear',37000);
  expect((scene.fog as THREE.Fog).far).toBe(2820);
  expect(sky.dome.geometry.parameters.radius).toBeGreaterThan(37000);
  expect(sky.dome.material.fragmentShader).toContain('#include <colorspace_fragment>');
  sky.dispose();
 });
});
