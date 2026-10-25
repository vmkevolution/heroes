/**
 * The Main Hero's Deck of Might & Magic (p. 21–28): drawing, Searching, Level ups and playing cards.
 */
import { getHero as heroCard } from "@heroes/data";
import { IllegalAction } from "../combat/engine.ts";
import type { Side } from "../combat/types.ts";
import { shuffle } from "./dice.ts";
import { cardInfo, type CardInfo, type DeckName, type Effect } from "./cards.ts";
import { changeMorale, gain, gainMp, getHero, getPlayer, levelFor, log } from "./core.ts";
import type { AdventureAction, AdventureState, CombatContext, Hero, Player, PlayerId, Task } from "./types.ts";

/** Hand Limit from the Level Tracker: 4 → 5 (III) → 6 (V) → 7 (VII) (p. 21). */
export const handLimit = (level: number) => (level >= 7 ? 7 : level >= 5 ? 6 : level >= 3 ? 5 : 4);
/** Expert Effects per Round: one more at Levels II, IV and VI (p. 21). */
export const expertLimit = (level: number) => (level >= 6 ? 3 : level >= 4 ? 2 : level >= 2 ? 1 : 0);
/** Levels that Search (2) the Ability Deck, and the ones that give Specialty IV and VI (p. 21). */
const ABILITY_LEVELS = [2, 3, 5, 7];
const SPECIALTY_LEVELS: Record<number, number> = { 4: 1, 6: 2 };

export function mainHero(state: AdventureState, player: PlayerId): Hero | undefined {
  return state.heroes.find((h) => h.owner === player && h.kind === "main");
}

export function playerLevel(state: AdventureState, player: PlayerId): number {
  return levelFor(mainHero(state, player)?.experience ?? 0);
}

// ---------------------------------------------------------------------------
// Piles

/** Draws `n` cards from the player's Deck, reshuffling the Discard Pile when it runs out (p. 22). */
export function drawCards(state: AdventureState, p: Player, n: number) {
  let drawn = 0;
  for (let i = 0; i < n; i++) {
    if (p.deck.length === 0) {
      if (p.discard.length === 0) break;
      p.deck = p.discard;
      p.discard = [];
      state.rng = shuffle(p.deck, state.rng);
    }
    p.hand.push(p.deck.pop()!);
    drawn += 1;
  }
  if (drawn > 0) log(state, { type: "draw", player: p.id, n: drawn });
}

/** Keeps a shared pile playable: an empty Deck is rebuilt from its Discard Pile, an empty Discard Pile gets the Deck's top card (p. 22). */
function tidyPile(state: AdventureState, name: DeckName) {
  const pile = state.decks[name];
  if (pile.deck.length === 0 && pile.discard.length > 0) {
    pile.deck = pile.discard;
    pile.discard = [];
    state.rng = shuffle(pile.deck, state.rng);
    pile.discard.push(pile.deck.pop()!);
  }
  if (pile.discard.length === 0 && pile.deck.length > 0) pile.discard.push(pile.deck.pop()!);
}

/** Takes the top card of a shared Deck. */
export function takeFromDeck(state: AdventureState, name: DeckName): string | null {
  const pile = state.decks[name];
  if (pile.deck.length === 0) tidyPile(state, name);
  const card = pile.deck.pop() ?? null;
  tidyPile(state, name);
  return card;
}

export function gainCard(state: AdventureState, p: Player, card: string, source: string) {
  p.hand.push(card);
  log(state, { type: "gain-card", player: p.id, card, source });
}

/** Where a card goes when it leaves play: cards always join their owner's Discard Pile (p. 22). */
function discardCard(p: Player, card: string) {
  p.discard.push(card);
}

/** Cards that can never be Removed from the hand at a Trading Post or a Faerie Ring (p. 52; wiki). */
export function isRemovable(p: Player, card: string): boolean {
  const info = cardInfo(card);
  if (info.kind === "stat" || info.kind === "stat+" || info.kind === "specialty") return false;
  if (card === "spell:magic_arrow") return false;
  if (info.kind === "ability" && info.id === heroCard(p.hero).ability) return false;
  return true;
}

export function removeFromHand(state: AdventureState, p: Player, index: number): string {
  const card = p.hand[index];
  if (!card) throw new IllegalAction("no such card in hand");
  p.hand.splice(index, 1);
  log(state, { type: "remove-card", player: p.id, card });
  return card;
}

// ---------------------------------------------------------------------------
// Tasks: steps queued behind the current one

/** Puts tasks first in line (rewards are resolved before anything already waiting). */
export function queueFirst(state: AdventureState, ...tasks: Task[]) {
  state.queue.unshift(...tasks);
}

