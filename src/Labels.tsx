import { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import type { WorldGeometry } from './geo/buildCountries';
import { lonLatToVec3 } from './geo/sphere';
import { currentPoints, currents, seas } from './geo/currents';
import { countries, isDisputedZone } from './data';
import type { Lang } from './i18n';

interface Props {
  world: WorldGeometry;
  lang: Lang;
  /** Ids to leave unlabeled (e.g. pieces currently off the globe). */
  hidden?: Set<string>;
  /** Also label oceans, seas and currents. */
  seaLabels?: boolean;
}

/** Smallest country area (km²) labeled at a given camera distance: big ones appear first. */
const minArea = (dist: number) => Math.pow(10, 4 + (dist - 1.3) * 1.3);

/**
 * Seas and currents get an "equivalent area" so they join the same zoom ladder as countries:
 * oceans always, big seas at the start view (dist ≈ 2.9), small seas from dist ≈ 2.3, currents from ≈ 2.1.
 */
const SEA_AREA = [0, 1e12, 1.6e6, 2e5];
const CURRENT_AREA = 1.1e5;

interface Item {
  id: string;
  name: { ru: string; en: string };
  area: number;
  pos: THREE.Vector3;
  cls: string;
  /** A point a little further along a current: the label is turned along it. */
  ahead?: THREE.Vector3;
  /** Oceans shrink when zoomed out so they stay on the globe. */
  shrink?: boolean;
  /** Measured size in px (hidden elements report 0, so it is measured up front). */
  w: number;
  h: number;
  el: HTMLDivElement | null;
}

const _v = new THREE.Vector3();
const _a = new THREE.Vector3();
const _dir = new THREE.Vector3();

/** Country, sea and current names as lightweight DOM labels; updated every frame without React re-renders. */
export default function Labels({ world, lang, hidden, seaLabels }: Props) {
  const { gl, camera, size } = useThree();

  const items = useMemo(() => {
    const r = 1 + world.height;
    const list: Item[] = world.countries
      .filter((c) => !isDisputedZone(c.id) && countries[c.id])
      .map((c) => ({ id: c.id, name: countries[c.id].name, area: c.areaKm2, pos: lonLatToVec3(c.center[0], c.center[1], r), cls: 'label-country', w: 0, h: 0, el: null }));
    if (seaLabels) {
      for (const s of seas) {
        list.push({ id: `sea-${s.id}`, name: s.name, area: SEA_AREA[s.rank], pos: lonLatToVec3(s.lonLat[0], s.lonLat[1], 1.002), cls: `label-sea rank-${s.rank}`, shrink: s.rank === 1, w: 0, h: 0, el: null });
      }
      for (const c of currents) {
        const pts = currentPoints(c, 1.002);
        const mid = Math.floor(pts.length / 2);
        list.push({
          id: `cur-${c.id}`, name: c.name, area: CURRENT_AREA, pos: pts[mid], ahead: pts[Math.min(pts.length - 1, mid + 3)],
          cls: `label-current ${c.warm ? 'warm' : 'cold'}`, w: 0, h: 0, el: null,
        });
      }
    }
    return list.sort((a, b) => b.area - a.area);
  }, [world, seaLabels]);

  const root = useMemo(() => {
    const d = document.createElement('div');
    d.className = 'labels';
    return d;
  }, []);

  useEffect(() => {
    const parent = gl.domElement.parentElement!;
    parent.appendChild(root);
    for (const it of items) {
      const el = document.createElement('div');
      el.className = it.cls;
      root.appendChild(el);
      it.el = el;
    }
    return () => { root.replaceChildren(); root.remove(); };
  }, [gl, root, items]);

  useEffect(() => {
    for (const it of items) {
      const el = it.el;
      if (!el) continue;
      el.textContent = it.name[lang];
      // Measure once while invisible, so overlap checks use the real size.
      const prev = el.style.display, prevT = el.style.transform;
      el.style.visibility = 'hidden'; el.style.display = ''; el.style.transform = '';
      it.w = el.offsetWidth; it.h = el.offsetHeight;
      el.style.display = prev; el.style.transform = prevT; el.style.visibility = '';
    }
  }, [items, lang]);

  useFrame(() => {
    const dist = camera.position.length();
    const threshold = minArea(dist);
    _dir.copy(camera.position).normalize();
    const placed: [number, number, number, number][] = [];
    for (const it of items) {
      const el = it.el;
      if (!el) continue;
      let show = it.area >= threshold && !hidden?.has(it.id);
      const facing = show ? _v.copy(it.pos).normalize().dot(_dir) : 0;
      // Long ocean names need to sit nearer the middle of the disc, or they hang off the edge.
      if (show && facing < (it.shrink ? 0.62 : 0.45)) show = false;
      if (show) {
        _v.copy(it.pos).project(camera);
        const x = (_v.x * 0.5 + 0.5) * size.width;
        const y = (-_v.y * 0.5 + 0.5) * size.height;
        let angle = 0;
        if (it.ahead) {
          _a.copy(it.ahead).project(camera);
          angle = Math.atan2(-(_a.y - _v.y) * size.height, (_a.x - _v.x) * size.width);
          if (angle > Math.PI / 2) angle -= Math.PI;
          else if (angle < -Math.PI / 2) angle += Math.PI;
        }
        // Collision box of the (possibly rotated) label.
        const k = it.shrink ? Math.min(1, Math.max(0.55, 2.7 / dist)) : 1;
        const w0 = (it.w || 60) * k, h0 = (it.h || 16) * k;
        const c = Math.abs(Math.cos(angle)), s = Math.abs(Math.sin(angle));
        const w = w0 * c + h0 * s, h = w0 * s + h0 * c;
        const box: [number, number, number, number] = [x - w / 2, y - h / 2, x + w / 2, y + h / 2];
        if (placed.some((b) => box[0] < b[2] && box[2] > b[0] && box[1] < b[3] && box[3] > b[1])) show = false;
        else {
          placed.push(box);
          el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%) rotate(${angle}rad)${it.ahead ? ' translateY(-13px)' : ''}${k < 1 ? ` scale(${k})` : ''}`;
          el.style.opacity = String(Math.min(1, (facing - 0.45) * 5));
        }
      }
      el.style.display = show ? '' : 'none';
    }
  });

  return null;
}
