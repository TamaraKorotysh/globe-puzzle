import * as THREE from 'three';

/** Uniforms shared by every crystal/earth material (updated once per frame by the scene). */
export const shared = {
  uTime: { value: 0 },
  /** Direction towards the light (world space). */
  uLightDir: { value: new THREE.Vector3(0, 0, 1) },
  /** Glow of the crystal base: low on the whole globe, high while the puzzle is scattered. */
  uBaseGlow: { value: 0.4 },
};

let earthTex: THREE.Texture | null = null;
let cloudTex: THREE.Texture | null = null;

function load(name: string, srgb: boolean) {
  const t = new THREE.TextureLoader().load(`${import.meta.env.BASE_URL}textures/${name}`);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}
/** NASA Blue Marble, equirectangular 4096×2048. */
export const earthTexture = () => (earthTex ??= load('earth.jpg', true));
/** Cloud cover (grey = opacity), equirectangular 2048×1024. */
export const cloudTexture = () => (cloudTex ??= load('clouds.jpg', false));

/** GLSL: lon/lat UVs from a direction, and a seam-free equirect lookup (no mip line at ±180°). */
export const EQ_GLSL = /* glsl */ `
  vec2 eqUv(vec3 n) {
    return vec2(atan(n.x, n.z) / 6.2831853 + 0.5, asin(clamp(n.y, -1.0, 1.0)) / 3.1415927 + 0.5);
  }
  vec4 sampleEq(sampler2D t, vec2 uv) {
    vec2 uv2 = vec2(fract(uv.x + 0.5), uv.y);
    vec2 dx = dFdx(uv), dy = dFdy(uv), dx2 = dFdx(uv2), dy2 = dFdy(uv2);
    if (abs(dx2.x) + abs(dy2.x) < abs(dx.x) + abs(dy.x)) { dx = dx2; dy = dy2; }
    return textureGrad(t, uv, dx, dy);
  }`;

/**
 * GLSL: faceted crystal surface of the base sphere. n = surface direction, V = towards the eye,
 * L = towards the light. Voronoi cells act as facets with their own tilt, edges glow.
 */
export const CRYSTAL_GLSL = /* glsl */ `
  vec3 cHash3(vec3 p) {
    p = vec3(dot(p, vec3(127.1, 311.7, 74.7)), dot(p, vec3(269.5, 183.3, 246.1)), dot(p, vec3(113.5, 271.9, 124.6)));
    return fract(sin(p) * 43758.5453);
  }
  vec3 crystalBase(vec3 n, vec3 V, vec3 L, float t, float glow) {
    vec3 q = n * 46.0;
    vec3 ip = floor(q), fp = fract(q);
    float f1 = 8.0, f2 = 8.0;
    vec3 rnd = vec3(0.5);
    for (int z = -1; z <= 1; z++)
    for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec3 o = vec3(float(x), float(y), float(z));
      vec3 d = o + cHash3(ip + o) - fp;
      float dd = dot(d, d);
      if (dd < f1) { f2 = f1; f1 = dd; rnd = cHash3(ip + o + 19.19); }
      else if (dd < f2) f2 = dd;
    }
    float edge = sqrt(f2) - sqrt(f1);
    vec3 fn = normalize(n + (rnd - 0.5) * 0.45);
    vec3 H = normalize(L + V);
    float spec = pow(max(dot(fn, H), 0.0), 220.0) * step(0.6, rnd.x) * 0.8;
    float facet = 0.5 + 0.5 * dot(fn, L);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 2.5);
    // Deep blue body with a light "inside" that drifts slowly through the crystal.
    float inner = 0.5 + 0.5 * sin(dot(n, vec3(9.0, 7.0, 5.0)) + t * 0.6);
    vec3 deep = vec3(0.01, 0.025, 0.08);
    vec3 ice = vec3(0.35, 0.72, 1.0);
    vec3 violet = vec3(0.6, 0.42, 1.0);
    vec3 tint = mix(ice, violet, rnd.y * 0.8);
    float pulse = 0.7 + 0.3 * sin(t * 1.3 + rnd.z * 6.2832);
    vec3 col = deep + tint * 0.13 * facet * (0.3 + rnd.x);
    col += tint * (1.0 - smoothstep(0.0, 0.035, edge)) * (0.06 + 0.22 * glow) * pulse;
    col += vec3(0.85, 0.95, 1.0) * spec;
    col += ice * fres * 0.35;
    col += mix(ice, violet, inner) * glow * (0.05 + 0.07 * inner);
    return col;
  }`;

