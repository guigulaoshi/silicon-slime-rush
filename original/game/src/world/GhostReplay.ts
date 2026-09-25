import { Color, Mesh, MeshStandardMaterial, type Scene } from 'three';
import { ghostFrames, ghostPose, type GhostData, type GhostFrame } from '../app/Ghost';
import { vehicleFor } from '../vehicles/catalogue';
import { VehicleModel } from '../vehicles/VehicleModel';

/** Visual-only replay: no rigid body, contacts, score callbacks, or scenery requests. */
export class GhostReplay {
  private models: VehicleModel[]=[];
  private frames: GhostFrame[]=[];
  private request: AbortController | null=null;
  constructor(private readonly scene:Scene) {}
  get visible(): boolean {return this.models.some(model=>model.group.visible);}
  private loadedVehicle: string | null=null;
  /** onLoaded runs only when new models entered the scene, so the caller can compile them before they are seen. */
  async set(data:GhostData|null,onLoaded?:()=>void):Promise<void> {
    const frames=data?ghostFrames(data):null,vehicle=data?vehicleFor(data.vehicle):undefined;
    // A new best with the same body only changes the path: keeping the models keeps their compiled programs.
    if(data&&frames&&this.models.length&&this.loadedVehicle===data.vehicle) {this.frames=frames;return;}
    this.clear();
    if(!data||!frames||!vehicle||!!vehicle.trailer!==data.trailer) return;
    const request=new AbortController();this.request=request;
    const loaded:VehicleModel[]=[];
    try {
      for(const body of [vehicle,...(vehicle.trailer?[vehicle.trailer]:[])]) loaded.push(await VehicleModel.load(body,request.signal));
      if(request.signal.aborted) {loaded.forEach(model=>model.dispose());return;}
      this.models=loaded;this.frames=frames;
      for(const model of loaded) {
        model.setOpacity(.28);model.group.name='personal-best-ghost';model.group.visible=false;
        model.group.traverse(node=>{
          if (!(node instanceof Mesh)) return;
          node.castShadow=false;
          for (const material of Array.isArray(node.material) ? node.material : [node.material]) {
            if (material instanceof MeshStandardMaterial) {
              material.color.lerp(new Color(0x65e9ff), .65);
              material.emissive.set(0x247b8d); material.emissiveIntensity=.45;
            }
          }
        });
        this.scene.add(model.group);
      }
      this.loadedVehicle=data.vehicle;
      onLoaded?.();
    } catch {loaded.forEach(model=>model.dispose());}
  }
  update(time:number):void {
    this.models.forEach((model,index)=>{
      const pose=ghostPose(this.frames,time,index);model.group.visible=!!pose;
      if(pose) {model.group.position.copy(pose.position);model.group.quaternion.copy(pose.quaternion);}
    });
  }
  private clear():void {this.request?.abort();this.models.forEach(model=>model.dispose());this.models=[];this.frames=[];this.loadedVehicle=null;}
  dispose():void {this.clear();}
}
