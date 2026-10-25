import { useState } from "react";
import type { GameRecord } from "@heroes/engine";
import { useI18n } from "../i18n.tsx";
import { downloadRecord, gameLink, loadAutosave, decodeRecord, parseRecord } from "../net/codec.ts";
import { useSession, type Session, type SessionMode } from "../net/session.ts";
import { AdventureScreen } from "./AdventureScreen.tsx";

/** Runs an adventure game in one of the session modes, with the save / invite panel beside the map. */
export function GameScreen({ mode, onHost }: { mode: SessionMode; onHost: (record: GameRecord) => void }) {
  const { t } = useI18n();
  const session = useSession(mode, t.net.notYourTurn);
  if (!session.state) {
    return (
      <div className="panel narrow">
        <p>
          {session.status === "error" ? t.net.failed(session.problem ?? "") : session.status === "closed" ? t.net.closed : t.net.connecting}
        </p>
      </div>
    );
  }
  return (
    <AdventureScreen
      state={session.state}
      onAction={session.act}
      local={session.local}
      session={<SessionPanel session={session} onHost={onHost} />}
    />
  );
}

function CopyButton({ label, text }: { label: string; text: () => Promise<string> | string }) {
  const { t } = useI18n();
  const [done, setDone] = useState(false);
  return (
    <button
      className="btn small"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(await text());
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        } catch {
          // clipboard blocked: the link stays visible in the panel
        }
      }}
    >
      {done ? t.net.copied : label}
    </button>
  );
}

export const inviteLink = (room: string) => `${location.origin}${location.pathname}?join=${encodeURIComponent(room)}`;

function SessionPanel({ session, onHost }: { session: Session; onHost: (record: GameRecord) => void }) {
  const { t } = useI18n();
  const n = t.net;
  const [open, setOpen] = useState(session.mode !== "local");
  const state = session.state!;
  const owner = (id: string) =>
    id === session.me
      ? n.seatYou
      : id === ""
        ? n.seatFree
        : id === "ai"
          ? t.ai.kinds.computer
        : id === "host"
          ? n.hostName(session.names.host || "?")
          : (session.names[id] ?? "?");
  const guests = Object.keys(session.names).filter((k) => k !== "host").length;
  return (
    <div className="panel session">
      <h3 className="clickable" onClick={() => setOpen(!open)}>
        {open ? "▾" : "▸"} {session.mode === "local" ? n.game : n.onlineTitle}
        {session.mode === "host" && <span className="muted small"> · {n.guests(guests)}</span>}
      </h3>
      {session.problem && <p className="error">{session.problem}</p>}
      {session.status === "closed" && <p className="error">{n.closed}</p>}
      {open && (
        <>
          {session.mode === "host" && (
            <div className="invite">
              <span className="small">{n.invite} :</span> <code className="invite-link">{inviteLink(session.room!)}</code>{" "}
              <CopyButton label={n.copy} text={() => inviteLink(session.room!)} />
              <p className="muted small">{n.inviteHint}</p>
            </div>
          )}
          {session.mode !== "local" && (
            <ul className="seats">
              {state.players.map((p) => {
                const o = session.seats[p.id] ?? "";
                return (
                  <li key={p.id}>
                    <strong>{p.name}</strong> · {owner(o)}{" "}
                    {session.mode === "guest" && o === "" && (
                      <button className="btn small" onClick={() => session.claim(p.id)}>
                        {n.take}
                      </button>
                    )}
                    {session.mode === "guest" && o === session.me && (
                      <button className="btn small ghost" onClick={() => session.release(p.id)}>
                        {n.leave}
                      </button>
                    )}
                    {session.mode === "host" && o !== "host" && o !== "" && (
                      <button className="btn small ghost" onClick={() => session.release(p.id)}>
                        {n.kick}
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          <div className="buttons">
            <button className="btn small" onClick={() => downloadRecord(session.record!)}>
              {n.saveFile}
            </button>
            <CopyButton label={n.copyLink} text={() => gameLink(session.record!)} />
            {session.mode === "local" && (
              <button className="btn small" onClick={() => onHost(session.record!)}>
                {n.hostOnline}
              </button>
            )}
          </div>
          {session.mode === "local" && <p className="muted small">{n.linkHint}</p>}
        </>
      )}
    </div>
  );
}

/** Home screen block: resume the autosave, or load a file / link / code. */
export function LoadPanel({ onLoad }: { onLoad: (record: GameRecord) => void }) {
  const { t } = useI18n();
  const n = t.net;
  const [code, setCode] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const saved = loadAutosave();
  const fromCode = async () => {
    try {
      const text = code.trim();
      onLoad(text.startsWith("{") ? parseRecord(text) : await decodeRecord(text.includes("#g=") ? text.split("#g=")[1]! : text));
    } catch {
      setProblem(n.badSave);
    }
  };
  return (
    <div className="panel load-panel">
      {saved && (
        <div className="resume">
          <button className="btn primary" onClick={() => onLoad(saved)}>
            {n.resume}
          </button>{" "}
          <span className="muted small">{n.resumeHint(saved.actions.length)}</span>
        </div>
      )}
      <h3>{n.load}</h3>
      <p className="muted small">{n.loadHint}</p>
      <label className="btn small">
        {n.loadFile}
        <input
          type="file"
          accept=".json,application/json"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (!f) return;
            try {
              onLoad(parseRecord(await f.text()));
            } catch {
              setProblem(n.badSave);
            }
          }}
        />
      </label>
      <div className="row-gap">
        <input className="code-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="https://…#g=…" />
        <button className="btn small" disabled={!code.trim()} onClick={fromCode}>
          {n.loadCode}
        </button>
      </div>
      {problem && <p className="error">{problem}</p>}
    </div>
  );
}

export function JoinScreen({ room, onJoin }: { room: string; onJoin: (name: string) => void }) {
  const { t } = useI18n();
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem("heroes-name") ?? "";
    } catch {
      return "";
    }
  });
  return (
    <div className="panel narrow">
      <h2>{t.net.joinTitle}</h2>
      <p className="muted small">{room}</p>
      <label>
        {t.net.yourName}{" "}
        <input value={name} maxLength={20} onChange={(e) => setName(e.target.value)} />
      </label>{" "}
      <button
        className="btn primary"
        disabled={!name.trim()}
        onClick={() => {
          try {
            localStorage.setItem("heroes-name", name.trim());
          } catch {
            // not remembered, that's all
          }
          onJoin(name.trim());
        }}
      >
        {t.net.join}
      </button>
    </div>
  );
}
