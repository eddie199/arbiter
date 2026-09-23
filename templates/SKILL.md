---
name: arbiter
description: Record design decisions made during UI work so they never have to be re-made. Use after building or changing any UI, and whenever the user says "record that", "make that a rule", "reject that", "going with X instead", or similar.
---

# Arbiter

`DECISIONS.md` holds the design calls this project has already made — what was chosen, what was rejected, and why. Your job is to apply them, and to capture new ones as they happen, without asking the user to write anything.

## Before UI work

If `DECISIONS.md` exists, read it before building or changing any component, screen, or style. Treat every entry as settled. Do not re-decide, do not ask about, and do not deviate from an active rule unless the user explicitly asks you to. Do not try the alternatives it lists as rejected.

## After UI work — queue, don't interrupt

Design work is iterative. A screen redesigned six times is one piece of work, not six. Never surface decisions mid-iteration.

**While the user is iterating on the same thing: say nothing about decisions.** Keep a private running list. Each version they moved past becomes a rejected alternative on the version that replaced it — note why it lost, in their words if they gave a reason.

**When the work settles** — they move to a different screen or component, say "good" / "ship it" / "done" / "next", or the session is clearly wrapping up — write each queued decision to the pending file, silently:

```
npx arbiter record --pending '<json>'
```

(JSON shape below). The output carries `checkin`, the user's answer from their first `/arbiter`:

- `feature` (default) — **only if the piece of work included a `feature`-level decision**, add one line to your reply carrying its Change line, not a count. At most once per session.
- `quiet` — say nothing. Ever. They run `/arbiter` when they want it.
- `every` — one line each time a piece of work settles and you queue, whatever its level.

The line, when there is one:

```
Queued: Settings is now a tab-row shell with four routes under it (+2 pattern, +4 polish) — /arbiter when you're ready.
```

A count on every reply gets ignored; a sentence about what changed, only after something big, gets read. After the line, queue silently — the user knows the queue exists. If the work was only patterns and polish, say nothing. Never phrase it as a question ("should we run arbiter?") — it's a statement of what was queued, and the user decides when. Do not show the widget. Do not list the decisions. The queue lives in `.arbiter/pending.md`, so it survives the session; the user can judge it here, in the review page, or never.

The output may also carry `update` — this skill file was written by an older Arbiter than the one installed (`update.skill` vs `update.cli`), so the protocol you're following is behind. Once per session, add one line, whatever `checkin` says:

```
Arbiter's skill file is from 0.1.2 (the CLI is 0.1.3) — say "update arbiter" and I'll refresh it.
```

Never run it unasked. When they say yes — or say *"update arbiter"* unprompted — run the command `update.command` names and relay what it prints. It leaves `DECISIONS.md`, the archive and the settings alone.

## The first `/arbiter` — intro, then the queue

The queue JSON carries `firstRun: true` until the project has been through this once. When it does, before anything else, say this — verbatim, it's been written for the reader:

> **Arbiter's on.** While I build UI, I record the design decisions I make — what changed, the rule behind it, what was rejected — so nothing gets re-decided and your team can see why things are the way they are.
>
> **How it works**
> 1. You build as usual. I say nothing about decisions until a piece of work settles — then one line.
> 2. `/arbiter` shows what's queued. For each: **Confirm**, **Make it a rule**, or **Skip**. Rules go into `DECISIONS.md`, and I read them before touching UI.
> 3. When you want the team to see it, say **publish** — I'll give you a link to a board they can read and comment on.
>
> **Commands**
> - `/arbiter` — review what's queued
> - **publish** — say it, get the board link
> - **"record that"** / **"make that a rule"** — mid-chat, recorded, no questions

Then one question, with the selection widget (text fallback: the same three lines, numbered):

- **header** — `While you work`
- **question** — `When should Arbiter check in about decisions?`
- **options** —
  - `A line after big work` (Recommended) — *When a feature-sized piece settles, one sentence saying what was queued. Never mid-iteration, at most once a session.*
  - `Nothing until I ask` — *Queued silently. /arbiter whenever you want to see it.*
  - `A line after everything` — *One sentence every time a piece of work settles, big or small.*

Record the answer — Skip means the recommended one:

```
npx arbiter setup --checkin feature     # A line after big work
npx arbiter setup --checkin quiet       # Nothing until I ask
npx arbiter setup --checkin every       # A line after everything
```

That also marks the project as onboarded. Then continue with the queue as below; if it's empty, one line: `Nothing queued yet — build something.`

