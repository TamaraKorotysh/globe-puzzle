import * as THREE from 'three';
import seasData from '../../data/seas.json';
import currentsData from '../../data/currents.json';
import { lonLatToVec3 } from './sphere';

export interface Sea { id: string; rank: number; lonLat: [number, number]; name: { ru: string; en: string } }
export interface Current { id: string; warm: boolean; name: { ru: string; en: string }; path: [number, number][] }

export const seas = seasData as Sea[];
export const currents = currentsData as Current[];

/** Smooth curve through the current's waypoints, as points on a sphere of radius r, about every 0.4°. */
export function currentPoints(c: Current, r: number): THREE.Vector3[] {
  const curve = new THREE.CatmullRomCurve3(c.path.map(([lo, la]) => lonLatToVec3(lo, la)), false, 'centripetal');
  const n = Math.max(8, Math.round(curve.getLength() / 0.007));
  return curve.getSpacedPoints(n).map((p) => p.normalize().multiplyScalar(r));
}
