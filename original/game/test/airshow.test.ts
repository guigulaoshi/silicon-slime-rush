import { afterEach, expect, it, vi } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Landmarks } from '../src/world/Landmarks';
import { PhysicsWorld, initPhysics } from '../src/physics/PhysicsWorld';
import { Car, NO_INPUT } from '../src/physics/Car';
import { vehicleFor, vehicleTuning } from '../src/vehicles/catalogue';
import { evidencePath } from '../e2e/evidence';
import { geometryTexturesOnly } from '../test-support/geometry-textures';

afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});
it('the real F-22 mesh stops a monster truck instead of letting it pass through the display', async()=>{
  geometryTexturesOnly();
  const api=await initPhysics(), vehicle=vehicleFor('monster-truck')!;
  const tuning=vehicleTuning(vehicle,vehicle.tuning as any);
  const bytes=readFileSync('public/models/landmarks/moffett-f22-raptor.glb');
  vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>{
    const buffer=new ArrayBuffer(bytes.length);new Uint8Array(buffer).set(bytes);
    return {ok:true,arrayBuffer:async()=>buffer};
  }));
  const rows=[];
  for(const collision of [false,true]){
    const physics=new PhysicsWorld(api,tuning.gravity);
    physics.add('floor',{boxes:[{center:[0,-.5,0],half:[100,.5,100],yaw:0}],trimeshes:[]});
    const landmarks=new Landmarks([{id:'moffett-f22-raptor',file:'f22.glb',pos:[0,0,0],yaw:0,loadRadius:100,collision}],'.','day',physics);
    await landmarks.prepare([{x:0,z:-20}]);expect(landmarks.root.children).toHaveLength(1);
    const car=new Car(physics,tuning,{pos:[0,2,-20],yaw:Math.PI});
    for(let i=0;i<120;i++){car.update(1/60,NO_INPUT);physics.world.step();}
    car.body.setLinvel({x:0,y:0,z:18},true);
    let farthest=-20;
    for(let i=0;i<240;i++){car.update(1/60,NO_INPUT);physics.world.step();farthest=Math.max(farthest,car.position.z);}
    rows.push({collision,farthest,final:car.position.toArray()});
    landmarks.dispose();physics.dispose();
  }
  expect(rows[0]!.farthest,'control passes through the uncollidable aircraft').toBeGreaterThan(10);
  expect(rows[1]!.farthest,'real nose/body blocks the vehicle before its centre crosses the aircraft').toBeLessThan(0);
  const out=evidencePath('airshow');mkdirSync(out,{recursive:true});
  writeFileSync(resolve(out,'monster-impact.json'),JSON.stringify({speed:18,seconds:4,rows},null,2));
});
