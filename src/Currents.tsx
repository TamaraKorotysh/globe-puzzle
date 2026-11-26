import { useMemo } from 'react';
import * as THREE from 'three';
import { currentPoints, currents } from './geo/currents';
import { shared } from './crystal';
import type { GlobeStyle } from './globeStyles';

/** Just above the ocean, below the country slabs (they hide any bit that touches land). */
const R = 1.0012;
/** Half-width of the line and length of the arrowhead (globe radius = 1). */
const HALF_W = 0.0055;
const HEAD = 0.05;

/** All currents as one ribbon mesh: a dashed band that flows along the current, ending in an arrowhead. */
function buildGeometry() {
  const pos: number[] = [], s: number[] = [], v: number[] = [], len: number[] = [], warm: number[] = [];
  const index: number[] = [];
  const side = new THREE.Vector3(), t = new THREE.Vector3();
  for (const c of currents) {
    const pts = currentPoints(c, R);
    const arc = [0];
    for (let i = 1; i < pts.length; i++) arc.push(arc[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = arc[arc.length - 1];
    const base = pos.length / 3;
    pts.forEach((p, i) => {
      t.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
      side.crossVectors(p, t).normalize();
      const left = total - arc[i];
      const hw = left < HEAD ? HALF_W * 2.4 * (left / HEAD) : HALF_W * Math.min(1, 0.4 + arc[i] / 0.05);
      for (const k of [-1, 1]) {
        pos.push(p.x + side.x * hw * k, p.y + side.y * hw * k, p.z + side.z * hw * k);
        s.push(arc[i]); v.push(k); len.push(total); warm.push(c.warm ? 1 : 0);
      }
      if (i) {
        const a = base + (i - 1) * 2;
        index.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    });
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(s, 1));
  g.setAttribute('aV', new THREE.Float32BufferAttribute(v, 1));
  g.setAttribute('aLen', new THREE.Float32BufferAttribute(len, 1));
  g.setAttribute('aWarm', new THREE.Float32BufferAttribute(warm, 1));
  g.setIndex(index);
  return g;
}

const COLORS = {
  antique: { warm: '#9e2b1b', cold: '#2c4d72', alpha: 0.8 },
  space: { warm: '#ff9466', cold: '#7fd4ff', alpha: 0.85 },
  default: { warm: '#e0533a', cold: '#2a6fb5', alpha: 0.8 },
};

export default function Currents({ style }: { style: GlobeStyle }) {
  const geometry = useMemo(buildGeometry, []);
  const material = useMemo(() => {
    const pal = style.antique ? COLORS.antique : style.realistic ? COLORS.space : COLORS.default;
    return new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      uniforms: {
        uTime: shared.uTime,
        uWarm: { value: new THREE.Color(pal.warm) },
        uCold: { value: new THREE.Color(pal.cold) },
        uAlpha: { value: pal.alpha },
      },
      vertexShader: /* glsl */ `
        attribute float aS, aV, aLen, aWarm;
        varying float vS, vV, vLen, vWarm;
        void main() {
          vS = aS; vV = aV; vLen = aLen; vWarm = aWarm;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime, uAlpha;
        uniform vec3 uWarm, uCold;
        varying float vS, vV, vLen, vWarm;
        void main() {
          bool head = vLen - vS < ${HEAD.toFixed(4)};
          // Dashes drift along the current, so the flow direction is visible even without the arrow.
          float dash = head ? 1.0 : step(fract((vS - uTime * 0.012) / 0.045), 0.72);
          float edge = 1.0 - smoothstep(0.65, 1.0, abs(vV));
          float fadeIn = smoothstep(0.0, 0.04, vS);
          float a = dash * edge * fadeIn * uAlpha;
          if (a < 0.01) discard;
          gl_FragColor = vec4(mix(uCold, uWarm, vWarm), a);
          #include <colorspace_fragment>
        }`,
    });
  }, [style]);
  return <mesh geometry={geometry} material={material} raycast={() => null} renderOrder={1} />;
}
