import * as THREE from 'three';
import type { I18n } from './i18n';
import { el } from './Ui';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { MenuAction } from '../input/types';
import { actionIcon, fitReplica, replicaButton } from './Replica';

// Only avoid the spherical poles, where yaw and lookAt's up vector become ambiguous.
const clampPitch = (pitch: number): number => THREE.MathUtils.clamp(pitch, -Math.PI / 2 + .001, Math.PI / 2 - .001);

export function orbitOffset(yaw: number, pitch: number, distance: number): THREE.Vector3 {
  const elevation = clampPitch(pitch);
  const radius = THREE.MathUtils.clamp(distance, 3, 35);
  return new THREE.Vector3(Math.sin(yaw) * Math.cos(elevation), Math.sin(elevation),
    Math.cos(yaw) * Math.cos(elevation)).multiplyScalar(radius);
}

export class PhotoMode {
  readonly node = el('section', 'photo-controls replica');
  private readonly title = el('span');
  private readonly mode = el('span');
  private readonly zoom = document.createElement('input');
  private readonly flash = el('div','photo-flash');
  private readonly unfit: () => void;
  private readonly buttons = new Map<string, HTMLButtonElement>();
  private cameras: THREE.PerspectiveCamera[] = [];
  private originals: THREE.PerspectiveCamera[] = [];
  private subjects: { position: THREE.Vector3; height: number }[] = [];
  private orbits: { yaw: number; pitch: number; distance: number }[] = [];
  private physics: PhysicsWorld | null = null;
  private player = 0;
  private drag: { pointerId: number; x: number; y: number } | null = null;
  open = false;

  constructor(private readonly t: I18n, private readonly capture: (player: number) => void,
    private readonly help: () => void = () => {}) {
    this.node.hidden = true;
    for (const key of ['player', 'capture', 'close', 'help']) {
      const button = replicaButton('',key==='help'?'help':undefined,key==='capture'?'shutter':'');
      if (key === 'help') button.lastElementChild!.remove();
      button.dataset.photo = key;
      button.onclick = () => this.choose(key);
      this.buttons.set(key, button);
    }
    this.node.addEventListener('keydown', event => {
      if (event.code === 'Enter' || event.code === 'Space') event.stopPropagation();
    });
    window.addEventListener('pointerdown', this.pointerDown);
    window.addEventListener('pointermove', this.pointerMove, { passive: false });
    window.addEventListener('pointerup', this.pointerUp);
    window.addEventListener('pointercancel', this.pointerUp);
    const frame=el('div','replica-frame'),top=el('div','photo-top'),paused=el('span');
    paused.append(actionIcon('pause'),this.title);top.append(this.buttons.get('close')!,paused,this.buttons.get('help')!);
    const finder=el('div','viewfinder');finder.setAttribute('aria-hidden','true');for(let i=0;i<4;i++)finder.append(el('i'));
    const rail=el('div','photo-bottom'),zoom=el('label');
    this.zoom.type='range';this.zoom.min='3';this.zoom.max='35';this.zoom.step='.1';this.zoom.dataset.photo='zoom';
    this.zoom.oninput=()=>{const orbit=this.orbits[this.player];if(orbit){orbit.distance=38-Number(this.zoom.value);this.update();}};
    this.zoom.addEventListener('keydown',e=>{if(e.code!=='Escape'&&e.code!=='Tab')e.stopPropagation();});
    zoom.append(actionIcon('zoom'),this.zoom);rail.append(this.buttons.get('capture')!,zoom,this.mode,this.buttons.get('player')!);
    this.flash.setAttribute('aria-hidden','true');frame.append(top,finder,rail,this.flash);this.node.append(frame);
    document.body.append(this.node);
    this.unfit=fitReplica(this.node,frame);
  }

  show(cameras: THREE.PerspectiveCamera[], subjects: { position: THREE.Vector3; height: number }[], physics: PhysicsWorld): void {
    this.cameras = cameras; this.originals = cameras.map(camera => camera.clone());
    this.subjects = subjects; this.physics = physics; this.player = 0;
    this.orbits = cameras.map((camera, index) => {
      const delta = camera.position.clone().sub(subjects[index]!.position);
      return {yaw: Math.atan2(delta.x, delta.z), pitch: 0.35, distance: Math.max(8, delta.length())};
    });
    this.open = true; this.node.hidden = false;
    document.documentElement.classList.add('photo-active');
    this.render(); this.update();
  }

