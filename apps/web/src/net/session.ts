/**
 * Game sessions. Hotseat keeps everything local; online, the host's browser is the referee: guests send
 * actions, the host checks the sender's seats (`mayAct`) and the rules, then sends the action to everyone.
 * Peers replay the same actions on the same seed, so they always hold the same state.
 */
import { useEffect, useRef, useState } from "react";
import { applyAdventureAction, mayAct, replay, type AdventureAction, type AdventureState, type GameRecord, type PlayerId } from "@heroes/engine";
import { autosave } from "./codec.ts";
import { joinRoom, openRoom, type Link, type Room } from "./transport.ts";

export type SessionMode =
  | { kind: "local"; record: GameRecord }
  | { kind: "host"; record: GameRecord; room: string; name: string }
  | { kind: "guest"; room: string; name: string };

/**
 * Who sits where: player id → peer id ("host" or a guest link id), "ai" for computer players, or ""
 * for a free seat. Free seats are played on the host's screen until a guest takes them.
 */
export type Seats = Record<PlayerId, string>;

type ToHost =
  | { t: "hello"; name: string }
  | { t: "claim"; seat: PlayerId }
  | { t: "release"; seat: PlayerId }
  | { t: "act"; action: AdventureAction; at: number };

type ToGuest =
  | { t: "sync"; record: GameRecord; seats: Seats; names: Record<string, string>; you: string }
  | { t: "seats"; seats: Seats; names: Record<string, string> }
  | { t: "act"; action: AdventureAction; index: number }
  | { t: "error"; message: string };

