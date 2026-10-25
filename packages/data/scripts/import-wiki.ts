/**
 * Converts the community wiki pages (vendor/homm3bg-wiki) into validated JSON
 * under packages/data/src/generated. Run with `npm run import-wiki`.
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  AbilityCard,
  AbilityTrigger,
  ArtifactCard,
  AstrologersCard,
  BUILDINGS,
  HeroCard,
  SpellCard,
  StatisticCard,
  TownCard,
  type School,
  type Statistic,
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

// ---------------------------------------------------------------------------
// Might & Magic cards, Heroes and Town Boards

/** Card text: `<br>` become line breaks, links and bold are dropped, glyphs stay as `:name:`. */
export function cardText(cell: string): string {
  return cell
    .replace(/<br\s*\/?>/g, "\n")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]*)\*\*/g, "$1")
    .replace(/\\\*/g, "*")
    .replace(/&nbsp;| /g, " ")
    .replace(/️/g, "")
    .split("\n")
    .map((l) => l.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Splits `A — OR — B` card text into its alternative effects. */
export function splitOr(text: string): string[] {
  return text
    .split(/\n*— OR —\n*/)
    .map((t) => t.trim())
    .filter(Boolean);
}

/** Page slug of the first link in a cell (`anti-magic`). */
function linkSlug(cell: string, ctx: string): string {
  const slug = cell.match(/\((?:[a-z_./]*\/)?([a-z0-9_-]+)\.md(?:#[^)]*)?\)/)?.[1];
  if (!slug) throw new Error(`${ctx}: no page link in "${cell}"`);
  return slug;
}

/** Card id derived from the page slug (`anti-magic` → `anti_magic`). */
function linkId(cell: string, ctx: string): string {
  return linkSlug(cell, ctx).replace(/-/g, "_");
}

function contentCell(cell: string | undefined): string[] {
  return (cell ?? "")
    .split(/<br\s*\/?>/)
    .map(cleanText)
    .filter(Boolean);
}

function readWiki(path: string): string {
  return readFileSync(join(wiki, path), "utf8");
}

/** All rows of every table whose header starts with `| firstCell |`. */
function parseTables(md: string, firstCell: string): string[][] {
  const rows: string[][] = [];
  const lines = md.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]!.startsWith(`| ${firstCell} |`)) continue;
    for (i += 2; i < lines.length && lines[i]!.startsWith("|"); i++) {
      rows.push(lines[i]!.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()));
    }
  }
  return rows;
}

