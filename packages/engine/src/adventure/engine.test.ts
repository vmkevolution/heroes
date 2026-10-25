import { describe, expect, it } from "vitest";
import { getTile } from "@heroes/data";
import { legalMoves as combatMoves, legalTargets, waitingFor } from "../combat/engine.ts";
import type { CombatAction } from "../combat/types.ts";
import {
  applyAdventureAction,
  discoverableTiles,
  fieldAt,
  getHero,
  getPlayer,
  IllegalAction,
  legalMoves,
  levelFor,
  marksAt,
  placementSlots,
} from "./engine.ts";
import { areAdjacent, editorCellToHex, fieldHex, hexDistance, hexKey, rotateHex, SNUG_OFFSETS, subHex } from "./hex.ts";
import { LAYOUTS, sandboxArmy, setupAdventure } from "./scenario.ts";
import type { AdventureAction, AdventureState } from "./types.ts";
import type { Hex } from "./hex.ts";

const newGame = (seed = 7) =>
  setupAdventure({
    layout: "hunt-2",
    players: [
      { name: "Alice", faction: "castle" },
      { name: "Bob", faction: "necropolis" },
    ],
    seed,
  });

function play(state: AdventureState, ...actions: AdventureAction[]): AdventureState {
  return actions.reduce(applyAdventureAction, state);
}

/** Test helper: replaces a layout slot by a known face-up tile and returns its field positions. */
function withTile(state: AdventureState, slot: number, tileId: string, rotation = 0): [AdventureState, Hex[]] {
  const next = structuredClone(state);
  const t = next.tiles[slot]!;
  t.tileId = tileId;
  t.faceUp = true;
  t.rotation = rotation;
  return [next, Array.from({ length: 7 }, (_, i) => fieldHex(t.center, rotation, i))];
}

function teleport(state: AdventureState, heroId: string, hex: Hex): AdventureState {
  const next = structuredClone(state);
  const h = getHero(next, heroId);
  h.pos = hex;
  h.lastVisited = hex;
  return next;
}

/** Plays a combat to the end: attack when possible, otherwise step forward, pass every reaction. */
function autoplay(state: AdventureState, onRoundEnd: "continue" | "retreat" = "continue"): AdventureState {
  let s = state;
  for (let guard = 0; guard < 500 && s.phase.type === "combat"; guard++) {
    const c = s.phase.combat;
    const ph = c.phase;
    let action: CombatAction;
    if (ph.type === "reaction") action = { type: "pass", side: waitingFor(c)[0]! };
    else if (ph.type === "round-end") action = { type: onRoundEnd };
    else if (ph.type === "activation") {
      const targets = legalTargets(c, ph.uid);
      const moves = combatMoves(c, ph.uid);
      const unit = c.units.find((u) => u.uid === ph.uid)!;
      const forward = unit.side === "attacker" ? 1 : -1;
      const step = moves.sort((a, b) => forward * (b.row - a.row))[0];
      if (targets[0]) action = { type: "attack", uid: ph.uid, targetUid: targets[0] };
      else if (step && !ph.moved) action = { type: "move", uid: ph.uid, to: step };
      else action = { type: "end-activation", uid: ph.uid };
    } else break;
    s = applyAdventureAction(s, { type: "combat", action });
  }
  return s;
}

