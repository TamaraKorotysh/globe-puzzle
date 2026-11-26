import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import { BallCollider, Physics, RigidBody, interactionGroups, type RapierRigidBody, type RapierCollider } from '@react-three/rapier';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import type { WorldGeometry } from '../geo/buildCountries';
import type { GlobeStyle } from '../globeStyles';
import { hatchedMaterial, useCountryColors } from '../Globe';
import { crystalBaseMaterial, earthSlabMaterial } from '../crystal';
import { antiqueSlabMaterial, plasterMaterial } from '../antique';
import { landMaskTexture } from '../geo/landMask';
import { countries, disputed, isDisputedZone } from '../data';
import type { Lang } from '../i18n';
import { lonLatToVec3 } from '../geo/sphere';
import { buildEuropePieces, type Piece } from './pieces';
import { HALF_FOV_TAN, TRAY_DEPTH, puzzleAimLat, puzzleCameraDistance, trayLayout } from './layout';
import { sfx } from './sounds';

interface Props {
  world: WorldGeometry;
  style: GlobeStyle;
  /** Ids of all pieces, once they are built. */
  onInit: (ids: string[]) => void;
  onPlaced: (id: string) => void;
  lang: Lang;
  /** Increments each time the player asks for a hint. */
  hint: number;
  /** Player clicked the name of a placed country. */
  onInfo: (id: string) => void;
}

type Mode = 'fly' | 'park' | 'drag' | 'snap' | 'done';

interface Runtime {
  piece: Piece;
  body: RapierRigidBody | null;
  collider: RapierCollider | null;
  mesh: THREE.Mesh | null;
  slot: number;
  mode: Mode;
  t0: number;
  /** Rotation taking the piece's home frame (east, north, up) to the identity. */
  homeInv: THREE.Quaternion;
  ballR: number;
  near: boolean;
  /** Current size of the mesh. */
  scale: number;
  /** Seconds the flight into place takes (longer when a hint flies it). */
  snapTime: number;
}

const NO_HIT = interactionGroups(1, []);
const HIT = interactionGroups(1, [1]);
const DYNAMIC = 0;
const KINEMATIC = 2;
/** Touch: the piece floats this far above the finger so it stays visible. */
const TOUCH_LIFT_PX = 56;

const _v = new THREE.Vector3(), _w = new THREE.Vector3(), _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion();
const _right = new THREE.Vector3(), _up = new THREE.Vector3(), _fwd = new THREE.Vector3();
const _ray = new THREE.Raycaster();
const _tilt = new THREE.Quaternion();
const _hq = new THREE.Quaternion(), _cq = new THREE.Quaternion();
const _hv = new THREE.Vector3(), _cv = new THREE.Vector3();
const _eul = new THREE.Euler();
const handleGeometry = new THREE.SphereGeometry(1, 12, 8);

function roundedRect(x0: number, y0: number, x1: number, y1: number, r: number) {
  const s = new THREE.Shape();
  s.moveTo(x0 + r, y0);
  s.lineTo(x1 - r, y0); s.quadraticCurveTo(x1, y0, x1, y0 + r);
  s.lineTo(x1, y1 - r); s.quadraticCurveTo(x1, y1, x1 - r, y1);
  s.lineTo(x0 + r, y1); s.quadraticCurveTo(x0, y1, x0, y1 - r);
  s.lineTo(x0, y0 + r); s.quadraticCurveTo(x0, y0, x0 + r, y0);
  return s;
}
const _ndc = new THREE.Vector2();

function homeFrameInverse(home: THREE.Vector3) {
  const n = home.clone().normalize();
  const e = new THREE.Vector3(0, 1, 0).cross(n).normalize();
  const north = n.clone().cross(e);
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(e, north, n)).invert();
}

/** Ray from the camera through a screen point hits the base sphere (radius r)? Returns the point. */
function hitSphere(ray: THREE.Ray, r: number, out: THREE.Vector3) {
  const b = ray.origin.dot(ray.direction);
  const c = ray.origin.lengthSq() - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  return out.copy(ray.direction).multiplyScalar(t).add(ray.origin);
}

