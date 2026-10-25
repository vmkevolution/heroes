/**
 * Town Actions (p. 18), the Town Board (p. 30), recruiting (p. 36) and trading (p. 52).
 */
import { getTown, getVariant, units, type BuildingSlot, type Faction, type Resource, type Tier } from "@heroes/data";
import { IllegalAction } from "../combat/engine.ts";
import { queueFirst } from "./cardplay.ts";
import { currentPlayer, fieldAt, gain, log, pay } from "./core.ts";
import { SECONDARY_HERO_MP } from "./scenario.ts";
import { sameHex, type Hex } from "./hex.ts";
import type { AdventureState, Op, Player, PlayerId, Resources } from "./types.ts";

/** Hiring a Secondary Hero with the Population Token (p. 20). */
export const HIRE_COST = 10;

const DWELLING: Record<string, BuildingSlot> = {
  bronze: "dwelling_bronze",
  silver: "dwelling_silver",
  gold: "dwelling_gold",
};

/** Upgrades are Built in order (p. 30): the silver Dwelling needs the bronze one, the gold one the silver one. */
const PREREQUISITE: Partial<Record<BuildingSlot, BuildingSlot>> = {
  dwelling_silver: "dwelling_bronze",
  dwelling_gold: "dwelling_silver",
};

/**
 * Trade table (rule book back cover; wiki "Trading"): how many of `sell` buy one `buy`,
 * or, for Valuables sold, how many of `buy` one Valuable brings.
 */
export const TRADE_RATES: Record<Resource, Partial<Record<Resource, { give: number; get: number }>>> = {
  gold: { buildingMaterials: { give: 2, get: 1 }, valuables: { give: 6, get: 1 } },
  buildingMaterials: { gold: { give: 1, get: 1 }, valuables: { give: 3, get: 1 } },
  valuables: { gold: { give: 1, get: 3 }, buildingMaterials: { give: 1, get: 2 } },
};

function costOf(c: { gold: number; buildingMaterials: number; valuables: number } | null): Partial<Resources> {
  return { gold: c?.gold ?? 0, buildingMaterials: c?.buildingMaterials ?? 0, valuables: c?.valuables ?? 0 };
}

function requireOwnTurn(state: AdventureState): Player {
  if (state.phase.type !== "turn") throw new IllegalAction("finish the current step first");
  return currentPlayer(state);
}

export function canAfford(p: Player, cost: Partial<Resources>): boolean {
  return (Object.entries(cost) as [Resource, number][]).every(([r, n]) => p.resources[r] >= n);
}

/** Buildings the player may Build now (cost not checked). */
export function buildable(p: Player): BuildingSlot[] {
  if (p.town.used.build) return [];
  return getTown(p.faction).buildings
    .map((b) => b.slot)
    .filter((slot) => !p.town.buildings.includes(slot))
    .filter((slot) => {
      const pre = PREREQUISITE[slot];
      return !pre || p.town.buildings.includes(pre);
    });
}

export function build(state: AdventureState, slot: BuildingSlot) {
  const p = requireOwnTurn(state);
  if (!buildable(p).includes(slot)) throw new IllegalAction("you cannot Build that now (p. 30)");
  const b = getTown(p.faction).buildings.find((x) => x.slot === slot)!;
  pay(state, p, costOf(b.cost));
  p.town.buildings.push(slot);
  p.town.used.build = true;
  log(state, { type: "build", player: p.id, slot });
  if (slot === "mage_guild") {
    // "When built: Search (2) the Spell Deck twice." The Spell Book waits until next Round (p. 18).
    p.town.mageGuildRound = state.round;
    queueFirst(
      state,
      { kind: "search", player: p.id, deck: "spell", n: 2, source: "mage_guild" },
      { kind: "search", player: p.id, deck: "spell", n: 2, source: "mage_guild" },
    );
  } else if (slot.startsWith("special")) {
    log(state, { type: "building-effect", player: p.id, slot });
  }
}

/** Faction unit cards a player could recruit: one card per unit, so units already in the Unit Deck are out (p. 36). */
export function recruitable(p: Player): string[] {
  return units
    .filter((c) => c.variants.some((v) => v.key === "few" && v.origin === "faction" && v.faction === p.faction))
    .filter((c) => !p.army.some((a) => a.unitId === c.id))
    .filter((c) => {
      const tier = getVariant(c.id, "few").tier as Tier;
      return p.town.buildings.includes(DWELLING[tier]!);
    })
    .map((c) => c.id);
}

export function canReinforce(p: Player, armyIndex: number): boolean {
  const u = p.army[armyIndex];
  if (!u || u.variant !== "few") return false;
  const few = getVariant(u.unitId, "few");
  if (few.origin !== "faction") return false;
  return p.town.buildings.includes("citadel") && p.town.buildings.includes(DWELLING[few.tier as Tier]!);
}

/** One use of the Population Token: recruit and reinforce as many units as you can pay for (p. 36). */
export function recruit(state: AdventureState, recruits: string[], reinforce: number[]) {
  const p = requireOwnTurn(state);
  if (p.town.used.population) throw new IllegalAction("the Population Token is already used this Round");
  if (recruits.length + reinforce.length === 0) throw new IllegalAction("nothing to recruit");
  for (const i of new Set(reinforce)) {
    if (!canReinforce(p, i)) throw new IllegalAction("reinforcing needs a Citadel and the unit's Dwelling (p. 36)");
    pay(state, p, costOf(getVariant(p.army[i]!.unitId, "pack").cost));
    p.army[i]!.variant = "pack";
    log(state, { type: "recruit", player: p.id, unitId: p.army[i]!.unitId, variant: "pack" });
  }
  for (const id of recruits) {
    if (!recruitable(p).includes(id)) throw new IllegalAction("recruiting needs the unit's Dwelling (p. 36)");
    pay(state, p, costOf(getVariant(id, "few").cost));
    p.army.push({ unitId: id, variant: "few" });
    log(state, { type: "recruit", player: p.id, unitId: id, variant: "few" });
  }
  p.town.used.population = true;
}