export interface Session {
  mode: SessionMode["kind"];
  status: "connecting" | "ready" | "closed" | "error";
  problem: string | null;
  state: AdventureState | null;
  record: GameRecord | null;
  seats: Seats;
  names: Record<string, string>;
  me: string;
  local: (player: PlayerId) => boolean;
  act: (action: AdventureAction) => string | null;
  claim: (seat: PlayerId) => void;
  release: (seat: PlayerId) => void;
  room: string | null;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Checks an action against the rules without applying it. */
function check(state: AdventureState, action: AdventureAction): string | null {
  try {
    applyAdventureAction(state, action);
    return null;
  } catch (e) {
    return errorText(e);
  }
}

export function useSession(mode: SessionMode, notYourTurn: string): Session {
  const [, setTick] = useState(0);
  const rerender = () => setTick((n) => n + 1);
  const ref = useRef<{
    state: AdventureState | null;
    record: GameRecord | null;
    seats: Seats;
    names: Record<string, string>;
    me: string;
    status: Session["status"];
    problem: string | null;
    links: Map<string, Link>;
    host: Link | null;
  } | null>(null);
  if (!ref.current) {
    const record = mode.kind === "guest" ? null : mode.record;
    const state = record ? replay(record) : null;
    ref.current = {
      state,
      record,
      seats: state
        ? Object.fromEntries(
            state.players.map((p, i) => [p.id, state.ai.players.includes(p.id) || p.id in state.ai.heroes ? "ai" : i === 0 ? "host" : ""]),
          )
        : {},
      names: mode.kind === "guest" ? {} : { host: mode.kind === "host" ? mode.name : "" },
      me: mode.kind === "guest" ? "" : "host",
      status: mode.kind === "guest" ? "connecting" : "ready",
      problem: null,
      links: new Map(),
      host: null,
    };
  }
  const s = ref.current;

  const push = (action: AdventureAction) => {
    s.state = applyAdventureAction(s.state!, action);
    s.record = { ...s.record!, actions: [...s.record!.actions, action] };
    if (mode.kind !== "guest") autosave(s.record);
  };
  const broadcast = (msg: ToGuest) => s.links.forEach((l) => l.send(msg));
  const seatsMsg = (): ToGuest => ({ t: "seats", seats: s.seats, names: s.names });
  const seatsOf = (peer: string) =>
    Object.entries(s.seats)
      .filter(([, o]) => o === peer || (peer === "host" && o === ""))
      .map(([p]) => p);

  useEffect(() => {
    if (mode.kind === "local") return;
    let room: Room | null = null;
    let closed = false;
    if (mode.kind === "host") {
      room = openRoom(mode.room, (e) => {
        s.problem = e;
        rerender();
      });
      room.onLink((link) => {
        s.links.set(link.id, link);
        link.onMessage((raw) => {
          const msg = raw as ToHost;
          if (msg.t === "hello") {
            s.names[link.id] = msg.name.slice(0, 20) || "?";
            link.send({ t: "sync", record: s.record!, seats: s.seats, names: s.names, you: link.id } satisfies ToGuest);
            broadcast(seatsMsg());
          } else if (msg.t === "claim") {
            if (s.seats[msg.seat] === "") s.seats[msg.seat] = link.id;
            broadcast(seatsMsg());
          } else if (msg.t === "release") {
            if (s.seats[msg.seat] === link.id) s.seats[msg.seat] = "";
            broadcast(seatsMsg());
          } else if (msg.t === "act") {
            const problem =
              msg.at !== s.record!.actions.length
                ? "out of date"
                : !mayAct(s.state!, msg.action, seatsOf(link.id))
                  ? notYourTurn
                  : check(s.state!, msg.action);
            if (problem) {
              link.send({ t: "error", message: problem } satisfies ToGuest);
              if (msg.at !== s.record!.actions.length) link.send({ t: "sync", record: s.record!, seats: s.seats, names: s.names, you: link.id } satisfies ToGuest);
              return;
            }
            push(msg.action);
            broadcast({ t: "act", action: msg.action, index: s.record!.actions.length - 1 });
          }
          rerender();
        });
        link.onClose(() => {
          s.links.delete(link.id);
          for (const [p, o] of Object.entries(s.seats)) if (o === link.id) s.seats[p] = "";
          delete s.names[link.id];
          broadcast(seatsMsg());
          rerender();
        });
      });
    } else {
      joinRoom(mode.room).then(
        (link) => {
          if (closed) return link.close();
          s.host = link;
          link.onMessage((raw) => {
            const msg = raw as ToGuest;
            if (msg.t === "sync") {
              s.record = msg.record;
              s.state = replay(msg.record);
              s.seats = msg.seats;
              s.names = msg.names;
              s.me = msg.you;
              s.status = "ready";
            } else if (msg.t === "seats") {
              s.seats = msg.seats;
              s.names = msg.names;
            } else if (msg.t === "act") {
              if (msg.index === s.record!.actions.length) push(msg.action);
              else link.send({ t: "hello", name: mode.name } satisfies ToHost);
            } else if (msg.t === "error") s.problem = msg.message;
            rerender();
          });
          link.onClose(() => {
            s.status = "closed";
            rerender();
          });
          link.send({ t: "hello", name: mode.name } satisfies ToHost);
        },
        (e) => {
          s.status = "error";
          s.problem = errorText(e);
          rerender();
        },
      );
    }
    return () => {
      closed = true;
      room?.close();
      s.host?.close();
      s.links.forEach((l) => l.close());
    };
    // the session lives as long as the screen; mode never changes for a mounted session
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const local = (p: PlayerId) => {
    const ai = s.state !== null && (s.state.ai.players.includes(p) || p in s.state.ai.heroes);
    return !ai && (mode.kind === "local" || seatsOf(s.me).includes(p));
  };

  const act = (action: AdventureAction): string | null => {
    if (!s.state) return null;
    if (mode.kind !== "local" && !mayAct(s.state, action, seatsOf(s.me))) return notYourTurn;
    const problem = check(s.state, action);
    if (problem) return problem;
    s.problem = null;
    if (mode.kind === "guest") {
      s.host?.send({ t: "act", action, at: s.record!.actions.length } satisfies ToHost);
      return null;
    }
    push(action);
    if (mode.kind === "host") broadcast({ t: "act", action, index: s.record!.actions.length - 1 });
    rerender();
    return null;
  };

  const claim = (seat: PlayerId) => {
    if (mode.kind === "guest") s.host?.send({ t: "claim", seat } satisfies ToHost);
  };
  const release = (seat: PlayerId) => {
    if (mode.kind === "guest") s.host?.send({ t: "release", seat } satisfies ToHost);
    else if (mode.kind === "host") {
      // the host takes a seat back from a guest who left it idle
      s.seats[seat] = "";
      broadcast(seatsMsg());
      rerender();
    }
  };

  return {
    mode: mode.kind,
    status: s.status,
    problem: s.problem,
    state: s.state,
    record: s.record,
    seats: s.seats,
    names: s.names,
    me: s.me,
    local,
    act,
    claim,
    release,
    room: mode.kind === "local" ? null : mode.room,
  };
}
