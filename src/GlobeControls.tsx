import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

/** Earth's axial tilt: the globe leans like a real desk globe (north pole to the right). */
export const TILT = THREE.MathUtils.degToRad(23.44);
const PHI_MIN = THREE.MathUtils.degToRad(-35);
const PHI_MAX = THREE.MathUtils.degToRad(70);
const MIN_DIST = 1.25;
const MAX_DIST = 5;

const _Y = new THREE.Vector3(0, 1, 0);
const _Z = new THREE.Vector3(0, 0, 1);
const qTilt = new THREE.Quaternion().setFromAxisAngle(_Z, TILT);
const qTiltInv = qTilt.clone().invert();
const _q = new THREE.Quaternion();
const _v = new THREE.Vector3();

/**
 * The "room" frame: a desk-globe scene (stand, table, wall) whose up is world-up, while the globe's
 * axis (globe +Y) leans by TILT. Spinning the globe = rotating this frame around the globe axis by
 * theta, and the camera rides along — so the room looks still and the globe turns.
 * room → globe coordinates: M(theta) = Ry(theta) · Rz(TILT).
 */
export const view = { theta: 0, phi: 0.15, dist: 2.9, frame: new THREE.Quaternion(), shift: 0 };
// Dev only: automated checks read and set the view here.
if (import.meta.env.DEV) (window as unknown as { __view: typeof view }).__view = view;

function frameOf(theta: number, out: THREE.Quaternion) {
  return out.setFromAxisAngle(_Y, theta).multiply(qTilt);
}

/** Angles (theta, phi) that put the globe-space direction t straight in front of the camera. */
function anglesFacing(t: THREE.Vector3) {
  const rho = Math.hypot(t.x, t.z);
  const alpha = Math.atan2(t.x, t.z);
  const theta = alpha - Math.asin(THREE.MathUtils.clamp((-t.y * Math.tan(TILT)) / Math.max(rho, 1e-6), -1, 1));
  _v.copy(t).applyQuaternion(_q.setFromAxisAngle(_Y, -theta)).applyQuaternion(qTiltInv);
  return { theta, phi: Math.asin(THREE.MathUtils.clamp(_v.y, -1, 1)) };
}

interface Props {
  enabled?: boolean;
  autoRotate?: boolean;
  /** Raise the globe on screen so the stand and table show below it (desk-globe look). */
  stand?: boolean;
  onStart?: () => void;
  onEnd?: () => void;
}

/**
 * Desk-globe controls: horizontal drag spins the globe around its tilted axis, vertical drag looks
 * from a bit above / below, wheel or pinch zooms. Registered as the default `controls`, with the
 * same small API the puzzle uses (`enabled`, `update()` re-syncs after the camera was moved by code).
 */
