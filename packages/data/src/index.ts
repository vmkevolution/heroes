import type {
  AbilityCard,
  ArtifactCard,
  AstrologersCard,
  Faction,
  HeroCard,
  MapLayout,
  MapTile,
  Scenario,
  SpellCard,
  StatisticCard,
  TownCard,
  UnitCard,
  UnitVariant,
} from "./schema.ts";
import unitsJson from "./generated/units.json" with { type: "json" };
import tilesJson from "./generated/tiles.json" with { type: "json" };
import astrologersJson from "./generated/astrologers.json" with { type: "json" };
import spellsJson from "./generated/spells.json" with { type: "json" };
import abilitiesJson from "./generated/abilities.json" with { type: "json" };
import artifactsJson from "./generated/artifacts.json" with { type: "json" };
import statisticsJson from "./generated/statistics.json" with { type: "json" };
import heroesJson from "./generated/heroes.json" with { type: "json" };
import townsJson from "./generated/towns.json" with { type: "json" };
import mapsJson from "./generated/maps.json" with { type: "json" };
import scenariosJson from "./generated/scenarios.json" with { type: "json" };

export * from "./schema.ts";

export const units: readonly UnitCard[] = unitsJson as UnitCard[];
export const tiles: readonly MapTile[] = tilesJson as MapTile[];
export const astrologers: readonly AstrologersCard[] = astrologersJson as AstrologersCard[];
export const spells: readonly SpellCard[] = spellsJson as SpellCard[];
export const abilities: readonly AbilityCard[] = abilitiesJson as AbilityCard[];
export const artifacts: readonly ArtifactCard[] = artifactsJson as ArtifactCard[];
export const statistics: readonly StatisticCard[] = statisticsJson as StatisticCard[];
export const heroes: readonly HeroCard[] = heroesJson as HeroCard[];
export const towns: readonly TownCard[] = townsJson as TownCard[];
/** Fan Mission Book maps and Scenarios (CC BY-NC-SA 4.0). */
export const maps: readonly MapLayout[] = mapsJson as MapLayout[];
export const scenarios: readonly Scenario[] = scenariosJson as Scenario[];

export function getMap(id: string): MapLayout {
  const m = maps.find((x) => x.id === id);
  if (!m) throw new Error(`unknown map "${id}"`);
  return m;
}

export function getScenario(id: string): Scenario {
  const s = scenarios.find((x) => x.id === id);
  if (!s) throw new Error(`unknown Scenario "${id}"`);
  return s;
}

const byId = new Map(units.map((u) => [u.id, u]));
const tilesById = new Map(tiles.map((t) => [t.id, t]));

export function getUnit(id: string): UnitCard {
  const u = byId.get(id);
  if (!u) throw new Error(`unknown unit "${id}"`);
  return u;
}

export function getVariant(id: string, key: string): UnitVariant {
  const v = getUnit(id).variants.find((x) => x.key === key);
  if (!v) throw new Error(`unit "${id}" has no "${key}" variant`);
  return v;
}

export function getTile(id: string): MapTile {
  const t = tilesById.get(id);
  if (!t) throw new Error(`unknown map tile "${id}"`);
  return t;
}

export function getAstrologers(id: string): AstrologersCard {
  const c = astrologers.find((a) => a.id === id);
  if (!c) throw new Error(`unknown Astrologers Proclaim card "${id}"`);
  return c;
}

function finder<T>(list: readonly T[], key: (x: T) => string, what: string): (id: string) => T {
  const map = new Map(list.map((x) => [key(x), x]));
  return (id) => {
    const x = map.get(id);
    if (!x) throw new Error(`unknown ${what} "${id}"`);
    return x;
  };
}

export const getSpell = finder(spells, (s) => s.id, "spell");
export const getAbility = finder(abilities, (a) => a.id, "ability");
export const getArtifact = finder(artifacts, (a) => a.id, "artifact");
export const getStatistic = finder(statistics, (s) => s.id, "statistic");
export const getHero = finder(heroes, (h) => h.id, "hero");
export const getTown: (faction: Faction) => TownCard = finder(towns, (t) => t.faction, "town");
