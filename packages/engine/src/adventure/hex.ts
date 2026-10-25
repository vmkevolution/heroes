/**
 * Hex geometry for the Game Map. Fields are pointy-top hexes in axial coordinates;
 * a Map Tile is a flower of 7 Fields around its center (rule book p. 31).
 */
export interface Hex {
  q: number;
  r: number;
}

export const hexKey = (h: Hex) => `${h.q},${h.r}`;
export const sameHex = (a: Hex, b: Hex) => a.q === b.q && a.r === b.r;
export const addHex = (a: Hex, b: Hex): Hex => ({ q: a.q + b.q, r: a.r + b.r });
export const subHex = (a: Hex, b: Hex): Hex => ({ q: a.q - b.q, r: a.r - b.r });

export function hexDistance(a: Hex, b: Hex): number {
  const d = subHex(a, b);
  return (Math.abs(d.q) + Math.abs(d.r) + Math.abs(d.q + d.r)) / 2;
}

/** Clockwise from the right-hand neighbor (screen y grows downward). */
export const DIRECTIONS: readonly Hex[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

export const hexNeighbors = (h: Hex): Hex[] => DIRECTIONS.map((d) => addHex(h, d));
export const areAdjacent = (a: Hex, b: Hex) => hexDistance(a, b) === 1;

/** Rotates a hex around the origin by `steps` × 60° clockwise. */
export function rotateHex(h: Hex, steps: number): Hex {
  let { q, r } = h;
  for (let i = 0; i < ((steps % 6) + 6) % 6; i++) [q, r] = [-r, q + r];
  return { q: q + 0, r: r + 0 }; // avoid -0 in keys
}

/**
 * Offsets of a tile's 7 Fields from its center, in the printed reading order used by
 * the tile data: top-left, top-right, left, center, right, bottom-left, bottom-right.
 */
export const FIELD_OFFSETS: readonly Hex[] = [
  { q: 0, r: -1 },
  { q: 1, r: -1 },
  { q: -1, r: 0 },
  { q: 0, r: 0 },
  { q: 1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

/** Board position of a tile's field once the tile is turned `rotation` × 60° clockwise. */
export function fieldHex(center: Hex, rotation: number, index: number): Hex {
  return addHex(center, rotateHex(FIELD_OFFSETS[index]!, rotation));
}

/**
 * Tile centers that fit snugly against a tile at the origin: the flower shapes interlock
 * along three Field edges. Both interlocking patterns are allowed, as in the Mission Book layouts.
 */
export const SNUG_OFFSETS: readonly Hex[] = [
  { q: 2, r: 1 },
  { q: -1, r: 3 },
  { q: -3, r: 2 },
  { q: -2, r: -1 },
  { q: 1, r: -3 },
  { q: 3, r: -2 },
  { q: 3, r: -1 },
  { q: 1, r: 2 },
  { q: -2, r: 3 },
  { q: -3, r: 1 },
  { q: -1, r: -2 },
  { q: 2, r: -3 },
];

/**
 * Converts the map editor's offset grid (zedero.github.io/homm3boardgame, used for the
 * Mission Book layouts) to axial coordinates: rows 0, 2, 4… are shifted half a hex left.
 */
export function editorCellToHex(row: number, col: number): Hex {
  return { q: col - Math.floor(row / 2), r: row };
}
