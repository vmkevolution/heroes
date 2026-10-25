/**
 * AI Heroes and AI Decks of Campaigns and Cooperative Scenarios (rule book p. 49–51; wiki "AI").
 * AI Heroes have no Town Board, Resources or Hero Board: a static army, 3 MP, and two decks used in
 * Combat (the AI Deck and the AI Spell Deck).
 */
import { getVariant, spells, units } from "@heroes/data";
import { getUnitByUid, statsOf } from "../combat/engine.ts";
import type { CardEffect, CombatState, CombatUnit, Side } from "../combat/types.ts";
import { cardInfo } from "./cards.ts";
import { shuffle } from "./dice.ts";
import { fieldAt, tileHexes } from "./core.ts";
import { hexKey, hexNeighbors, sameHex, type Hex } from "./hex.ts";
import { categoryOf } from "./locations.ts";
import type { AdventureAction, AdventureState, ArmyUnit, Difficulty, Hero, PlayerId } from "./types.ts";
import type { RngState } from "../rng.ts";
import { nextInt } from "../rng.ts";

export type AiCardType = "might" | "magic" | "skill";

/** The eight AI cards: two versions of each, modifiers for Easy / Normal / Expert / Impossible (wiki "AI"). */
export const AI_CARDS = {
  "attack-1": { type: "might", effect: "attack", mods: [0, 1, 1, 2] },
  "attack-2": { type: "might", effect: "attack", mods: [1, 1, 2, 2] },
  "defense-1": { type: "might", effect: "defense-hp", mods: [0, 1, 1, 2] },
  "defense-2": { type: "might", effect: "defense-next", mods: [1, 1, 2, 2] },
  "spell-1": { type: "magic", effect: "spell", mods: [0, 1, 1, 2] },
  "spell-2": { type: "magic", effect: "spell", mods: [0, 1, 2, 3] },
  /** mods: 0 nothing more, 1 do it again, 2 shuffle back in on the first Combat round. */
  "skill-1": { type: "skill", effect: "skill", mods: [0, 0, 1, 1] },
  "skill-2": { type: "skill", effect: "skill", mods: [0, 2, 2, 1] },
} as const satisfies Record<string, { type: AiCardType; effect: string; mods: readonly number[] }>;
export type AiCardId = keyof typeof AI_CARDS;

const DIFFICULTY_INDEX: Record<Difficulty, number> = { easy: 0, normal: 1, hard: 2, impossible: 3 };
export const aiMod = (card: AiCardId, d: Difficulty) => AI_CARDS[card].mods[DIFFICULTY_INDEX[d]]!;

export interface AiHeroSetup {
  /** AI Deck composition from the Scenario (p. 50). */
  deck: Partial<Record<AiCardType, number>>;
  /** Spells for the AI Spell Deck. */
  spells?: string[];
  /** The Skill (usually an Ability) the AI Skill card uses. */
  skill?: string | null;
  /** Static army; defaults to the Faction's starting units. */
  army?: ArmyUnit[];
}

export interface AiHeroState {
  deck: AiCardId[];
  discard: AiCardId[];
  spells: { deck: string[]; discard: string[] };
  skill: string | null;
  /** AI Attack cards waiting for the next attack by one of its units (p. 50, "AI cards timing"). */
  attackBonus: number;
  /** AI Defense cards attached to units until their first defense. */
  defense: Record<string, number>;
  /** Activation that already drew its card (`round:uid`). */
  drawnFor: string | null;
}

