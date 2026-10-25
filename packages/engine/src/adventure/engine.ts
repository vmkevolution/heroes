/**
 * The Game Map: Rounds, Turns, Hero movement, Map Tiles and Field visits (rule book p. 15–19, 31–35, 73–85).
 *
 * Pure like the combat engine: `applyAdventureAction(state, action)` returns a new state.
 * `state.phase` says what the game waits for. Combat runs inside the adventure state, so a
 * whole game replays from its seed and its list of actions.
 */
import { FACTIONS, getArtifact, getTile, getVariant, units, type Faction, type Resource } from "@heroes/data";
import { nextInt, rollAttackDie, type RngState } from "../rng.ts";
import { applyCombatAction, createCombat, IllegalAction } from "../combat/engine.ts";
import { placeInLines, placeNeutrals } from "../combat/setup.ts";
import type { CombatState, Side } from "../combat/types.ts";
import { rollResourceDie, rollTreasureDie, shuffle } from "./dice.ts";
import { areAdjacent, fieldHex, hexKey, hexNeighbors, sameHex, SNUG_OFFSETS, addHex, type Hex } from "./hex.ts";
import {
  categoryOf,
  GUARDS,
  MINE_OUTPUT,
  NEEDS_DECKS,
  RANDOM_TOWN_GOLD,
  SETTLEMENT_OUTPUT,
  SHARED_FLAG,
} from "./locations.ts";
import { emptyMarks, MAIN_HERO_MP, SECONDARY_HERO_MP } from "./scenario.ts";
import {
  applyRefresh,
  applySearch,
  cardSide,
  discardFromHand,
  drawCards,
  flushQueue,
  gainCard,
  gainExperience,
  isRemovable,
  rewardLevels,
  mainHero,
  playCard,
  queueFirst,
  refreshExperts,
  removeFromHand,
  takeFromDeck,
} from "./cardplay.ts";
import { cardInfo } from "./cards.ts";
import { build, cityHallOptions, cityHallRound, hireHero, recruit, refreshTowns, spellBook, trade } from "./town.ts";
import {
  changeMorale,
  changeProduction,
  currentPlayer,
  gain,
  gainMp,
  getHero,
  getPlayer,
  levelFor,
  log,
  MAX_LEVEL,
  pay,
  fieldAt,
  tileHexes,
  type FieldInfo,
} from "./core.ts";

export { currentPlayer, fieldAt, getHero, getPlayer, levelFor, tileHexes, type FieldInfo };
import type {
  AdventureAction,
  AdventureEvent,
  AdventureState,
  ArmyUnit,
  Choice,
  CombatContext,
  FieldMarks,
  Op,
  Foe,
  Hero,
  NeutralFoe,
  PlacedTile,
  Player,
  PlayerId,
  Resources,
  ResourceFace,
  TreasureFace,
} from "./types.ts";

export { IllegalAction };

const MAX_COMBAT_UNITS = 5;
/** Paying to defend a Town or Settlement without a Hero (p. 46). */
const SIEGE_DEFENSE_COST = 8;
/** A defeated Main Hero pays the winner (p. 44). */
const DEFEAT_PENALTY = 5;
const SURRENDER_COST = 10;
const SECONDARY_HERO_COST = 7; // Tavern (p. 78)

// ---------------------------------------------------------------------------
// Board queries

export function marksAt(state: AdventureState, hex: Hex): FieldMarks {
  return state.marks[hexKey(hex)] ?? emptyMarks();
}

function editMarks(state: AdventureState, hex: Hex): FieldMarks {
  const key = hexKey(hex);
  return (state.marks[key] ??= emptyMarks());
}




export function heroLevel(state: AdventureState, hero: Hero): number {
  // Secondary Heroes count as the Main Hero's Level for Quick Combat (p. 20).
  const main = hero.kind === "main" ? hero : state.heroes.find((h) => h.owner === hero.owner && h.kind === "main");
  return levelFor(main?.experience ?? 0);
}


export const totalMp = (h: Hero) => h.mp + h.bonusMp;

function heroAt(state: AdventureState, hex: Hex): Hero | undefined {
  return state.heroes.find((h) => sameHex(h.pos, hex));
}

/** Fields a Hero can step to with 1 MP right now. */
export function legalMoves(state: AdventureState, heroId: string): Hex[] {
  if (state.phase.type !== "turn") return [];
  const hero = getHero(state, heroId);
  if (hero.owner !== currentPlayer(state).id || totalMp(hero) < 1) return [];
  return hexNeighbors(hero.pos).filter((hex) => {
    const info = fieldAt(state, hex);
    if (!info || !info.tile.faceUp) return false;
    if (categoryOf(info.field.location) === "blocked") return false; // p. 31
    const other = heroAt(state, hex);
    if (other && other.owner === hero.owner) return false; // allied Heroes cannot share a Field (p. 17)
    if (other && info.field.location === "sanctuary") return false; // p. 78
    return true;
  });
}

/** Face-down tiles next to the Hero that 1 MP would discover (p. 32). */
export function discoverableTiles(state: AdventureState, heroId: string): PlacedTile[] {
  const hero = getHero(state, heroId);
  const near = hexNeighbors(hero.pos);
  return state.tiles.filter((t) => !t.faceUp && tileHexes(t).some((h) => near.some((n) => sameHex(n, h))));
}

function occupied(state: AdventureState): Set<string> {
  return new Set(state.tiles.flatMap((t) => tileHexes({ ...t, rotation: 0 }).map(hexKey)));
}

/** Tile centers where a new tile may go: next to the Hero, touching at least two tiles (p. 32). */
export function placementSlots(state: AdventureState, heroId: string): Hex[] {
  const hero = getHero(state, heroId);
  const taken = occupied(state);
  const near = hexNeighbors(hero.pos).map(hexKey);
  const seen = new Set<string>();
  const out: Hex[] = [];
  for (const t of state.tiles) {
    for (const off of SNUG_OFFSETS) {
      const center = addHex(t.center, off);
      const key = hexKey(center);
      if (seen.has(key)) continue;
      seen.add(key);
      const hexes = tileHexes({ tileId: "", group: "far", center, rotation: 0, faceUp: true }).map(hexKey);
      if (hexes.some((h) => taken.has(h))) continue;
      if (!hexes.some((h) => near.includes(h))) continue;
      const touching = state.tiles.filter((o) => SNUG_OFFSETS.some((s) => sameHex(addHex(o.center, s), center)));
      if (touching.length >= 2) out.push(center);
    }
  }
  return out;
}

export function canRevisit(state: AdventureState, heroId: string): boolean {
  if (state.phase.type !== "turn") return false;
  const hero = getHero(state, heroId);
  const info = fieldAt(state, hero.pos);
  return (
    hero.owner === currentPlayer(state).id &&
    totalMp(hero) >= 1 &&
    !!info &&
    categoryOf(info.field.location) === "revisitable"
  );
}

/** Which player must act now (hotseat screens show this). */
export function actingPlayer(state: AdventureState): PlayerId | null {
  const ph = state.phase;
  switch (ph.type) {
    case "turn":
      return currentPlayer(state).id;
    case "choice":
      return getHero(state, ph.choice.heroId).owner;
    case "refresh":
    case "search":
      return ph.player;
    case "siege-decision":
      return ph.defender;
    case "combat-setup":
      return sidePlayer(state, ph.context, ph.side);
    case "combat":
      return null;
    case "over":
      return null;
  }
}

