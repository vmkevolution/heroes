/**
 * Converts the fan Mission Book (vendor/mission-book, CC BY-NC-SA 4.0) into
 * packages/data/src/generated/scenarios.json and maps.json. Run with `npm run import-mission-book`.
 *
 * Scenario texts are kept in English and French (from the po4a translations), as light Markdown with
 * wiki glyphs (`:gold:`). The numbers the engine needs (length, resources, income, map tiles) are
 * read from the English text.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { inflateSync } from "node:zlib";
import { MapLayout, Scenario, type Resource } from "../src/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const book = join(root, "vendor/mission-book");
const outDir = join(root, "packages/data/src/generated");

// ---------------------------------------------------------------------------
// Maps

/** Map editor ids (`F0` random far tile, `#F4` a fixed tile, `CU0` subterranean) to tile groups. */
const GROUPS: Record<string, string> = { S: "starting", F: "far", N: "near", C: "center" };

export const mapKey = (name: string) => name.replace(/\.(map|png)$/, "").replace(/-/g, "_");

function importMaps(): MapLayout[] {
  const dir = join(book, "map-files");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".map"))
    .sort()
    .map((f) => {
      const raw = JSON.parse(inflateSync(Buffer.from(readFileSync(join(dir, f), "utf8").trim(), "base64")).toString("utf8")) as {
        row: number;
        col: number;
        tileId: string;
        rotation: number;
      }[];
      let supported = true;
      const tiles = raw.map((t) => {
        const m = t.tileId.match(/^(#?)([SFNC])(U|W)?(\d+)$/);
        if (!m || m[3]) supported = false; // subterranean and water tiles are not in the game data yet
        const random = m ? m[4] === "0" : false;
        return {
          row: t.row,
          col: t.col,
          group: m ? GROUPS[m[2]!]! : "far",
          tile: random || !m ? null : `${m[1]}${m[2]}${m[4]}`,
          rotation: ((t.rotation % 6) + 6) % 6,
        };
      });
      return MapLayout.parse({ id: mapKey(f), tiles, seats: tiles.filter((t) => t.group === "starting").length, supported });
    });
}

// ---------------------------------------------------------------------------
// Translations

function parsePo(file: string): [string, string][] {
  const out: [string, string][] = [];
  const text = readFileSync(file, "utf8");
  const unquote = (lines: string) =>
    [...lines.matchAll(/"((?:[^"\\]|\\.)*)"/g)]
      .map((m) => m[1]!)
      .join("")
      .replace(/\\(.)/g, (_, c: string) => (c === "n" ? "\n" : c === "t" ? "\t" : c));
  for (const entry of text.split(/\n\n+/)) {
    const m = entry.match(/^msgid ((?:".*"\n?)+)msgstr ((?:".*"\n?)+)/m);
    if (!m) continue;
    const id = unquote(m[1]!);
    const str = unquote(m[2]!);
    if (id && str && !entry.includes("#, fuzzy")) out.push([id, str]);
  }
  return out;
}