/** Starts the next queued step if the game is back at the Turn. */
export function flushQueue(state: AdventureState) {
  while (state.phase.type === "turn" && state.queue.length > 0) {
    const task = state.queue.shift()!;
    const p = state.players.find((x) => x.id === task.player);
    if (!p || p.eliminated) continue;
    switch (task.kind) {
      case "refresh":
        if (p.hand.length === 0) {
          drawCards(state, p, handLimit(playerLevel(state, p.id)));
          continue;
        }
        state.phase = { type: "refresh", player: p.id };
        break;
      case "search":
        startSearch(state, p, task.deck, task.n, task.source, task.fromDiscard ?? false);
        break;
      case "choice": {
        const hero = mainHero(state, p.id);
        if (!hero || task.options.length === 0) continue;
        state.phase = { type: "choice", choice: { kind: "options", heroId: hero.id, source: task.source, options: task.options } };
        break;
      }
    }
  }
}

function startSearch(state: AdventureState, p: Player, deck: DeckName, n: number, source: string, fromDiscard: boolean) {
  tidyPile(state, deck);
  const pile = state.decks[deck];
  if (pile.deck.length === 0 && pile.discard.length === 0) return;
  state.phase = { type: "search", player: p.id, deck, n, revealed: null, fromDiscard, source };
}

// ---------------------------------------------------------------------------
// Start of Turn, Searching

export function applyRefresh(state: AdventureState, discard: number[]) {
  const ph = state.phase;
  if (ph.type !== "refresh") throw new IllegalAction("no hand to refresh");
  const p = getPlayer(state, ph.player);
  const limit = handLimit(playerLevel(state, p.id));
  const idx = [...new Set(discard)].sort((a, b) => b - a);
  if (idx.some((i) => i < 0 || i >= p.hand.length)) throw new IllegalAction("no such card in hand");
  if (p.hand.length - idx.length > limit) throw new IllegalAction(`discard down to your Hand Limit of ${limit} (p. 17)`);
  for (const i of idx) discardCard(p, p.hand.splice(i, 1)[0]!);
  drawCards(state, p, limit - p.hand.length);
  state.phase = { type: "turn" };
}

export function applySearch(state: AdventureState, action: Extract<AdventureAction, { type: "search" | "search-pick" }>) {
  const ph = state.phase;
  if (ph.type !== "search") throw new IllegalAction("nothing to Search");
  const p = getPlayer(state, ph.player);
  const pile = state.decks[ph.deck];
  if (action.type === "search") {
    if (ph.revealed) throw new IllegalAction("already looking at the cards");
    if (action.mode === "discard-pile") {
      if (ph.fromDiscard) throw new IllegalAction("pick from the Discard Pile directly");
      const card = pile.discard.pop();
      if (!card) throw new IllegalAction("the Discard Pile is empty");
      gainCard(state, p, card, ph.source);
      tidyPile(state, ph.deck);
      state.phase = { type: "turn" };
      return;
    }
    const revealed: string[] = [];
    if (ph.fromDiscard) {
      for (let i = 0; i < ph.n && pile.discard.length > 0; i++) revealed.push(pile.discard.pop()!);
    } else {
      for (let i = 0; i < ph.n; i++) {
        if (pile.deck.length === 0) tidyPile(state, ph.deck);
        const c = pile.deck.pop();
        if (!c) break;
        revealed.push(c);
      }
    }
    if (revealed.length === 0) throw new IllegalAction("no cards to look at");
    ph.revealed = revealed;
    return;
  }
  if (!ph.revealed) throw new IllegalAction("look at the cards first");
  const card = ph.revealed[action.index];
  if (!card) throw new IllegalAction("pick one of the cards you looked at");
  gainCard(state, p, card, ph.source);
  // The others go to the Discard Pile (p. 22).
  ph.revealed.forEach((c, i) => {
    if (i !== action.index) pile.discard.push(c);
  });
  tidyPile(state, ph.deck);
  state.phase = { type: "turn" };
}

// ---------------------------------------------------------------------------
// Experience and Level ups (p. 21)

export function gainExperience(state: AdventureState, hero: Hero, amount: number) {
  if (hero.kind !== "main" || amount <= 0) return; // Secondary Heroes never gain Experience (p. 20)
  hero.experience = Math.min(hero.experience + amount, 12);
  log(state, { type: "experience", heroId: hero.id, amount, level: levelFor(hero.experience) });
  rewardLevels(state, hero);
}

export function rewardLevels(state: AdventureState, hero: Hero) {
  const p = getPlayer(state, hero.owner);
  const level = levelFor(hero.experience);
  const tasks: Task[] = [];
  for (let l = p.levelRewarded + 1; l <= level; l++) {
    log(state, { type: "level-up", player: p.id, level: l });
    if (ABILITY_LEVELS.includes(l)) tasks.push({ kind: "search", player: p.id, deck: "ability", n: 2, source: "level-up" });
    const specialty = SPECIALTY_LEVELS[l];
    if (specialty !== undefined) gainCard(state, p, `specialty:${p.hero}:${specialty}`, "level-up");
  }
  p.levelRewarded = Math.max(p.levelRewarded, level);
  queueFirst(state, ...tasks);
}

