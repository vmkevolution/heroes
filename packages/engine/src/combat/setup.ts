import { getVariant, TIERS } from "@heroes/data";
import { COLS, type Placement, type Side } from "./types.ts";
import { homeRows } from "./board.ts";

export interface UnitPick {
  unitId: string;
  variant: string;
}

/**
 * Automatic placement of Neutral Units in Campaign and Cooperative Combat (rule book p. 41):
 * Ranged units in the Backline, others in the Frontline, left to right from the player's view,
 * in descending Initiative (ties: higher tier first). A full line spills into the other one.
 */
export function placeNeutrals(side: Side, picks: UnitPick[]): Placement[] {
  const tierRank = (t: string | null) => (t ? TIERS.indexOf(t as (typeof TIERS)[number]) : -1);
  const sorted = picks
    .map((p) => ({ p, v: getVariant(p.unitId, p.variant) }))
    .sort((a, b) => b.v.initiative - a.v.initiative || tierRank(b.v.tier) - tierRank(a.v.tier));
  const [back, front] = homeRows[side];
  // "Left to right from the player's perspective": the player faces the neutral side,
  // so for a defending neutral army the player's left is column 0.
  const used: Record<number, number> = { [back]: 0, [front]: 0 };
  const out: Placement[] = [];
  for (const { p, v } of sorted) {
    let row = v.type === "ranged" ? back : front;
    if (used[row]! >= COLS) row = row === back ? front : back;
    if (used[row]! >= COLS) throw new Error("too many neutral units to place");
    out.push({ unitId: p.unitId, variant: p.variant, pos: { col: used[row]!, row } });
    used[row]! += 1;
  }
  return out;
}

/** Fills a side's lines left to right, honouring each unit's preferred line when there is room. */
export function placeInLines(side: Side, picks: (UnitPick & { line: "back" | "front" })[]): Placement[] {
  const [back, front] = homeRows[side];
  const used: Record<number, number> = { [back]: 0, [front]: 0 };
  return picks.map((p) => {
    let row = p.line === "back" ? back : front;
    if (used[row]! >= COLS) row = row === back ? front : back;
    if (used[row]! >= COLS) throw new Error("too many units to place");
    const pos = { col: used[row]!, row };
    used[row]! += 1;
    return { unitId: p.unitId, variant: p.variant, pos };
  });
}
