import { describe, expect, it } from "vitest";
import { placeNeutrals } from "./setup.ts";

describe("placeNeutrals (p. 41)", () => {
  it("puts ranged units in the Backline and sorts by descending Initiative", () => {
    const placed = placeNeutrals("defender", [
      { unitId: "zombies", variant: "neutral" }, // ground, Initiative 3
      { unitId: "marksmen", variant: "neutral" }, // ranged, Initiative 5
      { unitId: "griffins", variant: "neutral" }, // flying, Initiative 8
    ]);
    expect(placed).toEqual([
      { unitId: "griffins", variant: "neutral", pos: { col: 0, row: 3 } },
      { unitId: "marksmen", variant: "neutral", pos: { col: 0, row: 4 } },
      { unitId: "zombies", variant: "neutral", pos: { col: 1, row: 3 } },
    ]);
  });
});
