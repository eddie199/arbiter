# Tickets — screenshots, records, removal

Opened 2026-09-24, out of issue [#2](https://github.com/eddie199/arbiter/issues/2) and the session that followed it.

**The thread.** A user attached a screenshot to a piece of work; the board never showed it. Chasing that turned up three layers: the board couldn't render work snapshots (a bug), the agent never takes those screenshots on its own (a rule), and the agent's screenshot tool can't write a file anyway (a capability). Working around it, they fabricated an approved screen that never existed — and nothing in Arbiter can remove it.

Board-side removal is out of scope here. Everything below is CLI, skill, or the one site fix already written.

| # | Ticket | Where | Size | Status |
|---|---|---|---|---|
| 1 | Work cards show their snapshot | site | S | Built, ready to merge |
| 2 | Screenshot rule: gate on the screen, not the level | skill | S | Built |
| 3 | Fix the contradicting decision definition | skill | S | Built |
| 4 | Give the agent a screenshot path that writes a file | skill | S | Built |
| 5 | Failure always names its reason | skill + CLI | S | Built |
| 6 | `--capture` works off macOS | CLI | M | Paused — messages only, no Windows capture |
| 7 | `publish` reports what's missing | CLI | S | Not this release |
| 8 | Snapshot warning counts the right list | CLI | S | Built |
| 9 | `arbiter remove` | CLI | M | Built |
| 10 | `arbiter unlink` | CLI | S | Built |
| 11 | Mark a record private | CLI | M | Not this release |
| 12 | Tell Arbiter where the app runs | CLI + skill | S | Not this release |
| 13 | Document `--candidate` at judge time | docs | S | Built |
| 14 | Pictures attach to screens | CLI + site | M | Needs a call |

---

## Building

### 1. Work cards show their snapshot · site · S

Already written on `fix/work-card-snapshots` (8160f19). The board skipped the image frame for anything marked as work, so a snapshot uploaded by `publish` never rendered. Now the frame appears when a snapshot exists, on the grid card and the detail page; work without one still gets no frame and no placeholder.

Reviewed and traced end to end: the CLI was always sending it, the upload route always accepted `W-` ids, and the list view already rendered it. Only the grid and detail page were wrong. Merge as-is.

**Note:** the commit says `Fixes eddie199/arbiter#2`, but the commit is in `arbiter-site` and the issue is in `arbiter`. GitHub only auto-closes within one repository — close #2 by hand.

### 2. Screenshot rule: gate on the screen, not the level · skill · S

Today a screenshot only happens after **feature-level** work. That's the wrong axis: feature work is often systemic, and polish is almost always localised to one screen. The rule screenshots exactly the wrong half, which is why the reporter's mobile layout fix got nothing.

New rule:

> When a piece of work settles and it changed how a specific screen looks, take one picture of that screen.
>
> Skip it when there's no single screen to point at — a font, a token, a global rule — unless the change alters how everything looks, in which case pick one screen and say it's representative.
>
> Skip it when a still can't carry the change: motion, focus order, anything behavioural.
>
> Photograph a state (empty, error, modal) only if you were already there.

**Name a piece of work after the screen it changed**, where it sensibly can: "Settings — billing", "Settings — profile", not "Settings build" covering four routes. One picture per piece of work then *is* one per screen, with no change to how pictures are stored. It also tightens review, since decisions are grouped by piece of work — you judge screen by screen instead of one lump of twenty.

Work that genuinely shouldn't be split — a checkout flow across three steps, a nav change touching every page — stays one piece of work and gets one representative picture. See #14 for the case where that isn't enough.

**Why this axis.** A picture isn't evidence of a change — there's only one image and nothing to compare it against. It's a record of the screen. That's why small cosmetic work deserves one (you were on a screen, it now looks a certain way) and a font swap doesn't (no screen is *the* screen).

Worked examples, kept because they're what the rule was built from:

| Picture | No picture |
|---|---|
| Settings becomes a tab row | Body font → Inter |
| Passport fields stack under 640px | Button label "Save" → "Save changes" |
| Danger zone moved to the bottom | Error copy rewritten |
| Card padding tightened on the audit list | Focus order fixed |
| Empty state added to Reports | Sheet transition 200ms → 150ms |
| Rescan becomes icon-only on half-width cards | Route renamed |

The arguable ones — spacing scale, palette swap, chevron removed, inline→modal confirm, loading skeleton — are covered by the "representative screen" clause and the states clause.

### 3. Fix the contradicting decision definition · skill · S

`skill/visual-changes` adds "any visual change that stays in the UI counts, even when the user asked for it." But the section still opens with the old definition — *"a point where a reasonable alternative existed and you picked one, that was **not** dictated by the request"* — in bold, sixteen lines above. An agent reading top-down hits the exclusion first.

Amend the opening sentence rather than carving an exception below it.

### 4. Give the agent a screenshot path that writes a file · skill · S

**The root cause of the whole thread.** The skill says "take a screenshot, save it to a file, and attach it." The agent's own screenshot tool returns an image into the conversation — there is no save-to-path. So the middle step is impossible with the obvious tool, and the path of least resistance becomes asking the user.

Headless Chrome or Edge writes a PNG in one command and is already installed on every machine we've checked. Verified on Windows during this session:

```
7992 bytes written to file …\shot.png
PNG image data, 900 x 500
```

The skill should name this as the default route, and prefer a project's own Playwright/Puppeteer when it has one. Manual capture drops to last resort, where it belongs.

### 5. Failure always names its reason · skill + CLI · S

"Couldn't take a picture" is useless. Each cause has a different fix, and only two end with the user doing the work:

| Reason | What it implies |
|---|---|
| App isn't running | Start the dev server |
| No browser on this machine | Install one, or capture manually |
| Screen is behind a login | Give a test account, or capture manually |
| Screen needs data that isn't there | Seed it |
| Don't know where the app runs | See #12 |
| Took one, it was blank | Retry, or capture manually |

Also: never publish a picture of a blank page, a spinner or an error screen — no picture beats a wrong one.

**And it must actually reach the user.** Today the fallback rides inside the one-line check-in summary, which only exists after feature-level work under the default setting. Under `quiet`, or for non-feature work, the agent screenshots nothing *and* says nothing — the reporter's exact experience. Say it once per session, on its own line, regardless of size or check-in setting. Once, not per item.

### 6. `--capture` works off macOS · CLI · M

`captureImage` is `darwin` only; on Windows and Linux it exits with an error. So an agent following the fallback instruction hands a Windows user a command that fails.

Two parts: make the offered command platform-correct, and implement capture for Windows (`Win+Shift+S` then read the clipboard image) and Linux. Lower priority than #4 — with a headless path in place, manual capture is rare.

### 7. `publish` reports what's missing · CLI · S

The moment a missing picture actually costs something is when the board goes out. One line, every publish, unprompted:

```
board  done — 5 screens published, 2 with no picture, 1 private
```

Cheap, and it would have caught the original bug without a word of chat.

### 8. Snapshot warning counts the right list · CLI · S

`snapshotWork` warns "no decisions mention this yet" by checking the archive **and** the pending queue. But `buildManifest` builds work cards from the archive only — pending decisions produce no card. So a snapshot taken right after work settles reports success, publishes, and shows nothing.

Count only the archive. This is a prerequisite for #2: once screenshots fire on ordinary visual work, they'll usually be taken while the decisions are still pending.

### 9. `arbiter remove` · CLI · M

Arbiter has one exit — `retire`, and only for active rules. There's no way to remove a recorded decision, a candidate, or a picture.

Three verbs, and only the first exists:

- **Retire** — it was real, it's over.
- **Edit** — right call, wrong words. *(backlog)*
- **Remove** — it was never real.

Append-only is right for judgments and wrong for mistakes. The reporter's archive now claims a mobile layout was chosen over alternatives and approved; that never happened, and they can't take it back. A record that can't tell "we changed our mind" from "that never happened" is less trustworthy, not more.

`arbiter remove <id>` works on a decision, a candidate or a snapshot, and refuses when something depends on it:

- a candidate with decisions linked → names them, points at #10
- a candidate another one superseded → refuses
- a decision another one supersedes → refuses
- an active rule → points at `retire`, the right verb

Print exactly what was removed. Git is the safety net for most people, but the reporter had no repo at all, so the terminal has to be the backup.

### 10. `arbiter unlink` · CLI · S

Detach a decision from a candidate without deleting either. Half of what the tester needs to clean up, and the missing half of `--candidate`.

### 11. Mark a record private · CLI · M

Real, active, in git — just not on the published board. Covers the internal experiment, the not-ready screen, and the screenshot with customer data in it. (Theirs was a passport form, 750×4202, on a public share link.)

Three things this has to get right:

- **Sticky, not one-time.** The board is replaced on every publish, so a one-off removal survives exactly one publish. It's a property of the record.
- **In git.** If the flag is local-only, a teammate publishing from their laptop re-exposes everything you marked. Same failure shape as the CI guard.
- **It doesn't take anything down by itself.** It changes what the *next* publish contains. Say so: `C-0002 private — run npx arbiter publish to take it off the board.`

**A private rule is still a rule** — the agent reads it, follows it, and it counts against the 40. This is about audience, not authority, so don't call it "hidden" or someone will mark a rule private expecting the agent to stop applying it. Name to be picked: `private` / `internal` / `unlisted`.

Hiding a card takes its picture with it. Wanting the card but not the image is #9 on the snapshot, not this.

### 12. Tell Arbiter where the app runs · CLI + skill · S

Nothing records where the app lives. "Open what you built" silently assumes localhost, so a project deployed to a server and not running locally fails at the first step with no explanation.

`arbiter.json` gains an app URL, optionally a path per screen. Then #4 has an address to open, whether that's `localhost:3000` or staging.

### 14. Pictures attach to screens · CLI + site · M

The naming rule in #2 gets one picture per screen for free, but only as far as the agent follows it, and only when work can honestly be split. A checkout flow across three steps is one piece of work and wants three pictures.

The real version: a picture belongs to a named screen inside a piece of work. `.arbiter/work/W-settings-build/billing.png` rather than one file per work. The snapshot command takes a screen name, the manifest's single image becomes a list, and the card and detail page show several — a strip, or the first with a count.

Lands in the CLI and the service together, so it can't ship piecemeal. Worth doing only if the representative-shot compromise proves thin in real use — #2 ships first and tells us.

### 13. Document `--candidate` at judge time · docs · S

`npx arbiter record P-0001 --as accept --candidate C-0001` already links a decision to a screen at the moment it's approved. Tested and working. Neither the README nor the skill mentions it on the judge line, so it's findable only through `--help` — which is why the reporter concluded it was impossible and built a workaround instead.

---

## Backlog

**Read the board back.** The board API is write-only. The reporter's agent had to re-upload an image by hand just to find out what the server held, and still had to infer the cause. A read endpoint turns that into one call, and would let #7 verify what actually landed.

**Board-side removal.** Deliberately out of scope. When it comes back: the board is a mirror, so a delete there is a *request* that travels down on `pull` and becomes true on the next publish — the same rail as comments and rewording.

**Board ownership.** A project is a name, a slug and a token hash. There is no owner, so the board can't tell the person who made it from someone they sent the link to. Any destructive control on the board waits on this, which is the workspace work already gated in the roadmap.

**`edit` — reword without correcting.** Deferred to 0.3. `fix` means "that call was wrong" and turns a typo into a rejected alternative; there's still no way to just change the words.

**Link an already-recorded decision to a candidate.** The "Related" ask in #2. Was load-bearing only because of the rendering bug — with #1 shipped, the fabricated candidate never gets created and nothing needs linking. Still worth having for genuine cases; no longer urgent.

**Renaming a piece of work orphans its comments.** A work card's id is derived from its name, so a rename silently detaches every comment on it. Worth checking whether it's already happened on a live board.

**Before-and-after pictures.** A single screenshot shows state, not change — the chevron case, where nothing in the image reveals what moved. A pair would, at the cost of a second image and a second capture moment.

**Tiered decisions on a card.** Parked on `archive/tiered-cards` (6e42c05). #2 increases decisions per piece of work, which makes this more relevant, not less.

---

## Settled

- **Pictures are per screen.** Work is named after the screen it changed (#2). Whether that's enough, or #14 is needed too, is the one call still open.
- **`remove` deletes outright.** Git holds the history; the terminal prints what went, for anyone without a repo.
- **This release is the bug fix plus cleanup** — 1–5, 8, 9, 10, 13, all built on `release/0.1.4`. Private records (#11), publish counting (#7), Windows capture (#6) and the app URL (#12) wait.
- **#6 is paused.** The agent now renders its own screenshot with a headless browser (#4), so manual capture is a rare fallback. The *message* is platform-correct — `--capture` is only offered on macOS — but no Windows capture was built.

## Found while building

- **Removing an active rule had no exit.** Refusing and pointing at `retire` meant a rule that was never real couldn't leave: retiring it appends a second false record, and then neither can go. `remove --force` takes it out of both files.
- **Removing a rule never revives the one it replaced.** Guessing would reinstate a rule nobody re-confirmed, so the output says the replaced rule is still inactive rather than quietly restoring or quietly losing it.
- **Ids are reused.** They come from the highest in the file, so removing the newest frees its id. Harmless locally; on a published board, comments point at the old id. `remove` now says so when it happens.

## Open questions

1. **Is #14 in or out?** #2's naming rule covers most of it for nothing. #14 is for work that honestly can't be split.
2. **Should the agent ever ask before capturing?** Proceeding on: never on success, always on failure.
3. **What to call #11** — `private`, `internal`, or `unlisted`. Not needed until that ticket comes round.

## Actions, not tickets

- Close [#2](https://github.com/eddie199/arbiter/issues/2) by hand when #1 merges — the cross-repo keyword won't do it.
- Reply to the reporter: the fix, the `--candidate` shortcut they were missing, and that their existing upload should appear with no action on their side.
- After deploying #1, check their board — the image is already in storage, so it should simply light up.
