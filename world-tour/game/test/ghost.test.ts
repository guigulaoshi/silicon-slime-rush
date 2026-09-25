import { expect, it } from 'vitest';
import { GhostRecorder, ghostFrames, ghostPose, MAX_GHOST_SAMPLES, MAX_GHOST_STORAGE, MAX_GHOSTS } from '../src/app/Ghost';
import { Save, SAVE_KEY, migrate } from '../src/app/Save';
import { memoryGhostStore } from './ghostStoreFake';
const body=(x:number)=>({position:{x,y:1.234,z:-3.456},quaternion:{x:0,y:0,z:0,w:1}});
function recording(duration=10,trailer=false,count=2) {
 const recorder=new GhostRecorder(trailer?'pickup-travel-trailer':'micro-hatch',trailer);
 for(let i=0;i<count;i++) recorder.sample(i*duration/(count-1),body(i),0,trailer?body(i-5):null,true);
 return recorder.finish(duration)!;
}
it('packs centimeter positions and preserves time, rotation and trailer independently',()=>{
 const data=recording(10,true),frames=ghostFrames(data)!;
 expect(frames).toHaveLength(2);expect(data.data.length).toBe(128);
 expect(ghostPose(frames,5)!.position.x).toBeCloseTo(.5);
 expect(ghostPose(frames,5,1)!.position.x).toBeCloseTo(-4.5);
 expect(ghostPose(frames,5)!.position.y).toBeCloseTo(1.23);
 expect(ghostPose(frames,5)!.quaternion.w).toBe(1);
 expect(ghostPose(frames,11)).toBeNull();
});
it('never interpolates a rescue teleport across the road',()=>{
 const r=new GhostRecorder('micro-hatch',false);
 r.sample(0,body(0),0);r.sample(1,body(100),1);const frames=ghostFrames(r.finish(1))!;
 expect(ghostPose(frames,.5)!.position.x).toBe(0);expect(ghostPose(frames,1)!.position.x).toBe(100);
});
it('bounds a three-hour recording and retains both endpoints',()=>{
 const r=new GhostRecorder('micro-hatch',false);
 for(let i=0;i<=108000;i++) r.sample(i/10,body(i/10),0);
 r.sample(10800,body(10800),0,null,true);
 const data=r.finish(10800)!,frames=ghostFrames(data)!;
 expect(frames.length).toBeLessThanOrEqual(MAX_GHOST_SAMPLES);expect(frames[0]!.time).toBe(0);expect(frames.at(-1)!.time).toBe(10800);
 expect(data.data.length).toBeLessThanOrEqual(Math.ceil(MAX_GHOST_SAMPLES*28/3)*4);
});
it('rejects truncated, nonfinite, wrong-duration and bad quaternion payloads',()=>{
 const data=recording();
 for(const patch of [{data:'invalid'},{samples:0},{samples:MAX_GHOST_SAMPLES+1},{duration:NaN},{duration:100},{version:2}]) expect(ghostFrames({...data,...patch})).toBeNull();
 const bytes=Uint8Array.from(atob(data.data),c=>c.charCodeAt(0));bytes.fill(0,20,28);
 expect(ghostFrames({...data,data:btoa(String.fromCharCode(...bytes))})).toBeNull();
});
it('replaces a replay only together with a new best, survives reload, and clears mismatched legacy records',async()=>{
 const disk=new Map<string,string>();const storage={getItem:(key:string)=>disk.get(key)??null,setItem:(key:string,value:string)=>{disk.set(key,value);}};
 const store=memoryGhostStore(),reload=async()=>{const next=new Save(storage,store);await next.ghostsReady;return next;};
 const save=new Save(storage,store),first=recording();
 expect(save.record('synth-p2p',10,first)).toBe(true);
 expect(save.record('synth-p2p',12,recording(12))).toBe(false);
 expect((await reload()).ghost('synth-p2p')).toEqual(first);
 const faster=recording(8);save.record('synth-p2p',8,faster);expect((await reload()).ghost('synth-p2p')).toEqual(faster);
 save.record('synth-p2p',7);expect(save.ghost('synth-p2p')).toBeNull();
 expect(migrate({best:{x:10},ghosts:{x:{...first,duration:9}}}).ghosts).toEqual({});
 expect(disk.get(SAVE_KEY)).toBeDefined();
});
it('caps all ghost payloads while keeping every best time and the newest replay',()=>{
 const save=new Save(null),data=recording(10,false,MAX_GHOST_SAMPLES);
 for(let i=0;i<60;i++) save.record(`track-${i}`,10,data);
 expect(JSON.stringify(save.all.ghosts).length).toBeLessThanOrEqual(MAX_GHOST_STORAGE);
 expect(Object.keys(save.all.ghosts).length).toBeLessThanOrEqual(MAX_GHOSTS);
 expect(Object.keys(save.all.best)).toHaveLength(60);expect(save.ghost('track-59')).toEqual(data);
});
it('disabled browser storage still permits a complete drive and in-session replay',()=>{
 const save=new Save({getItem:()=>null,setItem:()=>{throw new Error('quota');}});
 expect(save.record('synth-p2p',10,recording())).toBe(true);expect(save.ghost('synth-p2p')).not.toBeNull();
});

it('keeps the last pre-rescue step and first post-rescue step after long-drive decimation',()=>{
 const r=new GhostRecorder('micro-hatch',false);
 for(let i=0;i<=20000;i++) r.sample(i/60,body(i),i<18000?0:1);
 r.sample(20000/60,body(20000),1,null,true);
 const frames=ghostFrames(r.finish(20000/60))!;
 const jump=frames.findIndex(f=>f.revision===1);
 expect(frames[jump]!.time-frames[jump-1]!.time).toBeCloseTo(1/60,3);
 expect(ghostPose(frames,frames[jump-1]!.time)!.position.x).toBeCloseTo(17999);
 expect(ghostPose(frames,frames[jump]!.time)!.position.x).toBeCloseTo(18000);
});
it('keeps memory bounded even when every sample is a rescue boundary',()=>{
 const recorder=new GhostRecorder('micro-hatch',false);
 for(let i=0;i<MAX_GHOST_SAMPLES*2;i++) recorder.sample(i,body(i),i);
 expect(recorder.frames.length).toBeLessThanOrEqual(MAX_GHOST_SAMPLES);
 expect(recorder.finish(MAX_GHOST_SAMPLES*2-1)).toBeNull();
});
