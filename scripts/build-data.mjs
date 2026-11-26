// Builds public/data/borders.json and data/countries.json from Natural Earth 1:50m.
// Usage: node scripts/build-data.mjs   (temp: E:/Claude-temp/globe-puzzle)
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const ROOT = path.resolve(import.meta.dirname, '..');
const TMP = 'E:/Claude-temp/globe-puzzle';
const DL = `${TMP}/dl`;
const BASE = 'https://naciscdn.org/naturalearth/50m/cultural';
const run = (c) => execSync(c, { stdio: 'inherit', shell: true });
fs.mkdirSync(DL, { recursive: true });

function fetchShp(name) {
  const dir = `${DL}/${name}`;
  if (!fs.existsSync(`${dir}/${name}.shp`)) {
    const zip = `${DL}/${name}.zip`;
    if (!fs.existsSync(zip)) run(`curl -sL -o "${zip}" ${BASE}/${name}.zip`);
    run(`powershell -NoProfile -Command "Expand-Archive -Force '${zip}' '${dir}'"`);
  }
  return `${dir}/${name}.shp`;
}
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));

const cShp = fetchShp('ne_50m_admin_0_countries');
const pShp = fetchShp('ne_50m_populated_places');
const fullJson = `${TMP}/full.json`, placesJson = `${TMP}/places.json`;
if (!fs.existsSync(fullJson)) run(`npx -y mapshaper "${cShp}" -o format=geojson "${fullJson}"`);
if (!fs.existsSync(placesJson)) run(`npx -y mapshaper "${pShp}" -o format=geojson "${placesJson}"`);

const full = read(fullJson);
const ids = full.features.map((f) => f.properties.ADM0_A3);
const hasDup = new Set(ids).size !== ids.length;

// ---- disputed zones ----
const dShp = fetchShp('ne_50m_admin_0_breakaway_disputed_areas');
const ZONES = { B89: 'D-CRIMEA', B19: 'D-WSAHARA', B05: 'D-KASH-IN', B45: 'D-KASH-IN', B08: 'D-KASH-PK',
  B07: 'D-AKSAI', B00: 'D-ARUNACHAL', B16: 'D-GOLAN', B35: 'D-ABKHAZIA', B37: 'D-SOSSETIA', B36: 'D-TRANSNISTRIA' };
const zonesJson = `${TMP}/zones.json`;
fs.writeFileSync(`${TMP}/zones.js`, `module.exports = function (rec) { return ${JSON.stringify(ZONES)}[rec.BRK_A3] || null; };`);
run(`npx -y mapshaper "${dShp}" -require "${TMP}/zones.js" alias=zmap -each "id=zmap(this.properties)" -filter "!!id" ` +
  `-filter-fields id -dissolve id -o "${zonesJson}" format=geojson`);

// ---- borders ----
// countries minus zones, merged with zones into one layer and simplified together (shared arcs stay aligned)
fs.mkdirSync(`${ROOT}/public/data`, { recursive: true });
const out = `${ROOT}/public/data/borders.json`;
const merged = `${TMP}/merged.json`;
run(`npx -y mapshaper -i "${fullJson}" name=countries -filter-fields ADM0_A3 -rename-fields id=ADM0_A3 ` +
  `${hasDup ? '-dissolve id ' : ''}-i "${zonesJson}" name=zones ` +
  `-erase target=countries source=zones ` +
  `-merge-layers target=countries,zones name=all -clean ` +
  `-simplify 15% weighted keep-shapes -o "${merged}" format=geojson precision=0.01`);
const bj = read(merged);
const zoneIds = new Set(Object.values(ZONES));
// drop slivers left by erase: tiny polygons (< 60 km2) of countries bordering a zone (real islands elsewhere stay)
const EDGE = new Set(['MAR', 'SAH', 'KAS', 'ISR', 'SYR', 'IND', 'PAK', 'CHN', 'UKR', 'RUS', 'GEO', 'MDA', 'DZA', 'MRT', 'JOR', 'LBN']);
const ringKm2 = (r) => { let a = 0, lat = 0; for (let i = 0; i < r.length - 1; i++) { a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; lat += r[i][1]; }
  return Math.abs(a / 2) * 111.2 * 111.2 * Math.cos((lat / r.length) * Math.PI / 180); };
