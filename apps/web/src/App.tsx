import { useEffect, useState } from "react";
import { RECORD_VERSION, type CombatState, type GameRecord } from "@heroes/engine";
import { useI18n } from "./i18n.tsx";
import { SetupScreen, type CombatConfig } from "./screens/SetupScreen.tsx";
import { CombatScreen } from "./screens/CombatScreen.tsx";
import { AdventureSetupScreen } from "./screens/AdventureSetupScreen.tsx";
import { GameScreen, JoinScreen, LoadPanel } from "./screens/GameScreen.tsx";
import { decodeRecord } from "./net/codec.ts";
import { newRoomId } from "./net/transport.ts";
import type { SessionMode } from "./net/session.ts";

type Screen =
  | { kind: "home" }
  | { kind: "combat-setup" }
  | { kind: "combat"; initial: CombatState; config: CombatConfig }
  | { kind: "adventure-setup" }
  | { kind: "join"; room: string }
  | { kind: "game"; mode: SessionMode; key: number };

/** `?localnet` makes online games use a BroadcastChannel between tabs (tests, two windows on one PC). */
const newRoom = () => (new URLSearchParams(location.search).has("localnet") ? "local:" : "") + newRoomId();

function initialScreen(): Screen {
  const room = new URLSearchParams(location.search).get("join");
  return room ? { kind: "join", room } : { kind: "home" };
}

export function App() {
  const { t, lang, setLang } = useI18n();
  const [screen, setScreen] = useState<Screen>(initialScreen);
  const play = (mode: SessionMode) => setScreen({ kind: "game", mode, key: Date.now() });
  const host = (record: GameRecord) => play({ kind: "host", record, room: newRoom(), name: record.setup.players[0]?.name ?? "" });

  // A game link (#g=…) opens that game on this screen.
  useEffect(() => {
    const code = location.hash.startsWith("#g=") ? location.hash.slice(3) : null;
    if (!code) return;
    decodeRecord(code)
      .then((record) => {
        history.replaceState(null, "", location.pathname + location.search);
        play({ kind: "local", record });
      })
      .catch(() => undefined);
  }, []);

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
      <main className={screen.kind === "game" ? "wide" : ""}>
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
            <LoadPanel onLoad={(record) => play({ kind: "local", record })} />
          </div>
        )}
        {screen.kind === "combat-setup" && (
          <SetupScreen onStart={(initial, config) => setScreen({ kind: "combat", initial, config })} />
        )}
        {screen.kind === "combat" && <CombatScreen initial={screen.initial} config={screen.config} />}
        {screen.kind === "adventure-setup" && (
          <AdventureSetupScreen
            onStart={(setup, online) => {
              const record: GameRecord = { v: RECORD_VERSION, setup, actions: [] };
              if (online) host(record);
              else play({ kind: "local", record });
            }}
          />
        )}
        {screen.kind === "join" && (
          <JoinScreen room={screen.room} onJoin={(name) => play({ kind: "guest", room: screen.room, name })} />
        )}
        {screen.kind === "game" && <GameScreen key={screen.key} mode={screen.mode} onHost={host} />}
      </main>
      <footer className="footer">{t.ruleRef}</footer>
    </div>
  );
}
