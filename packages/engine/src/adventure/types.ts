import type { BuildingSlot, Faction, Resource, School, Statistic, TileGroup } from "@heroes/data";
import type { DeckName } from "./cards.ts";
import type { RngState } from "../rng.ts";
import type { CombatState, Placement, Side } from "../combat/types.ts";
import type { Hex } from "./hex.ts";
import type { AiHeroState } from "./aihero.ts";

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

/** A card pile with its own Discard Pile (p. 22). The top of a pile is the end of its array. */
export interface Pile {
  deck: string[];
  discard: string[];
}

/** Town Board (p. 18, 30). */
export interface Town {
  buildings: BuildingSlot[];
  /** Town Action Tokens flipped to their inactive side this Round. */
  used: { build: boolean; population: boolean; spellBook: boolean };
  /** The Spell Book Token cannot be used in the Round the Mage Guild is built (p. 18). */
  mageGuildRound: number | null;
}

export interface Player {
  id: PlayerId;
  name: string;
  faction: Faction;
  /** Main Hero's Hero Board (wiki hero id). */
  hero: string;
  /** The Main Hero's Deck of Might & Magic, hand and Discard Pile (p. 22). */
  deck: string[];
  hand: string[];
  discard: string[];
  /** The one Permanent card in play (p. 22). */
  permanent: string | null;
  /** Expert Effects used this Round (p. 24). */
  expertUsed: number;
  /** Highest Level whose rewards were given (p. 21). */
  levelRewarded: number;
  town: Town;
  /** Trading is open (Trading Post visit or a City Hall effect) until the Hero moves or the Turn ends. */
  trading: boolean;
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
  | { kind: "discover"; heroId: string; slots: Hex[] }
  /** A list of alternatives the engine knows how to resolve (City Hall, locations using cards, …). */
  | { kind: "options"; heroId: string; source: string; options: Op[] };

/** One resolvable alternative of an `options` choice. */
export type Op =
  | { op: "none" }
  | { op: "gain"; resources: Partial<Resources> }
  | { op: "mp"; n: number }
  | { op: "draw"; n: number }
  | { op: "morale" }
  | { op: "experience"; n: number }
  | { op: "search"; deck: DeckName; n: number; cost?: number; times?: number }
  | { op: "search-discard"; deck: DeckName; n: number; cost?: number }
  | { op: "resource-dice"; n: number; chooseOne: boolean }
  | { op: "minor-artifact" }
  | { op: "trade" }
  | { op: "reinforce"; armyIndex: number; cost: number }
  | { op: "seq"; ops: Op[] }
  | { op: "take"; card: string; from: "artifact-discard" | "own-discard" | "ability-deck"; cost?: number }
  | { op: "discard-top"; deck: DeckName }
  | { op: "remove"; handIndex: number; then?: "gold" | "experience" | "search-own-deck" | "market" | Op }
  | { op: "stat"; stat: Statistic; empowered?: boolean; replaceHandIndex?: number; cost?: number };

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
  /** Spells cast for their effect per Combat Round (p. 26), and extra allowance from cards. */
  spells?: Partial<Record<Side, { round: number; cast: number; limit: number; last: string | null }>>;
}

export type AdventurePhase =
  | { type: "turn" }
  | { type: "choice"; choice: Choice }
  /** Siege of an undefended Town or Settlement: the owner may pay 8 gold to defend (p. 46). */
  | { type: "siege-decision"; heroId: string; hex: Hex; defender: PlayerId }
  /** Players choose up to 5 units and their lines (p. 41). */
  | { type: "combat-setup"; context: CombatContext; side: Side }
  | { type: "combat"; context: CombatContext; combat: CombatState }
  /** Start of Turn hand refresh (p. 17): discard any cards, then draw up to the Hand Limit. */
  | { type: "refresh"; player: PlayerId }
  /** Search (X) (p. 22): look at the top X cards, or take the Discard Pile's top card instead. */
  | {
      type: "search";
      player: PlayerId;
      deck: DeckName;
      n: number;
      /** Cards being looked at; null until the player chooses to look. */
      revealed: string[] | null;
      /** Searching a Discard Pile (University, Blood Obelisk): picks come from the pile itself. */
      fromDiscard: boolean;
      source: string;
    }
  | { type: "over"; winners: PlayerId[]; reason: "victory" | "elimination" | "time" };