/** The player behind a combat side (null for Neutral Units). */
export function sidePlayer(state: AdventureState, ctx: CombatContext, side: Side): PlayerId | null {
  if (side === "attacker") return getHero(state, ctx.attackerHero).owner;
  switch (ctx.foe.kind) {
    case "neutral":
      return null;
    case "hero":
      return getHero(state, ctx.foe.heroId).owner;
    case "siege":
      return ctx.foe.defender;
  }
}

// ---------------------------------------------------------------------------
// Actions

export function applyAdventureAction(prev: AdventureState, action: AdventureAction): AdventureState {
  const state = structuredClone(prev);
  apply(state, action);
  autoPass(state);
  flushQueue(state);
  return state;
}

function apply(state: AdventureState, action: AdventureAction): AdventureState {
  const ph = state.phase;
  if (ph.type === "over") throw new IllegalAction("the game is over");

  switch (action.type) {
    case "move": {
      if (!legalMoves(state, action.heroId).some((h) => sameHex(h, action.to))) {
        throw new IllegalAction(`${action.heroId} cannot move to ${hexKey(action.to)}`);
      }
      const hero = getHero(state, action.heroId);
      spendMp(hero, 1);
      getPlayer(state, hero.owner).trading = false; // trading lasts while the Hero stays at the Trading Post
      hero.pos = { ...action.to };
      log(state, { type: "move", heroId: hero.id, to: hero.pos });
      enterField(state, hero);
      return state;
    }
    case "revisit": {
      if (!canRevisit(state, action.heroId)) throw new IllegalAction("nothing to revisit here");
      const hero = getHero(state, action.heroId);
      spendMp(hero, 1);
      visit(state, hero);
      return state;
    }
    case "discover": {
      const hero = getHero(state, action.heroId);
      const free = ph.type === "choice" && ph.choice.kind === "discover" && ph.choice.heroId === hero.id;
      if (!free) requireTurn(state, hero, 1);
      const tile = state.tiles.find((t) => !t.faceUp && sameHex(t.center, action.center));
      if (!tile || !discoverableTiles(state, hero.id).includes(tile)) throw new IllegalAction("no face-down tile there");
      if (!free) spendMp(hero, 1);
      tile.faceUp = true;
      tile.rotation = ((action.rotation % 6) + 6) % 6; // tiles may be rotated when revealed (p. 32)
      log(state, { type: "discover", heroId: hero.id, tileId: tile.tileId });
      if (free) state.phase = { type: "turn" };
      return state;
    }
    case "place-tile": {
      const hero = getHero(state, action.heroId);
      requireTurn(state, hero, 1);
      const player = getPlayer(state, hero.owner);
      const tileId = player.tileSupply[action.tileIndex];
      if (!tileId) throw new IllegalAction("no such tile in your supply");
      if (!placementSlots(state, hero.id).some((c) => sameHex(c, action.center))) {
        throw new IllegalAction("a new tile must touch the Hero and two other tiles");
      }
      spendMp(hero, 1);
      player.tileSupply.splice(action.tileIndex, 1);
      state.tiles.push({
        tileId,
        group: getTile(tileId).group,
        center: { ...action.center },
        rotation: ((action.rotation % 6) + 6) % 6,
        faceUp: true,
      });
      log(state, { type: "place-tile", heroId: hero.id, tileId });
      return state;
    }
    case "choose": {
      if (ph.type !== "choice") throw new IllegalAction("no choice pending");
      state.phase = { type: "turn" };
      if (ph.choice.kind === "options") {
        const op = ph.choice.options[action.option];
        if (!op) throw new IllegalAction("pick one of the options");
        resolveOp(state, getHero(state, ph.choice.heroId), op);
      } else {
        resolveChoice(state, ph.choice, action.option);
      }
      return state;
    }
    case "settlement": {
      if (ph.type !== "choice" || ph.choice.kind !== "settlement") throw new IllegalAction("no Settlement to flag");
      const c = ph.choice;
      const hero = getHero(state, c.heroId);
      const m = editMarks(state, c.hex);
      m.settlementResource = action.resource;
      changeProduction(state, hero.owner, action.resource, SETTLEMENT_OUTPUT[action.resource]);
      if (c.free) gain(state, hero.owner, { [action.resource]: SETTLEMENT_OUTPUT[action.resource] });
      state.phase = { type: "turn" };
      return state;
    }
    case "settlement-reinforce": {
      if (ph.type !== "choice" || ph.choice.kind !== "settlement") throw new IllegalAction("no Settlement to flag");
      const c = ph.choice;
      const hero = getHero(state, c.heroId);
      const player = getPlayer(state, hero.owner);
      const unit = player.army[action.armyIndex];
      if (!unit || !canReinforceAtSettlement(unit)) throw new IllegalAction("only a bronze or silver Few can be reinforced");
      const cost = c.free ? 0 : Math.ceil((getVariant(unit.unitId, "pack").cost?.gold ?? 0) / 2);
      pay(state, player, { gold: cost });
      unit.variant = "pack";
      state.phase = { type: "turn" };
      return state;
    }
    case "siege": {
      if (ph.type !== "siege-decision") throw new IllegalAction("no siege pending");
      const hero = getHero(state, ph.heroId);
      const defender = getPlayer(state, ph.defender);
      if (action.defend) {
        if (defender.army.length === 0) throw new IllegalAction("no units to defend with");
        pay(state, defender, { gold: SIEGE_DEFENSE_COST });
        const context: CombatContext = {
          attackerHero: hero.id,
          foe: { kind: "siege", hex: ph.hex, defender: defender.id },
          picks: {},
          placements: {},
        };
        log(state, { type: "combat-start", heroId: hero.id, foe: context.foe });
        state.phase = { type: "combat-setup", context, side: "attacker" };
      } else {
        state.phase = { type: "turn" };
        visit(state, hero);
      }
      return state;
    }
    case "combat-setup": {
      if (ph.type !== "combat-setup") throw new IllegalAction("no combat to set up");
      setupSide(state, ph.context, ph.side, action.picks);
      return state;
    }
    case "combat": {
      if (ph.type !== "combat") throw new IllegalAction("no combat running");
      if (action.action.type === "continue") {
        // Each extra Combat Round against Neutral Units costs 1 MP (p. 17, 43).
        const hero = getHero(state, ph.context.attackerHero);
        if (totalMp(hero) < 1) throw new IllegalAction("no Movement Point left to continue the Combat");
        spendMp(hero, 1);
      }
      ph.combat = applyCombatAction(ph.combat, action.action);
      if (ph.combat.phase.type === "over") finishCombat(state, ph.context, ph.combat);
      return state;
    }
    case "surrender": {
      if (ph.type !== "combat" || ph.context.foe.kind === "neutral") throw new IllegalAction("nobody to surrender to");
      const cph = ph.combat.phase;
      if (cph.type !== "activation" || ph.combat.units.find((u) => u.uid === cph.uid)?.side !== action.side) {
        throw new IllegalAction("surrender instead of activating one of your units (p. 44)");
      }
      if (action.side === "defender" && ph.context.foe.kind === "siege") {
        const town = fieldAt(state, ph.context.foe.hex);
        if (town?.field.location === "town") throw new IllegalAction("you cannot surrender when defending your Town (p. 46)");
      }
      surrender(state, ph.context, ph.combat, action.side);
      return state;
    }
    case "end-turn": {
      if (ph.type !== "turn") throw new IllegalAction("finish the current step first");
      endTurn(state);
      return state;
    }
    case "refresh":
      applyRefresh(state, action.discard);
      return state;
    case "search":
    case "search-pick":
      applySearch(state, action);
      return state;
    case "play-card": {
      const result = playCard(state, action);
      const cph = state.phase;
      if (cph.type === "combat" && result.combat.length > 0) {
        for (const a of result.combat) {
          if (cph.combat.phase.type === "over") break;
          cph.combat = applyCombatAction(cph.combat, a);
        }
        if (cph.combat.phase.type === "over") finishCombat(state, cph.context, cph.combat);
      }
      return state;
    }
    case "discard-card":
      discardFromHand(state, action.player, action.handIndex);
      return state;
    case "build":
      build(state, action.slot);
      return state;
    case "recruit":
      recruit(state, action.recruit, action.reinforce);
      return state;
    case "hire-hero":
      hireHero(state, action.at);
      return state;
    case "spell-book":
      spellBook(state);
      return state;
    case "trade":
      trade(state, action.sell, action.buy, action.times);
      return state;
    case "adjust": {
      // Hand-resolved card effects: the players apply what the card says (p. 22).
      const p = getPlayer(state, action.player);
      if (action.resources) {
        for (const [r, n] of Object.entries(action.resources) as [Resource, number][]) {
          if (p.resources[r] + n < 0) throw new IllegalAction(`not enough ${r}`);
        }
        for (const [r, n] of Object.entries(action.resources) as [Resource, number][]) p.resources[r] += n;
        log(state, { type: "gain", player: p.id, resources: action.resources });
      }
      if (action.mp) {
        const hero = mainHero(state, p.id);
        if (hero) {
          if (action.mp > 0) gainMp(state, hero, action.mp);
          else spendMp(hero, -action.mp);
        }
      }
      if (action.draw) drawCards(state, p, action.draw);
      if (action.morale) changeMorale(state, p, action.morale);
      return state;
    }
  }
}