/** Builds an AI Deck: each card is one of the two versions of its type, chosen at random (p. 50). */
export function buildAiDeck(setup: AiHeroSetup, rng: RngState): [AiHeroState, RngState] {
  const deck: AiCardId[] = [];
  for (const type of ["might", "magic", "skill"] as const) {
    const ids = (Object.keys(AI_CARDS) as AiCardId[]).filter((id) => AI_CARDS[id].type === type);
    for (let i = 0; i < (setup.deck[type] ?? 0); i++) {
      const [k, r] = nextInt(rng, ids.length);
      rng = r;
      deck.push(ids[k]!);
    }
  }
  rng = shuffle(deck, rng);
  const spells = (setup.spells ?? []).map((s) => (s.startsWith("spell:") ? s : `spell:${s}`));
  rng = shuffle(spells, rng);
  return [{ deck, discard: [], spells: { deck: spells, discard: [] }, skill: setup.skill ?? null, attackBonus: 0, defense: {}, drawnFor: null }, rng];
}

export const isAiHero = (state: AdventureState, player: PlayerId | null) => player !== null && player in state.ai.heroes;

// ---------------------------------------------------------------------------
// Map movement (p. 49)

const tileOf = (state: AdventureState, hex: Hex) => state.tiles.find((t) => tileHexes(t).some((h) => sameHex(h, hex)));

/** Steps through the map (face-down tiles included: they get discovered on the way), avoiding Blocked Fields. */
function path(state: AdventureState, hero: Hero, goal: (hex: Hex) => boolean): Hex[] | null {
  const prev = new Map<string, Hex | null>([[hexKey(hero.pos), null]]);
  let frontier = [hero.pos];
  while (frontier.length) {
    const next: Hex[] = [];
    for (const hex of frontier) {
      for (const n of hexNeighbors(hex)) {
        const k = hexKey(n);
        if (prev.has(k)) continue;
        const info = fieldAt(state, n);
        if (!info) continue;
        if (info.tile.faceUp && categoryOf(info.field.location) === "blocked") continue;
        if (state.heroes.some((h) => h.owner === hero.owner && sameHex(h.pos, n))) continue;
        prev.set(k, hex);
        if (goal(n)) {
          const out = [n];
          for (let p = hex; !sameHex(p, hero.pos); p = prev.get(hexKey(p))!) out.unshift(p);
          return out;
        }
        next.push(n);
      }
    }
    frontier = next;
  }
  return null;
}

/** What the AI Hero heads for, in descending priority (p. 49). */
function aiGoal(state: AdventureState, hero: Hero): ((hex: Hex) => boolean) | null {
  const tile = tileOf(state, hero.pos);
  const onTile = (hex: Hex) => tile !== undefined && tileHexes(tile).some((h) => sameHex(h, hex));
  const humans = state.players.filter((p) => !p.eliminated && !isAiHero(state, p.id));
  const enemyHero = state.heroes.find((h) => humans.some((p) => p.id === h.owner) && onTile(h.pos));
  if (enemyHero) return (hex) => sameHex(hex, enemyHero.pos);
  const flaggable = (hex: Hex) => {
    const loc = fieldAt(state, hex)?.field.location;
    return (loc === "mine" || loc === "settlement") && state.marks[hexKey(hex)]?.flag !== hero.owner;
  };
  if (tile?.faceUp && tileHexes(tile).some(flaggable)) return (hex) => onTile(hex) && flaggable(hex);
  const towns = humans.flatMap((p) =>
    Object.entries(state.marks)
      .filter(([, m]) => m.flag === p.id)
      .map(([k]) => {
        const [q, r] = k.split(",").map(Number);
        return { q: q!, r: r! };
      })
      .filter((h) => fieldAt(state, h)?.field.location === "town"),
  );
  return towns.length ? (hex) => towns.some((t) => sameHex(t, hex)) : null;
}

/** The AI Hero's next step on its Turn: discover the next tile, move, or end the Turn when out of MP. */
export function aiHeroTurnAction(state: AdventureState, player: PlayerId): AdventureAction {
  const hero = state.heroes.find((h) => h.owner === player && h.kind === "main");
  if (!hero || hero.mp + hero.bonusMp < 1) return { type: "end-turn" };
  const goal = aiGoal(state, hero);
  const route = goal ? path(state, hero, goal) : null;
  if (!route?.length) return { type: "end-turn" };
  const step = route[0]!;
  const tile = fieldAt(state, step)!.tile;
  // "AI Heroes must discover face down Map Tiles as normal by spending 1 MP before moving onto them.
  // The player chooses that Tile's orientation": kept as printed (rotation 0).
  if (!tile.faceUp) return { type: "discover", heroId: hero.id, center: tile.center, rotation: 0 };
  return { type: "ai-move", heroId: hero.id, to: step };
}