**When they ask** — `/arbiter`, "let's review", "what did you decide" — read the queue with `npx arbiter rules --pending --json`. It comes back grouped by piece of work (`groups[].trigger`), feature and pattern items in `items`, polish in `polish`. Present the feature and pattern items (below); polish is never presented individually. Judge each answer with:

```
npx arbiter record P-0003 --as accept      # Confirm
npx arbiter record P-0003 --as rule        # Make it a rule
npx arbiter record P-0003 --as skip        # typed "skip" in Other
npx arbiter record P-0003 --as fix --to "<what they typed>"
```

Bulk answers are one command, not a loop:

```
npx arbiter record --all --as accept --level polish                  # "confirm all polish"
npx arbiter record --all --as accept                                 # "confirm all"
npx arbiter record --all --as rule --level pattern                   # "rule the patterns…"
npx arbiter record --all --as accept --level feature                 # "…confirm the rest"
npx arbiter record --all --as accept --trigger "Settings build"      # one piece of work
```

`--as rule` can exit `2` (overlap) — follow the overlap flow below and re-run with `--supersedes` or `--keep-both`. In a bulk run an overlap shows up under `failed`; handle those one at a time afterwards.

### What counts as a decision

A point where a reasonable alternative existed and you picked one, that was **not** dictated by the request and **not** already covered by `DECISIONS.md`. Look along these dimensions:

| Dimension | What to look for |
|---|---|
| `structure` | Layout, hierarchy, grouping, what's above the fold, tabs vs. scroll |
| `interaction` | Pattern choice — modal / sheet / inline, hover / click, confirm flows |
| `states` | Empty, loading, error, success — what was shown and what was skipped |
| `content` | Labels, tone, button verbs, error copy, headings |
| `visual` | Tokens, spacing, type scale, colour, radii |
| `motion` | Transitions, durations, what animates and what doesn't |
| `access` | Focus order, contrast, hit targets, announcements |

For each decision, note what it was chosen **over**. Rejected alternatives come from three places:

1. **Iterations in this session.** The user asked for a sheet, looked at it, then asked for a modal. The sheet is rejected, and you saw why.
2. **Options you weighed and didn't build.** You considered tabs, went with a single page. Tabs are rejected, with your reason.
3. **Corrections.** Whatever you did that the user then changed is rejected; what they asked for is the decision.

Skip mechanical necessities (imports, prop plumbing, file placement) and anything the user told you to do.

**Size every decision.** A 7px height fix and a new settings architecture are not the same kind of call, and the review must not treat them the same. Set `level`:

| Level | What it is | Examples | Review behaviour |
|---|---|---|---|
| `feature` | A new surface, flow, or structure | Settings shell with four routes; a second card on Audit; a stage-aware back link | Always presented |
| `pattern` | A reusable call that could apply elsewhere | Icon-only buttons on half-width cards; "Status" not "Health"; save buttons bottom-right | Presented; "make it a rule" is the likely answer |
| `polish` | A one-off fix to one screen | Match heights at `h-9`; drop a chevron; remove a pill | **Never presented.** Queued, then logged automatically when the group is reviewed |

Polish still gets queued — it's part of the record — but the user never gets a question about it; they see "+6 polish logged" in the summary. Rules only ever come from `feature` or `pattern`. When unsure between `pattern` and `polish`, ask: would this apply on a screen that doesn't exist yet? If yes, `pattern`. There's no cap on polish; keep feature + pattern to seven per piece of work.

### Present with the selection widget

Only when asked (see above). If you have a question tool that presents options (in Claude Code, `AskUserQuestion`), use it. Up to four questions per call, in queue order; the heading inside each question names its piece of work, so a call may span more than one. Before the call, one line: `Queued across 2 pieces of work — Rescan button (1), Settings (2) · +5 polish logged`.

Each question:

- **header** — the dimension, Title case: `Structure`, `Interaction`, `States`, `Content`, `Visual`
- **question** — a heading line, a blank line, then four labelled lines:

  ```
  Rescan button · 1 of 1

  Change — The Rescan button on the small Health check card is now just an icon
  Pattern — Half-width cards use icon-only action buttons with aria-label and title
  Rejected — Full-label button: wrapped to a second row on mobile
  Applies to — Compact card actions, anywhere
  ```

  - The heading is **the thing the user was working on, at the grain they worked at** — `Rescan button`, `Delete flow`, `Settings`, `Billing page`. Say it the way they'd say it. It's the `trigger`. Then `n of N` within that piece of work.
  - `Change` is what happened, as a PM would say it. `Pattern` is the rule-shaped sentence (`decision`). `Rejected` is each alternative with why it lost, `·`-separated if more than one; omit the line if nothing was rejected. `Applies to` is the scope in words: a file name, `<Pattern name>, anywhere`, or `Everywhere`.