describe("map geometry", () => {
  it("turns fields clockwise around the tile center", () => {
    expect(rotateHex({ q: 1, r: 0 }, 1)).toEqual({ q: 0, r: 1 });
    expect(rotateHex({ q: 1, r: 0 }, 6)).toEqual({ q: 1, r: 0 });
  });

  it("reads the Mission Book layouts as interlocking tiles", () => {
    for (const layout of Object.values(LAYOUTS)) {
      const centers = layout.map((s) => editorCellToHex(s.row, s.col));
      for (const c of centers) {
        // Every tile touches another one snugly, and no two tiles overlap.
        expect(centers.some((o) => o !== c && SNUG_OFFSETS.some((s) => hexKey(s) === hexKey(subHex(o, c))))).toBe(true);
        for (const o of centers) if (o !== c) expect(hexDistance(o, c)).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("setup", () => {
  it("places each player's Starting Tile face up with the Main Hero on the flagged Town (p. 12–13)", () => {
    const s = newGame();
    expect(s.tiles).toHaveLength(7);
    expect(s.tiles.filter((t) => t.faceUp).map((t) => t.tileId)).toEqual(["S3", "S1"]);
    const hero = getHero(s, "p1-main");
    expect(fieldAt(s, hero.pos)!.field.location).toBe("town");
    expect(marksAt(s, hero.pos).flag).toBe("p1");
    expect(hero.mp).toBe(3);
  });

  it("gives the sandbox Clash units: a Pack of the cheapest and a Few of the dearest bronze unit", () => {
    expect(sandboxArmy("castle")).toEqual([
      { unitId: "halberdiers", variant: "pack" },
      { unitId: "griffins", variant: "few" },
    ]);
    const s = newGame();
    expect(getPlayer(s, "p1").resources).toEqual({ gold: 15, buildingMaterials: 4, valuables: 2 });
    expect(getPlayer(s, "p1").tileSupply).toHaveLength(1);
  });

  it("is deterministic for a seed", () => {
    expect(newGame(3).tiles).toEqual(newGame(3).tiles);
  });
});

describe("movement", () => {
  it("moves 1 Field per MP, never onto Blocked Fields or face-down tiles (p. 17, 31)", () => {
    const s = newGame();
    const hero = getHero(s, "p1-main");
    const moves = legalMoves(s, hero.id);
    for (const m of moves) {
      expect(areAdjacent(m, hero.pos)).toBe(true);
      const info = fieldAt(s, m)!;
      expect(info.tile.faceUp).toBe(true);
      expect(info.field.location).not.toBe("blocked_field");
    }
    const after = play(s, { type: "move", heroId: hero.id, to: moves[0]! });
    expect(getHero(after, hero.id).mp).toBe(2);
  });

  it("refuses moves outside the player's Turn", () => {
    const s = newGame();
    const bob = getHero(s, "p2-main");
    expect(legalMoves(s, bob.id)).toEqual([]);
  });

  it("gains a Water Wheel's gold once, then treats it as an Empty Field (p. 32, 74)", () => {
    const [base, f] = withTile(newGame(), 2, "F4");
    let s = teleport(base, "p1-main", f[5]!); // the Temple
    s = play(s, { type: "move", heroId: "p1-main", to: f[2]! });
    expect(getPlayer(s, "p1").resources.gold).toBe(18);
    expect(marksAt(s, f[2]!).blackCube).toBe(true);
    s = play(s, { type: "move", heroId: "p1-main", to: f[5]! }, { type: "move", heroId: "p1-main", to: f[2]! });
    expect(getPlayer(s, "p1").resources.gold).toBe(18);
  });

  it("gives Stables' extra MP for this Turn only (p. 78)", () => {
    const [base, f] = withTile(newGame(), 2, "F3");
    const stables = getTile("F3").fields.findIndex((x) => x.location === "stables");
    expect(stables).toBeGreaterThanOrEqual(0);
    const from = f.find((h, i) => i !== stables && areAdjacent(h, f[stables]!) && getTile("F3").fields[i]!.location !== "blocked_field")!;
    let s = teleport(base, "p1-main", from);
    s = play(s, { type: "move", heroId: "p1-main", to: f[stables]! });
    expect(getHero(s, "p1-main").bonusMp).toBe(1);
    s = play(s, { type: "end-turn" });
    expect(getHero(s, "p1-main").bonusMp).toBe(0);
  });
});

describe("tiles", () => {
  it("discovers an adjacent face-down tile for 1 MP, in the chosen rotation (p. 32)", () => {
    let s = newGame();
    const startTile = s.tiles[0]!;
    // Walk next to a face-down tile: pick any start field that touches one.
    const edge = Array.from({ length: 7 }, (_, i) => fieldHex(startTile.center, 0, i)).find((h) => {
      const t = teleport(s, "p1-main", h);
      return discoverableTiles(t, "p1-main").length > 0 && fieldAt(t, h)!.field.location !== "blocked_field";
    })!;
    s = teleport(s, "p1-main", edge);
    const target = discoverableTiles(s, "p1-main")[0]!;
    s = play(s, { type: "discover", heroId: "p1-main", center: target.center, rotation: 2 });
    const t = s.tiles.find((x) => hexKey(x.center) === hexKey(target.center))!;
    expect(t.faceUp).toBe(true);
    expect(t.rotation).toBe(2);
    expect(getHero(s, "p1-main").mp).toBe(2);
  });

  it("only offers new tile spots next to the Hero that touch two tiles", () => {
    const s = newGame();
    for (const c of placementSlots(s, "p1-main")) {
      const touching = s.tiles.filter((t) => SNUG_OFFSETS.some((o) => hexKey(o) === hexKey(subHex(c, t.center))));
      expect(touching.length).toBeGreaterThanOrEqual(2);
    }
  });
});

describe("guarded Fields and Combat", () => {
  it("starts Combat against the Field's Neutral Units, then flags the Mine on victory (p. 33, 76)", () => {
    const [base, f] = withTile(newGame(), 2, "F4"); // F4 top-left: Mine (gold), difficulty III
    let s = teleport(base, "p1-main", f[2]!);
    // Give Alice an army strong enough to win.
    getPlayer(s, "p1").army = [
      { unitId: "archangels", variant: "pack" },
      { unitId: "champions", variant: "pack" },
      { unitId: "champions", variant: "pack" },
    ];
    s = play(s, { type: "move", heroId: "p1-main", to: f[0]! });
    expect(s.phase.type).toBe("combat-setup");
    if (s.phase.type !== "combat-setup" || s.phase.context.foe.kind !== "neutral") throw new Error();
    // Normal difficulty III: two bronze and a silver Neutral Unit.
    expect(s.phase.context.foe.units.map((u) => u.tier)).toEqual(["bronze", "bronze", "silver"]);
    s = play(s, {
      type: "combat-setup",
      picks: [
        { armyIndex: 0, line: "front" },
        { armyIndex: 1, line: "front" },
        { armyIndex: 2, line: "front" },
      ],
    });
    expect(s.phase.type).toBe("combat");
    s = autoplay(s);
    expect(s.phase.type).toBe("turn");
    const m = marksAt(s, f[0]!);
    expect(m.cleared).toBe(true);
    expect(m.flag).toBe("p1");
    const alice = getPlayer(s, "p1");
    expect(alice.production.gold).toBe(15);
    expect(alice.resources.gold).toBe(20); // first to flag: the income at once
    // Difficulty III above Level I: 2 Experience, Level II (p. 44).
    expect(getHero(s, "p1-main").experience).toBe(2);
    expect(levelFor(2)).toBe(2);
    // The used Neutral cards are in their Discard Piles.
    expect(s.neutralDecks.bronze!.discard).toHaveLength(2);
  });

  it("skips Combat when the Hero's Level is above the Field Difficulty (Quick Combat, p. 40)", () => {
    const [base, f] = withTile(newGame(), 2, "F4");
    let s = teleport(base, "p1-main", f[2]!);
    getHero(s, "p1-main").experience = 6; // Level IV
    s = play(s, { type: "move", heroId: "p1-main", to: f[0]! });
    expect(s.phase.type).toBe("turn");
    expect(marksAt(s, f[0]!).flag).toBe("p1");
    expect(getHero(s, "p1-main").experience).toBe(6); // no reward from Quick Combat
  });

  it("sends a retreating Hero back to the last visited Field (p. 44)", () => {
    const [base, f] = withTile(newGame(), 2, "F4");
    let s = teleport(base, "p1-main", f[2]!);
    s = play(s, { type: "move", heroId: "p1-main", to: f[0]! });
    s = play(s, { type: "combat-setup", picks: [{ armyIndex: 0, line: "front" }] });
    s = autoplay(s, "retreat");
    expect(s.phase.type).toBe("turn");
    const hero = getHero(s, "p1-main");
    expect(hexKey(hero.pos)).toBe(hexKey(f[2]!));
    expect(marksAt(s, f[0]!).flag).toBeNull();
  });
});

describe("Rounds", () => {
  const endRound = (s: AdventureState) => play(s, { type: "end-turn" }, { type: "end-turn" });

  it("draws an Astrologers card in even Rounds and pays income in odd Rounds after the first (p. 15)", () => {
    let s = endRound(newGame());
    expect(s.round).toBe(2);
    expect(s.astrologers.current).not.toBeNull();
    expect(s.astrologers.current).not.toBe("friendly_beaver");
    const gold = getPlayer(s, "p1").resources.gold;
    s = endRound(s);
    expect(s.round).toBe(3);
    expect(getPlayer(s, "p1").resources.gold).toBeGreaterThanOrEqual(gold + 10);
  });

  it("refreshes Movement Points every Round", () => {
    let s = newGame();
    const hero = getHero(s, "p1-main");
    s = play(s, { type: "move", heroId: hero.id, to: legalMoves(s, hero.id)[0]! });
    s = endRound(s);
    expect(getHero(s, hero.id).mp).toBeGreaterThanOrEqual(3);
  });

  it("eliminates a player after 3 full Rounds without a Town or Settlement (p. 11)", () => {
    let s = newGame();
    for (const m of Object.values(s.marks)) if (m.flag === "p2") m.flag = null;
    s = endRound(endRound(s));
    expect(getPlayer(s, "p2").eliminated).toBe(false);
    s = endRound(s);
    expect(getPlayer(s, "p2").eliminated).toBe(true);
    expect(s.phase).toMatchObject({ type: "over", winners: ["p1"] });
  });

  it("ends the sandbox Clash at the end of the Round in which an enemy Town is flagged", () => {
    let s = newGame();
    const bobTown = getHero(s, "p2-main").pos;
    // Bob's hero is away and Bob cannot pay to defend.
    s = teleport(s, "p2-main", fieldHex(s.tiles[1]!.center, 0, 0));
    getPlayer(s, "p2").resources.gold = 0;
    const next = [0, 1, 2, 4, 5, 6].map((i) => fieldHex(s.tiles[1]!.center, 0, i)).find((h) => areAdjacent(h, bobTown) && fieldAt(s, h)!.field.location !== "blocked_field")!;
    s = teleport(s, "p1-main", next);
    s = play(s, { type: "move", heroId: "p1-main", to: bobTown });
    expect(marksAt(s, bobTown).flag).toBe("p1");
    expect(s.phase.type).toBe("turn");
    s = play(s, { type: "end-turn" }, { type: "end-turn" });
    expect(s.phase).toMatchObject({ type: "over", winners: ["p1"], reason: "victory" });
  });

  it("refuses illegal steps", () => {
    const s = newGame();
    expect(() => play(s, { type: "choose", option: 0 })).toThrow(IllegalAction);
  });
});
