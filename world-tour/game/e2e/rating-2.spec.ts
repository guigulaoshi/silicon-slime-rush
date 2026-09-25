import {test,expect,type Page} from '@playwright/test';
import {mkdirSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {evidencePath} from './evidence';
import type {AiDifficulty} from '../src/bot/difficulty';

async function finishWith(page:Page,mode:'none'|AiDifficulty,strong=false){
 return page.evaluate(async({mode,strong})=>{
  const g=window.game as any;
  await g.startRace({trackId:'synth-p2p',vehicleId:'micro-hatch',timeOfDay:'day',slimeDensity:'normal',ai:mode!=='none',aiDifficulty:mode==='none'?'relaxed':mode});
  g.phase='paused';const s=g.session,person=s.humans[0],distance=person.race.spline.length*person.race.totalLaps;
  // Stars read pace against the AI's time in this car on this route. 40 m/s is far past what the
  // AI's micro-hatch reaches on this synthetic sprint, so pace clears five stars with room to spare; the
  // ordinary run's 3 points a metre caps it at three stars whatever its pace.
  const seconds=distance/(strong?40:18),score=Math.round(distance*(strong?6.5:3));
  person.race.state='finished';person.race.time=seconds;person.race.score=score;person.race.slimeHits=strong?25:8;
  for(const [index,racer] of s.racers.filter((r:any)=>r.role==='ai').entries()){
   racer.race.state='finished';racer.race.time=seconds+(mode==='relaxed'?-10:index%2?-10:10);
  }
  for(const racer of s.racers) racer.render(1,1/60);
  const p=person.car.position,w=s.world;
  w.camera.position.set(p.x+7,p.y+4,p.z+9);w.camera.lookAt(p.x,p.y+.4,p.z);
  w.sky.follow(p.x,p.y,p.z);
  g.finish(seconds);
  const result=g.lastResult;
  return {mode,seconds,score,rating:result.rating,rank:result.standings.findIndex((r:any)=>r.role==='human')+1,
   field:result.standings.length};
 },{mode,strong});
}

test('the same personal result ignores all three AI choices and actual finishing rank',async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const results=[];
 for(const mode of ['none','relaxed','rush'] as const){
  const result=await finishWith(page,mode);results.push(result);
  await expect(page.locator('.result-stars .earned')).toHaveCount(result.rating);
  expect(result.rating).toBe(3);
 }
 expect(new Set(results.map(r=>r.rank)).size).toBeGreaterThan(1);
 expect(results.map(r=>r.field)).toEqual([1,9,9]);
 expect(new Set(results.map(r=>JSON.stringify([r.seconds,r.score,r.rating]))).size).toBe(1);
 const out=evidencePath('rating');mkdirSync(out,{recursive:true});
 writeFileSync(resolve(out,'rank-independence.json'),JSON.stringify(results,null,2));
});

for(const strong of [false,true])test(`${strong?'strong':'ordinary'} personal result earns its own stars`,async({page})=>{
 await page.goto('/?dev=1');await page.waitForFunction(()=>window.game);
 const result=await finishWith(page,'rush',strong);
 await expect(page.locator('.result-stars .earned')).toHaveCount(strong?5:3);
 await expect(page.locator('.result-stars .earned[data-revealed=true]')).toHaveCount(strong?5:3);
 await page.locator('.share-card').evaluate(async node=>{
  const url=getComputedStyle(node).backgroundImage.match(/url\(["']?(.*?)["']?\)/)?.[1];
  if(url){const image=new Image();image.src=url;await image.decode();}
 });
 const out=evidencePath('rating');mkdirSync(out,{recursive:true});
 await page.screenshot({path:resolve(out,`${strong?'strong':'ordinary'}.png`)});
 writeFileSync(resolve(out,`${strong?'strong':'ordinary'}.json`),JSON.stringify(result,null,2));
});
