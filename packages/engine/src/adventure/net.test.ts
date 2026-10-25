import { describe, expect, it } from "vitest";
import { applyAdventureAction } from "./engine.ts";
import { botAction } from "./bot.ts";
import { mayAct, playersToAct, replay, RECORD_VERSION, type GameRecord } from "./net.ts";
import { setupAdventure, type AdventureSetup } from "./scenario.ts";

const SETUP: AdventureSetup = {
  layout: "hunt-2",
  players: [
    { name: "Alice", faction: "castle" },
    { name: "Bob", faction: "necropolis" },
  ],
  seed: 11,
};

describe("game records", () => {
  it("replays a whole bot game from setup + actions", () => {
    let state = setupAdventure(SETUP);
    const record: GameRecord = { v: RECORD_VERSION, setup: SETUP, actions: [] };
    for (let i = 0; i < 3000 && state.phase.type !== "over"; i++) {
      const action = botAction(state)!;
      expect(mayAct(state, action, playersToAct(state))).toBe(true);
      state = applyAdventureAction(state, action);
      record.actions.push(action);
    }
    expect(state.phase.type).toBe("over");
    expect(replay(JSON.parse(JSON.stringify(record)))).toEqual(state);
  });

  it("only lets the acting player send turn actions", () => {
    const state = setupAdventure(SETUP);
    const [who] = playersToAct(state);
    const other = state.players.find((p) => p.id !== who)!.id;
    const action = botAction(state)!;
    expect(mayAct(state, action, [who!])).toBe(true);
    expect(mayAct(state, action, [other])).toBe(false);
  });
});
