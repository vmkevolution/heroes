import { useMemo, useState } from "react";
import {
  applyCombatAction,
  canDefend,
  COLS,
  getUnitByUid,
  legalMoves,
  legalTargets,
  ROWS,
  samePos,
  statsOf,
  waitingFor,
  type CombatAction,
  type CombatEvent,
  type CombatState,
  type CombatUnit,
  type Side,
} from "@heroes/engine";
import { getVariant } from "@heroes/data";
import { useI18n, type Messages } from "../i18n.tsx";
import { cardImage, unitName } from "../cards.ts";
import type { CombatConfig } from "./SetupScreen.tsx";

/** Board rows from top to bottom of the screen: the defender sits at the top. */
const SCREEN_ROWS = Array.from({ length: ROWS }, (_, i) => ROWS - 1 - i);

export function CombatScreen({ initial, config }: { initial: CombatState; config: CombatConfig }) {
  const [state, setState] = useState(initial);
  const [cards, setCards] = useState(config.cards);
  // Units leave `state.units` when defeated, so names come from the starting line-up.
  const names = useMemo(() => unitNames(initial), [initial]);
  const act = (action: CombatAction) => {
    setState(applyCombatAction(state, action));
    if (action.type === "modify") {
      setCards((c) => ({ ...c, [action.side]: { ...c[action.side], [action.stat]: c[action.side][action.stat] - 1 } }));
    }
  };
  return <CombatView state={state} onAction={act} cards={cards} names={names} />;
}

export function unitNames(initial: CombatState): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of initial.units) m.set(u.uid, unitName(u.unitId));
  return m;
}

export interface CombatViewProps {
  state: CombatState;
  /** Applies an action; may throw IllegalAction, shown under the phase panel. */
  onAction: (action: CombatAction) => void;
  /** Attack and Defense cards left per side; null when no cards are in play. */
  cards: CombatConfig["cards"] | null;
  names: Map<string, string>;
  /** Overrides the side labels (player names on the adventure map). */
  sideNames?: Partial<Record<Side, string>>;
  /** False when the attacker has no MP left to pay for another round. */
  canContinue?: boolean;
  /** Extra buttons shown under the phase panel (surrender…). */
  extra?: React.ReactNode;
}

