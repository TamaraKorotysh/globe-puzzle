import { useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import * as THREE from 'three';
import { EQ_GLSL, cloudTexture, shared } from './crystal';

const NOISE = /* glsl */ `
  float hash(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
  float noise(vec3 x) {
    vec3 i = floor(x), f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
               mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
  }
  float fbm(vec3 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 6; i++) { s += a * noise(p); p *= 2.02; a *= 0.5; } return s; }`;

/** Sky sphere: dark navy with a band of blue / violet / pink nebula and dust lanes. */
function Nebula() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vDir;
          ${NOISE}
          void main() {
            vec3 d = normalize(vDir);
            float band = exp(-pow(dot(d, normalize(vec3(0.45, 1.0, 0.25))) / 0.42, 2.0));
            vec3 q = d * 2.3;
            float w = fbm(q * 1.4 + 3.0);
            float n = fbm(q + w * 1.6);
            float n2 = fbm(q * 2.6 + 7.0);
            float dens = smoothstep(0.38, 0.85, n) * (0.2 + band);
            float dust = smoothstep(0.52, 0.72, fbm(q * 4.0 + 11.0)) * band;
            vec3 col = vec3(0.002, 0.004, 0.018);
            col += vec3(0.03, 0.06, 0.22) * (0.3 + band) * n;
            col += mix(vec3(0.2, 0.07, 0.38), vec3(0.05, 0.12, 0.45), n2) * dens * 0.6;
            col += vec3(0.8, 0.35, 0.7) * pow(dens, 2.5) * n2 * 0.7;
            col *= 1.0 - dust * 0.65;
            gl_FragColor = vec4(col, 1.0);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  return (
    <mesh material={material} raycast={() => null} renderOrder={-10}>
      <sphereGeometry args={[90, 64, 32]} />
    </mesh>
  );
}

/** Cloud layer just above the country slabs; fades away when zoomed in or while the puzzle is scattered. */
function Clouds({ hidden }: { hidden: boolean }) {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        uniforms: { uClouds: { value: cloudTexture() }, uLightDir: shared.uLightDir, uOpacity: { value: 0 }, uShift: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec3 vPos;
          void main() {
            vPos = position;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uClouds;
          uniform vec3 uLightDir;
          uniform float uOpacity, uShift;
          varying vec3 vPos;
          ${EQ_GLSL}
          void main() {
            vec3 n = normalize(vPos);
            vec2 uv = eqUv(n);
            uv.x += uShift;
            float c = sampleEq(uClouds, uv).r;
            c = smoothstep(0.12, 0.9, c);
            float light = 0.35 + 0.75 * max(dot(n, uLightDir), 0.0);
            gl_FragColor = vec4(vec3(light), c * uOpacity);
            #include <colorspace_fragment>
          }`,
      }),
    [],
  );
  useFrame(({ camera, clock }, dt) => {
    const zoom = THREE.MathUtils.smoothstep(camera.position.length(), 1.5, 2.6);
    const target = hidden ? 0 : 0.65 * zoom;
    const u = material.uniforms;
    u.uOpacity.value += (target - u.uOpacity.value) * Math.min(1, dt * 3);
    u.uShift.value = clock.elapsedTime * 0.002;
  });
  return (
    <mesh material={material} raycast={() => null} renderOrder={2}>
      <sphereGeometry args={[1.024, 128, 64]} />
    </mesh>
  );
}

const SKY = new THREE.Color(0.3, 0.6, 1.0);
const CRYSTAL = new THREE.Color(0.5, 0.65, 1.0);

/** Blue haze on the limb plus an outer halo; turns into a brighter crystal aura while the puzzle is on. */
function Atmosphere({ crystal }: { crystal: boolean }) {
  const [halo, rim] = useMemo(() => {
    const common = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false };
    const vertexShader = /* glsl */ `
      varying vec3 vNormal; varying vec3 vView;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-mv.xyz);
        gl_Position = projectionMatrix * mv;
      }`;
    const uniforms = () => ({ uColor: { value: SKY.clone() }, uStrength: { value: 1 } });
    return [
      new THREE.ShaderMaterial({
        ...common, side: THREE.BackSide, uniforms: uniforms(), vertexShader,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uStrength;
          varying vec3 vNormal; varying vec3 vView;
          void main() {
            // 0 at the halo's outer edge, strongest where it meets the globe's limb.
            float i = pow(smoothstep(0.0, 0.55, -dot(vNormal, vView)), 2.5) * 1.1;
            gl_FragColor = vec4(uColor * i * uStrength, 1.0);
          }`,
      }),
      new THREE.ShaderMaterial({
        ...common, uniforms: uniforms(), vertexShader,
        fragmentShader: /* glsl */ `
          uniform vec3 uColor; uniform float uStrength;
          varying vec3 vNormal; varying vec3 vView;
          void main() {
            float f = 1.0 - max(dot(vNormal, vView), 0.0);
            float i = pow(f, 3.0) * 1.3 + pow(f, 8.0) * 1.5;
            gl_FragColor = vec4(uColor * i * uStrength, 1.0);
          }`,
      }),
    ];
  }, []);
  useFrame((_, dt) => {
    const k = Math.min(1, dt * 2.5);
    for (const m of [halo, rim]) {
      m.uniforms.uColor.value.lerp(crystal ? CRYSTAL : SKY, k);
      m.uniforms.uStrength.value += ((crystal ? 1.35 : 1) - m.uniforms.uStrength.value) * k;
    }
    shared.uBaseGlow.value += ((crystal ? 1 : 0.35) - shared.uBaseGlow.value) * k;
  });
  return (
    <>
      <mesh material={halo} raycast={() => null}>
        <sphereGeometry args={[1.18, 96, 64]} />
      </mesh>
      <mesh material={rim} raycast={() => null} renderOrder={3}>
        <sphereGeometry args={[1.03, 128, 64]} />
      </mesh>
    </>
  );
}

/** Space backdrop for the realistic style: nebula, stars, clouds, atmosphere. */
export default function Space({ puzzle }: { puzzle: boolean }) {
  useFrame(({ clock }) => { shared.uTime.value = clock.elapsedTime; });
  return (
    <>
      <Nebula />
      <Stars radius={45} depth={30} count={6000} factor={3.2} saturation={0.4} fade speed={0.6} />
      <Atmosphere crystal={puzzle} />
      <Clouds hidden={puzzle} />
    </>
  );
}
