/**
 * Unit special abilities that change combat resolution. The card texts live in
 * @heroes/data; this file maps the ones the engine already understands to code.
 * Each hook is keyed by unit id and card side.
 */
import type { CombatUnit } from "./types.ts";

/** "This unit can perform an unlimited number of Retaliation Attacks." */
const UNLIMITED_RETALIATION = new Set(["griffins"]);

export function hasUnlimitedRetaliation(u: CombatUnit): boolean {
  return UNLIMITED_RETALIATION.has(u.unitId);
}

/**
 * Zombies: +1 Defense when the attacker's die shows +1 (Few), or 0 or +1 (Pack, Neutral).
 * The Crypt (creature bank) version behaves like the Few side.
 */
export function defenseBonusFromAttackRoll(target: CombatUnit, roll: number): number {
  if (target.unitId !== "zombies") return 0;
  const lenient = target.variant === "pack" || target.variant === "neutral";
  return roll === 1 || (lenient && roll === 0) ? 1 : 0;
}
