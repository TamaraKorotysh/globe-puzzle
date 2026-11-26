/**
 * Where scattered pieces wait: a "tray" of slots along the screen edges, in camera space.
 * Units: multiples of the half-height of the view at the tray depth (so the layout is
 * independent of zoom). Landscape → columns left and right; portrait → rows top and bottom.
 */
export interface TrayLayout {
  slots: [number, number][];
  /** Radius of one slot, same units. */
  r: number;
  bands: { x0: number; x1: number; y0: number; y1: number }[];
}

export function trayLayout(aspect: number, n: number): TrayLayout {
  const bands: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const top = 0.8; // leave room for the title bar and the counter
  const bottom = -0.94;
  if (aspect >= 1) {
    const w = 0.44 * aspect;
    bands.push({ x0: -aspect * 0.98, x1: -aspect * 0.98 + w, y0: bottom, y1: top });
    bands.push({ x0: aspect * 0.98 - w, x1: aspect * 0.98, y0: bottom, y1: top });
  } else {
    // Phones: the title bar and counter take the top ~15% of the screen.
    bands.push({ x0: -aspect * 0.97, x1: aspect * 0.97, y0: 0.19, y1: 0.63 });
    bands.push({ x0: -aspect * 0.97, x1: aspect * 0.97, y0: -0.97, y1: -0.53 });
  }
  const perBand = Math.ceil(n / bands.length);
  const b0 = bands[0];
  const bw = b0.x1 - b0.x0, bh = b0.y1 - b0.y0;
  let s = Math.sqrt((bw * bh) / perBand);
  let cols = 1, rows = 1;
  for (let i = 0; i < 200; i++) {
    cols = Math.max(1, Math.floor(bw / s));
    rows = Math.ceil(perBand / cols);
    if (rows * s <= bh) break;
    s *= 0.97;
  }
  const slots: [number, number][] = [];
  for (const b of bands) {
    const ox = b.x0 + (b.x1 - b.x0 - cols * s) / 2 + s / 2;
    const oy = b.y1 - (b.y1 - b.y0 - rows * s) / 2 - s / 2;
    for (let k = 0; k < perBand && slots.length < n; k++) {
      const row = Math.floor(k / cols), col = k % cols;
      slots.push([ox + col * s, oy - row * s]);
    }
  }
  return { slots, r: s * 0.47, bands };
}

const TAN = Math.tan((45 / 2) * (Math.PI / 180));

/** Camera distance from the globe centre so that Europe fits between the trays. */
export function puzzleCameraDistance(aspect: number) {
  // Europe (Iceland…Caspian, Crete…North Cape) is about 0.72 × 0.62 on the unit sphere.
  const needW = aspect >= 1 ? 0.72 / 0.56 : 0.72 / 0.94;
  const needH = aspect >= 1 ? 0.62 / 0.84 : 0.62 / 0.34;
  const h = Math.max(needW / (2 * TAN * aspect), needH / (2 * TAN));
  return 1 + h;
}

/** Tray sits this far in front of the camera, as a fraction of the camera's height above the surface. */
export const TRAY_DEPTH = 0.7;
export const HALF_FOV_TAN = TAN;

/** Latitude the puzzle camera aims at: on phones a bit north, so Europe sits between the trays. */
export const puzzleAimLat = (aspect: number) => (aspect >= 1 ? 50 : 54);
