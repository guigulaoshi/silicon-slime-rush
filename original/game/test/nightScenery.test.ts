import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { BUILT } from '../src/app/tracks';
import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { Spline } from '../src/track/Spline';
import type { TrackData } from '../src/track/types';
import { NightScenery, POOL_BEND_GLSL, POOL_BEND_KNOTS, POOL_CLEARANCE, nightLightStations } from '../src/world/NightScenery';

function line(length: number): Spline {
  return new Spline({
    spline: {
      points: [[0, 0, 0], [0, 0, length]], halfWidth: [6, 6], closed: false, length,
    },
  } as TrackData);
}

describe('night scenery', () => {
  it('spreads a bounded number of lamps over the whole route', () => {
    const stations = nightLightStations(line(5_700));
    expect(stations).toHaveLength(96);
    expect(stations[0]).toBeGreaterThan(0);
    expect(stations.at(-1)).toBeLessThan(5_700);
    expect(stations.at(-1)! - stations[0]!).toBeGreaterThan(5_500);
  });

  it('aims every shipped lamp from its lens to a road-aligned ellipse covering both lane edges', () => {
    let checked = 0;
    for (const id of BUILT) {
      const track = JSON.parse(readFileSync(resolve('public', 'tracks', id, 'track.json'), 'utf8')) as TrackData;
      const spline = new Spline(track);
      const night = new NightScenery(spline, 'night');
      const bodies = night.root.getObjectByName('night-lamp-bodies') as THREE.InstancedMesh;
      const cones = night.root.getObjectByName('night-light-cones') as THREE.InstancedMesh;
      const pools = night.root.getObjectByName('night-light-pools') as THREE.InstancedMesh;
      night.root.updateMatrixWorld(true);
      const stations = nightLightStations(spline);
      const body = new THREE.Matrix4(), cone = new THREE.Matrix4(), pool = new THREE.Matrix4();
      for (let n = 0; n < night.count; n++) {
        bodies.getMatrixAt(n, body); cones.getMatrixAt(n, cone); pools.getMatrixAt(n, pool);
        body.premultiply(bodies.matrixWorld); cone.premultiply(cones.matrixWorld); pool.premultiply(pools.matrixWorld);
        const i = spline.indexAt(stations[n]!);
        const centre = new THREE.Vector3(...spline.point(i));
        const normal = new THREE.Vector3(...spline.normal(i));
        const target = centre.clone().addScaledVector(normal, POOL_CLEARANCE);
        expect(new THREE.Vector3().applyMatrix4(pool).distanceTo(target)).toBeLessThan(0.002);
        expect(new THREE.Vector3().applyMatrix4(cone).distanceTo(target)).toBeLessThan(0.002);
        const head = new THREE.Vector3(...night.root.userData.headLocal as [number, number, number]);
        head.y -= 0.12;
        expect(new THREE.Vector3(0, 1, 0).applyMatrix4(cone).distanceTo(head.applyMatrix4(body))).toBeLessThan(0.002);
        expect(new THREE.Vector3(0, 1, 0).transformDirection(pool).dot(normal)).toBeGreaterThan(0.999);
        const inverse = pool.clone().invert();
        for (const side of [-1, 1]) {
          const edge = target.clone().addScaledVector(new THREE.Vector3(...spline.right(i)), spline.halfWidth[i]! * side).applyMatrix4(inverse);
          expect(Math.hypot(edge.x, edge.z), `${id} lamp ${n}, lane ${side}`).toBeLessThan(0.65);
          expect(Math.abs(edge.y)).toBeLessThan(0.002);
        }
        // The same world boundary closes the visible light shell and its ground footprint.
        for (const point of [[1, 0, 0], [0, 0, 1]]) {
          const v = new THREE.Vector3(...point as [number, number, number]);
          expect(v.clone().applyMatrix4(cone).distanceTo(v.applyMatrix4(pool))).toBeLessThan(0.002);
        }
        checked++;
      }
      night.dispose();
    }
    expect(checked).toBeGreaterThan(300);
  });

  it('keeps a complete four-draw light chain at night and nothing by day', () => {
    const spline = line(1_000);
    const night = new NightScenery(spline, 'night');
    const day = new NightScenery(spline, 'day');
    expect(night.count).toBeGreaterThan(0);
    expect(night.drawCalls).toBe(4);
    expect(night.dynamicLights).toBe(0);
    expect(night.root.children).toHaveLength(4);
    const bodies = night.root.getObjectByName('night-lamp-bodies') as THREE.InstancedMesh;
    const lenses = night.root.getObjectByName('night-lamp-lenses') as THREE.InstancedMesh;
    const cones = night.root.getObjectByName('night-light-cones') as THREE.InstancedMesh;
    const pools = night.root.getObjectByName('night-light-pools') as THREE.InstancedMesh;
    expect([bodies.count, lenses.count, cones.count, pools.count]).toEqual(Array(4).fill(night.count));
    bodies.geometry.computeBoundingBox();
    expect(bodies.geometry.boundingBox!.max.x).toBeGreaterThan(1.9);
    expect(bodies.geometry.boundingBox!.max.y).toBeGreaterThan(6.2);
    expect(bodies.geometry.boundingBox!.min.y).toBeCloseTo(0, 1);
    expect(cones.material).toMatchObject({
      isShaderMaterial: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    expect(pools.material).toMatchObject({
      isShaderMaterial: true, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    expect((pools.material as THREE.ShaderMaterial).fragmentShader).toContain('centreWeighted');
    const matrix = new THREE.Matrix4();
    bodies.getMatrixAt(0, matrix);
    const base = new THREE.Vector3().setFromMatrixPosition(matrix);
    const [headX, headY, headZ] = night.root.userData.headLocal as [number, number, number];
    const head = new THREE.Vector3(headX, headY, headZ).applyMatrix4(matrix);
    const routeCentre = new THREE.Vector3(...spline.point(spline.indexAt(nightLightStations(spline)[0]!)));
    expect(head.clone().sub(base).dot(routeCentre.sub(base))).toBeGreaterThan(0);
    const coneMaterial = cones.material as THREE.ShaderMaterial;
    const poolMaterial = pools.material as THREE.ShaderMaterial;
    expect(coneMaterial.uniforms.uOpacity!.value).toBeGreaterThan(0.02);
    expect(poolMaterial.uniforms.uOpacity!.value).toBeGreaterThan(0.1);
    expect(coneMaterial.uniforms.uFadeFar!.value).toBeGreaterThan(coneMaterial.uniforms.uFadeNear!.value);
    expect(poolMaterial.fragmentShader).toContain('distanceFade');
    pools.getMatrixAt(0, matrix);
    const normal = new THREE.Vector3(0, 1, 0).transformDirection(matrix);
    expect(normal.y).toBeGreaterThan(0.99);
    expect(day.count).toBe(0);
    expect(day.drawCalls).toBe(0);
    expect(day.root.children).toHaveLength(0);
    night.dispose();
    day.dispose();
  });
});

// A flat pool laid on a changing grade ran into the tarmac and was cut off in a straight
// line across the road. Every point along the pool's centre line has to stay just above the road.
function road(height: (x: number) => number): Spline {
  const points = Array.from({ length: 401 }, (_, i) => [i * 2.5, height(i * 2.5), 0]);
  let length = 0;
  for (let i = 1; i < points.length; i++) {
    length += Math.hypot(...points[i]!.map((v, k) => v - points[i - 1]![k]!) as [number, number, number]);
  }
  return new Spline({ spline: { points, halfWidth: Array(401).fill(9), closed: false, length } } as TrackData);
}

// Evaluates the shader's own bend text, so deleting or changing the GLSL is what this test sees.
const shaderBend = new Function('poolBend', 'z', 'mix', `return ${POOL_BEND_GLSL};`) as
  (bend: { x: number; y: number; z: number; w: number }, z: number, mix: (a: number, b: number, t: number) => number) => number;
function poolBendAt(knots: number[], z: number): number {
  return shaderBend({ x: knots[0]!, y: knots[1]!, z: knots[2]!, w: knots[3]! }, z, (a, b, t) => a + (b - a) * t);
}

describe('night light pools follow the road surface', () => {
  const shapes: [string, (x: number) => number][] = [
    // Rolling hills: 0.004 /m vertical curvature at every crest and sag, grades up to 12%.
    ['crest and sag', x => 3.6 * Math.cos(x / 30)],
    ['grade break', x => x < 480 ? 0 : (x - 480) * 0.08],
  ];
  for (const [name, height] of shapes) {
    it(`stays clear of a ${name}`, () => {
      const scenery = new NightScenery(road(height), 'night');
      const pools = scenery.root.getObjectByName('night-light-pools') as THREE.InstancedMesh;
      const bend = pools.geometry.getAttribute('poolBend') as THREE.InstancedBufferAttribute;
      expect((pools.material as THREE.ShaderMaterial).vertexShader).toContain(`float bend = ${POOL_BEND_GLSL};`);
      expect((pools.material as THREE.ShaderMaterial).vertexShader).toContain('position.y + bend');
      const matrix = new THREE.Matrix4();
      let worst = Infinity, highest = -Infinity, checked = 0;
      for (let k = 0; k < pools.count; k++) {
        pools.getMatrixAt(k, matrix);
        matrix.premultiply(scenery.root.matrix.clone().setPosition(scenery.root.position));
        const knots = Array.from(POOL_BEND_KNOTS, (_, i) => bend.getComponent(k, i));
        for (let z = -1; z <= 1.0001; z += 0.05) {
          const point = new THREE.Vector3(0, poolBendAt(knots, z), z).applyMatrix4(matrix);
          if (point.x < 0 || point.x > 1000) continue;
          const clearance = point.y - height(point.x);
          worst = Math.min(worst, clearance); highest = Math.max(highest, clearance);
          checked++;
        }
      }
      expect(checked).toBeGreaterThan(200);
      // Without the drape a pool's ends run tens of centimetres under a crest or a grade break.
      expect(worst).toBeGreaterThan(0.08);
      expect(highest).toBeLessThan(0.2);
      scenery.dispose();
    });
  }
});
