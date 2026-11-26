export interface GlobeStyle {
  id: string;
  name: { ru: string; en: string };
  /** Country colours; neighbours always get different ones. */
  palette: string[];
  oceanDeep: string;
  oceanShallow: string;
  /** Colour of the soft shadow along the coast. */
  coastShadow: string;
  border: string;
  borderOpacity: number;
  /** Height of the country slabs above the ocean (globe radius = 1). */
  height: number;
  /** Strength of the sun glint on water. */
  glint: number;
  /** Roughness of the ocean-floor relief seen through the water. */
  relief: number;
  background: string;
  /** Satellite-image countries with crystal walls, crystal base, nebula and clouds. */
  realistic?: boolean;
  /** Antique globe: aged paper, ink graticule, card pieces on a plaster base. */
  antique?: boolean;
}

export const STYLES: Record<string, GlobeStyle> = {
  space: {
    id: 'space',
    name: { ru: 'Космос', en: 'Space' },
    // Only a light tint over the satellite image, so neighbours stay distinguishable.
    palette: ['#ffd27a', '#9be37a', '#ff9a7a', '#b79bff', '#7ad7ff', '#ff9fd0'],
    oceanDeep: '#03132e',
    oceanShallow: '#1d6fb0',
    coastShadow: '#020b1c',
    border: '#dff3ff',
    borderOpacity: 0.4,
    height: 0.02,
    glint: 0.45,
    relief: 0.35,
    background: '#010208',
    realistic: true,
  },
  antique: {
    id: 'antique',
    name: { ru: 'Старинный глобус', en: 'Antique globe' },
    // Ochres, siennas and umbers, like a hand-coloured 17th-century globe.
    palette: ['#c8963e', '#a8642f', '#d6b062', '#8f8240', '#b9784a', '#a39058'],
    oceanDeep: '#e9dcb8',
    oceanShallow: '#f3e9cc',
    coastShadow: '#7a5232',
    border: '#4a2c16',
    borderOpacity: 0.75,
    height: 0.014,
    glint: 0.25,
    relief: 0,
    background: '#140d08',
    antique: true,
  },
  atlas: {
    id: 'atlas',
    name: { ru: 'Атлас', en: 'Atlas' },
    palette: ['#f2d9a0', '#cfe0a8', '#f4bfa1', '#c9c3e6', '#a9d6cf', '#f1c6d6'],
    oceanDeep: '#0b2e5a',
    oceanShallow: '#3d8fc4',
    coastShadow: '#06213f',
    border: '#5b4a3a',
    borderOpacity: 0.5,
    height: 0.008,
    glint: 0.9,
    relief: 0.55,
    background: '#05070f',
  },
  toy: {
    id: 'toy',
    name: { ru: 'Игрушка', en: 'Toy' },
    palette: ['#ffcf33', '#7bd65b', '#ff7a59', '#9b7bff', '#3fc6e8', '#ff8ec7'],
    oceanDeep: '#0a4f9e',
    oceanShallow: '#2ec4e6',
    coastShadow: '#05306b',
    border: '#1f1f2e',
    borderOpacity: 0.75,
    height: 0.016,
    glint: 1.2,
    relief: 0.4,
    background: '#0a1430',
  },
  vintage: {
    id: 'vintage',
    name: { ru: 'Старинная карта', en: 'Vintage' },
    palette: ['#d9b26f', '#a8b07a', '#c98a64', '#b9a58a', '#8fa59a', '#d4a59a'],
    oceanDeep: '#2e4a52',
    oceanShallow: '#7fa5a0',
    coastShadow: '#1d3036',
    border: '#4a3424',
    borderOpacity: 0.65,
    height: 0.006,
    glint: 0.45,
    relief: 0.75,
    background: '#120e0a',
  },
};

export const DEFAULT_STYLE = 'antique';

export function styleFromUrl(): GlobeStyle {
  const id = new URLSearchParams(location.search).get('style');
  return STYLES[id ?? ''] ?? STYLES[DEFAULT_STYLE];
}
