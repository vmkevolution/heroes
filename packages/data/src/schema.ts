import { z } from "zod";

export const TIERS = ["bronze", "silver", "gold", "azure"] as const;
export const Tier = z.enum(TIERS);
export type Tier = z.infer<typeof Tier>;

export const UnitType = z.enum(["ground", "flying", "ranged"]);
export type UnitType = z.infer<typeof UnitType>;

export const FACTIONS = [
  "castle",
  "dungeon",
  "necropolis",
  "tower",
  "rampart",
  "fortress",
  "inferno",
  "stronghold",
  "conflux",
  "cove",
] as const;
export const Faction = z.enum(FACTIONS);
export type Faction = z.infer<typeof Faction>;

/** Where a unit card comes from: a faction's few/pack side, a neutral deck, a creature bank, a summon or a siege card. */
export const Origin = z.enum(["faction", "neutral", "creature-bank", "summoned", "siege"]);
export type Origin = z.infer<typeof Origin>;

export const Cost = z.object({
  gold: z.number().int().nonnegative(),
  valuables: z.number().int().nonnegative(),
  buildingMaterials: z.number().int().nonnegative(),
});
export type Cost = z.infer<typeof Cost>;

/** Unit ability trigger, from the icons on the card (rule book p. 37). */
export const AbilityTrigger = z.enum(["passive", "activation", "other", "attack", "retaliation", "map"]);
export type AbilityTrigger = z.infer<typeof AbilityTrigger>;

export const AbilityText = z.object({
  triggers: z.array(AbilityTrigger),
  /** Card text with wiki glyphs kept as `:name:` shortcodes and links reduced to their label. */
  text: z.string().min(1),
});
export type AbilityText = z.infer<typeof AbilityText>;

export const UnitVariant = z.object({
  /** Stable key: `few`, `pack`, `few-alternate`, `pack-alternate`, `neutral`, `siege`, or a creature bank slug. */
  key: z.string().min(1),
  label: z.string().min(1),
  origin: Origin,
  faction: Faction.nullable(),
  tier: Tier.nullable(),
  type: UnitType,
  attack: z.number().int(),
  defense: z.number().int(),
  hp: z.number().int().positive(),
  initiative: z.number().int(),
  /** Recruitment cost on a few side, reinforcement cost on a pack side, Diplomacy cost on a neutral card. */
  cost: Cost.nullable(),
  abilities: z.array(AbilityText),
  /** Card picture file name from the wiki (`units-castle-bronze-griffins-few.webp`), if any. */
  image: z.string().nullable(),
});
export type UnitVariant = z.infer<typeof UnitVariant>;

export const UnitCard = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  variants: z.array(UnitVariant).min(1),
  /** Wiki "Comes With" list: the boxes that contain this card. */
  content: z.array(z.string()),
});
export type UnitCard = z.infer<typeof UnitCard>;

export const RESOURCES = ["gold", "buildingMaterials", "valuables"] as const;
export const Resource = z.enum(RESOURCES);
export type Resource = z.infer<typeof Resource>;

/** Map Tile groups (rule book p. 31, 34). The Roman numerals give the Neutral Unit difficulty. */
export const TileGroup = z.enum(["starting", "far", "near", "center", "subterranean", "sea"]);
export type TileGroup = z.infer<typeof TileGroup>;

/** One of the 7 Fields of a Map Tile (p. 31). */
export const TileField = z.object({
  /** Wiki field slug (`mine`, `water_wheel`, `treasure_symbol`, …) or `town` / `settlement` / `random_town`. */
  location: z.string().min(1),
  /** Field Difficulty I–VII, when Neutral Units guard it. */
  difficulty: z.number().int().min(1).max(7).nullable(),
  /** Town and Settlement style. */
  faction: Faction.nullable(),
  /** Resource printed on the field: the Mine's produce, or what a `+N` field gives. */
  resource: Resource.nullable(),
  /** Printed amount, e.g. `+3` gold on a Water Wheel. */
  amount: z.number().int().nullable(),
  /** Number of dice printed (`2 :treasure_die: → 1`). */
  dice: z.number().int().positive().nullable(),
  /** Text as printed on the wiki, glyphs kept as `:name:`. */
  label: z.string(),
});
export type TileField = z.infer<typeof TileField>;

