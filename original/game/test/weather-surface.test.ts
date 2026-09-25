import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import { WeatherSurface, SURFACE_GRIP, PATCH_SHAPES, SHAPE_MASK_SIZE, patchMask, patchQuaternion, weatherPatches, wheelSpray, type WeatherSurfaceKind } from '../src/world/WeatherSurface';
import { Spline } from '../src/track/Spline';
import type { TrackData } from '../src/track/types';
import { Car, NO_INPUT } from '../src/physics/Car';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { tuningFor } from '../src/physics/CarTuning';
import { TireMarks } from '../src/world/TireMarks';
import { WeatherEffects } from '../src/world/WeatherEffects';
let api: Awaited<ReturnType<typeof initPhysics>>;
beforeAll(async () => { api = await initPhysics(); });
function spline(grade = 0) { return new Spline({ spline: { points: Array.from({length:501}, (_, i) => [i*2, i*2*grade, 0]), halfWidth: Array(501).fill(5), length:1000, closed:false } } as TrackData); }
function contact(kind: WeatherSurfaceKind) { return { kind, grip: SURFACE_GRIP[kind], depth: kind === 'deepSnow' ? .24 : kind === 'puddle' ? .06 : .025 }; }
function carWorld(kind: WeatherSurfaceKind, split = false) {
  const physics = new PhysicsWorld(api), car = new Car(physics, tuningFor('sedan'), {pos:[0,1,0],yaw:0});
  physics.add('ground',{trimeshes:[{vertices:new Float32Array([-1000,0,-1000,1000,0,-1000,1000,0,1000,-1000,0,1000]),indices:new Uint32Array([0,2,1,0,3,2])}],boxes:[]});
  car.setWeatherQuery(p => contact(split && p.x < 0 ? 'dry' : kind));
  for(let i=0;i<120;i++){car.update(1/60,NO_INPUT);physics.world.step();}
  return {car,physics};
}
it('scatters patches randomly along the route, rejects hills, and preserves weather and road-side classification',()=>{
  const N=SHAPE_MASK_SIZE,s=spline(), rain=new WeatherSurface(s,'rain'), snow=new WeatherSurface(s,'snow');
  expect(rain.patches.length).toBeGreaterThan(8);expect(rain.patches.length).toBeLessThan(14);
  const ices=snow.patches.filter(p=>p.kind==='ice'),deeps=snow.patches.filter(p=>p.kind==='deepSnow');
  expect(ices.length).toBeGreaterThan(8);expect(ices.length).toBeLessThan(18);
  const gaps=rain.patches.slice(1).map((p,i)=>s.s[p.index]!-s.s[rain.patches[i]!.index]!),offsets=rain.patches.map(p=>p.z);
  expect(Math.max(...gaps)/Math.min(...gaps),'gaps are irregular').toBeGreaterThan(2);
  expect(new Set(offsets.map(z=>Math.sign(z))).size,'both halves of the road').toBe(2);
  expect(new Set(offsets.map(z=>Math.abs(z).toFixed(1))).size,'lateral positions vary').toBeGreaterThan(rain.patches.length/2);
  expect(weatherPatches(s,'rain').map(p=>p.x),'same track, same layout').toEqual(rain.patches.map(p=>p.x));
  expect(new Set(rain.patches.map(p=>p.mask)).size,'patches pick varied shapes from the shared pool').toBeGreaterThan(2);
  expect(deeps.length*2,'deep snow keeps its old spacing').toBeLessThanOrEqual(ices.length+1);
  // Rain/snow puddles and ice: double the count (pre-change layout gave 6 here) and double the area (old radius 2.4).
  expect(rain.patches.length).toBeGreaterThanOrEqual(2*5);
  const areas=[...rain.patches,...ices].map(p=>Math.PI*p.radius**2),mean=areas.reduce((a,b)=>a+b)/areas.length;
  expect(mean/(Math.PI*2.4**2)).toBeGreaterThan(1.7);expect(mean/(Math.PI*2.4**2)).toBeLessThan(2.3);
  expect(Math.max(...areas)/Math.min(...areas),'sizes vary').toBeGreaterThan(1.2);
  expect(new Set(rain.patches.map(p=>p.spin!.toFixed(2))).size,'rotations vary').toBe(rain.patches.length);
  // Contact sampling follows the mesh spin: the mask is sampled in the rotated frame.
  const turned=rain.patches[0]!,probe=new THREE.Vector3(turned.radius*.5,0,0).applyQuaternion(patchQuaternion(s,turned));
  const saved={spin:turned.spin,mask:turned.mask};turned.mask=new Uint8Array(N*N*4).map((_,k)=>k%4===3&&(k>>2)%N>N*.7?255:0);
  expect(rain.sample(turned.x+probe.x,turned.y+probe.y,turned.z+probe.z,turned.index).kind).toBe('puddle');
  turned.spin=saved.spin!+Math.PI;expect(rain.sample(turned.x+probe.x,turned.y+probe.y,turned.z+probe.z,turned.index).kind).toBe('wet');
  Object.assign(turned,saved);
  expect(weatherPatches(spline(.1),'rain')).toHaveLength(0);expect(weatherPatches(s,'clear')).toHaveLength(0);
  for(const p of rain.patches)expect(rain.sample(p.x,p.y,p.z,p.index).kind).toBe('puddle');
  const ice=snow.patches.find(p=>p.kind==='ice')!,deep=snow.patches.find(p=>p.kind==='deepSnow')!;
  expect(snow.sample(ice.x,ice.y,ice.z,ice.index).kind).toBe('ice');
  expect(snow.sample(deep.x,deep.y,deep.z,deep.index).kind).toBe('deepSnow');
  expect(snow.sample(ice.x,ice.y,-Math.sign(ice.z)*4,ice.index).kind).toBe('snow');
  expect(rain.sample(ice.x,ice.y+20,ice.z,ice.index).kind).toBe('wet');
  ice.mask=new Uint8Array(N*N*4);expect(snow.sample(ice.x,ice.y,ice.z,ice.index).kind).toBe('snow');
});
it('puddles and ice are single random sheets, not splashes, drawn from all five shape families',()=>{
  const N=SHAPE_MASK_SIZE,lo=[0,0],hi=[N-1,N-1];
  const shapes=new Map<string,number>(),outlines=new Set<string>();
  for(const kind of ['puddle','ice'] as const)for(let seed=0;seed<20;seed++){
    const {mask,shape}=patchMask(seed,kind),on=(x:number,y:number)=>mask[(y*N+x)*4+3]!>20;
    shapes.set(shape,(shapes.get(shape)??0)+1);
    let total=0,soft=0,start:[number,number]|null=null,outline='';
    for(let y=lo[1]!;y<=hi[1]!;y++)for(let x=lo[0]!;x<=hi[0]!;x++){const a=mask[(y*N+x)*4+3]!;if(a>20){total++;start??=[x,y];}if(a>20&&a<235)soft++;if(x%3===0&&y%3===0)outline+=a>127?1:0;}
    outlines.add(outline);
    const seen=new Set<number>(),stack=[start!];
    while(stack.length){const [x,y]=stack.pop()!;const k=y*N+x;if(seen.has(k)||x<lo[0]!||x>hi[0]!||y<lo[1]!||y>hi[1]!||!on(x,y))continue;seen.add(k);stack.push([x+1,y],[x-1,y],[x,y+1],[x,y-1]);}
    expect(seen.size,`${kind} ${seed} ${shape}: one connected sheet, no stray droplets`).toBe(total);
    expect(total/((hi[0]!-lo[0]!+1)*(hi[1]!-lo[1]!+1)),`${kind} ${seed} ${shape}: coverage`).toBeGreaterThan(.12);
    if(kind==='ice')expect(soft/total,`ice ${seed} ${shape}: crisp edge`).toBeLessThan(.18);
  }
  expect([...shapes.keys()].sort()).toEqual([...PATCH_SHAPES].sort());
  expect(outlines.size,'every seed outline differs').toBe(40);
});
it('selects small water, big water, small snow, big snow and zero ice particles',()=>{
  const wet=wheelSpray(contact('wet'),25),puddle=wheelSpray(contact('puddle'),25),snow=wheelSpray(contact('snow'),25),deep=wheelSpray(contact('deepSnow'),25);
  expect(puddle.lift).toBeGreaterThan(wet.lift*4);expect(deep.lift).toBeGreaterThan(snow.lift*4);
  expect(snow.gravity).toBeLessThan(wet.gravity);expect(snow.life).toBeGreaterThan(wet.life);
  expect(wheelSpray(contact('puddle'),5).rate).toBeLessThan(puddle.rate);
  expect(wheelSpray({...contact('puddle'),depth:.02},25).lift).toBeLessThan(puddle.lift);
  for(const kind of ['dry','ice'] as const)expect(wheelSpray(contact(kind),70).rate).toBe(0);
});
it('actual braking distances strictly increase through all five surfaces',()=>{
  const distances=[];
  for(const kind of ['dry','wet','puddle','snow','ice'] as const){
    const {car,physics}=carWorld(kind);car.body.setLinvel({x:0,y:0,z:-25},true);const start=car.position.clone();
    let steps=0;
    while(steps++<1200){car.update(1/60,{...NO_INPUT,brake:1,parkingBrake:true});physics.world.step();if(car.speed<.5)break;}
    expect(steps).toBeLessThan(1200);distances.push(car.position.distanceTo(start));physics.dispose();
  }
  console.log('braking metres dry/wet/puddle/snow/ice:', JSON.stringify(distances));
  for(let i=1;i<distances.length;i++)expect(distances[i]).toBeGreaterThan(distances[i-1]!+1);
});
it('partial-wheel ice creates asymmetric braking using contact coordinates despite slime query updates',()=>{
  const results=[];
  for(const split of [false,true]){
    const {car,physics}=carWorld('ice',split);car.setSurfaceQuery(()=>({slick:0}));car.body.setLinvel({x:0,y:0,z:-25},true);
    for(let i=0;i<30;i++){car.update(1/60,{...NO_INPUT,brake:1,parkingBrake:true});physics.world.step();}
    results.push(Math.abs(car.body.angvel().y));
    if(split)expect(new Set(car.wheels.map(w=>w.weather?.kind)).size).toBe(2);
    physics.dispose();
  }
  expect(results[1]).toBeGreaterThan(results[0]!+.005);
});
it('two cars emit from four grounded wheel positions, retain independent curved snow trails, stop on ice and keep them',()=>{
  const effects=new WeatherEffects(new WeatherSurface(spline(),'snow')),marks=new TireMarks('snow');
  const worlds=[carWorld('snow'),carWorld('snow')], cars=worlds.map(w=>w.car);
  for(const [j,car]of cars.entries()){car.body.setLinvel({x:0,y:0,z:-8},true);car.update(1/60,NO_INPUT);for(const [i,w]of car.wheels.entries())w.contact.set(j*20+(i%2)*2,0,Math.floor(i/2)*3);}
  marks.step(.1,cars);effects.step(.4,cars);
  const points=effects.root.children.find(child=>child instanceof THREE.Points) as THREE.Points;
  const positions=points.geometry.getAttribute('position');
  const emitted=Array.from({length:effects.stats().snow},(_,i)=>new THREE.Vector3().fromBufferAttribute(positions,i));
  for(const car of cars)for(const wheel of car.wheels)expect(emitted.some(p=>p.distanceTo(wheel.contact.clone().add(new THREE.Vector3(0,.05,0)))<.001)).toBe(true);
  expect(effects.stats().snow).toBeGreaterThan(0);expect(effects.stats().water).toBe(0);
  for(let n=0;n<5;n++){for(const car of cars)for(const w of car.wheels)w.contact.add(new THREE.Vector3(.1*n,0,-.4));marks.step(.1,cars);}
  expect(marks.stats().snow).toBe(20);
  for(const car of cars)for(const w of car.wheels)w.weather=contact('ice');
  const before=effects.stats().snow;effects.step(.2,cars);marks.step(.2,cars);
  expect(effects.stats().snow).toBe(before);expect(marks.stats().snow).toBe(20);
  marks.step(19,[]);effects.step(2,[]);expect(marks.stats().snow,'Ruts outlive the old 18 s fade').toBe(20);expect(effects.stats().active).toBe(0);
  effects.dispose();marks.dispose();worlds.forEach(w=>w.physics.dispose());
});
it('snow trail geometry follows sloped wheel travel rather than remaining a horizontal rectangle',()=>{
  const marks=new TireMarks('snow');
  const car={speed:8,poseRevision:0,tuning:{wheelRadius:.4},wheels:[0,1,2,3].map(i=>({grounded:true,skid:0,contact:new THREE.Vector3(i%2,0,0),weather:contact('snow')}))} as unknown as Car;
  marks.step(.1,[car]);for(const wheel of car.wheels)wheel.contact.add(new THREE.Vector3(0,.15,-.5));marks.step(.1,[car]);
  const mesh=marks.root.getObjectByName('snow-tire-marks-0') as THREE.InstancedMesh;
  expect(mesh.count).toBe(2);const matrix=new THREE.Matrix4();mesh.getMatrixAt(0,matrix);
  const a=new THREE.Vector3(0,0,-.5).applyMatrix4(matrix),b=new THREE.Vector3(0,0,.5).applyMatrix4(matrix);
  expect(Math.abs(a.y-b.y)).toBeCloseTo(.15);expect(Math.abs(a.z-b.z)).toBeCloseTo(.5);
  expect((a.y+b.y)/2).toBeCloseTo(.075+.018);marks.dispose();
});
