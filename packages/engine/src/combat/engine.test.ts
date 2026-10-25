import { describe, expect, it } from "vitest";
import {
  applyCombatAction,
  createCombat,
  dealEffectDamage,
  getUnitByUid,
  IllegalAction,
  legalMoves,
  legalTargets,
  waitingFor,
} from "./engine.ts";
import type { CombatAction, CombatSetup, CombatState } from "./types.ts";

const scripted = (...values: number[]) => ({ kind: "scripted" as const, values });

function play(state: CombatState, ...actions: CombatAction[]): CombatState {
  return actions.reduce(applyCombatAction, state);
}

/** Test helper: puts a unit on any space, skipping setup rules, to build mid-combat positions. */
function place(state: CombatState, uid: string, pos: { col: number; row: number }): CombatState {
  const next = structuredClone(state);
  getUnitByUid(next, uid).pos = pos;
  return next;
}

function activeUid(state: CombatState): string {
  if (state.phase.type !== "activation") throw new Error(`expected an activation, got ${state.phase.type}`);
  return state.phase.uid;
}

describe("rule book examples", () => {
  it("Zombies attack Griffins, both play cards, Griffins retaliate without limit (p. 45)", () => {
    const setup: CombatSetup = {
      attacker: [{ unitId: "zombies", variant: "few", pos: { col: 1, row: 1 } }],
      defender: [{ unitId: "griffins", variant: "pack", pos: { col: 1, row: 3 } }],
      rng: scripted(1, 0),
    };
    let s = createCombat(setup);
    // Griffins (Initiative 9) act first and wait.
    expect(activeUid(s)).toBe("d1-griffins");
    s = play(s, { type: "end-activation", uid: "d1-griffins" });
    expect(activeUid(s)).toBe("a1-zombies");
    s = play(
      s,
      { type: "move", uid: "a1-zombies", to: { col: 1, row: 2 } },
      { type: "attack", uid: "a1-zombies", targetUid: "d1-griffins" },
    );
    expect(s.phase.type).toBe("reaction");
    s = play(
      s,
      { type: "modify", side: "attacker", stat: "attack", amount: 1, source: "Attack" },
      { type: "modify", side: "defender", stat: "defense", amount: 1, source: "Defense" },
      { type: "pass", side: "attacker" },
      { type: "pass", side: "defender" },
    );
    // 2 + 1 (card) + 1 (die) − (0 + 1) = 3 damage; the Pack has 4 HP and is not flipped.
    const griffins = getUnitByUid(s, "d1-griffins");
    expect(griffins).toMatchObject({ variant: "pack", damage: 3 });
    // The Retaliation opens a fresh card window; earlier cards no longer apply.
    expect(s.phase.type).toBe("reaction");
    s = play(s, { type: "pass", side: "attacker" }, { type: "pass", side: "defender" });
    // 3 + 0 − 1 = 2 damage on Few Zombies (3 HP).
    expect(getUnitByUid(s, "a1-zombies").damage).toBe(2);
    // Unlimited Retaliation: no Black Cube on the Griffins.
    expect(getUnitByUid(s, "d1-griffins").retaliated).toBe(false);
  });

  it("Magic Arrow for 3 on a Pack of Skeletons leaves Few Skeletons with 1 damage (p. 39)", () => {
    let s = createCombat({
      attacker: [{ unitId: "griffins", variant: "few", pos: { col: 0, row: 0 } }],
      defender: [{ unitId: "skeletons", variant: "pack", pos: { col: 0, row: 4 } }],
      rng: scripted(),
    });
    s = dealEffectDamage(s, "d1-skeletons", 3);
    expect(getUnitByUid(s, "d1-skeletons")).toMatchObject({ variant: "few", damage: 1 });
  });
});