export default function Puzzle({ world, style, onInit, onPlaced, lang, hint, onInfo }: Props) {
  const pieces = useMemo(() => buildEuropePieces(world), [world]);
  const colors = useCountryColors(world, style);
  const [placed, setPlaced] = useState<Set<string>>(() => new Set());
  const { camera, gl, size, controls } = useThree() as unknown as {
    camera: THREE.PerspectiveCamera; gl: THREE.WebGLRenderer; size: { width: number; height: number }; controls: OrbitControlsImpl | null;
  };

  const materials = useMemo(() => {
    const m = new Map<string, THREE.Material>();
    for (const p of pieces) {
      const disputed = isDisputedZone(p.id);
      if (style.realistic) {
        const mat = earthSlabMaterial({ height: world.height, disputed, translucent: true, glow: 1 });
        if (!disputed) mat.color.set(colors.get(p.id)!);
        m.set(p.id, mat);
      } else if (style.antique) {
        const mat = antiqueSlabMaterial({ height: world.height, disputed, mask: landMaskTexture(world.countries.flatMap((c) => c.polys)) });
        mat.color.set(colors.get(p.id)!);
        m.set(p.id, mat);
      } else if (disputed) m.set(p.id, hatchedMaterial());
      else m.set(p.id, new THREE.MeshStandardMaterial({ color: colors.get(p.id), roughness: 0.7, vertexColors: true }));
    }
    return m;
  }, [pieces, colors, style, world]);
  // Name of the last placed country; click → country card, click elsewhere → hide.
  const [label, setLabel] = useState<string | null>(null);
  useEffect(() => {
    const el = gl.domElement;
    let down: [number, number] | null = null;
    const pd = (e: PointerEvent) => { down = [e.clientX, e.clientY]; };
    const click = (e: MouseEvent) => {
      if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 6 && !drag.current) setLabel(null);
    };
    el.addEventListener('pointerdown', pd);
    el.addEventListener('click', click);
    return () => { el.removeEventListener('pointerdown', pd); el.removeEventListener('click', click); };
  }, [gl]);
  const labelPiece = label ? pieces.find((p) => p.id === label) : null;
  const labelName = label ? (countries[label]?.name[lang] ?? disputed[label]?.name?.[lang] ?? label) : '';

  const slotMaterial = useMemo(
    () => (style.realistic ? crystalBaseMaterial() : style.antique ? plasterMaterial() : new THREE.MeshStandardMaterial({ color: '#16213a', roughness: 0.95, transparent: true, opacity: 0.85 })),
    [style],
  );

  // Random tray slot per piece.
  const runtimes = useMemo(() => {
    const order = pieces.map((_, i) => i).sort(() => Math.random() - 0.5);
    const now = performance.now() / 1000;
    return new Map<string, Runtime>(pieces.map((p, i) => [p.id, {
      piece: p, body: null, collider: null, mesh: null, slot: order[i], mode: 'fly', t0: now,
      homeInv: homeFrameInverse(p.home), ballR: 0.05, near: false, scale: 1, snapTime: 0.22,
    }]));
  }, [pieces]);

  const initialVel = useMemo(() => {
    const toCam = camera.position.clone().normalize();
    return new Map(pieces.map((p) => {
      const v = p.home.clone().normalize().multiplyScalar(0.7 + Math.random() * 0.6)
        .addScaledVector(toCam, 0.6)
        .add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.6));
      const w = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(8);
      return [p.id, { v: v.toArray() as [number, number, number], w: w.toArray() as [number, number, number] }];
    }));
  }, [pieces, camera]);

  // Dev only: automated checks read piece positions from here.
  if (import.meta.env.DEV) (window as unknown as { __puzzle: unknown }).__puzzle = { runtimes, camera, size };

  useEffect(() => {
    onInit(pieces.map((p) => p.id));
    sfx.scatter();
  }, [pieces, onInit]);

  // Camera glides to Europe at a distance that fits the screen.
  const camTween = useRef<{ from: THREE.Vector3; t: number } | null>(null);
  useEffect(() => { camTween.current = { from: camera.position.clone(), t: 0 }; }, [camera]);

  const drag = useRef<{ id: string; pointerId: number; x: number; y: number; touch: boolean } | null>(null);

  // Hint: a random piece from the tray flies into its place by itself.
  useEffect(() => {
    if (!hint) return;
    const left = [...runtimes.values()].filter((r) => r.body && (r.mode === 'park' || r.mode === 'fly'));
    if (!left.length) return;
    const rt = left[Math.floor(Math.random() * left.length)];
    rt.body!.setBodyType(KINEMATIC as never, true);
    rt.collider?.setCollisionGroups(NO_HIT);
    rt.mode = 'snap';
    rt.snapTime = 1.1;
    rt.t0 = performance.now() / 1000;
    sfx.pick();
  }, [hint, runtimes]);

  const startDrag = (id: string) => (e: ThreeEvent<PointerEvent>) => {
    const rt = runtimes.get(id);
    if (!rt?.body || drag.current || rt.mode === 'snap' || rt.mode === 'done') return;
    e.stopPropagation();
    if (controls) controls.enabled = false;
    drag.current = { id, pointerId: e.pointerId, x: e.nativeEvent.clientX, y: e.nativeEvent.clientY, touch: e.pointerType !== 'mouse' };
    rt.mode = 'drag';
    rt.body.setBodyType(KINEMATIC as never, true);
    rt.collider?.setCollisionGroups(NO_HIT);
    gl.domElement.style.cursor = 'grabbing';
    sfx.pick();
  };

  useEffect(() => {
    const move = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      d.x = e.clientX; d.y = e.clientY;
    };
    const up = (e: PointerEvent) => {
      const d = drag.current;
      if (!d || e.pointerId !== d.pointerId) return;
      drag.current = null;
      if (controls) controls.enabled = true;
      gl.domElement.style.cursor = '';
      const rt = runtimes.get(d.id);
      if (!rt?.body) return;
      if (rt.near) {
        rt.mode = 'snap';
        rt.t0 = performance.now() / 1000;
      } else {
        rt.mode = 'park';
        rt.body.setBodyType(DYNAMIC as never, true);
        rt.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
        rt.collider?.setCollisionGroups(HIT);
        sfx.miss();
      }
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      if (controls) controls.enabled = true;
    };
  }, [runtimes, controls, gl]);

  useFrame((_, dt) => {
    const now = performance.now() / 1000;
    const aspect = size.width / size.height;

    // Camera glide.
    const tw = camTween.current;
    if (tw) {
      tw.t = Math.min(1, tw.t + dt / 1.4);
      const k = tw.t * tw.t * (3 - 2 * tw.t);
      const dist = THREE.MathUtils.lerp(tw.from.length(), puzzleCameraDistance(aspect), k);
      const aim = lonLatToVec3(17, puzzleAimLat(aspect)).normalize();
      _v.copy(tw.from).normalize().lerp(aim, k).normalize().multiplyScalar(dist);
      camera.position.copy(_v);
      camera.lookAt(0, 0, 0);
      controls?.update();
      if (tw.t >= 1) camTween.current = null;
    }

    // Tray geometry in world units for the current camera.
    const camDist = camera.position.length();
    const depth = Math.max(0.15, (camDist - 1) * TRAY_DEPTH);
    const hh = depth * HALF_FOV_TAN;
    const layout = trayLayout(aspect, pieces.length);
    _right.set(1, 0, 0).applyQuaternion(camera.quaternion);
    _up.set(0, 1, 0).applyQuaternion(camera.quaternion);
    _fwd.set(0, 0, -1).applyQuaternion(camera.quaternion);
    const slotR = layout.r * hh;

    // Pointer → world.
    const d = drag.current;
    let hit: THREE.Vector3 | null = null;
    const planePoint = new THREE.Vector3();
    if (d) {
      const rect = gl.domElement.getBoundingClientRect();
      const py = d.y - (d.touch ? TOUCH_LIFT_PX : 0);
      _ndc.set(((d.x - rect.left) / rect.width) * 2 - 1, -((py - rect.top) / rect.height) * 2 + 1);
      _ray.setFromCamera(_ndc, camera);
      hit = hitSphere(_ray.ray, 1, new THREE.Vector3());
      const t = depth / Math.max(0.05, _ray.ray.direction.dot(_fwd));
      planePoint.copy(_ray.ray.direction).multiplyScalar(t).add(_ray.ray.origin);
    }

    for (const rt of runtimes.values()) {
      const { body, mesh, piece } = rt;
      if (!body || !mesh || rt.mode === 'done') continue;
      const parkScale = Math.min(3, (slotR * 0.95) / piece.radius);
      // Tilted and slowly rocking in the tray, so the crystal walls show and catch the light.
      _tilt.setFromEuler(_eul.set(0.5 + 0.12 * Math.sin(now * 0.9 + rt.slot), 0.25 * Math.sin(now * 0.6 + rt.slot * 1.7), 0));
      // Same turn as the piece's place on the globe as seen now (the globe leans), plus the rocking tilt in screen space.
      _hq.setFromUnitVectors(_hv.copy(piece.home).normalize(), _cv.copy(camera.position).normalize());
      _cq.copy(camera.quaternion).multiply(_tilt).multiply(_q.copy(camera.quaternion).invert());
      const parkQuat = _q2.copy(_cq).multiply(_hq);

      if (rt.mode === 'drag') {
        let targetPos: THREE.Vector3, targetQuat: THREE.Quaternion, targetScale: number;
        rt.near = false;
        if (hit) {
          const n = hit.clone().normalize();
          // Magnet: close enough on screen → the piece jumps into its place.
          const a = _v.copy(piece.home).project(camera);
          const b = _w.copy(n).multiplyScalar(piece.home.length()).project(camera);
          const px = Math.hypot((a.x - b.x) * size.width, (a.y - b.y) * size.height) / 2;
          const screenR = (piece.radius / (camDist - 1)) * (size.height / 2) / HALF_FOV_TAN;
          rt.near = px < Math.max(d!.touch ? 34 : 26, Math.min(70, screenR * 0.35));
          if (rt.near) {
            targetPos = piece.home.clone().multiplyScalar(1.004);
            targetQuat = new THREE.Quaternion();
          } else {
            targetQuat = new THREE.Quaternion().setFromUnitVectors(_w.copy(piece.home).normalize(), n);
            targetPos = n.multiplyScalar(piece.home.length() + 0.025);
          }
          targetScale = 1;
        } else {
          targetPos = planePoint;
          targetQuat = parkQuat.clone();
          targetScale = parkScale;
        }
        const cur = body.translation();
        const k = 1 - Math.pow(0.0005, dt);
        _v.set(cur.x, cur.y, cur.z).lerp(targetPos, k);
        body.setNextKinematicTranslation(_v);
        const r = body.rotation();
        _q.set(r.x, r.y, r.z, r.w).slerp(targetQuat, k);
        body.setNextKinematicRotation(_q);
        rt.scale = THREE.MathUtils.lerp(rt.scale, targetScale, k);
        mesh.scale.setScalar(rt.scale);
        continue;
      }

      if (rt.mode === 'snap') {
        const cur = body.translation();
        const left = Math.max(dt, rt.snapTime - (now - rt.t0));
        const k = rt.snapTime > 0.5 ? Math.min(1, dt / left) : 1 - Math.pow(0.00001, dt);
        // A hint flight arcs up above the globe on the way.
        const arc = rt.snapTime > 0.5 ? 1 + 0.25 * Math.sin(Math.PI * Math.min(1, (now - rt.t0) / rt.snapTime)) : 1;
        _v.set(cur.x, cur.y, cur.z).lerp(_w.copy(piece.home).multiplyScalar(arc), k);
        body.setNextKinematicTranslation(_v);
        const r = body.rotation();
        _q.set(r.x, r.y, r.z, r.w).slerp(new THREE.Quaternion(), k);
        body.setNextKinematicRotation(_q);
        rt.scale = THREE.MathUtils.lerp(rt.scale, 1, k);
        mesh.scale.setScalar(rt.scale);
        if (now - rt.t0 > rt.snapTime) {
          body.setNextKinematicTranslation(piece.home);
          body.setNextKinematicRotation(new THREE.Quaternion());
          rt.mode = 'done'; // stop updating; the component unmounts
          sfx.snap();
          setPlaced((s) => new Set(s).add(piece.id));
          onPlaced(piece.id);
          setLabel(piece.id);
        }
        continue;
      }

      // fly / park: spring towards the tray slot.
      const age = now - rt.t0;
      if (rt.mode === 'fly' && age > 0.45 && rt.collider) {
        rt.collider.setCollisionGroups(HIT);
        rt.mode = 'park';
      }
      const ramp = rt.mode === 'fly' ? 0 : THREE.MathUtils.clamp((age - 0.45) / 0.9, 0, 1);
      const [sx, sy] = layout.slots[rt.slot];
      const target = _v.copy(camera.position).addScaledVector(_right, sx * hh).addScaledVector(_up, sy * hh).addScaledVector(_fwd, depth);
      const p = body.translation();
      const desired = target.sub(_w.set(p.x, p.y, p.z)).multiplyScalar(6);
      if (desired.length() > 4) desired.setLength(4);
      const lv = body.linvel();
      const blend = 0.18 * ramp;
      body.setLinvel({ x: lv.x + (desired.x - lv.x) * blend, y: lv.y + (desired.y - lv.y) * blend, z: lv.z + (desired.z - lv.z) * blend }, true);

      const r = body.rotation();
      _q.set(r.x, r.y, r.z, r.w).invert().premultiply(parkQuat);
      if (_q.w < 0) _q.set(-_q.x, -_q.y, -_q.z, -_q.w);
      const angle = 2 * Math.acos(Math.min(1, _q.w));
      const sinH = Math.sqrt(Math.max(1e-8, 1 - _q.w * _q.w));
      const av = body.angvel();
      const wd = _w.set(_q.x / sinH, _q.y / sinH, _q.z / sinH).multiplyScalar(angle * 5);
      body.setAngvel({ x: av.x + (wd.x - av.x) * blend, y: av.y + (wd.y - av.y) * blend, z: av.z + (wd.z - av.z) * blend }, true);

      rt.scale = THREE.MathUtils.lerp(rt.scale, parkScale, Math.min(1, dt * 3));
      mesh.scale.setScalar(rt.scale);
      const wantR = slotR * 0.98;
      if (rt.collider && Math.abs(rt.ballR - wantR) > wantR * 0.05) {
        rt.collider.setRadius(wantR);
        rt.ballR = wantR;
      }
    }
  });

  // Dark translucent backing behind the trays, so pieces don't blend into the map.
  const aspect = size.width / size.height;
  const trayGeometry = useMemo(() => {
    const m = 0.04;
    const shapes = trayLayout(aspect, pieces.length).bands.map((b) => roundedRect(b.x0 - m, b.y0 - m, b.x1 + m, b.y1 + m, 0.06));
    return new THREE.ShapeGeometry(shapes, 6);
  }, [aspect, pieces.length]);
  const trayMaterial = useMemo(() => new THREE.MeshBasicMaterial({ color: style.antique ? '#1e140c' : '#0a1226', transparent: true, opacity: 0.62, depthWrite: false }), [style]);
  const tray = useRef<THREE.Mesh>(null);
  useFrame(() => {
    const t = tray.current;
    if (!t) return;
    const depth = Math.max(0.15, (camera.position.length() - 1) * TRAY_DEPTH) * 1.04;
    t.quaternion.copy(camera.quaternion);
    t.position.set(0, 0, -depth).applyQuaternion(camera.quaternion).add(camera.position);
    t.scale.setScalar(depth * HALF_FOV_TAN);
  });

  const remaining = pieces.filter((p) => !placed.has(p.id));

  return (
    <>
      <mesh ref={tray} geometry={trayGeometry} material={trayMaterial} raycast={() => null} renderOrder={1} />
      {remaining.map((p) => (
        <mesh key={`slot-${p.id}`} geometry={p.slot} material={slotMaterial} raycast={() => null} />
      ))}
      {remaining.filter((p) => p.rest).map((p) => (
        <mesh key={`rest-${p.id}`} geometry={p.rest!} material={materials.get(p.id)} raycast={() => null} />
      ))}
      {labelPiece && (
        <Html position={labelPiece.home.clone().multiplyScalar(1.01).toArray()} center zIndexRange={[20, 10]}>
          <button key={label} className="placed-label" onClick={(e) => { e.stopPropagation(); onInfo(labelPiece.id); setLabel(null); }}>
            {labelName} <span aria-hidden>ⓘ</span>
          </button>
        </Html>
      )}
      <Physics gravity={[0, 0, 0]}>
        {remaining.map((p) => {
          const rt = runtimes.get(p.id)!;
          const iv = initialVel.get(p.id)!;
          return (
            <RigidBody
              key={p.id}
              ref={(b) => { rt.body = b; }}
              type="dynamic"
              colliders={false}
              position={p.home.toArray()}
              linearVelocity={iv.v}
              angularVelocity={iv.w}
              linearDamping={1.4}
              angularDamping={2.5}
              gravityScale={0}
              canSleep={false}
            >
              <BallCollider ref={(c) => { rt.collider = c; }} args={[0.05]} collisionGroups={NO_HIT} />
              <mesh
                ref={(m) => { rt.mesh = m; }}
                geometry={p.geometry}
                material={materials.get(p.id)}
                onPointerDown={startDrag(p.id)}
                onPointerOver={() => { if (!drag.current) gl.domElement.style.cursor = 'grab'; }}
                onPointerOut={() => { if (!drag.current) gl.domElement.style.cursor = ''; }}
              >
                {/* Invisible grab handle: small or thin pieces are easy to pick up from the tray. */}
                <mesh visible={false} scale={p.radius * 0.75} geometry={handleGeometry} />
              </mesh>
            </RigidBody>
          );
        })}
      </Physics>
    </>
  );
}
