/**
 * Might & Magic cards (rule book p. 22–28): card references, their playable options and the
 * effects the engine resolves by itself.
 *
 * A card in a deck, hand or discard pile is a reference string `kind:id`:
 * `stat:attack`, `stat+:power` (Empowered Statistic), `ability:offense`, `ability+:offense`
 * (Empowered Ability), `spell:fireball`, `artifact:golden_bow`, `specialty:catherine:0`.
 */
import { getAbility, getArtifact, getHero, getSpell, getStatistic, type Resource, type School } from "@heroes/data";
import type { BuffStat } from "../combat/types.ts";

export type DeckName = "ability" | "artifact" | "spell";
export type CardKind = "stat" | "stat+" | "ability" | "ability+" | "spell" | "artifact" | "specialty";
/** Card effect symbols (p. 22). */
export type Timing = "instant" | "activation" | "map" | "ongoing" | "permanent";

/** An effect the engine resolves. Anything else on a card is resolved by the players. */
export type Effect =
  | { kind: "attack"; n: number }
  | { kind: "defense"; n: number }
  | { kind: "power"; n: number; school?: School }
  | { kind: "draw"; n: number }
  | { kind: "gain"; resources: Partial<Record<Resource, number>> }
  | { kind: "mp"; n: number }
  | { kind: "morale" }
  | { kind: "search"; deck: DeckName; n: number }
  | { kind: "search-size"; n: number }
  | { kind: "damage"; n: number }
  | { kind: "heal"; n: number }
  | { kind: "buff"; stat: BuffStat; n: number }
  | { kind: "experience"; n: number }
  | { kind: "recall-spell" }
  | { kind: "spell-limit"; n: number };

export interface CardOption {
  text: string;
  timing: Timing[];
  /** Uses one of the Main Hero's Expert Effects for the Round (p. 24). */
  expert: boolean;
  /** Spell empower tier: the Power this option costs (p. 26). */
  power: number;
  /** Effects the engine applies, or null when players resolve the card by hand. */
  effects: Effect[] | null;
}

export interface CardInfo {
  ref: string;
  kind: CardKind;
  id: string;
  name: string;
  image: string | null;
  /** The shared deck the card returns to when it is discarded from play. */
  deck: DeckName | null;
  school: School | null;
  options: CardOption[];
}

const TIMING_GLYPHS: Record<string, Timing> = {
  instant: "instant",
  activation: "activation",
  map_effect: "map",
  ongoing: "ongoing",
  permanent: "permanent",
};

const RESOURCE_GLYPHS: Record<string, Resource> = {
  gold: "gold",
  building_materials: "buildingMaterials",
  valuables: "valuables",
};

function timingOf(text: string): Timing[] {
  const out: Timing[] = [];
  for (const m of text.matchAll(/:([a-z_]+):/g)) {
    const t = TIMING_GLYPHS[m[1]!];
    if (t && !out.includes(t)) out.push(t);
  }
  return out;
}

/** One sentence of card text → effects, or null when the sentence is not understood. */
function sentenceEffects(raw: string): Effect[] | null {
  const s = raw
    .replace(/:(instant|activation|map_effect|ongoing|permanent):/g, "")
    .replace(/^\s*(then,?|and)\s+/i, "")
    .replace(/[.\s]+$/, "")
    .trim();
  if (s === "") return [];
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(?:gain )?\+(\d+) :(attack|defense|power):$/i))) {
    return [{ kind: m[2] as "attack" | "defense" | "power", n: Number(m[1]) }];
  }
  if ((m = s.match(/^\+(\d+) :power: for spells from School of (Air|Earth|Fire|Water) Magic$/i))) {
    return [{ kind: "power", n: Number(m[1]), school: m[2]!.toLowerCase() as School }];
  }
  if ((m = s.match(/^draw (\d+|a) cards?(?: from your deck)?$/i))) return [{ kind: "draw", n: m[1] === "a" ? 1 : Number(m[1]) }];
  if ((m = s.match(/^gain (\d+) :(gold|building_materials|valuables):$/i))) {
    return [{ kind: "gain", resources: { [RESOURCE_GLYPHS[m[2]!]!]: Number(m[1]) } }];
  }
  if ((m = s.match(/^(?:your hero|chosen hero|your hero model) gains? \+(\d+) (?::movement_points:|movement)$/i))) {
    return [{ kind: "mp", n: Number(m[1]) }];
  }
  if (/^gain a :positive_morale:(?: token)?$/i.test(s)) return [{ kind: "morale" }];
  if ((m = s.match(/^search ?\((\d+)\) :(spell|artifact):$/i))) {
    return [{ kind: "search", deck: m[2] as DeckName, n: Number(m[1]) }];
  }
  if ((m = s.match(/^search ?\((\d+)\) the (ability|spell|artifact) deck$/i))) {
    return [{ kind: "search", deck: m[2]!.toLowerCase() as DeckName, n: Number(m[1]) }];
  }
  if ((m = s.match(/^play this card before taking a search action, then do search ?\((\d+)\) instead$/i))) {
    return [{ kind: "search-size", n: Number(m[1]) }];
  }
  if ((m = s.match(/^remove (?:up to )?(\d+) :damage: from one of your units$/i))) return [{ kind: "heal", n: Number(m[1]) }];
  if ((m = s.match(/^the selected unit suffers:? (\d+) ?:damage:$/i))) return [{ kind: "damage", n: Number(m[1]) }];
  if ((m = s.match(/^gain (\d+) :experience:$/i))) return [{ kind: "experience", n: Number(m[1]) }];
  if (
    (m = s.match(
      /^(?:until the end of the combat|for this combat),? (?:the|your) selected unit(?:'s)? (?:gains|:health_points: is increased by|:initiative: is increased by):? \+?(\d+) :(attack|defense|initiative|health_points):$/i,
    ))
  ) {
    const stat = m[2] === "health_points" ? "hp" : (m[2] as BuffStat);
    return [{ kind: "buff", stat, n: Number(m[1]) }];
  }
  if (/^(?:play this card (?:immediately )?after casting a spell\.? )?instead of discarding the spell card, take it back (?:in)?to your hand$/i.test(s)) {
    return [{ kind: "recall-spell" }];
  }
  if (/^play this card (?:immediately )?after casting a spell$/i.test(s)) return [];
  if ((m = s.match(/^during this combat round, your spell limit increases by (\d+)$/i))) return [{ kind: "spell-limit", n: Number(m[1]) }];
  return null;
}

