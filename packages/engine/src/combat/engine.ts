/**
 * Combat on the 4×5 Combat Board (rule book p. 40–45).
 *
 * The engine is pure: `applyCombatAction(state, action)` returns a new state and never
 * mutates its input. Whenever the rules wait for a player, `state.phase` says who and why.
 */
import { getVariant } from "@heroes/data";
import { rollAttackDie, type RngState } from "../rng.ts";
import { defenseBonusFromAttackRoll, hasUnlimitedRetaliation } from "./abilities.ts";
import {
  backlineRow,
  flyingReach,
  groundReach,
  homeRows,
  inBounds,
  isAdjacent,
  isBlocked,
  samePos,
} from "./board.ts";
import {
  other,
  type ActivationResume,
  type CombatAction,
  type CombatEvent,
  type CombatSetup,
  type CombatState,
  type CombatUnit,
  type PendingAttack,
  type Pos,
  type Side,
  type UnitStats,
} from "./types.ts";

export class IllegalAction extends Error {}

const MAX_UNITS = 5;
/** Ground and Flying units move up to 3 spaces, Ranged units 1 (p. 38). */
const MOVE_RANGE = { ground: 3, flying: 3, ranged: 1 } as const;

export function statsOf(u: Pick<CombatUnit, "unitId" | "variant">): UnitStats {
  const v = getVariant(u.unitId, u.variant);
  return { type: v.type, attack: v.attack, defense: v.defense, hp: v.hp, initiative: v.initiative };
}

export function getUnitByUid(state: CombatState, uid: string): CombatUnit {
  const u = state.units.find((x) => x.uid === uid);
  if (!u) throw new IllegalAction(`no unit "${uid}" on the board`);
  return u;
}

export function createCombat(setup: CombatSetup): CombatState {
  const state: CombatState = {
    options: { neutralSide: null, reactions: true, ...setup.options },
    round: 0,
    units: [],
    obstacles: setup.obstacles ?? [],
    rng: setup.rng,
    phase: { type: "round-end" },
    tie: null,
    log: [],
  };
  for (const side of ["attacker", "defender"] as const) {
    const placements = setup[side];
    if (placements.length > MAX_UNITS) throw new IllegalAction(`${side} places more than ${MAX_UNITS} units`);
    placements.forEach((p, i) => {
      if (!inBounds(p.pos) || !homeRows[side].includes(p.pos.row)) {
        throw new IllegalAction(`${side} unit ${p.unitId} must start on its own Backline or Frontline`);
      }
      if (isBlocked(state, p.pos)) throw new IllegalAction(`space ${p.pos.col},${p.pos.row} is taken`);
      getVariant(p.unitId, p.variant); // validates the card exists
      state.units.push({
        uid: `${side[0]}${i + 1}-${p.unitId}`,
        unitId: p.unitId,
        variant: p.variant,
        side,
        pos: { ...p.pos },
        damage: 0,
        activated: false,
        retaliated: false,
        defending: false,
        paralyzed: false,
      });
    });
  }
  if (!checkOver(state)) startRound(state);
  return state;
}

// ---------------------------------------------------------------------------
// Queries used by the UI and by AI

export function activeUnit(state: CombatState): CombatUnit | null {
  return state.phase.type === "activation" ? getUnitByUid(state, state.phase.uid) : null;
}

/** Spaces the active unit may move to right now. */
export function legalMoves(state: CombatState, uid: string): Pos[] {
  const ph = state.phase;
  if (ph.type !== "activation" || ph.uid !== uid || ph.moved) return [];
  const u = getUnitByUid(state, uid);
  const { type } = statsOf(u);
  if (type !== "ranged" && ph.attacked) return [];
  const range = MOVE_RANGE[type];
  return type === "flying" ? flyingReach(state, u.pos, range) : groundReach(state, u.pos, range);
}