- **options**, always these two, in this order:
  - `Confirm` — *Saved to the decision log.*
  - `Make it a rule` — *Kept in DECISIONS.md, referenced in future sessions.*
- The built-in **Other** box is the correction path. If the user types there, treat it as a fix: what they typed is the decision, what you did is rejected. If they type `skip`, drop the item.
- The widget's own **Skip** button means "not now" — everything stays in the queue. Don't add a Skip option.

### Fallback: present as text

If no selection widget is available, use exactly this shape — grouped by piece of work, three labelled lines per item, Change first:

```
Audit page — 3 decisions, +2 polish

1. Change:   The Audit page now has a second card, Health check, beside the score   [feature]
   Pattern:  Audit shows score and health as two half-width cards
   Rejected: single wide card — health got buried under the score chart
2. Change:   The Rescan button on the small Health check card is now just an icon   [pattern]
   Pattern:  Half-width cards use icon-only action buttons
   Rejected: full-label button — wrapped to a second row at phone width
3. Change:   The health card says Status, not Health   [pattern]
   Pattern:  Card headings name the thing shown, not the concept

Settings build — 2 decisions, +4 polish

4. Change:   Settings is now a tab-row shell with four routes under it   [feature]
   …

Applied from DECISIONS.md: D-0003, D-0008

Reply per number — confirm · rule · skip · or type what it should be
or in bulk — "confirm all" · "confirm all polish" · "rule the patterns, confirm the rest"
```

Omit the `Rejected` line when there's nothing rejected. Omit the `Applied from` line if no active rules were used. Never ask an open question — present what was decided and ask for a selection. Map bulk replies to `record --all` (above). Items they don't address are skipped. Polish isn't listed; it's logged with the group unless they say "skip polish".

## Reading the answer

| User picked | `--as` | What you do |
|---|---|---|
| Confirm | `accept` | Judge it. Logged in the archive. |
| Make it a rule | `rule` | Judge it. It enters `DECISIONS.md`. |
| Other: `skip` (or "not a decision") | `skip` | Dropped from the queue, recorded nowhere. |
| Other: a correction | `fix --to "…"` | Change the code to match, then judge it. What you did becomes a rejected alternative automatically. |
| Widget Skip button | — | Nothing. The queue waits. |

Never judge anything before the user answers.

## The JSON shape

Used by `record --pending` (queue) and `record` (record now):

```json
{
  "change":    "The Rescan button on the small Health check card is now just an icon",
  "decision":  "Half-width cards use icon-only action buttons",
  "rationale": "A labelled button wrapped under the text on mobile",
  "rejected":  ["Full-label button — wrapped to a second row at phone width"],
  "level":     "pattern",
  "trigger":   "Audit page",
  "scope":     "pattern:compact-card-actions",
  "dimension": "interaction",
  "class":     "judgment"
}
```

Two sentences, two jobs. **Write `change` as what a PM would say happened** — concrete, past tense, names the thing on the screen. **Write `decision` as the rule someone could follow** — general, present tense. The user judges from `change`; future sessions obey `decision`. Never cram both into one line.

`verdict` is omitted when queueing (`--pending`); include it (`accept | rule | fix`) only when recording directly.

For **mechanical** decisions, add evidence so Arbiter can check the claim against the files you wrote:

```json
  "files":  ["src/components/Button.tsx"],
  "expect": { "present": ["brand-500"], "absent": ["#3B7BE0"] }
```

`present` strings must appear in at least one of the files; `absent` strings in none. Write `regex:<pattern>` for a pattern (`regex:#[0-9a-fA-F]{6}\b` = any hex colour). Arbiter reads only those files. If they contradict the claim, `record` exits `4` and writes nothing — fix the code, or correct the claim. Never pass `--unverified` without telling the user the claim didn't check out.

If the work belongs to a candidate (below), add `"candidate": "C-0001"` or pass `--candidate C-0001`.

If the session mentioned a ticket — a Linear or Jira key like `ENG-123`, a GitHub issue, a pasted tracker link — add `"ref": "<url or key>"` or pass `--ref`. It's how the board links each decision to the work it came from. Never ask for one; leave it out when nothing was mentioned. `--ref` on a bulk `--all` stamps every item.