// ---------------------------------------------------------------------------
// Combat (p. 50–51)

/** Units placed by the AI: strongest first, Ranged in the Backline (Campaign placement, p. 41). */
export function aiPicks(army: ArmyUnit[]): { armyIndex: number; line: "back" | "front" }[] {
  return army
    .map((u, i) => ({ i, v: getVariant(u.unitId, u.variant) }))
    .sort((a, b) => b.v.initiative - a.v.initiative)
    .slice(0, 5)
    .map(({ i, v }) => ({ armyIndex: i, line: v.type === "ranged" ? "back" : "front" }));
}

function drawAiCard(ai: AiHeroState, rng: RngState): [AiCardId | null, RngState] {
  if (!ai.deck.length) return [null, rng]; // "If the AI Deck is depleted during Combat, stop drawing from it."
  return [ai.deck.shift()!, rng];
}

/** Before each Combat the AI Deck and the AI Spell Deck are shuffled with their discard piles (p. 50). */
export function resetAiDecks(state: AdventureState, player: PlayerId) {
  const ai = state.ai.heroes[player]!;
  ai.deck.push(...ai.discard);
  ai.discard = [];
  state.rng = shuffle(ai.deck, state.rng);
  ai.spells.deck.push(...ai.spells.discard);
  ai.spells.discard = [];
  state.rng = shuffle(ai.spells.deck, state.rng);
  ai.attackBonus = 0;
  ai.defense = {};
  ai.drawnFor = null;
}

export interface AiCardResult {
  card: AiCardId | null;
  effects: CardEffect[];
  spell: string | null;
  skill: string | null;
}

/** The highest-Power option of a Spell the AI can cast, as combat effects on its chosen target (wiki "Cast a spell"). */
function castSpell(combat: CombatState, side: Side, spell: string, power: number): CardEffect[] {
  const info = cardInfo(spell);
  const option = [...info.options].filter((o) => o.effects && o.power <= power).sort((a, b) => b.power - a.power)[0];
  if (!option?.effects) return [];
  const mine = combat.units.filter((u) => u.side === side);
  const theirs = combat.units.filter((u) => u.side !== side);
  const highestDefense = (us: CombatUnit[]) => [...us].sort((a, b) => statsOf(b).defense - statsOf(a).defense)[0];
  const out: CardEffect[] = [];
  for (const e of option.effects) {
    if (e.kind === "damage") {
      const t = highestDefense(theirs);
      if (t) out.push({ kind: "damage", uid: t.uid, amount: e.n });
    } else if (e.kind === "buff" && e.n > 0) {
      const t = highestDefense(mine);
      if (t) out.push({ kind: "buff", uid: t.uid, stat: e.stat, amount: e.n });
    } else if (e.kind === "buff") {
      const t = highestDefense(theirs);
      if (t) out.push({ kind: "buff", uid: t.uid, stat: e.stat, amount: e.n });
    } else if (e.kind === "heal") {
      // Healing Spells (p. 51): the AI unit that has taken the most damage, highest tier first.
      const t = [...mine].filter((u) => u.damage > 0).sort((a, b) => b.damage - a.damage)[0];
      if (t) out.push({ kind: "heal", uid: t.uid, amount: e.n });
    }
  }
  return out;
}

/**
 * Draws and resolves the AI card for an activating unit (p. 50). Attack and Defense cards wait for
 * the attack they modify; Spells resolve now; Skills are logged for the players to apply.
 */