/**
 * Before an attack is rolled both players may play cards (p. 43). A side that cannot play any
 * (no Main Hero in the fight, or no card in hand) passes at once.
 */
function autoPass(state: AdventureState) {
  for (;;) {
    const ph = state.phase;
    if (ph.type !== "combat") return;
    const cph = ph.combat.phase;
    if (cph.type !== "reaction") return;
    const side = (["attacker", "defender"] as const).find((s) => !cph.passed[s] && !canPlayCards(state, ph.context, s));
    if (!side) return;
    ph.combat = applyCombatAction(ph.combat, { type: "pass", side });
    if (ph.combat.phase.type === "over") {
      finishCombat(state, ph.context, ph.combat);
      return;
    }
  }
}

function canPlayCards(state: AdventureState, ctx: CombatContext, side: Side): boolean {
  const owner = sidePlayer(state, ctx, side);
  if (!owner) return false;
  const p = getPlayer(state, owner);
  return cardSide(state, ctx, owner) === side && p.hand.length > 0;
}

/** Resolves one alternative of an `options` choice. */
function resolveOp(state: AdventureState, hero: Hero, op: Op) {
  const p = getPlayer(state, hero.owner);
  const main = mainHero(state, p.id) ?? hero;
  switch (op.op) {
    case "none":
      return;
    case "gain":
      gain(state, p.id, op.resources);
      return;
    case "mp":
      gainMp(state, main, op.n);
      return;
    case "draw":
      drawCards(state, p, op.n);
      return;
    case "morale":
      changeMorale(state, p, +1);
      return;
    case "experience":
      gainExperience(state, main, op.n);
      return;
    case "search":
      if (op.cost) pay(state, p, { gold: op.cost });
      queueFirst(
        state,
        ...Array.from({ length: op.times ?? 1 }, () => ({ kind: "search" as const, player: p.id, deck: op.deck, n: op.n, source: "location" })),
      );
      return;
    case "search-discard":
      if (op.cost) pay(state, p, { gold: op.cost });
      queueFirst(state, { kind: "search", player: p.id, deck: op.deck, n: op.n, source: "location", fromDiscard: true });
      return;
    case "resource-dice":
      rollResources(state, hero, op.n, op.chooseOne);
      return;
    case "minor-artifact": {
      // Hard starting bonus: reveal Artifacts until a Minor one, then reshuffle (p. 10).
      const pile = state.decks.artifact;
      const at = pile.deck.findIndex((c) => cardInfoLevel(c) === "minor");
      if (at >= 0) gainCard(state, p, pile.deck.splice(at, 1)[0]!, "starting-bonus");
      state.rng = shuffle(pile.deck, state.rng);
      return;
    }
    case "trade":
      p.trading = true;
      return;
    case "seq":
      for (const o of op.ops) resolveOp(state, hero, o);
      return;
    case "reinforce": {
      const u = p.army[op.armyIndex];
      if (!u || u.variant !== "few") throw new IllegalAction("pick a Few unit");
      if (op.cost) pay(state, p, { gold: op.cost });
      u.variant = "pack";
      log(state, { type: "recruit", player: p.id, unitId: u.unitId, variant: "pack" });
      return;
    }
    case "take": {
      if (op.cost) pay(state, p, { gold: op.cost });
      const source =
        op.from === "artifact-discard" ? state.decks.artifact.discard : op.from === "ability-deck" ? state.decks.ability.deck : p.discard;
      const at = source.lastIndexOf(op.card);
      if (at < 0) throw new IllegalAction("that card is gone");
      source.splice(at, 1);
      gainCard(state, p, op.card, "location");
      return;
    }
    case "discard-top": {
      const card = takeFromDeck(state, op.deck);
      if (card) state.decks[op.deck].discard.push(card);
      return;
    }
    case "remove": {
      const card = p.hand[op.handIndex];
      if (!card || !isRemovable(p, card)) throw new IllegalAction("this card cannot be removed");
      removeFromHand(state, p, op.handIndex);
      if (op.then === "gold") gain(state, p.id, { gold: 1 });
      else if (op.then === "experience") gainExperience(state, main, 1);
      else if (op.then === "search-own-deck") {
        const deck = cardInfo(card).deck;
        if (deck) queueFirst(state, { kind: "search", player: p.id, deck, n: 2, source: "location" });
      } else if (op.then === "market") {
        queueFirst(state, {
          kind: "choice",
          player: p.id,
          source: "market_of_time",
          options: (["ability", "spell", "artifact"] as const).map((deck): Op => ({ op: "search", deck, n: 2 })),
        });
      } else if (op.then) resolveOp(state, hero, op.then);
      return;
    }
    case "stat": {
      if (op.cost) pay(state, p, { gold: op.cost });
      if (op.replaceHandIndex !== undefined) removeFromHand(state, p, op.replaceHandIndex);
      gainCard(state, p, `${op.empowered ? "stat+" : "stat"}:${op.stat}`, "location");
      return;
    }
  }
}

function cardInfoLevel(card: string): string | null {
  return card.startsWith("artifact:") ? getArtifact(card.slice(9)).level : null;
}

// ---------------------------------------------------------------------------
// Turns and Rounds

function requireTurn(state: AdventureState, hero: Hero, mp: number) {
  if (state.phase.type !== "turn") throw new IllegalAction("finish the current step first");
  if (hero.owner !== currentPlayer(state).id) throw new IllegalAction("not your Turn");
  if (totalMp(hero) < mp) throw new IllegalAction("not enough Movement Points");
}

