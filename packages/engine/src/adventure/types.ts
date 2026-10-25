import type { Faction, Resource, TileGroup } from "@heroes/data";
import type { RngState } from "../rng.ts";
import type { CombatState, Placement, Side } from "../combat/types.ts";
import type { Hex } from "./hex.ts";

export type PlayerId = string;
export type Resources = Record<Resource, number>;

/** A unit card in a player's Unit Deck (p. 36). */
export interface ArmyUnit {
  unitId: string;
  /** `few` or `pack` for Faction units, `neutral` for Neutral Units gained by effects. */
  variant: string;
}

export interface Hero {
  id: string;
  owner: PlayerId;
  kind: "main" | "secondary";
  pos: Hex;
  /** Last Field the Hero visited: where a retreating Hero goes back to (p. 44). */
  lastVisited: Hex;
  /** Movement Points left this Round (p. 17). */
  mp: number;
  /** MP gained by effects: they last until the end of the Turn they were gained on. */
  bonusMp: number;
  /** Main Hero only (p. 21). */
  experience: number;
}

export interface Player {
  id: PlayerId;
  name: string;
  faction: Faction;
  resources: Resources;
  production: Resources;
  army: ArmyUnit[];
  /** The Scenario's starting units, given back for free whenever the Unit Deck is empty (p. 44). */
  startingArmy: ArmyUnit[];
  /** +1: a Positive Morale Token; −1 or −2: Negative Morale Tokens (p. 19). */
  morale: number;
  /** Far Map Tiles this player may place (p. 32). */
  tileSupply: string[];
  /** Faction Cubes taken from defeated enemies (p. 11). */
  factionCubes: PlayerId[];
  /** Full Rounds played without a Town or Settlement: the third one eliminates (p. 11). */
  roundsWithoutBase: number;
  eliminated: boolean;
}

export interface PlacedTile {
  tileId: string;
  group: TileGroup;
  center: Hex;
  rotation: number;
  faceUp: boolean;
}

/** What players have left on a Field: Black Cube, Faction Cube, guard beaten. */
export interface FieldMarks {
  /** Visitable Field already used (p. 32). */
  blackCube: boolean;
  /** Owner of the Faction Cube on a Flaggable Field. */
  flag: PlayerId | null;
  /** Settlement production chosen by its owner (p. 77). */
  settlementResource: Resource | null;
  /** True once anyone has flagged it: later owners do not get the immediate income. */
  everFlagged: boolean;
  /** True once the guarding Neutral Units were beaten. */
  cleared: boolean;
}

/** Faces of the Resource Die (p. 29). */
export type ResourceFace = { resource: Resource; amount: number };
/** Faces of the Treasure Die (p. 73). */
export type TreasureFace = "experience" | "artifact" | "resource" | "resource2";

/** A choice the active player must make before the game goes on. */
export type Choice =
  | { kind: "resource-die"; faces: ResourceFace[]; heroId: string }
  | { kind: "treasure-die"; faces: TreasureFace[]; heroId: string }
  | { kind: "pandora"; heroId: string }
  | { kind: "settlement"; heroId: string; hex: Hex; free: boolean }
  | { kind: "mystical-garden"; heroId: string }
  | { kind: "tree-of-knowledge"; heroId: string }
  | { kind: "discover"; heroId: string; slots: Hex[] };

export interface NeutralFoe {
  kind: "neutral";
  hex: Hex;
  difficulty: number;
  units: {
    unitId: string;
    tier: string;
    variant: string;
    /** Drawn from a Neutral deck: goes to its Discard Pile afterwards (p. 38). */
    card: boolean;
  }[];
}
export interface HeroFoe {
  kind: "hero";
  heroId: string;
}
export interface SiegeFoe {
  kind: "siege";
  hex: Hex;
  defender: PlayerId;
}
export type Foe = NeutralFoe | HeroFoe | SiegeFoe;

export interface CombatContext {
  attackerHero: string;
  /** The Field the attacker moved from: retreat destination is the last visited Field. */
  foe: Foe;
  /** Army indexes of the units each side brought, in placement order (maps combat uids back). */
  picks: Partial<Record<Side, number[]>>;
  /** Board positions chosen during Combat setup. */
  placements: Partial<Record<Side, Placement[]>>;
}

