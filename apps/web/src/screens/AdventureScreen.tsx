import { useMemo, useState } from "react";
import { astrologers, getVariant, type Resource } from "@heroes/data";
import {
  actingPlayer,
  applyAdventureAction,
  AUTOMATED_ASTROLOGERS,
  canReinforceAtSettlement,
  canRevisit,
  categoryOf,
  currentPlayer,
  discoverableTiles,
  fieldAt,
  getHero,
  getPlayer,
  heroLevel,
  hexKey,
  legalHeroMoves,
  marksAt,
  placementSlots,
  sameHex,
  sidePlayer,
  tileHexes,
  totalMp,
  type AdventureAction,
  type AdventureEvent,
  type AdventureState,
  type Hex,
  type PlacedTile,
  type Player,
  type Side,
} from "@heroes/engine";
import { useI18n, type Messages } from "../i18n.tsx";
import { cardImage, unitName } from "../cards.ts";
import { CombatView } from "./CombatScreen.tsx";
import { CardText, describeOp, HandPanel, ManualPanel, RefreshBox, SearchBox, TownPanel, TradePanel } from "./CardsPanels.tsx";
import { cardInfo, cardSide } from "@heroes/engine";
import { getHero as heroCard, getTown } from "@heroes/data";

/** Hex geometry in screen pixels: tile pictures are 420 px wide, i.e. 3 Fields across. */
const HEX_W = 140;
const HEX_R = HEX_W / Math.sqrt(3);
const TILE_W = 420;
const TILE_H = 5 * HEX_R;
const PLAYER_COLORS = ["#d64541", "#3b82d6", "#2fa36b", "#c7a12a"];
const RESOURCES: Resource[] = ["gold", "buildingMaterials", "valuables"];
const RES_ICON: Record<Resource, string> = { gold: "🪙", buildingMaterials: "🪨", valuables: "💎" };

const toPixel = (h: Hex) => ({ x: HEX_W * (h.q + h.r / 2), y: 1.5 * HEX_R * h.r });
const hexPoints = (cx: number, cy: number, r = HEX_R) =>
  Array.from({ length: 6 }, (_, i) => {
    const a = (Math.PI / 180) * (60 * i - 90);
    return `${(cx + r * Math.cos(a)).toFixed(1)},${(cy + r * Math.sin(a)).toFixed(1)}`;
  }).join(" ");
const tileImage = (tileId: string) => `${import.meta.env.BASE_URL}tiles/${tileId.replace("#", "x")}.webp`;
const BACKS: Record<string, string> = { starting: "1", far: "2-3", near: "4-5", center: "6-7" };
const backImage = (group: string) => `${import.meta.env.BASE_URL}tiles/back-${BACKS[group] ?? "2-3"}.webp`;

type Pending = { kind: "discover" | "place"; center: Hex; tileId: string; rotation: number; tileIndex?: number };