export type NeutralDecks = Record<string, { deck: string[]; discard: string[] }>;

/** Steps waiting for a player once the current one is done (level-up rewards, City Halls, …). */
export type Task =
  | { kind: "search"; player: PlayerId; deck: DeckName; n: number; source: string; fromDiscard?: boolean }
  | { kind: "refresh"; player: PlayerId }
  | { kind: "choice"; player: PlayerId; source: string; options: Op[] };

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
  /** Ability, Artifact and Spell Decks with their Discard Piles (p. 13). */
  decks: Record<DeckName, Pile>;
  queue: Task[];
  astrologers: { deck: string[]; current: string | null; drawn: number };
  /** Lasting effects of the current Astrologers Proclaim card. */
  effects: { extraMp: number; nextIncome: Partial<Resources> };
  /** A victory condition was met: the game ends at the end of this Round (p. 11). */
  victoryPending: PlayerId[];
  /** Who the engine plays: Neutral Units (p. 48) and computer-controlled players. */
  ai: { neutrals: boolean; players: PlayerId[]; heroes: Record<PlayerId, AiHeroState> };
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
  | { type: "level-up"; player: PlayerId; level: number }
  | { type: "draw"; player: PlayerId; n: number }
  | { type: "gain-card"; player: PlayerId; card: string; source: string }
  | { type: "remove-card"; player: PlayerId; card: string }
  | { type: "play-card"; player: PlayerId; card: string; option: number; automated: boolean; empower: string[] }
  | { type: "build"; player: PlayerId; slot: BuildingSlot }
  | { type: "recruit"; player: PlayerId; unitId: string; variant: string }
  | { type: "hire-hero"; player: PlayerId; heroId: string }
  | { type: "trade"; player: PlayerId; sell: Resource; buy: Resource; times: number }
  | { type: "building-effect"; player: PlayerId; slot: BuildingSlot }
  | { type: "ai-card"; player: PlayerId; card: string; spell: string | null; skill: string | null }
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
  | { type: "end-turn" }
  /** Start of Turn hand refresh: the hand indexes to discard. */
  | { type: "refresh"; discard: number[] }
  | { type: "search"; mode: "look" | "discard-pile" }
  | { type: "search-pick"; index: number }
  /**
   * Plays a card from hand (p. 22). In Combat, `player` must have their Main Hero fighting.
   * `empower` lists other hand cards played for their Power (p. 26); `target` is a combat unit uid.
   */
  | {
      type: "play-card";
      player: PlayerId;
      handIndex: number;
      option: number;
      target?: string;
      empower?: { handIndex: number; option: number }[];
      school?: School;
    }
  /** Discards a card from hand with no effect (cards that tell you to discard, p. 22). */
  | { type: "discard-card"; player: PlayerId; handIndex: number }
  | { type: "build"; slot: BuildingSlot }
  /** One use of the Population Token: any number of recruits and reinforcements (p. 36). */
  | { type: "recruit"; recruit: string[]; reinforce: number[] }
  | { type: "hire-hero"; at: Hex }
  | { type: "spell-book" }
  | { type: "trade"; sell: Resource; buy: Resource; times: number }
  /** AI Hero moves and AI cards (p. 49–50): only the engine sends these. */
  | { type: "ai-move"; heroId: string; to: Hex }
  | { type: "ai-card" }
  /** Hand-resolved card effects: players apply what the card says (honour system). */
  | { type: "adjust"; player: PlayerId; resources?: Partial<Resources>; mp?: number; draw?: number; morale?: 1 | -1 };