  close(): void {
    if (!this.open) return;
    this.cameras.forEach((camera, index) => camera.copy(this.originals[index]!));
    this.open = false; this.node.hidden = true; this.physics = null;
    this.drag = null;
    document.documentElement.classList.remove('photo-active');
    document.documentElement.classList.remove('photo-dragging');
  }

  dispose(): void {
    this.close(); this.unfit(); this.node.remove();
    window.removeEventListener('pointerdown', this.pointerDown);
    window.removeEventListener('pointermove', this.pointerMove);
    window.removeEventListener('pointerup', this.pointerUp);
    window.removeEventListener('pointercancel', this.pointerUp);
  }

  private readonly pointerDown = (event: PointerEvent): void => {
    if (!this.open || !event.isPrimary || (event.pointerType === 'mouse' && event.button !== 0)) return;
    if (event.target instanceof Element && event.target.closest('.photo-controls,dialog,button')) return;
    this.drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY };
    document.documentElement.classList.add('photo-dragging');
    if (event.target instanceof Element && 'setPointerCapture' in event.target) {
      (event.target as Element & { setPointerCapture(id: number): void }).setPointerCapture(event.pointerId);
    }
    event.preventDefault();
  };

  private readonly pointerMove = (event: PointerEvent): void => {
    if (!this.open || event.pointerId !== this.drag?.pointerId) return;
    const orbit = this.orbits[this.player]; if (!orbit) return;
    const dx = event.clientX - this.drag.x, dy = event.clientY - this.drag.y;
    this.drag.x = event.clientX; this.drag.y = event.clientY;
    orbit.yaw -= dx * .008;
    orbit.pitch = clampPitch(orbit.pitch + dy * .006);
    this.update();
    event.preventDefault();
  };

  private readonly pointerUp = (event: PointerEvent): void => {
    if (event.pointerId !== this.drag?.pointerId) return;
    this.drag = null;
    document.documentElement.classList.remove('photo-dragging');
  };

  action(action: MenuAction, player = this.player): void {
    if (player < this.cameras.length) this.player = player;
    this.choose(action === 'back' || action === 'pause' ? 'close' : action === 'confirm' ? 'capture' : action);
  }

  private choose(key: string): void {
    const orbit = this.orbits[this.player]; if (!orbit) return;
    if (key === 'close') { this.close(); return; }
    if (key === 'capture') { this.flash.animate?.([{opacity:1},{opacity:0}],{duration:220});this.capture(this.player); return; }
    if (key === 'help') { this.help(); return; }
    if (key === 'player') this.player = (this.player + 1) % this.cameras.length;
    if (key === 'left') orbit.yaw -= 0.2;
    if (key === 'right') orbit.yaw += 0.2;
    if (key === 'up') orbit.pitch = clampPitch(orbit.pitch + 0.12);
    if (key === 'down') orbit.pitch = clampPitch(orbit.pitch - 0.12);
    if (key === 'in') orbit.distance = Math.max(3, orbit.distance - 2);
    if (key === 'out') orbit.distance = Math.min(35, orbit.distance + 2);
    this.render(); this.update();
  }

  render(): void {
    this.title.textContent = this.t.t('replica.worldPaused');this.mode.textContent=this.t.t('replica.photoLabel');
    this.buttons.get('player')!.querySelector('span')!.textContent=this.t.t('photo.player',{player:this.player+1});
    this.buttons.get('close')!.replaceChildren(actionIcon('close'),el('span','',this.t.t('replica.exitPhoto')));
    this.buttons.get('capture')!.setAttribute('aria-label',this.t.t('replica.capturePhoto'));
    this.buttons.get('help')!.setAttribute('aria-label',this.t.t('help.title'));
    this.zoom.setAttribute('aria-label',this.t.t('replica.zoom'));
    this.zoom.value=String(38-(this.orbits[this.player]?.distance??8));
    this.buttons.get('player')!.hidden = this.cameras.length < 2;
  }

  update(): void {
    const physics = this.physics;
    if (!this.open || !physics) return;
    this.cameras.forEach((camera, index) => {
      const subject = this.subjects[index]!, orbit = this.orbits[index]!;
      const target = subject.position.clone().add(new THREE.Vector3(0, Math.max(1, subject.height * 0.6), 0));
      const desired = target.clone().add(orbitOffset(orbit.yaw, orbit.pitch, orbit.distance));
      const position = physics.cameraPosition(target, desired);
      camera.position.set(position.x, position.y, position.z);
      camera.near = 0.1; camera.fov = 55; camera.lookAt(target); camera.updateProjectionMatrix();
    });
  }
}
