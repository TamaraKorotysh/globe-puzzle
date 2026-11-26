import * as THREE from 'three';
import { areaKm2, bboxOf, buildSlab, type Poly, type WorldGeometry } from '../geo/buildCountries';
import { countries } from '../data';

/** Europe puzzle: NE "Europe" without Russia, plus the Caucasus, Cyprus and the disputed zones there. */
const EXTRA = ['GEO', 'ARM', 'AZE', 'CYP', 'CYN', 'D-CRIMEA', 'D-TRANSNISTRIA', 'D-ABKHAZIA', 'D-SOSSETIA'];
const EXCLUDE = new Set(['RUS']);
/** Smaller pieces (microstates) stay glued to the base: too small to grab. */
const MIN_AREA_KM2 = 1000;
/** Only polygons inside this box become part of a piece (drops e.g. French Guiana, the Canaries). */
const BOX = { minLon: -32, maxLon: 60, minLat: 34, maxLat: 82 };

export interface Piece {
  id: string;
  /** Slab with a bottom, centred on `home` (local coordinates). */
  geometry: THREE.BufferGeometry;
  /** Flat outline on the base sphere showing where the piece belongs. */
  slot: THREE.BufferGeometry;
  /** Overseas parts that stay on the globe while the piece is off it. */
  rest: THREE.BufferGeometry | null;
  /** Centre of the piece in its correct place (globe coordinates). */
  home: THREE.Vector3;
  /** Distance from the centre to the farthest vertex. */
  radius: number;
}

const inBox = (poly: Poly) => {
  const b = bboxOf(poly[0]);
  return b.cx >= BOX.minLon && b.cx <= BOX.maxLon && b.cy >= BOX.minLat && b.cy <= BOX.maxLat;
};

export function buildEuropePieces(world: WorldGeometry): Piece[] {
  const ids = new Set(Object.values(countries).filter((c) => c.continent === 'Europe' && !EXCLUDE.has(c.id)).map((c) => c.id));
  for (const id of EXTRA) ids.add(id);
  const pieces: Piece[] = [];
  for (const c of world.countries) {
    if (!ids.has(c.id)) continue;
    const mine = c.polys.filter(inBox);
    const others = c.polys.filter((p) => !inBox(p));
    if (!mine.length || areaKm2(mine) < MIN_AREA_KM2) continue;

    const geometry = buildSlab(mine, world.height, true);
    // Area-weighted centre of the top surface, pushed back onto the top radius.
    const pos = geometry.attributes.position as THREE.BufferAttribute;
    const home = new THREE.Vector3();
    const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
    let total = 0;
    for (let i = 0; i < pos.count; i += 3) {
      a.fromBufferAttribute(pos, i); b.fromBufferAttribute(pos, i + 1); d.fromBufferAttribute(pos, i + 2);
      const w = b.clone().sub(a).cross(d.clone().sub(a)).length();
      home.addScaledVector(a.add(b).add(d), w / 3);
      total += w;
    }
    home.divideScalar(total).normalize().multiplyScalar(1 + world.height);
    geometry.translate(-home.x, -home.y, -home.z);
    geometry.computeBoundingSphere();
    let radius = 0;
    for (let i = 0; i < pos.count; i++) radius = Math.max(radius, a.fromBufferAttribute(pos, i).length());

    pieces.push({
      id: c.id,
      geometry,
      slot: buildSlab(mine, 0.0008),
      rest: others.length ? buildSlab(others, world.height) : null,
      home,
      radius,
    });
  }
  return pieces;
}