/** Applies a po4a translation by replacing each translated paragraph in the English source. */
function translate(tex: string, po: [string, string][]): { text: string; missed: number } {
  let text = tex;
  let missed = 0;
  // Longest first, so that a paragraph is not broken by one of its sentences.
  for (const [id, str] of [...po].sort((a, b) => b[0].length - a[0].length)) {
    const key = id.trim();
    if (!key) continue;
    if (text.includes(key)) text = text.split(key).join(str.trim());
    else {
      // po4a strips the indentation of continuation lines.
      const loose = new RegExp(
        key
          .split("\n")
          .map((l) => l.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
          .join("\\n\\s*"),
      );
      if (loose.test(text)) text = text.replace(loose, () => str.trim());
      else missed += 1;
    }
  }
  return { text, missed };
}

// ---------------------------------------------------------------------------
// LaTeX to light Markdown

const SVG: Record<string, string> = {
  gold: ":gold:",
  building_materials: ":building_materials:",
  valuables: ":valuables:",
  bronze: ":bronze_tier:",
  silver: ":silver_tier:",
  golden: ":gold_tier:",
  azure: ":azure_tier:",
  experience: ":experience:",
  attack: ":attack:",
  "attack-yellow": ":attack:",
  defense: ":defense:",
  "defense-yellow": ":defense:",
  power: ":power:",
  knowledge: ":knowledge:",
  damage: ":damage:",
  "damage-yellow": ":damage:",
  movement: ":movement_points:",
  movement_points: ":movement_points:",
  resource: ":resource_die:",
  resource_die: ":resource_die:",
  treasure: ":treasure_die:",
  treasure_die: ":treasure_die:",
  map: ":map_effect:",
  morale_positive: ":positive_morale:",
  morale_negative: ":negative_morale:",
  spell: ":spell:",
  artifact: ":artifact:",
  might: ":might:",
  magic: ":magic:",
  expert: ":expert:",
  initiative: ":initiative:",
  hp: ":health_points:",
};

/** Removes `\cmd{…}` groups with nested braces. */
function stripGroup(s: string, cmd: string, keep: (inner: string) => string): string {
  let out = "";
  let i = 0;
  const token = `\\${cmd}`;
  for (;;) {
    const at = s.indexOf(token, i);
    if (at < 0) return out + s.slice(i);
    let j = at + token.length;
    while (s[j] === "[") j = s.indexOf("]", j) + 1;
    if (s[j] !== "{") {
      out += s.slice(i, j);
      i = j;
      continue;
    }
    let depth = 0;
    let k = j;
    for (; k < s.length; k++) {
      if (s[k] === "{") depth++;
      else if (s[k] === "}" && --depth === 0) break;
    }
    out += s.slice(i, at) + keep(s.slice(j + 1, k));
    i = k + 1;
  }
}

const ORDINAL_EN = (n: string) => `${n}${n.endsWith("1") && n !== "11" ? "st" : n.endsWith("2") && n !== "12" ? "nd" : n.endsWith("3") && n !== "13" ? "rd" : "th"}`;

export function texToMarkdown(tex: string, lang: "en" | "fr"): string {
  let s = tex.replace(/(^|[^\\])%.*$/gm, "$1");
  // Drop figures, tables of art and layout-only commands.
  s = s.replace(/\\addcontentsline\{toc\}\{[a-z]+\}\{(?:[^{}]|\{[^{}]*\})*\}/g, "");
  s = stripGroup(s, "transparent", () => "");
  s = stripGroup(s, "footnote", (x) => ` (${x.trim()})`);
  s = s.replace(/\\begin\{(tikzpicture|wrapfigure|figure)\}[\s\S]*?\\end\{\1\}/g, "");
  s = s.replace(/\\includegraphics(\[[^\]]*\])?\{[^}]*\}/g, "");
  s = s.replace(/\\(columnbreak|clearpage|newpage|medskip|bigskip|smallskip|centering|noindent|par|hfill|vfill)\b/g, "\n");
  s = s.replace(/\\(vspace|hspace|enlargethispage|vspace\*)\*?\{[^}]*\}/g, "");
  s = s.replace(/\\(begin|end)\{(multicols\*?|center|minipage|table\*?|tabularx|footnotesize|small)\}(\{[^}]*\})*(\[[^\]]*\])?/g, "\n");
  s = s.replace(/\\svg(\[[^\]]*\])?\{([^}]*)\}/g, (_, __, name: string) => SVG[name] ?? `:${name}:`);
  s = s.replace(/\\nth\{(\d+)\}/g, (_, n: string) => (lang === "fr" ? `${n}${n === "1" ? "er" : "e"}` : ORDINAL_EN(n)));
  s = stripGroup(s, "subsection*", (x) => `\n\n## ${x.replace(/\\MakeUppercase\{([^}]*)\}/, "$1")}\n\n`);
  s = stripGroup(s, "MakeUppercase", (x) => x);
  s = stripGroup(s, "textbf", (x) => `**${x}**`);
  s = stripGroup(s, "textit", (x) => `*${x}*`);
  s = stripGroup(s, "emph", (x) => `*${x}*`);
  s = s.replace(/\\href(withoutfootnote)?\{[^}]*\}\{([^}]*)\}/g, "$2");
  s = stripGroup(s, "href", () => "");
  s = stripGroup(s, "url", () => "");
  s = stripGroup(s, "tocsection", () => "");
  s = stripGroup(s, "raisebox", () => "");
  s = s.replace(/\\addscenariosection(\[[^\]]*\])?(\s*\{[^{}]*\})+/g, "");
  s = s.replace(/\\item\[\]/g, "\n  ");
  s = s.replace(/\\item\s*/g, "\n- ");
  s = s.replace(/\\begin\{(itemize|enumerate)\}(\[[^\]]*\])?|\\end\{(itemize|enumerate)\}/g, "\n");
  s = s.replace(/\\\\/g, "\n");
  s = s.replace(/``|''/g, '"').replace(/--/g, "–").replace(/~/g, " ").replace(/\\,/g, " ").replace(/\\&/g, "&").replace(/\\%/g, "%");
  s = s.replace(/\$-\$/g, "–").replace(/\$[^$]*\$/g, "");
  s = s.replace(/\\[a-zA-Z]+\*?(\[[^\]]*\])?/g, "").replace(/[{}]/g, "");
  return s
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trimEnd())
    .join("\n")
    .replace(/\n[ \t]+(?=[^-\s])/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** `## Title` sections of a converted scenario. */
function sections(md: string): { title: string; body: string }[] {
  const parts = md.split(/^## /m);
  const out: { title: string; body: string }[] = [];
  const intro = parts.shift()!.trim();
  if (intro) out.push({ title: "", body: intro });
  for (const p of parts) {
    const [title, ...rest] = p.split("\n");
    out.push({ title: title!.trim(), body: rest.join("\n").trim() });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Numbers for the engine

const RES: Record<string, Resource> = { ":gold:": "gold", ":building_materials:": "buildingMaterials", ":valuables:": "valuables" };

function parseResources(line: string | undefined): Partial<Record<Resource, number>> | null {
  if (!line) return null;
  const out: Partial<Record<Resource, number>> = {};
  for (const m of line.matchAll(/(\d+)\s*(:gold:|:building_materials:|:valuables:)/g)) out[RES[m[2]!]!] = Number(m[1]);
  return Object.keys(out).length ? out : null;
}

const field = (md: string, label: string) => md.match(new RegExp(`\\*\\*${label}:?\\*\\*:?\\s*(.*)`))?.[1];

/** "Nth, Mth and Kth Rounds:" headings of the Timed Events section. */
function timedEvents(section: { body: string } | undefined): { rounds: number[]; text: string }[] {
  if (!section) return [];
  const out: { rounds: number[]; text: string }[] = [];
  const blocks = section.body.split(/(?=^\*\*[^*\n]*\*\*\s*$)/m);
  for (const b of blocks) {
    const head = b.match(/^\*\*([^*\n]*)\*\*/);
    if (!head) continue;
    const rounds = [...head[1]!.matchAll(/\d+/g)].map((m) => Number(m[0]));
    if (rounds.length) out.push({ rounds, text: b.slice(head[0].length).trim() });
  }
  return out;
}

function importScenarios(maps: MapLayout[]): Scenario[] {
  const out: Scenario[] = [];
  for (const kind of ["clash", "coops", "campaigns"] as const) {
    for (const file of readdirSync(join(book, kind)).filter((f) => f.endsWith(".tex") && f !== "main.tex").sort()) {
      const tex = readFileSync(join(book, kind, file), "utf8");
      const head = tex.match(/\\addscenariosection(?:\[[^\]]*\])?\{\d+\}\{([^}]*)\}\{([^}]*)\}/);
      if (!head) continue;
      const poFile = join(book, "translations", file, "fr.po");
      const po = existsSync(poFile) ? parsePo(poFile) : [];
      const fr = translate(tex, po);
      const headFr = fr.text.match(/\\addscenariosection(?:\[[^\]]*\])?\{\d+\}\{([^}]*)\}\{([^}]*)\}/);
      const en = texToMarkdown(tex, "en");
      const enSections = sections(en);
      const frSections = sections(texToMarkdown(fr.text, "fr"));
      const id = basename(file, ".tex");
      const mapIds = [...new Set([...tex.matchAll(/maps\/([A-Za-z0-9_.-]+)\.png/g)].map((m) => MAP_ALIASES(mapKey(m[1]!))))].filter((m) =>
        maps.some((x) => x.id === m),
      );
      const rounds = en.match(/played over (\d+) Rounds/i)?.[1] ?? en.match(/(\d+) Rounds/)?.[1];
      const playerCounts = kind === "campaigns" ? [1] : parseCounts(field(en, "Player Count") ?? "");
      out.push(
        Scenario.parse({
          id,
          kind: kind === "coops" ? "cooperative" : kind === "campaigns" ? "campaign" : "clash",
          title: { en: clean(head[2]!), fr: clean(headFr?.[2] ?? head[2]!) },
          series: { en: clean(head[1]!), fr: clean(headFr?.[1] ?? head[1]!) },
          maxRounds: rounds ? Number(rounds) : null,
          playerCounts,
          resources: parseResources(field(en, "Starting Resources")),
          income: parseResources(field(en, "Starting Income")),
          maps: mapIds,
          timedEvents: {
            en: timedEvents(enSections.find((s) => /timed events/i.test(s.title))),
            fr: timedEvents(frSections.find((s) => /v[éè]nements/i.test(s.title))),
          },
          text: { en: enSections, fr: frSections },
          untranslated: fr.missed,
        }),
      );
    }
  }
  return out;
}

