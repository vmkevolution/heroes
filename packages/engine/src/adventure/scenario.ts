import { astrologers, FACTIONS, getVariant, tiles, units, type Faction, type MapTile, type TileGroup } from "@heroes/data";
import type { RngState } from "../rng.ts";
import { shuffle } from "./dice.ts";
import { editorCellToHex, fieldHex, hexKey, subHex, type Hex } from "./hex.ts";
import type { AdventureState, ArmyUnit, Difficulty, FieldMarks, Hero, NeutralDecks, PlacedTile, Player } from "./types.ts";

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
}

export interface AdventureSetup {
  layout: keyof typeof LAYOUTS;
  players: PlayerSetup[];
  seed: number;
  difficulty?: Difficulty;
  /** Boxes whose tiles and neutral units are in play (wiki "Comes With" names). All by default. */
  content?: string[];
}

/** Starting resources, income, units and length of the sandbox Clash (taken from "The Hunt"). */
export const SANDBOX = {
  resources: { gold: 15, buildingMaterials: 4, valuables: 2 },
  production: { gold: 10, buildingMaterials: 2, valuables: 1 },
  maxRounds: 14,
  tileSupply: 1,
} as const;

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
      players.push({
        id,
        name: p.name,
        faction: p.faction,
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
      seat += 1;
    } else {
      placed.push({ tileId: draw(slot.group), group: slot.group, center, rotation: 0, faceUp: false });
    }
  }
  for (const p of players) for (let i = 0; i < SANDBOX.tileSupply; i++) p.tileSupply.push(draw("far"));

  const [decks, rng2] = neutralDecks(setup.content, rng);
  rng = rng2;
  const astroDeck = astrologers.filter((c) => inContent(setup.content, c.content)).map((c) => c.id);
  rng = shuffle(astroDeck, rng);

  return {
    scenario: setup.layout,
    round: 1,
    maxRounds: SANDBOX.maxRounds,
    difficulty: setup.difficulty ?? "normal",
    players,
    current: 0,
    heroes,
    tiles: placed,
    marks,
    neutralDecks: decks,
    astrologers: { deck: astroDeck, current: null, drawn: 0 },
    effects: { extraMp: 0, nextIncome: {} },
    victoryPending: [],
    rng,
    phase: { type: "turn" },
    log: [{ type: "round-start", round: 1, resourceRound: false }, { type: "turn-start", player: players[0]!.id }],
  };
}

export type { Hex };
