import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { checkpointLabelTexture, Gates, ROAD_LIFT } from '../src/world/Gates';
import { drivableGateCount, gatesPassed } from '../src/track/Race';
import type { Checkpoint } from '../src/track/types';

/**
 * The gantries over the road, and the one place that no longer gets one.
 *
 * Nothing asserted the gantries before this: `race.test.ts` covers what a checkpoint *means* to the
 * judgement, and the number and placement of the things built over them was invisible to every
 * suite. So removing the banner over the start could only have been checked by looking.
 */
const cps = (n: number): Checkpoint[] => Array.from({ length: n }, (_, i) => ({
  s: i * 100,
  pos: [i * 10, 0, 0] as [number, number, number],
  dir: [0, 0, 1] as [number, number, number],
  halfWidth: 4,
}));

/** A hologram is a Group of meshes; the painted start line is a bare Mesh. */
const gantries = (g: Gates) => g.group.children.filter((c) => c.type === 'Group');
const lines = (g: Gates) => g.group.children.filter((c) => (c as THREE.Mesh).isMesh);

describe('the gates over the road', () => {
  it('draws a localized numbered label and gives each hologram its own two-sided texture', () => {
    const drawn: string[] = [];
    const ctx = {
      clearRect: () => {}, fillRect: () => {}, measureText: () => ({ width: 500 }),
      fillText: (text: string) => drawn.push(text),
      set font(_v: string) {}, set fillStyle(_v: string) {}, set textAlign(_v: string) {},
      set textBaseline(_v: string) {},
    } as unknown as CanvasRenderingContext2D;
    const canvas = { width: 0, height: 0, getContext: () => ctx } as unknown as HTMLCanvasElement;
    checkpointLabelTexture('检查点', 1, 2, canvas);
    const oldTextures = [new THREE.Texture(), new THREE.Texture()];
    const g = new Gates(cps(3), false, (index) => oldTextures[index - 1]!);

    expect(drawn).toEqual(['检查点', '01 / 02']);
    expect([canvas.width, canvas.height]).toEqual([1024, 256]);
    for (const [i, gantry] of gantries(g).entries()) {
      const labels = gantry.children.filter((child) => child.name.startsWith('checkpoint-label')) as THREE.Mesh[];
      expect(labels).toHaveLength(2);
      expect(labels.every((mesh) => (mesh.material as THREE.MeshBasicMaterial).map === oldTextures[i])).toBe(true);
      const geometry = labels[0]!.geometry;
      geometry.computeBoundingBox();
      const size = geometry.boundingBox!.getSize(new THREE.Vector3());
      expect(size.x / size.y, 'the plane must match the 4:1 canvas instead of stretching its text')
        .toBeCloseTo(4, 8);
    }
    const disposed: boolean[] = [];
    oldTextures.forEach((texture, i) => texture.addEventListener('dispose', () => { disposed[i] = true; }));
    const replacements = [new THREE.Texture(), new THREE.Texture()];
    g.setLabelTextures((index) => replacements[index - 1]!);
    expect(disposed).toEqual([true, true]);
    expect(gantries(g).every((gantry, i) => gantry.children
      .filter((child) => child.name.startsWith('checkpoint-label')).every(
        (mesh) => ((mesh as THREE.Mesh).material as THREE.MeshBasicMaterial).map === replacements[i],
      ))).toBe(true);
    g.dispose();
  });

  it('hangs in empty air, has no physical posts, and keeps a visible shimmer', () => {
    const g = new Gates(cps(3), false);
    const first = gantries(g)[0]!;
    expect(first.children.map((child) => child.name)).toEqual([
      'checkpoint-hologram-glow', 'checkpoint-label-front', 'checkpoint-label-back',
    ]);
    expect(first.position.y).toBeCloseTo(ROAD_LIFT, 8);
    const front = first.children[1] as THREE.Mesh;
    expect(front.position.y).toBeGreaterThan(4);
    const material = front.material as THREE.MeshBasicMaterial;
    g.update(0);
    const firstOpacity = material.opacity;
    g.update(0.2);
    expect(material.opacity).not.toBe(firstOpacity);
    expect(material.opacity).toBeGreaterThan(0.65);
    g.dispose();
  });

  it('builds no gantry over the start', () => {
    // The start is checkpoint 0 in this codebase: the car stands on it and the race
    // counts it cleared before the clock starts, so the banner announced a gate nobody drove under.
    const g = new Gates(cps(5), false);
    expect(gantries(g)).toHaveLength(4);
    g.dispose();
  });

  it('stands each gantry at its own checkpoint, not at the one before it', () => {
    // The array position stopped being the checkpoint index the moment index 0 lost its gantry.
    const g = new Gates(cps(4), false);
    expect(gantries(g).map((c) => c.position.x)).toEqual([10, 20, 30]);
    g.dispose();
  });

  it('keeps the span across a diagonal road instead of turning it along traffic', () => {
    const diagonal = cps(2);
    const n = Math.SQRT1_2;
    diagonal[1]!.dir = [n, 0, n];
    const g = new Gates(diagonal, false);
    const gantry = gantries(g)[0]!;
    const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(gantry.quaternion);
    const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(gantry.quaternion);
    expect(localZ.dot(new THREE.Vector3(n, 0, n))).toBeCloseTo(1, 8);
    expect(localX.dot(new THREE.Vector3(n, 0, n))).toBeCloseTo(0, 8);
    g.dispose();
  });

  it('dims by checkpoint index, so the lit gate is the one the race is pointing at', () => {
    const g = new Gates(cps(4), false);
    g.setCleared(2);                       // checkpoints 0 and 1 are behind you
    const colours = gantries(g).map((c) => ((c.children[1] as THREE.Mesh).material as
      THREE.MeshBasicMaterial).color.getHex());
    expect(colours[0], 'checkpoint 1 is done').toBe(0x28465a);
    expect(colours[1], 'checkpoint 2 is next').toBe(0x5ffcff);
    expect(colours[2], 'the point-to-point finish stays distinct').toBe(0xff4fd8);
    g.dispose();
  });

  it('paints a start/finish line on a circuit, because there the start is also the finish', () => {
    // A loop finishes on checkpoint 0 and on nothing else, so taking its gantry away would leave
    // the one place the player has to find twice a lap unmarked. Flat paint is not a banner.
    const loop = new Gates(cps(3), true);
    expect(lines(loop)).toHaveLength(1);
    expect(lines(loop)[0]!.position.x).toBe(0);
    loop.dispose();
  });

  it('lifts the line by what the contract says the asphalt sits at', () => {
    // A checkpoint's y is the route spline, not the road surface. The first version cleared it by
    // 3 cm, which is inside the 6 cm of asphalt: the mesh was in the scene, visible, correctly
    // wound and lit, and drew nothing at all. The number has one owner and both sides read it.
    const doc = readFileSync(resolve(process.cwd(), '..', 'docs', 'CONTRACT.md'), 'utf-8');
    const stated = /road_lift_m = ([0-9.]+)/.exec(doc);
    expect(stated, 'docs/CONTRACT.md no longer states road_lift_m').toBeTruthy();
    expect(ROAD_LIFT).toBe(Number(stated![1]));

    const loop = new Gates(cps(3), true);
    expect(lines(loop)[0]!.position.y).toBeGreaterThan(ROAD_LIFT + 0.02);
    loop.dispose();
  });

  it('paints real chequers, not an empty geometry', () => {
    // Everything else here would pass with `startLine` returning nothing at all: an empty geometry
    // still makes a Mesh, and a Mesh still has a position. Burying the band in the road already
    // cost one round of "it is in the scene, visible, correctly lit, and draws nothing".
    const loop = new Gates(cps(3), true);
    const geometry = (lines(loop)[0] as THREE.Mesh).geometry;
    // 8 m of road at 1.3 m squares is 6 columns: three light ones per row, four vertices each
    expect(geometry.getAttribute('position').count).toBe(6 * 4);
    expect(geometry.getIndex()!.count).toBe(6 * 6);
    loop.dispose();
  });

  it('paints nothing at a point-to-point start: you are standing on it', () => {
    const p2p = new Gates(cps(3), false);
    expect(lines(p2p)).toHaveLength(0);
    p2p.dispose();
  });

  it('survives a track with a single checkpoint rather than building a gantry over it', () => {
    const g = new Gates(cps(1), false);
    expect(gantries(g)).toHaveLength(0);
    g.dispose();
  });

});


describe('how many gates are behind you', () => {
  it('owns the one start-line subtraction used by the HUD and hologram denominator', () => {
    expect(drivableGateCount(10)).toBe(9);
    expect(drivableGateCount(1)).toBe(0);
    expect(drivableGateCount(0)).toBe(0);
  });
  // A zero means two opposite things -- "not started" and "a circuit came back round to the line"
  // -- and the countdown screen is the HUD, so the wrong reading is on screen every single race.
  it('counts nothing before the lights go out', () => {
    expect(gatesPassed('ready', 0, 9)).toBe(0);
  });

  it('counts the gates behind you once the race is running', () => {
    expect(gatesPassed('racing', 1, 9)).toBe(0);
    expect(gatesPassed('racing', 5, 9)).toBe(4);
  });

  it('reads a circuit wrapping back to gate 0 as every gate done', () => {
    expect(gatesPassed('racing', 0, 2)).toBe(2);
  });

  it('reads a point-to-point finish as every gate done', () => {
    expect(gatesPassed('finished', 10, 9)).toBe(9);
  });
});
