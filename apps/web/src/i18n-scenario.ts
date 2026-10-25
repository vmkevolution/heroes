/** Strings for the Mission Book Scenarios, merged into the main dictionaries under `sc`. */
export const scFr = {
  scenario: "Scénario",
  sandbox: "Escarmouche libre (disposition « The Hunt », factions au choix)",
  kinds: { clash: "Affrontements", cooperative: "Coopératifs", campaign: "Campagnes" } as Record<string, string>,
  map: "Carte",
  seats: (n: number) => `${n} place${n > 1 ? "s" : ""}`,
  rounds: (n: number | null) => (n ? `${n} rounds` : "durée libre"),
  imposed: "imposée par la carte",
  read: "Lire le scénario",
  untranslated: "Une partie du texte n'est pas encore traduite dans le Mission Book et reste en anglais.",
  source: "Textes et cartes : Mission Book communautaire (CC BY-NC-SA).",
  manual:
    "Les règles propres au scénario (conditions de victoire, événements, règles additionnelles) s'appliquent à la main : le jeu affiche les textes et les événements du round.",
  panel: "Scénario",
  events: (r: number) => `Événements du round ${r}`,
  noEvents: "Aucun événement programmé ce round.",
  sections: "Texte du scénario",
  declare: "Déclarer la victoire",
  declareHint: "Si vous remplissez la condition de victoire du scénario : la partie s'arrête à la fin du round.",
  needsHuman: "Au moins une place doit être jouée par un humain.",
};

export const scEn: typeof scFr = {
  scenario: "Scenario",
  sandbox: "Free Clash (“The Hunt” layout, any Factions)",
  kinds: { clash: "Clashes", cooperative: "Cooperative", campaign: "Campaigns" },
  map: "Map",
  seats: (n) => `${n} seat${n > 1 ? "s" : ""}`,
  rounds: (n) => (n ? `${n} Rounds` : "no limit"),
  imposed: "set by the map",
  read: "Read the Scenario",
  untranslated: "",
  source: "Texts and maps: community Mission Book (CC BY-NC-SA).",
  manual:
    "Scenario-specific rules (victory conditions, events, additional rules) are applied by hand: the game shows the texts and the events of the Round.",
  panel: "Scenario",
  events: (r) => `Round ${r} events`,
  noEvents: "No timed event this Round.",
  sections: "Scenario text",
  declare: "Declare victory",
  declareHint: "If you meet the Scenario's victory condition: the game ends at the end of the Round.",
  needsHuman: "At least one seat must be played by a human.",
};

/** Strings for the full-screen Town Board, merged under `town`. */
export const townFr = {
  manage: "Gérer la ville",
  close: "Fermer",
  hint: "Un seul bâtiment par tour (jeton Construction, p. 30). Les habitations se construisent dans l'ordre bronze → argent → or.",
  built: "Construit",
  ready: "Constructible",
  needs: (b: string) => `Il faut d'abord : ${b}`,
  notYourTurn: "Seulement pendant votre tour",
  tokenUsed: "Déjà construit ce tour",
  missing: (r: string) => `Il manque ${r}`,
  unavailable: "Indisponible",
  groups: { main: "Bâtiments principaux", dwellings: "Habitations (recrutement)", special: "Bâtiments spéciaux", actions: "Recrutement et autres actions" },
};

export const townEn: typeof townFr = {
  manage: "Manage Town",
  close: "Close",
  hint: "One building per Turn (Build token, p. 30). Dwellings are built in order: bronze → silver → gold.",
  built: "Built",
  ready: "Can build",
  needs: (b) => `Needs first: ${b}`,
  notYourTurn: "Only during your Turn",
  tokenUsed: "Already built this Turn",
  missing: (r) => `Missing ${r}`,
  unavailable: "Unavailable",
  groups: { main: "Main buildings", dwellings: "Dwellings (recruiting)", special: "Special buildings", actions: "Recruiting and other actions" },
};
