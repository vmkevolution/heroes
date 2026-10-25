/**
 * Converts the community wiki pages (vendor/homm3bg-wiki) into validated JSON
 * under packages/data/src/generated. Run with `npm run import-wiki`.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AbilityTrigger,
  AstrologersCard,
  type AbilityText,
  type Cost,
  type Faction,
  FACTIONS,
  MapTile,
  type Origin,
  type Resource,
  type TileField,
  type TileGroup,
  type Tier,
  UnitCard,
  type UnitType,
  type UnitVariant,
} from "../src/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const wiki = join(root, "vendor/homm3bg-wiki");
const outDir = join(root, "packages/data/src/generated");

const TRIGGER_GLYPHS: Record<string, AbilityTrigger> = {
  unit_passive: "passive",
  activation: "activation",
  unit_other: "other",
  unit_attack: "attack",
  unit_retaliation: "retaliation",
  map_effect: "map",
};

/** `[label](url)` → `label`, `**x**` → `x`, collapse whitespace. */
export function cleanText(s: string): string {
  return s
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseTable(md: string, firstCell: string): Map<string, string[]> | null {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`| ${firstCell} |`));
  if (start < 0) return null;
  const rows = new Map<string, string[]>();
  const split = (l: string) =>
    l
      .trim()
      .replace(/^\|/, "")
      .replace(/\|$/, "")
      .split("|")
      .map((c) => c.trim());
  for (let i = start; i < lines.length && lines[i]!.startsWith("|"); i++) {
    const cells = split(lines[i]!);
    if (i === start + 1) continue; // alignment row
    rows.set(cells[0]!, cells.slice(1));
  }
  return rows;
}

function int(cell: string, ctx: string): number {
  const n = Number.parseInt(cleanText(cell), 10);
  if (Number.isNaN(n)) throw new Error(`${ctx}: expected a number, got "${cell}"`);
  return n;
}

function parseTier(cell: string): Tier | null {
  const m = cell.match(/:(bronze|silver|gold|azure)_tier:/);
  return m ? (m[1] as Tier) : null;
}

function parseType(cell: string, ctx: string): UnitType {
  const m = cell.match(/:(ground|flying|ranged)_unit:/);
  if (!m) throw new Error(`${ctx}: unknown unit type "${cell}"`);
  return m[1] as UnitType;
}

function parseCost(cell: string | undefined): Cost | null {
  if (!cell || cleanText(cell) === "-") return null;
  const cost: Cost = { gold: 0, valuables: 0, buildingMaterials: 0 };
  for (const m of cell.matchAll(/(\d+)\s*:(gold|valuables|building_materials):/g)) {
    const n = Number(m[1]);
    if (m[2] === "gold") cost.gold += n;
    else if (m[2] === "valuables") cost.valuables += n;
    else cost.buildingMaterials += n;
  }
  return cost;
}

function parseAbilities(cell: string | undefined): AbilityText[] {
  if (!cell) return [];
  return cell
    .split(/<br\s*\/?>/)
    .map((part) => {
      const triggers: AbilityTrigger[] = [];
      for (const m of part.matchAll(/:([a-z_]+):/g)) {
        const t = TRIGGER_GLYPHS[m[1]!];
        if (t && !triggers.includes(t)) triggers.push(t);
      }
      return { triggers, text: cleanText(part) };
    })
    .filter((a) => a.text !== "-" && a.text !== "");
}

function slug(label: string): string {
  return label
    .toLowerCase()
    .replace(/[()]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}

function originOf(town: string): { origin: Origin; faction: Faction | null } {
  const t = cleanText(town).toLowerCase();
  if ((FACTIONS as readonly string[]).includes(t)) return { origin: "faction", faction: t as Faction };
  if (t === "neutral") return { origin: "neutral", faction: null };
  if (t === "creature bank") return { origin: "creature-bank", faction: null };
  if (t === "summoned") return { origin: "summoned", faction: null };
  throw new Error(`unknown town "${town}"`);
}

function parseContent(md: string): string[] {
  const section = md.split(/^## Comes With\s*$/m)[1];
  if (!section) return [];
  const body = section.split(/^## /m)[0] ?? "";
  return body
    .split("\n")
    .filter((l) => l.startsWith("- "))
    .map((l) => cleanText(l.slice(2)));
}

/**
 * Known mistakes in the wiki tables, fixed here rather than in the vendored copy.
 * Each entry overrides one cell: [unit id, row name, column index, replacement].
 */
const UNIT_CORRECTIONS: [string, string, number, string][] = [
  // Neutral Gold Dragons: the tier glyph was typed in the Type row (they are Azure flyers).
  ["gold_dragons", "Tier", 2, ":azure_tier:"],
  ["gold_dragons", "Type", 2, ":flying_unit:"],
];

/** Maps each `=== "Tab"` label to the picture shown in that tab. */
function parseTabImages(md: string): Map<string, string> {
  const images = new Map<string, string>();
  for (const m of md.matchAll(/^=== "([^"]+)"\s*\n[\s\S]*?!\[[^\]]*\]\(\.\.\/assets\/([^)]+)\)/gm)) {
    images.set(m[1]!, m[2]!);
  }
  return images;
}

function singleImage(md: string): string | null {
  return md.match(/!\[[^\]]*\]\(\.\.\/assets\/([^)]+)\)/)?.[1] ?? null;
}

