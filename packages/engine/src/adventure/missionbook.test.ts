import { describe, expect, it } from "vitest";
import { FACTIONS, getScenario, maps, scenarios } from "@heroes/data";
import { layoutOf, playableMaps, seatFactions, setupAdventure } from "./scenario.ts";
import { fieldAt } from "./core.ts";
import { defaultAiHero } from "./aihero.ts";
import { applyAdventureAction } from "./engine.ts";

/** Seats with the Factions the map imposes, the others filled with unused Factions. */
function seats(mapId: string) {
  const imposed = seatFactions(mapId);
  const free = FACTIONS.filter((f) => !imposed.includes(f));
  return imposed.map((f, i) => ({ name: `P${i + 1}`, faction: f ?? free.shift()! }));
}

describe("fan Mission Book", () => {
  it("imports every Scenario with English and French text", () => {
    expect(scenarios.length).toBeGreaterThanOrEqual(20);
    for (const s of scenarios) {
      expect(s.title.fr.length).toBeGreaterThan(0);
      expect(s.text.en.length).toBeGreaterThan(2);
      expect(s.text.fr.length).toBeGreaterThan(2);
    }
    const hunt = getScenario("the_hunt");
    expect(hunt.title.fr).toBe("La Chasse");
    expect(hunt.maxRounds).toBe(14);
    expect(hunt.resources).toEqual({ gold: 15, buildingMaterials: 4, valuables: 2 });
    expect(hunt.timedEvents.en[0]!.rounds).toEqual([4, 8, 12]);
  });

  it("sets up every playable map", () => {
    const ids = playableMaps();
    // Mystical Foreland needs subterranean and water tiles; "Controlled Chaos center" is a piece of a random map.
    expect(ids.length).toBe(maps.length - 2);
    for (const id of ids) {
      const state = setupAdventure({ layout: id, players: seats(id), seed: 1, neutralAI: true });
      const layout = layoutOf(id)!;
      expect(state.tiles.length).toBe(layout.length);
      // Every Main Hero starts on its own Town.
      for (const h of state.heroes) expect(fieldAt(state, h.pos)?.field.location).toBe("town");
    }
  });

  it("applies a Scenario's length, resources and income", () => {
    const state = setupAdventure({
      layout: "bloody_grail_2p",
      scenario: "bloody_grail",
      players: [
        { name: "A", faction: "castle" },
        { name: "B", faction: "rampart" },
      ],
      seed: 4,
    });
    const sc = getScenario("bloody_grail");
    expect(state.maxRounds).toBe(sc.maxRounds);
    expect(state.players[0]!.resources.gold).toBe(sc.resources!.gold);
    expect(state.players[0]!.production.gold).toBe(sc.income!.gold);
  });

  it("keeps a campaign map's fixed tiles", () => {
    const id = "inferno_steadwicks_fall";
    const state = setupAdventure({ layout: id, players: seats(id), seed: 2, neutralAI: true });
    const fixed = layoutOf(id)!.filter((s) => s.tile && s.group !== "starting").map((s) => s.tile);
    for (const t of fixed) expect(state.tiles.some((x) => x.tileId === t)).toBe(true);
  });

  it("lets the player hold any seat of a campaign map, AI Heroes playing last (p. 49)", () => {
    // A Devilish Plan: the Rampart Starting Tile (enemy) comes first on the map, Inferno second.
    const state = setupAdventure({
      layout: "inferno_devilish_plan",
      scenario: "inferno_devilish_plan",
      players: [
        { name: "Ivor", faction: "rampart", aiHero: defaultAiHero("rampart") },
        { name: "Kevin", faction: "inferno" },
      ],
      seed: 3,
    });
    expect(state.players.map((p) => p.faction)).toEqual(["inferno", "rampart"]);
    expect(Object.keys(state.ai.heroes)).toEqual([state.players[1]!.id]);
    expect(state.scenarioId).toBe("inferno_devilish_plan");
  });

  it("records a declared victory for the end of the Round", () => {
    const id = "the_hunt_2";
    let state = setupAdventure({ layout: id, scenario: "the_hunt", players: seats(id), seed: 5, difficulty: "impossible" });
    state = applyAdventureAction(state, { type: "declare-victory", player: "p1" });
    expect(state.victoryPending).toContain("p1");
  });
});