export function CombatView({ state, onAction, cards, names, sideNames, canContinue = true, extra }: CombatViewProps) {
  const { t } = useI18n();
  const [inspect, setInspect] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sideLabel = (s: Side) => sideNames?.[s] ?? (s === "attacker" ? t.attacker : t.defender);

  const act = (action: CombatAction) => {
    try {
      onAction(action);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const ph = state.phase;
  const active = ph.type === "activation" ? getUnitByUid(state, ph.uid) : null;
  const moves = active ? legalMoves(state, active.uid) : [];
  const targets = active ? legalTargets(state, active.uid) : [];
  const pendingUids =
    ph.type === "reaction" ? [ph.attack.attackerUid, ph.attack.targetUid] : [];

  const onCell = (col: number, row: number) => {
    if (!active) return;
    const occupant = state.units.find((u) => u.pos.col === col && u.pos.row === row);
    if (occupant && targets.includes(occupant.uid)) act({ type: "attack", uid: active.uid, targetUid: occupant.uid });
    else if (moves.some((p) => samePos(p, { col, row }))) act({ type: "move", uid: active.uid, to: { col, row } });
  };

  const inspected = inspect ? state.units.find((u) => u.uid === inspect) : null;

  return (
    <div className="combat">
      <div className="board-wrap">
        <div className="board-side-label top">{sideLabel("defender")}</div>
        <div className="board" style={{ gridTemplateColumns: `repeat(${COLS}, 1fr)` }}>
          {SCREEN_ROWS.map((row) =>
            Array.from({ length: COLS }, (_, col) => {
              const unit = state.units.find((u) => u.pos.col === col && u.pos.row === row);
              const obstacle = state.obstacles.some((p) => p.col === col && p.row === row);
              const canMove = moves.some((p) => samePos(p, { col, row }));
              const canHit = !!unit && targets.includes(unit.uid);
              const rowClass = row === 2 ? "middle" : row <= 1 ? "attacker-zone" : "defender-zone";
              return (
                <div
                  key={`${col}-${row}`}
                  className={`cell ${rowClass} ${canMove ? "can-move" : ""} ${canHit ? "can-hit" : ""} ${obstacle ? "obstacle" : ""}`}
                  onClick={() => onCell(col, row)}
                >
                  {unit && (
                    <UnitToken
                      unit={unit}
                      active={active?.uid === unit.uid}
                      pending={pendingUids.includes(unit.uid)}
                      onHover={setInspect}
                      t={t}
                      preview={canHit && active ? damageRange(active, unit) : null}
                    />
                  )}
                </div>
              );
            }),
          )}
        </div>
        <div className="board-side-label bottom">{sideLabel("attacker")}</div>
      </div>

      <aside className="side">
        <div className="panel round">
          <span>
            {t.round} {state.round}
          </span>
          <span className="muted">
            {t.turnOf} : {waitingFor(state).map(sideLabel).join(", ") || "—"}
          </span>
        </div>

        <PhasePanel state={state} cards={cards} act={act} names={names} sideLabel={sideLabel} canContinue={canContinue} />
        {extra}
        {error && <p className="error">{error}</p>}

        <InitiativeBar state={state} onHover={setInspect} />

        {inspected && (
          <div className="panel inspect">
            {cardImage(inspected.unitId, inspected.variant) && (
              <img src={cardImage(inspected.unitId, inspected.variant)!} alt={unitName(inspected.unitId)} />
            )}
          </div>
        )}

        <Log log={state.log} names={names} sideLabel={sideLabel} />
      </aside>
    </div>
  );
}

/** Possible damage against a target over the Attack Die results −1 to +1 (p. 42), before cards and tokens. */
function damageRange(attacker: CombatUnit, target: CombatUnit): [number, number] {
  const a = statsOf(attacker).attack;
  const d = statsOf(target).defense;
  return [Math.max(0, a - 1 - d), Math.max(0, a + 1 - d)];
}

function UnitToken({
  unit,
  active,
  pending,
  onHover,
  preview,
  t,
}: {
  unit: CombatUnit;
  active: boolean;
  pending: boolean;
  onHover: (uid: string | null) => void;
  preview: [number, number] | null;
  t: Messages;
}) {
  const s = statsOf(unit);
  const v = getVariant(unit.unitId, unit.variant);
  const img = cardImage(unit.unitId, unit.variant);
  const hpLeft = s.hp - unit.damage;
  return (
    <div
      className={`unit ${unit.side} ${active ? "active" : ""} ${pending ? "pending" : ""} ${unit.activated && !active ? "done" : ""}`}
      onMouseEnter={() => onHover(unit.uid)}
    >
      {img && <img src={img} alt="" draggable={false} />}
      <div className="unit-info">
        <div className="unit-name">{unitName(unit.unitId)}</div>
        <div className="unit-stats">
          <span title={t.statAttack}>⚔ {s.attack}</span>
          <span title={t.statDefense}>🛡 {s.defense}</span>
          <span>➤ {s.initiative}</span>
          <span className="variant">{v.label}</span>
        </div>
        <div className="hp">
          <div className="hp-fill" style={{ width: `${(100 * hpLeft) / s.hp}%` }} />
          <span>
            {hpLeft}/{s.hp}
          </span>
        </div>
      </div>
      <div className="badges">
        {unit.defending && <span title={t.defending}>🛡</span>}
        {unit.paralyzed && <span title={t.paralyzed}>✶</span>}
        {unit.retaliated && <span title={t.retaliated}>↺</span>}
      </div>
      {preview && (
        <div className="preview" title={t.preview}>
          {preview[0] === preview[1] ? preview[0] : `${preview[0]}–${preview[1]}`} {t.damage}
        </div>
      )}
    </div>
  );
}

function PhasePanel({
  state,
  cards,
  act,
  names,
  sideLabel,
  canContinue,
}: {
  canContinue: boolean;
  state: CombatState;
  cards: CombatConfig["cards"] | null;
  act: (a: CombatAction) => void;
  names: Map<string, string>;
  sideLabel: (s: Side) => string;
}) {
  const { t } = useI18n();
  const ph = state.phase;

  if (ph.type === "activation") {
    const u = getUnitByUid(state, ph.uid);
    const mustAttack =
      u.side === state.options.neutralSide && !ph.attacked && legalTargets(state, u.uid).length > 0;
    return (
      <div className={`panel phase ${u.side}`}>
        <h3>
          {t.activeUnit} : {names.get(u.uid)} <span className="muted">({sideLabel(u.side)})</span>
        </h3>
        <p className="muted">{t.hintActivation}</p>
        <div className="buttons">
          {canDefend(state, u.uid) && (
            <button className="btn" onClick={() => act({ type: "defend", uid: u.uid })}>
              {t.defend}
            </button>
          )}
          <button className="btn" disabled={mustAttack} onClick={() => act({ type: "end-activation", uid: u.uid })}>
            {t.endActivation}
          </button>
        </div>
      </div>
    );
  }

  if (ph.type === "reaction") {
    const attacker = getUnitByUid(state, ph.attack.attackerUid);
    const target = getUnitByUid(state, ph.attack.targetUid);
    const att = statsOf(attacker).attack + ph.attack.attackBonus;
    const def = statsOf(target).defense + ph.attack.defenseBonus;
    return (
      <div className="panel phase reaction">
        <h3>{t.reaction}</h3>
        <p>
          {t.ev.attack(names.get(attacker.uid)!, names.get(target.uid)!, ph.attack.retaliation)} — ⚔ {att} / 🛡 {def}
          {target.defending && " (+🛡)"}
        </p>
        {ph.attack.penalty && <p className="warn">{t.penalty}</p>}
        <p className="muted">{t.reactionHint}</p>
        {(["attacker", "defender"] as const).map((side) => {
          if (side === state.options.neutralSide) return null;
          const stat = side === attacker.side ? "attack" : "defense";
          const left = cards?.[side][stat] ?? 0;
          return (
            <div key={side} className={`react-row ${side}`}>
              <strong>{sideLabel(side)}</strong>
              {ph.passed[side] ? (
                <span className="muted">{t.passed}</span>
              ) : (
                <>
                  {cards && <button
                    className="btn"
                    disabled={left <= 0}
                    onClick={() => act({ type: "modify", side, stat, amount: 1, source: `${stat}-card` })}
                  >
                    {stat === "attack" ? t.playAttack : t.playDefense} · {left} {t.cardsLeft}
                  </button>}
                  <button className="btn primary" onClick={() => act({ type: "pass", side })}>
                    {t.pass}
                  </button>
                </>
              )}
            </div>
          );
        })}
      </div>
    );
  }

  if (ph.type === "round-end") {
    return (
      <div className="panel phase">
        <h3>{t.roundEnd}</h3>
        <p className="muted">{t.roundEndHint}</p>
        <div className="buttons">
          <button className="btn primary" disabled={!canContinue} onClick={() => act({ type: "continue" })}>
            {t.continueCombat}
          </button>
          <button className="btn" onClick={() => act({ type: "retreat" })}>
            {t.retreat}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="panel phase over">
      <h3>{t.victory}</h3>
      <p>
        {ph.reason === "retreat" ? t.retreated : ph.winner ? `${sideLabel(ph.winner)} ${t.wins}` : t.draw}
      </p>
    </div>
  );
}

function InitiativeBar({ state, onHover }: { state: CombatState; onHover: (uid: string | null) => void }) {
  const { t } = useI18n();
  const activeUid = state.phase.type === "activation" ? state.phase.uid : null;
  const queue = state.units
    .filter((u) => !u.activated || u.uid === activeUid)
    .sort((a, b) => (a.uid === activeUid ? -1 : b.uid === activeUid ? 1 : statsOf(b).initiative - statsOf(a).initiative));
  return (
    <div className="panel initiative">
      <h3>{t.initiativeOrder}</h3>
      <div className="queue">
        {queue.map((u) => (
          <span
            key={u.uid}
            className={`chip ${u.side} ${u.uid === activeUid ? "active" : ""}`}
            onMouseEnter={() => onHover(u.uid)}
          >
            {statsOf(u).initiative} · {unitName(u.unitId)}
          </span>
        ))}
      </div>
    </div>
  );
}

const die = (n: number) => (n > 0 ? `+${n}` : String(n));

function describe(
  e: CombatEvent,
  t: Messages,
  names: Map<string, string>,
  sideLabel: (s: Side) => string,
): string | null {
  const n = (uid: string) => names.get(uid) ?? uid;
  switch (e.type) {
    case "round-start":
      return t.ev.roundStart(e.round);
    case "activate":
      return t.ev.activate(n(e.uid));
    case "skip-paralyzed":
      return t.ev.skip(n(e.uid));
    case "move":
      return t.ev.move(n(e.uid));
    case "defend":
      return t.ev.defend(n(e.uid));
    case "modify":
      return t.ev.modify(sideLabel(e.side), e.stat === "attack" ? t.statAttack : t.statDefense, e.amount);
    case "attack":
      return `${t.ev.attack(n(e.attackerUid), n(e.targetUid), e.retaliation)} : ${t.ev.dice(
        e.rolls.map(die).join(" / ") + (e.defenseRoll !== null ? ` (🛡 ${die(e.defenseRoll)})` : ""),
        e.attack,
        e.defense,
        e.damage,
      )}`;
    case "damage":
      if (e.defeated) return t.ev.defeated(n(e.uid));
      if (e.flipped) return t.ev.flipped(n(e.uid));
      return null;
    case "effect":
      return t.ev.effect(sideLabel(e.side), e.source, n(e.effect.uid));
    case "retreat":
      return t.ev.retreat;
    case "over":
      return t.ev.over;
    case "end-activation":
      return null;
  }
}

function Log({
  log,
  names,
  sideLabel,
}: {
  log: CombatEvent[];
  names: Map<string, string>;
  sideLabel: (s: Side) => string;
}) {
  const { t } = useI18n();
  const lines = log
    .map((e, i) => ({ i, e, text: describe(e, t, names, sideLabel) }))
    .filter((l) => l.text !== null)
    .reverse();
  return (
    <div className="panel log">
      <h3>{t.log}</h3>
      <ol>
        {lines.map((l) => (
          <li key={l.i} className={`ev-${l.e.type}`}>
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