function importSpells(): SpellCard[] {
  const md = readWiki("spells/index.md");
  const spells = new Map<string, SpellCard>();
  for (const section of md.split(/^### School of /m).slice(1)) {
    const school = section.match(/^(Air|Earth|Fire|Water)/)?.[1]?.toLowerCase() as School | undefined;
    if (!school) continue;
    for (const [name, level, effect, content] of parseTables(section, "Name")) {
      const id = linkId(name!, "spell");
      if (spells.has(id)) {
        spells.get(id)!.school = null; // Magic Arrow is listed under every School (p. 26)
        continue;
      }
      const page = readWiki(`spells/${linkSlug(name!, "spell")}.md`);
      spells.set(id, {
        id,
        name: cleanText(name!),
        school,
        level: cleanText(level!).toLowerCase() as "basic" | "expert",
        text: cardText(effect!),
        image: singleImage(page),
        content: contentCell(content),
      });
    }
  }
  return [...spells.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function importAbilities(): AbilityCard[] {
  const md = readWiki("abilities/index.md");
  const [regular, empowered] = md.split(/^## Empowered Abilities/m);
  const emp = new Map(parseTables(empowered ?? "", "Name").map((r) => [linkId(r[0]!, "ability"), cardText(r[1]!)]));
  return parseTables(regular!, "Name").map(([name, basic, expert, content]) => {
    const id = linkId(name!, "ability");
    const images = parseTabImages(readWiki(`abilities/${linkSlug(name!, "ability")}.md`));
    return {
      id,
      name: cleanText(name!),
      basic: cardText(basic!),
      expert: cardText(expert!),
      empowered: emp.get(id) ?? null,
      necropolis: id === "necromancy",
      image: images.get("Regular") ?? null,
      empoweredImage: images.get("Empowered") ?? null,
      content: contentCell(content),
    };
  });
}

function importArtifacts(): ArtifactCard[] {
  const md = readWiki("artifacts/index.md");
  return parseTables(md.split(/^## List of Artifacts/m)[1]!, "Name").map(([name, level, effect, content]) => {
    const id = linkId(name!, "artifact");
    return {
      id,
      name: cleanText(name!),
      level: cleanText(level!).toLowerCase() as "minor" | "major" | "relic",
      effects: splitOr(cardText(effect!)),
      image: singleImage(readWiki(`artifacts/${linkSlug(name!, "artifact")}.md`)),
      content: contentCell(content),
    };
  });
}

function importStatistics(): StatisticCard[] {
  return (["attack", "defense", "power", "knowledge"] as Statistic[]).map((id) => {
    const md = readWiki(`statistics/${id}.md`);
    const table = parseTable(md, "Type");
    const regular = table?.get("Regular");
    const emp = table?.get("Empowered");
    if (!regular || !emp) throw new Error(`statistic ${id}: missing rows`);
    const images = parseTabImages(md);
    return {
      id,
      name: md.match(/^# (.+)$/m)![1]!.trim(),
      basic: cardText(regular[0]!),
      expert: cardText(regular[1]!),
      empowered: cardText(emp[0]!),
      image: images.get("Regular") ?? null,
      empoweredImage: images.get("Empowered") ?? null,
    };
  });
}

function importHeroes(): HeroCard[] {
  const index = readWiki("heroes/index.md");
  return parseTables(index, "Name").map(([name, town, heroClass, ability, specialty, content]) => {
    const id = linkId(name!, "hero");
    const md = readWiki(`heroes/${linkSlug(name!, "hero")}.md`);
    const stat = (s: string) => Number(md.match(new RegExp(`:${s}:\\]\\([^)]*\\)(?:&nbsp;|\\s)*(\\d+)`))?.[1]);
    const images = [...parseTabImages(md).values()];
    const rows = parseTables(md, "Level");
    if (rows.length !== 3) throw new Error(`hero ${id}: expected 3 Specialty rows, got ${rows.length}`);
    return {
      id,
      name: cleanText(name!),
      faction: cleanText(town!).toLowerCase() as HeroCard["faction"],
      heroClass: cleanText(heroClass!).replace(/^:(might|magic):\s*/, ""),
      type: heroClass!.includes(":magic:") ? ("magic" as const) : ("might" as const),
      stats: { attack: stat("attack"), defense: stat("defense"), power: stat("power"), knowledge: stat("knowledge") },
      ability: linkId(ability!, `hero ${id} ability`),
      specialtyName: cleanText(specialty!),
      specialties: rows.map(([lvl, text], i) => ({
        level: ROMAN[cleanText(lvl!)] ?? 0,
        text: cardText(text!),
        image: images[i] ?? null,
      })),
      image: singleImage(md),
      content: contentCell(content),
    };
  });
}

function importTowns(): TownCard[] {
  return FACTIONS.map((faction) => {
    const md = readWiki(`towns/${faction}.md`);
    const rows = parseTables(md, "Name").filter((r) => r.length === 3);
    if (rows.length !== 8) throw new Error(`town ${faction}: expected 8 buildings, got ${rows.length}`);
    const buildings = rows.map(([name, cost, effect], i) => ({
      slot: BUILDINGS[i]!,
      name: cleanText(name!),
      cost: parseCost(cost)!,
      effect: cardText(effect!),
    }));
    const guild = buildings[2]!.effect;
    const spellBookCost = Number(guild.match(/:pay: (\d+) :gold:/)?.[1]);
    if (!Number.isFinite(spellBookCost)) throw new Error(`town ${faction}: no Spell Book cost in "${guild}"`);
    const images = parseTabImages(md);
    return {
      faction,
      name: md.match(/^# (.+)$/m)![1]!.trim(),
      buildings,
      spellBookCost,
      images: { empty: images.get("Empty") ?? null, full: images.get("Fully Built") ?? null },
    };
  });
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
  const write = (file: string, data: unknown[]) => {
    writeFileSync(join(outDir, file), JSON.stringify(data, null, 2) + "\n");
    console.log(`${file}: ${data.length}`);
  };
  write("spells.json", z.array(SpellCard).parse(importSpells()));
  write("abilities.json", z.array(AbilityCard).parse(importAbilities()));
  write("artifacts.json", z.array(ArtifactCard).parse(importArtifacts()));
  write("statistics.json", z.array(StatisticCard).parse(importStatistics()));
  write("heroes.json", z.array(HeroCard).parse(importHeroes()));
  write("towns.json", z.array(TownCard).parse(importTowns()));
  console.log(`units: ${units.length} cards, ${units.reduce((n, u) => n + u.variants.length, 0)} variants`);
}
