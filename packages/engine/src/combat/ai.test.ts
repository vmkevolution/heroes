import { describe, expect, it } from "vitest";
import { aiUnitAction, targetRank } from "./ai.ts";
import { createCombat, getUnitByUid } from "./engine.ts";
import type { CombatState, Placement } from "./types.ts";

function combat(attacker: Placement[], defender: Placement[]): CombatState {
  return createCombat({ attacker, defender, rng: { kind: "seeded", seed: 1 }, options: { neutralSide: "defender" } });
}

function moveTo(state: CombatState, uid: string, col: number, row: number): CombatState {
  const next = structuredClone(state);
  getUnitByUid(next, uid).pos = { col, row };
  return next;
}

describe("Combat against AI (p. 48)", () => {
  it("a Silver unit attacks Silver before Bronze", () => {
    let s = combat(
      [
        { unitId: "dwarves", variant: "few", pos: { col: 0, row: 1 } },
        { unitId: "crusaders", variant: "few", pos: { col: 2, row: 1 } },
      ],
      [{ unitId: "genies", variant: "neutral", pos: { col: 1, row: 3 } }],
    );
    s = moveTo(moveTo(s, "a1-dwarves", 0, 3), "a2-crusaders", 2, 3);
    expect(s.phase).toMatchObject({ type: "activation", uid: "d1-genies" });
    expect(aiUnitAction(s, "d1-genies")).toEqual({ type: "attack", uid: "d1-genies", targetUid: "a2-crusaders" });
  });

  it("Ranged units shoot enemy Ranged units first, whatever their tier", () => {
    const s = combat(
      [
        { unitId: "champions", variant: "few", pos: { col: 0, row: 1 } },
        { unitId: "elves", variant: "few", pos: { col: 3, row: 0 } },
      ],
      [{ unitId: "cyclopes", variant: "neutral", pos: { col: 1, row: 4 } }],
    );
    const cyclopes = getUnitByUid(s, "d1-cyclopes");
    expect(targetRank(cyclopes, getUnitByUid(s, "a2-elves"))).toBeLessThan(targetRank(cyclopes, getUnitByUid(s, "a1-champions")));
    expect(aiUnitAction(s, "d1-cyclopes")).toEqual({ type: "attack", uid: "d1-cyclopes", targetUid: "a2-elves" });
  });

  it("moves next to the preferred target it can reach, and closes in when none is in reach", () => {
    const s = combat(
      [
        { unitId: "dwarves", variant: "few", pos: { col: 0, row: 1 } },
        { unitId: "crusaders", variant: "few", pos: { col: 3, row: 1 } },
      ],
      [{ unitId: "genies", variant: "neutral", pos: { col: 3, row: 3 } }],
    );
    // Genies (Silver, Initiative 9) reach the Crusaders (Silver) rather than the Dwarves (Bronze).
    expect(s.phase).toMatchObject({ type: "activation", uid: "d1-genies" });
    expect(aiUnitAction(s, "d1-genies")).toEqual({ type: "move", uid: "d1-genies", to: { col: 3, row: 2 } });
    // Far away, they step towards the Crusaders.
    const far = moveTo(s, "a2-crusaders", 0, 0);
    const action = aiUnitAction(moveTo(far, "a1-dwarves", 3, 0), "d1-genies");
    expect(action.type).toBe("move");
  });
});
