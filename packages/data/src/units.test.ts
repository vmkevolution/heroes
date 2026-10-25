import { describe, expect, it } from "vitest";
import {
  abilities,
  artifacts,
  getHero,
  getSpell,
  getTile,
  getTown,
  getVariant,
  heroes,
  spells,
  statistics,
  tiles,
  towns,
  units,
} from "./index.ts";

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

describe("map tiles", () => {
  it("imports every tile with 7 fields in printed reading order", () => {
    expect(tiles).toHaveLength(107);
    for (const t of tiles) expect(t.fields).toHaveLength(7);
  });

  it("puts each faction Town in the center of its Starting Tile (p. 30)", () => {
    for (const t of tiles.filter((x) => x.group === "starting")) {
      expect(t.fields[3]!.location).toBe("town");
    }
    expect(getTile("S3").fields[3]!.faction).toBe("castle");
  });

  it("reads difficulty, resource and dice from the field labels", () => {
    const f4 = getTile("F4").fields;
    expect(f4[0]).toMatchObject({ location: "mine", difficulty: 3, resource: "gold" });
    expect(f4[2]).toMatchObject({ location: "water_wheel", resource: "gold", amount: 3 });
    expect(f4[3]!.location).toBe("blocked_field");
    expect(getTile("S3").fields[2]).toMatchObject({ location: "treasure_symbol", difficulty: 1, dice: 1 });
  });

  it("restores the Temple missing from the U7 wiki page", () => {
    expect(getTile("U7").fields[5]!.location).toBe("temple");
  });
});

describe("Might & Magic cards, Heroes and Towns", () => {
  it("imports every Spell, Ability, Artifact and Statistic card", () => {
    expect(spells.length).toBeGreaterThanOrEqual(59);
    expect(abilities.length).toBeGreaterThanOrEqual(32);
    expect(artifacts.length).toBeGreaterThanOrEqual(90);
    expect(statistics.map((s) => s.id)).toEqual(["attack", "defense", "power", "knowledge"]);
    expect(getSpell("magic_arrow").school).toBeNull(); // any School when cast (p. 26)
    expect(getSpell("fireball")).toMatchObject({ school: "fire", level: "expert" });
    expect(artifacts.every((a) => a.effects.length === 2)).toBe(true); // top and bottom effect (p. 27)
  });

  it("reads Hero Boards: Catherine the Knight (p. 21 example Hero)", () => {
    expect(getHero("catherine")).toMatchObject({
      faction: "castle",
      type: "might",
      stats: { attack: 2, defense: 2, power: 1, knowledge: 1 },
      ability: "leadership",
    });
    expect(getHero("catherine").specialties.map((s) => s.level)).toEqual([1, 4, 6]);
    expect(heroes.every((h) => h.specialties.length === 3)).toBe(true);
  });

  it("reads all 10 Town Boards with 8 Buildings each", () => {
    expect(towns).toHaveLength(10);
    expect(getTown("castle").buildings.map((b) => b.slot)).toEqual([
      "city_hall",
      "citadel",
      "mage_guild",
      "dwelling_bronze",
      "dwelling_silver",
      "dwelling_gold",
      "special_1",
      "special_2",
    ]);
    expect(getTown("castle").spellBookCost).toBe(6);
  });
});
