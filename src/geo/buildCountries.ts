import * as THREE from 'three';
import type { Feature, FeatureCollection, MultiPolygon, Polygon, Position } from 'geojson';
import { lonLatToXYZ } from './sphere';

/** Countries are slabs: bottom on the base sphere (r = 1), top at r = 1 + height. */
export const BASE_R = 1.0;
/** Triangles longer than this (degrees) are subdivided so the fill follows the curvature. */
const MAX_EDGE_DEG = 3;
const MAX_DEPTH = 7;
/** Earth radius² in km² — converts unit-sphere area to km². */
const KM2 = 6371 * 6371;

type Ring = Position[];
export type Poly = Ring[];

export interface CountryGeometry {
  id: string;
  /** Extruded slab (top cap + side walls), in globe coordinates. */
  fill: THREE.BufferGeometry;
  /** Approximate visual center (lon, lat) — largest polygon's bbox center. */
  center: [number, number];
  areaKm2: number;
  polys: Poly[];
}

export interface WorldGeometry {
  countries: CountryGeometry[];
  borders: THREE.BufferGeometry;
  /** Country id → ids of countries sharing a border with it. */
  neighbors: Map<string, Set<string>>;
  height: number;
}

function cleanRing(ring: Ring): Ring {
  const out: Ring = [];
  for (const p of ring) {
    const last = out[out.length - 1];
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p);
  }
  if (out.length > 1) {
    const a = out[0], b = out[out.length - 1];
    if (a[0] === b[0] && a[1] === b[1]) out.pop();
  }
  return out;
}

function pushSubdivided(out: number[], a: Position, b: Position, c: Position, r: number, depth: number) {
  const dab = Math.hypot(a[0] - b[0], a[1] - b[1]);
  const dbc = Math.hypot(b[0] - c[0], b[1] - c[1]);
  const dca = Math.hypot(c[0] - a[0], c[1] - a[1]);
  if (depth < MAX_DEPTH && Math.max(dab, dbc, dca) > MAX_EDGE_DEG) {
    const ab = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const bc = [(b[0] + c[0]) / 2, (b[1] + c[1]) / 2];
    const ca = [(c[0] + a[0]) / 2, (c[1] + a[1]) / 2];
    pushSubdivided(out, a, ab, ca, r, depth + 1);
    pushSubdivided(out, ab, b, bc, r, depth + 1);
    pushSubdivided(out, ca, bc, c, r, depth + 1);
    pushSubdivided(out, ab, bc, ca, r, depth + 1);
    return;
  }
  for (const p of [a, b, c]) out.push(...lonLatToXYZ(p[0], p[1], r));
}

function signedArea(ring: Ring) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/** Segment lies on the ±180° cut or the south-pole edge of Antarctica — not a real border. */
function isArtificialEdge(a: Position, b: Position) {
  if (Math.abs(a[0]) >= 179.99 && Math.abs(b[0]) >= 179.99 && a[0] === b[0]) return true;
  if (a[1] <= -89.9 && b[1] <= -89.9) return true;
  return false;
}

/** Top cap triangles at radius r (outward winding). */
function capTriangles(rings: Ring[], r: number, out: number[]) {
  const cleaned = rings.map(cleanRing).filter((x) => x.length >= 3);
  if (!cleaned.length) return;
  const outer = cleaned[0].map((p) => new THREE.Vector2(p[0], p[1]));
  const holes = cleaned.slice(1).map((x) => x.map((p) => new THREE.Vector2(p[0], p[1])));
  const tris = THREE.ShapeUtils.triangulateShape(outer, holes);
  const all = cleaned.flat();
  for (const [i, j, k] of tris) {
    const a = all[i], b = all[j], c = all[k];
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (cross >= 0) pushSubdivided(out, a, b, c, r, 0);
    else pushSubdivided(out, a, c, b, r, 0);
  }
}

