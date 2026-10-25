/**
 * A simple bot that always finds a legal action: it keeps games moving in tests and is the fallback
 * for the solo AI. It never touches the RNG outside the engine, so bot games replay from their record.
 */
import { getVariant } from "@heroes/data";
import { legalMoves as combatMoves, legalTargets, waitingFor } from "../combat/engine.ts";
import type { CombatAction } from "../combat/types.ts";
import { handLimit, playerLevel } from "./cardplay.ts";
import { applyAdventureAction, currentPlayer, discoverableTiles, getPlayer, IllegalAction, legalMoves, sidePlayer } from "./engine.ts";
import { hexKey } from "./hex.ts";
import type { AdventureAction, AdventureState } from "./types.ts";

/** Small deterministic hash so the bot varies its moves without its own RNG. */
function pick<T>(items: T[], salt: number): T | undefined {
  if (!items.length) return undefined;
  const h = Math.imul(salt ^ 0x9e3779b9, 2654435761) >>> 0;
  return items[h % items.length];
}

function isLegal(state: AdventureState, action: AdventureAction): boolean {
  try {
    applyAdventureAction(state, action);
    return true;
  } catch (e) {
    if (e instanceof IllegalAction) return false;
    throw e;
  }
}

export function combatBotAction(state: AdventureState): CombatAction | null {
  if (state.phase.type !== "combat") return null;
  const c = state.phase.combat;
  const ph = c.phase;
  if (ph.type === "reaction") return { type: "pass", side: waitingFor(c)[0]! };
  if (ph.type === "round-end") return { type: "continue" };
  if (ph.type !== "activation") return null;
  const unit = c.units.find((u) => u.uid === ph.uid)!;
  const target = legalTargets(c, ph.uid)[0];
  if (target) return { type: "attack", uid: ph.uid, targetUid: target };
  const forward = unit.side === "attacker" ? 1 : -1;
  const step = combatMoves(c, ph.uid).sort((a, b) => forward * (b.row - a.row))[0];
  if (step && !ph.moved) return { type: "move", uid: ph.uid, to: step };
  return { type: "end-activation", uid: ph.uid };
}

/** Candidate actions for whatever the game waits for, most wanted first. */
function candidates(state: AdventureState): AdventureAction[] {
  const ph = state.phase;
  const salt = state.log.length + state.round * 31;
  switch (ph.type) {
    case "refresh": {
      const p = getPlayer(state, ph.player);
      const extra = Math.max(0, p.hand.length - handLimit(playerLevel(state, p.id)));
      return [{ type: "refresh", discard: Array.from({ length: extra }, (_, i) => i) }];
    }
    case "search":
      return [ph.revealed ? { type: "search-pick", index: 0 } : { type: "search", mode: "look" }];
    case "choice": {
      const c = ph.choice;
      if (c.kind === "discover") {
        return discoverableTiles(state, c.heroId).map((t) => ({ type: "discover", heroId: c.heroId, center: t.center, rotation: 0 }));
      }
      if (c.kind === "settlement") return [{ type: "settlement", resource: "gold" }];
      const n = c.kind === "options" ? c.options.length : c.kind === "resource-die" || c.kind === "treasure-die" ? c.faces.length : 3;
      return Array.from({ length: n }, (_, i) => ({ type: "choose", option: i }));
    }
    case "siege-decision":
      return [{ type: "siege", defend: false }];
    case "combat-setup": {
      const owner = sidePlayer(state, ph.context, ph.side)!;
      const army = getPlayer(state, owner).army;
      const picks = army.slice(0, 5).map((u, i) => ({
        armyIndex: i,
        line: getVariant(u.unitId, u.variant).type === "ranged" ? ("back" as const) : ("front" as const),
      }));
      return [{ type: "combat-setup", picks }];
    }
    case "combat": {
      const a = combatBotAction(state);
      return a ? [{ type: "combat", action: a }, { type: "combat", action: { type: "retreat" } }] : [];
    }
    case "turn": {
      const me = currentPlayer(state);
      const out: AdventureAction[] = [];
      for (const hero of state.heroes.filter((h) => h.owner === me.id)) {
        const moves = legalMoves(state, hero.id);
        const move = pick(moves, salt + hexKey(hero.pos).length);
        if (move) out.push({ type: "move", heroId: hero.id, to: move });
        const tile = pick(discoverableTiles(state, hero.id), salt);
        if (tile) out.push({ type: "discover", heroId: hero.id, center: tile.center, rotation: 0 });
      }
      out.push({ type: "end-turn" });
      return out;
    }
    case "over":
      return [];
  }
}

/** The first legal candidate, or null when the game is over. */
export function botAction(state: AdventureState): AdventureAction | null {
  return candidates(state).find((a) => isLegal(state, a)) ?? null;
}
