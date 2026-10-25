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
