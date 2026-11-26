import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { TILT, view } from './GlobeControls';

/**
 * Desk-globe scene in "room" coordinates (world-up = +Y, camera in front on +Z, globe centre at the origin):
 * bronze stand with a half-meridian ring and pole pins, a wooden table, a papered wall, a stack of books.
 * The whole group follows view.frame, so it stays still on screen while the globe spins.
 */
const TABLE_Y = -1.62;
const RING_R = 1.09;
/** The meridian ring's plane is turned this far behind the globe (so it hardly covers the map). */
const RING_TURN = THREE.MathUtils.degToRad(8);
const RING_FROM = THREE.MathUtils.degToRad(-106);
const RING_TO = THREE.MathUtils.degToRad(90);

function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void, repeat?: [number, number]) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d')!);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(...repeat); }
  return t;
}

/** Walnut planks with wavy grain. */
function woodTexture() {
  return canvasTexture(1024, 1024, (g) => {
    const planks = 6, ph = 1024 / planks;
    for (let p = 0; p < planks; p++) {
      const base = [92 + p * 7 % 20, 56 + p * 5 % 12, 32 + p * 3 % 8];
      g.fillStyle = `rgb(${base[0]},${base[1]},${base[2]})`;
      g.fillRect(0, p * ph, 1024, ph);
      for (let i = 0; i < 70; i++) {
        const y0 = p * ph + Math.random() * ph;
        const amp = 2 + Math.random() * 7, freq = 0.004 + Math.random() * 0.01, ph0 = Math.random() * 6;
        const dark = Math.random() < 0.5;
        g.strokeStyle = dark ? `rgba(40,22,10,${0.1 + Math.random() * 0.25})` : `rgba(150,100,60,${0.06 + Math.random() * 0.12})`;
        g.lineWidth = 0.6 + Math.random() * 1.8;
        g.beginPath();
        for (let x = 0; x <= 1024; x += 8) {
          const y = Math.min(p * ph + ph - 1, Math.max(p * ph + 1, y0 + Math.sin(x * freq + ph0) * amp));
          if (x) g.lineTo(x, y); else g.moveTo(x, y);
        }
        g.stroke();
      }
      g.fillStyle = 'rgba(20,10,4,0.7)';
      g.fillRect(0, p * ph, 1024, 2);
    }
  }, [2, 1.4]);
}

/** Old green damask-ish wallpaper: stripes and small diamonds. */
function wallTexture() {
  return canvasTexture(256, 256, (g) => {
    g.fillStyle = '#2f3a2c';
    g.fillRect(0, 0, 256, 256);
    for (let x = 0; x < 256; x += 64) {
      g.fillStyle = 'rgba(0,0,0,0.18)';
      g.fillRect(x + 30, 0, 4, 256);
    }
    g.fillStyle = 'rgba(190,170,110,0.16)';
    for (const [x, y] of [[0, 0], [64, 64], [128, 0], [192, 64], [0, 128], [64, 192], [128, 128], [192, 192], [256, 0], [256, 128]]) {
      g.beginPath();
      g.moveTo(x, y - 14); g.lineTo(x + 9, y); g.lineTo(x, y + 14); g.lineTo(x - 9, y); g.closePath();
      g.fill();
    }
    for (let i = 0; i < 1500; i++) {
      g.fillStyle = `rgba(0,0,0,${Math.random() * 0.06})`;
      g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2);
    }
  }, [10, 5]);
}

/** Soft round shadow for the table. */
function shadowTexture() {
  return canvasTexture(256, 256, (g) => {
    const r = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    r.addColorStop(0, 'rgba(0,0,0,0.75)');
    r.addColorStop(0.5, 'rgba(0,0,0,0.35)');
    r.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 256, 256);
  });
}

/** Stand geometry: where the ring's lowest point is, so the stem can meet it. */
function standLayout() {
  const axis = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -TILT);
  const turn = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), RING_TURN);
  let low = new THREE.Vector3(0, 10, 0);
  for (let a = RING_FROM; a <= RING_TO; a += 0.01) {
    const p = new THREE.Vector3(Math.cos(a) * RING_R, Math.sin(a) * RING_R, 0).applyQuaternion(turn).applyQuaternion(axis);
    if (p.y < low.y) low = p;
  }
  return { axis, low };
}

