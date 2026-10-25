import type { Resource, Tier } from "@heroes/data";
import type { Difficulty } from "./types.ts";

/** Location categories (p. 32). */
export type Category = "empty" | "blocked" | "visitable" | "flaggable" | "revisitable";

const FLAGGABLE = new Set(["mine", "settlement", "town", "random_town", "obelisk", "star_axis", "dragon_utopia"]);
const REVISITABLE = new Set([
  "stables",
  "sanctuary",
  "trading_post",
  "war_machine_factory",
  "black_market",
  "library_of_enlightenment",
  "tavern",
  "monolith_one_way",
  "monolith_two_way",
  "subterranean_gate",
]);
/** Flaggable Fields where several players may keep a Faction Cube at once (p. 79, 82). */
export const SHARED_FLAG = new Set(["obelisk", "star_axis"]);

export function categoryOf(location: string): Category {
  if (location === "empty_field") return "empty";
  if (location === "blocked_field") return "blocked";
  if (FLAGGABLE.has(location)) return "flaggable";
  if (REVISITABLE.has(location)) return "revisitable";
  return "visitable";
}

/** Mine production (p. 76). */
export const MINE_OUTPUT: Record<Resource, number> = { gold: 5, buildingMaterials: 2, valuables: 1 };
/** Settlement production choice (p. 77): one step of the production track. */
export const SETTLEMENT_OUTPUT: Record<Resource, number> = { gold: 5, buildingMaterials: 2, valuables: 1 };
/** Flagging the Random Town raises gold production by 10 (p. 77). */
export const RANDOM_TOWN_GOLD = 10;

const b = "bronze",
  s = "silver",
  g = "gold",
  a = "azure";
/**
 * Neutral Units guarding a Field, by Field Difficulty I–VII and Scenario Difficulty
 * (table on the rule book's back cover; wiki "Difficulties").
 */
export const GUARDS: Record<Difficulty, Tier[][]> = {
  easy: [[b], [b, b], [b, s], [b, b, s], [b, b, s, g], [b, b, s, s, g], [a]],
  normal: [[b], [b, b], [b, b, s], [b, s, s], [b, s, s, g], [b, s, s, g, g], [a, a]],
  hard: [[b, b], [b, b, b], [b, s, s], [s, s, s], [s, s, g, g], [s, s, g, g, g], [g, a, a]],
  impossible: [[b, b, b], [b, b, s], [s, s, s], [s, s, g], [s, g, g, g], [s, g, g, g, g], [g, g, a, a]],
};

/**
 * Location effects still resolved by the players: Spell Scrolls and War Machines (expansion
 * components), and Fields whose effect "depends on the Scenario". Visiting them still places the Black Cube.
 */
export const NEEDS_DECKS = new Set([
  "spell_scroll",
  "elemental_conflux",
  "war_machine_factory",
  "grail",
  "dragon_utopia",
  "obelisk",
]);
