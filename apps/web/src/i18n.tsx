import { createContext, useContext, useState, type ReactNode } from "react";
import { advEn, advFr } from "./i18n-adventure.ts";
import { cardsEn, cardsFr } from "./i18n-cards.ts";
import { netEn, netFr } from "./i18n-net.ts";
import { aiEn, aiFr } from "./i18n-ai.ts";

export type Lang = "fr" | "en";

const fr = {
  appTitle: "Heroes",
  combatPrototype: "Prototype de combat",
  language: "English",
  newCombat: "Nouveau combat",
  attacker: "Attaquant",
  defender: "Défenseur",
  faction: "Faction",
  neutralUnits: "Unités neutres",
  mode: "Type de combat",
  modePlayers: "Joueur contre joueur",
  modeNeutral: "Contre des unités neutres",
  units: "Unités",
  few: "Few",
  pack: "Pack",
  backline: "Arrière",
  frontline: "Avant",
  maxUnits: "5 unités au maximum par camp.",
  statCards: "Cartes Attaque et Défense en main",
  startCombat: "Lancer le combat",
  round: "Round",
  initiativeOrder: "Ordre d'initiative",
  activeUnit: "Unité active",
  turnOf: "À jouer",
  defend: "Défendre",
  endActivation: "Terminer l'activation",
  hintActivation: "Cliquez une case en surbrillance pour vous déplacer, ou une unité ennemie encadrée pour attaquer.",
  reaction: "Avant le jet de dé",
  reactionHint: "Chaque joueur peut jouer des cartes, puis passe.",
  playAttack: "Jouer Attaque (+1 Attaque)",
  playDefense: "Jouer Défense (+1 Défense)",
  pass: "Passer",
  passed: "a passé",
  cardsLeft: "cartes restantes",
  roundEnd: "Fin du round de combat",
  roundEndHint: "Contre des neutres, le combat dure un round. Continuer coûte 1 point de mouvement.",
  continueCombat: "Continuer (1 PM)",
  retreat: "Battre en retraite",
  victory: "Victoire",
  wins: "gagne le combat",
  retreated: "L'attaquant a battu en retraite.",
  draw: "Plus aucune unité des deux côtés.",
  log: "Journal",
  penalty: "pénalité de tir : 2 dés, le plus faible compte",
  preview: "Dégâts possibles",
  damage: "dégâts",
  defending: "En défense",
  paralyzed: "Paralysée",
  retaliated: "A riposté",
  activated: "Déjà activée",
  ruleRef: "Règles : livret communautaire The Rewrite 2.0.1",
  ev: {
    roundStart: (n: number) => `Début du round ${n}`,
    activate: (u: string) => `Activation : ${u}`,
    skip: (u: string) => `${u} : paralysée, passe son tour`,
    move: (u: string) => `${u} : déplacement`,
    defend: (u: string) => `${u} : en défense`,
    modify: (side: string, stat: string, n: number) => `${side} joue une carte : +${n} ${stat}`,
    attack: (a: string, t: string, retaliation: boolean) => (retaliation ? `${a} riposte contre ${t}` : `${a} attaque ${t}`),
    dice: (rolls: string, att: number, def: number, dmg: number) => `dé ${rolls} → ${att} contre ${def} : ${dmg} dégâts`,
    flipped: (u: string) => `${u} : retournée sur sa face Few`,
    defeated: (u: string) => `${u} : unité vaincue`,
    retreat: "L'attaquant bat en retraite",
    effect: (side: string, source: string, unit: string) => `${side} joue ${source} sur ${unit}`,
    over: "Fin du combat",
  },
  statAttack: "Attaque",
  statDefense: "Défense",
  adv: advFr,
  cards: cardsFr,
  net: netFr,
  ai: aiFr,
};

const en: typeof fr = {
  appTitle: "Heroes",
  combatPrototype: "Combat prototype",
  language: "Français",
  newCombat: "New combat",
  attacker: "Attacker",
  defender: "Defender",
  faction: "Faction",
  neutralUnits: "Neutral units",
  mode: "Combat type",
  modePlayers: "Player versus player",
  modeNeutral: "Against neutral units",
  units: "Units",
  few: "Few",
  pack: "Pack",
  backline: "Back",
  frontline: "Front",
  maxUnits: "At most 5 units per side.",
  statCards: "Attack and Defense cards in hand",
  startCombat: "Start combat",
  round: "Round",
  initiativeOrder: "Initiative order",
  activeUnit: "Active unit",
  turnOf: "To play",
  defend: "Defend",
  endActivation: "End activation",
  hintActivation: "Click a highlighted space to move, or an outlined enemy to attack.",
  reaction: "Before the die roll",
  reactionHint: "Each player may play cards, then passes.",
  playAttack: "Play Attack (+1 Attack)",
  playDefense: "Play Defense (+1 Defense)",
  pass: "Pass",
  passed: "passed",
  cardsLeft: "cards left",
  roundEnd: "End of the combat round",
  roundEndHint: "Against neutrals, combat lasts one round. Continuing costs 1 movement point.",
  continueCombat: "Continue (1 MP)",
  retreat: "Retreat",
  victory: "Victory",
  wins: "wins the combat",
  retreated: "The attacker retreated.",
  draw: "No units left on either side.",
  log: "Log",
  penalty: "ranged penalty: 2 dice, the lower counts",
  preview: "Possible damage",
  damage: "damage",
  defending: "Defending",
  paralyzed: "Paralyzed",
  retaliated: "Has retaliated",
  activated: "Already activated",
  ruleRef: "Rules: community rule book The Rewrite 2.0.1",
  ev: {
    roundStart: (n) => `Round ${n} begins`,
    activate: (u) => `${u} activates`,
    skip: (u) => `${u} is paralyzed and skips its turn`,
    move: (u) => `${u} moves`,
    defend: (u) => `${u} defends`,
    modify: (side, stat, n) => `${side} plays a card: +${n} ${stat}`,
    attack: (a, t, retaliation) => (retaliation ? `${a} retaliates against ${t}` : `${a} attacks ${t}`),
    dice: (rolls, att, def, dmg) => `die ${rolls} → ${att} vs ${def}: ${dmg} damage`,
    flipped: (u) => `${u} flips to its Few side`,
    defeated: (u) => `${u} is defeated`,
    retreat: "The attacker retreats",
    effect: (side: string, source: string, unit: string) => `${side} plays ${source} on ${unit}`,
    over: "Combat over",
  },
  statAttack: "Attack",
  statDefense: "Defense",
  adv: advEn,
  cards: cardsEn,
  net: netEn,
  ai: aiEn,
};

export type Messages = typeof fr;
const dictionaries: Record<Lang, Messages> = { fr, en };

const I18nContext = createContext<{ t: Messages; lang: Lang; setLang: (l: Lang) => void } | null>(null);

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem("heroes-lang");
    if (saved === "fr" || saved === "en") return saved;
  } catch {
    // storage blocked: fall back to French
  }
  return "fr";
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem("heroes-lang", l);
    } catch {
      // ignore
    }
    document.documentElement.lang = l;
  };
  return <I18nContext.Provider value={{ t: dictionaries[lang], lang, setLang }}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n outside I18nProvider");
  return ctx;
}
