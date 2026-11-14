# Board design notes

How the board pages under `/p/` are built, so new pages read the same. The marketing page set the register; the board follows it.

> Copied from the site's hosted/DESIGN.md (site bff92c0, 4 Nov 2026), when the local board moved into the CLI. These are the local board's design notes now: they can change here without changing the team board's, and paths like `components/ui/type.tsx` mean `board/components/ui/type.tsx`.

## Type hierarchy

Hierarchy comes from **colour and size, not weight**. Three weights: regular for values, medium for one thing only — a decision's Change line — and semibold for titles. One exception, on Home only: its big numbers are light (300), so a tile reads as one calm figure (D-0033, recorded on the PC). Nothing is uppercase; nothing is letter-spaced. Use the primitives in `components/ui/type.tsx` rather than sizes by hand.

| Role | Primitive | Looks like |
|---|---|---|
| The page's one subject | `PageTitle` | 22px semibold, tight tracking, black |
| One sentence under it | `Lede` | 15px regular, grey |
| A section on the page | `SectionTitle` | 15px semibold tight; counts after it in regular grey (`count`), the least important bit fainter (`aside`) |
| The left column of a key/value | `Label` | 13px regular grey |
| The value | plain text | 14px regular black; a secondary value (a rejected option, a pattern) is grey |
| Who · when · where | `Meta` | 13px grey |
| An id — `D-0017`, `C-0004` | `Id` | 12px mono grey |
| The figure a Home tile is about | `BigNumber` | 48px light (300), tight, tabular; its unit (`h`, `fix`, `decisions`) 20px in the tile's quiet colour. Home only |
| The least important thing on a line | `Faint` | 12px faint |
| Category, status, verdict | `Badge` | Title case, always: `Interaction`, `Rule`, `Approved` |

Layouts: `KeyValues` (fixed label column, values beside) for decisions and property blocks; `PropertyRow` + `Property` for the inline row under a page title.

## Structure of a screen page

Breadcrumb → `PageTitle` → `Lede` (the reason, in quotes) → `PropertyRow` (Status · Area · Decided by · Date · Live) → the screenshot in its own tinted card → "Other options" chips → **Decided here** → **Comments** → footer.

**Versions.** A piece of work keeps its earlier pictures (the last ten, in `.arbiter/work/history/`). When it has had more than one, a row under the picture shows a small thumbnail for each, oldest first, the one showing outlined, named on hover with when it was taken; then "3 of 3" and Compare. Compare opens a before and after: two pictures one over the other, wiped by dragging across or with the slider under it, with Before and After picked at the top. Decided here then groups its decisions under the picture each led to, newest first: a heading per version, "Version 2" in semibold, when it was taken in muted, and "Show version" faint at the far right, the same on every version, in line with the decisions' counts. Every version gets its heading, with "No new decisions at this version." when it has none; decisions since the last picture come first, under "Since the last picture". Decisions count by date. No timeline rail. A change with one picture looks as it always did. In the Review inbox, a decision whose change was pictured again after it was queued shows Before beside Now, with Compare.

On the live board a "⋯" sits at the right of the title, the toolbar's height, as on Design rules, each item with an icon: Rename (a piece of work only), Merge into… (a piece of work, when there's another: for work started under a new name that continues an existing change; pick the change, and its decisions, pictures and comments join it), Review what's waiting (with its count, when something is), Copy name, and Copy the picture command (when it has no picture). Rename opens a dialog with two fields, Area (one of the areas there, or a new one) and Title, and shows the name it will save as, "Area — Title", so nobody types the dash. Its decisions, picture, waiting items and comments move with it, the agent hears the new name, and the page moves to its new address. A name another change already has is refused, with why, in red.

