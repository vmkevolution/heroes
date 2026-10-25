import { getUnit, getVariant } from "@heroes/data";

/** Card pictures are copied to `public/cards/` under their wiki file name. */
export function cardImage(unitId: string, variant: string): string | null {
  const image = getVariant(unitId, variant).image;
  return image ? `${import.meta.env.BASE_URL}cards/${image}` : null;
}

export function unitName(unitId: string): string {
  return getUnit(unitId).name;
}
