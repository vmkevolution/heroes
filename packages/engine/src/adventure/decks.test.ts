import { describe, expect, it } from "vitest";
import { getTown, getVariant } from "@heroes/data";
import { activeUnit } from "../combat/engine.ts";
import { expertLimit, flushQueue, gainExperience, handLimit } from "./cardplay.ts";
import { cardInfo, parseEffects } from "./cards.ts";
import { applyAdventureAction, getHero, getPlayer, IllegalAction } from "./engine.ts";
import { fieldHex } from "./hex.ts";
import { setupAdventure, startingDeck } from "./scenario.ts";
import { TRADE_RATES } from "./town.ts";
import type { AdventureAction, AdventureState } from "./types.ts";
import { getHero as heroCard } from "@heroes/data";

const fresh = (difficulty: "normal" | "impossible" = "impossible") =>
  setupAdventure({
    layout: "hunt-2",
    players: [
      { name: "Alice", faction: "castle", hero: "catherine" },
      { name: "Bob", faction: "dungeon", hero: "alamar" },
    ],
    seed: 11,
    difficulty,
  });

const play = (s: AdventureState, ...actions: AdventureAction[]) => actions.reduce(applyAdventureAction, s);

function edit(s: AdventureState, f: (draft: AdventureState) => void): AdventureState {
  const next = structuredClone(s);
  f(next);
  return next;
}

describe("Starting Deck and hand (p. 12–13, 17, 21)", () => {
  it("builds the 9-card Starting Deck from the Hero Board", () => {
    const deck = startingDeck(heroCard("catherine")).sort();
    // Catherine: Attack 2, Defense 2, Power 1, Knowledge 1, a Hero of Might (1 Magic Arrow).
    expect(deck).toEqual(
      [
        "ability:leadership",
        "specialty:catherine:0",
        "spell:magic_arrow",
        "stat:attack",
        "stat:attack",
        "stat:defense",
        "stat:defense",
        "stat:knowledge",
        "stat:power",
      ].sort(),
    );
    // Heroes of Magic start with 2 Magic Arrows.
    expect(startingDeck(heroCard("alamar")).filter((c) => c === "spell:magic_arrow")).toHaveLength(2);
  });

  it("draws up to the Hand Limit of 4 on the first Turn", () => {
    const s = fresh();
    expect(s.phase.type).toBe("turn");
    expect(getPlayer(s, "p1").hand).toHaveLength(4);
    expect(getPlayer(s, "p1").deck).toHaveLength(5);
  });

  it("follows the Level Tracker: Hand Limit 4/5/6/7 and Expert Effects 0/1/2/3", () => {
    expect([1, 2, 3, 4, 5, 6, 7].map(handLimit)).toEqual([4, 4, 5, 5, 6, 6, 7]);
    expect([1, 2, 3, 4, 5, 6, 7].map(expertLimit)).toEqual([0, 1, 1, 2, 2, 3, 3]);
  });

  it("refreshes the hand like the rule book example: keep 1 card, draw 4 to reach 5 at Level III (p. 18)", () => {
    let s = edit(fresh(), (d) => {
      getHero(d, "p1-main").experience = 4; // Level III
      getPlayer(d, "p1").levelRewarded = 3;
      const p = getPlayer(d, "p1");
      p.hand = ["stat:attack", "stat:defense", "stat:power"];
      p.deck = ["stat:attack", "stat:attack", "stat:attack", "stat:attack", "stat:attack", "stat:attack"];
      d.phase = { type: "refresh", player: "p1" };
    });
    s = play(s, { type: "refresh", discard: [1, 2] });
    const p = getPlayer(s, "p1");
    expect(p.hand).toHaveLength(5);
    expect(p.discard).toEqual(expect.arrayContaining(["stat:defense", "stat:power"]));
  });

  it("must discard down to the Hand Limit", () => {
    const s = edit(fresh(), (d) => {
      getPlayer(d, "p1").hand = Array(6).fill("stat:attack");
      d.phase = { type: "refresh", player: "p1" };
    });
    expect(() => play(s, { type: "refresh", discard: [0] })).toThrow(IllegalAction);
    expect(getPlayer(play(s, { type: "refresh", discard: [0, 1] }), "p1").hand).toHaveLength(4);
  });
});

