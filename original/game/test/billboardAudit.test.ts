import {expect, it} from 'vitest';
import * as THREE from 'three';
import {billboardView} from '../e2e/billboard-audit';

it('matches authoring eyes by position after compressed instances change order', () => {
 const a={face:[0,20,20] as [number,number,number],eye:[-75,2,0] as [number,number,number],side:1 as const};
 const b={face:[40,30,20] as [number,number,number],eye:[-35,12,0] as [number,number,number],side:-1 as const};
 expect(billboardView([b,a],new THREE.Vector3(.01,20,20))).toBe(a);
 expect(()=>billboardView([a],new THREE.Vector3(40,30,20))).toThrow('Missing authoring');
 expect(()=>billboardView(undefined,new THREE.Vector3())).toThrow('Missing authoring');
});
