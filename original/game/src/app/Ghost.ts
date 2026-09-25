import { Quaternion, Vector3 } from 'three';

export const MAX_GHOST_SAMPLES = 2048;
/**
 * Replays are kept per route, direction and car in IndexedDB. One car's replays
 * for all 16 route directions measure about 0.9 MB, so the cap holds every route in every car of a
 * garage twice today's size, and all of them fit in memory at once.
 */
export const MAX_GHOSTS = 512;
export const MAX_GHOST_STORAGE = 32_000_000;
export interface GhostPose { position: {x:number;y:number;z:number}; quaternion: {x:number;y:number;z:number;w:number}; }
export interface GhostFrame { time: number; revision: number; pose: number[]; }
export interface GhostData { version: 1; vehicle: string; duration: number; trailer: boolean; samples: number; data: string; }
const values = (body: GhostPose) => [body.position.x,body.position.y,body.position.z,body.quaternion.x,body.quaternion.y,body.quaternion.z,body.quaternion.w];

/** Sampling decimates uniformly when a long drive reaches the fixed memory budget. */
export class GhostRecorder {
  readonly frames: GhostFrame[] = [];
  private interval = .1;
  private previous: GhostFrame | null = null;
  private disabled = false;
  constructor(readonly vehicle: string, readonly trailer: boolean) {}
  sample(time: number, body: GhostPose, revision: number, trailer?: GhostPose | null, force = false): void {
    if (this.disabled || !Number.isFinite(time) || time < 0 || (this.previous && time < this.previous.time)) return;
    const frame = { time, revision, pose: [...values(body), ...(this.trailer && trailer ? values(trailer) : [])] };
    if (frame.pose.length !== (this.trailer ? 14 : 7) || frame.pose.some(n => !Number.isFinite(n))) return;
    const previous = this.previous; this.previous = frame;
    const last = this.frames.at(-1);
    if (previous && previous.revision !== revision) {
      this.append(previous); force = true;
    }
    if (!force && last && time-last.time < this.interval && last.revision === revision) return;
    this.append(frame);
  }
  private append(frame: GhostFrame): void {
    if (this.disabled) return;
    if (this.frames.at(-1)?.time === frame.time) { this.frames[this.frames.length-1] = frame; return; }
    if (this.frames.length >= MAX_GHOST_SAMPLES) {
      const retained = this.frames.filter((sample,index,all) => index === 0 || index === all.length-1
        || all[index-1]!.revision !== sample.revision || all[index+1]!.revision !== sample.revision || index%2 === 0);
      // More than a thousand rescue boundaries cannot fit without inventing motion: keep the best time, omit this replay.
      if (retained.length >= MAX_GHOST_SAMPLES) { this.disabled = true; this.frames.length = 0; return; }
      this.frames.splice(0,this.frames.length,...retained); this.interval *= 2;
    }
    this.frames.push(frame);
  }
  finish(duration: number): GhostData | null {
    if (this.frames.length < 2 || !(duration > 0)) return null;
    const stride = this.trailer ? 48 : 28;
    const bytes = new Uint8Array(this.frames.length*stride), view = new DataView(bytes.buffer);
    this.frames.forEach((frame,index) => {
      let offset=index*stride;
      view.setFloat32(offset,frame.time,true); offset+=4;
      view.setUint32(offset,frame.revision,true); offset+=4;
      for(let body=0;body<(this.trailer?2:1);body++) {
        for(let axis=0;axis<3;axis++,offset+=4) view.setInt32(offset,Math.round(frame.pose[body*7+axis]!*100),true);
        for(let axis=3;axis<7;axis++,offset+=2) view.setInt16(offset,Math.round(frame.pose[body*7+axis]!*32767),true);
      }
    });
    let binary=''; for(const byte of bytes) binary+=String.fromCharCode(byte);
    return {version:1,vehicle:this.vehicle,duration,trailer:this.trailer,samples:this.frames.length,data:btoa(binary)};
  }
}

/** Decode the bounded persisted payload once, rejecting corrupt or incompatible records. */
export function ghostFrames(raw: unknown): GhostFrame[] | null {
  if (!raw || typeof raw !== 'object') return null;
  const data=raw as GhostData;
  if(data.version!==1 || typeof data.vehicle!=='string' || typeof data.trailer!=='boolean' || !Number.isFinite(data.duration) || data.duration<=0
    || !Number.isInteger(data.samples) || data.samples<2 || data.samples>MAX_GHOST_SAMPLES || typeof data.data!=='string'
    || data.data.length>MAX_GHOST_SAMPLES*64) return null;
  try {
    const binary=atob(data.data),stride=data.trailer?48:28;
    if(binary.length!==data.samples*stride) return null;
    const bytes=Uint8Array.from(binary,c=>c.charCodeAt(0)), view=new DataView(bytes.buffer), frames:GhostFrame[]=[];
    for(let index=0;index<data.samples;index++) {
      let offset=index*stride;
      const time=view.getFloat32(offset,true);offset+=4;
      const revision=view.getUint32(offset,true);offset+=4;
      if(!Number.isFinite(time)||time<0||time>data.duration+.01||(index>0&&time<=frames[index-1]!.time)) return null;
      const pose:number[]=[];
      for(let body=0;body<(data.trailer?2:1);body++) {
        for(let axis=0;axis<3;axis++,offset+=4) pose.push(view.getInt32(offset,true)/100);
        let norm=0;
        for(let axis=3;axis<7;axis++,offset+=2) {const q=view.getInt16(offset,true)/32767;pose.push(q);norm+=q*q;}
        if(Math.abs(norm-1)>.01) return null;
      }
      frames.push({time,revision,pose});
    }
    if(frames[0]!.time>.01 || Math.abs(frames.at(-1)!.time-data.duration)>.01) return null;
    return frames;
  } catch {return null;}
}

export function ghostPose(frames: readonly GhostFrame[], time: number, body=0): {position:Vector3;quaternion:Quaternion} | null {
  if(!frames.length||time<0||time>frames.at(-1)!.time) return null;
  let low=0,high=frames.length-1;
  while(low+1<high) {const middle=(low+high)>>1;if(frames[middle]!.time<=time) low=middle;else high=middle;}
  const a=frames[low]!,b=frames[high]!, offset=body*7;
  const fraction=b.time===a.time?0:Math.max(0,Math.min(1,(time-a.time)/(b.time-a.time)));
  const chosen=a.revision!==b.revision&&fraction<1?a:b;
  const f=a.revision===b.revision?fraction:chosen===a?0:1;
  const position=new Vector3().fromArray(a.pose,offset).lerp(new Vector3().fromArray(b.pose,offset),f);
  const quaternion=new Quaternion().fromArray(a.pose,offset+3).normalize().slerp(new Quaternion().fromArray(b.pose,offset+3).normalize(),f);
  return {position,quaternion};
}
