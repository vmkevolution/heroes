import type { ReactNode } from "react";
import { getScenario, type Scenario } from "@heroes/data";
import type { AdventureAction, AdventureState, PlayerId } from "@heroes/engine";
import { useI18n } from "../i18n.tsx";

const GLYPHS: Record<string, string> = {
  gold: "🪙",
  building_materials: "🪵",
  valuables: "💎",
  attack: "⚔",
  defense: "🛡",
  damage: "💥",
  movement_points: "👣",
  experience: "⭐",
  positive_morale: "🙂",
  negative_morale: "🙁",
  hand: "✋",
  artifact: "🏺",
  skill: "📘",
  might: "💪",
  magic: "✨",
  spellpower: "🔮",
  empower: "⏫",
  resource_die: "🎲",
  treasure_die: "🎲",
  map_effect: "🗺",
  unit_ranged: "🏹",
  unit_flying: "🪽",
  bronze_tier: "🥉",
  silver_tier: "🥈",
  gold_tier: "🥇",
  azure_tier: "🔷",
  movement_token_green: "🟢",
  movement_token_red: "🔴",
  building_special_tent: "⛺",
  building_special_gears: "⚙",
};

/** **bold**, *italic* and :glyph: inside one line of the converted Mission Book text. */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|:([a-z_]+):/g;
  let at = 0;
  for (const m of text.matchAll(re)) {
    if (m.index > at) out.push(text.slice(at, m.index));
    if (m[1] !== undefined) out.push(<strong key={m.index}>{m[1]}</strong>);
    else if (m[2] !== undefined) out.push(<em key={m.index}>{m[2]}</em>);
    else out.push(<span key={m.index} className="glyph" title={m[3]!.replace(/_/g, " ")}>{GLYPHS[m[3]!] ?? `[${m[3]}]`}</span>);
    at = m.index + m[0].length;
  }
  out.push(text.slice(at));
  return out;
}

/** Paragraphs and "- " lists, the only block structure the importer produces. */
export function MissionText({ body }: { body: string }) {
  const blocks = body.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  const out: ReactNode[] = [];
  let list: string[] = [];
  const flush = () => {
    if (list.length) out.push(<ul key={out.length}>{list.map((l, i) => <li key={i}>{inline(l)}</li>)}</ul>);
    list = [];
  };
  for (const b of blocks) {
    if (b.startsWith("- ")) list.push(b.slice(2).replace(/\n/g, " "));
    else {
      flush();
      out.push(<p key={out.length}>{inline(b)}</p>);
    }
  }
  flush();
  return <div className="mission-text">{out}</div>;
}

export function scenarioTexts(sc: Scenario, lang: "fr" | "en") {
  const fr = lang === "fr";
  return {
    title: fr ? sc.title.fr : sc.title.en,
    series: fr ? sc.series.fr : sc.series.en,
    text: fr && sc.text.fr.length ? sc.text.fr : sc.text.en,
    events: fr && sc.timedEvents.fr.length ? sc.timedEvents.fr : sc.timedEvents.en,
  };
}

export function ScenarioSections({ sc }: { sc: Scenario }) {
  const { t, lang } = useI18n();
  const { text } = scenarioTexts(sc, lang);
  return (
    <div className="scenario-sections">
      {lang === "fr" && sc.untranslated > 0 && <p className="muted small">{t.sc.untranslated}</p>}
      {text.map((s, i) => (
        <details key={i} open={i === 0}>
          <summary>{s.title || scenarioTexts(sc, lang).title}</summary>
          <MissionText body={s.body} />
        </details>
      ))}
      <p className="muted small">{t.sc.source}</p>
    </div>
  );
}

/** In-game panel: the events of the current Round, the Scenario text and the victory declaration. */
export function ScenarioPanel({
  state,
  player,
  onAction,
}: {
  state: AdventureState;
  player: PlayerId | null;
  onAction: (a: AdventureAction) => void;
}) {
  const { t, lang } = useI18n();
  const sc = state.scenarioId ? getScenario(state.scenarioId) : null;
  if (!sc) return null;
  const { title, series, events } = scenarioTexts(sc, lang);
  const now = events.filter((e) => e.rounds.includes(state.round));
  const pending = player !== null && state.victoryPending.includes(player);
  return (
    <div className="panel scenario-panel">
      <h3>
        {t.sc.panel} : {title}
      </h3>
      <p className="muted small">{series}</p>
      <h4>{t.sc.events(state.round)}</h4>
      {now.length ? now.map((e, i) => <MissionText key={i} body={e.text} />) : <p className="muted small">{t.sc.noEvents}</p>}
      {player !== null && state.phase.type !== "over" && (
        <button
          className="btn"
          disabled={pending}
          title={t.sc.declareHint}
          onClick={() => onAction({ type: "declare-victory", player })}
        >
          {t.sc.declare}
        </button>
      )}
      <details>
        <summary>{t.sc.sections}</summary>
        <ScenarioSections sc={sc} />
      </details>
    </div>
  );
}
