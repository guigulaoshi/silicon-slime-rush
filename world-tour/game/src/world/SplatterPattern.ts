/** Metaball parameters use the approved 256-pixel research coordinate system. */
export interface SplatBlob { x:number; y:number; radius:number; aspect:number; angle:number; weight:number }
export interface SplatPattern { blobs:SplatBlob[]; drift:number; seed:number; exposure?:number }
const TAU=Math.PI*2;
export function splatterDrift(speed:number):number { return 13*(1-Math.exp(-.55*Math.max(0,speed)/13)); }
export function coatingFadeRate(speed:number):number { return .035+Math.min(100,Math.abs(speed))*.009; }

/** Seeded samples describe this impact only; no pattern is selected from a reusable library. */
export function splatterPattern(seed:number,speed:number,exposure?:number):SplatPattern {
 let state=seed>>>0;
 const random=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
 const between=(a:number,b:number)=>a+(b-a)*random();
 const normal=()=>Math.sqrt(-2*Math.log(Math.max(1e-8,random())))*Math.cos(TAU*random());
 const blobs:SplatBlob[]=[];
 const add=(x:number,y:number,radius:number,aspect=1,angle=0,weight=1)=>{
  if(radius>.25)blobs.push({x,y,radius,aspect,angle,weight});
 };
 const filament=(sx:number,sy:number,angle:number,length:number,radius:number,taper=.82,wander=.035)=>{
  let x=sx,y=sy;const phase=random()*TAU,lam=between(.8,1.35),step=Math.max(.5,radius*.3);
  for(let s=0;s<length;s+=step){
   const base=radius*(1-taper*s/length);if(base<.28)break;
   const r=base*(1+.52*Math.sin(TAU*s/(9.02*base*lam)+phase)+normal()*.09);
   if(r>.34)add(x,y,r,between(1,1.35),angle);
   angle+=normal()*wander;x+=Math.cos(angle)*step;y+=Math.sin(angle)*step;
  }
  return {x,y};
 };
 const drift=splatterDrift(speed),u=Math.min(1,Math.sqrt(Math.max(0,speed)/83.3));
 if(exposure!==undefined){
  const sweep=.16+Math.max(0,speed)*.021;
  if(exposure>.5){
   const edge=(.3+.55*Math.min(1,(exposure-.5)/.45))*256;
   for(let i=0;i<34;i++)add(between(-30,edge),between(-26,282),between(23,56),between(1,1.6),normal()*.5);
   for(let i=0;i<30;i++)filament(edge+normal()*13,random()*256,normal()*.22,256*sweep*between(.35,1.5),between(1.4,4.2),.8,.02);
  }else if(exposure>-.2){
   for(let i=0;i<Math.max(8,16+52*Math.max(0,exposure));i++){
    const bias=random()**2;
    filament(bias*230,random()*256,normal()*.13,256*sweep*between(.25,1.6)*(1-.45*bias),between(.8,3),.86,.014);
   }
   for(let i=0;i<80;i++)add(random()**2.3*256,random()*256,between(.4,1.5),between(1.3,3.4));
  }else for(let i=0;i<30*(1+Math.max(0,speed)*.012);i++)add(random()*256,random()*256,between(.5,2),between(1,1.9),normal()*.9);
 }else{
  const cx=256*.17,cy=128,ppm=256/7.5,smear=1+1.9*u,core=256*.082*1.15/(1+.35*u),fine=1.25-.55*u;
  const azimuth=()=>between(-Math.PI,Math.PI)*(1-.55*u);
  for(let i=0;i<14;i++){
   const a=random()*TAU,d=Math.abs(normal()*core*.6);
   const radius=between(core*.4,core*.85),aspect=between(1,1.3)*Math.sqrt(smear);
   // Keep the dense core off the texture edge; otherwise a rare seed leaves a rectangular cut.
   add(Math.max(radius*aspect*1.8,cx+Math.cos(a)*d*smear),
    Math.max(radius*1.8,Math.min(256-radius*1.8,cy+Math.sin(a)*d)),radius,aspect,normal()*.25);
  }
  for(let i=0;i<(11+15*u)*1.2;i++){
   const theta=azimuth()+normal()*.14,v=between(1.2,4),vx=v*Math.cos(theta)+drift,vy=v*Math.sin(theta);
   const angle=Math.atan2(vy,vx),r=between(1.3,3.4)*1.2*fine;
   const end=filament(cx+Math.cos(theta)*core*.8,cy+Math.sin(theta)*core*.8,angle,
    Math.min(Math.hypot(vx,vy)*between(.05,.17)*ppm,256*.55),r,.78,.03);
   add(end.x,end.y,r*between(.5,1.1),between(1,1.5),angle);
  }
  const land=(v:number,theta:number,phi:number)=>{
   const vz=v*Math.sin(phi),vx=v*Math.cos(phi)*Math.cos(theta)+drift,vy=v*Math.cos(phi)*Math.sin(theta),t=2*vz/9.81;
   return {x:cx+vx*t*ppm,y:cy+vy*t*ppm,angle:Math.atan2(vy,vx),aspect:1/Math.max(.18,vz/Math.hypot(vz,vx,vy)),t};
  };
  for(let i=0;i<185*(.8+.6*u);i++){
   const p=land(Math.abs(normal()*2.6)+.7,azimuth(),between(11,66)*Math.PI/180);
   if(p.x< -13||p.x>269||p.y< -13||p.y>269)continue;
   const r=between(.8,3)*fine/(1+2*p.t);add(p.x,p.y,r,p.aspect,p.angle);
   if(p.aspect>2&&random()<.55)filament(p.x+Math.cos(p.angle)*r*p.aspect*1.1,p.y+Math.sin(p.angle)*r*p.aspect*1.1,p.angle,r*between(2,5),r*.45);
  }
  for(let i=0;i<220*(.8+.7*u);i++){
   const p=land(Math.abs(normal()*1.9)+.4,azimuth(),between(18,74)*Math.PI/180);
   p.y+=normal()*256*.018*(1+1.4*u);
   if(p.x>0&&p.x<256&&p.y>0&&p.y<256)add(p.x,p.y,between(.3,1.05)*fine,Math.min(4,p.aspect),p.angle);
  }
  for(let i=0;i<9;i++){
   const a=random()*TAU,d=Math.abs(normal()*core*.75);
   add(cx+Math.cos(a)*d*smear,cy+Math.sin(a)*d,between(1.4,4.6),between(1,2),a,-1.3);
  }
 }
 return {blobs,drift,seed,exposure};
}