describe("Searching (p. 22–23)", () => {
  const searching = () =>
    edit(fresh(), (d) => {
      d.decks.spell = { deck: ["spell:curse", "spell:fireball", "spell:magic_arrow"], discard: ["spell:bless"] };
      d.phase = { type: "search", player: "p1", deck: "spell", n: 2, revealed: null, fromDiscard: false, source: "test" };
    });

  it("looks at the top 2 cards, keeps one and discards the other (Bob's Fireball example)", () => {
    let s = play(searching(), { type: "search", mode: "look" });
    expect(s.phase).toMatchObject({ revealed: ["spell:magic_arrow", "spell:fireball"] });
    s = play(s, { type: "search-pick", index: 1 });
    expect(getPlayer(s, "p1").hand).toContain("spell:fireball");
    expect(s.decks.spell.discard.at(-1)).toBe("spell:magic_arrow");
    expect(s.decks.spell.deck).toEqual(["spell:curse"]);
  });

  it("can take the Discard Pile's top card instead", () => {
    const s = play(searching(), { type: "search", mode: "discard-pile" });
    expect(getPlayer(s, "p1").hand).toContain("spell:bless");
    // An empty Discard Pile is refilled with the Deck's top card.
    expect(s.decks.spell.discard).toEqual(["spell:magic_arrow"]);
  });

  it("Scouting played before the Search makes it Search (3)", () => {
    let s = edit(searching(), (d) => {
      getPlayer(d, "p1").hand = ["ability:scouting"];
    });
    s = play(s, { type: "play-card", player: "p1", handIndex: 0, option: 0 });
    expect(s.phase).toMatchObject({ type: "search", n: 3 });
  });
});

describe("Level ups (p. 21)", () => {
  it("Searches the Ability Deck at Level II and III, and gains Specialty IV at Level IV", () => {
    let s = edit(fresh(), (d) => {
      d.decks.ability = { deck: ["ability:estates", "ability:offense", "ability:luck", "ability:wisdom"], discard: ["ability:tactics"] };
      gainExperience(d, getHero(d, "p1-main"), 2);
      flushQueue(d);
    });
    expect(s.phase).toMatchObject({ type: "search", deck: "ability", n: 2, source: "level-up" });
    s = play(s, { type: "search", mode: "look" }, { type: "search-pick", index: 0 });
    expect(getPlayer(s, "p1").hand).toContain("ability:wisdom");
    s = edit(s, (d) => {
      gainExperience(d, getHero(d, "p1-main"), 4); // Level IV: Level III's Search, then Specialty IV
      flushQueue(d);
    });
    expect(getPlayer(s, "p1").hand).toContain("specialty:catherine:1");
    expect(s.phase).toMatchObject({ type: "search", deck: "ability" });
    expect(getPlayer(s, "p1").levelRewarded).toBe(4);
  });
});