/** MP gained by effects is used first: it only lasts this Turn (p. 17). */
function spendMp(hero: Hero, n: number) {
  for (let i = 0; i < n; i++) {
    if (hero.bonusMp > 0) hero.bonusMp -= 1;
    else if (hero.mp > 0) hero.mp -= 1;
    else throw new IllegalAction("not enough Movement Points");
  }
}

function endTurn(state: AdventureState) {
  for (const h of state.heroes) if (h.owner === currentPlayer(state).id) h.bonusMp = 0;
  currentPlayer(state).trading = false;
  // Next player still in the game, or a new Round.
  for (let i = state.current + 1; i < state.players.length; i++) {
    if (!state.players[i]!.eliminated) {
      state.current = i;
      log(state, { type: "turn-start", player: state.players[i]!.id });
      state.queue.push({ kind: "refresh", player: state.players[i]!.id });
      return;
    }
  }
  endRound(state);
}

function controlsBase(state: AdventureState, player: PlayerId): boolean {
  return Object.entries(state.marks).some(([key, m]) => {
    if (m.flag !== player) return false;
    const [q, r] = key.split(",").map(Number);
    const loc = fieldAt(state, { q: q!, r: r! })?.field.location;
    return loc === "town" || loc === "settlement" || loc === "random_town";
  });
}

function endRound(state: AdventureState) {
  // Elimination after 3 full Rounds without a Town or Settlement (p. 11).
  for (const p of state.players) {
    if (p.eliminated) continue;
    p.roundsWithoutBase = controlsBase(state, p.id) ? 0 : p.roundsWithoutBase + 1;
    if (p.roundsWithoutBase >= 3) eliminate(state, p);
  }
  if (state.phase.type === "over") return;
  if (state.victoryPending.length > 0) {
    gameOver(state, [...new Set(state.victoryPending)], "victory");
    return;
  }
  if (state.round >= state.maxRounds) {
    gameOver(state, [], "time");
    return;
  }
  state.round += 1;
  startRound(state);
}

function startRound(state: AdventureState) {
  const resourceRound = state.round % 2 === 1 && state.round > 1;
  log(state, { type: "round-start", round: state.round, resourceRound });
  // p. 15: refresh Movement Tokens, then Resources (odd Rounds) or Astrologers (even Rounds).
  if (!resourceRound) {
    drawAstrologers(state);
  }
  for (const h of state.heroes) {
    h.mp = (h.kind === "main" ? MAIN_HERO_MP : SECONDARY_HERO_MP) + state.effects.extraMp;
    h.bonusMp = 0;
  }
  refreshTowns(state);
  refreshExperts(state);
  // City Hall: "At the beginning of each Resource round, choose…" (Cove: Astrologers' round).
  for (const p of state.players) {
    if (p.eliminated || !p.town.buildings.includes("city_hall")) continue;
    if ((cityHallRound(p.faction) === "resource") !== resourceRound) continue;
    const options = cityHallOptions(p);
    if (options.length === 1) resolveOp(state, mainHero(state, p.id) ?? state.heroes[0]!, options[0]!);
    else state.queue.push({ kind: "choice", player: p.id, source: "city_hall", options });
  }
  if (resourceRound) {
    for (const p of state.players) {
      if (p.eliminated) continue;
      const gained: Resources = { ...p.production };
      for (const [r, n] of Object.entries(state.effects.nextIncome) as [Resource, number][]) {
        gained[r] = Math.max(0, gained[r] + n);
      }
      for (const r of Object.keys(gained) as Resource[]) p.resources[r] += gained[r];
      log(state, { type: "income", player: p.id, gained });
    }
    state.effects.nextIncome = {};
  }
  state.current = state.players.findIndex((p) => !p.eliminated);
  log(state, { type: "turn-start", player: currentPlayer(state).id });
  state.queue.push({ kind: "refresh", player: currentPlayer(state).id });
}

/** Astrologers Proclaim (p. 15). Effects that only touch the map are applied; the rest are shown to players. */
function drawAstrologers(state: AdventureState) {
  const a = state.astrologers;
  state.effects.extraMp = 0;
  for (;;) {
    if (a.deck.length === 0) return;
    const card = a.deck.shift()!;
    if (card === "friendly_beaver" && a.drawn === 0) {
      a.deck.push(card); // "If you draw this card on the first Astrologers' round, discard it and draw another."
      continue;
    }
    a.drawn += 1;
    a.current = card;
    log(state, { type: "astrologers", card });
    switch (card) {
      case "battalions_stallion":
        state.effects.extraMp = 1;
        break;
      case "fancy_pixie":
        for (const p of state.players) changeMorale(state, p, +1);
        break;
      case "friendly_beaver":
        for (const m of Object.values(state.marks)) m.blackCube = false;
        break;
      case "gold_dragon":
        state.effects.nextIncome.gold = (state.effects.nextIncome.gold ?? 0) + 5;
        break;
      case "greedy_dragon":
        state.effects.nextIncome.valuables = (state.effects.nextIncome.valuables ?? 0) - 1;
        break;
    }
    return;
  }
}

/** Astrologers Proclaim cards the engine resolves by itself. */
export const AUTOMATED_ASTROLOGERS = new Set(["battalions_stallion", "fancy_pixie", "friendly_beaver", "gold_dragon", "greedy_dragon", "dead_silence"]);

function gameOver(state: AdventureState, winners: PlayerId[], reason: "victory" | "elimination" | "time") {
  state.phase = { type: "over", winners, reason };
  log(state, { type: "game-over", winners });
}

function eliminate(state: AdventureState, p: Player) {
  p.eliminated = true;
  log(state, { type: "eliminated", player: p.id });
  // Remove their heroes and Faction Cubes from the map (p. 11).
  state.heroes = state.heroes.filter((h) => h.owner !== p.id);
  for (const m of Object.values(state.marks)) if (m.flag === p.id) m.flag = null;
  const left = state.players.filter((x) => !x.eliminated);
  if (left.length === 1) gameOver(state, [left[0]!.id], "elimination");
}

// ---------------------------------------------------------------------------
// Entering and visiting Fields

function enterField(state: AdventureState, hero: Hero) {
  const info = fieldAt(state, hero.pos)!;
  const enemy = state.heroes.find((h) => h !== hero && h.owner !== hero.owner && sameHex(h.pos, hero.pos));
  if (enemy) {
    beginCombat(state, hero, { kind: "hero", heroId: enemy.id });
    return;
  }
  const m = marksAt(state, hero.pos);
  const loc = info.field.location;
  // An enemy Town or Settlement without a Hero: siege (p. 46).
  if ((loc === "town" || loc === "settlement" || loc === "random_town") && m.flag && m.flag !== hero.owner) {
    const defender = getPlayer(state, m.flag);
    if (!defender.eliminated && defender.army.length > 0 && defender.resources.gold >= SIEGE_DEFENSE_COST) {
      state.phase = { type: "siege-decision", heroId: hero.id, hex: hero.pos, defender: defender.id };
      return;
    }
    visit(state, hero);
    return;
  }
  if (isGuarded(state, info, m)) {
    const difficulty = info.field.difficulty ?? MAX_LEVEL;
    if (heroLevel(state, hero) > difficulty) {
      // Quick Combat: the guards are beaten without fighting and without rewards (p. 40).
      editMarks(state, hero.pos).cleared = true;
      log(state, { type: "quick-combat", heroId: hero.id, hex: hero.pos });
    } else {
      beginCombat(state, hero, guardsFor(state, info));
      return;
    }
  }
  visit(state, hero);
}

