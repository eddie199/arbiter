# Arbiter

A decision layer for AI-generated UI. Records the design calls made during agent-assisted UI work — what was chosen, what was rejected, and why — and feeds them back into the agent's context so the same call never has to be made twice.

```bash
npx arbiterdesign init
```

That's the whole install. It writes:

| File | What it is |
|---|---|
| `DECISIONS.md` | Active rules, grouped by dimension. Capped at 40. The agent reads this before UI work. |
| `.arbiter/archive.md` | Every decision ever, append-only. Never loaded into the agent. |
| `.arbiter/pending.md` | Decisions the agent queued that you haven't judged yet. |
| `.arbiter/candidates/` | One page per generated screen or direction, with its state, snapshot, decisions, and why it lost. |
| `CANDIDATES.md` | Index of candidates — written only when `destination` is `git`. |
| `.claude/skills/arbiter/SKILL.md` or `.cursor/rules/arbiter.mdc` | Tells the agent to surface its decisions after UI work and record what you confirm. |
| `arbiter.json` | Config. `destination: "local"`. |
| `AGENTS.md` | One line appended, pointing at `DECISIONS.md`. Merged, never overwritten. |
| `CLAUDE.md` (Claude Code) / `.cursor/commands/arbiter.md` (Cursor) | Same pointer line in Claude Code's own context file; a `/arbiter` command for Cursor. |

Running `init` twice changes nothing.

## How it works

1. You ask the agent to build a screen. It reads `DECISIONS.md` first.
2. You iterate. It says nothing about decisions while you're iterating — each version you move past becomes a rejected alternative on the one that replaced it.
3. When you move on, it queues the design calls it made — sized as `feature`, `pattern`, or `polish` — and, after feature-level work, says one line about what changed.
4. You judge them when you want — in chat with `/arbiter`, or in the browser with `npx arbiter review`. Grouped by piece of work; each item reads **Change** (what happened) / **Pattern** (the rule) / **Rejected** (what lost). Per item: **Confirm**, **Make it a rule**, **Skip**, or type a correction. Polish is one line per group — **Confirm all**.
5. Rules enter `DECISIONS.md`. Everything judged enters the archive. Skips vanish.

You can also just say it: *"make that a rule"*, *"reject the tabs, going with a single page"*. It records without asking.

Nothing enforces anything. Rules inform generation; they don't gate it.

## Commands

```
arbiter init                        install into this project  [--destination git]
arbiter snapshot "<work>" --file x.png   a picture for a piece of work (or --capture on macOS); publish carries it
arbiter record                      walk through a decision at the terminal
arbiter record '<json>'             record now (what the agent calls)
arbiter record --pending '<json>'   queue for later
arbiter record P-0003 --as rule     judge a queued one: accept | rule | skip | fix --to "…"
arbiter record --all --as accept    judge every queued item  [--level polish] [--trigger "Settings build"]
arbiter record --findings f.json    queue a scanner's findings for verdicts
arbiter record --retire D-0003 --why "…"   drop a rule with no replacement
arbiter review                      judge the queue in a browser page
arbiter verify [id]                 re-check a decision's claim against its files
arbiter sweep D-0004 [--queue]      find existing violations of a mechanical rule
arbiter candidate add "<name>"      track a generated direction  [--feature f] [--snapshot img | --capture]
arbiter candidate C-0002 --state …  generated | in_review | approved | rejected | superseded
arbiter board                       candidates and their states
arbiter export                      static folder of the board for people without the repo  [--feature f] [--include-rules] [--open]
arbiter publish                     board online at arbiter.design, with comments; prints the share link. Nothing to set up.
arbiter publish --to <url|pages>    your own hosted Arbiter, or GitHub Pages (git destination + export + commit + push)
arbiter pull                        bring comments and "looks good" reactions down into .arbiter/comments.json
arbiter drift                       deviations per screen: accepts, unverified claims, rules broken
arbiter rules                       active rules   [--dimension <name>] [--json]
arbiter rules --pending             the queue
arbiter rules --archive             everything ever
arbiter rules D-0003                one decision in full
```

`record` exit codes: `0` recorded · `1` invalid · `2` overlap — re-run with `--supersedes <id>` or `--keep-both` · `3` cap reached · `4` contradicted — the named files don't match the claim.

## Verification

