import { describe, expect, it } from "vitest";
import { applyAdventureAction } from "./engine.ts";
import { botAction } from "./bot.ts";
import { mayAct, playersToAct, replay, RECORD_VERSION, type GameRecord } from "./net.ts";
import { setupAdventure, type AdventureSetup } from "./scenario.ts";

describe("computer players", () => {
  it("plays a whole Clash between two computer players on its own", () => {
    const state = setupAdventure({
      layout: "hunt-2",
      players: [
        { name: "A", faction: "castle", computer: true },
        { name: "B", faction: "necropolis", computer: true },
      ],
      seed: 5,
    });
    expect(state.phase.type).toBe("over");
    expect(state.round).toBe(state.maxRounds);
    const flags = Object.values(state.marks).filter((m) => m.flag).length;
    const built = state.players.reduce((n, p) => n + p.town.buildings.length, 0);
    const fights = state.log.filter((e) => e.type === "combat-end").length;
    // The bots expand: flags beyond their Towns, buildings beyond the starting two each, some fights.
    expect(flags).toBeGreaterThan(4);
    expect(built).toBeGreaterThan(4);
    expect(fights).toBeGreaterThan(0);
  });

  it("answers a human player in a solo game, and the record replays", () => {
    const setup: AdventureSetup = {
      layout: "hunt-2",
      players: [
        { name: "Human", faction: "rampart" },
        { name: "CPU", faction: "inferno", computer: true },
      ],
      seed: 9,
    };
    let state = setupAdventure(setup);
    expect(state.ai.neutrals).toBe(true);
    const record: GameRecord = { v: RECORD_VERSION, setup, actions: [] };
    for (let i = 0; i < 3000 && state.phase.type !== "over"; i++) {
      // Whatever waits for input now must be the human.
      expect(playersToAct(state)).toEqual(["p1"]);
      const action = botAction(state, "p1")!;
      expect(mayAct(state, action, ["p1"])).toBe(true);
      state = applyAdventureAction(state, action);
      record.actions.push(action);
    }
    expect(state.phase.type).toBe("over");
    expect(replay(record)).toEqual(state);
  });
});