export function AdventureScreen({ initial }: { initial: AdventureState }) {
  const { t } = useI18n();
  const a = t.adv;
  const [state, setState] = useState(initial);
  const [selected, setSelected] = useState<string | null>(null);
  const [hover, setHover] = useState<Hex | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [placing, setPlacing] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const playerColor = (id: string | null) => PLAYER_COLORS[state.players.findIndex((p) => p.id === id)] ?? "#888";
  const playerName = (id: string | null) => (id ? (state.players.find((p) => p.id === id)?.name ?? id) : a.neutrals);
  const heroName = (id: string) => {
    const h = state.heroes.find((x) => x.id === id);
    if (!h) return id;
    return `${playerName(h.owner)}${h.kind === "secondary" ? ` (${a.secondary})` : ""}`;
  };

  const act = (action: AdventureAction) => {
    try {
      setState(applyAdventureAction(state, action));
      setError(null);
      setPending(null);
      setPlacing(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const me = currentPlayer(state);
  const myHeroes = state.heroes.filter((h) => h.owner === me.id);
  const hero = myHeroes.find((h) => h.id === selected) ?? myHeroes[0] ?? null;
  const ph = state.phase;
  const inTurn = ph.type === "turn";
  const freeDiscover = ph.type === "choice" && ph.choice.kind === "discover" ? ph.choice : null;
  const moves = hero && inTurn ? legalHeroMoves(state, hero.id) : [];
  const discoverable =
    hero && ((inTurn && totalMp(hero) >= 1) || freeDiscover?.heroId === hero.id) ? discoverableTiles(state, hero.id) : [];
  const slots = hero && placing !== null && inTurn && totalMp(hero) >= 1 ? placementSlots(state, hero.id) : [];

  const startDiscover = (tile: PlacedTile) => {
    if (!hero) return;
    setPending({ kind: "discover", center: tile.center, tileId: tile.tileId, rotation: 0 });
  };

  const onField = (hex: Hex) => {
    if (!hero || pending) return;
    if (slots.length && placing !== null) {
      const slot = slots.find((s) => sameHex(s, hex) || tileHexes({ tileId: "", group: "far", center: s, rotation: 0, faceUp: true }).some((h) => sameHex(h, hex)));
      if (slot) {
        setPending({ kind: "place", center: slot, tileId: me.tileSupply[placing]!, rotation: 0, tileIndex: placing });
        return;
      }
    }
    if (moves.some((m) => sameHex(m, hex))) {
      act({ type: "move", heroId: hero.id, to: hex });
      return;
    }
    const tile = discoverable.find((t) => tileHexes(t).some((h) => sameHex(h, hex)));
    if (tile) startDiscover(tile);
    const clickedHero = state.heroes.find((h) => sameHex(h.pos, hex) && h.owner === me.id);
    if (clickedHero) setSelected(clickedHero.id);
  };

  // Map bounds.
  const bounds = useMemo(() => {
    const xs: number[] = [];
    const ys: number[] = [];
    for (const tile of state.tiles) {
      const p = toPixel(tile.center);
      xs.push(p.x - TILE_W / 2, p.x + TILE_W / 2);
      ys.push(p.y - TILE_H / 2, p.y + TILE_H / 2);
    }
    for (const s of slots) {
      const p = toPixel(s);
      xs.push(p.x - TILE_W / 2, p.x + TILE_W / 2);
      ys.push(p.y - TILE_H / 2, p.y + TILE_H / 2);
    }
    const pad = 30;
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    return { minX, minY, w: Math.max(...xs) + pad - minX, h: Math.max(...ys) + pad - minY };
  }, [state.tiles, slots]);

  if (ph.type === "combat") {
    return <CombatPanel state={state} act={act} error={error} playerName={playerName} />;
  }

  const acting = actingPlayer(state);
  const hoverInfo = hover ? fieldAt(state, hover) : null;

  return (
    <div className="adventure">
      <div className="map-wrap">
        <div className="acting-banner" style={{ borderColor: playerColor(acting) }}>
          {ph.type === "over" ? a.gameOver : a.actingNow(playerName(acting))}
          <span className="muted">
            {" "}
            · {a.round} {state.round} {a.of} {state.maxRounds}
          </span>
        </div>
        <svg
          className="map"
          viewBox={`${bounds.minX} ${bounds.minY} ${bounds.w} ${bounds.h}`}
          onMouseLeave={() => setHover(null)}
        >
          {state.tiles.map((tile) => {
            const p = toPixel(tile.center);
            const preview = pending && sameHex(pending.center, tile.center) ? pending : null;
            const faceUp = tile.faceUp || preview;
            return (
              <g key={hexKey(tile.center)} transform={`translate(${p.x} ${p.y}) rotate(${(preview?.rotation ?? tile.rotation) * 60})`}>
                <image
                  href={faceUp ? tileImage(tile.tileId) : backImage(tile.group)}
                  x={-TILE_W / 2}
                  y={-TILE_H / 2}
                  width={TILE_W}
                  height={TILE_H}
                  opacity={faceUp ? 1 : 0.85}
                />
              </g>
            );
          })}
          {pending?.kind === "place" && (
            <g transform={`translate(${toPixel(pending.center).x} ${toPixel(pending.center).y}) rotate(${pending.rotation * 60})`}>
              <image href={tileImage(pending.tileId)} x={-TILE_W / 2} y={-TILE_H / 2} width={TILE_W} height={TILE_H} opacity={0.9} />
            </g>
          )}
          {slots.map((s) => {
            const p = toPixel(s);
            return (
              <g key={`slot-${hexKey(s)}`} className="slot" onClick={() => onField(s)}>
                {tileHexes({ tileId: "", group: "far", center: s, rotation: 0, faceUp: true }).map((h) => {
                  const q = toPixel(h);
                  return <polygon key={hexKey(h)} points={hexPoints(q.x, q.y, HEX_R - 3)} />;
                })}
                <text x={p.x} y={p.y} className="slot-label">
                  +
                </text>
              </g>
            );
          })}
          {state.tiles.flatMap((tile) =>
            tileHexes(tile).map((h) => {
              const p = toPixel(h);
              const isMove = moves.some((m) => sameHex(m, h));
              const isDiscover = !tile.faceUp && discoverable.includes(tile);
              const m = marksAt(state, h);
              return (
                <g key={hexKey(h)} onMouseEnter={() => setHover(h)} onClick={() => onField(h)}>
                  <polygon
                    points={hexPoints(p.x, p.y, HEX_R - 2)}
                    className={`field ${isMove ? "can-move" : ""} ${isDiscover ? "can-discover" : ""} ${hover && sameHex(hover, h) ? "hover" : ""}`}
                  />
                  {m.flag && (
                    <rect x={p.x + 22} y={p.y - 46} width={22} height={22} rx={4} fill={playerColor(m.flag)} stroke="#111" strokeWidth={2} />
                  )}
                  {m.blackCube && <rect x={p.x - 44} y={p.y - 46} width={20} height={20} rx={3} fill="#111" stroke="#ddd" strokeWidth={2} />}
                </g>
              );
            }),
          )}
          {state.heroes.map((h) => {
            const p = toPixel(h.pos);
            const sameField = state.heroes.filter((o) => sameHex(o.pos, h.pos));
            const dx = sameField.length > 1 ? (sameField.indexOf(h) - 0.5) * 34 : 0;
            const isSel = hero?.id === h.id;
            return (
              <g key={h.id} transform={`translate(${p.x + dx} ${p.y + 18})`} className="hero-token">
                <circle r={h.kind === "main" ? 24 : 18} fill={playerColor(h.owner)} stroke={isSel ? "#ffd75e" : "#111"} strokeWidth={isSel ? 6 : 3} />
                <text y={8} textAnchor="middle" className="hero-letter">
                  {playerName(h.owner).charAt(0).toUpperCase()}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <aside className="side adventure-side">
        {error && <p className="error">{error}</p>}
        <PhaseBox state={state} act={act} heroName={heroName} playerName={playerName} />

        {pending && (
          <div className="panel">
            <h3>{pending.kind === "discover" ? a.discoverTitle : a.placeTitle}</h3>
            <div className="buttons">
              <button className="btn" onClick={() => setPending({ ...pending, rotation: (pending.rotation + 5) % 6 })}>
                ⟲ {a.rotate}
              </button>
              <button className="btn" onClick={() => setPending({ ...pending, rotation: (pending.rotation + 1) % 6 })}>
                ⟳ {a.rotate}
              </button>
              <button
                className="btn primary"
                onClick={() =>
                  hero &&
                  act(
                    pending.kind === "discover"
                      ? { type: "discover", heroId: hero.id, center: pending.center, rotation: pending.rotation }
                      : { type: "place-tile", heroId: hero.id, tileIndex: pending.tileIndex!, center: pending.center, rotation: pending.rotation },
                  )
                }
              >
                {a.confirm}
              </button>
              <button className="btn ghost" onClick={() => setPending(null)}>
                {a.cancel}
              </button>
            </div>
          </div>
        )}

        {inTurn && hero && (
          <div className="panel" style={{ borderLeft: `4px solid ${playerColor(me.id)}` }}>
            <h3>{a.turnOf(me.name)}</h3>
            {myHeroes.length > 1 && (
              <div className="segmented small">
                {myHeroes.map((h) => (
                  <button key={h.id} className={h.id === hero.id ? "on" : ""} onClick={() => setSelected(h.id)}>
                    {h.kind === "main" ? a.main : a.secondary}
                  </button>
                ))}
              </div>
            )}
            <p>
              {a.mp} : <strong>{totalMp(hero)}</strong>
              {hero.bonusMp > 0 && <span className="muted"> (+{hero.bonusMp})</span>} · {a.level} {heroLevel(state, hero)}
              {hero.kind === "main" && <span className="muted"> ({hero.experience} {a.xp.toLowerCase()})</span>}
            </p>
            <p className="muted">{moves.length || discoverable.length ? a.hintMap : a.noMoves}</p>
            <div className="buttons">
              {canRevisit(state, hero.id) && (
                <button className="btn" onClick={() => act({ type: "revisit", heroId: hero.id })}>
                  {a.revisit}
                </button>
              )}
              {me.tileSupply.map((id, i) => (
                <button key={id} className={`btn ${placing === i ? "primary" : ""}`} disabled={totalMp(hero) < 1} onClick={() => setPlacing(placing === i ? null : i)}>
                  {a.placeTile} ({id})
                </button>
              ))}
              <button className="btn primary" onClick={() => act({ type: "end-turn" })}>
                {a.endTurn}
              </button>
            </div>
          </div>
        )}

        {inTurn && (
          <>
            <TradePanel player={me} act={act} />
            <HandPanel state={state} player={me} act={act} context={{ combat: null, side: null, unitNames: new Map() }} />
            <TownPanel key={me.id} state={state} player={me} act={act} />
            <ManualPanel player={me} act={act} />
          </>
        )}

        <AstrologersBox state={state} t={t} />

        <div className="panel field-info">
          <h3>{a.field}</h3>
          {hoverInfo ? (
            <FieldDetails state={state} hex={hover!} t={t} playerName={playerName} />
          ) : (
            <p className="muted">{a.fieldHint}</p>
          )}
        </div>

        {state.players.map((p, i) => (
          <PlayerBox key={p.id} state={state} player={p} color={PLAYER_COLORS[i]!} t={t} />
        ))}

        <AdventureLog state={state} t={t} heroName={heroName} playerName={playerName} />
      </aside>
    </div>
  );
}

function FieldDetails({ state, hex, t, playerName }: { state: AdventureState; hex: Hex; t: Messages; playerName: (id: string | null) => string }) {
  const a = t.adv;
  const info = fieldAt(state, hex)!;
  if (!info.tile.faceUp) return <p className="muted">?</p>;
  const m = marksAt(state, hex);
  const f = info.field;
  const roman = ["", "I", "II", "III", "IV", "V", "VI", "VII"];
  return (
    <div>
      <strong>
        {a.loc(f.location)}
        {f.faction && ` (${a.faction(f.faction)})`}
      </strong>{" "}
      <span className="muted">· {info.tile.tileId}</span>
      {f.difficulty && !m.cleared && !m.everFlagged && !m.blackCube && <div className="warn">{a.guarded(roman[f.difficulty]!)}</div>}
      {m.flag && <div>{a.flaggedBy(playerName(m.flag))}</div>}
      {m.blackCube && <div className="muted">{a.visited}</div>}
      {categoryOf(f.location) === "revisitable" && <div className="muted">↻</div>}
    </div>
  );
}

function AstrologersBox({ state, t }: { state: AdventureState; t: Messages }) {
  const id = state.astrologers.current;
  if (!id) return null;
  const card = astrologers.find((c) => c.id === id);
  if (!card) return null;
  return (
    <div className="panel astro">
      <h3>
        {t.adv.astrologers} : {card.name}
      </h3>
      <p lang="en">{card.effect}</p>
      <p className="muted">{AUTOMATED_ASTROLOGERS.has(id) ? t.adv.automated : t.adv.manual}</p>
    </div>
  );
}

function PlayerBox({ state, player, color, t }: { state: AdventureState; player: Player; color: string; t: Messages }) {
  const a = t.adv;
  const heroes = state.heroes.filter((h) => h.owner === player.id);
  return (
    <div className={`panel player-box ${player.eliminated ? "out" : ""}`} style={{ borderLeft: `4px solid ${color}` }}>
      <h3>
        {player.name} <span className="muted">· {a.faction(player.faction)} · {heroCard(player.hero).name}</span>
        {player.eliminated && <span className="error"> · {a.eliminated}</span>}
      </h3>
      <div className="res-row">
        {RESOURCES.map((r) => (
          <span key={r} title={a[r]}>
            {RES_ICON[r]} {player.resources[r]} <span className="muted">(+{player.production[r]})</span>
          </span>
        ))}
      </div>
      <div className="muted small">
        {a.morale} : {a.moraleValue(player.morale)}
        {heroes.map((h) => (
          <span key={h.id}>
            {" "}
            · {h.kind === "main" ? a.main : a.secondary} {a.level} {heroLevel(state, h)}, {totalMp(h)} {a.mp}
          </span>
        ))}
      </div>
      <div className="army-row">
        {player.army.map((u, i) => (
          <span key={i} className="army-chip" title={`${unitName(u.unitId)} (${getVariant(u.unitId, u.variant).label})`}>
            {cardImage(u.unitId, u.variant) && <img src={cardImage(u.unitId, u.variant)!} alt="" />}
            <span>
              {unitName(u.unitId)} <em>{getVariant(u.unitId, u.variant).label}</em>
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function PhaseBox({
  state,
  act,
  heroName,
  playerName,
}: {
  state: AdventureState;
  act: (a: AdventureAction) => void;
  heroName: (id: string) => string;
  playerName: (id: string | null) => string;
}) {
  const { t } = useI18n();
  const a = t.adv;
  const ph = state.phase;
  if (ph.type === "over") {
    return (
      <div className="panel phase over">
        <h3>{a.gameOver}</h3>
        <p>{ph.winners.length ? a.winners(ph.winners.map(playerName).join(", ")) : a.noWinner}</p>
      </div>
    );
  }
  if (ph.type === "siege-decision") {
    return (
      <div className="panel phase">
        <h3>{a.siegeTitle(heroName(ph.heroId), playerName(ph.defender))}</h3>
        <p className="muted">{a.siegeHint}</p>
        <div className="buttons">
          <button className="btn primary" onClick={() => act({ type: "siege", defend: true })}>
            {a.defend}
          </button>
          <button className="btn" onClick={() => act({ type: "siege", defend: false })}>
            {a.letFall}
          </button>
        </div>
      </div>
    );
  }
  if (ph.type === "combat-setup") return <CombatSetupBox key={ph.side} state={state} act={act} playerName={playerName} />;
  if (ph.type === "refresh") return <RefreshBox key={ph.player} state={state} act={act} />;
  if (ph.type === "search") return <SearchBox state={state} act={act} />;
  if (ph.type !== "choice") return null;
  const c = ph.choice;
  const player = getPlayer(state, getHero(state, c.heroId).owner);
  if (c.kind === "options") {
    return (
      <div className="panel phase choice">
        <h3>
          {player.name} · {t.cards.sources[c.source] ?? a.loc(c.source)}
        </h3>
        <div className="op-list">
          {c.options.map((op, i) => (
            <button key={i} className="btn op" onClick={() => act({ type: "choose", option: i })}>
              {describeOp(op, player, t)}
            </button>
          ))}
        </div>
      </div>
    );
  }
  const dieLabel = (f: string) =>
    ({ experience: a.dieExperience, artifact: a.dieArtifact, resource: a.dieResource, resource2: a.dieResource2 })[f] ?? f;
  return (
    <div className="panel phase choice">
      <h3>{a.choice}</h3>
      {c.kind === "resource-die" && (
        <>
          <p>{a.pickDie}</p>
          <div className="buttons">
            {c.faces.map((f, i) => (
              <button key={i} className="btn" onClick={() => act({ type: "choose", option: i })}>
                {f.amount} {RES_ICON[f.resource]}
              </button>
            ))}
          </div>
        </>
      )}
      {c.kind === "treasure-die" && (
        <>
          <p>{a.pickDie}</p>
          <div className="buttons">
            {c.faces.map((f, i) => (
              <button key={i} className="btn" onClick={() => act({ type: "choose", option: i })}>
                {dieLabel(f)}
              </button>
            ))}
          </div>
        </>
      )}
      {c.kind === "pandora" && (
        <>
          <p>{a.pandora}</p>
          <div className="buttons">
            <button className="btn" onClick={() => act({ type: "choose", option: 0 })}>
              {a.pandoraTreasure}
            </button>
            <button className="btn" onClick={() => act({ type: "choose", option: 1 })}>
              {a.pandoraResource}
            </button>
          </div>
        </>
      )}
      {c.kind === "mystical-garden" && (
        <>
          <p>{a.garden}</p>
          <div className="buttons">
            <button className="btn" onClick={() => act({ type: "choose", option: 0 })}>
              {a.gardenGold}
            </button>
            <button className="btn" onClick={() => act({ type: "choose", option: 1 })}>
              {a.gardenValuables}
            </button>
          </div>
        </>
      )}
      {c.kind === "tree-of-knowledge" && (
        <>
          <p>{a.tree}</p>
          <div className="buttons">
            <button className="btn" disabled={player.resources.valuables < 3} onClick={() => act({ type: "choose", option: 0 })}>
              {a.treeValuables}
            </button>
            <button className="btn" disabled={player.resources.gold < 10} onClick={() => act({ type: "choose", option: 1 })}>
              {a.treeGold}
            </button>
            <button className="btn ghost" onClick={() => act({ type: "choose", option: 2 })}>
              {a.decline}
            </button>
          </div>
        </>
      )}
      {c.kind === "settlement" && (
        <>
          <p>{a.settlementTitle}</p>
          {c.free && <p className="muted">{a.settlementFree}</p>}
          <div className="buttons">
            {RESOURCES.map((r) => (
              <button key={r} className="btn" onClick={() => act({ type: "settlement", resource: r })}>
                {RES_ICON[r]} {a[r]}
              </button>
            ))}
            {player.army.map((u, i) =>
              canReinforceAtSettlement(u) ? (
                <button key={i} className="btn" onClick={() => act({ type: "settlement-reinforce", armyIndex: i })}>
                  {a.reinforce(unitName(u.unitId))}
                  {!c.free && ` (${Math.ceil((getVariant(u.unitId, "pack").cost?.gold ?? 0) / 2)} ${RES_ICON.gold})`}
                </button>
              ) : null,
            )}
          </div>
        </>
      )}
      {c.kind === "discover" && <p>{a.discoverChoice}</p>}
    </div>
  );
}

function CombatSetupBox({
  state,
  act,
  playerName,
}: {
  state: AdventureState;
  act: (a: AdventureAction) => void;
  playerName: (id: string | null) => string;
}) {
  const { t } = useI18n();
  const a = t.adv;
  const ph = state.phase;
  if (ph.type !== "combat-setup") throw new Error("not in combat setup");
  const owner = sidePlayer(state, ph.context, ph.side)!;
  const army = getPlayer(state, owner).army;
  const [picks, setPicks] = useState<{ armyIndex: number; line: "back" | "front" }[]>(() =>
    army.slice(0, 5).map((u, i) => ({ armyIndex: i, line: getVariant(u.unitId, u.variant).type === "ranged" ? "back" : "front" })),
  );
  const foe = ph.context.foe;
  const toggle = (i: number) => {
    const has = picks.find((p) => p.armyIndex === i);
    if (has) setPicks(picks.filter((p) => p.armyIndex !== i));
    else if (picks.length < 5) {
      const u = army[i]!;
      setPicks([...picks, { armyIndex: i, line: getVariant(u.unitId, u.variant).type === "ranged" ? "back" : "front" }]);
    }
  };
  return (
    <div className="panel phase combat-setup" key={`${ph.side}-${owner}`}>
      <h3>{a.combatSetup(playerName(owner))}</h3>
      {foe.kind === "neutral" && (
        <>
          <p className="muted">{a.foes}</p>
          <div className="army-row">
            {foe.units.map((u, i) => (
              <span key={i} className="army-chip">
                {cardImage(u.unitId, u.variant) && <img src={cardImage(u.unitId, u.variant)!} alt="" />}
                <span>{unitName(u.unitId)}</span>
              </span>
            ))}
          </div>
        </>
      )}
      <ol className="picks">
        {army.map((u, i) => {
          const pick = picks.find((p) => p.armyIndex === i);
          return (
            <li key={i} className={`pick ${pick ? "" : "off"}`}>
              <input type="checkbox" checked={!!pick} onChange={() => toggle(i)} />
              <span className="pick-name">
                {unitName(u.unitId)} <em className="muted">{getVariant(u.unitId, u.variant).label}</em>
              </span>
              {pick && (
                <div className="segmented small">
                  {(["back", "front"] as const).map((l) => (
                    <button
                      key={l}
                      className={pick.line === l ? "on" : ""}
                      onClick={() => setPicks(picks.map((p) => (p.armyIndex === i ? { ...p, line: l } : p)))}
                    >
                      {l === "back" ? t.backline : t.frontline}
                    </button>
                  ))}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <button className="btn primary" disabled={picks.length === 0} onClick={() => act({ type: "combat-setup", picks })}>
        {a.startFight}
      </button>
    </div>
  );
}

function CombatPanel({
  state,
  act,
  error,
  playerName,
}: {
  state: AdventureState;
  act: (a: AdventureAction) => void;
  error: string | null;
  playerName: (id: string | null) => string;
}) {
  const { t } = useI18n();
  const a = t.adv;
  const ph = state.phase;
  if (ph.type !== "combat") throw new Error("not in combat");
  const combat = ph.combat;
  const names = new Map<string, string>();
  const addUid = (uid: string) => names.set(uid, unitName(uid.slice(uid.indexOf("-") + 1)));
  for (const u of combat.units) addUid(u.uid);
  for (const e of combat.log) {
    if ("uid" in e) addUid(e.uid);
    if (e.type === "attack") {
      addUid(e.attackerUid);
      addUid(e.targetUid);
    }
  }
  const sideNames: Record<Side, string> = {
    attacker: playerName(sidePlayer(state, ph.context, "attacker")),
    defender: playerName(sidePlayer(state, ph.context, "defender")),
  };
  const hero = getHero(state, ph.context.attackerHero);
  const cph = combat.phase;
  const activeSide = cph.type === "activation" ? combat.units.find((u) => u.uid === cph.uid)?.side : undefined;
  const canSurrender = ph.context.foe.kind !== "neutral" && activeSide !== undefined;
  return (
    <div className="adventure-combat">
      <h2>
        {sideNames.attacker} {a.vs} {sideNames.defender}
      </h2>
      {error && <p className="error">{error}</p>}
      <CombatView
        state={combat}
        onAction={(action) => act({ type: "combat", action })}
        cards={null}
        names={names}
        sideNames={sideNames}
        canContinue={totalMp(hero) >= 1}
        extra={
          <>
            {cph.type === "round-end" && totalMp(hero) < 1 && <p className="warn">{a.noMpToContinue}</p>}
            {canSurrender && (
              <button className="btn" onClick={() => act({ type: "surrender", side: activeSide! })}>
                {a.surrender} · {sideNames[activeSide!]}
              </button>
            )}
            {(["attacker", "defender"] as const).map((side) => {
              const owner = sidePlayer(state, ph.context, side);
              if (!owner || cardSide(state, ph.context, owner) !== side) return null;
              return (
                <HandPanel
                  key={side}
                  state={state}
                  player={getPlayer(state, owner)}
                  act={act}
                  context={{ combat, side, unitNames: names }}
                />
              );
            })}
          </>
        }
      />
    </div>
  );
}

function AdventureLog({
  state,
  t,
  heroName,
  playerName,
}: {
  state: AdventureState;
  t: Messages;
  heroName: (id: string) => string;
  playerName: (id: string | null) => string;
}) {
  const a = t.adv;
  const res = (r: Partial<Record<Resource, number>>) =>
    Object.entries(r)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${RES_ICON[k as Resource]}`)
      .join(", ") || "0";
  const describe = (e: AdventureEvent): string | null => {
    switch (e.type) {
      case "round-start":
        return a.ev.roundStart(e.round, e.resourceRound);
      case "income":
        return a.ev.income(playerName(e.player), res(e.gained));
      case "astrologers":
        return a.ev.astrologers(astrologers.find((c) => c.id === e.card)?.name ?? e.card);
      case "turn-start":
        return a.ev.turnStart(playerName(e.player));
      case "move":
        return null;
      case "discover":
        return a.ev.discover(heroName(e.heroId), e.tileId);
      case "place-tile":
        return a.ev.placeTile(heroName(e.heroId), e.tileId);
      case "visit": {
        const f = fieldAt(state, e.hex)?.field;
        return a.ev.visit(heroName(e.heroId), a.loc(f?.location ?? e.location));
      }
      case "gain":
        return a.ev.gain(playerName(e.player), res(e.resources));
      case "pay":
        return a.ev.pay(playerName(e.player), res(e.resources));
      case "production":
        return a.ev.production(playerName(e.player), RES_ICON[e.resource], e.delta);
      case "flag":
        return a.ev.flag(playerName(e.player), a.loc(e.location));
      case "experience":
        return a.ev.experience(heroName(e.heroId), e.amount, e.level);
      case "morale":
        return a.ev.morale(playerName(e.player), a.moraleValue(e.morale));
      case "mp":
        return a.ev.mp(heroName(e.heroId), e.amount);
      case "dice":
        return a.ev.dice(
          e.faces
            .map((f) => (typeof f === "string" ? f : `${f.amount} ${RES_ICON[f.resource]}`))
            .join(" / "),
        );
      case "not-automated":
        return a.ev.notAutomated(a.loc(e.location));
      case "quick-combat":
        return a.ev.quickCombat(heroName(e.heroId));
      case "combat-start":
        return a.ev.combatStart(heroName(e.heroId));
      case "combat-end":
        return a.ev.combatEnd(heroName(e.heroId), a.ev.outcomes[e.outcome] ?? e.outcome);
      case "hero-defeated":
        return a.ev.heroDefeated(heroName(e.heroId));
      case "army-reset":
        return a.ev.armyReset(playerName(e.player));
      case "eliminated":
        return a.ev.eliminated(playerName(e.player));
      case "victory-condition":
        return a.ev.victoryCondition(playerName(e.player));
      case "game-over":
        return a.ev.gameOver;
      case "level-up":
        return t.cards.ev.levelUp(playerName(e.player), e.level);
      case "draw":
        return t.cards.ev.draw(playerName(e.player), e.n);
      case "gain-card":
        return t.cards.ev.gainCard(playerName(e.player), cardInfo(e.card).name);
      case "remove-card":
        return t.cards.ev.removeCard(playerName(e.player), cardInfo(e.card).name);
      case "play-card":
        return t.cards.ev.playCard(playerName(e.player), cardInfo(e.card).name, e.automated);
      case "build": {
        const p = state.players.find((x) => x.id === e.player);
        const b = p ? getTown(p.faction).buildings.find((x) => x.slot === e.slot)?.name : e.slot;
        return t.cards.ev.build(playerName(e.player), b ?? e.slot);
      }
      case "recruit":
        return t.cards.ev.recruit(playerName(e.player), unitName(e.unitId), e.variant === "pack");
      case "hire-hero":
        return t.cards.ev.hire(playerName(e.player));
      case "trade":
        return t.cards.ev.trade(playerName(e.player), RES_ICON[e.sell], RES_ICON[e.buy], e.times);
      case "building-effect": {
        const p = state.players.find((x) => x.id === e.player);
        const b = p ? getTown(p.faction).buildings.find((x) => x.slot === e.slot)?.name : e.slot;
        return t.cards.ev.buildingEffect(playerName(e.player), b ?? e.slot);
      }
    }
  };
  const lines = state.log
    .map((e, i) => ({ i, e, text: describe(e) }))
    .filter((l) => l.text)
    .slice(-60)
    .reverse();
  return (
    <div className="panel log">
      <h3>{a.log}</h3>
      <ol>
        {lines.map((l) => (
          <li key={l.i} className={`ev-${l.e.type}`}>
            {l.text}
          </li>
        ))}
      </ol>
    </div>
  );
}
