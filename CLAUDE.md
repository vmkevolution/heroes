# Heroes — notes for contributors

Browser version of *Heroes of Might & Magic III: The Board Game*. Rules follow the community rule book "The Rewrite" 2.0.1; cite its page numbers in comments and tests (`p. 43`).

## Layout

- `packages/data`: Zod schemas and generated card data. `src/generated/units.json` is produced by `npm run import-wiki` from `vendor/homm3bg-wiki/`; never edit it by hand. Fix wiki typos in `UNIT_CORRECTIONS` in `scripts/import-wiki.ts`.
- `packages/engine`: pure rules engine. `apply*Action(state, action)` returns a new state (structuredClone, then mutate the draft). All randomness goes through the `RngState` inside the state so games replay from seed + actions. `state.phase` always says which decision the game waits for.
- `apps/web`: React 19 + Vite UI. Every user-facing string goes through `src/i18n.tsx` (French first, English second).

## Conventions

- Each rule gets a test, preferably reproducing the rule book's own example.
- UI language is French; code, comments and commit messages are English.
- The repo is private: card images and official names come from the published game. Keep official assets out of any future public repo.

## Commands

`npm test`, `npm run typecheck`, `npm run build`, `npm run dev`, `npm run import-wiki`.
