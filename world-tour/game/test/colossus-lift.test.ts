import { beforeAll, expect, it } from 'vitest';
import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from '../e2e/evidence';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Car, NO_INPUT } from '../src/physics/Car';
import { Trailer } from '../src/physics/Trailer';
import { vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';
import { tuningFor } from '../src/physics/CarTuning';
import { COLOSSUS_FLOAT_HEIGHT, COLOSSUS_LIFT, SlimeLayer, colossusCeiling, colossusContains, type SlimeSpawn } from '../src/world/Slimes';
import { slimeScale, slimeGroundFraction } from '../src/world/slimeShape';
import { Spline } from '../src/track/Spline';
import type { TrackData } from '../src/track/types';
import { QUALITY_LIMITS } from '../src/world/quality';
let api: typeof RAPIER;
beforeAll(async()=>{api=await initPhysics();});
const scale = slimeScale('colossus', .35);
const spawn: SlimeSpawn = {kind:'colossus',s:60,position:[60,scale[1]*slimeGroundFraction('colossus'),0],scale,yaw:.35};
function fixture(position:[number,number,number], secondDriver=false, withTrailer=false) {
  const physics = new PhysicsWorld(api);
  const floor=physics.world.createCollider(api.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0));
  physics.registerCollider(floor,'ground');
  const spline = new Spline({spline:{points:Array.from({length:101},(_,i)=>[i*2,0,0]),halfWidth:Array(101).fill(10),closed:false,length:200}} as TrackData);
  const layer = new SlimeLayer(new THREE.Scene(),physics,spline,document.createElement('div'),QUALITY_LIMITS.low,[spawn]);
  const parked = secondDriver ? new Car(physics,tuningFor('sedan'),{pos:[0,.8,30],yaw:0}):null;
  if(parked)layer.prepareCar(parked);
  const vehicle = vehicleFor('pickup-travel-trailer')!;
  const car = new Car(physics,withTrailer?vehicleTuning(vehicle,'sedan'):tuningFor('sedan'),{pos:position,yaw:-Math.PI/2});
  const trailer = withTrailer?new Trailer(physics,car,vehicle):null;
  const step = (brake=0)=>{
    physics.step(1/60,h=>{const input={...NO_INPUT,brake};layer.prepareCar(car,trailer?.car);car.update(h,input);trailer?.update(h);layer.handleCar(car,input,trailer?.car);},5,()=>layer.finishPhysicsStep());
    layer.update(1/60);
  };
  return {physics,layer,car,trailer,step,dispose:()=>{layer.dispose();trailer?.dispose();physics.world.removeRigidBody(car.body);if(parked)physics.world.removeRigidBody(parked.body);physics.dispose();}};
}
it('finds the upper membrane using the authored containment field, including rotation and skirt',()=>{
  for(const x of [0,4,8]) {
    const point = new THREE.Vector3(spawn.position[0]+x,spawn.position[1],1);
    const roof=colossusCeiling(spawn,point)!;
    expect(roof).toBeGreaterThan(point.y);
    expect(colossusContains(spawn,new THREE.Vector3(point.x,roof-.0001,point.z))).toBe(true);
    expect(colossusContains(spawn,new THREE.Vector3(point.x,roof+.0001,point.z))).toBe(false);
  }
  expect(colossusCeiling(spawn,new THREE.Vector3(500,0,0))).toBeNull();
});
// User replaced 340's ever-accelerating, slower-goes-higher ascent: every rig rises at one
// acceleration from the step it enters, stops at one float height, and falls the step it leaves.
const tall = slimeScale('colossus', .9);
const tallSpawn: SlimeSpawn = {kind:'colossus',s:60,position:[60,tall[1]*slimeGroundFraction('colossus'),0],scale:tall,yaw:0};
const groundY = tallSpawn.position[1]-tall[1]*slimeGroundFraction('colossus');
function crossing(id:string) {
  const physics = new PhysicsWorld(api);
  const floor=physics.world.createCollider(api.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0));
  physics.registerCollider(floor,'ground');
  const spline = new Spline({spline:{points:Array.from({length:101},(_,i)=>[i*2,0,0]),halfWidth:Array(101).fill(30),closed:false,length:200}} as TrackData);
  const layer = new SlimeLayer(new THREE.Scene(),physics,spline,document.createElement('div'),QUALITY_LIMITS.low,[tallSpawn]);
  const vehicle = vehicleFor(id)!;
  const start = 60-tall[2]-8;
  const car = new Car(physics,vehicleTuning(vehicle,vehicle.tuning as never),{pos:[start,2,0],yaw:-Math.PI/2});
  const trailer = vehicle.trailer?new Trailer(physics,car,vehicle):null;
  for(const body of [car,...(trailer?[trailer.car]:[])])body.body.setLinvel({x:9,y:0,z:0},true);
  const samples:{inside:boolean;y:number;vy:number}[]=[];
  let after=0;
  for(let i=0;i<60*25;i++) {
    physics.step(1/60,h=>{layer.prepareCar(car,trailer?.car);car.update(h,NO_INPUT);trailer?.update(h);layer.handleCar(car,NO_INPUT,trailer?.car);},5,()=>layer.finishPhysicsStep());
    layer.update(1/60);
    samples.push({inside:layer.driverStats(car).colossusTransit,y:car.position.y,vy:car.body.linvel().y});
    if(layer.stats.colossusExits>0&&++after>30)break;
  }
  const result={id,entries:layer.stats.colossusEntries,exits:layer.stats.colossusExits,samples};
  layer.dispose();trailer?.dispose();physics.world.removeRigidBody(car.body);physics.dispose();
  return result;
}
it.each(['micro-hatch','sports-car','lightweight-sports','jeep','pickup-travel-trailer','monster-truck','school-bus','retro-van','city-pod'])('%s rises at once at the shared rate, stops at the float height and falls at once on leaving', id => {
  const run=crossing(id);
  expect(run.entries).toBe(1);expect(run.exits).toBe(1);
  const enter=run.samples.findIndex(x=>x.inside), leave=run.samples.findIndex((x,i)=>i>enter&&!x.inside);
  const inside=run.samples.slice(enter,leave);
  const record={id,enterVy:[run.samples[enter]!.vy,run.samples[enter+1]!.vy],accel:(run.samples[enter+30]!.vy-run.samples[enter+10]!.vy)/(20/60),
    top:Math.max(...inside.map(x=>x.y))-groundY,exitVy:run.samples[leave]!.vy,afterVy:run.samples[leave+1]!.vy,inside:inside.length};
  // Rising from the first transit step on, at the shared acceleration.
  expect(record.enterVy[1]!).toBeGreaterThan(record.enterVy[0]!);
  expect(record.accel).toBeGreaterThan(COLOSSUS_LIFT*.95);expect(record.accel).toBeLessThan(COLOSSUS_LIFT*1.05);
  // Stops at the float height and stays there.
  expect(record.top).toBeGreaterThan(COLOSSUS_FLOAT_HEIGHT-.1);expect(record.top).toBeLessThan(COLOSSUS_FLOAT_HEIGHT+.15);
  const settled=inside.findIndex(x=>x.y-groundY>COLOSSUS_FLOAT_HEIGHT-.005);
  expect(settled).toBeGreaterThan(0);
  expect(Math.max(...inside.slice(settled+5).map(x=>x.vy))).toBeLessThan(.3);
  // Falling from the step it leaves.
  expect(record.exitVy).toBeLessThanOrEqual(0);expect(record.afterVy).toBeLessThan(0);
  (globalThis as any).__buoy=((globalThis as any).__buoy??[]).concat([record]);
  mkdirSync(evidencePath('colossus-buoyancy'),{recursive:true});
  writeFileSync(resolve(evidencePath('colossus-buoyancy'),'crossings.json'),JSON.stringify((globalThis as any).__buoy,null,1));
});

