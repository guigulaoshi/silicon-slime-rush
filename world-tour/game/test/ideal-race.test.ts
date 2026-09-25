import {readFileSync,readdirSync} from 'node:fs';
import {expect,it} from 'vitest';
import {IdealRace} from '../src/bot/IdealRace';
import {Spline} from '../src/track/Spline';
import {parseTrack} from '../src/track/schema';
import {VEHICLES,vehicleFor} from '../src/vehicles/catalogue';
import {slimeLane,type SlimeTarget} from '../src/bot/SlimeDriving';
import {planTraffic} from '../src/bot/Traffic';
const load=(id:string)=>parseTrack(JSON.parse(readFileSync(`public/tracks/${id}/track.json`,'utf8')));

it('produces finite positive physical times on every built route and every vehicle',()=>{
  // The roster is pipeline/routes (tools/assets.py track_ids); removed routes can leave exported
  // directories behind under public/tracks, and those are not routes.
  const ids=[...readdirSync('../pipeline/routes').filter(f=>f.endsWith('.json')).map(f=>f.slice(0,-5)),
    'synth-loop','synth-p2p','synth-stops'];
  expect(ids.length).toBeGreaterThan(5);
  let count=0;
  for(const id of ids)for(const vehicle of VEHICLES){
    const track=load(id),ideal=new IdealRace(new Spline(track),track,vehicle);
    expect(ideal.seconds,`${id}/${vehicle.id}`).toBeGreaterThan(0);
    expect(Number.isFinite(ideal.seconds),`${id}/${vehicle.id}`).toBe(true);
    count++;
  }
  expect(count).toBe(ids.length*VEHICLES.length);
});
it('prices power, curvature, trailer inertia and compulsory stops independently of any driver',()=>{
  const track=load('synth-p2p');
  const time=(t=track,v=vehicleFor('sports-car')!)=>new IdealRace(new Spline(t),t,v).seconds;
  const sport=time();
  expect(time(track,vehicleFor('micro-hatch')!)).toBeGreaterThan(sport);
  const curves=structuredClone(track);curves.spline.curvature=curves.spline.curvature!.map(k=>k*2);
  expect(time(curves)).toBeGreaterThan(sport);
  const stops=structuredClone(track);stops.checkpoints[2]!.stop=true;
  expect(time(stops)).toBeGreaterThan(sport+1);
  const rig=vehicleFor('pickup-travel-trailer')!;
  expect(time(track,rig)).toBeGreaterThan(time(track,{...rig,trailer:undefined}));
});
it('keeps slime lanes inside a narrowing road and never stops for an unavoidable soft body',()=>{
  const track=load('synth-p2p');track.spline.halfWidth.fill(2);
  const spline=new Spline(track),at={s:100,lateral:0,index:spline.indexAt(100)};
  const own=[{driver:'car',s:100,lateral:0,halfWidth:1,halfLength:2,speed:15}];
  const bad:SlimeTarget={driver:'slime:1',kind:'burst',s:125,lateral:0,halfWidth:4,halfLength:4,speed:0};
  expect(slimeLane(spline,at,own,own,[bad],15,8,0,1)).toBe(0);
  expect(Math.abs(planTraffic(spline,at,own,own,15,8,0,5).offset)).toBeLessThanOrEqual(.2);
});

it('does not cut across a car alongside to collect a boost',()=>{
  const track=load('synth-p2p');track.spline.halfWidth.fill(8);
  const spline=new Spline(track),at={s:100,lateral:0,index:spline.indexAt(100)};
  const own=[{driver:'car',s:100,lateral:0,halfWidth:1,halfLength:2,speed:15}];
  const other={driver:'other',s:99,lateral:4,halfWidth:1,halfLength:2,speed:15};
  const boost:SlimeTarget={driver:'boost',kind:'boost',s:130,lateral:4,halfWidth:1,halfLength:1,speed:0};
  expect(slimeLane(spline,at,own,[...own,other],[boost],15,8,0,1)).toBe(0);
});