export function parseUnitPage(id: string, md: string): UnitCard {
  const name = md.match(/^# (.+)$/m)?.[1]?.trim() ?? id;
  const images = parseTabImages(md);
  const table = parseTable(md, "Statistics");
  if (!table) throw new Error(`${id}: no statistics table`);
  for (const [unit, rowName, col, value] of UNIT_CORRECTIONS) {
    if (unit !== id) continue;
    const cells = table.get(rowName);
    if (!cells || col >= cells.length) throw new Error(`${id}: correction targets missing cell ${rowName}[${col}]`);
    cells[col] = value;
  }
  const labels = table.get("Statistics")!;
  const row = (key: string) => table.get(key) ?? [];
  const variants: UnitVariant[] = labels.map((label, i) => {
    const ctx = `${id}/${label}`;
    const isSiege = label === "Siege";
    const { origin, faction } = isSiege
      ? { origin: "siege" as const, faction: null }
      : originOf(row("Town")[i] ?? "");
    return {
      key: slug(label),
      label,
      origin,
      faction,
      tier: parseTier(row("Tier")[i] ?? ""),
      type: parseType(row("Type")[i] ?? "", ctx),
      attack: int(row(":attack:")[i] ?? "", `${ctx} attack`),
      defense: int(row(":defense:")[i] ?? "", `${ctx} defense`),
      hp: int(row(":health_points:")[i] ?? "", `${ctx} hp`),
      initiative: int(row(":initiative:")[i] ?? "", `${ctx} initiative`),
      cost: parseCost(row("Cost")[i]),
      abilities: parseAbilities(row("Abilities")[i]),
      // Single-card pages have no tabs: their only picture belongs to their only column.
      image: images.get(label) ?? (labels.length === 1 ? singleImage(md) : null),
    };
  });
  return UnitCard.parse({ id, name, variants, content: parseContent(md) });
}

function importUnits(): UnitCard[] {
  const dir = join(wiki, "units");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .sort()
    .map((f) => parseUnitPage(f.replace(/\.md$/, ""), readFileSync(join(dir, f), "utf8")));
}

const ROMAN: Record<string, number> = { "Ⅰ": 1, "Ⅱ": 2, "Ⅲ": 3, "Ⅳ": 4, "Ⅴ": 5, "Ⅵ": 6, "Ⅶ": 7 };
const RESOURCE_GLYPHS: Record<string, Resource> = {
  gold: "gold",
  building_materials: "buildingMaterials",
  valuables: "valuables",
};
const TILE_GROUPS: Record<string, TileGroup> = {
  "Starting Tile": "starting",
  "Far Tile": "far",
  "Near Tile": "near",
  "Center Tile": "center",
  "Subterranean Tile": "subterranean",
  "Sea Tile": "sea",
};

/** `- [Ⅴ](../difficulties.md) [:gold: Mine](../fields/mine.md)` → a TileField. */
export function parseTileField(line: string, ctx: string): TileField {
  const links = [...line.matchAll(/\[([^\]]*)\]\(([^)]*)\)/g)].map((m) => ({ text: m[1]!, href: m[2]! }));
  const diffLink = links.find((l) => l.href.includes("difficulties"));
  const main = links.filter((l) => l !== diffLink).at(-1);
  if (!main) throw new Error(`${ctx}: no location link in "${line}"`);
  const difficulty = diffLink ? (ROMAN[diffLink.text.trim()] ?? null) : null;
  if (diffLink && difficulty === null) throw new Error(`${ctx}: unknown difficulty "${diffLink.text}"`);

  const file = main.href.split("/").at(-1)!.replace(/\.md$/, "").replace(/#.*$/, "");
  let location = file;
  let faction: TileField["faction"] = null;
  if (main.href.includes("towns/")) {
    if (/Random Town/.test(main.text)) location = "random_town";
    else {
      location = /Settlement/.test(main.text) ? "settlement" : "town";
      faction = (FACTIONS as readonly string[]).includes(file) ? (file as TileField["faction"]) : null;
      if (!faction) throw new Error(`${ctx}: unknown town style "${main.text}"`);
    }
  }
  const text = main.text;
  const glyph = [...text.matchAll(/:([a-z_]+):/g)].map((m) => m[1]!).find((g) => g in RESOURCE_GLYPHS);
  const amount = text.match(/\+(\d+)/)?.[1];
  const dice = text.match(/(\d+)\s*:(?:treasure|resource)_die:/)?.[1];
  const dieGlyph = /:(treasure|resource)_die:/.test(text);
  return {
    location,
    difficulty,
    faction,
    resource: glyph ? RESOURCE_GLYPHS[glyph]! : null,
    amount: amount ? Number(amount) : null,
    dice: dice ? Number(dice) : dieGlyph ? 1 : null,
    label: text,
  };
}