function isGuarded(state: AdventureState, info: FieldInfo, m: FieldMarks): boolean {
  if (m.cleared || m.blackCube || m.everFlagged) return false;
  if (info.field.location === "random_town") return true;
  return info.field.difficulty !== null;
}

function drawNeutral(state: AdventureState, tier: string): string {
  const pile = state.neutralDecks[tier];
  if (!pile) throw new Error(`no ${tier} neutral deck`);
  if (pile.deck.length === 0) {
    pile.deck = pile.discard;
    pile.discard = [];
    state.rng = shuffle(pile.deck, state.rng);
  }
  const card = pile.deck.shift();
  if (!card) throw new Error(`the ${tier} neutral deck is empty`);
  return card;
}

/** Draws the Neutral Units guarding a Field from the tier decks (p. 41, back cover). */
function guardsFor(state: AdventureState, info: FieldInfo): Foe {
  if (info.field.location === "random_town") return randomTownGuards(state, info);
  const difficulty = info.field.difficulty!;
  let tiers = [...GUARDS[state.difficulty][difficulty - 1]!];
  const unitsOut: NeutralFoe["units"] = [];
  if (info.field.location === "cyclops_stockpile" && tiers.includes("azure")) {
    // Two gold Cyclopes replace one azure unit (wiki: Cyclops Stockpile).
    tiers.splice(tiers.indexOf("azure"), 1);
    unitsOut.push(
      { unitId: "cyclopes", tier: "gold", variant: "neutral", card: false },
      { unitId: "cyclopes", tier: "gold", variant: "neutral", card: false },
    );
  }
  for (const tier of tiers) unitsOut.push({ unitId: drawNeutral(state, tier), tier, variant: "neutral", card: true });
  return { kind: "neutral", hex: info.hex, difficulty, units: unitsOut };
}

/** Random Town defenders (p. 77): a Pack of bronze, two Packs of silver, two Fews of gold of an unused Faction. */
function randomTownGuards(state: AdventureState, info: FieldInfo): Foe {
  const used = new Set(state.players.map((p) => p.faction));
  const free = FACTIONS.filter((f) => !used.has(f));
  const [i, rng] = nextInt(state.rng, free.length);
  state.rng = rng;
  const faction = free[i]! as Faction;
  const pick = (tier: string, n: number) =>
    units.filter((c) => c.variants.some((v) => v.key === "few" && v.faction === faction && v.tier === tier)).slice(0, n);
  const list: NeutralFoe["units"] = [
    ...pick("bronze", 1).map((c) => ({ unitId: c.id, tier: "bronze", variant: "pack", card: false })),
    ...pick("silver", 2).map((c) => ({ unitId: c.id, tier: "silver", variant: "pack", card: false })),
    ...pick("gold", 2).map((c) => ({ unitId: c.id, tier: "gold", variant: "few", card: false })),
  ];
  return { kind: "neutral", hex: info.hex, difficulty: info.field.difficulty ?? MAX_LEVEL, units: list };
}

function visit(state: AdventureState, hero: Hero) {
  const info = fieldAt(state, hero.pos)!;
  const loc = info.field.location;
  const cat = categoryOf(loc);
  const m = editMarks(state, hero.pos);
  hero.lastVisited = { ...hero.pos };
  if (cat === "empty") return;
  if (cat === "visitable") {
    if (m.blackCube) return; // treated as an Empty Field (p. 32)
    m.blackCube = true; // even if the effect is not used
  }
  if (cat === "flaggable") {
    const shared = SHARED_FLAG.has(loc);
    if (m.flag === hero.owner && !shared) return; // allied Heroes treat flagged Fields as empty
    log(state, { type: "visit", heroId: hero.id, hex: hero.pos, location: loc });
    flagField(state, hero, info, m);
    return;
  }
  log(state, { type: "visit", heroId: hero.id, hex: hero.pos, location: loc });
  applyLocation(state, hero, info);
}

function flagField(state: AdventureState, hero: Hero, info: FieldInfo, m: FieldMarks) {
  const loc = info.field.location;
  const previous = m.flag;
  const first = !m.everFlagged;
  m.flag = hero.owner;
  m.everFlagged = true;
  log(state, { type: "flag", player: hero.owner, hex: info.hex, location: loc, from: previous });
  // The previous owner loses what the Field produced.
  if (previous && previous !== hero.owner) {
    if (loc === "mine" && info.field.resource) changeProduction(state, previous, info.field.resource, -MINE_OUTPUT[info.field.resource]);
    if (loc === "settlement" && m.settlementResource) {
      changeProduction(state, previous, m.settlementResource, -SETTLEMENT_OUTPUT[m.settlementResource]);
    }
    if (loc === "random_town") changeProduction(state, previous, "gold", -RANDOM_TOWN_GOLD);
  }
  switch (loc) {
    case "mine": {
      const r = info.field.resource!;
      changeProduction(state, hero.owner, r, MINE_OUTPUT[r]);
      if (first) gain(state, hero.owner, { [r]: MINE_OUTPUT[r] });
      break;
    }
    case "settlement":
      m.settlementResource = null;
      state.phase = { type: "choice", choice: { kind: "settlement", heroId: hero.id, hex: info.hex, free: first } };
      break;
    case "random_town":
      changeProduction(state, hero.owner, "gold", RANDOM_TOWN_GOLD);
      if (first) gain(state, hero.owner, { gold: RANDOM_TOWN_GOLD });
      break;
    case "town": {
      // Flagging an enemy Town takes a Faction Cube from its owner (p. 76); in the sandbox Clash it wins.
      const owner = state.players.find((p) => p.faction === info.field.faction);
      if (owner && owner.id !== hero.owner) {
        getPlayer(state, hero.owner).factionCubes.push(owner.id);
        state.victoryPending.push(hero.owner);
        log(state, { type: "victory-condition", player: hero.owner });
      }
      break;
    }
    case "star_axis": {
      // Replace a Statistic card in hand with its Empowered version (wiki "Star Axis").
      const player = getPlayer(state, hero.owner);
      const options: Op[] = [];
      player.hand.forEach((c, i) => {
        if (c.startsWith("stat:")) options.push({ op: "stat", stat: c.slice(5) as "attack", empowered: true, replaceHandIndex: i });
      });
      offer(state, hero, loc, options);
      break;
    }
    default:
      if (NEEDS_DECKS.has(loc)) log(state, { type: "not-automated", location: loc });
  }
}