it('holds a rising car under the top membrane instead of letting its upward momentum break through',()=>{
  const ceiling=spawn.position[1]+spawn.scale[1];
  const f=fixture([60,ceiling-tuningFor('sedan').chassisHalf[1]-.15,0]);
  f.car.body.setLinvel({x:0,y:12,z:0},true);
  for(let i=0;i<20;i++) {
    f.step(1);
    expect(f.car.position.y+f.car.tuning.chassisHalf[1]).toBeLessThanOrEqual(ceiling-.1);
    expect(f.layer.driverStats(f.car).colossusTransit).toBe(true);
  }
  expect(f.car.body.linvel().y).toBeLessThan(.2);
  expect(f.layer.stats.colossusExits).toBe(0);
  f.dispose();
});

it('keeps the physical trailer hitch together during the higher ascent and landing',()=>{
  const f=fixture([38,1,0],false,true);
  for(const body of [f.car,f.trailer!.car])body.body.setLinvel({x:7,y:0,z:0},true);
  let gap=0,up=1;
  for(let i=0;i<1200;i++) {
    f.step(f.layer.driverStats(f.car).colossusTransit?1:0);
    gap=Math.max(gap,f.trailer!.hitchGap);up=Math.min(up,f.car.upright,f.trailer!.car.upright);
    if(f.layer.stats.colossusExits>0&&f.car.grounded&&f.trailer!.car.grounded)break;
  }
  expect(f.layer.stats.colossusEntries).toBe(1);expect(f.layer.stats.colossusExits).toBe(1);
  expect(f.car.grounded&&f.trailer!.car.grounded).toBe(true);
  expect(gap).toBeLessThan(.08);expect(up).toBeGreaterThan(.8);
  f.dispose();
});
