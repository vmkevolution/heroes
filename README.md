# Heroes

Version web (navigateur) du jeu de plateau *Heroes of Might & Magic III: The Board Game*, pour jouer entre amis.

Projet privé. Les règles suivent le livret communautaire « The Rewrite » 2.0.1.

## Lancer le jeu

Il faut [Node.js](https://nodejs.org/) 20 ou plus récent.

```bash
npm install
npm run dev      # ouvre le jeu sur http://localhost:5173
npm test         # tests des règles
npm run build    # version statique dans apps/web/dist
```

## État actuel

- Prototype de combat jouable à deux sur le même écran (hotseat) : joueur contre joueur, ou contre des unités neutres.
- Les 94 cartes d'unités (263 faces) sont importées du wiki communautaire, avec leurs images.

## Organisation

| Dossier | Rôle |
| --- | --- |
| `packages/data` | Données de jeu validées (unités, plus tard héros, sorts, artefacts…) |
| `packages/engine` | Moteur de règles pur et déterministe, sans interface |
| `apps/web` | Interface React (Vite) |
| `vendor/homm3bg-wiki` | Copie des fiches du wiki communautaire, source des données |