interface SlabOpts {
  height: number;
  disputed?: boolean;
  /** See-through crystal walls (loose puzzle pieces). */
  translucent?: boolean;
  /** Strength of the glow in the crystal walls. */
  glow?: number;
}

/**
 * Country slab: the top shows the satellite image tinted by `material.color` (strength = uTint),
 * side walls and bottom are glowing crystal. Needs the aGlobe/aPart attributes from buildSlab.
 */
export function earthSlabMaterial({ height, disputed, translucent, glow = 0.7 }: SlabOpts) {
  const mat = new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, transparent: !!translucent });
  const uniforms = {
    uEarth: { value: earthTexture() },
    uTint: { value: disputed ? 0.6 : 0.12 },
    uHeight: { value: height },
    uGlow: { value: glow },
    uWallAlpha: { value: translucent ? 0.72 : 1 },
    uTime: shared.uTime,
  };
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
        uniform sampler2D uEarth; uniform float uTint, uHeight, uGlow, uWallAlpha, uTime;
        varying vec3 vGlobe; varying float vPart;
        ${EQ_GLSL}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 gN = normalize(vGlobe);
        vec3 earth = sampleEq(uEarth, eqUv(gN)).rgb;
        bool isTop = vPart < 0.5;
        if (isTop) {
          float lum = dot(earth, vec3(0.3, 0.59, 0.11));
          // Brighter and more saturated than the raw image, like the reference renders.
          vec3 base = mix(vec3(lum), earth, 1.35) * 1.3;
          ${disputed ? `base = vec3(lum * 1.1);
          base *= mix(0.62, 1.0, step(0.5, fract((vGlobe.x + vGlobe.y - vGlobe.z) * 160.0)));` : ''}
          diffuseColor.rgb = mix(base, diffuse * (0.45 + lum * 2.2), uTint);
        } else {
          diffuseColor.rgb = vec3(0.02, 0.06, 0.13) + earth * 0.12;
          diffuseColor.a = uWallAlpha;
        }`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
        roughnessFactor = isTop ? 0.9 : 0.25;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        if (!isTop) {
          float facing = abs(dot(normal, normalize(vViewPosition)));
          float fres = pow(1.0 - facing, 2.0);
          float h = clamp((length(vGlobe) - 1.0) / uHeight, 0.0, 1.0);
          float rim = smoothstep(0.7, 1.0, h) + smoothstep(0.3, 0.0, h) * 0.5;
          float streak = 0.7 + 0.3 * sin(dot(vGlobe, vec3(613.0, 421.0, 537.0)));
          float shimmer = 0.85 + 0.15 * sin(uTime * 2.0 + dot(vGlobe, vec3(40.0, 31.0, 23.0)));
          vec3 ice = vec3(0.2, 0.62, 1.0), vio = vec3(0.5, 0.32, 1.0);
          vec3 tint = mix(ice, vio, 0.3 + 0.4 * streak * (1.0 - h));
          totalEmissiveRadiance += tint * (0.12 + fres * 0.5 + rim * 0.55) * streak * shimmer * uGlow;
          totalEmissiveRadiance += earth * vec3(0.5, 0.8, 1.0) * 0.35;
        }`);
  };
  mat.customProgramCacheKey = () => `earthSlab-${disputed ? 1 : 0}`;
  return mat;
}

/** The base sphere under a scattered piece: faceted, softly glowing crystal. */
export function crystalBaseMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: shared.uTime, uLightDir: shared.uLightDir, uGlow: shared.uBaseGlow },
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime, uGlow;
      uniform vec3 uLightDir;
      varying vec3 vPos;
      ${CRYSTAL_GLSL}
      void main() {
        vec3 n = normalize(vPos);
        gl_FragColor = vec4(crystalBase(n, normalize(cameraPosition - vPos), uLightDir, uTime, uGlow), 1.0);
        #include <colorspace_fragment>
      }`,
  });
}