for (const f of bj.features) {
  if (!EDGE.has(f.properties.id) || f.geometry.type !== 'MultiPolygon') continue;
  f.geometry.coordinates = f.geometry.coordinates.filter((p) => ringKm2(p[0]) >= 60);
  if (f.geometry.coordinates.length === 1) f.geometry = { type: 'Polygon', coordinates: f.geometry.coordinates[0] };
}
const tiny = (f) => f.geometry.type === 'Polygon' && ['SAH', 'KAS'].includes(f.properties.id) && ringKm2(f.geometry.coordinates[0]) < 60;
bj.features = bj.features.filter((f) => f.geometry && f.geometry.coordinates.length && !tiny(f));
for (const f of bj.features) {
  const id = f.properties.id;
  f.properties = zoneIds.has(id) ? { id, disputed: true } : { id };
}
fs.writeFileSync(out, JSON.stringify(bj));
const borderIds = new Set(bj.features.map((f) => f.properties.id));

// ---- flags ----
const fiDir = `${TMP}/fi`;
if (!fs.existsSync(`${fiDir}/node_modules/flag-icons`)) run(`npm i flag-icons --prefix "${fiDir}"`);
const flagSet = new Set(fs.readdirSync(`${fiDir}/node_modules/flag-icons/flags/4x3`)
  .filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -4)));

// ---- capitals ----
const places = read(placesJson).features.map((f) => f.properties).filter(
  (p) => p.ADM0CAP === 1 || /Admin-0 (region )?capital/.test(p.FEATURECLA || ''));
const PREF = { ZAF: 'Pretoria', NLD: 'Amsterdam', BOL: 'Sucre' };
const score = (p, id) => (PREF[id] && p.NAME_EN === PREF[id] ? 10 : 0) +
  (p.FEATURECLA === 'Admin-0 capital' ? 2 : 0) - (/region/.test(p.FEATURECLA) ? 1 : 0) + (p.ADM0CAP === 1 ? 1 : 0);
const ALIAS = { SDS: 'SSD' }; // admin-0 code differs between the two datasets
const capFor = (id) => {
  const v = ALIAS[id] || id;
  const c = places.filter((p) => p.ADM0_A3 === v);
  return c.length ? c.sort((a, b) => score(b, v) - score(a, v))[0] : null;
};

const countries = {}, noCap = [], noFlag = [];
// Natural Earth's Russian names that we write differently.
const RU_NAME_FIX = { BLR: 'Беларусь' };
for (const f of full.features) {
  const p = f.properties, id = p.ADM0_A3;
  if (countries[id] || !borderIds.has(id)) continue;
  const two = (s) => (typeof s === 'string' && /^[A-Za-z]{2}$/.test(s) ? s.toUpperCase() : null);
  let iso2 = two(p.ISO_A2_EH) || two(p.ISO_A2);
  if (id === 'KOS') iso2 = 'XK';
  const flag = iso2 && flagSet.has(iso2.toLowerCase()) ? iso2.toLowerCase() : null;
  const cp = capFor(id);
  const capital = cp ? { en: cp.NAME_EN || cp.NAME, ru: cp.NAME_RU || cp.NAME_EN || cp.NAME } : null;
  const capitalLonLat = cp ? [+(+cp.LONGITUDE).toFixed(3), +(+cp.LATITUDE).toFixed(3)] : null;
  if (!cp) noCap.push(id);
  if (!flag) noFlag.push(id);
  countries[id] = { id, iso2, name: { en: p.NAME_EN || p.NAME, ru: RU_NAME_FIX[id] || p.NAME_RU || p.NAME_EN || p.NAME },
    capital, capitalLonLat, continent: p.CONTINENT, flag };
}
const keys = Object.keys(countries);
fs.mkdirSync(`${ROOT}/data`, { recursive: true });
fs.writeFileSync(`${ROOT}/data/countries.json`,
  '{\n' + keys.map((k) => JSON.stringify(k) + ':' + JSON.stringify(countries[k])).join(',\n') + '\n}\n');

const b = read(out);
console.log(JSON.stringify({ countries: keys.length, borderFeatures: b.features.length, dupIds: hasDup,
  bordersKB: Math.round(fs.statSync(out).size / 1024), noCap, noFlag }));