const _a0 = new THREE.Vector3(), _b0 = new THREE.Vector3(), _a1 = new THREE.Vector3(), _b1 = new THREE.Vector3();
const _n = new THREE.Vector3(), _d = new THREE.Vector3(), _m = new THREE.Vector3();

/** Side walls from r0 to r1; walls get a darker "shade" at the bottom (fake ambient occlusion). */
function wallTriangles(rings: Ring[], r0: number, r1: number, pos: number[], nor: number[], shade: number[]) {
  const cleaned = rings.map(cleanRing).filter((x) => x.length >= 3);
  cleaned.forEach((ring, ri) => {
    const s = Math.sign(signedArea(ring)) * (ri === 0 ? 1 : -1);
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], b = ring[(i + 1) % ring.length];
      if (isArtificialEdge(a, b)) continue;
      _a0.fromArray(lonLatToXYZ(a[0], a[1], r0)); _b0.fromArray(lonLatToXYZ(b[0], b[1], r0));
      _a1.fromArray(lonLatToXYZ(a[0], a[1], r1)); _b1.fromArray(lonLatToXYZ(b[0], b[1], r1));
      _d.subVectors(_b0, _a0);
      _m.addVectors(_a0, _b0).normalize();
      _n.crossVectors(_d, _m).normalize().multiplyScalar(s || 1);
      const quad = [_a0, _b0, _b1, _a0, _b1, _a1];
      const sh = [0.5, 0.5, 1, 0.5, 1, 1];
      quad.forEach((v, k) => { pos.push(v.x, v.y, v.z); nor.push(_n.x, _n.y, _n.z); shade.push(sh[k], sh[k], sh[k]); });
    }
  });
}

/** Slab geometry for a set of polygons, in globe coordinates. */
export function buildSlab(polys: Poly[], height: number, withBottom = false): THREE.BufferGeometry {
  const top: number[] = [];
  const bottom: number[] = [];
  const wPos: number[] = [], wNor: number[] = [], wShade: number[] = [];
  for (const poly of polys) {
    capTriangles(poly, BASE_R + height, top);
    if (withBottom) capTriangles(poly, BASE_R, bottom);
    wallTriangles(poly, BASE_R, BASE_R + height, wPos, wNor, wShade);
  }
  const nTop = top.length / 3, nBot = bottom.length / 3;
  const n = nTop + nBot + wPos.length / 3;
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3).fill(1);
  pos.set(top, 0);
  for (let i = 0; i < nTop; i++) {
    const x = top[i * 3], y = top[i * 3 + 1], z = top[i * 3 + 2];
    const l = Math.hypot(x, y, z);
    nor[i * 3] = x / l; nor[i * 3 + 1] = y / l; nor[i * 3 + 2] = z / l;
  }
  // Bottom: reversed winding, inward normals.
  for (let t = 0; t < nBot / 3; t++) {
    for (let k = 0; k < 3; k++) {
      const src = (t * 3 + (k === 0 ? 0 : 3 - k)) * 3;
      const dst = (nTop + t * 3 + k) * 3;
      const x = bottom[src], y = bottom[src + 1], z = bottom[src + 2];
      pos[dst] = x; pos[dst + 1] = y; pos[dst + 2] = z;
      nor[dst] = -x; nor[dst + 1] = -y; nor[dst + 2] = -z;
      col[dst] = col[dst + 1] = col[dst + 2] = 0.6;
    }
  }
  const off = (nTop + nBot) * 3;
  pos.set(wPos, off); nor.set(wNor, off); col.set(wShade, off);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  // Globe position (survives the pieces' recentring) and part: 0 top, 1 wall, 2 bottom — for the crystal shader.
  geo.setAttribute('aGlobe', new THREE.BufferAttribute(pos.slice(), 3));
  const part = new Float32Array(n);
  part.fill(2, nTop, nTop + nBot);
  part.fill(1, nTop + nBot);
  geo.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
  geo.computeBoundingSphere();
  return geo;
}

