import * as THREE from 'three';
import { EQ_GLSL, shared } from './crystal';

/**
 * GLSL for the antique-globe look: aged paper, ink graticule with red dashed tropics, plaster crackle.
 * Everything is computed from the direction on the sphere — no textures.
 */
export const ANTIQUE_GLSL = /* glsl */ `
  float aHash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float aNoise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(aHash(i), aHash(i + vec3(1,0,0)), f.x), mix(aHash(i + vec3(0,1,0)), aHash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(aHash(i + vec3(0,0,1)), aHash(i + vec3(1,0,1)), f.x), mix(aHash(i + vec3(0,1,1)), aHash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float aFbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * aNoise(p); p *= 2.03; a *= 0.5; } return s; }

  /** Multiplier for aged paper: grain, fibres, foxing stains, yellowed varnish. */
  vec3 agedPaper(vec3 n, vec3 col) {
    float grain = aNoise(n * 900.0) * 0.5 + aNoise(n * 260.0) * 0.5;
    float cloudy = aFbm(n * 7.0);
    col *= 0.9 + 0.16 * cloudy + 0.07 * (grain - 0.5);
    float stain = smoothstep(0.58, 0.82, aFbm(n * 3.2 + 5.0));
    col = mix(col, col * vec3(0.78, 0.62, 0.42), stain * 0.55);
    float fox = smoothstep(0.78, 0.9, aNoise(n * 38.0 + 2.0));
    col = mix(col, col * vec3(0.72, 0.52, 0.34), fox * 0.35);
    return mix(col, col * vec3(1.0, 0.9, 0.68), 0.35);
  }

  /** Ink line mask for a coordinate in degrees, lines every 'step' degrees. */
  float gridLine(float deg, float step, float width) {
    float v = deg / step;
    float d = abs(fract(v + 0.5) - 0.5) * step;
    float w = fwidth(deg) * width;
    return 1.0 - smoothstep(w * 0.5, w * 1.5, d);
  }
  float atLat(float lat, float target, float width) {
    float w = fwidth(lat) * width;
    return 1.0 - smoothstep(w * 0.5, w * 1.5, abs(lat - target));
  }

  /** Ink-coloured overlay: rgb = ink colour, a = coverage. */
  vec4 graticule(vec3 n) {
    float lon = degrees(atan(n.x, n.z));
    float lat = degrees(asin(clamp(n.y, -1.0, 1.0)));
    // Meridians thin out near the poles so they do not merge into a blot.
    float g = max(gridLine(lon, 15.0, 1.0) * (1.0 - smoothstep(75.0, 88.0, abs(lat))), gridLine(lat, 15.0, 1.0));
    vec4 ink = vec4(0.28, 0.18, 0.1, g * 0.45);
    // Equator, tropics and polar circles: red dashes.
    float dash = step(0.5, fract(lon / 3.0));
    float red = max(atLat(lat, 0.0, 1.6), max(atLat(abs(lat), 23.44, 1.3), atLat(abs(lat), 66.56, 1.3))) * dash;
    ink = mix(ink, vec4(0.62, 0.14, 0.08, 0.75), red);
    return ink;
  }

  /** Bare plaster sphere under the paper gores: off-white, crackled, slightly dusty. */
  vec3 plaster(vec3 n, vec3 L) {
    vec3 q = n * 30.0;
    vec3 ip = floor(q), fp = fract(q);
    float f1 = 8.0, f2 = 8.0;
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 o = vec3(float(x), float(y), float(z));
      vec3 h = vec3(aHash(ip + o), aHash(ip + o + 7.1), aHash(ip + o + 13.7));
      vec3 d = o + h - fp;
      float dd = dot(d, d);
      if (dd < f1) { f2 = f1; f1 = dd; } else if (dd < f2) f2 = dd;
    }
    float crack = 1.0 - smoothstep(0.0, 0.05, sqrt(f2) - sqrt(f1));
    vec3 col = vec3(0.86, 0.81, 0.7) * (0.9 + 0.15 * aFbm(n * 18.0));
    col = mix(col, vec3(0.42, 0.33, 0.22), crack * 0.7);
    return col * (0.55 + 0.5 * max(dot(n, L), 0.0));
  }`;

