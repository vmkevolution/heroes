/**
 * Deterministic randomness kept inside the game state, so a game can be replayed
 * from its seed and its list of actions. Tests can script exact results.
 */
export type RngState = { kind: "seeded"; seed: number } | { kind: "scripted"; values: number[] };

/** mulberry32: small, fast, good enough for dice. */
function mulberry32(seed: number): [number, number] {
  const next = (seed + 0x6d2b79f5) | 0;
  let t = next;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** Returns an integer in [0, n) and the next state. Scripted values are returned as-is, in order. */
export function nextInt(rng: RngState, n: number): [number, RngState] {
  if (rng.kind === "scripted") {
    const [value, ...rest] = rng.values;
    if (value === undefined) throw new Error("scripted RNG exhausted");
    if (value < 0 || value >= n) throw new Error(`scripted value ${value} out of range [0, ${n})`);
    return [value, { kind: "scripted", values: rest }];
  }
  const [f, seed] = mulberry32(rng.seed);
  return [Math.floor(f * n), { kind: "seeded", seed }];
}

/** Attack Die: two faces each of −1, 0 and +1 (rule book p. 42). */
export function rollAttackDie(rng: RngState): [-1 | 0 | 1, RngState] {
  if (rng.kind === "scripted") {
    const [value, ...rest] = rng.values;
    if (value !== -1 && value !== 0 && value !== 1) throw new Error(`scripted attack die must be -1, 0 or 1, got ${value}`);
    return [value, { kind: "scripted", values: rest }];
  }
  const [face, next] = nextInt(rng, 6);
  return [((face % 3) - 1) as -1 | 0 | 1, next];
}
