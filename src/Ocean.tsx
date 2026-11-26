import { useMemo } from 'react';
import { useFrame, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import type { GlobeStyle } from './globeStyles';
import { CRYSTAL_GLSL, EQ_GLSL, earthTexture, shared } from './crystal';
import { ANTIQUE_GLSL } from './antique';

const vertexShader = /* glsl */ `
  varying vec3 vPos;
  void main() {
    vPos = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }`;

const fragmentShader = /* glsl */ `
  uniform sampler2D uMask;
  uniform vec3 uDeep, uShallow, uShadow, uLightDir;
  uniform float uGlint, uRelief, uTime, uReal, uBaseGlow, uAntique;
  uniform sampler2D uEarth;
  varying vec3 vPos;
  ${EQ_GLSL}
  ${CRYSTAL_GLSL}
  ${ANTIQUE_GLSL}

  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * noise(p); p *= 2.03; a *= 0.5; } return s; }
  // Ridged noise — looks like mid-ocean ridges and trenches.
  float ridged(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * (1.0 - abs(noise(p) * 2.0 - 1.0)); p *= 2.1; a *= 0.5; } return s; }

  float floorHeight(vec3 n, vec4 m) {
    float deep = mix(fbm(n * 3.0), ridged(n * 2.2), 0.55);
    return m.g * 0.9 + deep * uRelief * (1.0 - m.g);
  }

  void main() {
    vec3 n = normalize(vPos);
    vec2 uv = vec2(atan(n.x, n.z) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.1415927 + 0.5);
    vec4 m = texture2D(uMask, uv);

    // Sea-floor relief: height → colour, plus slope shading from finite differences.
    float h = floorHeight(n, m);
    vec3 t1 = normalize(cross(n, vec3(0.0, 1.0, 0.0) + 1e-4));
    vec3 t2 = cross(n, t1);
    float e = 0.012;
    float hx = floorHeight(normalize(n + t1 * e), m) - h;
    float hy = floorHeight(normalize(n + t2 * e), m) - h;
    vec3 floorN = normalize(n - (t1 * hx + t2 * hy) * 6.0);

    vec3 col = mix(uDeep, uShallow, smoothstep(0.05, 1.0, h));
    if (uReal > 0.5) {
      // Satellite image of the water, slightly bluer and lifted near the shelf.
      vec3 sat = sampleEq(uEarth, uv).rgb;
      col = mix(sat * vec3(0.8, 1.05, 1.45), uShallow, m.g * 0.25) * 1.7;
    }
    float slope = dot(floorN, uLightDir) - dot(n, uLightDir);
    col *= 1.0 + slope * 1.6 * uRelief;
    // Soft shadow hugging the coast (countries are raised slabs).
    col = mix(col, uShadow, smoothstep(0.35, 1.0, m.b) * 0.55);

    // Water surface: diffuse + sun glint with small moving ripples.
    vec3 V = normalize(cameraPosition - vPos);
    vec3 ripple = vec3(noise(n * 140.0 + uTime * 0.25), noise(n * 140.0 + 7.3 - uTime * 0.2), noise(n * 140.0 + 3.1)) - 0.5;
    vec3 waterN = normalize(n + ripple * 0.06);
    float diff = clamp(dot(n, uLightDir), 0.0, 1.0);
    col *= 0.45 + 0.75 * diff;
    vec3 Hh = normalize(uLightDir + V);
    float spec = pow(max(dot(waterN, Hh), 0.0), 140.0) * 1.4 + pow(max(dot(n, Hh), 0.0), 24.0) * 0.12;
    col += vec3(1.0, 0.96, 0.85) * spec * uGlint * (1.0 - m.r);
    // Fresnel: rims pick up a bit of sky.
    float fr = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col = mix(col, uShallow * 1.2 + 0.1, fr * 0.35);
    // Realistic style: where land is (under the countries / empty puzzle spots) the base is crystal.
    if (uReal > 0.5 && m.r > 0.02) col = mix(col, crystalBase(n, V, uLightDir, uTime, uBaseGlow), smoothstep(0.25, 0.75, m.r));
    if (uAntique > 0.5) {
      // Ivory paper sea, brown halo along the coast, engraved water-lining parallel to the shore.
      vec3 c = mix(uShallow, uDeep, aFbm(n * 4.0) * 0.9);
      c = mix(c, uShadow, smoothstep(0.15, 1.0, m.b) * 0.6);
      float d = m.g * 7.0;
      float fd = 0.5 - abs(fract(d) - 0.5);
      float w = fwidth(d);
      float line = (1.0 - smoothstep(w * 0.5, w * 1.5, fd)) * smoothstep(0.03, 0.2, m.g) * (1.0 - smoothstep(0.85, 1.0, m.g));
      c = mix(c, uShadow, line * 0.45);
      c = agedPaper(n, c);
      vec4 ink = graticule(n);
      c = mix(c, ink.rgb, ink.a);
      c *= 0.62 + 0.48 * max(dot(n, uLightDir), 0.0);
      c += vec3(1.0, 0.9, 0.7) * pow(max(dot(n, Hh), 0.0), 40.0) * uGlint;
      c *= mix(0.55, 1.0, pow(max(dot(n, V), 0.0), 0.4));
      col = mix(c, plaster(n, uLightDir), smoothstep(0.25, 0.75, m.r));
    }
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

interface Props {
  style: GlobeStyle;
  mask: THREE.Texture;
  lightDir: THREE.Vector3;
  onPointerOver?: (e: ThreeEvent<PointerEvent>) => void;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
}

/** Ocean sphere: sea-floor relief seen through the water, coastal shadows and a sun glint. */
export default function Ocean({ style, mask, lightDir, onPointerOver, onClick }: Props) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uMask: { value: mask },
          uDeep: { value: new THREE.Color(style.oceanDeep) },
          uShallow: { value: new THREE.Color(style.oceanShallow) },
          uShadow: { value: new THREE.Color(style.coastShadow) },
          uLightDir: { value: lightDir },
          uGlint: { value: style.glint },
          uRelief: { value: style.relief },
          uTime: shared.uTime,
          uReal: { value: style.realistic ? 1 : 0 },
          uAntique: { value: style.antique ? 1 : 0 },
          uEarth: { value: earthTexture() },
          uBaseGlow: shared.uBaseGlow,
        },
      }),
    [style, mask, lightDir],
  );
  useFrame(({ clock }) => { if (!style.realistic) shared.uTime.value = clock.elapsedTime; });
  return (
    <mesh
      material={material}
      onPointerOver={onPointerOver}
      onPointerMove={(e) => e.stopPropagation()}
      onClick={onClick}
    >
      <sphereGeometry args={[0.999, 128, 128]} />
    </mesh>
  );
}
