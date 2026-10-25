import { describe, expect, it } from "vitest";
import { AI_CARDS, aiHeroTurnAction, aiMod, buildAiDeck } from "./aihero.ts";
import { botAction } from "./bot.ts";
import { applyAdventureAction, getHero } from "./engine.ts";
import { hexKey, hexNeighbors } from "./hex.ts";
import { fieldAt } from "./core.ts";
import { replay, RECORD_VERSION, type GameRecord } from "./net.ts";
import { setupAdventure, type AdventureSetup } from "./scenario.ts";
import type { AdventureState } from "./types.ts";

const SOLO: AdventureSetup = {
  layout: "hunt-2",
  players: [
    { name: "Kevin", faction: "castle" },
    { name: "Sandro", faction: "necropolis", aiHero: { deck: { might: 4, magic: 2, skill: 0 }, spells: ["magic_arrow", "fireball"] } },
  ],
  seed: 21,
};

/** Gets the human through the start-of-game steps until the AI Hero's first Turn is played. */
function humanEndsTurn(state: AdventureState): AdventureState {
  let s = state;
  for (let i = 0; i < 20 && !(s.phase.type === "turn" && s.current === 0); i++) s = applyAdventureAction(s, botAction(s, "p1")!);
  return applyAdventureAction(s, { type: "end-turn" });
}

describe("AI Decks (p. 50)", () => {
  it("builds the AI Deck from the Scenario's card counts", () => {
    const [ai] = buildAiDeck({ deck: { might: 3, magic: 2, skill: 1 }, spells: ["fireball"] }, { kind: "seeded", seed: 3 });
    const types = ai.deck.map((c) => AI_CARDS[c].type).sort();
    expect(types).toEqual(["magic", "magic", "might", "might", "might", "skill"]);
    expect(ai.spells.deck).toEqual(["spell:fireball"]);
  });

  it("scales AI cards with the Difficulty (wiki AI table)", () => {
    expect([aiMod("attack-1", "easy"), aiMod("attack-1", "normal"), aiMod("attack-1", "hard"), aiMod("attack-1", "impossible")]).toEqual([0, 1, 1, 2]);
    expect(aiMod("spell-2", "impossible")).toBe(3);
  });
});

describe("AI Heroes (p. 49)", () => {
  it("have no Resources or Town Board and take their Turn after the player", () => {
    const s = setupAdventure(SOLO);
    const ai = s.players[1]!;
    expect(ai.resources).toEqual({ gold: 0, buildingMaterials: 0, valuables: 0 });
    expect(ai.town.buildings).toEqual([]);
    expect(s.ai.heroes.p2).toBeDefined();
    expect(s.current).toBe(0);
  });

  it("head for a Mine on their Tile, beat its guards without fighting and flag it", () => {
    const s = humanEndsTurn(setupAdventure(SOLO));
    const flagged = s.log.filter((e) => e.type === "flag" && e.player === "p2");
    expect(flagged.length).toBeGreaterThan(0);
    expect(s.log.some((e) => e.type === "combat-start" && e.heroId === "p2-main")).toBe(false);
    expect(s.players[1]!.resources.gold).toBe(0); // no benefits from Fields
  });

  it("go for a player's Hero on the same Tile first", () => {
    let s = setupAdventure(SOLO);
    const ai = getHero(s, "p2-main");
    const next = hexNeighbors(ai.pos).find((h) => fieldAt(s, h)?.field.location === "empty_field")!;
    s = structuredClone(s);
    getHero(s, "p1-main").pos = next;
    s.current = 1;
    s.phase = { type: "turn" };
    expect(aiHeroTurnAction(s, "p2")).toEqual({ type: "ai-move", heroId: "p2-main", to: next });
    expect(hexKey(next)).not.toBe(hexKey(ai.pos));
  });

  it("plays a whole solo game against an AI Hero, and the record replays", () => {
    let state = setupAdventure(SOLO);
    const record: GameRecord = { v: RECORD_VERSION, setup: SOLO, actions: [] };
    for (let i = 0; i < 3000 && state.phase.type !== "over"; i++) {
      const action = botAction(state, "p1")!;
      state = applyAdventureAction(state, action);
      record.actions.push(action);
    }
    expect(state.phase.type).toBe("over");
    expect(state.log.filter((e) => e.type === "move" && e.heroId === "p2-main").length).toBeGreaterThan(5);
    expect(replay(record)).toEqual(state);
  });
});
