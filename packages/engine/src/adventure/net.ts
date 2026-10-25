/**
 * Multiplayer helpers: who may send an action, and game records that replay from setup + actions.
 * Games are deterministic (the RNG lives in the state), so peers only exchange actions.
 */
import { getUnitByUid, waitingFor } from "../combat/engine.ts";
import type { Side } from "../combat/types.ts";
import { actingPlayer, applyAdventureAction, sidePlayer } from "./engine.ts";
import { setupAdventure, type AdventureSetup } from "./scenario.ts";
import type { AdventureAction, AdventureState, PlayerId } from "./types.ts";

export const RECORD_VERSION = 1;

export interface GameRecord {
  v: number;
  setup: AdventureSetup;
  actions: AdventureAction[];
}

export function replay(record: GameRecord): AdventureState {
  if (record.v !== RECORD_VERSION) throw new Error(`unsupported save version ${record.v}`);
  return record.actions.reduce(applyAdventureAction, setupAdventure(record.setup));
}

/**
 * The player who controls a combat side. Without the Neutral AI, the enemy player sitting to the
 * fighting player's right controls the Neutral Units (p. 41): here, the next player in turn order.
 */
export function sideController(state: AdventureState, side: Side): PlayerId | null {
  if (state.phase.type !== "combat") return null;
  const ctx = state.phase.context;
  const owner = sidePlayer(state, ctx, side);
  if (owner || state.ai.neutrals) return owner;
  const fighter = sidePlayer(state, ctx, side === "attacker" ? "defender" : "attacker")!;
  const live = state.players.filter((p) => !p.eliminated || p.id === fighter);
  const i = live.findIndex((p) => p.id === fighter);
  return live.length > 1 ? live[(i + 1) % live.length]!.id : fighter;
}

/** Players who may act now: several during a Combat reaction window. */
export function playersToAct(state: AdventureState): PlayerId[] {
  const ph = state.phase;
  if (ph.type !== "combat") {
    const p = actingPlayer(state);
    return p ? [p] : [];
  }
  return [...new Set(waitingFor(ph.combat).map((s) => sideController(state, s)).filter((p): p is PlayerId => p !== null))];
}

/** Whether a peer seated as `seats` may send `action`. Legality itself is left to the engine. */
export function mayAct(state: AdventureState, action: AdventureAction, seats: readonly PlayerId[]): boolean {
  const ph = state.phase;
  switch (action.type) {
    case "play-card":
    case "discard-card":
    case "adjust":
    case "declare-victory":
      return seats.includes(action.player);
    case "surrender":
      return ph.type === "combat" && seats.includes(sideController(state, action.side)!);
    case "combat": {
      if (ph.type !== "combat") return false;
      const a = action.action;
      let side: Side | null = null;
      if ("side" in a) side = a.side;
      else if ("uid" in a) side = getUnitByUid(ph.combat, a.uid).side;
      if (side) return seats.includes(sideController(state, side)!);
      return playersToAct(state).some((p) => seats.includes(p));
    }
    default:
      return playersToAct(state).some((p) => seats.includes(p));
  }
}
