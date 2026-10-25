import type { UnitType } from "@heroes/data";
import type { RngState } from "../rng.ts";

export type Side = "attacker" | "defender";
export const SIDES: readonly Side[] = ["attacker", "defender"];
export const other = (s: Side): Side => (s === "attacker" ? "defender" : "attacker");

/**
 * The 4×5 Combat Board (rule book p. 41): 4 columns, 5 rows.
 * Row 0 = attacker Backline, 1 = attacker Frontline, 2 = middle row,
 * 3 = defender Frontline, 4 = defender Backline.
 */
export const COLS = 4;
export const ROWS = 5;
export interface Pos {
  col: number;
  row: number;
}

export interface CombatUnit {
  uid: string;
  unitId: string;
  /** Current card side: `few`, `pack`, `neutral`, … (see UnitVariant.key). */
  variant: string;
  side: Side;
  pos: Pos;
  damage: number;
  activated: boolean;
  retaliated: boolean;
  /** Defense Token (p. 42). */
  defending: boolean;
  /** Paralysis Token (p. 42). */
  paralyzed: boolean;
}

/** Stats as resolved from the unit card, before temporary modifiers. */
export interface UnitStats {
  type: UnitType;
  attack: number;
  defense: number;
  hp: number;
  initiative: number;
}

export interface PendingAttack {
  attackerUid: string;
  targetUid: string;
  retaliation: boolean;
  /** Ranged unit firing at an adjacent unit, or Backline to Backline (p. 38). */
  penalty: boolean;
  attackBonus: number;
  defenseBonus: number;
}

export type Phase =
  /** Waiting for the active unit's controller. `moved`/`attacked` record what it already did. */
  | { type: "activation"; uid: string; moved: boolean; attacked: boolean }
  /** Both players may play cards before an attack is rolled (p. 43). */
  | { type: "reaction"; attack: PendingAttack; passed: Record<Side, boolean>; then: ActivationResume }
  /** Neutral Combat time limit (p. 43): the attacking player retreats or pays 1 MP to continue. */
  | { type: "round-end" }
  | { type: "over"; winner: Side | null; reason: "eliminated" | "retreat" };

/** What happens once a pending attack is resolved. */
export type ActivationResume = { uid: string; moved: boolean; afterAttack: "end" | "may-move" };

export interface CombatOptions {
  /** Neutral Combat: one-round time limit with retreat; neutral units cannot Defend. */
  neutralSide: Side | null;
  /** When false, no reaction window is opened before attacks (used by quick simulations). */
  reactions: boolean;
}

export interface CombatState {
  options: CombatOptions;
  round: number;
  units: CombatUnit[];
  obstacles: Pos[];
  rng: RngState;
  phase: Phase;
  /** Initiative tie alternation (p. 43): the side that acts next within the current tie. */
  tie: { initiative: number; next: Side } | null;
  log: CombatEvent[];
}

export type CombatEvent =
  | { type: "round-start"; round: number }
  | { type: "activate"; uid: string }
  | { type: "skip-paralyzed"; uid: string }
  | { type: "move"; uid: string; from: Pos; to: Pos }
  | { type: "defend"; uid: string }
  | { type: "modify"; side: Side; stat: "attack" | "defense"; amount: number; source: string }
  | {
      type: "attack";
      attackerUid: string;
      targetUid: string;
      retaliation: boolean;
      rolls: number[];
      roll: number;
      defenseRoll: number | null;
      attack: number;
      defense: number;
      damage: number;
    }
  | { type: "damage"; uid: string; amount: number; flipped: boolean; defeated: boolean }
  | { type: "end-activation"; uid: string }
  | { type: "retreat" }
  | { type: "over"; winner: Side | null };

export type CombatAction =
  | { type: "move"; uid: string; to: Pos }
  | { type: "attack"; uid: string; targetUid: string }
  | { type: "defend"; uid: string }
  | { type: "end-activation"; uid: string }
  | { type: "modify"; side: Side; stat: "attack" | "defense"; amount: number; source: string }
  | { type: "pass"; side: Side }
  | { type: "continue" }
  | { type: "retreat" };

export interface Placement {
  unitId: string;
  variant: string;
  pos: Pos;
}

export interface CombatSetup {
  attacker: Placement[];
  defender: Placement[];
  obstacles?: Pos[];
  rng: RngState;
  options?: Partial<CombatOptions>;
}