function polygonsOf(f: Feature): Poly[] {
  const g = f.geometry as Polygon | MultiPolygon | null;
  if (!g) return [];
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

export function bboxOf(ring: Ring) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of ring) {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  }
  return { area: (maxX - minX) * (maxY - minY), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Area of a polygon list on the unit sphere, in km². */
export function areaKm2(polys: Poly[]) {
  const tri: number[] = [];
  for (const p of polys) capTriangles(p, 1, tri);
  let s = 0;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  for (let i = 0; i < tri.length; i += 9) {
    a.fromArray(tri, i); b.fromArray(tri, i + 3); c.fromArray(tri, i + 6);
    s += b.sub(a).cross(c.sub(a)).length() / 2;
  }
  return s * KM2;
}

export function buildWorld(fc: FeatureCollection, height: number): WorldGeometry {
  const countries: CountryGeometry[] = [];
  const border: number[] = [];
  const owners = new Map<string, Set<string>>();
  const borderR = BASE_R + height + 0.0006;

  for (const f of fc.features) {
    const id = String(f.properties?.id ?? '');
    if (!id) continue;
    const polys = polygonsOf(f);
    let best = { area: -1, cx: 0, cy: 0 };
    for (const poly of polys) {
      const bb = bboxOf(poly[0]);
      if (bb.area > best.area) best = bb;
      for (const ring of poly) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i];
          const key = `${a[0].toFixed(4)},${a[1].toFixed(4)}`;
          let s = owners.get(key);
          if (!s) owners.set(key, (s = new Set()));
          s.add(id);
          if (i === ring.length - 1) continue;
          const b = ring[i + 1];
          if (isArtificialEdge(a, b)) continue;
          border.push(...lonLatToXYZ(a[0], a[1], borderR), ...lonLatToXYZ(b[0], b[1], borderR));
        }
      }
    }
    if (!polys.length) continue;
    countries.push({ id, fill: buildSlab(polys, height), center: [best.cx, best.cy], areaKm2: areaKm2(polys), polys });
  }

  // Countries sharing at least 2 vertices are neighbours.
  const shared = new Map<string, number>();
  for (const s of owners.values()) {
    if (s.size < 2) continue;
    const ids = [...s];
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const k = ids[i] < ids[j] ? `${ids[i]}|${ids[j]}` : `${ids[j]}|${ids[i]}`;
        shared.set(k, (shared.get(k) ?? 0) + 1);
      }
  }
  const neighbors = new Map<string, Set<string>>();
  for (const c of countries) neighbors.set(c.id, new Set());
  for (const [k, n] of shared) {
    if (n < 2) continue;
    const [a, b] = k.split('|');
    neighbors.get(a)?.add(b);
    neighbors.get(b)?.add(a);
  }

  const borders = new THREE.BufferGeometry();
  borders.setAttribute('position', new THREE.BufferAttribute(new Float32Array(border), 3));
  return { countries, borders, neighbors, height };
}

/** Greedy graph colouring (largest degree first): neighbours never share a colour index. */
export function colorIndices(world: WorldGeometry, nColors: number): Map<string, number> {
  const ids = world.countries.map((c) => c.id).sort((a, b) => (world.neighbors.get(b)!.size - world.neighbors.get(a)!.size) || (a < b ? -1 : 1));
  const out = new Map<string, number>();
  for (const id of ids) {
    const used = new Set<number>();
    for (const n of world.neighbors.get(id)!) if (out.has(n)) used.add(out.get(n)!);
    // Rotate the start so colours spread evenly instead of piling up on 0.
    let h = 0;
    for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    let pick = -1;
    for (let k = 0; k < nColors; k++) {
      const c = (h + k) % nColors;
      if (!used.has(c)) { pick = c; break; }
    }
    out.set(id, pick < 0 ? h % nColors : pick);
  }
  return out;
}