export type AdventurePhase =
  | { type: "turn" }
  | { type: "choice"; choice: Choice }
  /** Siege of an undefended Town or Settlement: the owner may pay 8 gold to defend (p. 46). */
  | { type: "siege-decision"; heroId: string; hex: Hex; defender: PlayerId }
  /** Players choose up to 5 units and their lines (p. 41). */
  | { type: "combat-setup"; context: CombatContext; side: Side }
  | { type: "combat"; context: CombatContext; combat: CombatState }
  | { type: "over"; winners: PlayerId[]; reason: "victory" | "elimination" | "time" };

export type NeutralDecks = Record<string, { deck: string[]; discard: string[] }>;

export interface AdventureState {
  scenario: string;
  round: number;
  maxRounds: number;
  difficulty: Difficulty;
  players: Player[];
  /** Index into `players` of the player taking their Turn. */
  current: number;
  heroes: Hero[];
  tiles: PlacedTile[];
  marks: Record<string, FieldMarks>;
  neutralDecks: NeutralDecks;
  astrologers: { deck: string[]; current: string | null; drawn: number };
  /** Lasting effects of the current Astrologers Proclaim card. */
  effects: { extraMp: number; nextIncome: Partial<Resources> };
  /** A victory condition was met: the game ends at the end of this Round (p. 11). */
  victoryPending: PlayerId[];
  rng: RngState;
  phase: AdventurePhase;
  log: AdventureEvent[];
}

export type Difficulty = "easy" | "normal" | "hard" | "impossible";

export type AdventureEvent =
  | { type: "round-start"; round: number; resourceRound: boolean }
  | { type: "income"; player: PlayerId; gained: Resources }
  | { type: "astrologers"; card: string }
  | { type: "turn-start"; player: PlayerId }
  | { type: "move"; heroId: string; to: Hex }
  | { type: "discover"; heroId: string; tileId: string }
  | { type: "place-tile"; heroId: string; tileId: string }
  | { type: "visit"; heroId: string; hex: Hex; location: string }
  | { type: "gain"; player: PlayerId; resources: Partial<Resources> }
  | { type: "pay"; player: PlayerId; resources: Partial<Resources> }
  | { type: "production"; player: PlayerId; resource: Resource; delta: number }
  | { type: "flag"; player: PlayerId; hex: Hex; location: string; from: PlayerId | null }
  | { type: "experience"; heroId: string; amount: number; level: number }
  | { type: "morale"; player: PlayerId; morale: number }
  | { type: "mp"; heroId: string; amount: number }
  | { type: "dice"; die: "resource" | "treasure"; faces: (ResourceFace | TreasureFace)[] }
  | { type: "not-automated"; location: string }
  | { type: "quick-combat"; heroId: string; hex: Hex }
  | { type: "combat-start"; heroId: string; foe: Foe }
  | { type: "combat-end"; heroId: string; outcome: "victory" | "retreat" | "defeat" | "surrender"; winner: PlayerId | null }
  | { type: "hero-defeated"; heroId: string; movedTo: Hex | null }
  | { type: "army-reset"; player: PlayerId }
  | { type: "eliminated"; player: PlayerId }
  | { type: "victory-condition"; player: PlayerId }
  | { type: "game-over"; winners: PlayerId[] };

export type AdventureAction =
  | { type: "move"; heroId: string; to: Hex }
  | { type: "revisit"; heroId: string }
  | { type: "discover"; heroId: string; center: Hex; rotation: number }
  | { type: "place-tile"; heroId: string; tileIndex: number; center: Hex; rotation: number }
  | { type: "choose"; option: number }
  | { type: "settlement"; resource: Resource }
  | { type: "settlement-reinforce"; armyIndex: number }
  | { type: "siege"; defend: boolean }
  | { type: "combat-setup"; picks: { armyIndex: number; line: "back" | "front" }[] }
  | { type: "combat"; action: import("../combat/types.ts").CombatAction }
  | { type: "surrender"; side: Side }
  | { type: "end-turn" };
