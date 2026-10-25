import type { AstrologersCard, MapTile, UnitCard, UnitVariant } from "./schema.ts";
import unitsJson from "./generated/units.json" with { type: "json" };
import tilesJson from "./generated/tiles.json" with { type: "json" };
import astrologersJson from "./generated/astrologers.json" with { type: "json" };

export * from "./schema.ts";

export const units: readonly UnitCard[] = unitsJson as UnitCard[];
export const tiles: readonly MapTile[] = tilesJson as MapTile[];
export const astrologers: readonly AstrologersCard[] = astrologersJson as AstrologersCard[];

const byId = new Map(units.map((u) => [u.id, u]));
const tilesById = new Map(tiles.map((t) => [t.id, t]));

export function getUnit(id: string): UnitCard {
  const u = byId.get(id);
  if (!u) throw new Error(`unknown unit "${id}"`);
  return u;
}

export function getVariant(id: string, key: string): UnitVariant {
  const v = getUnit(id).variants.find((x) => x.key === key);
  if (!v) throw new Error(`unit "${id}" has no "${key}" variant`);
  return v;
}

export function getTile(id: string): MapTile {
  const t = tilesById.get(id);
  if (!t) throw new Error(`unknown map tile "${id}"`);
  return t;
}

export function getAstrologers(id: string): AstrologersCard {
  const c = astrologers.find((a) => a.id === id);
  if (!c) throw new Error(`unknown Astrologers Proclaim card "${id}"`);
  return c;
}
