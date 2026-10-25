import { getUnit, getVariant } from "@heroes/data";
import { cardInfo } from "@heroes/engine";

/** Card pictures are copied to `public/cards/` under their wiki file name. */
export function cardImage(unitId: string, variant: string): string | null {
  const image = getVariant(unitId, variant).image;
  return image ? `${import.meta.env.BASE_URL}cards/${image}` : null;
}

export function unitName(unitId: string): string {
  return getUnit(unitId).name;
}

/** Picture of a Might & Magic card reference (`spell:fireball`), or of any wiki image name. */
export function cardArt(ref: string): string | null {
  const image = cardInfo(ref).image;
  return image ? `${import.meta.env.BASE_URL}cards/${image}` : null;
}

export function assetImage(image: string | null): string | null {
  return image ? `${import.meta.env.BASE_URL}cards/${image}` : null;
}
