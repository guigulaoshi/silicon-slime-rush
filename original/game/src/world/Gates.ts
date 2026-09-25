import * as THREE from 'three';
import { drivableGateCount } from '../track/Race';
import type { Checkpoint } from '../track/types';

/**
 * Floating holograms over the road at every checkpoint.
 *
 * Checkpoints must be readable before their streamed tile arrives, so they stay in the resident
 * runtime scene. They deliberately have no posts, beam or collider: a translucent numbered panel
 * hanging in empty air reads as navigation UI inside the world, not as road furniture.
 */
const HOLOGRAM_HEIGHT = 4.6;
const OVERHANG = 0.7;
const LABEL_ASPECT = 4;
const LABEL_WIDTH_PCT = 0.92;

const AHEAD = 0x5ffcff;
const FINISH = 0xff4fd8;
const CLEARED = 0x28465a;
const GLOW_AHEAD = 0x20cfff;
const GLOW_FINISH = 0xff2bc2;
const GLOW_DONE = 0x183345;

/**
 * How far the race surface sits above `checkpoint.pos.y`. `docs/CONTRACT.md` section 4 owns the
 * number; the pipeline's copy is `ROAD_LIFT` in `sr/roads.py`.
 */
export const ROAD_LIFT = 0.06;

// The start/finish line a circuit gets instead of a hologram, painted on the road like a real one.
const LINE = 0xf4f4f0;
const LINE_GLOW = 0x6e6e6a;
const SQUARE = 1.3;
const LINE_LIFT = ROAD_LIFT + 0.03;

export type CheckpointTextureFactory = (index: number, total: number) => THREE.Texture;