interface SlabOpts { height: number; mask: THREE.Texture; disputed?: boolean }

/**
 * Country slab, antique look: watercolour wash of `material.color` on aged paper with the ink graticule;
 * walls are layered card with a gilt top edge. Needs the aGlobe/aPart attributes from buildSlab.
 */
export function antiqueSlabMaterial({ height, mask, disputed }: SlabOpts) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.75, metalness: 0 });
  const uniforms = { uHeight: { value: height }, uMask: { value: mask } };
  mat.userData.uniforms = uniforms;
  mat.onBeforeCompile = (s) => {
    Object.assign(s.uniforms, uniforms);
    s.vertexShader = s.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aGlobe; attribute float aPart;
        varying vec3 vGlobe; varying float vPart;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vGlobe = aGlobe; vPart = aPart;`);
    s.fragmentShader = s.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uHeight;
        uniform sampler2D uMask;
        varying vec3 vGlobe; varying float vPart;
        ${EQ_GLSL}
        ${ANTIQUE_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 gN = normalize(vGlobe);
        bool isTop = vPart < 0.5;
        float gilt = 0.0;
        if (isTop) {
          // Uneven watercolour wash: pigment pools in places, paper shows through in others.
          float wash = aFbm(gN * 22.0);
          vec3 c = mix(vec3(0.93, 0.88, 0.74), diffuse, 0.6 + 0.4 * wash);
          // Old-map shading: land darkens to deep brown towards the coast.
          float coast = 1.0 - smoothstep(0.55, 1.0, sampleEq(uMask, eqUv(gN)).g);
          c = mix(c, c * vec3(0.42, 0.27, 0.15), coast * 0.85);
          ${disputed ? `c = vec3(0.8, 0.76, 0.66);
          c *= mix(0.7, 1.0, step(0.5, fract((vGlobe.x + vGlobe.y - vGlobe.z) * 160.0)));` : ''}
          c = agedPaper(gN, c);
          vec4 ink = graticule(gN);
          diffuseColor.rgb = mix(c, ink.rgb, ink.a);
        } else {
          // Layered card: cream with thin brown seams; a gilt band along the top edge.
          float h = clamp((length(vGlobe) - 1.0) / uHeight, 0.0, 1.0);
          float seam = 1.0 - smoothstep(0.0, 0.08, abs(fract(h * 4.0) - 0.5) * 2.0 - 0.84);
          vec3 card = vec3(0.86, 0.79, 0.64) * (0.9 + 0.2 * aNoise(vGlobe * 700.0));
          card = mix(card, vec3(0.45, 0.32, 0.2), seam * 0.5);
          gilt = smoothstep(0.78, 0.86, h) * (vPart < 1.5 ? 1.0 : 0.0);
          diffuseColor.rgb = mix(card, vec3(0.83, 0.62, 0.26), gilt);
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = isTop ? 0.62 : mix(0.85, 0.3, gilt);`)
      .replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
        metalnessFactor = gilt * 0.85;`);
  };
  mat.customProgramCacheKey = () => `antiqueSlab-${disputed ? 1 : 0}`;
  return mat;
}

/** Plaster under a lifted piece. */
export function plasterMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uLightDir: shared.uLightDir },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLightDir;
      varying vec3 vPos;
      ${ANTIQUE_GLSL}
      void main() {
        gl_FragColor = vec4(plaster(normalize(vPos), uLightDir), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Warm "study room" backdrop behind the canvas (the canvas itself is transparent in this style). */
export const ANTIQUE_BACKDROP =
  'radial-gradient(ellipse at 50% 45%, #5a4029 0%, #2e2015 45%, #140d08 80%, #0a0604 100%)';
