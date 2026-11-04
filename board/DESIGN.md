# Board design notes

How the board pages under `/p/` are built, so new pages read the same. The marketing page set the register; the board follows it.

> Copied from the site's hosted/DESIGN.md (site bff92c0, 4 Nov 2026), when the local board moved into the CLI. These are the local board's design notes now: they can change here without changing the team board's, and paths like `components/ui/type.tsx` mean `board/components/ui/type.tsx`.

## Type hierarchy

Hierarchy comes from **colour and size, not weight**. Three weights: regular for values, medium for one thing only — a decision's Change line — and semibold for titles. Nothing is uppercase; nothing is letter-spaced. Use the primitives in `components/ui/type.tsx` rather than sizes by hand.

| Role | Primitive | Looks like |
|---|---|---|
| The page's one subject | `PageTitle` | 22px semibold, tight tracking, black |
| One sentence under it | `Lede` | 15px regular, grey |
| A section on the page | `SectionTitle` | 15px semibold tight; counts after it in regular grey (`count`), the least important bit fainter (`aside`) |
| The left column of a key/value | `Label` | 13px regular grey |
| The value | plain text | 14px regular black; a secondary value (a rejected option, a pattern) is grey |
| Who · when · where | `Meta` | 13px grey |
| An id — `D-0017`, `C-0004` | `Id` | 12px mono grey |
| The least important thing on a line | `Faint` | 12px faint |
| Category, status, verdict | `Badge` | Title case, always: `Interaction`, `Rule`, `Approved` |

Layouts: `KeyValues` (fixed label column, values beside) for decisions and property blocks; `PropertyRow` + `Property` for the inline row under a page title.

## Structure of a screen page

Breadcrumb → `PageTitle` → `Lede` (the reason, in quotes) → `PropertyRow` (Status · Area · Decided by · Date · Live) → the screenshot in its own tinted card → "Other options" chips → **Decided here** → **Comments** → footer.

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

**Design rules** is the same list shape, grouped by dimension, under a subline that says where they live: "8 rules you've saved in DECISIONS.md. Everything new follows them." `Id` in the label column, the rule beside it in fg, its reason under in muted. No cards — nothing here is clickable as a whole. A rule decided on a screen of this board says so under its reason (`Meta`: "Decided on …"), and each row is an anchor: the `rule` badge on a screen page points at it, and the id goes fg when it's the target.

**Overview** shows each change as a card (clickable as a whole) or, in list view, as a bordered row. Name semibold tight, state `Badge`, the reason in quotes — regular muted, never italic — then counts in `Meta`. Empty states and notices use a semibold title and a muted sentence, nothing heavier.

The left rail carries hierarchy by colour alone: group labels faint, items muted, the current one fg on a tint with a rail mark. No weight change on selection.

## Surfaces and colour

`bg` for the page, `surface` for cards and the rail, `surface-2` for tinted panels (the screenshot frame, hover states). Colour only when it carries meaning: `ok` for approved and rules, `bad` for rejected and superseded, `warn` for in review and corrections. Dark mode inverts through the same tokens; never hard-code a colour.

## Names and casing

Names are capitalised for display even when the record has them lowercase. Ids stay mono. Section names are shown as recorded.
