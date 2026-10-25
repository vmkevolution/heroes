/**
 * Combat against AI (rule book p. 48): how Neutral Units and AI armies pick targets and move.
 * Ties the rules leave to "the player chooses" are broken by board order so games replay.
 */
import { getVariant, type Tier } from "@heroes/data";
import { distance, isAdjacent } from "./board.ts";
import { getUnitByUid, legalMoves, legalTargets, statsOf } from "./engine.ts";
import type { CombatAction, CombatState, CombatUnit, Pos } from "./types.ts";

/** Tier order for each attacking tier (p. 48; wiki "AI" table): same tier, then lower descending, then higher ascending. */
const TIER_ORDER: Record<Tier, Tier[]> = {
  bronze: ["bronze", "silver", "gold", "azure"],
  silver: ["silver", "bronze", "gold", "azure"],
  gold: ["gold", "silver", "bronze", "azure"],
  azure: ["azure", "gold", "silver", "bronze"],
};

/** Units without a tier (Creature Bank units, p. 66) are attacked last; the Arrow Tower counts as Silver (p. 48). */
export function tierOf(u: Pick<CombatUnit, "unitId" | "variant">): Tier | null {
  return getVariant(u.unitId, u.variant).tier ?? null;
}

/**
 * Lower is preferred. Ground and Flying units go by tier order only; Ranged units first go through
 * enemy Ranged units in tier order, then Ground and Flying ones (p. 48).
 */
export function targetRank(attacker: CombatUnit, target: CombatUnit): number {
  const order = TIER_ORDER[tierOf(attacker) ?? "silver"];
  const t = tierOf(target);
  const byTier = t ? order.indexOf(t) : order.length;
  if (statsOf(attacker).type !== "ranged") return byTier;
  return (statsOf(target).type === "ranged" ? 0 : order.length + 1) + byTier;
}

/** Best target among `candidates`: priority first, then the closest (p. 48). */
export function pickTarget(attacker: CombatUnit, candidates: CombatUnit[], from: Pos = attacker.pos): CombatUnit | undefined {
  return [...candidates].sort(
    (a, b) =>
      targetRank(attacker, a) - targetRank(attacker, b) ||
      distance(from, a.pos) - distance(from, b.pos) ||
      a.pos.row - b.pos.row ||
      a.pos.col - b.pos.col,
  )[0];
}

/**
 * The next action of an AI-controlled unit in its activation: attack the preferred valid target;
 * otherwise move so that it can attack the preferred reachable target, or towards the preferred one.
 * Enemy units never Defend unless told to (p. 48).
 */
export function aiUnitAction(state: CombatState, uid: string): CombatAction {
  const ph = state.phase;
  if (ph.type !== "activation" || ph.uid !== uid) throw new Error(`${uid} is not active`);
  const u = getUnitByUid(state, uid);
  const enemies = state.units.filter((e) => e.side !== u.side);
  const targets = legalTargets(state, uid).map((t) => getUnitByUid(state, t));
  const best = pickTarget(u, targets);
  if (best) return { type: "attack", uid, targetUid: best.uid };
  const moves = legalMoves(state, uid);
  if (ph.attacked || !moves.length || !enemies.length || statsOf(u).type === "ranged") return { type: "end-activation", uid };

  // Enemies this unit could attack after moving, with the closest space next to each.
  const reachable = enemies
    .map((e) => ({ e, cell: moves.filter((m) => isAdjacent(m, e.pos)).sort((a, b) => distance(u.pos, a) - distance(u.pos, b))[0] }))
    .filter((x): x is { e: CombatUnit; cell: Pos } => x.cell !== undefined);
  const goal = pickTarget(
    u,
    reachable.map((x) => x.e),
  );
  if (goal) return { type: "move", uid, to: reachable.find((x) => x.e === goal)!.cell };

  // Nothing in reach: close in on the preferred target.
  const far = pickTarget(u, enemies)!;
  const step = [...moves].sort((a, b) => distance(a, far.pos) - distance(b, far.pos) || a.row - b.row || a.col - b.col)[0]!;
  if (distance(step, far.pos) >= distance(u.pos, far.pos)) return { type: "end-activation", uid };
  return { type: "move", uid, to: step };
}