/** Draw one normally proportioned, numbered hologram label. */
export function checkpointLabelTexture(
  label: string,
  index: number,
  total: number,
  canvas: HTMLCanvasElement = document.createElement('canvas'),
): THREE.CanvasTexture {
  canvas.width = 1024;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(1, 14, 30, 0.58)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = 'rgba(65, 224, 255, 0.13)';
    for (let y = 8; y < canvas.height; y += 16) ctx.fillRect(0, y, canvas.width, 2);
    ctx.fillStyle = '#5ffcff';
    ctx.fillRect(0, 0, canvas.width, 7);
    ctx.fillRect(0, canvas.height - 7, canvas.width, 7);
    ctx.fillRect(0, 0, 7, canvas.height);
    ctx.fillRect(canvas.width - 7, 0, 7, canvas.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let size = 112;
    do {
      ctx.font = `800 ${size}px system-ui, "PingFang SC", "Noto Sans SC", sans-serif`;
      if (ctx.measureText(label).width <= 900) break;
      size -= 6;
    } while (size > 52);
    ctx.fillText(label, canvas.width / 2, 92);
    ctx.font = '700 56px ui-monospace, "SFMono-Regular", Menlo, monospace';
    ctx.fillText(`${String(index).padStart(2, '0')} / ${String(total).padStart(2, '0')}`,
      canvas.width / 2, 190);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  texture.userData.checkpointLabel = label;
  texture.userData.checkpointIndex = index;
  texture.userData.checkpointTotal = total;
  texture.needsUpdate = true;
  return texture;
}

interface HologramPart {
  index: number;
  group: THREE.Group;
  label: THREE.MeshBasicMaterial;
  glow: THREE.MeshBasicMaterial;
  meshes: THREE.Mesh[];
  baseY: number;
  done: boolean;
}

export class Gates {
  readonly group = new THREE.Group();
  private readonly parts: HologramPart[] = [];
  private readonly startLine: { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } | null = null;
  private readonly finishIndex: number;
  private readonly gateCount: number;

  constructor(checkpoints: readonly Checkpoint[], isLoop: boolean,
              textureFactory: CheckpointTextureFactory | null = null) {
    this.group.name = 'gates';
    this.finishIndex = isLoop ? -1 : checkpoints.length - 1;
    this.gateCount = drivableGateCount(checkpoints.length);
    checkpoints.forEach((cp, index) => {
      // Checkpoint 0 is the start: the car is already standing on it and it is cleared before the
      // clock starts, so a floating label there would announce a gate nobody drives through.
      if (index === 0) return;
      const built = hologram(cp, index);
      this.parts.push(built);
      this.group.add(built.group);
    });
    if (textureFactory) this.setLabelTextures(textureFactory);

    // A circuit finishes where it started, so checkpoint 0 keeps a chequered road marking. It is
    // flat paint, not the physical gantry removed above.
    const first = checkpoints[0];
    if (isLoop && first) {
      const material = new THREE.MeshStandardMaterial({
        color: LINE, roughness: 0.9, metalness: 0, emissive: LINE_GLOW,
      });
      const mesh = new THREE.Mesh(startLine(first.halfWidth), material);
      mesh.position.set(first.pos[0], first.pos[1] + LINE_LIFT, first.pos[2]);
      mesh.rotation.y = Math.atan2(first.dir[0], first.dir[2]);
      mesh.receiveShadow = true;
      this.startLine = { mesh, material };
      this.group.add(mesh);
    }
    this.setCleared(1);
  }

  /** Dim passed markers while keeping the next numbered hologram dominant. */
  setCleared(count: number): void {
    for (const part of this.parts) {
      part.done = part.index < count;
      const finish = part.index === this.finishIndex;
      part.label.color.setHex(part.done ? CLEARED : (finish ? FINISH : AHEAD));
      part.glow.color.setHex(part.done ? GLOW_DONE : (finish ? GLOW_FINISH : GLOW_AHEAD));
    }
  }

  /** Stable two-frequency shimmer: it pulses, but never blinks out or becomes hard to aim at. */
  update(timeSeconds: number): void {
    for (const part of this.parts) {
      const phase = part.index * 0.83;
      const pulse = 0.84 + Math.sin(timeSeconds * 3.8 + phase) * 0.1
        + Math.sin(timeSeconds * 15.7 + phase * 2) * 0.04;
      part.label.opacity = part.done ? 0.28 : pulse;
      part.glow.opacity = part.done ? 0.035 : 0.08 + (pulse - 0.7) * 0.16;
      part.group.position.y = part.baseY + Math.sin(timeSeconds * 1.7 + phase) * 0.05;
    }
  }

  /** Replace every numbered texture after a language change. */
  setLabelTextures(factory: CheckpointTextureFactory): void {
    for (const part of this.parts) {
      part.label.map?.dispose();
      part.label.map = factory(part.index, this.gateCount);
      part.label.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const part of this.parts) {
      for (const mesh of part.meshes) mesh.geometry.dispose();
      part.label.map?.dispose();
      part.label.dispose();
      part.glow.dispose();
    }
    if (this.startLine) {
      this.startLine.mesh.geometry.dispose();
      this.startLine.material.dispose();
    }
    this.group.clear();
  }
}

function hologram(cp: Checkpoint, index: number): HologramPart {
  const width = (cp.halfWidth + OVERHANG) * 2 * LABEL_WIDTH_PCT;
  const height = width / LABEL_ASPECT;
  const label = new THREE.MeshBasicMaterial({
    color: AHEAD, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false,
    blending: THREE.AdditiveBlending,
  });
  label.userData.checkpointLabel = true;
  const glow = new THREE.MeshBasicMaterial({
    color: GLOW_AHEAD, transparent: true, opacity: 0.1, depthWrite: false,
    toneMapped: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  });
  const front = new THREE.Mesh(new THREE.PlaneGeometry(width, height), label);
  front.name = 'checkpoint-label-front';
  front.position.set(0, HOLOGRAM_HEIGHT, 0.025);
  const back = new THREE.Mesh(new THREE.PlaneGeometry(width, height), label);
  back.name = 'checkpoint-label-back';
  back.position.set(0, HOLOGRAM_HEIGHT, -0.025);
  back.rotation.y = Math.PI;
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(width * 1.08, height * 1.18), glow);
  halo.name = 'checkpoint-hologram-glow';
  halo.position.set(0, HOLOGRAM_HEIGHT, 0);
  halo.renderOrder = 1;
  front.renderOrder = 2;
  back.renderOrder = 2;
  const group = new THREE.Group();
  group.name = `checkpoint-hologram-${index}`;
  group.userData.hologram = true;
  const baseY = cp.pos[1] + ROAD_LIFT;
  group.position.set(cp.pos[0], baseY, cp.pos[2]);
  group.rotation.y = Math.atan2(cp.dir[0], cp.dir[2]);
  group.add(halo, front, back);
  return { index, group, label, glow, meshes: [halo, front, back], baseY, done: false };
}

/** The white half of a chequered start/finish band, as one geometry. */
function startLine(halfWidth: number): THREE.BufferGeometry {
  const cols = Math.max(2, Math.round((halfWidth * 2) / SQUARE));
  const w = (halfWidth * 2) / cols;
  const quads: number[] = [];
  const index: number[] = [];
  for (let row = 0; row < 2; row++) {
    for (let col = row % 2; col < cols; col += 2) {
      const x0 = -halfWidth + col * w;
      const z0 = -SQUARE + row * SQUARE;
      const base = quads.length / 3;
      quads.push(x0, 0, z0, x0 + w, 0, z0, x0 + w, 0, z0 + SQUARE, x0, 0, z0 + SQUARE);
      index.push(base, base + 2, base + 1, base, base + 3, base + 2);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(quads, 3));
  geometry.setAttribute('normal',
    new THREE.Float32BufferAttribute(new Array(quads.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  geometry.setIndex(index);
  return geometry;
}