describe("initiative order", () => {
  it("alternates between sides on a tie, attacker first (p. 43)", () => {
    let s = createCombat({
      attacker: [
        { unitId: "skeletons", variant: "pack", pos: { col: 0, row: 0 } },
        { unitId: "skeletons", variant: "pack", pos: { col: 1, row: 0 } },
      ],
      defender: [
        { unitId: "skeletons", variant: "pack", pos: { col: 0, row: 4 } },
        { unitId: "skeletons", variant: "pack", pos: { col: 1, row: 4 } },
      ],
      rng: scripted(),
    });
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
      const uid = activeUid(s);
      order.push(uid);
      s = play(s, { type: "end-activation", uid });
    }
    expect(order).toEqual(["a1-skeletons", "d1-skeletons", "a2-skeletons", "d2-skeletons"]);
    expect(s.round).toBe(2);
  });
});

describe("movement", () => {
  it("ground units go around obstacles, flying units ignore them", () => {
    const s = createCombat({
      attacker: [
        { unitId: "zombies", variant: "few", pos: { col: 0, row: 1 } },
        { unitId: "griffins", variant: "few", pos: { col: 3, row: 1 } },
      ],
      defender: [{ unitId: "zombies", variant: "few", pos: { col: 3, row: 4 } }],
      obstacles: [
        { col: 0, row: 2 },
        { col: 1, row: 2 },
        { col: 2, row: 2 },
        { col: 3, row: 2 },
      ],
      rng: scripted(),
    });
    expect(activeUid(s)).toBe("a2-griffins");
    expect(legalMoves(s, "a2-griffins")).toContainEqual({ col: 3, row: 3 });
    const afterGriffins = applyCombatAction(s, { type: "end-activation", uid: "a2-griffins" });
    expect(activeUid(afterGriffins)).toBe("a1-zombies");
    expect(legalMoves(afterGriffins, "a1-zombies").every((p) => p.row < 2)).toBe(true);
  });
});

describe("ranged units", () => {
  it("must shoot an adjacent enemy, with the two-dice penalty (p. 38)", () => {
    let s = createCombat({
      attacker: [{ unitId: "marksmen", variant: "pack", pos: { col: 1, row: 1 } }],
      defender: [
        { unitId: "zombies", variant: "few", pos: { col: 3, row: 4 } },
        { unitId: "halberdiers", variant: "few", pos: { col: 1, row: 3 } },
      ],
      rng: scripted(1, -1, 0),
      options: { reactions: false },
    });
    // Marksmen Pack (Initiative 6) act first; the Halberdiers then step next to them.
    expect(activeUid(s)).toBe("a1-marksmen");
    s = play(s, { type: "end-activation", uid: "a1-marksmen" });
    s = play(s, { type: "move", uid: "d2-halberdiers", to: { col: 1, row: 2 } }, { type: "end-activation", uid: "d2-halberdiers" });
    s = play(s, { type: "end-activation", uid: "d1-zombies" });
    expect(legalTargets(s, "a1-marksmen")).toEqual(["d2-halberdiers"]);
    s = play(s, { type: "attack", uid: "a1-marksmen", targetUid: "d2-halberdiers" });
    const attack = s.log.find((e) => e.type === "attack");
    expect(attack).toMatchObject({ rolls: [1, -1], roll: -1, attack: 1, defense: 1, damage: 0 });
  });

  it("may move one space after shooting", () => {
    let s = createCombat({
      attacker: [{ unitId: "marksmen", variant: "pack", pos: { col: 1, row: 1 } }],
      defender: [{ unitId: "zombies", variant: "few", pos: { col: 3, row: 3 } }],
      rng: scripted(1),
      options: { reactions: false },
    });
    s = play(s, { type: "attack", uid: "a1-marksmen", targetUid: "d1-zombies" });
    expect(s.phase).toMatchObject({ type: "activation", uid: "a1-marksmen", attacked: true });
    s = play(s, { type: "move", uid: "a1-marksmen", to: { col: 1, row: 0 } });
    expect(activeUid(s)).toBe("d1-zombies");
  });
});