/** "2–6 Player FFA or 2vs2…" → 2…6; "2 or 4" → 2, 4. */
function parseCounts(text: string): number[] {
  const r = text.match(/^\s*(\d+)\s*[–-]\s*(\d+)/);
  if (r) return range(Number(r[1]), Number(r[2]));
  const list = text.match(/^\s*\d+(?:\s*(?:or|,)\s*\d+)*/);
  return list ? list[0].match(/\d+/g)!.map(Number) : [];
}

/** Map pictures whose editor file has another name. */
const MAP_ALIASES = (id: string) => id.replace(/^close_to_enemies_p(\d)$/, "close_to_enemies_$1");

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
const clean = (s: string) => texToMarkdown(s, "en").replace(/\*/g, "").trim();

const maps = importMaps();
const scenarios = importScenarios(maps);
writeFileSync(join(outDir, "maps.json"), JSON.stringify(maps, null, 1) + "\n");
writeFileSync(join(outDir, "scenarios.json"), JSON.stringify(scenarios, null, 1) + "\n");
console.log(
  `maps: ${maps.length} (${maps.filter((m) => m.supported).length} playable), scenarios: ${scenarios.length}`,
  scenarios.map((s) => `${s.id}: ${s.maxRounds ?? "?"} rounds, players ${s.playerCounts.join("/")}, maps ${s.maps.join(" ")}, untranslated ${s.untranslated}`),
);