export default function Interior() {
  const group = useRef<THREE.Group>(null);
  const { axis, low } = useMemo(standLayout, []);
  const mats = useMemo(() => ({
    bronze: new THREE.MeshStandardMaterial({ color: '#7a5532', metalness: 0.45, roughness: 0.42 }),
    wood: new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.55, metalness: 0 }),
    wall: new THREE.MeshStandardMaterial({ map: wallTexture(), roughness: 0.9 }),
    panel: new THREE.MeshStandardMaterial({ color: '#3a2414', roughness: 0.6 }),
    shadow: new THREE.MeshBasicMaterial({ map: shadowTexture(), transparent: true, depthWrite: false }),
    books: ['#5a1f1a', '#1f3a2a', '#2a2a4a', '#6b4a22'].map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 })),
    pages: new THREE.MeshStandardMaterial({ color: '#e6d9b8', roughness: 0.9 }),
  }), []);

  const baseGeo = useMemo(() => {
    const prof = [[0, 0], [0.62, 0], [0.63, 0.03], [0.58, 0.07], [0.42, 0.11], [0.24, 0.16], [0.16, 0.22], [0.14, 0.3], [0.1, 0.33], [0, 0.33]]
      .map(([x, y]) => new THREE.Vector2(x, y));
    return new THREE.LatheGeometry(prof, 64);
  }, []);
  const baseTop = TABLE_Y + 0.33;
  const stemLen = low.y - baseTop;

  useFrame(() => { group.current?.quaternion.copy(view.frame); });

  const noRay = () => null;
  return (
    <group ref={group}>
      {/* Warm lamp from the upper left, fixed in the room. */}
      <pointLight position={[-3, 2.6, 2]} intensity={14} distance={14} decay={1.6} color="#ffd9a0" />

      {/* Stand: base, stem, ring with pole pins. */}
      <group position={[low.x, TABLE_Y, low.z]}>
        <mesh geometry={baseGeo} material={mats.bronze} raycast={noRay} />
        <mesh position={[0, 0.33 + stemLen / 2, 0]} material={mats.bronze} raycast={noRay}>
          <cylinderGeometry args={[0.045, 0.07, stemLen, 24]} />
        </mesh>
        <mesh position={[0, 0.33 + stemLen - 0.02, 0]} material={mats.bronze} raycast={noRay}>
          <sphereGeometry args={[0.07, 24, 16]} />
        </mesh>
      </group>
      <group quaternion={axis}>
        <group rotation={[0, RING_TURN, 0]}>
          <mesh rotation={[0, 0, RING_FROM]} material={mats.bronze} raycast={noRay}>
            <torusGeometry args={[RING_R, 0.026, 12, 160, RING_TO - RING_FROM]} />
          </mesh>
        </group>
        {/* Pins through the poles and a finial on top. */}
        <mesh position={[0, 1.04, 0]} material={mats.bronze} raycast={noRay}>
          <cylinderGeometry args={[0.014, 0.014, 0.1, 12]} />
        </mesh>
        <mesh position={[0, 1.11, 0]} material={mats.bronze} raycast={noRay}>
          <sphereGeometry args={[0.032, 16, 12]} />
        </mesh>
        <mesh position={[0, 1.16, 0]} material={mats.bronze} raycast={noRay}>
          <coneGeometry args={[0.018, 0.08, 12]} />
        </mesh>
        <mesh position={[0, -1.04, 0]} material={mats.bronze} raycast={noRay}>
          <cylinderGeometry args={[0.014, 0.014, 0.1, 12]} />
        </mesh>
      </group>

      {/* Table top and shadows. */}
      <mesh position={[0, TABLE_Y - 0.06, -0.5]} material={mats.wood} raycast={noRay}>
        <boxGeometry args={[14, 0.12, 9]} />
      </mesh>
      <mesh position={[low.x, TABLE_Y + 0.002, low.z]} rotation={[-Math.PI / 2, 0, 0]} material={mats.shadow} raycast={noRay}>
        <planeGeometry args={[1.8, 1.8]} />
      </mesh>
      <mesh position={[0.5, TABLE_Y + 0.001, -0.4]} rotation={[-Math.PI / 2, 0, 0]} material={mats.shadow} raycast={noRay}>
        <planeGeometry args={[3.2, 2.2]} />
      </mesh>

      {/* Wall: wallpaper above dark wooden panelling. */}
      <mesh position={[0, 2.4, -4.6]} material={mats.wall} raycast={noRay}>
        <planeGeometry args={[24, 8.4]} />
      </mesh>
      <mesh position={[0, TABLE_Y + 0.25, -4.55]} material={mats.panel} raycast={noRay}>
        <boxGeometry args={[24, 1.4, 0.1]} />
      </mesh>

      {/* A stack of old books to the left. */}
      <group position={[-2.3, TABLE_Y, -0.6]} rotation={[0, 0.35, 0]}>
        {[[0.95, 0.16, 0.7, 0], [0.85, 0.13, 0.62, 0.12], [0.9, 0.18, 0.66, -0.08], [0.75, 0.12, 0.55, 0.2]].reduce<{ y: number; el: JSX.Element[] }>(
          (acc, [w, h, d, r], i) => {
            acc.el.push(
              <group key={i} position={[0, acc.y + h / 2, 0]} rotation={[0, r, 0]}>
                <mesh material={mats.books[i]} raycast={noRay}><boxGeometry args={[w, h, d]} /></mesh>
                <mesh position={[0.02, 0, 0]} material={mats.pages} raycast={noRay}><boxGeometry args={[w - 0.02, h * 0.8, d + 0.004]} /></mesh>
              </group>,
            );
            acc.y += h;
            return acc;
          },
          { y: 0, el: [] },
        ).el}
      </group>
    </group>
  );
}
