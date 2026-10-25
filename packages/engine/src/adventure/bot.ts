/**
 * The computer players. Neutral Units and AI-run armies fight with the AI rules (p. 48); computer
 * players of a Clash use a simple greedy plan: build, recruit, then send the Hero to the most
 * rewarding Field it can safely reach. Everything is deterministic, so bot games replay from their record.
 */
import { getTown, getVariant, type BuildingSlot } from "@heroes/data";
import { aiUnitAction } from "../combat/ai.ts";
import { getUnitByUid, waitingFor } from "../combat/engine.ts";
import type { CombatAction, Side } from "../combat/types.ts";
import { handLimit, playerLevel } from "./cardplay.ts";
import { fieldAt, tileHexes } from "./core.ts";
import { actingPlayer, applyInPlace, currentPlayer, discoverableTiles, getHero, getPlayer, IllegalAction, legalMoves, sidePlayer, stepAdventure, totalMp } from "./engine.ts";
import { hexKey, hexNeighbors, sameHex, type Hex } from "./hex.ts";
import { categoryOf } from "./locations.ts";
import { buildable, canAfford, canReinforce, recruitable } from "./town.ts";
import type { AdventureAction, AdventureState, ArmyUnit, Hero, Player, PlayerId } from "./types.ts";
import { aiHeroTurnAction, aiPicks, isAiHero } from "./aihero.ts";

function isLegal(state: AdventureState, action: AdventureAction): boolean {
  try {
    stepAdventure(state, action);
    return true;
  } catch (e) {
    if (e instanceof IllegalAction) return false;
    throw e;
  }
}

const costOf = (c: { gold: number; buildingMaterials: number; valuables: number } | null) => ({
  gold: c?.gold ?? 0,
  buildingMaterials: c?.buildingMaterials ?? 0,
  valuables: c?.valuables ?? 0,
});

/** Rough fighting strength of some units. */
export function armyPower(units: ArmyUnit[]): number {
  return units.slice(0, 5).reduce((sum, u) => {
    const v = getVariant(u.unitId, u.variant);
    return sum + v.attack * 2 + v.defense * 2 + v.hp;
  }, 0);
}

/** What a computer player needs to beat a Field's guards: Difficulty I ≈ one Bronze unit, VII ≈ a strong army. */
const guardPower = (difficulty: number) => 8 + difficulty * 9;

// ---------------------------------------------------------------------------
// Combat

/** A computer side's answer in Combat; null when another side must answer. */
function combatAction(state: AdventureState, controls: (side: Side) => boolean): CombatAction | null {
  if (state.phase.type !== "combat") return null;
  const c = state.phase.combat;
  const ph = c.phase;
  if (ph.type === "activation") {
    const u = getUnitByUid(c, ph.uid);
    return controls(u.side) ? aiUnitAction(c, u.uid) : null;
  }
  if (ph.type === "reaction") {
    const side = waitingFor(c).find(controls);
    return side ? { type: "pass", side } : null;
  }
  if (ph.type === "round-end") {
    const side = waitingFor(c)[0]!;
    if (!controls(side)) return null;
    const hero = getHero(state, state.phase.context.attackerHero);
    return totalMp(hero) >= 1 ? { type: "continue" } : { type: "retreat" };
  }
  return null;
}

/** Kept for callers that only need a Combat move whoever acts (tests, quick simulations). */
export function combatBotAction(state: AdventureState): CombatAction | null {
  return combatAction(state, () => true);
}

// ---------------------------------------------------------------------------
// Map

/** Steps from the Hero to every Field it can walk to, stopping at Fields that would start a fight or a visit. */
function distances(state: AdventureState, hero: Hero): Map<string, { hex: Hex; dist: number; first: Hex | null }> {
  const out = new Map<string, { hex: Hex; dist: number; first: Hex | null }>();
  out.set(hexKey(hero.pos), { hex: hero.pos, dist: 0, first: null });
  let frontier = [{ hex: hero.pos, first: null as Hex | null }];
  for (let d = 1; frontier.length && d < 30; d++) {
    const next: typeof frontier = [];
    for (const { hex, first } of frontier) {
      for (const n of hexNeighbors(hex)) {
        const k = hexKey(n);
        if (out.has(k)) continue;
        const info = fieldAt(state, n);
        if (!info || !info.tile.faceUp || categoryOf(info.field.location) === "blocked") continue;
        if (state.heroes.some((h) => h.owner === hero.owner && sameHex(h.pos, n))) continue;
        const step = { hex: n, dist: d, first: first ?? n };
        out.set(k, step);
        // Only walk on through Fields that cost nothing to cross.
        if (stopsHere(state, hero, n)) continue;
        next.push({ hex: n, first: step.first });
      }
    }
    frontier = next;
  }
  return out;
}

function guarded(state: AdventureState, hex: Hex): number | null {
  const info = fieldAt(state, hex);
  const d = info?.field.difficulty ?? null;
  return d !== null && !state.marks[hexKey(hex)]?.cleared ? d : null;
}

