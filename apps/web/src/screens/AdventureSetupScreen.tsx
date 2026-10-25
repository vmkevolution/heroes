import { useState } from "react";
import { FACTIONS, type Faction } from "@heroes/data";
import { setupAdventure, type AdventureState, type Difficulty } from "@heroes/engine";
import { useI18n } from "../i18n.tsx";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "impossible"];

export function AdventureSetupScreen({ onStart }: { onStart: (state: AdventureState) => void }) {
  const { t } = useI18n();
  const a = t.adv;
  const [count, setCount] = useState<2 | 3>(2);
  const [players, setPlayers] = useState<{ name: string; faction: Faction }[]>([
    { name: "Joueur 1", faction: "castle" },
    { name: "Joueur 2", faction: "necropolis" },
    { name: "Joueur 3", faction: "dungeon" },
  ]);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const chosen = players.slice(0, count);
  const duplicate = new Set(chosen.map((p) => p.faction)).size !== chosen.length;

  const start = () =>
    onStart(
      setupAdventure({
        layout: count === 2 ? "hunt-2" : "hunt-3",
        players: chosen,
        seed: Math.floor(Math.random() * 2 ** 31),
        difficulty,
      }),
    );

  return (
    <div className="setup adventure-setup">
      <section className="panel">
        <h2>{a.newGame}</h2>
        <p className="muted">{a.sandboxNote}</p>
        <div className="row-gap">
          <span>{a.players}</span>
          <div className="segmented">
            {([2, 3] as const).map((n) => (
              <button key={n} className={count === n ? "on" : ""} onClick={() => setCount(n)}>
                {n}
              </button>
            ))}
          </div>
          <span>{a.difficulty}</span>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {a.difficulties[d]}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="panel">
        {chosen.map((p, i) => (
          <div key={i} className={`player-row seat-${i}`}>
            <strong>
              {a.player} {i + 1}
            </strong>
            <label>
              {a.name}{" "}
              <input
                value={p.name}
                maxLength={20}
                onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
              />
            </label>
            <label>
              {t.faction}{" "}
              <select
                value={p.faction}
                onChange={(e) =>
                  setPlayers(players.map((x, j) => (j === i ? { ...x, faction: e.target.value as Faction } : x)))
                }
              >
                {FACTIONS.map((f) => (
                  <option key={f} value={f}>
                    {a.faction(f)}
                  </option>
                ))}
              </select>
            </label>
          </div>
        ))}
        {duplicate && <p className="error">{a.duplicateFaction}</p>}
      </section>

      <div className="start-row">
        <button className="btn primary big" disabled={duplicate || chosen.some((p) => !p.name.trim())} onClick={start}>
          {a.start}
        </button>
      </div>
    </div>
  );
}
