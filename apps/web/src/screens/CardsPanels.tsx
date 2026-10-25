import { Fragment, useState, type ReactNode } from "react";
import { getTown, getVariant, type BuildingSlot, type Resource } from "@heroes/data";
import {
  buildable,
  canAfford,
  canReinforce,
  canUseSpellBook,
  cardInfo,
  expertLimit,
  handLimit,
  HIRE_COST,
  hireSpots,
  playerLevel,
  recruitable,
  TRADE_RATES,
  type AdventureAction,
  type AdventureState,
  type CombatState,
  type Hex,
  type Op,
  type Player,
  type Side,
} from "@heroes/engine";
import { useI18n, type Messages } from "../i18n.tsx";
import { assetImage, cardArt, unitName } from "../cards.ts";

const RESOURCES: Resource[] = ["gold", "buildingMaterials", "valuables"];
export const RES_ICON: Record<Resource, string> = { gold: "🪙", buildingMaterials: "🪨", valuables: "💎" };

/** Wiki glyphs (`:attack:`) as small icons. */
const GLYPHS: Record<string, string> = {
  attack: "⚔️",
  defense: "🛡️",
  power: "✨",
  knowledge: "📘",
  gold: "🪙",
  building_materials: "🪨",
  valuables: "💎",
  damage: "💥",
  health_points: "❤️",
  initiative: "⚡",
  movement_points: "👣",
  instant: "⏱️",
  activation: "▶️",
  map_effect: "🗺️",
  ongoing: "⏳",
  permanent: "♾️",
  spell: "🔮",
  artifact: "🏺",
  experience: "⭐",
  positive_morale: "🙂",
  negative_morale: "🙁",
  bronze_tier: "🥉",
  silver_tier: "🥈",
  gold_tier: "🥇",
  azure_tier: "🔷",
  ranged_unit: "🏹",
  ground_unit: "🥾",
  flying_unit: "🪽",
  expert: "👑",
  pay: "💰",
  resource_die: "🎲",
  treasure_die: "🎁",
  might: "💪",
  magic: "🪄",
  unit_passive: "◆",
  unit_attack: "⚔",
  unit_retaliation: "↩",
  unit_other: "✦",
};

export function CardText({ text, className }: { text: string; className?: string }) {
  const lines = text.split("\n");
  return (
    <span className={`card-text ${className ?? ""}`} lang="en">
      {lines.map((line, i) => (
        <Fragment key={i}>
          {line.split(/(:[a-z_]+:)/g).map((part, j) => {
            const m = part.match(/^:([a-z_]+):$/);
            if (m && GLYPHS[m[1]!]) {
              return (
                <span key={j} className="glyph" title={m[1]}>
                  {GLYPHS[m[1]!]}
                </span>
              );
            }
            return <Fragment key={j}>{part}</Fragment>;
          })}
          {i < lines.length - 1 && <br />}
        </Fragment>
      ))}
    </span>
  );
}

export function resText(r: Partial<Record<Resource, number>>): string {
  return (
    Object.entries(r)
      .filter(([, n]) => n)
      .map(([k, n]) => `${n} ${RES_ICON[k as Resource]}`)
      .join(" ") || "0"
  );
}

function CardThumb({ card, selected, onClick, dim }: { card: string; selected?: boolean; onClick?: () => void; dim?: boolean }) {
  const info = cardInfo(card);
  const art = cardArt(card);
  return (
    <button type="button" className={`card-thumb ${selected ? "on" : ""} ${dim ? "dim" : ""}`} onClick={onClick} title={info.name}>
      {art ? <img src={art} alt={info.name} loading="lazy" /> : <span className="card-name">{info.name}</span>}
    </button>
  );
}

