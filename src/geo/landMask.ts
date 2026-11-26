import * as THREE from 'three';
import type { Poly } from './buildCountries';

const W = 1024;
const H = 512;

/** Running-sum box blur, horizontal then vertical, wrapping in longitude. */
function boxBlur(src: Float32Array, r: number): Float32Array {
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  const n = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    const row = y * W;
    let s = 0;
    for (let k = -r; k <= r; k++) s += src[row + ((k + W) % W)];
    for (let x = 0; x < W; x++) {
      tmp[row + x] = s / n;
      s += src[row + ((x + r + 1) % W)] - src[row + ((x - r + W) % W)];
    }
  }
  for (let x = 0; x < W; x++) {
    let s = 0;
    for (let k = -r; k <= r; k++) s += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = s / n;
      s += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

function blur(src: Float32Array, r: number, passes = 3) {
  let a = src;
  for (let i = 0; i < passes; i++) a = boxBlur(a, r);
  return a;
}

let cache: THREE.DataTexture | null = null;

/**
 * Equirectangular texture: R = land (sharp), G = wide blur (continental shelf),
 * B = narrow blur (coastal shadow).
 */
export function landMaskTexture(polys: Poly[]): THREE.DataTexture {
  if (cache) return cache;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  for (const poly of polys) {
    ctx.beginPath();
    for (const ring of poly) {
      ring.forEach(([lon, lat], i) => {
        const x = ((lon + 180) / 360) * W, y = ((90 - lat) / 180) * H;
        if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y);
      });
      ctx.closePath();
    }
    ctx.fill('evenodd');
  }
  const img = ctx.getImageData(0, 0, W, H).data;
  const land = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) land[i] = img[i * 4] / 255;
  const shelf = blur(land, 9);
  const coast = blur(land, 2, 2);
  const data = new Uint8Array(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    // Rows are flipped so v = 0 is the south pole (texture convention).
    const y = Math.floor(i / W), x = i % W;
    const j = ((H - 1 - y) * W + x) * 4;
    data[j] = land[i] * 255;
    data[j + 1] = Math.min(1, shelf[i] * 1.6) * 255;
    data[j + 2] = Math.min(1, coast[i] * 1.4) * 255;
    data[j + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  cache = tex;
  return tex;
}