describe("Town Actions (p. 18, 30, 36)", () => {
  it("starts the sandbox with the bronze Dwelling and the City Hall", () => {
    expect(getPlayer(fresh(), "p1").town.buildings).toEqual(["dwelling_bronze", "city_hall"]);
  });

  it("builds the Mage Guild: pays its cost, Searches the Spell Deck twice, Spell Book from next Round", () => {
    let s = edit(fresh(), (d) => {
      getPlayer(d, "p1").resources = { gold: 30, buildingMaterials: 10, valuables: 5 };
    });
    s = play(s, { type: "build", slot: "mage_guild" });
    const cost = getTown("castle").buildings[2]!.cost;
    expect(getPlayer(s, "p1").resources.gold).toBe(30 - cost.gold);
    expect(s.phase).toMatchObject({ type: "search", deck: "spell", n: 2 });
    s = play(s, { type: "search", mode: "look" }, { type: "search-pick", index: 0 });
    expect(s.phase).toMatchObject({ type: "search", deck: "spell" });
    s = play(s, { type: "search", mode: "look" }, { type: "search-pick", index: 0 });
    expect(s.phase.type).toBe("turn");
    expect(() => play(s, { type: "build", slot: "citadel" })).toThrow(/Build/);
    expect(() => play(s, { type: "spell-book" })).toThrow(IllegalAction);
  });

  it("builds Dwellings in order", () => {
    const s = edit(fresh(), (d) => {
      getPlayer(d, "p1").resources = { gold: 99, buildingMaterials: 99, valuables: 99 };
    });
    expect(() => play(s, { type: "build", slot: "dwelling_gold" })).toThrow(IllegalAction);
    expect(getPlayer(play(s, { type: "build", slot: "dwelling_silver" }), "p1").town.buildings).toContain("dwelling_silver");
  });

  it("recruits Faction units that have a Dwelling, one card per unit, and reinforces with a Citadel", () => {
    let s = edit(fresh(), (d) => {
      getPlayer(d, "p1").resources = { gold: 99, buildingMaterials: 99, valuables: 99 };
    });
    const army = getPlayer(s, "p1").army.map((u) => u.unitId);
    // Castle bronze units: Halberdiers, Marksmen, Griffins; the sandbox gives two of them.
    const missing = ["halberdiers", "marksmen", "griffins"].find((u) => !army.includes(u))!;
    expect(() => play(s, { type: "recruit", recruit: [army[0]!], reinforce: [] })).toThrow(IllegalAction);
    expect(() => play(s, { type: "recruit", recruit: ["crusaders"], reinforce: [] })).toThrow(IllegalAction);
    const few = army.findIndex((_, i) => getPlayer(s, "p1").army[i]!.variant === "few");
    expect(() => play(s, { type: "recruit", recruit: [], reinforce: [few] })).toThrow(/Citadel/);
    s = play(s, { type: "recruit", recruit: [missing], reinforce: [] });
    expect(getPlayer(s, "p1").army.at(-1)).toEqual({ unitId: missing, variant: "few" });
    expect(getPlayer(s, "p1").resources.gold).toBe(99 - getVariant(missing, "few").cost!.gold);
    // The Population Token is spent for the Round.
    expect(() => play(s, { type: "recruit", recruit: [], reinforce: [few] })).toThrow(/Population/);
  });

  it("hires a Secondary Hero in a controlled Town for 10 gold (p. 20)", () => {
    const s = fresh();
    const town = getHero(s, "p1-main").pos;
    expect(() => play(s, { type: "hire-hero", at: town })).toThrow(/Town or Settlement/); // the Main Hero stands there
    const moved = edit(s, (d) => {
      getHero(d, "p1-main").pos = { q: 99, r: 99 };
    });
    const after = play(moved, { type: "hire-hero", at: town });
    expect(after.heroes.filter((h) => h.owner === "p1")).toHaveLength(2);
    expect(getPlayer(after, "p1").resources.gold).toBe(getPlayer(s, "p1").resources.gold - 10);
  });

  it("offers the Castle City Hall choice at the start of a Resource Round", () => {
    let s = fresh();
    s = play(s, { type: "end-turn" });
    if (s.phase.type === "refresh") s = play(s, { type: "refresh", discard: [] });
    s = play(s, { type: "end-turn" }); // Round 2 (Astrologers)
    for (const pl of ["p1", "p2"]) {
      if (s.phase.type === "refresh") s = play(s, { type: "refresh", discard: [] });
      void pl;
      s = play(s, { type: "end-turn" });
    }
    // Round 3: Resource Round, City Halls ask first.
    expect(s.round).toBe(3);
    expect(s.phase).toMatchObject({ type: "choice", choice: { kind: "options", source: "city_hall" } });
  });
});

describe("Trading (p. 52)", () => {
  it("uses the trade table", () => {
    expect(TRADE_RATES.gold.buildingMaterials).toEqual({ give: 2, get: 1 });
    expect(TRADE_RATES.valuables.gold).toEqual({ give: 1, get: 3 });
  });

  it("trades only while visiting a Trading Post", () => {
    let s = fresh();
    expect(() => play(s, { type: "trade", sell: "gold", buy: "buildingMaterials", times: 1 })).toThrow(/Trading Post/);
    // Put a Trading Post (tile F10, field 1) next to the Hero.
    s = edit(s, (d) => {
      const t = d.tiles[2]!;
      t.tileId = "F10";
      t.faceUp = true;
      t.rotation = 0;
      const h = getHero(d, "p1-main");
      h.pos = fieldHex(t.center, 0, 3);
    });
    const post = fieldHex(s.tiles[2]!.center, 0, 1);
    s = play(s, { type: "move", heroId: "p1-main", to: post });
    expect(s.phase).toMatchObject({ type: "choice", choice: { source: "trading_post" } });
    s = play(s, { type: "choose", option: 0 });
    const before = getPlayer(s, "p1").resources;
    s = play(s, { type: "trade", sell: "gold", buy: "buildingMaterials", times: 2 });
    expect(getPlayer(s, "p1").resources).toMatchObject({
      gold: before.gold - 4,
      buildingMaterials: before.buildingMaterials + 2,
    });
  });
});