/** Whether stepping on a Field does something (fight, visit, flag), so a walk should not cross it by accident. */
function stopsHere(state: AdventureState, hero: Hero, hex: Hex): boolean {
  const loc = fieldAt(state, hex)!.field.location;
  const marks = state.marks[hexKey(hex)];
  if (state.heroes.some((h) => h.owner !== hero.owner && sameHex(h.pos, hex))) return true;
  if (guarded(state, hex) !== null) return true;
  switch (categoryOf(loc)) {
    case "empty":
      return false;
    case "flaggable":
      return marks?.flag !== hero.owner;
    case "visitable":
      return !marks?.blackCube;
    default:
      return true;
  }
}

/** How much a computer player wants to end its walk on a Field (0: not at all). */
function fieldValue(state: AdventureState, p: Player, hero: Hero, hex: Hex): number {
  const info = fieldAt(state, hex)!;
  const loc = info.field.location;
  const marks = state.marks[hexKey(hex)];
  const power = armyPower(p.army);
  const guard = guarded(state, hex);
  if (guard !== null && power < guardPower(guard)) return 0;
  const enemy = state.heroes.find((h) => h.owner !== p.id && sameHex(h.pos, hex));
  if (enemy) {
    const theirs = armyPower(getPlayer(state, enemy.owner).army);
    return power > theirs * 1.3 ? 12 : 0;
  }
  const cat = categoryOf(loc);
  let value = 0;
  if (cat === "flaggable" && marks?.flag !== p.id) {
    const ownerTown = (loc === "town" || loc === "random_town") && marks?.flag && marks.flag !== p.id;
    value = ownerTown ? (power > 60 ? 15 : 0) : loc === "mine" || loc === "settlement" ? 10 : 8;
  } else if (cat === "visitable" && !marks?.blackCube) value = 6;
  else if (cat === "revisitable" && loc !== "trading_post") value = hero.kind === "main" ? 2 : 1;
  if (guard !== null && value) value += 3 + guard; // beating guards also gives experience
  return value;
}

function heroPlan(state: AdventureState, p: Player, hero: Hero, salt: number): AdventureAction[] {
  if (totalMp(hero) < 1) return [];
  const out: AdventureAction[] = [];
  const reach = distances(state, hero);
  let best: { first: Hex; score: number } | null = null;
  for (const { hex, dist, first } of reach.values()) {
    if (!first || dist > 12) continue;
    const v = fieldValue(state, p, hero, hex);
    if (!v) continue;
    const score = v / (dist + 1) + ((salt + dist) % 7) / 1000;
    if (!best || score > best.score) best = { first, score };
  }
  if (best) out.push({ type: "move", heroId: hero.id, to: best.first });
  for (const tile of discoverableTiles(state, hero.id)) out.push({ type: "discover", heroId: hero.id, center: tile.center, rotation: 0 });
  // Head for the nearest Field next to a face-down tile, so there is something to discover next.
  let explore: { first: Hex; dist: number } | null = null;
  for (const { hex, dist, first } of reach.values()) {
    if (!first || (stopsHere(state, hero, hex) && !fieldValue(state, p, hero, hex))) continue;
    const nearHidden = hexNeighbors(hex).some((n) => {
      const t = state.tiles.find((x) => !x.faceUp && tileHexes(x).some((h) => sameHex(h, n)));
      return t !== undefined;
    });
    if (nearHidden && (!explore || dist < explore.dist)) explore = { first, dist };
  }
  if (explore) out.push({ type: "move", heroId: hero.id, to: explore.first });
  return out;
}

const BUILD_ORDER: BuildingSlot[] = ["dwelling_silver", "citadel", "dwelling_gold", "mage_guild", "special_1", "special_2"];

function townPlan(p: Player): AdventureAction[] {
  const out: AdventureAction[] = [];
  const town = getTown(p.faction);
  for (const slot of BUILD_ORDER.filter((s) => buildable(p).includes(s))) {
    const b = town.buildings.find((x) => x.slot === slot)!;
    if (canAfford(p, costOf(b.cost))) out.push({ type: "build", slot });
  }
  if (!p.town.used.population) {
    // Recruit the strongest units first, then reinforce, while the money lasts.
    const left = { ...p.resources };
    const fits = (c: ReturnType<typeof costOf>) =>
      left.gold >= c.gold && left.buildingMaterials >= c.buildingMaterials && left.valuables >= c.valuables;
    const take = (c: ReturnType<typeof costOf>) => {
      left.gold -= c.gold;
      left.buildingMaterials -= c.buildingMaterials;
      left.valuables -= c.valuables;
    };
    const recruits = recruitable(p)
      .sort((a, b) => armyPower([{ unitId: b, variant: "few" }]) - armyPower([{ unitId: a, variant: "few" }]))
      .filter((id) => {
        const c = costOf(getVariant(id, "few").cost);
        if (!fits(c)) return false;
        take(c);
        return true;
      });
    const reinforce = p.army
      .map((_, i) => i)
      .filter((i) => canReinforce(p, i))
      .filter((i) => {
        const c = costOf(getVariant(p.army[i]!.unitId, "pack").cost);
        if (!fits(c)) return false;
        take(c);
        return true;
      });
    if (recruits.length + reinforce.length) out.push({ type: "recruit", recruit: recruits, reinforce });
  }
  return out;
}