// ---------------------------------------------------------------------------
// Playing cards (p. 22–27)

/** The combat side whose Main Hero belongs to `player`: only a Main Hero plays cards in Combat (p. 20, 22). */
export function cardSide(state: AdventureState, ctx: CombatContext, player: PlayerId): Side | null {
  const attacker = getHero(state, ctx.attackerHero);
  if (attacker.owner === player && attacker.kind === "main") return "attacker";
  if (ctx.foe.kind === "hero") {
    const d = getHero(state, ctx.foe.heroId);
    if (d.owner === player && d.kind === "main") return "defender";
  }
  return null;
}

function spellState(ctx: CombatContext, side: Side, round: number) {
  ctx.spells ??= {};
  let s = ctx.spells[side];
  if (!s || s.round !== round) s = ctx.spells[side] = { round, cast: 0, limit: 1, last: null };
  return s;
}

/** Power a card gives when played to empower a Spell (p. 26): its +Power effect, or +1 for any Spell. */
function powerOf(info: CardInfo, option: number): number {
  if (info.kind === "spell") return 1;
  const fx = info.options[option]?.effects ?? [];
  return fx.reduce((n, e) => n + (e.kind === "power" && !e.school ? e.n : 0), 0);
}

export interface PlayResult {
  /** Combat actions the engine must run for the card, in order. */
  combat: import("../combat/types.ts").CombatAction[];
}

export function playCard(state: AdventureState, a: Extract<AdventureAction, { type: "play-card" }>): PlayResult {
  const p = getPlayer(state, a.player);
  const ph = state.phase;
  const card = p.hand[a.handIndex];
  if (!card) throw new IllegalAction("no such card in hand");
  const info = cardInfo(card);
  const opt = info.options[a.option];
  if (!opt) throw new IllegalAction("pick one of the card's effects");
  if (info.id === "necromancy" && p.faction !== "necropolis") throw new IllegalAction("only Necropolis can use Necromancy cards (p. 24)");

  let side: Side | null = null;
  let ctx: CombatContext | null = null;
  if (ph.type === "combat") {
    ctx = ph.context;
    side = cardSide(state, ctx, p.id);
    if (!side) throw new IllegalAction("only a Main Hero in this Combat can play cards (p. 22)");
    if (opt.timing.includes("map")) throw new IllegalAction("Map effects cannot be used during Combat (p. 22)");
    if (opt.timing.includes("activation")) {
      const cph = ph.combat.phase;
      const active = cph.type === "activation" ? ph.combat.units.find((u) => u.uid === cph.uid) : null;
      if (!active || active.side !== side) throw new IllegalAction("play Activation effects when activating your own unit (p. 22)");
    }
  } else if (ph.type === "search") {
    if (ph.player !== p.id || ph.revealed) throw new IllegalAction("only before looking at the cards");
    if (!opt.effects?.some((e) => e.kind === "search-size")) throw new IllegalAction("only cards that change the Search can be played now");
  } else if (ph.type === "turn") {
    if (state.players[state.current]!.id !== p.id) throw new IllegalAction("cards are played on your own Turn (p. 22)");
    if (opt.timing.includes("activation")) throw new IllegalAction("Activation effects are played in Combat (p. 22)");
  } else {
    throw new IllegalAction("finish the current step first");
  }

  // Expert Effects available this Round (p. 24).
  const empower = a.empower ?? [];
  const used = [a.handIndex, ...empower.map((e) => e.handIndex)];
  if (new Set(used).size !== used.length) throw new IllegalAction("each card is played once");
  let experts = opt.expert ? 1 : 0;
  let power = 0;
  for (const e of empower) {
    const c = p.hand[e.handIndex];
    if (!c) throw new IllegalAction("no such card in hand");
    const ci = cardInfo(c);
    if (!ci.options[e.option]) throw new IllegalAction("pick one of the card's effects");
    if (ci.options[e.option]!.expert) experts += 1;
    power += powerOf(ci, e.option);
  }
  if (p.expertUsed + experts > expertLimit(playerLevel(state, p.id))) {
    throw new IllegalAction("no Expert Effect left this Round (p. 24)");
  }

  const result: PlayResult = { combat: [] };
  if (info.kind === "spell") {
    const school = info.school ?? a.school ?? null;
    if (p.permanent) {
      for (const e of cardInfo(p.permanent).options.flatMap((o) => o.effects ?? [])) {
        if (e.kind === "power" && e.school && e.school === school) power += e.n;
      }
    }
    if (power < opt.power) throw new IllegalAction(`this effect needs ${opt.power} Power (p. 26)`);
    if (ctx && side) {
      const s = spellState(ctx, side, ph.type === "combat" ? ph.combat.round : 0);
      if (s.cast >= s.limit) throw new IllegalAction("one Spell per Combat Round (p. 26)");
      s.cast += 1;
      s.last = card;
    }
  } else if (empower.length > 0) {
    throw new IllegalAction("only Spells are empowered");
  }

  // The played cards leave the hand.
  const empowerCards = empower.map((e) => p.hand[e.handIndex]!);
  for (const i of [...used].sort((x, y) => y - x)) p.hand.splice(i, 1);
  for (const c of empowerCards) discardCard(p, c);
  if (opt.timing.includes("permanent")) {
    if (p.permanent) discardCard(p, p.permanent);
    p.permanent = card;
  } else {
    discardCard(p, card);
  }
  p.expertUsed += experts;
  log(state, { type: "play-card", player: p.id, card, option: a.option, automated: !!opt.effects, empower: empowerCards });

  for (const e of opt.effects ?? []) applyEffect(state, p, e, a, side, ctx, info.name, result);
  return result;
}