On the live board each decision has the actions a rule has on Design rules, faint on hover or focus under its values: Copy (the whole decision as it reads, id first), Edit, Make it a rule (a decision only confirmed) and Remove. On a rule in force, Edit and Remove are Design rules' own (new words for the rule; retired, with why); on any other decision, Edit changes its Change line and Remove takes it out of the record. Old words stay on the record. A removal stays in place, faded, with Undo while the page is open; removing a change's only decision takes the change off the board and back to the Overview. Making it a rule checks the rules there; on an overlap a dialog shows this one first, then the rules it overlaps together in one box under a Your rule label, each with why ("Both apply to plan cards"; a file by its change's name, "Both apply to Old review page"; or "Similar words: …" for a guess) and its own Replace, then Cancel or Keep both. When DECISIONS.md is full, a second dialog of the same shape lists every rule there, each with Replace, then Cancel or Raise the limit (to Preferences). In the Review inbox, Make it a rule asks with the same dialogs (`RuleDialogs.tsx`), plus one more when the code no longer matches what it says: the files in plain words ("app.css still has “#fff”, on line 1"), then Cancel or Make it a rule anyway, which records it marked Unverified. Remove confirms in a dialog too, a rule asking why. A rule since retired reads Retired.

A decision is: `Id` + dimension `Badge` + verdict `Badge`, "n of N" faint at the right, then `KeyValues` in this order — Change (medium), Rule or Pattern, Rejected, Applies to. Same order and words as the widget in Claude Code. Discussion on a decision is indented under it with a rail and a comment glyph. The ways to add to it ("Comment on this", or "Reply" once there's a thread, and "Request change") show only on hover or keyboard focus, thread or no thread: the discussion stays in view, the actions don't. One comment sits inline; two or more fold to one row — chevron, count, who spoke last, when — until opened, so a screen with talk on every decision still reads as a list of decisions.

Lists of like things are divided by hairlines, not boxed in cards. Cards are for things that are clickable as a whole (a screen on the board).

## Words

The board speaks design, not Arbiter. It's a set of **changes**, not screens — a font swap is a change with no screen. The record keeps its own words (`generated`, `superseded`, `recorded`, `rule`, piece of work); only the board translates them:

| Record | Board |
|---|---|
| All screens | **Overview** · "12 changes" |
| Section | **Area** |
| Directions for a feature | **Options** |
| `generated` · `superseded` · `recorded` | **Draft** · **Replaced** · **Decided** |
| Rule · Standing rules | **Rule** · **Design rules** (how designers say it; was Guideline · Guidelines) |

## Plain changes and areas

Most decisions come from one direction, iterated, not options compared. They still publish: one card per piece of work (`W-…`, state `Decided`), named for what was being built. Its page has no "Other options" — title, properties, the screenshot if one was taken, Decided here, Comments.

Every card sits in an **area** (`areasFor` in `lib/board.ts`). A set of options has the feature it was explored for. A plain change takes its area from its name — "Settings — billing" is Settings; "Reports filters" is Reports when Reports is an area on the board. A change where every decision applies everywhere is **Foundations** (type, colour, spacing, voice). Anything else is an area of its own, by its name. There's no catch-all.

## The other pages

**Design rules** is the same list shape, grouped by dimension, under a subline that says where they live: "8 rules you've saved in DECISIONS.md. Everything new follows them." Under it, the Overview's filter bar: Type (all seven types, each with how many rules it has, 0 included) and search over a rule, its reason and its id, both kept in the address. `Id` in the label column, the rule beside it in fg, its reason under in muted. No cards — nothing here is clickable as a whole. A rule decided on a screen of this board says so under its reason (`Meta`: "Decided on …"), and each row is an anchor: the `rule` badge on a screen page points at it, and the id goes fg when it's the target. Copy on a rule gives what Copy on its change's page gives: the whole decision, id first.

**Home** is the board's first page; see Home below.

**Overview** shows each change as a card (clickable as a whole) or, in list view, as a bordered row. On a card: the area in `Faint` above the name, only when the card isn't under its area's heading; the name semibold tight, up to two lines, without the area; then one description in regular muted, up to two lines, the first the card's width and the last stopping about two words short of the edge, the same one a row shows: the reason in quotes (never italic), else what changed first; then, under it, one line: a pill and the counts as icons and numbers. The pill shows only when it says something: what's waiting for you, as the Review inbox's tray and a count in the Waiting colour (`info` blue on the grey pill), and an option's state in words (Approved, Draft, Replaced; Rejected and Replaced are grey, since they're history). Decided work, the usual case, has none. Decided is the same kind of pill, a tick in a box and a count, in `ok` green: to do in blue, done in green, side by side. Comments and open requests are plain icons and numbers with the thread's own glyphs. Each is named on hover and to a screen reader, and whatever a change hasn't got takes no room (D-0032). At the far right of that line, in `Faint`, when it last changed: its latest decision, judged or waiting, as Today, Yesterday, 3 days ago, then a date; the exact time on hover. A row (list view) is the name with one line of what changed under it; on the right, the pill and the counts side by side, and under them in `Faint` the area and when it last changed. No author and no time of day: on the local board it's always you. On a phone the right-hand side moves under the description. Empty states and notices use a semibold title and a muted sentence, nothing heavier. On the Overview itself (not inside an area or a folder), a banner above the title says how many decisions wait for you, with the inbox's tray in the Waiting blue before the count, and Review them on the right.

**Review inbox** groups what's waiting by the piece of work it came from, each group under its name and count, its actions behind a row "⋯". A decision is a bordered card in the board's decision shape: top line `Id`, its size (Feature, Pattern) as a badge in `info` blue and its type as a grey one, when it was queued in `Faint` at the right; then Change in medium and the rest as `KeyValues`; then Confirm (filled), Make it a rule, Skip and Fix. Nothing in a card is red. A clash with a rule says so in `warn`. In Compact a card closes to its top line and Change, and opens like any expander.

**Preferences** (live board only, last in the rail with a sliders icon, on its own) uses the Design rules shape: a title, a subline saying the settings live in arbiter.json, then groups under section titles, each with a line on what it covers. A hairline sits above each group, the first included; the settings inside a group aren't ruled. A row is the setting's name on the left (14px, fg) and its control on the right, with what it does under it in muted. A choice of a few is a segmented control, the toolbar's height, the chosen one tinted; on or off is a switch with its words beside it. Each saves as you change it and "Saved" shows briefly at the top right; a refused value says why in red under its field and goes back. The review question isn't a preference: it comes at every 5 waiting (D-0005), so its row's words say so instead. An exported copy has no Preferences.

The left rail carries hierarchy by colour alone: group labels faint, items muted, the current one fg on a tint with a rail mark. No weight change on selection. Home is first, above Overview, with a house icon. Counts on the right are faint, the Review inbox's too. A folded group with the current page inside shows a small fg dot.

**Folders** sit under Areas: you make them ("⋯" on the Areas heading: New folder, Sort A to Z), name them in place, and drag areas into them or rows up and down. A folder holds areas by name, one level deep, with no folder inside a folder; its row has a chevron to open it and its total count. Each row's "⋯" (on hover or focus) does what a drag does, for the keyboard: Move to, Move up, Move down, and on a folder Rename and Remove folder, which puts its areas back. A drag shows where it lands as a line above or below a row, or a tint on the folder it goes into. Clicking a folder shows its areas on the Overview, each under its own heading. They're saved in `.arbiter/areas.json`, so the project carries them; an exported copy shows them and nothing more.

## Home

The board opens here: a heading, one line under it, a grid of tiles, then Latest updates. Tiles, their grain, the big light numbers, the charts and the motion are **Home only**; every other page keeps the hairline lists and cards above.

**Heading.** `PageTitle` "Let's get building, Eddie" (the name the record has for you, from its latest change; none if it has none), then a `Lede` (15px, as everywhere): "Your build summary and the latest updates in this project." No date: the tiles carry the numbers.

**Tiles** (`components/ui/tile.tsx`). A grid of 160px squares, five across with 16px gaps; a tile spans one or two columns and rows. 22px corners, 16px inside, no border, a light grain over its colour (`tile-grain` in globals.css). Three colours: grey (`surface-2`, the usual), black (`fg`, light in dark mode, as it inverts), and red (`brand`) for **Waiting for you** alone, the one big red fill on the board. A tile is the title at the top left in 12px, anything quiet at the top right, and at the bottom the big number with a 12px line under it. Quiet text is `muted` on grey, `faint` on black and white on red. A tile's title names it on hover or focus with the black tooltip, saying what the tile shows. A tile that goes somewhere (Waiting for you) presses in slightly and its arrow nudges right on hover; one that opens a panel says what opens in its own line, as an expander.

| Tile | Shows | From |
|---|---|---|
| Waiting for you (red) | How many decisions wait, the tray, "Review now →" | the review queue |
| Recently decided (black, two wide) | The latest eight changes by their latest judged decision, three in view, scrolling a row at a time, with dots for where you are. A row opens its change | the record |
| Working on | The change the agent recorded most recently and how many decisions it has; a breathing dot while it's within the last half hour, and "Last worked on" when it wasn't today. Not how long you've been on it: that needs the agent's chat files, which the board doesn't read | the record |
| Type (black) | Design rules by type as a shape, a corner for each of the seven types, the thinnest in red; under it the gaps ("Gap: motion", or "Gaps in 3 types" past two). Hover a corner for its count and share | DECISIONS.md |
| This week (two wide) | "+11 changes" this week and a column of dots per day, today in red; ‹ › step back through weeks to where the record starts. Open it for a day's changes, with how many decisions and rules each had | the record |
| Not committed | Lines added (new files' lines included), then removed and files, on this branch, read every ten seconds while the tab is in view; the branch opens a menu of the repo's other worktrees. "All committed" when there's nothing; no tile outside a git repository | git |
| Design rules (black, two wide) | Meant to show when your rules did the work and when you fixed a miss. Fixes aren't recorded yet, so it shows an empty state, not example numbers | not recorded yet |

**First load**, before anything is recorded: the same grid, every tile in its own quiet empty state, so the page keeps its shape and nothing jumps when the first decision lands. Waiting for you is grey at 0 with "Nothing yet" (later, with nothing waiting, "All caught up"), and no arrow; Recently decided says "Nothing decided yet"; Working on is a quiet dash and "Nothing yet"; Type draws its rings alone, "No design rules yet"; This week is 0, "No changes"; Not committed shows git as usual; Design rules as always. The heading has no name yet. Where Latest updates will be, **Get started**: three list rows with the step's number in the round icon (in fg), not links — "Build something with your agent", "Review them here", "Rules keep it consistent" — each with a line under it that wraps rather than cuts short.

**Charts** are drawn in the tile's own ink: `currentColor` at reduced opacity for the quiet parts, full for the one being read, and the accent red only for the one mark that needs you (today, a gap, a fix). Data dots are 5px. Hovering a part brightens it and dims the rest; the tile's own lines change to say what it is, softly, without a tooltip.

**Motion**, Home only, and all of it off with reduced motion: the heading rises in; tiles settle in reading order, 45ms apart; numbers count up once; charts draw once their tile has landed; Latest updates rise in row by row; a panel opens from under its tile, the tile's corners kept, with the expander's curve (250ms, `--ease-out`).

**Latest updates**, under the tiles with room above, is this week's record newest first, grouped by day ("Today", "Yesterday", the weekday this week, then "Thursday 15 Oct", in `Faint`), as list rows (below), with "This week" at the right, or "Since 14 Oct" when they go back further. One row each: a decision waiting for you (its icon and "Review →" on the right in the Waiting blue), a new rule, a one-off against a rule, or what was decided on a change, several on one change in a day folded into one row ("2 decisions on Card status"). At most twenty: eight show, and "Show 12 more" opens the rest. A dot marks what's new since you last opened Home.

## Accent red

The brand red (`brand`, `#D71921`; `#E5242C` in dark mode, so a small mark still reads on black) is a secondary colour, used sparingly, and **on Home only**. There it means this needs you, as a small mark — a dot, a count, an icon — never a heading or a paragraph. Where it's allowed, and nowhere else:

- the Waiting for you tile, the one red fill;
- today's day on This week, and a day you point at or open there;
- the thinnest corner on Type, the dot by Not committed when there are edits, and a fix under the line on Design rules once fixes are recorded.

Everywhere else, what's waiting for you is `info` blue, as it was: the Waiting pill, the tray and count on a card's or row's pill, the Overview banner's tray, the Status filter's Waiting, and a waiting row in Home's Latest updates. (Tried in red on 14 Nov 2026 and put back.) The Review inbox's size badges (Feature, Pattern) are blue too. Errors (a refused value, a failed save) stay `bad`. History isn't red: Rejected and Replaced are grey.

## List rows

A list of things that happened (Latest updates on Home) is hairline-divided rows, each with a round icon for its kind: a 28px `surface-2` circle with a 14px icon in muted (the waiting one in `info` blue, a new rule in fg). Beside it what happened in 14px fg, one line, cut short, and under it where, in 12px muted ("Card status · Overview page"). On the right in `Faint` the time, and a 6px fg dot first when it's new. The hairline starts after the icon. A row that opens something underlines its words on hover, as every row on the board does; it doesn't tint or move.

## Expanders

Something that opens in place says what opens in its own words, then a 12px ⌄ that flips while it's open: "changes ⌄", "Show 4 more ⌄" (then "Show less"). The whole thing is the button, muted, fg on hover. What it opens grows under it; on Home it grows with the curve above, elsewhere it simply appears. A tree's folders (Areas, folders in the side nav) and a folded thread keep their › that turns down: those are places in a tree, not more of the same list.

## Icons

One set of line icons, drawn in the text colour, round caps and joins, sized by use:

| Use | Size | Drawn on | Stroke |
|---|---|---|---|
| Menu items, the side nav | 14px | a 14px grid | 1.4–1.5 |
| Tile icons on Home | 16px | a 16px grid | 1.3 |
| A list row's round icon | 14px in a 28px circle | a 16px grid | 1.3 |
| Top bar (refresh, help, theme) | 16px | a 24px grid | 2.25 |
| Arrows and chevrons | 12px | a 12px or 16px grid | 1.5 |

The same thing has the same icon everywhere: the tray is what's waiting, a tick in a box is decided, a shield is a rule. They live in `components/ui/icons.tsx`: `Icon` for menus, `Kind` for Home, `Small` for arrows and chevrons.

## Menus and icon buttons

Every "⋯" menu reads the same: each item has a 14px icon left of its words, from one set (`components/ui/icons.tsx`), muted until the item is highlighted, and a count on the right when there is one. A page's own "⋯" (Design rules, the Review inbox's Confirm or skip all, a change's page) is the bar's height with its outline (`barDots`) and names itself on hover; a row's "⋯" (an inbox group, the side nav) is 28px or smaller and quiet until hovered. Everything that says something on hover (an icon-only button's name, a count pill's words, a date's exact time, a full name cut short) uses the board's black tooltip (`components/ui/tooltip.tsx`), never the browser's `title`. It sits above dialogs, so it shows in the picture viewer too. Empty states are one size: a semibold title and a muted sentence, in a dashed box `py-16` when the page has nothing at all, without the box when a filter left nothing.

## Dates

One way everywhere, through `components/When.tsx`: Today, Yesterday, 3 days ago, then the date as "4 Nov" (with the year only when it isn't this one). A change's own page adds the time of day ("2 Nov, 5:39 pm"); lists show the day alone. Times are in the viewer's own clock, the same as "Updated" in the top bar. The whole date and time show on hover. "As of" a date shows only on a read-only copy, as "as of 11 Nov 2026"; the local board is always as of now.

## Surfaces and colour

`bg` for the page, `surface` for cards and the rail, `surface-2` for tinted panels (the screenshot frame, hover states, grey tiles). Colour only when it carries meaning: `ok` for approved, decided and rules, `warn` for in review, corrections and clashes, `info` blue for what's waiting for you and a decision's size in the Review inbox, `brand` (the accent red, above) on Home only, `bad` for errors. Rejected and Replaced are grey. Dark mode inverts through the same tokens; never hard-code a colour.

## Names and casing

Names are capitalised for display even when the record has them lowercase. Ids stay mono. Section names are shown as recorded.
