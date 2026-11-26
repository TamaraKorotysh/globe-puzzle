import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, advance, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import { Stars } from '@react-three/drei';
import type { ReactNode } from 'react';
import * as THREE from 'three';
import { colorIndices, type WorldGeometry } from './geo/buildCountries';
import { landMaskTexture } from './geo/landMask';
import type { GlobeStyle } from './globeStyles';
import Ocean from './Ocean';
import Space from './Space';
import { earthSlabMaterial, shared } from './crystal';
import { ANTIQUE_BACKDROP, antiqueSlabMaterial } from './antique';
import Labels from './Labels';
import Currents from './Currents';
import GlobeControls from './GlobeControls';
import Interior from './Interior';
import type { Lang } from './i18n';
import { lonLatToVec3 } from './geo/sphere';
import { countries, isDisputedZone } from './data';

const HOVER = '#ffd166';
const SELECTED = '#ff8c42';
/** Pointer moving more than this many px between down and up = drag, not click. */
const CLICK_TOLERANCE = 6;
const IDLE_RESUME_MS = 10000;

const DISPUTED = '#b4b4b4';

/** Neutral grey with diagonal stripes, computed from object-space position (no UVs needed). */
export function hatchedMaterial() {
  const mat = new THREE.MeshStandardMaterial({ color: DISPUTED, roughness: 0.85, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHatchPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHatchPos = position;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vHatchPos;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nfloat hatch = step(0.5, fract((vHatchPos.x + vHatchPos.y - vHatchPos.z) * 160.0));\ndiffuseColor.rgb *= mix(0.68, 1.0, hatch);',
      );
  };
  return mat;
}


interface Props {
  world: WorldGeometry;
  style: GlobeStyle;
  lang: Lang;
  selected: string | null;
  onSelect: (id: string | null) => void;
  /** Countries not drawn on the globe (puzzle pieces render them instead). */
  hiddenIds?: Set<string>;
  /** Initial camera position. */
  cameraPos?: [number, number, number];
  /** Freeze auto-rotation (comparison screenshots). */
  still?: boolean;
  /** Puzzle mode: no auto-rotation, no hover or country cards. */
  locked?: boolean;
  children?: ReactNode;
}

export const sunDir = shared.uLightDir.value;

// Dev only: lets automated checks step frames while the tab is in the background.
if (import.meta.env.DEV) (window as unknown as { __advance: typeof advance }).__advance = advance;

/** Map id → final country colour for a style (graph colouring, disputed zones grey). */
export function useCountryColors(world: WorldGeometry, style: GlobeStyle) {
  return useMemo(() => {
    const idx = colorIndices(world, style.palette.length);
    const m = new Map<string, string>();
    for (const c of world.countries) m.set(c.id, isDisputedZone(c.id) ? DISPUTED : style.palette[idx.get(c.id)!]);
    return m;
  }, [world, style]);
}

function Atmosphere() {
  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        vertexShader: /* glsl */ `
          varying vec3 vNormal;
          void main() {
            vNormal = normalize(normalMatrix * normal);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }`,
        fragmentShader: /* glsl */ `
          varying vec3 vNormal;
          void main() {
            float i = pow(0.72 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
            gl_FragColor = vec4(0.35, 0.65, 1.0, 1.0) * i;
          }`,
      }),
    [],
  );
  return (
    <mesh material={material} raycast={() => null}>
      <sphereGeometry args={[1.15, 64, 64]} />
    </mesh>
  );
}

function CapitalMarker({ lonLat }: { lonLat: [number, number] }) {
  const ref = useRef<THREE.Mesh>(null);
  const pos = useMemo(() => lonLatToVec3(lonLat[0], lonLat[1], 1.004), [lonLat]);
  useFrame(({ clock }) => {
    if (ref.current) ref.current.scale.setScalar(1 + 0.35 * Math.sin(clock.elapsedTime * 4));
  });
  return (
    <mesh ref={ref} position={pos} raycast={() => null}>
      <sphereGeometry args={[0.008, 16, 16]} />
      <meshBasicMaterial color="#e63946" />
    </mesh>
  );
}

/** Light that always shines from slightly above-left of the camera; also drives the ocean glint. */
function CameraLight({ intensity = 1.6 }: { intensity?: number }) {
  const light = useRef<THREE.DirectionalLight>(null);
  const { camera } = useThree();
  useFrame(() => {
    if (!light.current) return;
    light.current.position.copy(camera.position).add(new THREE.Vector3(-1, 1.2, 0).applyQuaternion(camera.quaternion));
    sunDir.copy(light.current.position).normalize();
  });
  return <directionalLight ref={light} intensity={intensity} />;
}

