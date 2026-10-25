import { useState } from "react";
import { FACTIONS, getMap, heroes, scenarios, type Faction } from "@heroes/data";
import { defaultAiHero, defaultHero, playableMaps, seatFactions } from "@heroes/engine";
import type { AdventureSetup, Difficulty } from "@heroes/engine";
import { useI18n } from "../i18n.tsx";
import { ScenarioSections, scenarioTexts } from "./ScenarioPanel.tsx";

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard", "impossible"];
const SANDBOX = "";
const PLAYABLE = new Set(playableMaps());
/** Mission Book Scenarios with at least one map the game can lay out. */
const SCENARIOS = scenarios.filter((sc) => sc.maps.some((m) => PLAYABLE.has(m)));
const mapsOf = (id: string) => (id === SANDBOX ? ["hunt-2", "hunt-3"] : getScenarioMaps(id));
function getScenarioMaps(id: string) {
  return SCENARIOS.find((sc) => sc.id === id)!.maps.filter((m) => PLAYABLE.has(m)).sort((a, b) => seatsOf(a) - seatsOf(b));
}
const seatsOf = (map: string) => (map === "hunt-2" ? 2 : map === "hunt-3" ? 3 : getMap(map).seats);
const PLAYER_NAMES = Array.from({ length: 6 }, (_, i) => `Joueur ${i + 1}`);

export function AdventureSetupScreen({ onStart }: { onStart: (setup: AdventureSetup, online: boolean) => void }) {
  const { t } = useI18n();
  const a = t.adv;
  const { lang } = useI18n();
  const [scenario, setScenario] = useState(SANDBOX);
  const [map, setMap] = useState("hunt-2");
  const count = seatsOf(map);
  const imposed = map.startsWith("hunt-") ? [] : seatFactions(map);
  type Kind = "human" | "computer" | "aiHero";
  type Seat = { name: string; faction: Faction; hero: string; kind: Kind };
  const START: Faction[] = ["castle", "necropolis", "dungeon", "rampart", "inferno", "tower"];
  const [players, setPlayers] = useState<Seat[]>(
    START.map((f, i) => ({ name: PLAYER_NAMES[i]!, faction: f, hero: defaultHero(f).id, kind: "human" })),
  );
  const choose = (sc: string, m: string) => {
    setScenario(sc);
    setMap(m);
    const fixed = m.startsWith("hunt-") ? [] : seatFactions(m);
    const campaign = SCENARIOS.find((x) => x.id === sc)?.kind === "campaign";
    // Seats whose Starting Tile is fixed take its Faction; the others keep theirs when it is still free.
    const taken = new Set(fixed.filter(Boolean));
    setPlayers((prev) => {
      const next = prev.map((p, i) => {
        const f = fixed[i];
        if (f) return { ...p, faction: f, hero: p.faction === f ? p.hero : defaultHero(f).id };
        return p;
      });
      for (let i = 0; i < next.length; i++) {
        if (fixed[i] || !taken.has(next[i]!.faction)) {
          taken.add(next[i]!.faction);
          continue;
        }
        const f = FACTIONS.find((x) => !taken.has(x))!;
        taken.add(f);
        next[i] = { ...next[i]!, faction: f, hero: defaultHero(f).id };
      }
      // A Campaign is played alone against AI Heroes (p. 49): keep one human seat, on the player's Faction when the map says so.
      if (campaign) {
        const seats = fixed.length;
        // Campaign ids start with the player's Faction (inferno_devilish_plan).
        const own = FACTIONS.find((f) => sc.startsWith(`${f}_`));
        const human = Math.max(0, own ? fixed.indexOf(own) : next.slice(0, seats).findIndex((p) => p.kind === "human"));
        return next.map((p, i) => (i < seats ? { ...p, kind: i === human ? "human" : "aiHero" } : p));
      }
      return next;
    });
  };
  const [neutralAI, setNeutralAI] = useState<boolean | null>(null);
  const [difficulty, setDifficulty] = useState<Difficulty>("normal");
  const chosen = players.slice(0, count);
  const humans = chosen.filter((p) => p.kind === "human").length;
  const neutrals = neutralAI ?? humans < 2;
  const duplicate = new Set(chosen.map((p) => p.faction)).size !== chosen.length;
  const invalid = duplicate || chosen.some((p) => !p.name.trim()) || humans === 0;
  const current = SCENARIOS.find((sc) => sc.id === scenario);

  const start = (online: boolean) =>
    onStart(
      {
        layout: map,
        scenario: scenario || undefined,
        players: chosen.map((p) => ({
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
        <div className="row-gap">
          <span>{t.sc.scenario}</span>
          <select
            value={scenario}
            onChange={(e) => choose(e.target.value, mapsOf(e.target.value)[0]!)}
          >
            <option value={SANDBOX}>{t.sc.sandbox}</option>
            {(["clash", "cooperative", "campaign"] as const).map((k) => (
              <optgroup key={k} label={t.sc.kinds[k]}>
                {SCENARIOS.filter((sc) => sc.kind === k).map((sc) => {
                  const tx = scenarioTexts(sc, lang);
                  return (
                    <option key={sc.id} value={sc.id}>
                      {k === "campaign" ? `${tx.series} : ${tx.title}` : tx.title}
                    </option>
                  );
                })}
              </optgroup>
            ))}
          </select>
        </div>
        <div className="row-gap">
          <span>{t.sc.map}</span>
          <div className="segmented">
            {mapsOf(scenario).map((m) => (
              <button key={m} className={map === m ? "on" : ""} onClick={() => choose(scenario, m)}>
                {mapsOf(scenario).length > 1 && new Set(mapsOf(scenario).map(seatsOf)).size === mapsOf(scenario).length
                  ? t.sc.seats(seatsOf(m))
                  : `${m.replace(/_/g, " ")} (${t.sc.seats(seatsOf(m))})`}
              </button>
            ))}
          </div>
          <span className="muted small">{t.sc.rounds(current ? current.maxRounds : 14)}</span>
        </div>
        <div className="row-gap">
          <span>{a.difficulty}</span>
          <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
            {DIFFICULTIES.map((d) => (
              <option key={d} value={d}>
                {a.difficulties[d]}
              </option>
            ))}
          </select>
        </div>
        {current ? (
          <>
            <p className="muted small">{t.sc.manual}</p>
            <details className="scenario-read">
              <summary>{t.sc.read}</summary>
              <ScenarioSections sc={current} />
            </details>
          </>
        ) : (
          <p className="muted">{a.sandboxNote}</p>
        )}
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
                disabled={!!imposed[i]}
                title={imposed[i] ? t.sc.imposed : undefined}
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
        {humans === 0 && <p className="error">{t.sc.needsHuman}</p>}
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
