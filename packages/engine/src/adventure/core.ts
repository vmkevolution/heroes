/** Shared state helpers of the adventure engine: lookups, resources, Morale and the event log. */
import { getTile, type Resource, type TileField } from "@heroes/data";
import { fieldHex, sameHex, type Hex } from "./hex.ts";
import { IllegalAction } from "../combat/engine.ts";
import type { AdventureEvent, AdventureState, Hero, PlacedTile, Player, PlayerId, Resources } from "./types.ts";

export const MAX_LEVEL = 7;

export function currentPlayer(state: AdventureState): Player {
  return state.players[state.current]!;
}

export function getHero(state: AdventureState, id: string): Hero {
  const h = state.heroes.find((x) => x.id === id);
  if (!h) throw new IllegalAction(`no hero "${id}"`);
  return h;
}

export function getPlayer(state: AdventureState, id: PlayerId): Player {
  const p = state.players.find((x) => x.id === id);
  if (!p) throw new IllegalAction(`no player "${id}"`);
  return p;
}

/** Each Level needs 2 Experience; Level VII is the last (p. 21). */
export const levelFor = (xp: number) => Math.min(MAX_LEVEL, 1 + Math.floor(xp / 2));

export function gain(state: AdventureState, player: PlayerId, res: Partial<Resources>) {
  const p = getPlayer(state, player);
  for (const [r, n] of Object.entries(res) as [Resource, number][]) p.resources[r] += n;
  log(state, { type: "gain", player, resources: res });
}

export function pay(state: AdventureState, p: Player, res: Partial<Resources>) {
  for (const [r, n] of Object.entries(res) as [Resource, number][]) {
    if (p.resources[r] < n) throw new IllegalAction(`not enough ${r}`);
  }
  for (const [r, n] of Object.entries(res) as [Resource, number][]) p.resources[r] -= n;
  log(state, { type: "pay", player: p.id, resources: res });
}

export function changeProduction(state: AdventureState, player: PlayerId, r: Resource, delta: number) {
  const p = getPlayer(state, player);
  p.production[r] = Math.max(0, p.production[r] + delta);
  log(state, { type: "production", player, resource: r, delta });
}

export function gainMp(state: AdventureState, hero: Hero, n: number) {
  hero.bonusMp += n;
  log(state, { type: "mp", heroId: hero.id, amount: n });
}

/** Morale Tokens (p. 19). Necropolis ignores Morale. */
export function changeMorale(state: AdventureState, p: Player, delta: 1 | -1) {
  if (p.faction === "necropolis") return;
  if (delta > 0) p.morale = p.morale < 0 ? p.morale + 1 : 1;
  else p.morale = p.morale > 0 ? 0 : Math.max(-2, p.morale - 1);
  log(state, { type: "morale", player: p.id, morale: p.morale });
}

export function log(state: AdventureState, e: AdventureEvent) {
  state.log.push(structuredClone(e));
}


export interface FieldInfo {
  hex: Hex;
  tile: PlacedTile;
  index: number;
  field: TileField;
}

export function tileHexes(tile: PlacedTile): Hex[] {
  return Array.from({ length: 7 }, (_, i) => fieldHex(tile.center, tile.rotation, i));
}

export function fieldAt(state: AdventureState, hex: Hex): FieldInfo | null {
  for (const tile of state.tiles) {
    for (let i = 0; i < 7; i++) {
      if (sameHex(fieldHex(tile.center, tile.rotation, i), hex)) {
        return { hex, tile, index: i, field: getTile(tile.tileId).fields[i]! };
      }
    }
  }
  return null;
}

