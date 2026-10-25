import { useState } from "react";
import { FACTIONS, heroes, type Faction } from "@heroes/data";
import { defaultAiHero, defaultHero } from "@heroes/engine";
import type { AdventureSetup, Difficulty } from "@heroes/engine";
import { useI18n } from "../i18n.tsx";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "impossible"];

export function AdventureSetupScreen({ onStart }: { onStart: (setup: AdventureSetup, online: boolean) => void }) {
  const { t } = useI18n();
  const a = t.adv;
  const [count, setCount] = useState<2 | 3>(2);
  type Kind = "human" | "computer" | "aiHero";
  const [players, setPlayers] = useState<{ name: string; faction: Faction; hero: string; kind: Kind }[]>([
    { name: "Joueur 1", faction: "castle", hero: defaultHero("castle").id, kind: "human" },
    { name: "Joueur 2", faction: "necropolis", hero: defaultHero("necropolis").id, kind: "human" },
    { name: "Joueur 3", faction: "dungeon", hero: defaultHero("dungeon").id, kind: "human" },
  ]);
  const [neutralAI, setNeutralAI] = useState<boolean | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const chosen = players.slice(0, count);
  const humans = chosen.filter((p) => p.kind === "human").length;
  const neutrals = neutralAI ?? humans < 2;
  const duplicate = new Set(chosen.map((p) => p.faction)).size !== chosen.length;
  const invalid = duplicate || chosen.some((p) => !p.name.trim()) || humans === 0 || chosen[0]!.kind !== "human";

  const start = (online: boolean) =>
    onStart(
      {
        layout: count === 2 ? "hunt-2" : "hunt-3",
        // AI Heroes take their Turns after the players (p. 49).
        players: [...chosen.filter((p) => p.kind !== "aiHero"), ...chosen.filter((p) => p.kind === "aiHero")].map((p) => ({
          name: p.name,
          faction: p.faction,
          hero: p.hero,
          computer: p.kind === "computer" || undefined,
          aiHero: p.kind === "aiHero" ? defaultAiHero(p.faction) : undefined,
        })),
        neutralAI: neutrals,
        seed: Math.floor(Math.random() * 2 ** 31),
        difficulty,
      },
      online,
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
              {t.ai.seatKind}{" "}
              <select
                value={p.kind}
                disabled={i === 0}
                onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, kind: e.target.value as Kind } : x)))}
              >
                {(["human", "computer", "aiHero"] as const).map((k) => (
                  <option key={k} value={k}>
                    {t.ai.kinds[k]}
                  </option>
                ))}
              </select>
            </label>
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
                  setPlayers(
                    players.map((x, j) =>
                      j === i ? { ...x, faction: e.target.value as Faction, hero: defaultHero(e.target.value as Faction).id } : x,
                    ),
                  )
                }
              >
                {FACTIONS.map((f) => (
                  <option key={f} value={f}>
                    {a.faction(f)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              {t.cards.heroPick}{" "}
              <select value={p.hero} onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, hero: e.target.value } : x)))}>
                {heroes
                  .filter((h) => h.faction === p.faction)
                  .map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name} ({t.cards.heroType[h.type]}, {h.heroClass})
                    </option>
                  ))}
              </select>
            </label>
          </div>
        ))}
        {duplicate && <p className="error">{a.duplicateFaction}</p>}
        <p className="muted small">{t.ai.kindHint}</p>
        <label className="chk" title={t.ai.neutralAIHint}>
          <input type="checkbox" checked={neutrals} onChange={(e) => setNeutralAI(e.target.checked)} /> {t.ai.neutralAI}
        </label>
        <p className="muted small">{t.ai.neutralAIHint}</p>
      </section>

      <div className="start-row">
        <button className="btn primary big" disabled={invalid} onClick={() => start(false)}>
          {a.start}
        </button>
        <button className="btn big" disabled={invalid} onClick={() => start(true)} title={t.net.onlineHint}>
          {t.net.hostStart}
        </button>
      </div>
    </div>
  );
}