function Scene({ world, style, lang, selected, onSelect, hiddenIds, still, locked, children }: Props) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [autoRotate, setAutoRotate] = useState(!still);
  const colors = useCountryColors(world, style);
  const mask = useMemo(() => landMaskTexture(world.countries.flatMap((c) => c.polys)), [world]);
  const idleTimer = useRef<number>();
  const flyTarget = useRef<THREE.Vector3 | null>(null);
  const { camera, gl } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { update(): void } | null;
  const flyFrames = useRef(0);

  const materials = useMemo(() => {
    const m = new Map<string, THREE.MeshStandardMaterial>();
    for (const c of world.countries) {
      const disputed = isDisputedZone(c.id);
      if (style.realistic) m.set(c.id, earthSlabMaterial({ height: world.height, disputed, glow: 0.6 }));
      else if (style.antique) m.set(c.id, antiqueSlabMaterial({ height: world.height, mask, disputed }));
      else m.set(c.id, disputed ? hatchedMaterial() : new THREE.MeshStandardMaterial({ roughness: 0.8, vertexColors: true }));
    }
    return m;
  }, [world, style]);

  useEffect(() => {
    for (const [id, mat] of materials) {
      const hot = id === selected || id === hovered;
      mat.color.set(id === selected ? SELECTED : id === hovered ? HOVER : colors.get(id)!);
      const u = mat.userData.uniforms;
      if (u?.uTint) u.uTint.value = hot ? 0.55 : isDisputedZone(id) ? 0.6 : 0.12;
    }
  }, [materials, colors, hovered, selected]);

  useEffect(() => {
    gl.domElement.style.cursor = hovered ? 'pointer' : '';
  }, [hovered, gl]);
  useEffect(() => { if (locked) setHovered(null); }, [locked]);

  // Turn the globe to the selected country.
  useEffect(() => {
    if (!selected) return;
    const c = world.countries.find((x) => x.id === selected);
    const ll = countries[selected]?.capitalLonLat ?? c?.center;
    if (ll) { flyTarget.current = lonLatToVec3(ll[0], ll[1]).normalize(); flyFrames.current = 0; }
    setAutoRotate(false);
  }, [selected, world]);

  useFrame(() => {
    const target = flyTarget.current;
    if (!target) return;
    const dist = camera.position.length();
    const dir = camera.position.clone().normalize();
    if (dir.angleTo(target) < 0.003) { flyTarget.current = null; return; }
    dir.lerp(target, 0.08).normalize();
    camera.position.copy(dir.multiplyScalar(dist));
    camera.lookAt(0, 0, 0);
    controls?.update();
    // Some directions are out of reach (near the axis or beyond the look-up limit): give up after a while.
    if (++flyFrames.current > 120) flyTarget.current = null;
  });

  const onStart = () => {
    flyTarget.current = null;
    setAutoRotate(false);
    window.clearTimeout(idleTimer.current);
  };
  const onEnd = () => {
    window.clearTimeout(idleTimer.current);
    if (!still) idleTimer.current = window.setTimeout(() => setAutoRotate(true), IDLE_RESUME_MS);
  };
  useEffect(() => () => window.clearTimeout(idleTimer.current), []);

  const handleOver = (id: string) => (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && !locked) setHovered(id);
  };
  const handleClick = (id: string | null) => (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    if (e.delta > CLICK_TOLERANCE || locked) return;
    onSelect(id);
  };

  const selectedCapital = selected ? countries[selected]?.capitalLonLat : null;

  return (
    <>
      <ambientLight intensity={style.realistic ? 1.1 : 0.55} />
      <CameraLight intensity={style.realistic ? 2.6 : 1.6} />
      {style.realistic ? <Space puzzle={!!locked} /> : style.antique ? null : (
        <>
          <Stars radius={60} depth={30} count={2500} factor={3} fade speed={0.5} />
          <Atmosphere />
        </>
      )}

      {/* Ocean: also blocks pointer events from reaching countries on the far side. */}
      <Ocean
        style={style}
        mask={mask}
        lightDir={sunDir}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(null); }}
        onClick={handleClick(null)}
      />

      {world.countries.filter((c) => !hiddenIds?.has(c.id)).map((c) => (
        <mesh
          key={c.id}
          name={c.id}
          geometry={c.fill}
          material={materials.get(c.id)}
          onPointerOver={handleOver(c.id)}
          onPointerOut={() => setHovered((h) => (h === c.id ? null : h))}
          onClick={handleClick(c.id)}
        />
      ))}

      <lineSegments geometry={world.borders} raycast={() => null}>
        <lineBasicMaterial color={style.border} transparent opacity={style.borderOpacity} />
      </lineSegments>

      {!locked && <Currents style={style} />}
      {!locked && <Labels world={world} lang={lang} hidden={hiddenIds} seaLabels />}
      {children}

      {selectedCapital && <CapitalMarker lonLat={selectedCapital} />}

<GlobeControls
        enabled={!still}
        stand={!!style.antique && !locked}
        autoRotate={autoRotate && !selected && !still && !locked}
        onStart={onStart}
        onEnd={onEnd}
      />
      {style.antique && <Interior />}
    </>
  );
}

export default function Globe(props: Props) {
  return (
    <Canvas
      style={props.style.antique ? { background: ANTIQUE_BACKDROP } : undefined}
      camera={{ position: props.cameraPos ?? [0, 0.6, 2.8], fov: 45, near: 0.01, far: 200 }}
      dpr={[1, 2]}
      gl={{ antialias: true }}
    >
      {!props.style.antique && <color attach="background" args={[props.style.background]} />}
      <Scene {...props} />
    </Canvas>
  );
}
