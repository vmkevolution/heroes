import { useState } from "react";
import type { CombatState } from "@heroes/engine";
import { useI18n } from "./i18n.tsx";
import { SetupScreen, type CombatConfig } from "./screens/SetupScreen.tsx";
import { CombatScreen } from "./screens/CombatScreen.tsx";

export function App() {
  const { t, lang, setLang } = useI18n();
  const [game, setGame] = useState<{ initial: CombatState; config: CombatConfig } | null>(null);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          {t.appTitle} <span className="subtitle">{t.combatPrototype}</span>
        </h1>
        <div className="topbar-actions">
          {game && (
            <button className="btn ghost" onClick={() => setGame(null)}>
              {t.newCombat}
            </button>
          )}
          <button className="btn ghost" onClick={() => setLang(lang === "fr" ? "en" : "fr")}>
            {t.language}
          </button>
        </div>
      </header>
      <main>
        {game ? (
          <CombatScreen initial={game.initial} config={game.config} />
        ) : (
          <SetupScreen onStart={(initial, config) => setGame({ initial, config })} />
        )}
      </main>
      <footer className="footer">{t.ruleRef}</footer>
    </div>
  );
}
