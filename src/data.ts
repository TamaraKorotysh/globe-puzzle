import countriesJson from '../data/countries.json';
import disputedJson from '../data/disputed.json';
import type { Lang } from './i18n';

export interface Country {
  id: string;
  iso2: string | null;
  name: Record<Lang, string>;
  capital: Record<Lang, string> | null;
  capitalLonLat: [number, number] | null;
  continent: string;
  flag: string | null;
}

export type Facts = Record<string, Record<Lang, string[]>>;

/** Disputed zone (id "D-…") or a note for a country with limited recognition (e.g. "TWN"). */
export interface DisputedInfo {
  id: string;
  name?: Record<Lang, string>;
  claimants: Record<Lang, string>;
  control: Record<Lang, string>;
}

export const countries = countriesJson as unknown as Record<string, Country>;
export const disputed = disputedJson as unknown as Record<string, DisputedInfo>;
export const isDisputedZone = (id: string) => id.startsWith('D-');

const factFiles = import.meta.glob<{ default: Facts }>('../data/facts/*.json');

let factsPromise: Promise<Facts> | null = null;

/** Loads all fact files once (they are code-split, not in the main bundle). */
export function loadFacts(): Promise<Facts> {
  if (!factsPromise) {
    factsPromise = Promise.all(Object.values(factFiles).map((load) => load())).then((mods) =>
      Object.assign({}, ...mods.map((m) => m.default)),
    );
  }
  return factsPromise;
}