export function CardRow({ cards, onPick }: { cards: string[]; onPick?: (i: number) => void }) {
  return (
    <div className="card-row">
      {cards.map((c, i) => (
        <CardThumb key={`${c}-${i}`} card={c} onClick={onPick ? () => onPick(i) : undefined} />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Hand

export interface HandContext {
  combat: CombatState | null;
  side: Side | null;
  unitNames: Map<string, string>;
}

export function HandPanel({
  state,
  player,
  act,
  context,
  title,
}: {
  state: AdventureState;
  player: Player;
  act: (a: AdventureAction) => void;
  context: HandContext;
  title?: string;
}) {
  const { t } = useI18n();
  const c = t.cards;
  const [selected, setSelected] = useState<number | null>(null);
  const level = playerLevel(state, player.id);
  const card = selected !== null ? player.hand[selected] : undefined;
  return (
    <div className="panel hand">
      <h3>
        {title ?? c.handOf(player.name)}{" "}
        <span className="muted small">
          · {c.handLimit(handLimit(level))} · {c.experts(player.expertUsed, expertLimit(level))}
        </span>
      </h3>
      <p className="muted small">{c.deckCount(player.deck.length, player.hand.length, player.discard.length)}</p>
      {player.permanent && (
        <div className="permanent">
          <span className="muted small">{c.permanent} :</span> <strong>{cardInfo(player.permanent).name}</strong>
        </div>
      )}
      {player.hand.length === 0 ? (
        <p className="muted">{c.noCards}</p>
      ) : (
        <div className="card-row">
          {player.hand.map((h, i) => (
            <CardThumb key={`${h}-${i}`} card={h} selected={selected === i} onClick={() => setSelected(selected === i ? null : i)} />
          ))}
        </div>
      )}
      {card && selected !== null && (
        <PlayCard
          key={`${card}-${selected}`}
          state={state}
          player={player}
          index={selected}
          act={(a) => {
            act(a);
            setSelected(null);
          }}
          context={context}
          onClose={() => setSelected(null)}
        />
      )}
    </div>
  );
}

function PlayCard({
  state,
  player,
  index,
  act,
  context,
  onClose,
}: {
  state: AdventureState;
  player: Player;
  index: number;
  act: (a: AdventureAction) => void;
  context: HandContext;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const c = t.cards;
  const ref = player.hand[index]!;
  const info = cardInfo(ref);
  const [empower, setEmpower] = useState<number[]>([]);
  const [target, setTarget] = useState<string>("");
  const [school, setSchool] = useState<string>("fire");
  const needsTarget = (o: (typeof info.options)[number]) =>
    !!context.combat && !!o.effects?.some((e) => e.kind === "damage" || e.kind === "heal" || e.kind === "buff");
  // Cards that can pay for a Spell's Power: other Spells (+1) and cards with a +Power effect.
  const powerCards = player.hand
    .map((card, i) => ({ card, i }))
    .filter(({ i }) => i !== index)
    .map(({ card, i }) => {
      const ci = cardInfo(card);
      const n = ci.kind === "spell" ? 1 : (ci.options[0]?.effects ?? []).reduce((s, e) => s + (e.kind === "power" && !e.school ? e.n : 0), 0);
      return { card, i, n };
    })
    .filter((x) => x.n > 0);
  const power = powerCards.filter((x) => empower.includes(x.i)).reduce((s, x) => s + x.n, 0);
  const units = context.combat?.units ?? [];

  return (
    <div className="play-card">
      <div className="play-card-art">
        {cardArt(ref) && <img src={cardArt(ref)!} alt={info.name} />}
        <div>
          <strong>{info.name}</strong>
          <div className="muted small">{c.kinds[info.kind]}</div>
        </div>
      </div>
      {info.kind === "spell" && powerCards.length > 0 && (
        <div className="empower">
          <span className="muted small">{c.empowerWith}</span>
          {powerCards.map((x) => (
            <label key={x.i} className="chk">
              <input
                type="checkbox"
                checked={empower.includes(x.i)}
                onChange={() => setEmpower(empower.includes(x.i) ? empower.filter((i) => i !== x.i) : [...empower, x.i])}
              />
              {cardInfo(x.card).name} ({c.empowerAs(x.n)})
            </label>
          ))}
        </div>
      )}
      {info.kind === "spell" && info.school === null && (
        <label className="small">
          {c.school}{" "}
          <select value={school} onChange={(e) => setSchool(e.target.value)}>
            {Object.entries(c.schools).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
      )}
      {info.options.some(needsTarget) && (
        <label className="small">
          {c.target}{" "}
          <select value={target} onChange={(e) => setTarget(e.target.value)}>
            <option value="">{c.chooseTarget}</option>
            {units.map((u) => (
              <option key={u.uid} value={u.uid}>
                {context.unitNames.get(u.uid) ?? u.uid} ({u.side === context.side ? "✓" : "✗"})
              </option>
            ))}
          </select>
        </label>
      )}
      <ol className="options">
        {info.options.map((o, i) => (
          <li key={i} className={o.effects ? "auto" : "manual"}>
            <CardText text={o.text} />
            <div className="option-foot">
              {o.expert && <span className="badge">👑 {c.expert}</span>}
              {info.kind === "spell" && <span className={`badge ${power >= o.power ? "" : "warn"}`}>{c.powerNeeded(o.power)}</span>}
              <span className="muted small">{o.effects ? c.automated : c.manual}</span>
              <button
                className="btn small primary"
                onClick={() =>
                  act({
                    type: "play-card",
                    player: player.id,
                    handIndex: index,
                    option: i,
                    target: target || undefined,
                    empower: empower.map((handIndex) => ({ handIndex, option: 0 })),
                    school: info.school === null && info.kind === "spell" ? (school as "fire") : undefined,
                  })
                }
              >
                {c.play}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <div className="buttons">
        <button className="btn small" onClick={() => act({ type: "discard-card", player: player.id, handIndex: index })}>
          {c.discard}
        </button>
        <button className="btn small ghost" onClick={onClose}>
          {c.close}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Phases: hand refresh, Search, option lists

export function RefreshBox({ state, act }: { state: AdventureState; act: (a: AdventureAction) => void }) {
  const { t } = useI18n();
  const ph = state.phase;
  const [discard, setDiscard] = useState<number[]>([]);
  if (ph.type !== "refresh") return null;
  const p = state.players.find((x) => x.id === ph.player)!;
  const limit = handLimit(playerLevel(state, p.id));
  const tooMany = p.hand.length - discard.length > limit;
  return (
    <div className="panel phase">
      <h3>{t.cards.handOf(p.name)}</h3>
      <p className="muted">{t.cards.refreshTitle}</p>
      <p className="small">{t.cards.handLimit(limit)}</p>
      <div className="card-row">
        {p.hand.map((card, i) => (
          <CardThumb
            key={`${card}-${i}`}
            card={card}
            dim={discard.includes(i)}
            onClick={() => setDiscard(discard.includes(i) ? discard.filter((x) => x !== i) : [...discard, i])}
          />
        ))}
      </div>
      {tooMany && <p className="warn small">{t.cards.refreshTooMany(p.hand.length - discard.length - limit)}</p>}
      <button className="btn primary" disabled={tooMany} onClick={() => act({ type: "refresh", discard })}>
        {t.cards.refreshDo(discard.length)}
      </button>
    </div>
  );
}

export function SearchBox({ state, act }: { state: AdventureState; act: (a: AdventureAction) => void }) {
  const { t } = useI18n();
  const c = t.cards;
  const ph = state.phase;
  if (ph.type !== "search") return null;
  const p = state.players.find((x) => x.id === ph.player)!;
  const top = state.decks[ph.deck].discard.at(-1);
  return (
    <div className="panel phase">
      <h3>
        {p.name} · {c.searchTitle(c.decks[ph.deck] ?? ph.deck, ph.n)}
      </h3>
      <p className="muted small">{c.sources[ph.source] ?? ph.source}</p>
      {ph.revealed ? (
        <>
          <p>{c.searchPick}</p>
          <CardRow cards={ph.revealed} onPick={(index) => act({ type: "search-pick", index })} />
        </>
      ) : (
        <div className="search-choice">
          <button className="btn primary" onClick={() => act({ type: "search", mode: "look" })}>
            {c.searchLook(ph.n)}
          </button>
          {!ph.fromDiscard && top && (
            <div className="discard-top">
              <CardThumb card={top} onClick={() => act({ type: "search", mode: "discard-pile" })} />
              <button className="btn" onClick={() => act({ type: "search", mode: "discard-pile" })}>
                {c.searchTakeDiscard}
              </button>
            </div>
          )}
          {p.hand.some((h) => cardInfo(h).options.some((o) => o.effects?.some((e) => e.kind === "search-size"))) && (
            <HandPanel state={state} player={p} act={act} context={{ combat: null, side: null, unitNames: new Map() }} />
          )}
        </div>
      )}
    </div>
  );
}

export function describeOp(op: Op, player: Player, t: Messages): ReactNode {
  const c = t.cards;
  const deck = (d: string) => c.decks[d] ?? d;
  const gold = (n?: number) => (n ? `${n} ${RES_ICON.gold}` : "");
  switch (op.op) {
    case "none":
      return c.opNone;
    case "gain":
      return c.opGain(resText(op.resources));
    case "mp":
      return c.opMp(op.n);
    case "draw":
      return c.opDraw(op.n);
    case "morale":
      return c.opMorale;
    case "experience":
      return c.opXp(op.n);
    case "search":
      return c.opSearch(deck(op.deck), op.n, gold(op.cost), op.times ?? 1);
    case "search-discard":
      return c.opSearchDiscard(deck(op.deck), op.n, gold(op.cost));
    case "resource-dice":
      return c.opDice(op.n, op.chooseOne);
    case "minor-artifact":
      return c.opMinor;
    case "trade":
      return c.opTrade;
    case "reinforce": {
      const u = player.army[op.armyIndex];
      return c.opReinforce(u ? unitName(u.unitId) : "?", gold(op.cost));
    }
    case "take":
      return (
        <span className="op-card">
          {cardArt(op.card) && <img src={cardArt(op.card)!} alt="" />}
          {c.opTake(cardInfo(op.card).name, gold(op.cost))}
        </span>
      );
    case "discard-top":
      return c.opDiscardTop(deck(op.deck));
    case "remove": {
      const card = player.hand[op.handIndex];
      const then =
        op.then === "gold"
          ? c.opRemoveGold
          : op.then === "experience"
            ? c.opRemoveXp
            : op.then === "search-own-deck"
              ? c.opRemoveSearch
              : op.then === "market"
                ? c.opRemoveMarket
                : op.then && op.then.op !== "none"
                  ? String(describeOp(op.then, player, t))
                  : "";
      return c.opRemove(card ? cardInfo(card).name : "?", then);
    }
    case "stat": {
      const name = `${op.empowered ? "★ " : ""}${cardInfo(`stat:${op.stat}`).name}`;
      const replaced = op.replaceHandIndex !== undefined ? player.hand[op.replaceHandIndex] : undefined;
      return c.opStat(name, replaced ? cardInfo(replaced).name : "", gold(op.cost));
    }
    case "seq":
      return op.ops.map((o) => String(describeOp(o, player, t))).join(" + ");
  }
}

// ---------------------------------------------------------------------------
// Town

export function TownPanel({ state, player, act }: { state: AdventureState; player: Player; act: (a: AdventureAction) => void }) {
  const { t } = useI18n();
  const c = t.cards;
  const town = getTown(player.faction);
  const canBuild = buildable(player);
  const [recruits, setRecruits] = useState<string[]>([]);
  const [reinforce, setReinforce] = useState<number[]>([]);
  const [open, setOpen] = useState(false);
  const spots = hireSpots(state, player.id);
  const hasSecondary = state.heroes.some((h) => h.owner === player.id && h.kind === "secondary");
  const recruitList = recruitable(player);
  const reinforceList = player.army.map((_, i) => i).filter((i) => canReinforce(player, i));
  const cost = (id: string, v: string) => getVariant(id, v).cost;
  const total: Record<Resource, number> = { gold: 0, buildingMaterials: 0, valuables: 0 };
  for (const id of recruits) for (const r of RESOURCES) total[r] += cost(id, "few")?.[r] ?? 0;
  for (const i of reinforce) for (const r of RESOURCES) total[r] += cost(player.army[i]!.unitId, "pack")?.[r] ?? 0;
  const tok = (used: boolean) => (used ? c.used : c.available);
  return (
    <div className="panel town">
      <h3 onClick={() => setOpen(!open)} className="clickable">
        {open ? "▾" : "▸"} {c.townOf(player.name)} <span className="muted small">· {town.name}</span>
      </h3>
      <p className="small">
        {c.tokens} : {c.tokenBuild} <em>{tok(player.town.used.build)}</em> · {c.tokenPopulation}{" "}
        <em>{tok(player.town.used.population)}</em> · {c.tokenSpellBook} <em>{tok(player.town.used.spellBook)}</em>
      </p>
      {open && (
        <>
          <ul className="buildings">
            {town.buildings.map((b) => {
              const built = player.town.buildings.includes(b.slot);
              const can = canBuild.includes(b.slot) && canAfford(player, b.cost);
              return (
                <li key={b.slot} className={built ? "built" : ""}>
                  <div className="building-head">
                    <strong>{b.name}</strong> <span className="muted small">({c.buildings[b.slot as BuildingSlot]})</span>
                    {built ? (
                      <span className="badge">✓ {c.built}</span>
                    ) : (
                      <button className="btn small" disabled={!can} onClick={() => act({ type: "build", slot: b.slot })}>
                        {c.build} · {resText(b.cost)}
                      </button>
                    )}
                  </div>
                  <CardText text={b.effect} className="small muted" />
                </li>
              );
            })}
          </ul>
          {!player.town.used.population && (
            <div className="recruit">
              <h4>{c.recruitTitle}</h4>
              {recruitList.length + reinforceList.length === 0 && <p className="muted small">{c.nothingToRecruit}</p>}
              {recruitList.map((id) => (
                <label key={id} className="chk">
                  <input
                    type="checkbox"
                    checked={recruits.includes(id)}
                    onChange={() => setRecruits(recruits.includes(id) ? recruits.filter((x) => x !== id) : [...recruits, id])}
                  />
                  {c.recruit} {unitName(id)} · {resText(cost(id, "few") ?? {})}
                </label>
              ))}
              {reinforceList.map((i) => (
                <label key={i} className="chk">
                  <input
                    type="checkbox"
                    checked={reinforce.includes(i)}
                    onChange={() => setReinforce(reinforce.includes(i) ? reinforce.filter((x) => x !== i) : [...reinforce, i])}
                  />
                  {c.reinforce} {unitName(player.army[i]!.unitId)} · {resText(cost(player.army[i]!.unitId, "pack") ?? {})}
                </label>
              ))}
              {recruits.length + reinforce.length > 0 && (
                <button
                  className="btn primary small"
                  disabled={!canAfford(player, total)}
                  onClick={() => {
                    act({ type: "recruit", recruit: recruits, reinforce });
                    setRecruits([]);
                    setReinforce([]);
                  }}
                >
                  {c.recruitDo} · {resText(total)}
                </button>
              )}
              {!hasSecondary && spots.length > 0 && (
                <div className="buttons">
                  {spots.map((h: Hex, i) => (
                    <button
                      key={i}
                      className="btn small"
                      disabled={player.resources.gold < HIRE_COST}
                      onClick={() => act({ type: "hire-hero", at: h })}
                    >
                      {c.hire(HIRE_COST)}
                      {spots.length > 1 ? ` #${i + 1}` : ""}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
          {canUseSpellBook(state, player) && (
            <button
              className="btn small"
              disabled={player.resources.gold < town.spellBookCost}
              onClick={() => act({ type: "spell-book" })}
            >
              {c.spellBook(town.spellBookCost)}
            </button>
          )}
        </>
      )}
    </div>
  );
}

export function TradePanel({ player, act }: { player: Player; act: (a: AdventureAction) => void }) {
  const { t } = useI18n();
  const c = t.cards;
  const [sell, setSell] = useState<Resource>("gold");
  const [buy, setBuy] = useState<Resource>("buildingMaterials");
  const [times, setTimes] = useState(1);
  if (!player.trading) return null;
  const rate = TRADE_RATES[sell][buy];
  return (
    <div className="panel trade">
      <h3>{c.tradeTitle}</h3>
      <div className="row-gap small">
        <label>
          {c.sell}{" "}
          <select value={sell} onChange={(e) => setSell(e.target.value as Resource)}>
            {RESOURCES.map((r) => (
              <option key={r} value={r}>
                {RES_ICON[r]} {t.adv[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {c.buy}{" "}
          <select value={buy} onChange={(e) => setBuy(e.target.value as Resource)}>
            {RESOURCES.filter((r) => r !== sell).map((r) => (
              <option key={r} value={r}>
                {RES_ICON[r]} {t.adv[r]}
              </option>
            ))}
          </select>
        </label>
        <label>
          {c.times} <input type="number" min={1} max={20} value={times} onChange={(e) => setTimes(Math.max(1, Number(e.target.value)))} />
        </label>
      </div>
      {rate && (
        <p className="small">
          {rate.give * times} {RES_ICON[sell]} → {rate.get * times} {RES_ICON[buy]}
        </p>
      )}
      <button className="btn primary small" disabled={!rate || player.resources[sell] < (rate?.give ?? 0) * times} onClick={() => act({ type: "trade", sell, buy, times })}>
        {c.tradeDo}
      </button>
    </div>
  );
}

export function ManualPanel({ player, act }: { player: Player; act: (a: AdventureAction) => void }) {
  const { t } = useI18n();
  const c = t.cards;
  const [open, setOpen] = useState(false);
  const adj = (a: Omit<Extract<AdventureAction, { type: "adjust" }>, "type" | "player">) => act({ type: "adjust", player: player.id, ...a });
  return (
    <div className="panel manual">
      <h3 onClick={() => setOpen(!open)} className="clickable">
        {open ? "▾" : "▸"} {c.manualTitle}
      </h3>
      {open && (
        <>
          <p className="muted small">{c.manualHint}</p>
          <div className="manual-grid">
            {RESOURCES.map((r) => (
              <span key={r} className="buttons">
                <button className="btn small" onClick={() => adj({ resources: { [r]: -1 } })}>
                  −1 {RES_ICON[r]}
                </button>
                <button className="btn small" onClick={() => adj({ resources: { [r]: 1 } })}>
                  +1 {RES_ICON[r]}
                </button>
              </span>
            ))}
            <span className="buttons">
              <button className="btn small" onClick={() => adj({ mp: -1 })}>
                {c.mpDown}
              </button>
              <button className="btn small" onClick={() => adj({ mp: 1 })}>
                {c.mpUp}
              </button>
            </span>
            <span className="buttons">
              <button className="btn small" onClick={() => adj({ morale: -1 })}>
                {c.moraleDown}
              </button>
              <button className="btn small" onClick={() => adj({ morale: 1 })}>
                {c.moraleUp}
              </button>
            </span>
            <button className="btn small" onClick={() => adj({ draw: 1 })}>
              {c.drawOne}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export { assetImage };