describe("Playing cards (p. 22–27)", () => {
  it("reads card texts into effects", () => {
    expect(parseEffects(":instant: +1 :attack:\nThen draw 1 card.")).toEqual([
      { kind: "attack", n: 1 },
      { kind: "draw", n: 1 },
    ]);
    expect(cardInfo("spell:lightning_bolt").options.map((o) => [o.power, o.effects])).toEqual([
      [0, [{ kind: "damage", n: 2 }]],
      [1, [{ kind: "damage", n: 3 }]],
      [2, [{ kind: "damage", n: 4 }]],
    ]);
    // Cards the engine cannot read are left to the players.
    expect(cardInfo("ability:diplomacy").options[0]!.effects).toBeNull();
  });

  it("plays Estates on the map for 3 gold; its Expert effect needs Level II", () => {
    const s = edit(fresh(), (d) => {
      getPlayer(d, "p1").hand = ["ability:estates", "ability:estates"];
    });
    const gold = getPlayer(s, "p1").resources.gold;
    const after = play(s, { type: "play-card", player: "p1", handIndex: 0, option: 0 });
    expect(getPlayer(after, "p1").resources.gold).toBe(gold + 3);
    expect(getPlayer(after, "p1").discard).toContain("ability:estates");
    expect(() => play(s, { type: "play-card", player: "p1", handIndex: 0, option: 1 })).toThrow(/Expert/);
  });

  it("does not play Activation Spells on the map", () => {
    const s = edit(fresh(), (d) => {
      getPlayer(d, "p1").hand = ["spell:magic_arrow"];
    });
    expect(() => play(s, { type: "play-card", player: "p1", handIndex: 0, option: 0 })).toThrow(/Combat/);
  });

  it("casts Magic Arrow on an enemy when activating a unit, empowered by a Power card", () => {
    let s = edit(fresh(), (d) => {
      d.decks.spell.deck = [];
      const p = getPlayer(d, "p1");
      p.hand = ["spell:magic_arrow", "stat:power", "spell:magic_arrow"];
      // A neutral fight with a single bronze unit.
      d.phase = {
        type: "combat-setup",
        context: {
          attackerHero: "p1-main",
          foe: { kind: "neutral", hex: { q: 50, r: 50 }, difficulty: 1, units: [{ unitId: "boars", tier: "bronze", variant: "neutral", card: false }] },
          picks: {},
          placements: {},
        },
        side: "attacker",
      };
    });
    s = play(s, { type: "combat-setup", picks: [{ armyIndex: 0, line: "front" }] });
    expect(s.phase.type).toBe("combat");
    const combat = () => (s.phase.type === "combat" ? s.phase.combat : null)!;
    // Wait for one of our own activations.
    while (activeUnit(combat())?.side !== "attacker") {
      const u = activeUnit(combat())!;
      s = play(s, { type: "combat", action: { type: "end-activation", uid: u.uid } });
    }
    const boar = combat().units.find((u) => u.side === "defender")!;
    // 2 damage needs 1 Power: the Power Statistic card pays it.
    expect(() => play(s, { type: "play-card", player: "p1", handIndex: 0, option: 1, target: boar.uid })).toThrow(/Power/);
    s = play(s, { type: "play-card", player: "p1", handIndex: 0, option: 1, target: boar.uid, empower: [{ handIndex: 1, option: 0 }] });
    expect(combat().units.find((u) => u.uid === boar.uid)?.damage).toBe(2);
    // Only one Spell per Combat Round.
    expect(() => play(s, { type: "play-card", player: "p1", handIndex: 0, option: 0, target: boar.uid })).toThrow(/one Spell/);
  });
});