/** Enemy units the active unit may attack right now. */
export function legalTargets(state: CombatState, uid: string): string[] {
  const ph = state.phase;
  if (ph.type !== "activation" || ph.uid !== uid || ph.attacked) return [];
  const u = getUnitByUid(state, uid);
  const { type } = statsOf(u);
  const enemies = state.units.filter((e) => e.side !== u.side);
  if (type === "ranged") {
    if (ph.moved) return [];
    const adjacent = enemies.filter((e) => isAdjacent(e.pos, u.pos));
    return (adjacent.length ? adjacent : enemies).map((e) => e.uid);
  }
  return enemies.filter((e) => isAdjacent(e.pos, u.pos)).map((e) => e.uid);
}

export function canDefend(state: CombatState, uid: string): boolean {
  const ph = state.phase;
  if (ph.type !== "activation" || ph.uid !== uid || ph.attacked) return false;
  return getUnitByUid(state, uid).side !== state.options.neutralSide;
}

/** Ranged penalty (p. 38): adjacent target, or own Backline into the enemy Backline. */
export function hasRangedPenalty(state: CombatState, attacker: CombatUnit, target: CombatUnit): boolean {
  if (statsOf(attacker).type !== "ranged") return false;
  if (isAdjacent(attacker.pos, target.pos)) return true;
  return attacker.pos.row === backlineRow(attacker.side) && target.pos.row === backlineRow(target.side);
}

/** Which side must answer next (for hotseat screens and network turn handling). */
export function waitingFor(state: CombatState): Side[] {
  const ph = state.phase;
  switch (ph.type) {
    case "activation":
      return [getUnitByUid(state, ph.uid).side];
    case "reaction":
      return (["attacker", "defender"] as const).filter((s) => !ph.passed[s]);
    case "round-end":
      return [state.options.neutralSide ? other(state.options.neutralSide) : "attacker"];
    case "over":
      return [];
  }
}

// ---------------------------------------------------------------------------
// Actions

export function applyCombatAction(prev: CombatState, action: CombatAction): CombatState {
  const state = structuredClone(prev);
  const ph = state.phase;
  switch (action.type) {
    case "move": {
      if (!legalMoves(state, action.uid).some((p) => samePos(p, action.to))) {
        throw new IllegalAction(`${action.uid} cannot move to ${action.to.col},${action.to.row}`);
      }
      const u = getUnitByUid(state, action.uid);
      log(state, { type: "move", uid: u.uid, from: u.pos, to: action.to });
      u.pos = { ...action.to };
      const act = ph as Extract<typeof ph, { type: "activation" }>;
      act.moved = true;
      // A ranged unit that already attacked has used its whole activation.
      if (act.attacked) endActivation(state, u.uid);
      return state;
    }
    case "attack": {
      if (!legalTargets(state, action.uid).includes(action.targetUid)) {
        throw new IllegalAction(`${action.uid} cannot attack ${action.targetUid}`);
      }
      const u = getUnitByUid(state, action.uid);
      const act = ph as Extract<typeof ph, { type: "activation" }>;
      const ranged = statsOf(u).type === "ranged";
      startAttack(state, u.uid, action.targetUid, false, {
        uid: u.uid,
        moved: act.moved,
        afterAttack: ranged && !act.moved ? "may-move" : "end",
      });
      return state;
    }
    case "defend": {
      if (!canDefend(state, action.uid)) throw new IllegalAction(`${action.uid} cannot defend now`);
      const u = getUnitByUid(state, action.uid);
      u.defending = true;
      log(state, { type: "defend", uid: u.uid });
      endActivation(state, u.uid);
      return state;
    }
    case "end-activation": {
      if (ph.type !== "activation" || ph.uid !== action.uid) throw new IllegalAction(`${action.uid} is not active`);
      const u = getUnitByUid(state, action.uid);
      if (u.side === state.options.neutralSide && !ph.attacked && legalTargets(state, u.uid).length > 0) {
        throw new IllegalAction("Neutral Units must attack if they can (p. 43)");
      }
      endActivation(state, u.uid);
      return state;
    }
    case "modify": {
      if (ph.type !== "reaction" || ph.passed[action.side]) throw new IllegalAction(`${action.side} cannot play a card now`);
      const attackerSide = getUnitByUid(state, ph.attack.attackerUid).side;
      // Each player boosts their own unit: Attack for the attacking unit, Defense for the target.
      const expected = action.side === attackerSide ? "attack" : "defense";
      if (action.stat !== expected) throw new IllegalAction(`${action.side} can only modify ${expected} on this attack`);
      if (action.stat === "attack") ph.attack.attackBonus += action.amount;
      else ph.attack.defenseBonus += action.amount;
      log(state, { type: "modify", side: action.side, stat: action.stat, amount: action.amount, source: action.source });
      return state;
    }
    case "pass": {
      if (ph.type !== "reaction" || ph.passed[action.side]) throw new IllegalAction(`${action.side} has nothing to pass`);
      ph.passed[action.side] = true;
      if (ph.passed.attacker && ph.passed.defender) resolveAttack(state, ph.attack, ph.then);
      return state;
    }
    case "continue": {
      if (ph.type !== "round-end" || state.options.neutralSide === null) throw new IllegalAction("nothing to continue");
      startRound(state);
      return state;
    }
    case "retreat": {
      if (ph.type !== "round-end" || state.options.neutralSide === null) throw new IllegalAction("cannot retreat now");
      log(state, { type: "retreat" });
      state.phase = { type: "over", winner: null, reason: "retreat" };
      log(state, { type: "over", winner: null });
      return state;
    }
  }
}