describe("retaliation and defense", () => {
  it("a normal unit retaliates once per Combat Round", () => {
    let s = createCombat({
      attacker: [
        { unitId: "skeletons", variant: "pack", pos: { col: 1, row: 1 } },
        { unitId: "skeletons", variant: "pack", pos: { col: 2, row: 0 } },
      ],
      defender: [{ unitId: "halberdiers", variant: "pack", pos: { col: 1, row: 3 } }],
      rng: scripted(-1, -1, -1, -1),
      options: { reactions: false },
    });
    s = place(place(s, "d1-halberdiers", { col: 1, row: 2 }), "a2-skeletons", { col: 2, row: 2 });
    s = play(s, { type: "attack", uid: activeUid(s), targetUid: "d1-halberdiers" });
    expect(getUnitByUid(s, "d1-halberdiers").retaliated).toBe(true);
    const attacksBefore = s.log.filter((e) => e.type === "attack").length;
    // Halberdiers act next (tie at 5, defender's turn), then the second Skeletons attack.
    s = play(s, { type: "end-activation", uid: activeUid(s) });
    s = play(s, { type: "attack", uid: activeUid(s), targetUid: "d1-halberdiers" });
    expect(s.log.filter((e) => e.type === "attack").length).toBe(attacksBefore + 1);
  });

  it("a Defense Token adds 1 Defense on a +1 roll and is discarded on the next activation", () => {
    let s = createCombat({
      attacker: [{ unitId: "griffins", variant: "pack", pos: { col: 1, row: 1 } }],
      defender: [{ unitId: "halberdiers", variant: "pack", pos: { col: 1, row: 3 } }],
      rng: scripted(0, 1, 0),
      options: { reactions: false },
    });
    s = place(s, "d1-halberdiers", { col: 1, row: 2 });
    // Halberdiers defend in round 1 after the Griffins wait.
    s = play(s, { type: "end-activation", uid: "a1-griffins" }, { type: "defend", uid: "d1-halberdiers" });
    expect(getUnitByUid(s, "d1-halberdiers").defending).toBe(true);
    s = play(s, { type: "attack", uid: "a1-griffins", targetUid: "d1-halberdiers" });
    const attack = s.log.find((e) => e.type === "attack");
    expect(attack).toMatchObject({ roll: 0, defenseRoll: 1, attack: 3, defense: 2, damage: 1 });
  });
});

describe("neutral combat", () => {
  const setup: CombatSetup = {
    attacker: [{ unitId: "griffins", variant: "few", pos: { col: 0, row: 0 } }],
    defender: [{ unitId: "skeletons", variant: "neutral", pos: { col: 3, row: 4 } }],
    rng: scripted(),
    options: { neutralSide: "defender" },
  };

  it("stops after one round so the player can retreat (p. 43)", () => {
    let s = createCombat(setup);
    s = play(s, { type: "end-activation", uid: "a1-griffins" }, { type: "end-activation", uid: "d1-skeletons" });
    expect(s.phase.type).toBe("round-end");
    expect(waitingFor(s)).toEqual(["attacker"]);
    s = play(s, { type: "retreat" });
    expect(s.phase).toMatchObject({ type: "over", winner: null, reason: "retreat" });
  });

  it("neutral units cannot defend", () => {
    let s = createCombat(setup);
    s = play(s, { type: "end-activation", uid: "a1-griffins" });
    expect(() => play(s, { type: "defend", uid: "d1-skeletons" })).toThrow(IllegalAction);
  });
});

describe("purity", () => {
  it("never mutates the previous state", () => {
    const s0 = createCombat({
      attacker: [{ unitId: "griffins", variant: "pack", pos: { col: 1, row: 1 } }],
      defender: [{ unitId: "halberdiers", variant: "pack", pos: { col: 1, row: 3 } }],
      rng: { kind: "seeded", seed: 42 },
    });
    const s = place(s0, "d1-halberdiers", { col: 1, row: 2 });
    const snapshot = JSON.stringify(s);
    applyCombatAction(s, { type: "attack", uid: "a1-griffins", targetUid: "d1-halberdiers" });
    expect(JSON.stringify(s)).toBe(snapshot);
  });
});