function applyEffect(
  state: AdventureState,
  p: Player,
  e: Effect,
  a: Extract<AdventureAction, { type: "play-card" }>,
  side: Side | null,
  ctx: CombatContext | null,
  source: string,
  out: PlayResult,
) {
  const ph = state.phase;
  const combat = ph.type === "combat" ? ph.combat : null;
  const target = () => {
    if (!combat || !a.target || !combat.units.some((u) => u.uid === a.target)) throw new IllegalAction("choose a unit on the board");
    return a.target;
  };
  switch (e.kind) {
    case "attack":
    case "defense": {
      if (!combat || !side) return; // e.g. Offense played on the map only draws (wiki note)
      const cph = combat.phase;
      if (cph.type !== "reaction") throw new IllegalAction("play this card when an attack is about to be rolled (p. 43)");
      out.combat.push({ type: "modify", side, stat: e.kind, amount: e.n, source });
      return;
    }
    case "power":
    case "search-size":
      if (e.kind === "search-size" && ph.type === "search") ph.n = e.n;
      return;
    case "draw":
      drawCards(state, p, e.n);
      return;
    case "gain":
      gain(state, p.id, e.resources);
      return;
    case "mp": {
      const hero = mainHero(state, p.id);
      if (hero) gainMp(state, hero, e.n);
      return;
    }
    case "morale":
      changeMorale(state, p, +1);
      return;
    case "experience": {
      const hero = mainHero(state, p.id);
      if (hero) gainExperience(state, hero, e.n);
      return;
    }
    case "search":
      queueFirst(state, { kind: "search", player: p.id, deck: e.deck, n: e.n, source: "card" });
      return;
    case "damage":
      if (!combat || !side) return;
      out.combat.push({ type: "effect", side, effect: { kind: "damage", uid: target(), amount: e.n }, source });
      return;
    case "heal":
    case "buff": {
      if (!combat || !side) return;
      const uid = target();
      if (e.kind === "heal") {
        if (combat.units.find((u) => u.uid === uid)?.side !== side) throw new IllegalAction("choose one of your units");
        out.combat.push({ type: "effect", side, effect: { kind: "heal", uid, amount: e.n }, source });
      } else {
        out.combat.push({ type: "effect", side, effect: { kind: "buff", uid, stat: e.stat, amount: e.n }, source });
      }
      return;
    }
    case "recall-spell": {
      // The last Spell cast comes back from the Discard Pile (Knowledge, Mysticism).
      const last = ctx && side ? ctx.spells?.[side]?.last : null;
      let at = last ? p.discard.lastIndexOf(last) : -1;
      for (let i = p.discard.length - 1; at < 0 && i >= 0; i--) if (p.discard[i]!.startsWith("spell:")) at = i;
      if (at >= 0) p.hand.push(p.discard.splice(at, 1)[0]!);
      return;
    }
    case "spell-limit":
      if (ctx && side && combat) spellState(ctx, side, combat.round).limit += e.n;
      return;
  }
}

/** Discards a card from hand without playing it (for effects that ask for a discard). */
export function discardFromHand(state: AdventureState, player: PlayerId, index: number) {
  const p = getPlayer(state, player);
  const card = p.hand[index];
  if (!card) throw new IllegalAction("no such card in hand");
  p.hand.splice(index, 1);
  discardCard(p, card);
}

/** New Round (p. 15): Expert Effects come back. */
export function refreshExperts(state: AdventureState) {
  for (const p of state.players) p.expertUsed = 0;
}
