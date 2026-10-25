import { useMemo, useState } from "react";
import { FACTIONS, getVariant, units, type Faction } from "@heroes/data";
import { createCombat, placeInLines, placeNeutrals, type CombatState, type Side } from "@heroes/engine";
import { useI18n } from "../i18n.tsx";
import { cardImage } from "../cards.ts";

const MAX_UNITS = 5;

export interface CombatConfig {
  /** Attack and Defense cards each player holds, played as +1 during the reaction window. */
  cards: Record<Side, { attack: number; defense: number }>;
}

type Line = "back" | "front";
interface Pick {
  unitId: string;
  variant: string;
  line: Line;
}
type Army = { kind: "faction"; faction: Faction; picks: Pick[] } | { kind: "neutral"; picks: Pick[] };

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function factionUnits(faction: Faction) {
  return units.filter((c) => c.variants.some((v) => v.origin === "faction" && v.faction === faction && v.key === "few"));
}
const neutralUnits = units.filter((c) => c.variants.some((v) => v.key === "neutral"));

function defaultLine(unitId: string, variant: string): Line {
  return getVariant(unitId, variant).type === "ranged" ? "back" : "front";
}

export function SetupScreen({ onStart }: { onStart: (state: CombatState, config: CombatConfig) => void }) {
  const { t } = useI18n();
  const [mode, setMode] = useState<"players" | "neutral">("neutral");
  const [attacker, setAttacker] = useState<Army>({
    kind: "faction",
    faction: "castle",
    picks: [
      { unitId: "halberdiers", variant: "pack", line: "front" },
      { unitId: "marksmen", variant: "few", line: "back" },
      { unitId: "griffins", variant: "pack", line: "front" },
    ].filter((p) => units.some((u) => u.id === p.unitId)) as Pick[],
  });
  const [defenderFaction, setDefenderFaction] = useState<Army>({ kind: "faction", faction: "necropolis", picks: [] });
  const [defenderNeutral, setDefenderNeutral] = useState<Army>({
    kind: "neutral",
    picks: [
      { unitId: "skeletons", variant: "neutral", line: "front" },
      { unitId: "zombies", variant: "neutral", line: "front" },
      { unitId: "liches", variant: "neutral", line: "back" },
    ],
  });
  const [cards, setCards] = useState<CombatConfig["cards"]>({
    attacker: { attack: 1, defense: 1 },
    defender: { attack: 1, defense: 1 },
  });

  const defender = mode === "neutral" ? defenderNeutral : defenderFaction;
  const setDefender = mode === "neutral" ? setDefenderNeutral : setDefenderFaction;
  const ready = attacker.picks.length > 0 && defender.picks.length > 0;

  const start = () => {
    const state = createCombat({
      attacker: placeInLines("attacker", attacker.picks),
      defender:
        defender.kind === "neutral" ? placeNeutrals("defender", defender.picks) : placeInLines("defender", defender.picks),
      rng: { kind: "seeded", seed: Math.floor(Math.random() * 2 ** 31) },
      options: { neutralSide: mode === "neutral" ? "defender" : null },
    });
    onStart(state, {
      cards: mode === "neutral" ? { ...cards, defender: { attack: 0, defense: 0 } } : cards,
    });
  };

  return (
    <div className="setup">
      <section className="panel mode">
        <h2>{t.mode}</h2>
        <div className="segmented">
          <button className={mode === "players" ? "on" : ""} onClick={() => setMode("players")}>
            {t.modePlayers}
          </button>
          <button className={mode === "neutral" ? "on" : ""} onClick={() => setMode("neutral")}>
            {t.modeNeutral}
          </button>
        </div>
        <p className="muted">{t.maxUnits}</p>
      </section>

      <div className="setup-sides">
        <ArmyEditor title={t.attacker} army={attacker} onChange={setAttacker} />
        <ArmyEditor title={t.defender} army={defender} onChange={setDefender} />
      </div>

      <section className="panel">
        <h2>{t.statCards}</h2>
        <div className="card-counts">
          {(mode === "neutral" ? (["attacker"] as const) : (["attacker", "defender"] as const)).map((side) => (
            <div key={side} className="card-count">
              <strong>{side === "attacker" ? t.attacker : t.defender}</strong>
              {(["attack", "defense"] as const).map((stat) => (
                <label key={stat}>
                  {stat === "attack" ? t.statAttack : t.statDefense}
                  <input
                    type="number"
                    min={0}
                    max={9}
                    value={cards[side][stat]}
                    onChange={(e) =>
                      setCards({ ...cards, [side]: { ...cards[side], [stat]: Math.max(0, Number(e.target.value) || 0) } })
                    }
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </section>

      <div className="start-row">
        <button className="btn primary big" disabled={!ready} onClick={start}>
          {t.startCombat}
        </button>
      </div>
    </div>
  );
}

function ArmyEditor({ title, army, onChange }: { title: string; army: Army; onChange: (a: Army) => void }) {
  const { t } = useI18n();
  const pool = useMemo(() => (army.kind === "faction" ? factionUnits(army.faction) : neutralUnits), [army]);
  const full = army.picks.length >= MAX_UNITS;

  const add = (unitId: string) => {
    if (full) return;
    const variant = army.kind === "neutral" ? "neutral" : "few";
    onChange({ ...army, picks: [...army.picks, { unitId, variant, line: defaultLine(unitId, variant) }] });
  };
  const update = (i: number, patch: Partial<Pick>) =>
    onChange({ ...army, picks: army.picks.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const remove = (i: number) => onChange({ ...army, picks: army.picks.filter((_, j) => j !== i) });

  return (
    <section className="panel army">
      <div className="army-head">
        <h2>{title}</h2>
        {army.kind === "faction" ? (
          <label>
            {t.faction}{" "}
            <select value={army.faction} onChange={(e) => onChange({ kind: "faction", faction: e.target.value as Faction, picks: [] })}>
              {FACTIONS.map((f) => (
                <option key={f} value={f}>
                  {capitalize(f)}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <span className="muted">{t.neutralUnits}</span>
        )}
      </div>

      <ol className="picks">
        {army.picks.map((p, i) => {
          const card = units.find((u) => u.id === p.unitId)!;
          return (
            <li key={i} className="pick">
              <span className="pick-name">{card.name}</span>
              {army.kind === "faction" && (
                <div className="segmented small">
                  {(["few", "pack"] as const).map((v) => (
                    <button key={v} className={p.variant === v ? "on" : ""} onClick={() => update(i, { variant: v })}>
                      {v === "few" ? t.few : t.pack}
                    </button>
                  ))}
                </div>
              )}
              {army.kind === "faction" && (
                <div className="segmented small">
                  {(["back", "front"] as const).map((l) => (
                    <button key={l} className={p.line === l ? "on" : ""} onClick={() => update(i, { line: l })}>
                      {l === "back" ? t.backline : t.frontline}
                    </button>
                  ))}
                </div>
              )}
              <button className="icon-btn" aria-label="remove" onClick={() => remove(i)}>
                ×
              </button>
            </li>
          );
        })}
      </ol>

      <div className={`pool ${full ? "full" : ""}`}>
        {pool.map((c) => {
          const variant = army.kind === "neutral" ? "neutral" : "few";
          const img = cardImage(c.id, variant);
          return (
            <button key={c.id} className="pool-card" disabled={full} onClick={() => add(c.id)} title={c.name}>
              {img && <img src={img} alt="" loading="lazy" />}
              <span>{c.name}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
