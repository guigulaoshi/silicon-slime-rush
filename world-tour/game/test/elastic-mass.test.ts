import { expect, it } from 'vitest';
import * as THREE from 'three';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { evidencePath } from '../e2e/evidence';
import { initPhysics, PhysicsWorld } from '../src/physics/PhysicsWorld';
import { Car, NO_INPUT } from '../src/physics/Car';
import { tuningFor } from '../src/physics/CarTuning';
import { SlimeLayer } from '../src/world/Slimes';
import baseline from './fixtures/elastic-mass-before.json';
import { elasticSlimeMass } from '../src/world/SlimePhysics';
import { roundSlimeScale } from '../src/world/slimeShape';
import { Spline } from '../src/track/Spline';
import { QUALITY_LIMITS } from '../src/world/quality';
import type { TrackData } from '../src/track/types';
it('halves the real parent and split-child masses and measures the same fifteen metre per second strike', async () => {
  const api = await initPhysics(), physics = new PhysicsWorld(api);
  const ground = physics.world.createCollider(api.ColliderDesc.cuboid(500,.1,500).setTranslation(0,-.1,0));
  physics.registerCollider(ground,'ground');
  const spline = new Spline({spline:{points:Array.from({length:101},(_,i)=>[i*2,0,0]),
    halfWidth:Array(101).fill(10),closed:false,length:200}} as TrackData);
  const scale = roundSlimeScale(1.2);
  const layer = new SlimeLayer(new THREE.Scene(),physics,spline,document.createElement('div'),QUALITY_LIMITS.low,
    [{kind:'slick',s:20,position:[20,scale[1],0],scale,yaw:0}]);
  const car = new Car(physics,tuningFor('sedan'),{pos:[14,.8,0],yaw:-Math.PI/2});
  const parent = (layer as any).lives.find((live:any)=>live.active && live.tile!=='__split__');
  expect(parent.motion.body.mass()).toBeCloseTo(baseline.mass/2,4);
  car.body.setLinvel({x:15,y:0,z:0},true);
  let hitFrame = -1, lowest = 15;
  for(let i=0;i<120;i++) {
    physics.step(1/60,h=>{layer.prepareCar(car);car.update(h,NO_INPUT);layer.handleCar(car);},5,()=>layer.finishPhysicsStep());
    layer.update(1/60);
    if(layer.stats.bounceHits>0 && hitFrame<0) hitFrame=i;
    if(hitFrame>=0) lowest=Math.min(lowest,car.body.linvel().x);
    if(hitFrame>=0 && i>=hitFrame+30)break;
  }
  const facts={mass:elasticSlimeMass(scale),initialSpeed:15,lowestSpeed:lowest,speedLoss:15-lowest,hitFrame,hits:layer.stats.bounceHits};
  expect(facts.hits).toBe(1);
  expect(facts.hitFrame).toBe(baseline.hitFrame);
  expect(facts.mass).toBeCloseTo(baseline.mass / 2, 6);
  expect(facts.speedLoss).toBeGreaterThan(0);
  expect(facts.speedLoss).toBeLessThan(baseline.speedLoss);
  car.reset([0,.8,30],-Math.PI/2);
  for(let i=0;i<180;i++) {
    physics.step(1/60,h=>{layer.prepareCar(car);car.update(h,NO_INPUT);layer.handleCar(car);},5,()=>layer.finishPhysicsStep());
    layer.update(1/60);
  }
  const children = (layer as any).lives.filter((live:any)=>live.active && live.tile==='__split__')
    .map((live:any)=>({mass:live.motion.body.mass(),radius:live.spawn.scale[0]}));
  expect(children.length).toBeGreaterThanOrEqual(2);
  for(const child of children)
    expect(child.mass).toBeCloseTo(baseline.mass / 2 * (child.radius / baseline.radius) ** 3, 4);
  expect(children.reduce((sum:number, child:any)=>sum+child.mass,0)).toBeCloseTo(facts.mass*.86,3);
  const out = evidencePath('elastic-mass');
  mkdirSync(out,{recursive:true});
  writeFileSync(resolve(out,'strike.json'),JSON.stringify({before:baseline,after:facts,children},null,2));
  layer.dispose();physics.world.removeRigidBody(car.body);physics.dispose();
});