/** Field lines missing from wiki tile pages, checked against the tile pictures: [tile, index, line]. */
const TILE_CORRECTIONS: [string, number, string][] = [
  // U7: the bottom-left Temple is not listed.
  ["U7", 5, "- [:positive_morale: Temple](../fields/temple.md)"],
];

export function parseTilePage(md: string): MapTile {
  const id = md.match(/^# (.+)$/m)?.[1]?.trim();
  if (!id) throw new Error("tile page without a title");
  const groupLabel = md.match(/^\[([^\]]+ Tile)\]/m)?.[1] ?? "";
  const group = TILE_GROUPS[groupLabel];
  if (!group) throw new Error(`${id}: unknown tile group "${groupLabel}"`);
  const terrain = md.split(/^___\s*$/m)[2]?.trim() ?? "";
  const section = md.split(/^## Fields\s*$/m)[1]?.split(/^## /m)[0] ?? "";
  const lines = section.split("\n").filter((l) => l.startsWith("- "));
  for (const [tile, index, line] of TILE_CORRECTIONS) if (tile === id) lines.splice(index, 0, line);
  const fields = lines.map((l, i) => parseTileField(l, `${id} field ${i}`));
  return MapTile.parse({ id, group, terrain, fields, content: parseContent(md) });
}

function importTiles(): MapTile[] {
  const dir = join(wiki, "tiles");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .sort()
    .map((f) => parseTilePage(readFileSync(join(dir, f), "utf8")));
}

function importAstrologers(): AstrologersCard[] {
  const md = readFileSync(join(wiki, "astrologers_proclaim/index.md"), "utf8");
  const table = parseTable(md, "Name");
  if (!table) throw new Error("astrologers: no table");
  const cards: AstrologersCard[] = [];
  for (const [nameCell, cells] of table) {
    if (nameCell === "Name") continue;
    const id = nameCell.match(/\(([a-z0-9_]+)\.md\)/)?.[1];
    if (!id) throw new Error(`astrologers: no page link in "${nameCell}"`);
    cards.push({
      id,
      name: cleanText(nameCell).replace(/\u00a0|&nbsp;/g, " "),
      effect: cleanText((cells[0] ?? "").replace(/<br>/g, "\n")),
      content: [cleanText(cells[1] ?? "")],
    });
  }
  return cards;
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  mkdirSync(outDir, { recursive: true });
  const units = z.array(UnitCard).parse(importUnits());
  writeFileSync(join(outDir, "units.json"), JSON.stringify(units, null, 2) + "\n");
  const tiles = z.array(MapTile).parse(importTiles());
  writeFileSync(join(outDir, "tiles.json"), JSON.stringify(tiles, null, 2) + "\n");
  console.log(`tiles: ${tiles.length}`);
  const astrologers = z.array(AstrologersCard).parse(importAstrologers());
  writeFileSync(join(outDir, "astrologers.json"), JSON.stringify(astrologers, null, 2) + "\n");
  console.log(`astrologers: ${astrologers.length}`);
  console.log(`units: ${units.length} cards, ${units.reduce((n, u) => n + u.variants.length, 0)} variants`);
}
