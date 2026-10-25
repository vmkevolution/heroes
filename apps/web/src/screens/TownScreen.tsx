import { getTown, units, type BuildingSlot, type Resource } from "@heroes/data";
import { buildable, currentPlayer, type AdventureAction, type AdventureState, type Player } from "@heroes/engine";
import { useI18n } from "../i18n.tsx";
import { cardImage } from "../cards.ts";
import { CardText, RES_ICON, TownActions } from "./CardsPanels.tsx";

const RESOURCES: Resource[] = ["gold", "buildingMaterials", "valuables"];
const GROUPS: { key: "main" | "dwellings" | "special"; slots: BuildingSlot[] }[] = [
  { key: "main", slots: ["city_hall", "citadel", "mage_guild"] },
  { key: "dwellings", slots: ["dwelling_bronze", "dwelling_silver", "dwelling_gold"] },
  { key: "special", slots: ["special_1", "special_2"] },
];
/** Dwellings are built in order: Silver needs Bronze, Gold needs Silver (p. 30). */
const PREREQUISITE: Partial<Record<BuildingSlot, BuildingSlot>> = {
  dwelling_silver: "dwelling_bronze",
  dwelling_gold: "dwelling_silver",
};
const TIER: Partial<Record<BuildingSlot, string>> = { dwelling_bronze: "bronze", dwelling_silver: "silver", dwelling_gold: "gold" };

/** Faction units a Dwelling unlocks for Recruiting. */
function dwellingUnits(faction: string, slot: BuildingSlot) {
  const tier = TIER[slot];
  if (!tier) return [];
  return units.filter((u) => u.variants.some((v) => v.key === "few" && v.faction === faction && v.tier === tier));
}

/**
 * Full-screen Town Board: every building with its cost, prerequisite and state, the Build action
 * (one per Turn with the Build token, p. 30), then Recruiting and the other Town actions.
 */
export function TownScreen({
  state,
  player,
  act,
  onClose,
}: {
  state: AdventureState;
  player: Player;
  act: (a: AdventureAction) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const c = t.cards;
  const w = t.town;
  const town = getTown(player.faction);
  const myTurn = currentPlayer(state).id === player.id && state.phase.type === "turn";
  const canBuild = buildable(player);
  const built = player.town.buildings;

  const status = (slot: BuildingSlot, cost: Partial<Record<Resource, number>>) => {
    if (built.includes(slot)) return { cls: "built", text: `✓ ${w.built}` };
    const pre = PREREQUISITE[slot];
    if (pre && !built.includes(pre)) return { cls: "locked", text: w.needs(c.buildings[pre]) };
    if (!myTurn) return { cls: "locked", text: w.notYourTurn };
    if (player.town.used.build) return { cls: "locked", text: w.tokenUsed };
    const missing = RESOURCES.filter((r) => (cost[r] ?? 0) > player.resources[r]);
    if (missing.length) return { cls: "short", text: w.missing(missing.map((r) => `${(cost[r] ?? 0) - player.resources[r]} ${RES_ICON[r]}`).join(" ")) };
    if (!canBuild.includes(slot)) return { cls: "locked", text: w.unavailable };
    return { cls: "ready", text: w.ready };
  };

  return (
    <div className="town-screen-backdrop" onClick={onClose}>
      <div className="town-screen" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={c.townOf(player.name)}>
        <header className="town-screen-head">
          <div>
            <h2>
              🏰 {town.name} <span className="muted small">· {c.townOf(player.name)}</span>
            </h2>
            <p className="small">
              {RESOURCES.map((r) => (
                <span key={r} className="res-chip" title={t.adv[r]}>
                  {RES_ICON[r]} {player.resources[r]}
                  <span className="muted"> (+{player.production[r]})</span>
                </span>
              ))}
            </p>
          </div>
          <div className="town-tokens small">
            {(
              [
                ["build", c.tokenBuild],
                ["population", c.tokenPopulation],
                ["spellBook", c.tokenSpellBook],
              ] as const
            ).map(([k, label]) => (
              <span key={k} className={`token ${player.town.used[k] ? "used" : ""}`}>
                {label} : {player.town.used[k] ? c.used : c.available}
              </span>
            ))}
          </div>
          <button className="btn ghost" onClick={onClose} aria-label={w.close}>
            ✕
          </button>
        </header>
        <p className="muted small">{w.hint}</p>

        {GROUPS.map((g) => (
          <section key={g.key} className="town-group">
            <h3>{w.groups[g.key]}</h3>
            <div className={`town-grid ${g.key}`}>
              {g.slots.map((slot, i) => {
                const b = town.buildings.find((x) => x.slot === slot);
                if (!b) return null;
                const st = status(slot, b.cost);
                const unlocks = dwellingUnits(player.faction, slot);
                return (
                  <article key={slot} className={`building-card ${st.cls}`}>
                    {g.key === "dwellings" && i > 0 && <span className="chain">→</span>}
                    <div className="building-title">
                      <strong>{b.name}</strong>
                      <span className="muted small">{c.buildings[slot]}</span>
                    </div>
                    <div className="building-cost">
                      {RESOURCES.filter((r) => b.cost[r]).map((r) => (
                        <span key={r} className={(b.cost[r] ?? 0) > player.resources[r] && !built.includes(slot) ? "short" : ""}>
                          {b.cost[r]} {RES_ICON[r]}
                        </span>
                      ))}
                    </div>
                    {unlocks.length > 0 && (
                      <div className="building-units">
                        {unlocks.map((u) => {
                          const img = cardImage(u.id, "few");
                          return (
                            <figure key={u.id} title={u.name}>
                              {img && <img src={img} alt={u.name} loading="lazy" />}
                              <figcaption className="small">{u.name}</figcaption>
                            </figure>
                          );
                        })}
                      </div>
                    )}
                    <CardText text={b.effect} className="small" />
                    <div className="building-foot">
                      <span className={`status ${st.cls}`}>{st.text}</span>
                      {st.cls === "ready" && (
                        <button className="btn primary small" onClick={() => act({ type: "build", slot })}>
                          {c.build}
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ))}

        {myTurn && (
          <section className="town-group">
            <h3>{w.groups.actions}</h3>
            <TownActions state={state} player={player} act={act} />
          </section>
        )}
      </div>
    </div>
  );
}
