import * as THREE from 'three';

const DEG = Math.PI / 180;

/** lon/lat (degrees) → point on a sphere. lon=0, lat=0 faces +Z (towards the default camera). */
export function lonLatToXYZ(lon: number, lat: number, r = 1): [number, number, number] {
  const la = lat * DEG;
  const lo = lon * DEG;
  const c = Math.cos(la);
  return [r * c * Math.sin(lo), r * Math.sin(la), r * c * Math.cos(lo)];
}

export function lonLatToVec3(lon: number, lat: number, r = 1): THREE.Vector3 {
  const [x, y, z] = lonLatToXYZ(lon, lat, r);
  return new THREE.Vector3(x, y, z);
}
