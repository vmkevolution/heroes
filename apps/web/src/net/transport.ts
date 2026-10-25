/**
 * Links between browsers. Online play uses WebRTC through PeerJS (free public signalling server,
 * then a direct connection, so no hosting cost); `local:` rooms use a BroadcastChannel between tabs
 * of the same browser (tests, or two windows on one PC).
 */
import Peer, { type DataConnection } from "peerjs";

export interface Link {
  id: string;
  send(msg: unknown): void;
  onMessage(fn: (msg: unknown) => void): void;
  onClose(fn: () => void): void;
  close(): void;
}

export interface Room {
  id: string;
  onLink(fn: (link: Link) => void): void;
  close(): void;
}

const PREFIX = "heroes-hmm3bg-";

export function newRoomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function peerLink(conn: DataConnection): Link {
  const closers: (() => void)[] = [];
  conn.on("close", () => closers.forEach((f) => f()));
  conn.on("error", () => closers.forEach((f) => f()));
  return {
    id: conn.peer,
    send: (msg) => conn.open && conn.send(msg),
    onMessage: (fn) => conn.on("data", fn),
    onClose: (fn) => closers.push(fn),
    close: () => conn.close(),
  };
}

type Wire = { room: string; from: string; to: string; kind: "open" | "data" | "close"; data?: unknown };

function channelLink(ch: BroadcastChannel, room: string, me: string, other: string): Link & { deliver(w: Wire): void } {
  const handlers: ((msg: unknown) => void)[] = [];
  const closers: (() => void)[] = [];
  return {
    id: other,
    send: (data) => ch.postMessage({ room, from: me, to: other, kind: "data", data } satisfies Wire),
    onMessage: (fn) => handlers.push(fn),
    onClose: (fn) => closers.push(fn),
    close: () => ch.postMessage({ room, from: me, to: other, kind: "close" } satisfies Wire),
    deliver: (w) => (w.kind === "data" ? handlers.forEach((f) => f(w.data)) : closers.forEach((f) => f())),
  };
}

export function openRoom(id: string, onError: (e: string) => void): Room {
  const linkFns: ((l: Link) => void)[] = [];
  if (id.startsWith("local:")) {
    const ch = new BroadcastChannel("heroes-net");
    const links = new Map<string, ReturnType<typeof channelLink>>();
    ch.onmessage = (e: MessageEvent<Wire>) => {
      const w = e.data;
      if (w.room !== id || w.to !== "host") return;
      if (w.kind === "open") {
        const link = channelLink(ch, id, "host", w.from);
        links.set(w.from, link);
        ch.postMessage({ room: id, from: "host", to: w.from, kind: "open" } satisfies Wire);
        linkFns.forEach((f) => f(link));
      } else links.get(w.from)?.deliver(w);
    };
    return { id, onLink: (fn) => linkFns.push(fn), close: () => ch.close() };
  }
  const peer = new Peer(PREFIX + id);
  peer.on("connection", (conn) => conn.on("open", () => linkFns.forEach((f) => f(peerLink(conn)))));
  peer.on("error", (e) => onError(String(e.type ?? e)));
  return { id, onLink: (fn) => linkFns.push(fn), close: () => peer.destroy() };
}

export function joinRoom(id: string): Promise<Link> {
  if (id.startsWith("local:")) {
    return new Promise((resolve) => {
      const me = `guest-${Math.random().toString(36).slice(2, 8)}`;
      const ch = new BroadcastChannel("heroes-net");
      const link = channelLink(ch, id, me, "host");
      ch.onmessage = (e: MessageEvent<Wire>) => {
        const w = e.data;
        if (w.room !== id || w.to !== me) return;
        if (w.kind === "open") resolve(link);
        else link.deliver(w);
      };
      ch.postMessage({ room: id, from: me, to: "host", kind: "open" } satisfies Wire);
    });
  }
  return new Promise((resolve, reject) => {
    const peer = new Peer();
    peer.on("error", (e) => reject(new Error(String(e.type ?? e))));
    peer.on("open", () => {
      const conn = peer.connect(PREFIX + id, { reliable: true });
      conn.on("open", () => resolve(peerLink(conn)));
      conn.on("error", (e) => reject(e));
    });
  });
}