- `change` — what happened, in plain words. One line. Required. This is what the person judging reads.
- `decision` — the same call as a rule someone could follow. Present tense. One line. This is what future sessions read. For `polish` it can repeat `change`.
- `level` — `feature | pattern | polish` (table above). Default is `pattern`; set it every time.
- `trigger` — the thing the user was working on, named the way they'd say it, at the grain they worked at: `Rescan button`, `Delete flow`, `Settings`, `Billing page`. Every decision from the same piece of work gets the **same** trigger — it's the grouping key and the heading they see.
- `rationale` — why it won. One line. Required.
- `rejected` — each alternative as `<option> — <why it lost>`. One line each. Empty array if there were none.
- `scope` — `pattern:<kebab-name>` for a recurring UI pattern (`destructive-confirm`, `empty-state`, `sheet-actions`) — this is the usual case. `file:<path>` only when it's genuinely about one screen. `global` when it applies everywhere.
- `dimension` — one of the seven above.
- `class` — `mechanical` if it could be checked against a token or lint rule (colours, spacing, type scale, radii); `judgment` otherwise. Most rules are judgment.
- `files` / `expect` — mechanical only. Name the files you touched and the literal strings that prove the claim.
- `paths` — mechanical rules only: where the rule applies, as directories or files (`["app/components", "app/(marketing)"]`). Sweep scans only these. A `pattern:` rule with no `paths` sweeps the whole project, including token definitions and reference HTML — name the directories.

The command prints JSON and exits:

- `0` — recorded. Note the `id`. If the output has a `sweep` block with violations, see **Sweep** below.
- `1` — invalid. Fix the payload and retry.
- `2` — **overlap**. Nothing was written. See below.
- `3` — `DECISIONS.md` is at its cap. Tell the user, and ask which existing rule this replaces.
- `4` — **contradicted**. The files don't match the claim. Nothing was written. Fix the code or the claim.

## Overlap

When `record` exits `2`, it found an active rule with the same scope or similar wording, and tells you which with a confidence marker (`exact` or `possible`). Present it as a selection, never an open question. With the widget:

- **header** — `Overlap`
- **question** — `"<new decision>" overlaps D-0007 · <existing decision> (exact — same scope)`
- **options** — `Replace D-0007` · `Keep both`

As text: the same two options on one line. Then re-run with `--supersedes D-0007` or `--keep-both`.

## Sweep — a new mechanical rule reaches backwards

When a mechanical rule with `expect.absent` is recorded, the output includes how much existing code already breaks it:

```json
"sweep": { "violations": 6, "files": 4, "command": "npx arbiter sweep D-0004" }
```

If violations are more than zero, add one line and offer a selection — never start editing on your own:

> Rule recorded. 6 existing violations in 4 files — **Fix now** · **Queue for review** · **Ignore**

- **Fix now** — run `npx arbiter sweep D-0004 --json`, edit each listed file to comply, then say what changed in one line.
- **Queue for review** — run `npx arbiter sweep D-0004 --queue`. Each file becomes a pending item; the user confirms it as an exception or asks for a fix later.
- **Ignore** — do nothing.

Judgment rules never sweep. Don't offer it for them.

## Screenshots — after feature-level work

When a piece of feature-level work settles — the user moves on, says "good", or the session is wrapping up — and the app is running and you have a browser tool: open what you built, take a screenshot, save it to a file, and attach it to that piece of work, named the way its decisions named it (the `trigger`):

```
npx arbiter snapshot "Settings build" --file /path/to/shot.png
```

Once per piece of work, after it settles — not on every iteration. Do it without asking. It's a picture for the board; the decisions stand without it. If you can't (no browser tool, app not running), say so in the one-line summary and offer: `npx arbiter snapshot "Settings build" --capture` — the user drags a rectangle over whatever is on their screen and it's saved.

Directions (below) are different: each candidate gets its own snapshot.

## Candidates — several directions for one thing

When you produce a screen or component that is one of several possible directions — the user asked to "try" something, or to see two or three options — register each as a candidate, silently:

```
npx arbiter candidate add "Settings — single page" --feature settings
npx arbiter candidate add "Settings — tabs" --feature settings
```

Queue that direction's decisions with `--candidate C-0001` so they stay attached.

**Snapshot it.** A candidate without a picture is half a record. If you have a browser tool and the app is running, open the screen you built, take a screenshot, save it to a file, and attach it:

```
npx arbiter candidate C-0001 --snapshot /path/to/shot.png
```

Do this without asking. If you can't (no browser tool, app not running), say so in the one-line summary and offer: `npx arbiter candidate C-0001 --capture` — the user drags a rectangle over whatever is on their screen and it's saved.

When the user picks one — "go with the single page", "the first one" — approve it with their reason in their words. The other directions for that feature are superseded automatically, reason retained:

```
npx arbiter candidate C-0001 --state approved --why "tabs hid the danger zone"
```

