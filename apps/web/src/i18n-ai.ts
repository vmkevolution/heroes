/** Strings for computer players and the AI rules (p. 48–51), merged into the main dictionaries under `ai`. */
const CARDS_FR: Record<string, string> = {
  "attack-1": "Attaque",
  "attack-2": "Attaque",
  "defense-1": "Défense",
  "defense-2": "Défense",
  "spell-1": "Lancer un sort",
  "spell-2": "Lancer un sort",
  "skill-1": "Utiliser une compétence",
  "skill-2": "Utiliser une compétence",
};

export const aiFr = {
  seatKind: "Contrôle",
  kinds: { human: "Humain", computer: "Ordinateur", aiHero: "Héros IA (campagne)" } as Record<string, string>,
  kindHint:
    "Ordinateur : un adversaire qui joue comme un joueur. Héros IA : les règles d'IA des campagnes (p. 49-51), sans ville ni ressources, avec un paquet IA.",
  neutralAI: "Les unités neutres jouent seules (règles d'IA, p. 48)",
  neutralAIHint: "Sinon, en Escarmouche, l'adversaire suivant les contrôle (p. 41).",
  cardEv: (who: string, card: string, extra: string) => `${who} tire la carte IA « ${CARDS_FR[card] ?? card} »${extra}`,
  spellEv: (spell: string) => ` : sort ${spell}`,
  skillEv: (skill: string) => ` : compétence ${skill} (à appliquer à la main)`,
  aiTag: "IA",
};

export const aiEn: typeof aiFr = {
  seatKind: "Control",
  kinds: { human: "Human", computer: "Computer", aiHero: "AI Hero (campaign)" },
  kindHint:
    "Computer: an opponent playing like a player. AI Hero: the Campaign AI rules (p. 49–51), no Town or Resources, with an AI Deck.",
  neutralAI: "Neutral Units play by themselves (AI rules, p. 48)",
  neutralAIHint: "Otherwise, in a Clash, the next opponent controls them (p. 41).",
  cardEv: (who, card, extra) => `${who} draws the AI card “${card.replace(/-\d$/, "")}”${extra}`,
  spellEv: (spell) => `: Spell ${spell}`,
  skillEv: (skill) => `: Skill ${skill} (apply by hand)`,
  aiTag: "AI",
};