export const MapTile = z.object({
  /** Printed name: `S3`, `F12`, `#N4`. */
  id: z.string().min(1),
  group: TileGroup,
  terrain: z.string(),
  /**
   * Fields in reading order of the printed tile, rows of 2, 3 and 2:
   * top-left, top-right, left, center, right, bottom-left, bottom-right.
   */
  fields: z.array(TileField).length(7),
  content: z.array(z.string()),
});
export type MapTile = z.infer<typeof MapTile>;

/** Astrologers Proclaim card, drawn at the start of every even Round (rule book p. 15). */
export const AstrologersCard = z.object({
  id: z.string().regex(/^[a-z0-9_]+$/),
  name: z.string().min(1),
  effect: z.string().min(1),
  content: z.array(z.string()),
});
export type AstrologersCard = z.infer<typeof AstrologersCard>;

// ---------------------------------------------------------------------------
// Might & Magic cards (rule book p. 22–28)

const CardId = z.string().regex(/^[a-z0-9_]+$/);

export const SCHOOLS = ["air", "earth", "fire", "water"] as const;
export const School = z.enum(SCHOOLS);
export type School = z.infer<typeof School>;

/** Spell card (p. 26). Magic Arrow has no fixed School: it takes the one chosen when cast. */
export const SpellCard = z.object({
  id: CardId,
  name: z.string().min(1),
  school: School.nullable(),
  level: z.enum(["basic", "expert"]),
  /** Effect text, glyphs kept as `:name:`; empower tiers on their own lines (`:power: 1 ➣ 2 :damage:`). */
  text: z.string().min(1),
  image: z.string().nullable(),
  content: z.array(z.string()),
});
export type SpellCard = z.infer<typeof SpellCard>;

/** Ability card (p. 24): a Basic and an Expert effect, plus the Naval Battles Empowered version. */
export const AbilityCard = z.object({
  id: CardId,
  name: z.string().min(1),
  basic: z.string().min(1),
  expert: z.string().min(1),
  empowered: z.string().nullable(),
  /** Necromancy cards are limited to the Necropolis Faction (p. 24). */
  necropolis: z.boolean(),
  image: z.string().nullable(),
  empoweredImage: z.string().nullable(),
  content: z.array(z.string()),
});
export type AbilityCard = z.infer<typeof AbilityCard>;

/** Artifact card (p. 27): a top and a bottom effect. */
export const ArtifactCard = z.object({
  id: CardId,
  name: z.string().min(1),
  level: z.enum(["minor", "major", "relic"]),
  effects: z.array(z.string().min(1)).min(1).max(2),
  image: z.string().nullable(),
  content: z.array(z.string()),
});
export type ArtifactCard = z.infer<typeof ArtifactCard>;

export const STATISTICS = ["attack", "defense", "power", "knowledge"] as const;
export const Statistic = z.enum(STATISTICS);
export type Statistic = z.infer<typeof Statistic>;

/** Statistic card (p. 24). */
export const StatisticCard = z.object({
  id: Statistic,
  name: z.string().min(1),
  basic: z.string().min(1),
  expert: z.string().min(1),
  empowered: z.string().min(1),
  image: z.string().nullable(),
  empoweredImage: z.string().nullable(),
});
export type StatisticCard = z.infer<typeof StatisticCard>;

/** One of a Hero's three Specialty cards, gained at Levels I, IV and VI (p. 21, 27). */
export const SpecialtyCard = z.object({
  level: z.number().int().min(1).max(7),
  text: z.string().min(1),
  image: z.string().nullable(),
});
export type SpecialtyCard = z.infer<typeof SpecialtyCard>;