/** Candidate actions for `player`, most wanted first. */
function candidates(state: AdventureState, player: PlayerId): AdventureAction[] {
  const ph = state.phase;
  const salt = state.log.length + state.round * 31;
  switch (ph.type) {
    case "refresh": {
      const p = getPlayer(state, ph.player);
      const extra = Math.max(0, p.hand.length - handLimit(playerLevel(state, p.id)));
      return [{ type: "refresh", discard: Array.from({ length: extra }, (_, i) => i) }];
    }
    case "search":
      return [ph.revealed ? { type: "search-pick", index: 0 } : { type: "search", mode: "look" }];
    case "choice": {
      const c = ph.choice;
      if (c.kind === "discover") {
        return discoverableTiles(state, c.heroId).map((t) => ({ type: "discover", heroId: c.heroId, center: t.center, rotation: 0 }));
      }
      if (c.kind === "settlement") return [{ type: "settlement", resource: "gold" }];
      const n = c.kind === "options" ? c.options.length : c.kind === "resource-die" || c.kind === "treasure-die" ? c.faces.length : 3;
      return Array.from({ length: n }, (_, i) => ({ type: "choose", option: i }));
    }
    case "siege-decision":
      return [{ type: "siege", defend: true }, { type: "siege", defend: false }];
    case "combat-setup": {
      const army = getPlayer(state, player).army;
      const strongest = army
        .map((u, i) => ({ i, power: armyPower([u]), ranged: getVariant(u.unitId, u.variant).type === "ranged" }))
        .sort((a, b) => b.power - a.power)
        .slice(0, 5);
      return [{ type: "combat-setup", picks: strongest.map((x) => ({ armyIndex: x.i, line: x.ranged ? "back" : "front" })) }];
    }
    case "combat": {
      const ctx = ph.context;
      const a = combatAction(state, (side) => sidePlayer(state, ctx, side) === player);
      return a ? [{ type: "combat", action: a }] : [];
    }
    case "turn": {
      const p = currentPlayer(state);
      const heroes = state.heroes.filter((h) => h.owner === p.id);
      return [...townPlan(p), ...heroes.flatMap((h) => heroPlan(state, p, h, salt)), { type: "end-turn" }];
    }
    case "over":
      return [];
  }
}

/** The first legal candidate for `player` (default: whoever must act), or null. */
export function botAction(state: AdventureState, player: PlayerId | null = actingPlayer(state)): AdventureAction | null {
  if (state.phase.type === "combat" && player === null) {
    const a = combatBotAction(state);
    return a ? { type: "combat", action: a } : null;
  }
  if (player === null) return null;
  return candidates(state, player).find((a) => isLegal(state, a)) ?? null;
}

/** The move the engine makes on its own right now: Neutral Units under the AI rules, or a computer player. */
export function automatedAction(state: AdventureState): AdventureAction | null {
  const ph = state.phase;
  if (ph.type === "over") return null;
  const bots = state.ai.players;
  if (ph.type === "combat") {
    const ctx = ph.context;
    const c = ph.combat;
    // AI Heroes draw an AI card each time one of their units activates (p. 50).
    if (c.phase.type === "activation") {
      const owner = sidePlayer(state, ctx, getUnitByUid(c, c.phase.uid).side);
      if (owner && isAiHero(state, owner) && state.ai.heroes[owner]!.drawnFor !== `${c.round}:${c.phase.uid}`) return { type: "ai-card" };
    }
    const a = combatAction(state, (side) => {
      const owner = sidePlayer(state, ctx, side);
      return owner === null ? state.ai.neutrals : bots.includes(owner) || isAiHero(state, owner);
    });
    return a ? { type: "combat", action: a } : null;
  }
  const who = actingPlayer(state);
  if (who && isAiHero(state, who)) {
    if (ph.type === "turn") return aiHeroTurnAction(state, who);
    if (ph.type === "combat-setup") return { type: "combat-setup", picks: aiPicks(getPlayer(state, who).army) };
    return botAction(state, who);
  }
  return who && bots.includes(who) ? botAction(state, who) : null;
}

/** Plays every automated move until a human must act (bounded, in case a bot gets stuck). */
export function runAutomation(state: AdventureState) {
  for (let i = 0; i < 2000; i++) {
    const a = automatedAction(state);
    if (!a) return;
    applyInPlace(state, a);
  }
}
