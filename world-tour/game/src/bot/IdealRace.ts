import type {CarTuning} from '../physics/CarTuning';
import {poweredWheelCount} from '../physics/CarTuning';
import {engineDriveForce,longitudinalGrip} from '../physics/Powertrain';
import {STOP_SECONDS} from '../track/Race';
import type {Spline} from '../track/Spline';
import type {TrackData,CarKind} from '../track/types';
import {vehicleTuning,type VehicleDefinition} from '../vehicles/catalogue';

/** Dry, unobstructed centreline bound: optimal pedals, aligned tyres, no traffic or landing delays.
 * It is a physical speed-envelope calculation, never a timed lap by another AI. */
export class IdealRace {
  readonly seconds: number;
  readonly speeds: Float64Array;
  private readonly tuning: CarTuning;
  private readonly trailer: CarTuning | null;
  private readonly segment: Float64Array;
  private readonly grade: Float64Array;
  private readonly corners: Float64Array;
  constructor(readonly spline: Spline, private readonly track: TrackData, vehicle: VehicleDefinition) {
    this.tuning=vehicleTuning(vehicle,vehicle.tuning as CarKind);
    this.trailer=vehicle.trailer?vehicleTuning(vehicle.trailer):null;
    const n=spline.count;
    this.segment=new Float64Array(n);this.grade=new Float64Array(n);this.corners=new Float64Array(n);
    for(let i=0;i<n;i++){
      const a=spline.point(i),b=spline.point(i+1);
      this.segment[i]=i===n-1?spline.closed?spline.length-spline.s[i]!:0:spline.s[i+1]!-spline.s[i]!;
      this.grade[i]=this.segment[i]!>0?(b[1]-a[1])/this.segment[i]!:0;
      const k=Math.abs(spline.curvature[i]!);
      const t=this.tuning;
      this.corners[i]=Math.min(t.maxSpeed,k>1e-6?Math.sqrt(t.maxLateralAccel/k):Infinity,k>1e-6?t.maxYawRate/k:Infinity);
    }
    // Stops remain stops in the mathematical run; the race owns their dwell duration.
    for(const gate of track.checkpoints)if(gate.stop)this.corners[spline.indexAt(gate.s)]=0;
    this.speeds=this.brakingEnvelope(this.corners);
    this.seconds=this.timeFor(this.speeds);
  }
  private acceleration(speed:number,index:number,braking=false):number {
    const t=this.tuning,tr=this.trailer,mass=t.mass+(tr?.mass??0),g=Math.abs(t.gravity);
    const k=Math.abs(this.spline.curvature[index]!);
    const load=t.mass*g+t.downforce*speed*speed;
    const lateralUse=Math.min(1,t.mass*speed*speed*k/Math.max(load*t.gripLimit,1));
    const grip=longitudinalGrip(load,t.gripLongitudinal,1,lateralUse,t.gripReserve);
    const trailerLoad=(tr?.mass??0)*g;
    const trailerGrip=tr?longitudinalGrip(trailerLoad,tr.gripLongitudinal,1,lateralUse,tr.gripReserve):0;
    const force=braking?Math.min(t.brakeForce,grip)+(tr?Math.min(tr.brakeForce,trailerGrip):0)
      :Math.min(engineDriveForce(t,speed),grip*poweredWheelCount(t.drive,t.wheels.length)/t.wheels.length);
    const resistance=((t.airResistance??0)+(tr?.airResistance??0))*speed*speed
      +(t.linearDamping*t.mass+(tr?tr.linearDamping*tr.mass:0))*speed+trailerLoad*.015;
    const hill=g*this.grade[index]!;
    return braking?(force+resistance)/mass+hill:(force-resistance)/mass-hill;
  }
  private brakingEnvelope(limits:Float64Array):Float64Array {
    const v=limits.slice(),n=v.length;
    // Two trips propagate a closed circuit's end bend back across its seam.
    for(let pass=0;pass<(this.spline.closed?2:1);pass++)for(let i=n-1;i>=0;i--){
      const d=this.segment[i]!;if(d<=0)continue;
      const next=(i+1)%n;
      v[i]=Math.min(v[i]!,Math.sqrt(Math.max(0,v[next]!**2+2*this.acceleration(v[next]!,i,true)*d)));
    }
    return v;
  }
  private timeFor(limits:Float64Array):number {
    const n=limits.length,segments=this.spline.closed?n:n-1,laps=this.track.mode==='loop'?this.track.laps:1;
    let speed=0,time=0;
    for(let lap=0;lap<laps;lap++) {
      for(let i=0;i<segments;i++){
      const distance=this.segment[i]!,next=(i+1)%n;
      // Midpoint force captures falling wheel power as speed rises, rather than pricing a whole
      // two-metre segment at its slower entry speed.
      const trial=Math.sqrt(Math.max(0,speed*speed+2*this.acceleration(speed,i)*distance));
      const out=Math.min(limits[next]!,Math.sqrt(Math.max(0,speed*speed+2*this.acceleration((speed+trial)/2,i)*distance)));
      if(speed+out<=1e-8&&distance>0)return Infinity;
      time+=2*distance/Math.max(speed+out,1e-8);speed=out;
      if(this.track.checkpoints.some(g=>g.stop&&this.spline.indexAt(g.s)===next))time+=STOP_SECONDS;
    }
    }
    return time;
  }
}
