import { COLS, ROWS, type CombatState, type CombatUnit, type Pos, type Side } from "./types.ts";

export const samePos = (a: Pos, b: Pos) => a.col === b.col && a.row === b.row;
export const inBounds = (p: Pos) => p.col >= 0 && p.col < COLS && p.row >= 0 && p.row < ROWS;
export const distance = (a: Pos, b: Pos) => Math.abs(a.col - b.col) + Math.abs(a.row - b.row);
/** Adjacent = one space away in a cardinal direction (p. 42). */
export const isAdjacent = (a: Pos, b: Pos) => distance(a, b) === 1;

export function neighbors(p: Pos): Pos[] {
  return [
    { col: p.col + 1, row: p.row },
    { col: p.col - 1, row: p.row },
    { col: p.col, row: p.row + 1 },
    { col: p.col, row: p.row - 1 },
  ].filter(inBounds);
}

/** Rows that belong to each side for setup: Backline then Frontline. */
export const homeRows: Record<Side, [number, number]> = { attacker: [0, 1], defender: [4, 3] };
export const backlineRow = (side: Side) => homeRows[side][0];

export function unitAt(state: CombatState, p: Pos): CombatUnit | undefined {
  return state.units.find((u) => samePos(u.pos, p));
}

/** Every card on the board, units included, is a Combat Obstacle (p. 42). */
export function isBlocked(state: CombatState, p: Pos): boolean {
  return state.obstacles.some((o) => samePos(o, p)) || unitAt(state, p) !== undefined;
}

/** Empty spaces a ground unit reaches in up to `steps` orthogonal moves without crossing obstacles. */
export function groundReach(state: CombatState, from: Pos, steps: number): Pos[] {
  const seen = new Set([`${from.col},${from.row}`]);
  const out: Pos[] = [];
  let frontier = [from];
  for (let i = 0; i < steps; i++) {
    const next: Pos[] = [];
    for (const p of frontier) {
      for (const n of neighbors(p)) {
        const k = `${n.col},${n.row}`;
        if (seen.has(k) || isBlocked(state, n)) continue;
        seen.add(k);
        out.push(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return out;
}

/** Empty spaces a flying unit reaches: up to `steps` spaces, ignoring obstacles on the way. */
export function flyingReach(state: CombatState, from: Pos, steps: number): Pos[] {
  const out: Pos[] = [];
  for (let col = 0; col < COLS; col++) {
    for (let row = 0; row < ROWS; row++) {
      const p = { col, row };
      const d = distance(from, p);
      if (d > 0 && d <= steps && !isBlocked(state, p)) out.push(p);
    }
  }
  return out;
}