function applyLocation(state: AdventureState, hero: Hero, info: FieldInfo) {
  const f = info.field;
  const player = getPlayer(state, hero.owner);
  switch (f.location) {
    case "water_wheel":
    case "windmill":
    case "flotsam":
      gain(state, player.id, { [f.resource ?? "gold"]: f.amount ?? 0 });
      return;
    case "learning_stone":
      gainExperience(state, hero, 1);
      return;
    case "temple":
    case "buoy":
      changeMorale(state, player, +1);
      return;
    case "fountain_of_youth":
    case "mermaid":
      changeMorale(state, player, +1);
      gainMp(state, hero, 1);
      return;
    case "stables":
      gainMp(state, hero, 1);
      return;
    case "treasure_symbol":
      rollTreasure(state, hero, f.dice ?? 1);
      return;
    case "resource_symbol":
    case "sea_barrel":
      rollResources(state, hero, f.dice ?? 1, true);
      return;
    case "shipwreck":
      rollResources(state, hero, f.dice ?? 2, false);
      return;
    case "pandoras_box":
      state.phase = { type: "choice", choice: { kind: "pandora", heroId: hero.id } };
      return;
    case "mystical_garden":
      state.phase = { type: "choice", choice: { kind: "mystical-garden", heroId: hero.id } };
      return;
    case "tree_of_knowledge":
      if (hero.kind === "main") state.phase = { type: "choice", choice: { kind: "tree-of-knowledge", heroId: hero.id } };
      return;
    case "grave":
      changeMorale(state, player, -1);
      gain(state, player.id, { gold: 3 });
      search(state, player, "artifact", 2);
      return;
    case "warriors_tomb":
      search(state, player, "artifact", 2, 2);
      changeMorale(state, player, -1);
      changeMorale(state, player, -1);
      return;
    case "redwood_observatory": {
      const slots = discoverableTiles(state, hero.id).map((t) => t.center);
      if (slots.length > 0) state.phase = { type: "choice", choice: { kind: "discover", heroId: hero.id, slots } };
      return;
    }
    case "jetsam": {
      const [die, rng] = rollAttackDie(state.rng);
      state.rng = rng;
      if (die === 1) rollResources(state, hero, 2, false);
      else if (die === 0) rollResources(state, hero, 1, false);
      return;
    }
    case "sea_chest": {
      const [die, rng] = rollAttackDie(state.rng);
      state.rng = rng;
      if (die === 0) gain(state, player.id, { gold: 5 });
      if (die === 1) search(state, player, "artifact", 1);
      return;
    }
    case "temple_of_the_sea":
      gain(state, player.id, { gold: 10 });
      search(state, player, "artifact", 2, 2);
      return;
    case "artifact_symbol":
      offer(state, hero, f.location, [{ op: "search", deck: "artifact", n: 2 }]);
      return;
    case "shipwreck_survivor":
      search(state, player, "artifact", 2);
      return;
    case "derelict_ship":
      offer(state, hero, f.location, [
        { op: "seq", ops: [{ op: "search", deck: "artifact", n: 2 }, { op: "gain", resources: { gold: 2 } }] },
      ]);
      return;
    case "shrine_of_magic_incantation":
      search(state, player, "spell", 2);
      return;
    case "shrine_of_magic_gesture":
      if (player.resources.gold >= 3) offer(state, hero, f.location, [{ op: "search", deck: "spell", n: 2, cost: 3 }]);
      return;
    case "magic_spring": {
      const top = player.discard.slice(-3).reverse();
      offer(state, hero, f.location, top.map((card): Op => ({ op: "take", card, from: "own-discard" })));
      return;
    }
    case "witch_hut": {
      const top = state.decks.ability.deck.at(-1);
      const options: Op[] = player.hand
        .map((c, i) => ({ c, i }))
        .filter(({ c }) => c.startsWith("ability") && isRemovable(player, c))
        .map(({ i }): Op => ({ op: "remove", handIndex: i }));
      if (top) options.push({ op: "take", card: top, from: "ability-deck" }, { op: "discard-top", deck: "ability" });
      offer(state, hero, f.location, options, false);
      return;
    }
    case "scholar": {
      const [die, rng] = rollAttackDie(state.rng);
      state.rng = rng;
      if (die === 1) {
        const options: Op[] = (["attack", "defense", "power", "knowledge"] as const).map((stat): Op => ({ op: "stat", stat }));
        player.hand.forEach((c, i) => {
          if (c.startsWith("stat:") || c.startsWith("stat+:")) options.push({ op: "remove", handIndex: i, then: { op: "none" } });
        });
        offer(state, hero, f.location, options, false);
      } else {
        search(state, player, die === 0 ? "ability" : "spell", 2);
      }
      return;
    }
    case "faerie_ring":
      offer(
        state,
        hero,
        f.location,
        player.hand
          .map((c, i) => ({ c, i }))
          .filter(({ c }) => isRemovable(player, c))
          .map(({ i }): Op => ({ op: "remove", handIndex: i, then: "search-own-deck" })),
        false,
      );
      return;
    case "market_of_time":
      offer(
        state,
        hero,
        f.location,
        player.hand.map((_, i): Op => ({ op: "remove", handIndex: i, then: "market" })),
        false,
      );
      return;
    case "university":
      if (player.resources.gold >= 6) offer(state, hero, f.location, [{ op: "search-discard", deck: "ability", n: 4, cost: 6 }]);
      return;
    case "trading_post": {
      const options: Op[] = [{ op: "trade" }];
      player.hand.forEach((c, i) => {
        if (isRemovable(player, c)) options.push({ op: "remove", handIndex: i, then: "gold" });
      });
      offer(state, hero, f.location, options);
      return;
    }
    case "black_market": {
      const price = { minor: 5, major: 7, relic: 10 } as const;
      const top = state.decks.artifact.discard.slice(-4).reverse();
      offer(
        state,
        hero,
        f.location,
        top
          .filter((c) => player.resources.gold >= price[getArtifact(c.slice(9)).level])
          .map((card): Op => ({ op: "take", card, from: "artifact-discard", cost: price[getArtifact(card.slice(9)).level] })),
      );
      return;
    }
    case "library_of_enlightenment": {
      if (player.resources.gold < 3) return;
      const options: Op[] = [];
      player.hand.forEach((c, i) => {
        if (!c.startsWith("stat:")) return;
        for (const stat of ["attack", "defense", "power", "knowledge"] as const) {
          if (`stat:${stat}` !== c) options.push({ op: "stat", stat, replaceHandIndex: i, cost: 3 });
        }
      });
      offer(state, hero, f.location, options);
      return;
    }
    case "cyclops_stockpile":
      rollResources(state, hero, 4, false);
      return;
    case "prison":
      if (state.heroes.some((h) => h.owner === player.id && h.kind === "secondary")) gain(state, player.id, { gold: 3 });
      else addSecondaryHero(state, player, hero.pos);
      return;
    case "tavern":
      if (!state.heroes.some((h) => h.owner === player.id && h.kind === "secondary") && player.resources.gold >= SECONDARY_HERO_COST) {
        pay(state, player, { gold: SECONDARY_HERO_COST });
        addSecondaryHero(state, player, hero.pos);
      }
      return;
    case "hill_fort":
      offer(state, hero, f.location, hillFortOptions(player));
      return;
    case "sanctuary":
      return;
    default:
      if (NEEDS_DECKS.has(f.location)) log(state, { type: "not-automated", location: f.location });
  }
}

/** Offers the player the location's alternatives, with "do nothing" last when the effect is optional. */
function offer(state: AdventureState, hero: Hero, source: string, options: Op[], optional = true) {
  const list = optional ? [...options, { op: "none" } as Op] : options;
  if (options.length === 0) return;
  queueFirst(state, { kind: "choice", player: hero.owner, source, options: list });
}

function search(state: AdventureState, player: Player, deck: "ability" | "artifact" | "spell", n: number, times = 1) {
  for (let i = 0; i < times; i++) queueFirst(state, { kind: "search", player: player.id, deck, n, source: "location" });
}

/** Hill Fort (wiki): reinforce a bronze or silver unit for 3 gold less than its cost. */
function hillFortOptions(player: Player): Op[] {
  const options: Op[] = [];
  player.army.forEach((u, i) => {
    if (!canReinforceAtSettlement(u)) return;
    const cost = Math.max(0, (getVariant(u.unitId, "pack").cost?.gold ?? 0) - 3);
    if (player.resources.gold >= cost) options.push({ op: "reinforce", armyIndex: i, cost });
  });
  return options;
}