export function resolveAiCard(state: AdventureState, player: PlayerId, combat: CombatState, uid: string): AiCardResult {
  const ai = state.ai.heroes[player]!;
  const [card, rng] = drawAiCard(ai, state.rng);
  state.rng = rng;
  const result: AiCardResult = { card, effects: [], spell: null, skill: null };
  if (!card) return result;
  const def = AI_CARDS[card];
  const mod = aiMod(card, state.difficulty);
  const unit = getUnitByUid(combat, uid);
  const mine = combat.units.filter((u) => u.side === unit.side);
  switch (def.effect) {
    case "attack":
      ai.attackBonus += mod;
      break;
    case "defense-hp": {
      const t = [...mine].sort((a, b) => statsOf(b).hp - statsOf(a).hp)[0]!;
      ai.defense[t.uid] = (ai.defense[t.uid] ?? 0) + mod;
      break;
    }
    case "defense-next": {
      const next = [...mine].filter((u) => !u.activated && u.uid !== uid).sort((a, b) => statsOf(b).initiative - statsOf(a).initiative)[0] ?? unit;
      ai.defense[next.uid] = (ai.defense[next.uid] ?? 0) + mod;
      break;
    }
    case "spell": {
      if (!ai.spells.deck.length) {
        ai.spells.deck = ai.spells.discard;
        ai.spells.discard = [];
        state.rng = shuffle(ai.spells.deck, state.rng);
      }
      const spell = ai.spells.deck.shift() ?? "spell:magic_arrow";
      ai.spells.discard.push(spell);
      result.spell = spell;
      result.effects = castSpell(combat, unit.side, spell, mod);
      break;
    }
    case "skill":
      result.skill = ai.skill;
      if (mod === 2 && combat.round === 1) {
        ai.deck.push(card);
        state.rng = shuffle(ai.deck, state.rng);
        return result;
      }
      break;
  }
  ai.discard.push(card);
  return result;
}

/** AI cards that modify the attack being resolved in a reaction window, then cleared. */
export function aiReactionBonus(state: AdventureState, player: PlayerId, combat: CombatState, side: Side): { stat: "attack" | "defense"; amount: number } | null {
  const ph = combat.phase;
  if (ph.type !== "reaction") return null;
  const ai = state.ai.heroes[player]!;
  const attacker = getUnitByUid(combat, ph.attack.attackerUid);
  if (attacker.side === side) {
    if (!ai.attackBonus) return null;
    const amount = ai.attackBonus;
    ai.attackBonus = 0;
    return { stat: "attack", amount };
  }
  const bonus = ai.defense[ph.attack.targetUid];
  if (!bonus) return null;
  delete ai.defense[ph.attack.targetUid];
  return { stat: "defense", amount: bonus };
}


/**
 * A ready-made AI Hero for skirmishes outside Campaigns: the Faction's three units (Bronze and Silver
 * Packs, a Gold Few), four Might cards and two Magic cards, and the Spells the engine can cast.
 */
export function defaultAiHero(faction: import("@heroes/data").Faction): AiHeroSetup {
  const tierUnit = (tier: string) =>
    units.find((c) => c.variants.some((v) => v.key === "few" && v.origin === "faction" && v.faction === faction && v.tier === tier))?.id;
  const army: ArmyUnit[] = [
    { unitId: tierUnit("bronze")!, variant: "pack" },
    { unitId: tierUnit("silver")!, variant: "pack" },
    { unitId: tierUnit("gold")!, variant: "few" },
  ].filter((u) => u.unitId);
  const castable = spells
    .filter((sp) => cardInfo(`spell:${sp.id}`).options.some((o) => o.effects?.some((e) => e.kind === "damage" || e.kind === "buff" || e.kind === "heal")))
    .map((sp) => sp.id)
    .slice(0, 8);
  return { deck: { might: 4, magic: 2, skill: 0 }, spells: castable, skill: null, army };
}