/**
 * Deals damage that ignores Defense (Spells and other non-attack effects, p. 37).
 * Pure: returns a new state.
 */
export function dealEffectDamage(prev: CombatState, uid: string, amount: number): CombatState {
  const state = structuredClone(prev);
  applyDamage(state, getUnitByUid(state, uid), amount);
  checkOver(state);
  return state;
}

// ---------------------------------------------------------------------------
// Internals (mutate the cloned draft)

function log(state: CombatState, e: CombatEvent) {
  state.log.push(structuredClone(e));
}

function roll(state: CombatState): number {
  const [value, rng] = rollAttackDie(state.rng);
  state.rng = rng as RngState;
  return value;
}

function startRound(state: CombatState) {
  state.round += 1;
  state.tie = null;
  for (const u of state.units) {
    u.activated = false;
    u.retaliated = false;
  }
  log(state, { type: "round-start", round: state.round });
  advance(state);
}

/** Picks the next unit in Initiative order (p. 43) or ends the Combat Round. */
function advance(state: CombatState) {
  if (state.phase.type === "over") return;
  const waiting = state.units.filter((u) => !u.activated);
  if (waiting.length === 0) {
    if (state.options.neutralSide !== null) state.phase = { type: "round-end" };
    else startRound(state);
    return;
  }
  const init = (u: CombatUnit) => statsOf(u).initiative;
  const top = Math.max(...waiting.map(init));
  const group = waiting.filter((u) => init(u) === top);
  if (!state.tie || state.tie.initiative !== top) state.tie = { initiative: top, next: "attacker" };
  const side = group.some((u) => u.side === state.tie!.next) ? state.tie.next : other(state.tie.next);
  state.tie.next = other(side);
  const unit = group.find((u) => u.side === side)!;

  unit.activated = true;
  unit.defending = false; // a Defense Token is discarded at the start of the unit's activation
  log(state, { type: "activate", uid: unit.uid });
  if (unit.paralyzed) {
    unit.paralyzed = false;
    log(state, { type: "skip-paralyzed", uid: unit.uid });
    advance(state);
    return;
  }
  state.phase = { type: "activation", uid: unit.uid, moved: false, attacked: false };
}

function endActivation(state: CombatState, uid: string) {
  log(state, { type: "end-activation", uid });
  if (!checkOver(state)) advance(state);
}

