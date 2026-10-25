import {
  abilities,
  artifacts,
  astrologers,
  FACTIONS,
  getHero,
  getSpell,
  getVariant,
  heroes as heroCards,
  spells,
  tiles,
  units,
  type BuildingSlot,
  type Faction,
  type HeroCard,
  type MapTile,
  type TileGroup,
} from "@heroes/data";
import type { RngState } from "../rng.ts";
import { flushQueue } from "./cardplay.ts";
import { runAutomation } from "./bot.ts";
import { buildAiDeck, type AiHeroSetup, type AiHeroState } from "./aihero.ts";
import { shuffle } from "./dice.ts";
import { editorCellToHex, fieldHex, hexKey, subHex, type Hex } from "./hex.ts";
import type { DeckName } from "./cards.ts";
import type {
  AdventureState,
  ArmyUnit,
  Difficulty,
  FieldMarks,
  Hero,
  NeutralDecks,
  Op,
  Pile,
  PlacedTile,
  Player,
  Task,
} from "./types.ts";

/** A tile slot of a Scenario map layout: `S` slots are the players' Starting Tiles, in seat order. */
export interface LayoutSlot {
  group: TileGroup;
  row: number;
  col: number;
}

/**
 * Map layouts drawn with the community map editor and published in the fan Mission Book
 * (github.com/qwrtln/Homm3BG-mission-book, CC BY-NC-SA 4.0), scenario "The Hunt".
 * Coordinates are the editor's grid cells of each tile's center.
 */
export const LAYOUTS: Record<string, LayoutSlot[]> = {
  "hunt-2": [
    { group: "starting", row: 7, col: 8 },
    { group: "starting", row: 13, col: 13 },
    { group: "far", row: 6, col: 11 },
    { group: "far", row: 14, col: 11 },
    { group: "near", row: 8, col: 13 },
    { group: "near", row: 12, col: 9 },
    { group: "center", row: 10, col: 11 },
  ],
  "hunt-3": [
    { group: "starting", row: 5, col: 13 },
    { group: "starting", row: 10, col: 6 },
    { group: "starting", row: 15, col: 13 },
    { group: "far", row: 8, col: 14 },
    { group: "far", row: 8, col: 8 },
    { group: "far", row: 14, col: 11 },
    { group: "near", row: 11, col: 13 },
    { group: "near", row: 7, col: 10 },
    { group: "near", row: 12, col: 9 },
    { group: "center", row: 10, col: 11 },
  ],
};

export interface PlayerSetup {
  name: string;
  faction: Faction;
  /** Main Hero (wiki hero id); defaults to the Faction's first Core Game Hero. */
  hero?: string;
  /** Played by the computer. */
  computer?: boolean;
  /** An AI Hero of a Campaign or Cooperative Scenario (p. 49), with its AI Deck. */
  aiHero?: AiHeroSetup;
}

export interface AdventureSetup {
  layout: keyof typeof LAYOUTS;
  players: PlayerSetup[];
  seed: number;
  difficulty?: Difficulty;
  /**
   * Neutral Units follow the AI rules (p. 48). In Clash games the enemy player normally controls them
   * (p. 41); by default the AI takes over when fewer than two humans play.
   */
  neutralAI?: boolean;
  /** Boxes whose tiles and neutral units are in play (wiki "Comes With" names). All by default. */
  content?: string[];
}

/** Starting resources, income, units and length of the sandbox Clash (taken from "The Hunt"). */
export const SANDBOX = {
  resources: { gold: 15, buildingMaterials: 4, valuables: 2 },
  production: { gold: 10, buildingMaterials: 2, valuables: 1 },
  maxRounds: 14,
  tileSupply: 1,
  buildings: ["dwelling_bronze", "city_hall"] as BuildingSlot[],
} as const;

/**
 * Magic Arrow copies in the game: one per box listing it on the wiki. Players take theirs for
 * their Starting Decks and the rest go into the Spell Deck (p. 13, step 15).
 */
export const MAGIC_ARROWS = getSpell("magic_arrow").content.length;

export function defaultHero(faction: Faction): HeroCard {
  const own = heroCards.filter((h) => h.faction === faction);
  return own.find((h) => h.content.includes("Core Game")) ?? own[0]!;
}

/** Starting Deck (p. 12–13, steps 11–14): Statistic cards, Magic Arrows, Starting Ability and Specialty I. */
export function startingDeck(hero: HeroCard): string[] {
  const deck: string[] = [];
  for (const stat of ["attack", "defense", "power", "knowledge"] as const) {
    for (let i = 0; i < hero.stats[stat]; i++) deck.push(`stat:${stat}`);
  }
  for (let i = 0; i < (hero.type === "magic" ? 2 : 1); i++) deck.push("spell:magic_arrow");
  deck.push(`ability:${hero.ability}`, `specialty:${hero.id}:0`);
  return deck;
}