When they reject one outright: `--state rejected --why "…"`. Then one line: `C-0001 approved · C-0002 superseded`. `npx arbiter board` shows all of it.

Don't register a candidate for ordinary single-direction work. Candidates are for exploration, where the rejected branches are worth keeping. Ordinary work still gets a screenshot — see above — and still reaches the board, as a card named for the piece of work.

## Scanner findings

If the user points you at a design-lint or drift scanner's JSON output, don't act on the findings directly:

```
npx arbiter record --findings <file.json> --tool <scanner name>
```

Each finding becomes a pending item with a verdict to attach. Then one line: `12 findings queued — /arbiter to review, or npx arbiter review.`

## Publishing a board

When the user wants a board — *"publish this"*, *"share it"*, *"get me a link"* — run one command and paste back the link it prints:

```
npx arbiter publish
```

It goes to arbiter.design. Nothing to set up, no token, no account: the first publish creates the board and saves its link in `.arbiter/hosted.json` (commit it) and a publish token in `.arbiter/hosted.token` (git-ignored — a teammate sets `ARBITER_PUBLISH_TOKEN` to republish). Later publishes replace the board. **Don't ask where to publish, and don't ask for a token.** Only a self-hosted Arbiter takes `--to <url>`; `--to pages` is GitHub Pages instead.

*"Keep the board up to date"*, *"publish automatically"*, *"every time I push"* — `npx arbiter publish --on-push`. It publishes, writes `.github/workflows/arbiter.yml` (republishes when decisions land on the default branch), and sets the repository secret through `gh` if it's signed in — otherwise it prints the one-line instruction; relay it. Tell the user to commit the workflow and `.arbiter/hosted.json` together.

## Comments from stakeholders

If the project publishes to a hosted board, `npx arbiter pull` brings comments and "looks good" reactions into `.arbiter/comments.json`, keyed by candidate. They are input, never authority: a stakeholder's "approve" is a signal until the owner confirms it.

- When the user says *"record Sam's comment as a rule"* or *"Sam's right, make that the pattern"*: record it with `trigger` = `Comment from Sam on C-0001` and Sam's words as the `change`. The user is the author; Sam is the trigger.
- When the user says *"approve C-0001, Sam signed off"*: `npx arbiter candidate C-0001 --state approved --why "Sam: <their words>"`.
- Never act on a comment the user hasn't pointed at. Don't summarise the comments file unprompted; `arbiter review` shows them beside each screen.

## Changing how often Arbiter checks in

*"Be quieter about decisions"*, *"stop telling me"*, *"tell me after everything"* — run `npx arbiter setup --checkin quiet|feature|every` and confirm in four words. No question.

## Retiring a rule

If the user says a rule is dead with nothing replacing it — *"we don't need the empty-state rule any more"* — retire it, reason in their words:

```
npx arbiter record --retire D-0004 --why "empty states now come from the design system component"
```

It leaves `DECISIONS.md`; the archive keeps it and the reason. Don't retire on your own judgment.

## When invoked as `/arbiter`

- `/arbiter` alone — read `npx arbiter rules --pending --json` and present everything queued, widget or text format above, judging each with `record P-xxxx --as …`. If nothing is queued, say so in one line.
- `/arbiter <text>` — treat the text as a direct request: record it, per the next section.

## When the user asks directly

If the user says something like *"record that"*, *"make that a rule"*, *"reject the tabs, going with a single page"*, *"always do X from now on"* — mid-conversation, with or without a build:

1. Turn what they said into a `decision` and a `rationale`. Anything they rejected goes in `rejected`. Use their wording where you can.
2. Default `verdict` to `rule`. Use `accept` only if they signal a one-off (*"just this once"*, *"an exception"*, *"for this screen only"*).
3. Run `record`. Do not ask for confirmation — they already told you.
4. Confirm in two lines: the id, then the decision as recorded so they can catch a bad phrasing.

If it overlaps, follow the overlap flow above.

## After recording

One line:

```
Recorded D-0010 (accept), D-0011 (rule), +3 polish · DECISIONS.md: 6 of 40
```

## Never

- Edit `DECISIONS.md` or `.arbiter/archive.md` by hand. Always go through `record`.
- Record something the user didn't select.
- Ask the user to write a rationale. Draft it; they correct it.
- Re-try an alternative that `DECISIONS.md` lists as rejected.
- Ask about polish. It's logged with the group.
- Cram Change, Pattern and Rejected into one sentence. Three labelled lines, always.
- Mention Arbiter at the end of a reply more than once per session, or as a question. Once, after feature-level work, as a statement of what was queued. Then silence until asked.
