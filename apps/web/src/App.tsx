import { useState } from "react";
import type { AdventureState, CombatState } from "@heroes/engine";
import { useI18n } from "./i18n.tsx";
import { SetupScreen, type CombatConfig } from "./screens/SetupScreen.tsx";
import { CombatScreen } from "./screens/CombatScreen.tsx";
import { AdventureSetupScreen } from "./screens/AdventureSetupScreen.tsx";
import { AdventureScreen } from "./screens/AdventureScreen.tsx";

type Screen =
  | { kind: "home" }
  | { kind: "combat-setup" }
  | { kind: "combat"; initial: CombatState; config: CombatConfig }
  | { kind: "adventure-setup" }
  | { kind: "adventure"; initial: AdventureState };

export function App() {
  const { t, lang, setLang } = useI18n();
  const [screen, setScreen] = useState<Screen>({ kind: "home" });

  return (
    <div className="app">
      <header className="topbar">
        <h1>{t.appTitle}</h1>
        <div className="topbar-actions">
          {screen.kind !== "home" && (
            <button className="btn ghost" onClick={() => setScreen({ kind: "home" })}>
              {t.adv.back}
            </button>
          )}
          <button className="btn ghost" onClick={() => setLang(lang === "fr" ? "en" : "fr")}>
            {t.language}
          </button>
        </div>
      </header>
      <main className={screen.kind === "adventure" ? "wide" : ""}>
        {screen.kind === "home" && (
          <div className="home">
            <h2>{t.adv.home}</h2>
            <button className="mode-card" onClick={() => setScreen({ kind: "adventure-setup" })}>
              <strong>{t.adv.modeAdventure}</strong>
              <span>{t.adv.modeAdventureHint}</span>
            </button>
            <button className="mode-card" onClick={() => setScreen({ kind: "combat-setup" })}>
              <strong>{t.adv.modeCombat}</strong>
              <span>{t.adv.modeCombatHint}</span>
            </button>
          </div>
        )}
        {screen.kind === "combat-setup" && (
          <SetupScreen onStart={(initial, config) => setScreen({ kind: "combat", initial, config })} />
        )}
        {screen.kind === "combat" && <CombatScreen initial={screen.initial} config={screen.config} />}
        {screen.kind === "adventure-setup" && (
          <AdventureSetupScreen onStart={(initial) => setScreen({ kind: "adventure", initial })} />
        )}
        {screen.kind === "adventure" && <AdventureScreen initial={screen.initial} />}
      </main>
      <footer className="footer">{t.ruleRef}</footer>
    </div>
  );
}