A mechanical decision can name `files` and an `expect` — literal strings that must be `present` in / `absent` from them (write `regex:<pattern>` for a pattern, e.g. `regex:#[0-9a-fA-F]{6}\b` for any hex colour). Arbiter reads only those files, never the repo. A claim that doesn't hold is refused. `accept` verdicts are never checked: an exception is a deviation by definition.

## Sweep

Recording a mechanical rule with `expect.absent` reports how much existing code breaks it. `arbiter sweep <id>` lists the lines; `--queue` turns each file into a pending item to confirm as an exception or fix. Read-only — fixes are the agent's job. Judgment rules can't sweep.

The scan set is the rule's `paths` (directories or files) if it names any, else its `file:` scope, else the whole project. Keep token definitions and reference HTML out with `arbiter.json`:

```json
{ "sweep": { "exclude": ["app/globals.css", "design-reference/**", "docs/**"] },
  "overlap": { "ignore": ["audit", "journey"] } }
```

`overlap.ignore` lists project words too common to signal that two rules overlap.

## Review page

`arbiter review` opens a local page with two tabs. **Decisions** — the queue, grouped by dimension, each card showing the screen it was made for. Confirm / Make it a rule / Skip / Fix; overlaps and contradictions surface inline. **Candidates** — every direction with its snapshot; Approve (with why — kept on the ones it replaces), Reject, In review. Both write the same files as the CLI.

## Export

`arbiter export` writes `arbiter-export/` — one `index.html` plus snapshots, no server, no JS. Open it locally or drop the folder on any static host and send the link. It's the stakeholder view only: each screen, its state, who approved, why the others lost, and what was decided in plain words. No verdict controls — feedback comes back through a person. This is the cheap test of whether stakeholders actually look, before anything hosted gets built.

## Hosted board

The hosted board at [arbiter.design](https://arbiter.design) serves a board at a share link and lets people comment or say "looks good" after a magic-link sign-in. Git stays the record: the service holds one board version per project and the comments, nothing else. `npx arbiter publish` uploads; `npx arbiter pull` brings comments back, where `arbiter review` shows them beside each screen. Only `publish` and `pull` ever touch the network. The service itself is a separate, private codebase.

## Candidates

When several directions are generated for one feature, each is a candidate. A snapshot comes from the agent's browser tool (`--snapshot <image>`) or, on macOS, from you: `--capture` drops into drag-to-select and saves what you pick. Approving one supersedes the rest with the reason kept. Decisions link to a candidate; its page lists them. `npx arbiter publish` does all of the below in one go — switches to git, exports, commits, turns on GitHub Pages through `gh` if it's signed in, pushes, prints the link. It's the only command that touches the network, and only when you run it.

With `destination: "git"` in `arbiter.json`, every candidate change commits its page, a `CANDIDATES.md` index, and the export page under `docs/arbiter/` (never pushed). Turn on GitHub Pages for the `docs` folder once, and the board is served at `https://<owner>.github.io/<repo>/arbiter/` — always current, no login, no server. `board` prints the URL. Set `"pages": false` to skip, or `"pages": { "dir": "…", "includeRules": true }` to change it.

## The record

```
id          D-0001, sequential
date        ISO 8601
author      who decided
class       mechanical | judgment
level       feature | pattern | polish — how big a call; polish is never reviewed individually
dimension   structure | interaction | states | content | visual | motion | access
change      what happened, as a PM would say it — what the reviewer reads
decision    the same call as a rule someone could follow — what future sessions read
rejected    alternatives that lost, "<option> — <why>", one line each
trigger     the piece of work ("Settings build") — the grouping key for review
verdict     fix | accept | rule
scope       global | file:<path> | pattern:<name>
rationale   one line, required
supersedes  id | null
commit      short SHA | null
files       files the agent touched — evidence for verification
paths       where a rule applies (directories or files) — what sweep scans
expect      { present?: [..], absent?: [..] } — strings to check in files
verified    true | false | null (never checked / not checkable)
candidate   C-0001 | null
```

Only `rule` verdicts enter `DECISIONS.md`. A `rule` whose scope overlaps an active rule is refused until you say whether it replaces the old one; superseded rules leave the active file and stay in the archive.

## Kill conditions

Fixed before Stage 0 started, per the roadmap. Do not move.

- **Stage 0** — if only mechanical verdicts get recorded after three weeks of use, the judgment layer isn't real.
- **Stage 4 (candidates / board)** — build only if **5 or more** generated screens are in flight at once. If that never happens, cut it.

## Development

```bash
npm install
npm run build
npm test
```