function addSecondaryHero(state: AdventureState, player: Player, at: Hex) {
  // The new Hero stands on the same Field; with no free neighbor rule in the book, it simply joins there.
  state.heroes.push({
    id: `${player.id}-secondary-${state.log.length}`,
    owner: player.id,
    kind: "secondary",
    pos: { ...at },
    lastVisited: { ...at },
    mp: 0,
    bonusMp: 0,
    experience: 0,
  });
}

function resolveChoice(state: AdventureState, c: Choice, option: number) {
  const hero = getHero(state, c.heroId);
  const player = getPlayer(state, hero.owner);
  switch (c.kind) {
    case "resource-die": {
      const face = c.faces[option];
      if (!face) throw new IllegalAction("pick one of the rolled dice");
      gain(state, player.id, { [face.resource]: face.amount });
      return;
    }
    case "treasure-die": {
      const face = c.faces[option];
      if (!face) throw new IllegalAction("pick one of the rolled dice");
      resolveTreasure(state, hero, face);
      return;
    }
    case "pandora":
      if (option === 0) rollTreasure(state, hero, 2);
      else if (option === 1) rollResources(state, hero, 2, true);
      else throw new IllegalAction("Pandora's Box: 0 = Treasure Dice, 1 = Resource Dice");
      return;
    case "mystical-garden":
      if (option === 0) gain(state, player.id, { gold: 2 });
      else if (option === 1) gain(state, player.id, { valuables: 1 });
      else throw new IllegalAction("Mystical Garden: 0 = 2 gold, 1 = 1 valuables");
      return;
    case "tree-of-knowledge":
      if (option === 0) pay(state, player, { valuables: 3 });
      else if (option === 1) pay(state, player, { gold: 10 });
      if (option === 0 || option === 1) gainExperience(state, hero, 2);
      return;
    case "settlement":
    case "discover":
      state.phase = { type: "choice", choice: c };
      throw new IllegalAction("use the dedicated action for this choice");
  }
}

function rollTreasure(state: AdventureState, hero: Hero, dice: number) {
  const faces: TreasureFace[] = [];
  for (let i = 0; i < dice; i++) {
    const [face, rng] = rollTreasureDie(state.rng);
    state.rng = rng;
    faces.push(face);
  }
  log(state, { type: "dice", die: "treasure", faces });
  if (faces.length === 1 || new Set(faces).size === 1) resolveTreasure(state, hero, faces[0]!);
  else state.phase = { type: "choice", choice: { kind: "treasure-die", faces, heroId: hero.id } };
}

function resolveTreasure(state: AdventureState, hero: Hero, face: TreasureFace) {
  switch (face) {
    case "experience":
      gainExperience(state, hero, 1);
      return;
    case "artifact":
      search(state, getPlayer(state, hero.owner), "artifact", 2);
      return;
    case "resource":
      rollResources(state, hero, 1, true);
      return;
    case "resource2":
      rollResources(state, hero, 2, true);
      return;
  }
}

/** Rolls Resource Dice; `chooseOne` keeps a single result (map symbols), otherwise all are gained. */
function rollResources(state: AdventureState, hero: Hero, dice: number, chooseOne: boolean) {
  const faces: ResourceFace[] = [];
  for (let i = 0; i < dice; i++) {
    const [face, rng] = rollResourceDie(state.rng);
    state.rng = rng;
    faces.push(face);
  }
  log(state, { type: "dice", die: "resource", faces });
  if (!chooseOne) {
    for (const f of faces) gain(state, hero.owner, { [f.resource]: f.amount });
  } else if (faces.length === 1) {
    gain(state, hero.owner, { [faces[0]!.resource]: faces[0]!.amount });
  } else {
    state.phase = { type: "choice", choice: { kind: "resource-die", faces, heroId: hero.id } };
  }
}

// ---------------------------------------------------------------------------
// Resources, Experience, Morale







function canReinforceAtSettlement(u: ArmyUnit): boolean {
  if (u.variant !== "few") return false;
  const tier = getVariant(u.unitId, "few").tier;
  return tier === "bronze" || tier === "silver";
}

export { canReinforceAtSettlement };

// ---------------------------------------------------------------------------
// Combat

function beginCombat(state: AdventureState, hero: Hero, foe: Foe) {
  log(state, { type: "combat-start", heroId: hero.id, foe });
  state.phase = { type: "combat-setup", context: { attackerHero: hero.id, foe, picks: {}, placements: {} }, side: "attacker" };
}

function setupSide(state: AdventureState, ctx: CombatContext, side: Side, picks: { armyIndex: number; line: "back" | "front" }[]) {
  const owner = sidePlayer(state, ctx, side);
  if (!owner) throw new IllegalAction("Neutral Units are placed automatically");
  const army = getPlayer(state, owner).army;
  if (picks.length === 0 && army.length > 0) throw new IllegalAction("bring at least one unit");
  if (picks.length > MAX_COMBAT_UNITS) throw new IllegalAction(`at most ${MAX_COMBAT_UNITS} units (p. 41)`);
  const seen = new Set<number>();
  for (const p of picks) {
    if (!army[p.armyIndex] || seen.has(p.armyIndex)) throw new IllegalAction("pick each of your units at most once");
    seen.add(p.armyIndex);
  }
  ctx.picks[side] = picks.map((p) => p.armyIndex);
  ctx.placements[side] = placeInLines(
    side,
    picks.map((p) => ({ ...army[p.armyIndex]!, line: p.line })),
  );
  const pending = ctx.placements;

  const needDefender = ctx.foe.kind !== "neutral" && side === "attacker";
  if (needDefender) {
    state.phase = { type: "combat-setup", context: ctx, side: "defender" };
    return;
  }
  let defender = pending.defender ?? [];
  if (ctx.foe.kind === "neutral") {
    // Hotseat: Neutral Units use the automatic placement from Campaign and Cooperative games (p. 41).
    defender = placeNeutrals(
      "defender",
      ctx.foe.units.map((u) => ({ unitId: u.unitId, variant: u.variant })),
    );
  }
  const [seed, rng] = nextInt(state.rng, 2 ** 31);
  state.rng = rng;
  const combat = createCombat({
    attacker: pending.attacker ?? [],
    defender,
    rng: { kind: "seeded", seed },
    // Players may play cards before each attack (p. 43); sides that cannot are passed automatically.
    options: { neutralSide: ctx.foe.kind === "neutral" ? "defender" : null, reactions: true },
  });
  state.phase = { type: "combat", context: ctx, combat };
  if (combat.phase.type === "over") finishCombat(state, ctx, combat);
  autoPass(state);
}

/** Army index of a combat unit, from its uid (`a2-griffins` → second pick of the attacker). */
function armyIndexOf(ctx: CombatContext, side: Side, uid: string): number {
  const n = Number(uid.slice(1, uid.indexOf("-")));
  return ctx.picks[side]![n - 1]!;
}

/** Applies losses and Pack → Few flips to a player's Unit Deck; all damage heals (p. 44). */
function updateArmy(state: AdventureState, ctx: CombatContext, combat: CombatState, side: Side) {
  const owner = sidePlayer(state, ctx, side);
  if (!owner) return;
  const player = getPlayer(state, owner);
  const picked = ctx.picks[side] ?? [];
  const survivors = new Map<number, string>();
  for (const u of combat.units.filter((x) => x.side === side)) survivors.set(armyIndexOf(ctx, side, u.uid), u.variant);
  const lost = picked.filter((i) => !survivors.has(i)).sort((a, b) => b - a);
  for (const [i, variant] of survivors) player.army[i]!.variant = variant;
  for (const i of lost) player.army.splice(i, 1);
}