/** Starting bonus by Difficulty (p. 10). */
export function startingBonus(difficulty: Difficulty): Op[] {
  switch (difficulty) {
    case "easy":
      return [
        { op: "resource-dice", n: 2, chooseOne: false },
        { op: "search", deck: "artifact", n: 2, times: 2 },
      ];
    case "normal":
      return [
        { op: "resource-dice", n: 2, chooseOne: true },
        { op: "search", deck: "artifact", n: 2 },
      ];
    case "hard":
      return [{ op: "resource-dice", n: 1, chooseOne: false }, { op: "minor-artifact" }];
    case "impossible":
      return [];
  }
}

export const MAIN_HERO_MP = 3;
export const SECONDARY_HERO_MP = 2;

export function startingTileOf(faction: Faction): MapTile {
  const t = tiles.find((x) => x.group === "starting" && x.fields[3]!.faction === faction);
  if (!t) throw new Error(`no Starting Tile for ${faction}`);
  return t;
}

/** "A Pack of the cheapest bronze unit and a Few of the most expensive bronze unit" (The Hunt). */
export function sandboxArmy(faction: Faction): ArmyUnit[] {
  const bronze = units
    .filter((c) => c.variants.some((v) => v.key === "few" && v.faction === faction && v.tier === "bronze"))
    .map((c) => ({ id: c.id, gold: getVariant(c.id, "few").cost?.gold ?? 0 }))
    .sort((x, y) => x.gold - y.gold);
  const cheapest = bronze[0];
  const dearest = bronze.at(-1);
  if (!cheapest || !dearest) throw new Error(`${faction} has no bronze units`);
  return [
    { unitId: cheapest.id, variant: "pack" },
    { unitId: dearest.id, variant: "few" },
  ];
}

const inContent = (content: string[] | undefined, boxes: string[]) =>
  !content || boxes.some((b) => content.includes(b));

function neutralDecks(content: string[] | undefined, rng: RngState): [NeutralDecks, RngState] {
  const decks: NeutralDecks = {};
  let state = rng;
  for (const tier of ["bronze", "silver", "gold", "azure"]) {
    const deck = units
      .filter((c) => inContent(content, c.content) && c.variants.some((v) => v.key === "neutral" && v.tier === tier))
      .map((c) => c.id);
    state = shuffle(deck, state);
    decks[tier] = { deck, discard: [] };
  }
  return [decks, state];
}

export function emptyMarks(): FieldMarks {
  return { blackCube: false, flag: null, settlementResource: null, everFlagged: false, cleared: false };
}

