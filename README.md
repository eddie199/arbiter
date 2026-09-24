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
arbiter record P-0003 --as rule     judge a queued one: accept | rule | skip | fix --to "…"  [--candidate C-0001]
arbiter record --all --as accept    judge every queued item  [--level polish] [--trigger "Settings build"]
arbiter record --findings f.json    queue a scanner's findings for verdicts
arbiter record --retire D-0003 --why "…"   drop a rule with no replacement
arbiter record R-0001 --as apply    answer a request from the board: apply [--to "<instead>"] | decline --why "…"
arbiter record '<json>' --request R-0001   record the change made for an approved request; it's applied
arbiter remove D-0004               take out a record that was never real: a decision, a screen (C-0001),
                                    or a picture (--snapshot "<work>")
arbiter unlink D-0004               detach a decision from the screen it was recorded against
arbiter review                      judge the queue in a browser page
arbiter verify [id]                 re-check a decision's claim against its files
arbiter sweep D-0004 [--queue]      find existing violations of a mechanical rule
arbiter candidate add "<name>"      track a generated direction  [--feature f] [--snapshot img | --capture]
arbiter candidate C-0002 --state …  generated | in_review | approved | rejected | superseded
arbiter board                       candidates and their states
arbiter export                      static folder of the board for people without the repo  [--feature f] [--include-rules] [--open]
arbiter publish                     board online at arbiter.design, with comments; prints the share link. Nothing to set up.
arbiter publish --to <url|pages>    your own hosted Arbiter, or GitHub Pages (git destination + export + commit + push)
arbiter publish --on-push           also write a GitHub Actions workflow that republishes on every push, and set its secret
arbiter publish --auto              republish whenever the record changes — no GitHub, no CI, no repository needed
arbiter pull                        bring comments and "looks good" reactions down into .arbiter/comments.json;
                                    "Request change" becomes a request (R-0001) in .arbiter/requests.json
arbiter drift                       deviations per screen: accepts, unverified claims, rules broken
arbiter rules                       active rules   [--dimension <name>] [--json]
arbiter rules --pending             the queue, and requests waiting on an answer
arbiter rules --archive             everything ever
arbiter rules D-0003                one decision in full (R-0001: one request)
arbiter update                      newest Arbiter: install it, refresh the skill file, re-pin the workflow  [--check]
```

`record` exit codes: `0` recorded · `1` invalid · `2` overlap — re-run with `--supersedes <id>` or `--keep-both` · `3` cap reached · `4` contradicted — the named files don't match the claim.

## Screenshots

The agent takes one picture per piece of work, when the work settles and it changed how a specific screen looks. Size isn't the test — a polish fix usually lives on one screen and earns a picture; a font or token change has no single screen to point at and doesn't. Motion and anything behavioural can't be carried by a still, so they don't either.

The agent's own screenshot tool hands it an image, not a file, so it renders to disk with a headless browser (`chrome --headless --screenshot=…`) and attaches that. When it can't — no browser, app not running, screen behind a login — it says so once, naming the reason, whatever the check-in setting. `--capture` is the manual fallback and is macOS only; elsewhere, save a screenshot and pass `--file`.

Name a piece of work after the screen it changed where the work splits that way — `Settings — billing` rather than one `Settings build` across four routes — and one picture per piece of work is one per screen.

## Taking something out

Three acts, and only one is a removal.

| | What it means | Command |
|---|---|---|
| **Retire** | It was real, it's over | `arbiter record --retire D-0003 --why "…"` |
| **Remove** | It was never real | `arbiter remove D-0004` |
| **Unlink** | Real, attached to the wrong screen | `arbiter unlink D-0004` |

The archive is append-only for judgments: a call you changed your mind about is superseded, and that history is the point. It isn't append-only for mistakes. A test entry, an agent misfire, or a screen invented to work around a bug is a record that says something false, and keeping it forever makes the archive less trustworthy, not more.

So `remove` deletes — from the archive, from `DECISIONS.md`, from the candidate files — and prints the full record it removed, because git holds the history only for people who have a repo. It refuses while anything still points at the record: an active rule (retire it), a decision another one supersedes, or a screen with decisions still linked (`--force` unlinks them in one go).

`arbiter remove --snapshot "<work>"` takes only the picture; the work and its decisions stay, and the board keeps the old image until the next publish.

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

The hosted board at [arbiter.design](https://arbiter.design) serves a board at a share link and lets people comment, request a change, or say "looks good" after a magic-link sign-in. Git stays the record: the service holds one board version per project and the comments, nothing else. `npx arbiter publish` uploads; `npx arbiter pull` brings comments back, where `arbiter review` shows them beside each screen. Only `publish` and `pull` ever touch the network. The service itself is a separate, private codebase.

Two ways to keep the board current without anyone remembering.

`npx arbiter publish --auto` is the one that works anywhere. It sets `hosted.auto` in `arbiter.json`, and from then on the board republishes whenever the record changes — after judging, after a screen changes state, after a picture is attached or removed. No GitHub, no CI, no git repository. Queueing decisions doesn't trigger it, since the queue is never published. If a republish fails — offline, service down — the command still succeeds and says the board is behind; the record is already written, and git is what holds it. `--no-auto` turns it off.

`npx arbiter publish --on-push` is the GitHub route, and it writes `.github/workflows/arbiter.yml`, which runs `publish` when decisions land on the default branch, and sets the `ARBITER_PUBLISH_TOKEN` repository secret through `gh` if it's signed in (otherwise it prints the one-line instruction). Commit the workflow together with `.arbiter/hosted.json`. Under CI, `publish` only ever updates the board that file names — it refuses to create one, so a repo where the file wasn't committed can't mint orphan boards on every push.

## Requests from the board

A comment is input; it waits until the owner points at it. **Request change** on the board is different: someone wants something changed, so it gets an answer.

1. `npx arbiter pull` turns each one into a request, `R-0001`, in `.arbiter/requests.json` (commit it — everyone sees the same answers). Pulling twice never asks twice.
2. The owner answers — in chat with `/arbiter`, or on the **Requests** tab of `arbiter review`:
   - **Apply** — `record R-0001 --as apply`
   - **Apply, but…** — `record R-0001 --as apply --to "keep the tab, make the button red"`: do this instead of what was asked
   - **Decline** — `record R-0001 --as decline --why "…"`: the reason is required, because the requester reads it
3. Approving changes no code — only the agent can. In chat it makes the change right away; approved from the review page, it's made at the next `/arbiter`. The agent records what it did with `--request R-0001`, and that's what applies it. Only an approved request can be applied; a change the owner hasn't said yes to is refused.
4. `publish` carries the answers back: the requester sees *Open*, *Approved*, *Applied* — with what actually changed — or *Declined* with the reason, under their request.

Nothing is applied without the owner, and the board never writes to git: requests come in through `pull`, answers go out through `publish`. Removing the decision that applied a request opens the request again, for a fresh answer — the agent never remakes it unasked. A screen with a request still waiting on it can't be removed until the request is answered.

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

## Updating

Two things go stale independently: the package pinned in your devDependencies, and the skill file `init` copied into the project — the agent's whole protocol. `init` stamps the skill file with the version that wrote it, so Arbiter can tell the two apart with no network: when they differ, the queue's JSON carries `update`, and the agent says one line. `npx arbiter update` installs the newest package, refreshes the skill file from it, and re-pins the publish workflow if there is one. Settings, `DECISIONS.md`, and the archive are untouched. `--check` reports without changing anything. Nothing checks the registry on its own.

## Development

```bash
npm install
npm run build
npm test
```
