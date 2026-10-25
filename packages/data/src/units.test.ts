import { describe, expect, it } from "vitest";
import { getVariant, units } from "./index.ts";

describe("unit data imported from the wiki", () => {
  it("has the 7 units of every faction on both sides", () => {
    const factionVariants = units.flatMap((u) => u.variants.filter((v) => v.origin === "faction" && v.key === "few"));
    const perFaction = new Map<string, number>();
    for (const v of factionVariants) perFaction.set(v.faction!, (perFaction.get(v.faction!) ?? 0) + 1);
    expect(perFaction.size).toBe(10);
    for (const [, n] of perFaction) expect(n).toBe(7);
  });

  it("matches the Griffins card used in the rule book combat example (p. 45)", () => {
    const pack = getVariant("griffins", "pack");
    expect(pack).toMatchObject({ tier: "bronze", type: "flying", attack: 3, defense: 0, hp: 4, initiative: 9 });
    expect(pack.abilities[0]?.triggers).toEqual(["retaliation"]);
  });

  it("keeps multi-resource costs", () => {
    expect(getVariant("archangels", "pack").cost?.valuables).toBeGreaterThan(0);
  });

  it("applies the Gold Dragons correction (neutral card is Azure)", () => {
    expect(getVariant("gold_dragons", "neutral")).toMatchObject({ tier: "azure", type: "flying" });
  });
});