/** Whole effect text → effects, or null if any part of it needs the players. */
export function parseEffects(text: string): Effect[] | null {
  const sentences = text
    .split(/\n+|(?<=\.)\s+(?=[A-Z:])/)
    .map((x) => x.trim())
    .filter(Boolean);
  const out: Effect[] = [];
  for (const s of sentences) {
    const e = sentenceEffects(s);
    if (e === null) return null;
    out.push(...e);
  }
  return out.length > 0 ? out : null;
}

function option(text: string, expert = false, power = 0): CardOption {
  return { text, timing: timingOf(text), expert, power, effects: parseEffects(text) };
}

export function splitOr(text: string): string[] {
  return text
    .split(/\n*— OR —\n*/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Spell options, one per empower tier (`:power: 1 ➣ 2 :damage:`). The tier's result completes the
 * sentence before the list, so "The selected unit suffers:" + "2 :damage:" reads as one effect.
 */
function spellOptions(text: string): CardOption[] {
  const lines = text.split("\n");
  const tiers = lines.filter((l) => /^:power: \d+ ➣/.test(l));
  if (tiers.length === 0) return [option(text)];
  const base = lines.filter((l) => !/^:power: \d+ ➣/.test(l)).join("\n").trim();
  return tiers.map((tier) => {
    const m = tier.match(/^:power: (\d+) ➣ (.*)$/)!;
    const power = Number(m[1]);
    const result = m[2]!.trim();
    const full = base.includes("*") ? base.replace(/\*/g, result.replace(/^\*/, "")) : `${base} ${result}`;
    const o = option(`${base}\n${tier}`, false, power);
    o.effects = parseEffects(full.replace(/:\s+(?=[+\d])/g, ": "));
    return o;
  });
}

const cache = new Map<string, CardInfo>();

export function cardInfo(ref: string): CardInfo {
  const hit = cache.get(ref);
  if (hit) return hit;
  const [kind, id, extra] = ref.split(":") as [CardKind, string, string | undefined];
  let info: CardInfo;
  switch (kind) {
    case "stat":
    case "stat+": {
      const c = getStatistic(id);
      info = {
        ref,
        kind,
        id,
        name: c.name,
        image: kind === "stat" ? c.image : c.empoweredImage,
        deck: null,
        school: null,
        options: kind === "stat" ? [option(c.basic), option(c.expert, true)] : [option(c.empowered)],
      };
      break;
    }
    case "ability":
    case "ability+": {
      const c = getAbility(id);
      info = {
        ref,
        kind,
        id,
        name: c.name,
        image: kind === "ability" ? c.image : c.empoweredImage,
        deck: "ability",
        school: null,
        options: kind === "ability" ? [option(c.basic), option(c.expert, true)] : splitOr(c.empowered ?? c.expert).map((t) => option(t)),
      };
      break;
    }
    case "spell": {
      const c = getSpell(id);
      info = { ref, kind, id, name: c.name, image: c.image, deck: "spell", school: c.school, options: spellOptions(c.text) };
      break;
    }
    case "artifact": {
      const c = getArtifact(id);
      info = { ref, kind, id, name: c.name, image: c.image, deck: "artifact", school: null, options: c.effects.map((t) => option(t)) };
      break;
    }
    case "specialty": {
      const h = getHero(id);
      const s = h.specialties[Number(extra)]!;
      info = {
        ref,
        kind,
        id,
        name: `${h.specialtyName} ${["I", "IV", "VI"][Number(extra)]}`,
        image: s.image,
        deck: null,
        school: null,
        options: splitOr(s.text).map((t) => option(t)),
      };
      break;
    }
    default:
      throw new Error(`unknown card "${ref}"`);
  }
  cache.set(ref, info);
  return info;
}

export function cardRef(deck: DeckName, id: string): string {
  return `${deck}:${id}`;
}