export function setupAdventure(setup: AdventureSetup): AdventureState {
  const layout = LAYOUTS[setup.layout];
  if (!layout) throw new Error(`unknown layout ${setup.layout}`);
  const starts = layout.filter((s) => s.group === "starting");
  if (setup.players.length !== starts.length) {
    throw new Error(`layout ${setup.layout} needs ${starts.length} players`);
  }
  if (new Set(setup.players.map((p) => p.faction)).size !== setup.players.length) {
    throw new Error("each player needs a different Faction");
  }
  let rng: RngState = { kind: "seeded", seed: setup.seed };

  // Random tiles for every other slot, drawn per group (p. 31); expansions-only tile types stay out.
  const pools: Partial<Record<TileGroup, string[]>> = {};
  for (const group of ["far", "near", "center"] as const) {
    const pool = tiles
      .filter((t) => t.group === group && inContent(setup.content, t.content))
      .filter((t) => !t.fields.some((f) => f.location === "random_town") || FACTIONS.length > setup.players.length)
      .map((t) => t.id);
    rng = shuffle(pool, rng);
    pools[group] = pool;
  }
  const draw = (group: TileGroup) => {
    const id = pools[group]?.shift();
    if (!id) throw new Error(`not enough ${group} tiles`);
    return id;
  };

  // Center the map on the layout's first Center tile (or its first slot).
  const anchor = layout.find((s) => s.group === "center") ?? layout[0]!;
  const origin = editorCellToHex(anchor.row, anchor.col);
  const placed: PlacedTile[] = [];
  const players: Player[] = [];
  const heroes: Hero[] = [];
  const marks: Record<string, FieldMarks> = {};
  let seat = 0;
  const aiHeroes: Record<string, AiHeroState> = {};
  for (const slot of layout) {
    const center = subHex(editorCellToHex(slot.row, slot.col), origin);
    if (slot.group === "starting") {
      const p = setup.players[seat]!;
      const id = `p${seat + 1}`;
      const tile = startingTileOf(p.faction);
      placed.push({ tileId: tile.id, group: "starting", center, rotation: 0, faceUp: true });
      const town = fieldHex(center, 0, 3);
      marks[hexKey(town)] = { ...emptyMarks(), flag: id, everFlagged: true };
      const army = sandboxArmy(p.faction);
      const hero = p.hero ? getHero(p.hero) : defaultHero(p.faction);
      if (hero.faction !== p.faction) throw new Error(`${hero.name} is not a ${p.faction} Hero`);
      const deck = startingDeck(hero);
      rng = shuffle(deck, rng);
      players.push({
        id,
        name: p.name,
        faction: p.faction,
        hero: hero.id,
        deck,
        hand: [],
        discard: [],
        permanent: null,
        expertUsed: 0,
        levelRewarded: 1,
        town: { buildings: [...SANDBOX.buildings], used: { build: false, population: false, spellBook: false }, mageGuildRound: null },
        trading: false,
        resources: { ...SANDBOX.resources },
        production: { ...SANDBOX.production },
        army: army.map((u) => ({ ...u })),
        startingArmy: army,
        morale: 0,
        tileSupply: [],
        factionCubes: [],
        roundsWithoutBase: 0,
        eliminated: false,
      });
      heroes.push({ id: `${id}-main`, owner: id, kind: "main", pos: town, lastVisited: town, mp: MAIN_HERO_MP, bonusMp: 0, experience: 0 });
      if (p.aiHero) {
        // AI Heroes have no Town Board, Resources or Hero Board (p. 49).
        const me = players[players.length - 1]!;
        me.deck = [];
        me.town.buildings = [];
        me.resources = { gold: 0, buildingMaterials: 0, valuables: 0 };
        me.production = { gold: 0, buildingMaterials: 0, valuables: 0 };
        if (p.aiHero.army) {
          me.army = p.aiHero.army.map((u) => ({ ...u }));
          me.startingArmy = p.aiHero.army.map((u) => ({ ...u }));
        }
        const [ai, r] = buildAiDeck(p.aiHero, rng);
        rng = r;
        aiHeroes[id] = ai;
      }
      seat += 1;
    } else {
      placed.push({ tileId: draw(slot.group), group: slot.group, center, rotation: 0, faceUp: false });
    }
  }
  for (const p of players) for (let i = 0; i < SANDBOX.tileSupply; i++) p.tileSupply.push(draw("far"));

  const [neutralPiles, rng2] = neutralDecks(setup.content, rng);
  rng = rng2;
  const astroDeck = astrologers.filter((c) => inContent(setup.content, c.content)).map((c) => c.id);
  rng = shuffle(astroDeck, rng);

  // Ability, Artifact and Spell Decks, each with one card turned up as its Discard Pile (p. 13).
  const usedArrows = players.reduce((n, p) => n + p.deck.filter((c) => c === "spell:magic_arrow").length, 0);
  const lists: Record<DeckName, string[]> = {
    ability: abilities.filter((c) => inContent(setup.content, c.content)).map((c) => `ability:${c.id}`),
    artifact: artifacts.filter((c) => inContent(setup.content, c.content)).map((c) => `artifact:${c.id}`),
    spell: spells
      .filter((c) => c.id !== "magic_arrow" && inContent(setup.content, c.content))
      .map((c) => `spell:${c.id}`)
      .concat(Array.from({ length: Math.max(0, MAGIC_ARROWS - usedArrows) }, () => "spell:magic_arrow")),
  };
  const decks = {} as Record<DeckName, Pile>;
  for (const name of ["ability", "artifact", "spell"] as const) {
    const deck = lists[name];
    rng = shuffle(deck, rng);
    decks[name] = { deck, discard: deck.length ? [deck.pop()!] : [] };
  }

  const queue: Task[] = [];
  const bonus = startingBonus(setup.difficulty ?? "normal");
  if (bonus.length) {
    for (const p of players) if (!aiHeroes[p.id]) queue.push({ kind: "choice", player: p.id, source: "starting-bonus", options: bonus });
  }
  queue.push({ kind: "refresh", player: players[0]!.id });

  const state: AdventureState = {
    scenario: setup.layout,
    round: 1,
    maxRounds: SANDBOX.maxRounds,
    difficulty: setup.difficulty ?? "normal",
    players,
    current: 0,
    heroes,
    tiles: placed,
    marks,
    neutralDecks: neutralPiles,
    decks,
    queue,
    astrologers: { deck: astroDeck, current: null, drawn: 0 },
    effects: { extraMp: 0, nextIncome: {} },
    victoryPending: [],
    ai: {
      neutrals: setup.neutralAI ?? setup.players.filter((p) => !p.computer && !p.aiHero).length < 2,
      players: players.filter((_, i) => setup.players[i]!.computer).map((p) => p.id),
      heroes: aiHeroes,
    },
    rng,
    phase: { type: "turn" },
    log: [{ type: "round-start", round: 1, resourceRound: false }, { type: "turn-start", player: players[0]!.id }],
  };
  flushQueue(state);
  runAutomation(state);
  return state;
}

export type { Hex };
