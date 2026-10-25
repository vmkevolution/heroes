import { nextInt, type RngState } from "../rng.ts";
import type { ResourceFace, TreasureFace } from "./types.ts";

/** Resource Die (p. 29): each Resource has a low and a doubled high face. */
export const RESOURCE_FACES: readonly ResourceFace[] = [
  { resource: "gold", amount: 3 },
  { resource: "gold", amount: 6 },
  { resource: "buildingMaterials", amount: 2 },
  { resource: "buildingMaterials", amount: 4 },
  { resource: "valuables", amount: 1 },
  { resource: "valuables", amount: 2 },
];

/** Treasure Die (p. 73): Experience ×2, Artifact ×2, Resource Die ×1, two Resource Dice ×1. */
export const TREASURE_FACES: readonly TreasureFace[] = [
  "experience",
  "experience",
  "artifact",
  "artifact",
  "resource",
  "resource2",
];

export function rollResourceDie(rng: RngState): [ResourceFace, RngState] {
  const [i, next] = nextInt(rng, 6);
  return [RESOURCE_FACES[i]!, next];
}

export function rollTreasureDie(rng: RngState): [TreasureFace, RngState] {
  const [i, next] = nextInt(rng, 6);
  return [TREASURE_FACES[i]!, next];
}

/** In-place Fisher–Yates shuffle driven by the game RNG. Returns the next RNG state. */
export function shuffle<T>(items: T[], rng: RngState): RngState {
  let state = rng;
  for (let i = items.length - 1; i > 0; i--) {
    const [j, next] = nextInt(state, i + 1);
    state = next;
    [items[i], items[j]] = [items[j]!, items[i]!];
  }
  return state;
}