function startAttack(state: CombatState, attackerUid: string, targetUid: string, retaliation: boolean, then: ActivationResume) {
  const attacker = getUnitByUid(state, attackerUid);
  const target = getUnitByUid(state, targetUid);
  const attack: PendingAttack = {
    attackerUid,
    targetUid,
    retaliation,
    penalty: hasRangedPenalty(state, attacker, target),
    attackBonus: 0,
    defenseBonus: 0,
  };
  if (!state.options.reactions) {
    resolveAttack(state, attack, then);
    return;
  }
  // Neutral units have no Hero, so no one plays cards for them.
  const neutral = state.options.neutralSide;
  state.phase = {
    type: "reaction",
    attack,
    passed: { attacker: neutral === "attacker", defender: neutral === "defender" },
    then,
  };
}

function resolveAttack(state: CombatState, pending: PendingAttack, then: ActivationResume) {
  const attacker = getUnitByUid(state, pending.attackerUid);
  const target = getUnitByUid(state, pending.targetUid);
  const a = statsOf(attacker);
  const d = statsOf(target);

  const rolls = pending.penalty ? [roll(state), roll(state)] : [roll(state)];
  const dieResult = Math.min(...rolls);
  const defenseRoll = target.defending ? roll(state) : null;
  const attackValue = a.attack + dieResult + pending.attackBonus;
  const defenseValue =
    d.defense + pending.defenseBonus + (defenseRoll === 1 ? 1 : 0) + defenseBonusFromAttackRoll(target, dieResult);
  const damage = Math.max(0, attackValue - defenseValue);
  log(state, {
    type: "attack",
    attackerUid: attacker.uid,
    targetUid: target.uid,
    retaliation: pending.retaliation,
    rolls,
    roll: dieResult,
    defenseRoll,
    attack: attackValue,
    defense: defenseValue,
    damage,
  });
  target.paralyzed = false; // attacked units lose Paralysis even at 0 damage
  const survived = applyDamage(state, target, damage);
  if (checkOver(state)) return;

  const canRetaliate =
    !pending.retaliation &&
    survived &&
    isAdjacent(attacker.pos, target.pos) &&
    (!target.retaliated || hasUnlimitedRetaliation(target));
  if (canRetaliate) {
    if (!hasUnlimitedRetaliation(target)) target.retaliated = true;
    startAttack(state, target.uid, attacker.uid, true, then);
    return;
  }

  const active = state.units.find((u) => u.uid === then.uid);
  if (!active || then.afterAttack === "end") {
    endActivation(state, then.uid);
  } else {
    state.phase = { type: "activation", uid: then.uid, moved: then.moved, attacked: true };
  }
}

/** Applies damage with Pack → Few flipping (p. 37). Returns true if the unit is still on the board. */
function applyDamage(state: CombatState, unit: CombatUnit, amount: number): boolean {
  if (amount <= 0) {
    log(state, { type: "damage", uid: unit.uid, amount: 0, flipped: false, defeated: false });
    return true;
  }
  unit.paralyzed = false;
  let total = unit.damage + amount;
  let flipped = false;
  let hp = statsOf(unit).hp;
  if (total >= hp && unit.variant === "pack") {
    total -= hp;
    unit.variant = "few";
    flipped = true;
    hp = statsOf(unit).hp;
  }
  const defeated = total >= hp;
  log(state, { type: "damage", uid: unit.uid, amount, flipped, defeated });
  if (defeated) {
    state.units = state.units.filter((u) => u.uid !== unit.uid);
    return false;
  }
  unit.damage = total;
  return true;
}

function checkOver(state: CombatState): boolean {
  if (state.phase.type === "over") return true;
  const alive = (s: Side) => state.units.some((u) => u.side === s);
  if (alive("attacker") && alive("defender")) return false;
  const winner: Side | null = alive("attacker") ? "attacker" : alive("defender") ? "defender" : null;
  state.phase = { type: "over", winner, reason: "eliminated" };
  log(state, { type: "over", winner });
  return true;
}