function resetEmptyArmy(state: AdventureState, player: Player) {
  if (player.army.length > 0) return;
  player.army = player.startingArmy.map((u) => ({ ...u }));
  log(state, { type: "army-reset", player: player.id });
}

function discardNeutrals(state: AdventureState, foe: Foe) {
  if (foe.kind !== "neutral") return;
  for (const u of foe.units) if (u.card) state.neutralDecks[u.tier]?.discard.push(u.unitId);
}

function experienceFor(level: number, opponent: number): number {
  return opponent > level ? 2 : opponent === level ? 1 : 0;
}

function finishCombat(state: AdventureState, ctx: CombatContext, combat: CombatState) {
  const over = combat.phase;
  if (over.type !== "over") return;
  const hero = getHero(state, ctx.attackerHero);
  const attacker = getPlayer(state, hero.owner);
  updateArmy(state, ctx, combat, "attacker");
  updateArmy(state, ctx, combat, "defender");
  discardNeutrals(state, ctx.foe);
  state.phase = { type: "turn" };

  if (ctx.foe.kind === "neutral") {
    const won = over.winner === "attacker";
    const outcome = won ? "victory" : attacker.army.length > 0 ? "retreat" : "defeat";
    log(state, { type: "combat-end", heroId: hero.id, outcome, winner: won ? attacker.id : null });
    if (won) {
      editMarks(state, ctx.foe.hex).cleared = true;
      const azure = ctx.foe.units.some((u) => u.tier === "azure");
      if (hero.kind === "main" && azure) {
        hero.experience = Math.max(hero.experience, 2 * (MAX_LEVEL - 1)); // Level VII at once (p. 44)
        log(state, { type: "experience", heroId: hero.id, amount: 0, level: MAX_LEVEL });
        rewardLevels(state, hero);
      } else {
        gainExperience(state, hero, experienceFor(heroLevel(state, hero), ctx.foe.difficulty));
      }
      visit(state, hero);
    } else if (outcome === "retreat") {
      hero.pos = { ...hero.lastVisited }; // back to the last visited Field, without visiting it
    } else {
      defeatHero(state, hero, null);
      resetEmptyArmy(state, attacker);
    }
    return;
  }

  // Against a player: the side with surviving units wins (p. 44).
  const defenderId = sidePlayer(state, ctx, "defender")!;
  const defender = getPlayer(state, defenderId);
  const winnerSide = over.winner;
  log(state, {
    type: "combat-end",
    heroId: hero.id,
    outcome: winnerSide === "attacker" ? "victory" : "defeat",
    winner: winnerSide === "attacker" ? attacker.id : winnerSide === "defender" ? defender.id : null,
  });
  const defHero = ctx.foe.kind === "hero" ? getHero(state, ctx.foe.heroId) : null;
  if (winnerSide === "attacker") {
    if (defHero && hero.kind === "main" && defHero.kind === "main") {
      gainExperience(state, hero, experienceFor(heroLevel(state, hero), heroLevel(state, defHero)));
    }
    if (defHero) defeatHero(state, defHero, attacker);
    if (!isOver(state) && state.heroes.includes(hero)) visit(state, hero);
  } else {
    if (winnerSide === "defender" && defHero && defHero.kind === "main" && hero.kind === "main") {
      gainExperience(state, defHero, experienceFor(heroLevel(state, defHero), heroLevel(state, hero)));
    }
    defeatHero(state, hero, winnerSide === "defender" ? defender : null);
    if (winnerSide === null && defHero) defeatHero(state, defHero, null);
  }
  resetEmptyArmy(state, attacker);
  resetEmptyArmy(state, defender);
}

/**
 * A defeated Main Hero goes to a friendly Town or Settlement; one defeated by another player's
 * army gains Negative Morale and pays that player 5 gold, who takes a Faction Cube (p. 44).
 * A defeated Secondary Hero leaves the map.
 */
function defeatHero(state: AdventureState, hero: Hero, by: Player | null) {
  const owner = getPlayer(state, hero.owner);
  if (by) {
    by.factionCubes.push(owner.id);
    if (hero.kind === "main") {
      changeMorale(state, owner, -1);
      const fine = Math.min(DEFEAT_PENALTY, owner.resources.gold);
      owner.resources.gold -= fine;
      by.resources.gold += fine;
      log(state, { type: "pay", player: owner.id, resources: { gold: fine } });
    }
  }
  if (hero.kind === "secondary") {
    state.heroes = state.heroes.filter((h) => h !== hero);
    log(state, { type: "hero-defeated", heroId: hero.id, movedTo: null });
    return;
  }
  const base = friendlyBase(state, owner.id);
  if (!base) {
    // Losing with the Main Hero and no Town or Settlement left eliminates (p. 11).
    log(state, { type: "hero-defeated", heroId: hero.id, movedTo: null });
    eliminate(state, owner);
    return;
  }
  hero.pos = base;
  hero.lastVisited = base;
  log(state, { type: "hero-defeated", heroId: hero.id, movedTo: base });
}

function friendlyBase(state: AdventureState, player: PlayerId): Hex | null {
  const own = getPlayer(state, player);
  const candidates: Hex[] = [];
  for (const [key, m] of Object.entries(state.marks)) {
    if (m.flag !== player) continue;
    const [q, r] = key.split(",").map(Number);
    const hex = { q: q!, r: r! };
    const info = fieldAt(state, hex);
    if (!info) continue;
    const loc = info.field.location;
    if (loc !== "town" && loc !== "settlement" && loc !== "random_town") continue;
    if (state.heroes.some((h) => h.owner !== player && sameHex(h.pos, hex))) continue;
    // Own Faction Town first.
    if (loc === "town" && info.field.faction === own.faction) candidates.unshift(hex);
    else candidates.push(hex);
  }
  return candidates[0] ?? null;
}

function surrender(state: AdventureState, ctx: CombatContext, combat: CombatState, side: Side) {
  const loserId = sidePlayer(state, ctx, side)!;
  const winnerId = sidePlayer(state, ctx, side === "attacker" ? "defender" : "attacker")!;
  const loser = getPlayer(state, loserId);
  pay(state, loser, { gold: SURRENDER_COST });
  getPlayer(state, winnerId).resources.gold += SURRENDER_COST;
  // Units keep the Pack/Few side they ended on; damage heals.
  updateArmy(state, ctx, combat, "attacker");
  updateArmy(state, ctx, combat, "defender");
  state.phase = { type: "turn" };
  const attackerHero = getHero(state, ctx.attackerHero);
  log(state, { type: "combat-end", heroId: attackerHero.id, outcome: "surrender", winner: winnerId });
  const loserHero = side === "attacker" ? attackerHero : ctx.foe.kind === "hero" ? getHero(state, ctx.foe.heroId) : null;
  if (loserHero) {
    if (loserHero.kind === "secondary") state.heroes = state.heroes.filter((h) => h !== loserHero);
    else {
      const base = friendlyBase(state, loserHero.owner);
      if (base) loserHero.pos = loserHero.lastVisited = base;
    }
  }
  if (side === "defender" && state.heroes.includes(attackerHero)) visit(state, attackerHero);
}

const isOver = (state: AdventureState) => state.phase.type === "over";


export { areAdjacent };
