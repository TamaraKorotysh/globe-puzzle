// Checks data/seas.json and data/currents.json against land (public/data/borders.json):
// sea label points must be in water, currents should run over water. Prints only problems.
import fs from 'node:fs';
const fc = JSON.parse(fs.readFileSync('public/data/borders.json', 'utf8'));
const polys = fc.features.flatMap((f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates));
const inRing = (x, y, r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const onLand = ([x, y]) => polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)));
const toV = ([lo, la]) => { const a = (la * Math.PI) / 180, o = (lo * Math.PI) / 180; return [Math.cos(a) * Math.sin(o), Math.sin(a), Math.cos(a) * Math.cos(o)]; };
const toLL = ([x, y, z]) => { const l = Math.hypot(x, y, z); return [(Math.atan2(x, z) * 180) / Math.PI, (Math.asin(y / l) * 180) / Math.PI]; };
const seas = JSON.parse(fs.readFileSync('data/seas.json', 'utf8'));
const bad = seas.filter((s) => onLand(s.lonLat)).map((s) => s.id);
console.log(`seas: ${seas.length}, on land: ${bad.join(', ') || 'none'}`);
const currents = JSON.parse(fs.readFileSync('data/currents.json', 'utf8'));
for (const c of currents) {
  let land = 0, n = 0; const where = [];
  for (let i = 0; i < c.path.length - 1; i++) {
    const a = toV(c.path[i]), b = toV(c.path[i + 1]);
    for (let k = 0; k < 20; k++) {
      const t = k / 20, p = toLL(a.map((v, j) => v * (1 - t) + b[j] * t));
      n++; if (onLand(p)) { land++; where.push(`${p[0].toFixed(1)},${p[1].toFixed(1)}`); }
    }
  }
  if (land) console.log(`${c.id}: ${land}/${n} samples on land, e.g. ${where.slice(0, 4).join(' | ')}`);
}
console.log(`currents: ${currents.length} checked`);