/** Towns and Settlements a player controls, where a new Secondary Hero may appear (p. 20). */
export function hireSpots(state: AdventureState, player: PlayerId): Hex[] {
  return Object.entries(state.marks)
    .filter(([, m]) => m.flag === player)
    .map(([key]) => {
      const [q, r] = key.split(",").map(Number);
      return { q: q!, r: r! };
    })
    .filter((hex) => {
      const loc = fieldAt(state, hex)?.field.location;
      return loc === "town" || loc === "settlement" || loc === "random_town";
    })
    .filter((hex) => !state.heroes.some((h) => sameHex(h.pos, hex)));
}

export function hireHero(state: AdventureState, at: Hex) {
  const p = requireOwnTurn(state);
  if (p.town.used.population) throw new IllegalAction("the Population Token is already used this Round");
  if (state.heroes.some((h) => h.owner === p.id && h.kind === "secondary")) throw new IllegalAction("you already have a Secondary Hero");
  if (!hireSpots(state, p.id).some((h) => sameHex(h, at))) throw new IllegalAction("place the Hero in a Town or Settlement you control");
  pay(state, p, { gold: HIRE_COST });
  p.town.used.population = true;
  const id = `${p.id}-secondary-${state.log.length}`;
  state.heroes.push({ id, owner: p.id, kind: "secondary", pos: { ...at }, lastVisited: { ...at }, mp: SECONDARY_HERO_MP, bonusMp: 0, experience: 0 });
  log(state, { type: "hire-hero", player: p.id, heroId: id });
}

export function canUseSpellBook(state: AdventureState, p: Player): boolean {
  return p.town.buildings.includes("mage_guild") && !p.town.used.spellBook && p.town.mageGuildRound !== state.round;
}

/** Spell Book Token: pay the Mage Guild price to Search (2) the Spell Deck (p. 18, 30). */
export function spellBook(state: AdventureState) {
  const p = requireOwnTurn(state);
  if (!canUseSpellBook(state, p)) throw new IllegalAction("the Spell Book needs a Mage Guild built in an earlier Round (p. 18)");
  pay(state, p, { gold: getTown(p.faction).spellBookCost });
  p.town.used.spellBook = true;
  queueFirst(state, { kind: "search", player: p.id, deck: "spell", n: 2, source: "spell_book" });
}

export function trade(state: AdventureState, sell: Resource, buy: Resource, times: number) {
  const p = requireOwnTurn(state);
  if (!p.trading) throw new IllegalAction("trade at a Trading Post (p. 52)");
  const rate = TRADE_RATES[sell][buy];
  if (!rate || !Number.isInteger(times) || times < 1) throw new IllegalAction("no such trade");
  pay(state, p, { [sell]: rate.give * times });
  gain(state, p.id, { [buy]: rate.get * times });
  log(state, { type: "trade", player: p.id, sell, buy, times });
}

/**
 * City Hall choices "at the beginning of each Resource Round" (Cove: Astrologers' Round), from the
 * Town Board texts (wiki "Towns").
 */
export function cityHallOptions(p: Player): Op[] {
  const g = (n: number): Op => ({ op: "gain", resources: { gold: n } });
  const map: Record<Faction, Op[]> = {
    castle: [g(5), { op: "mp", n: 1 }],
    necropolis: [
      g(4),
      ...p.army
        .map((u, i) => ({ u, i }))
        .filter(({ u }) => u.variant === "few" && getVariant(u.unitId, "few").tier === "bronze" && getVariant(u.unitId, "few").origin === "faction")
        .map(({ i }): Op => ({ op: "reinforce", armyIndex: i, cost: 0 })),
    ],
    dungeon: [g(5), { op: "gain", resources: { valuables: 1 } }],
    tower: [g(4), { op: "draw", n: 1 }],
    rampart: [g(7)],
    fortress: [g(5), { op: "trade" }],
    inferno: [g(6), { op: "gain", resources: { buildingMaterials: 3 } }],
    stronghold: [{ op: "draw", n: 2 }, { op: "gain", resources: { buildingMaterials: 2 } }],
    conflux: [g(4), { op: "search", deck: "spell", n: 3 }],
    cove: [
      g(4),
      ...p.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.startsWith("artifact:"))
        .map(({ i }): Op => ({ op: "remove", handIndex: i, then: "experience" })),
    ],
  };
  return map[p.faction];
}

export const cityHallRound = (faction: Faction) => (faction === "cove" ? "astrologers" : "resource");

/** New Round: Town Action Tokens flip back (p. 15). */
export function refreshTowns(state: AdventureState) {
  for (const p of state.players) p.town.used = { build: false, population: false, spellBook: false };
}

export function townHex(state: AdventureState, p: Player): Hex | null {
  for (const [key, m] of Object.entries(state.marks)) {
    const [q, r] = key.split(",").map(Number);
    const info = fieldAt(state, { q: q!, r: r! });
    if (info?.field.location === "town" && info.field.faction === p.faction && m.flag === p.id) return { q: q!, r: r! };
  }
  return null;
}