export default function GlobeControls({ enabled = true, autoRotate, stand, onStart, onEnd }: Props) {
  const { camera, gl, set, get, size } = useThree();
  const cam = camera as THREE.PerspectiveCamera;
  const cb = useRef({ onStart, onEnd });
  cb.current = { onStart, onEnd };

  const api = useMemo(() => {
    const st = { enabled: true, vTheta: 0, vPhi: 0, dragging: false };
    const apply = () => {
      frameOf(view.theta, view.frame);
      cam.position.set(0, Math.sin(view.phi), Math.cos(view.phi)).multiplyScalar(view.dist).applyQuaternion(view.frame);
      cam.up.copy(_Y).applyQuaternion(view.frame);
      cam.lookAt(0, 0, 0);
    };
    /** Read angles back from wherever code put the camera, then snap to the tilted frame. */
    const update = () => {
      view.dist = THREE.MathUtils.clamp(cam.position.length(), MIN_DIST, MAX_DIST);
      const a = anglesFacing(_v.copy(cam.position).normalize());
      view.theta = a.theta;
      view.phi = THREE.MathUtils.clamp(a.phi, PHI_MIN, PHI_MAX);
      apply();
    };
    return { st, apply, update, get enabled() { return st.enabled; }, set enabled(v: boolean) { st.enabled = v; if (!v) st.dragging = false; } };
  }, [cam]);

  useEffect(() => { api.enabled = enabled; }, [api, enabled]);

  // First frame: adopt the initial camera; with a stand, start a little further back and from above.
  useEffect(() => {
    api.update();
    if (stand) { view.dist = Math.max(view.dist, 3.9); view.phi = 0.2; }
    api.apply();
    const prev = get().controls;
    set({ controls: api as unknown as THREE.EventDispatcher });
    return () => set({ controls: prev });
  }, [api, set, get]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pointer, wheel and pinch input.
  useEffect(() => {
    const el = gl.domElement;
    const pointers = new Map<number, { x: number; y: number }>();
    let pinch = 0;
    const speed = () => (Math.PI / el.clientHeight) * 1.1 * THREE.MathUtils.clamp((view.dist - 1) / 1.8, 0.12, 1.6);
    const down = (e: PointerEvent) => {
      if (!api.enabled || (e.pointerType === 'mouse' && e.button !== 0)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinch = Math.hypot(a.x - b.x, a.y - b.y);
      }
      api.st.vTheta = api.st.vPhi = 0;
      if (!api.st.dragging) { api.st.dragging = true; cb.current.onStart?.(); }
    };
    const move = (e: PointerEvent) => {
      const p = pointers.get(e.pointerId);
      if (!p || !api.enabled) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pointers.size >= 2) {
        const [a, b] = [...pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (pinch > 0) view.dist = THREE.MathUtils.clamp(view.dist * (pinch / d), MIN_DIST, MAX_DIST);
        pinch = d;
        return;
      }
      const k = speed();
      api.st.vTheta = -dx * k;
      api.st.vPhi = dy * k;
      view.theta += api.st.vTheta;
      view.phi = THREE.MathUtils.clamp(view.phi + api.st.vPhi, PHI_MIN, PHI_MAX);
    };
    const up = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (pointers.size < 2) pinch = 0;
      if (!pointers.size && api.st.dragging) { api.st.dragging = false; cb.current.onEnd?.(); }
    };
    const wheel = (e: WheelEvent) => {
      if (!api.enabled) return;
      e.preventDefault();
      cb.current.onStart?.();
      view.dist = THREE.MathUtils.clamp(view.dist * Math.exp(e.deltaY * 0.0012), MIN_DIST, MAX_DIST);
      cb.current.onEnd?.();
    };
    el.addEventListener('pointerdown', down);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    el.addEventListener('wheel', wheel, { passive: false });
    return () => {
      el.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      el.removeEventListener('wheel', wheel);
    };
  }, [api, gl]);

  useFrame((_, dt) => {
    const st = api.st;
    if (!st.dragging) {
      // Inertia after a flick, then optional slow eastward spin.
      const decay = Math.pow(1e-11, dt);
      st.vTheta *= decay; st.vPhi *= decay;
      view.theta += st.vTheta;
      view.phi = THREE.MathUtils.clamp(view.phi + st.vPhi, PHI_MIN, PHI_MAX);
      if (autoRotate) view.theta -= dt * 0.06;
    }
    // Desk-globe framing: shift the picture up so the stand shows, fading out when zoomed in.
    const target = stand ? 0.085 * THREE.MathUtils.smoothstep(view.dist, 2.0, 3.4) : 0;
    view.shift += (target - view.shift) * Math.min(1, dt * 4);
    // setViewOffset also sets the aspect from its full size, so pass the real aspect.
    const { width, height } = get().size;
    const asp = width / Math.max(1, height);
    if (Math.abs(view.shift) > 1e-4) cam.setViewOffset(asp, 1, 0, view.shift, asp, 1);
    else if (cam.view?.enabled) cam.clearViewOffset();
    api.apply();
  });

  // Keep the view offset correct after resizes (r3f resets the projection on resize).
  useEffect(() => { cam.updateProjectionMatrix(); }, [cam, size]);

  return null;
}
