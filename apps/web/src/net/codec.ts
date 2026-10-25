/** Game records as compact text: JSON, deflated, base64url. Used for save links and async play. */
import { RECORD_VERSION, type GameRecord } from "@heroes/engine";

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array {
  const bin = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export async function encodeRecord(record: GameRecord): Promise<string> {
  return toBase64Url(await pipe(new TextEncoder().encode(JSON.stringify(record)), new CompressionStream("deflate-raw")));
}

export async function decodeRecord(code: string): Promise<GameRecord> {
  const json = new TextDecoder().decode(await pipe(fromBase64Url(code.trim()), new DecompressionStream("deflate-raw")));
  return parseRecord(json);
}

export function parseRecord(json: string): GameRecord {
  const r = JSON.parse(json) as GameRecord;
  if (r?.v !== RECORD_VERSION || !r.setup || !Array.isArray(r.actions)) throw new Error("not a Heroes save");
  return r;
}

/** Link that reopens the game where it stands, for async play by message. */
export async function gameLink(record: GameRecord): Promise<string> {
  return `${location.origin}${location.pathname}#g=${await encodeRecord(record)}`;
}

const AUTOSAVE = "heroes-autosave";

export function autosave(record: GameRecord) {
  try {
    localStorage.setItem(AUTOSAVE, JSON.stringify(record));
  } catch {
    // storage full or blocked: the file export still works
  }
}

export function loadAutosave(): GameRecord | null {
  try {
    const raw = localStorage.getItem(AUTOSAVE);
    return raw ? parseRecord(raw) : null;
  } catch {
    return null;
  }
}

export function downloadRecord(record: GameRecord) {
  const blob = new Blob([JSON.stringify(record)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `heroes-round${record.actions.length}-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
