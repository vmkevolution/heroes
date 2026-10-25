import type { UnitCard, UnitVariant } from "./schema.ts";
import unitsJson from "./generated/units.json" with { type: "json" };

export * from "./schema.ts";

export const units: readonly UnitCard[] = unitsJson as UnitCard[];

const byId = new Map(units.map((u) => [u.id, u]));

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
