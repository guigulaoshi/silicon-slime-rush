import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import type { Car } from '../src/physics/Car';
import { GroundMarkPool } from '../src/world/GroundMarkPool';
import { continuesRun, RUN_MAX_LENGTH, TireMarks } from '../src/world/TireMarks';

/** Tyre marks, snow ruts and wet prints stay on the road for the whole race. */
function skiddingCar(): Car {
  return { speed: 12, poseRevision: 0, tuning: { wheelRadius: .4 },
    wheels: [0, 1, 2, 3].map(i => ({ grounded: true, skid: .5, contact: new THREE.Vector3(i % 2, 0, 0) })) } as unknown as Car;
}
const drive = (marks: TireMarks, car: Car, step: (wheel: THREE.Vector3, n: number) => void, frames: number) => {
  for (let n = 0; n < frames; n++) { for (const wheel of car.wheels) step(wheel.contact, n); marks.step(1 / 60, [car]); }
};

describe('persistent road marks', () => {
  it('keeps skid marks long past the old 32 s fade and past the old 3072-mark ring', () => {
    const marks = new TireMarks('clear'), car = skiddingCar();
    // A slalom: every step turns, so no two segments merge and each one is its own mark.
    drive(marks, car, (c, n) => c.add(new THREE.Vector3(n % 2 ? .3 : -.3, 0, -.3)), 2400);
    const laid = marks.stats().skid;
    expect(laid).toBeGreaterThan(3072 * 1.4);
    marks.step(600, []);
    expect(marks.stats().skid).toBe(laid);
    const pool = marks.root.getObjectByName('skid-tire-marks')!;
    const first = pool.getObjectByName('skid-tire-marks-0') as THREE.InstancedMesh;
    const matrix = new THREE.Matrix4(); first.getMatrixAt(0, matrix);
    expect(new THREE.Vector3().setFromMatrixPosition(matrix).z, 'the first mark was not overwritten').toBeGreaterThan(-1);
    const material = first.material as THREE.MeshBasicMaterial;
    const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <begin_vertex>', fragmentShader: '#include <common>\nvec4 diffuseColor = vec4( diffuse, opacity );' };
    material.onBeforeCompile?.(shader as never, undefined as never);
    expect(shader.fragmentShader).not.toMatch(/smoothstep|discard/);
    marks.dispose();
  });

  it('grows one mark along a straight run and starts another on a bend or past the length cap', () => {
    const marks = new TireMarks('clear'), car = skiddingCar();
    drive(marks, car, c => c.add(new THREE.Vector3(0, 0, -.3)), 17); // 4.8 m straight
    expect(marks.stats().skid, 'two rear wheels, one mark each').toBe(2);
    drive(marks, car, c => c.add(new THREE.Vector3(0, 0, -.3)), 10); // past RUN_MAX_LENGTH
    expect(marks.stats().skid).toBe(4);
    drive(marks, car, c => c.add(new THREE.Vector3(.2, 0, -.3)), 1);
    expect(marks.stats().skid).toBe(6);
    marks.dispose();
  });

  it('a run continues only ahead, on its line and within the cap', () => {
    const a = new THREE.Vector3(), b = new THREE.Vector3(0, 0, -1);
    expect(continuesRun(a, b, new THREE.Vector3(.01, 0, -2))).toBe(true);
    expect(continuesRun(a, b, new THREE.Vector3(.05, 0, -2))).toBe(false);
    expect(continuesRun(a, b, new THREE.Vector3(0, 0, -.5))).toBe(false);
    expect(continuesRun(a, b, new THREE.Vector3(0, 0, -RUN_MAX_LENGTH - .1))).toBe(false);
    expect(continuesRun(a, b, new THREE.Vector3(0, .05, -2)), 'a crest bends the run').toBe(false);
  });

  it('the pool grows by chunks, culls each chunk by its own marks and reuses only past its limit', () => {
    const pool = new GroundMarkPool('probe', new THREE.PlaneGeometry(), new THREE.MeshBasicMaterial(), 8, 20);
    const matrix = new THREE.Matrix4();
    for (let i = 0; i < 20; i++) pool.add(matrix.makeTranslation(i * 10, 0, 0));
    expect([pool.count, pool.chunkCount]).toEqual([20, 3]);
    pool.flush();
    const second = pool.root.children[1] as THREE.InstancedMesh;
    expect(second.boundingSphere!.center.x).toBeCloseTo(115, 0);
    expect(second.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 8 * 16 }]);
    // Written again before the renderer uploaded the first range: the pending range widens, never drops.
    pool.set(9, matrix.makeTranslation(90, 0, 0)); pool.flush();
    pool.set(14, matrix.makeTranslation(140, 0, 0)); pool.flush();
    expect(second.instanceMatrix.updateRanges).toEqual([{ start: 0, count: 8 * 16 }]);
    second.instanceMatrix.clearUpdateRanges();
    pool.set(12, matrix.makeTranslation(120, 0, 0)); pool.flush();
    pool.set(10, matrix.makeTranslation(100, 0, 0)); pool.flush();
    expect(second.instanceMatrix.updateRanges).toEqual([{ start: 2 * 16, count: 3 * 16 }]);
    pool.add(matrix.makeTranslation(-500, 0, 0));
    expect([pool.count, pool.chunkCount]).toEqual([20, 3]);
    const first = pool.root.children[0] as THREE.InstancedMesh;
    expect(first.boundingSphere!.containsPoint(new THREE.Vector3(-500, 0, 0))).toBe(true);
    expect(first.boundingSphere!.containsPoint(new THREE.Vector3(70, 0, 0)), 'old marks still in the reused chunk stay in view').toBe(true);
    pool.dispose();
  });

  it('a restart on the same world clears the marks and frees the extra chunks', () => {
    const marks = new TireMarks('clear'), car = skiddingCar();
    drive(marks, car, (c, n) => c.add(new THREE.Vector3(n % 2 ? .3 : -.3, 0, -.3)), 12000);
    expect(marks.stats().chunks).toBeGreaterThan(2);
    marks.clear();
    expect(marks.stats()).toMatchObject({ skid: 0, snow: 0, chunks: 2 });
    drive(marks, car, c => c.add(new THREE.Vector3(0, 0, -.3)), 3);
    expect(marks.stats().skid, 'marks start again after the restart').toBe(2);
    marks.dispose();
  });
});
