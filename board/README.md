# The local board

The page `npx arbiter review` serves, and `arbiter export` copies into a read-only folder. It's drawn from the project's own files, nothing is uploaded, and there's no sign-in.

It started as the team board's pages, ported from the site repo (`hosted/local`, site bff92c0, 4 Nov 2026). Since then it lives here, next to the code that serves it, and owns its look: the tokens, the type and the small parts are its own copies. Change them here and the team board isn't touched.

## What's here

| File | What it is |
|---|---|
| `main.tsx` | Loads the board from the CLI (`/api/board`), or from `window.__ARBITER_BOARD__` in an exported copy |
| `App.tsx` | The shell: top bar, rail, the phone chip row, the footer |
| `Overview.tsx`, `Toolbar.tsx` | Overview: every piece of work as a card or a row |
| `Areas.tsx` | Areas in the rail, with the folders you make: name, drag, reorder; saved in `.arbiter/areas.json` |
| `Change.tsx`, `Comments.tsx` | One change. Comments are read-only: the team writes them on the team board |
| `Review.tsx` | The Review inbox: List and Single, Undo |
| `Rules.tsx` | Design rules, with Copy, Edit and Remove on each rule |
| `Versions.tsx` | A change's earlier pictures: the version row, Compare (before and after), Before and Now in the inbox, and decisions grouped by version |
| `Preferences.tsx` | Preferences, live board only: check-ins, what gets recorded, rules and pictures; saved in `arbiter.json` (`src/settings.ts`) |
| `route.ts` | Pages in the hash (`#/`, `#/c/C-0001`, `#/rules`, `#/preferences`), so it works from a file on disk too |
| `api.ts` | The calls to the CLI's review server |
| `types.ts` | What the CLI sends. The shapes themselves are in `src/board-types.ts`, shared with the CLI |
| `components/`, `lib/board.ts` | The board's own copies of the parts it started with: type, buttons, badges, dropdowns, tooltips, the screenshot viewer, the area and state words |
| `globals.css`, `styles.css` | Tokens, dark mode, base type, and Geist from the fonts folder the CLI serves |
| `DESIGN.md` | The board's design notes |

Its design rules are in the CLI's `DECISIONS.md`.

## Building it

```
npm install --prefix board   # once: the board's build tools, apart from the CLI's
npm run build                # the CLI, then the board: type-checked, built into templates/board
```

Without the board's tools installed, `npm run build` builds the CLI and leaves `templates/board` as it is. The built files are committed, like the fonts, so a checkout runs without building the board.

The build is one old-style script and one stylesheet, not modules, so an exported copy still runs when its `index.html` is opened straight from disk.