/** Hero Board (p. 21). */
export const HeroCard = z.object({
  id: CardId,
  name: z.string().min(1),
  faction: Faction,
  heroClass: z.string().min(1),
  type: z.enum(["might", "magic"]),
  stats: z.object({
    attack: z.number().int().nonnegative(),
    defense: z.number().int().nonnegative(),
    power: z.number().int().nonnegative(),
    knowledge: z.number().int().nonnegative(),
  }),
  /** Starting Ability card id. */
  ability: CardId,
  specialtyName: z.string().min(1),
  specialties: z.array(SpecialtyCard).length(3),
  image: z.string().nullable(),
  content: z.array(z.string()),
});
export type HeroCard = z.infer<typeof HeroCard>;

/** Town Board slots (p. 30), in the order printed on every Town Board. */
export const BUILDINGS = [
  "city_hall",
  "citadel",
  "mage_guild",
  "dwelling_bronze",
  "dwelling_silver",
  "dwelling_gold",
  "special_1",
  "special_2",
] as const;
export const BuildingSlot = z.enum(BUILDINGS);
export type BuildingSlot = z.infer<typeof BuildingSlot>;

export const TownBuilding = z.object({
  slot: BuildingSlot,
  name: z.string().min(1),
  cost: Cost,
  effect: z.string().min(1),
});
export type TownBuilding = z.infer<typeof TownBuilding>;

export const TownCard = z.object({
  faction: Faction,
  name: z.string().min(1),
  buildings: z.array(TownBuilding).length(8),
  /** Gold paid to Search (2) the Spell Deck with the Spell Book Token (Mage Guild text). */
  spellBookCost: z.number().int().nonnegative(),
  images: z.object({ empty: z.string().nullable(), full: z.string().nullable() }),
});
export type TownCard = z.infer<typeof TownCard>;

/** A map drawn with the community map editor (fan Mission Book `map-files/*.map`). */
export const MapLayout = z.object({
  /** File name with `-` turned into `_`. */
  id: z.string().min(1),
  tiles: z.array(
    z.object({
      /** Editor grid cell of the tile's center. */
      row: z.number().int(),
      col: z.number().int(),
      group: TileGroup,
      /** A fixed tile (`F12`, `#F4`); null draws a random tile of the group. */
      tile: z.string().nullable(),
      rotation: z.number().int().min(0).max(5),
    }),
  ),
  /** Starting tiles, one per player seat. */
  seats: z.number().int().nonnegative(),
  /** False when the map uses tile kinds the game data lacks (subterranean, water). */
  supported: z.boolean(),
});
export type MapLayout = z.infer<typeof MapLayout>;

const Localized = <T extends z.ZodTypeAny>(t: T) => z.object({ en: t, fr: t });
const TextSection = z.object({ title: z.string(), body: z.string() });
const TimedEvent = z.object({ rounds: z.array(z.number().int().positive()), text: z.string() });

/** A Scenario of the fan Mission Book, with its text in English and French. */
export const Scenario = z.object({
  id: z.string().min(1),
  kind: z.enum(["clash", "cooperative", "campaign"]),
  title: Localized(z.string()),
  /** "Clash Scenario", "Castle Campaign – The Queen's Gambit", … */
  series: Localized(z.string()),
  maxRounds: z.number().int().positive().nullable(),
  playerCounts: z.array(z.number().int().positive()),
  resources: z.record(z.string(), z.number().int()).nullable(),
  income: z.record(z.string(), z.number().int()).nullable(),
  /** Map ids (see MapLayout) shown in the Scenario, usually one per player count. */
  maps: z.array(z.string()),
  timedEvents: Localized(z.array(TimedEvent)),
  text: Localized(z.array(TextSection)),
  /** French paragraphs that could not be matched (left in English). */
  untranslated: z.number().int().nonnegative(),
});
export type Scenario = z.infer<typeof Scenario>;
