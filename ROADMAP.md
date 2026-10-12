# Arbiter roadmap

Build priority, top to bottom. Sized against 0.1.2. Shipped rows say which release carried them. Gates are fixed; do not move.

| # | Item | What it does | Build | Feasibility | Where | Ship |
|---|---|---|---|---|---|---|
| 1 | Identity per person | Author = git user, not whoever ran `init`. Bug. | S | High | CLI | 0.1.3 |
| 2 | `edit` — reword locally | Change the words of Change / Pattern / Rejected / Rationale without a correction. Pencil on review cards; relabel Fix → Correct. | S | High | CLI, review page | 0.3 |
| 3 | Tier decisions on the card | Board card leads with the work summary, shows feature-level, folds pattern behind "+N". Send `level` on the wire. | S | High | CLI, service | Archived — a separate experience, later. Built on branch `archive/tiered-cards` |
| 4 | Update notice + `arbiter update` | Agent says a newer version is out; one command bumps the package and refreshes the skill. Never auto-mutates. | S | High | CLI, skill | 0.1.3 |
| 5 | Auto-publish on push | `init` offers a GitHub Actions workflow that runs `publish` on push. | S | High | CLI | 0.1.3 |
| 6 | Comments → queue → Apply | "Request change" on the board becomes a pending item; owner judges; **Apply** = agent makes the change and records it; `publish` sends resolution back. | M | High | CLI, skill, one board button | 0.3 — built on `feat/requests` (CLI + site), not released |
| 7 | Pin comments on the snapshot | Click a spot on the screen; comment attaches there. Stale pins fall back to the list after republish. | M | Medium | Service, review page | 0.3 |
| 8 | Reword proposals from the board | Reader proposes new wording; owner accepts on pull; `edit` applies. Board never writes git directly. | M | Medium | Service, `pull` | 0.4 |
| 9 | Sign-in to view + allowlist | Private boards. Allowlist by email or domain is the real feature; sign-in alone protects nothing. | M | Medium | Service, tiny CLI | 0.4 |
| 10 | Workspace + inbox | Projects belong to a workspace; one sign-in; manager's home is state-first (in review, waiting on me, approved this week) linking to project boards. | L | Medium | Service | Gate: ≥2 projects publishing **and** a non-IC opens a board |
| 11 | Cross-project overlap | Run the existing overlap check across a workspace's rules; flag on the board. | S | High | Service | With #10 |
| 12 | Auto-capture screenshots | `arbiter snapshot --auto`: find the dev server, render routes, save. Command, never a watcher. | L | Low | CLI + Playwright | Gate: people say missing pictures stop them reading |
| 13 | Workspace rule layer | Org-level rules every project's agent reads beside its own `DECISIONS.md`. | L | Low | CLI + service | Gate: #11 flags real overlaps |

**Build** — S: a day, existing mechanism · M: a few days, a new surface or service endpoint · L: a week+, new object or dependency.
**Feasibility** — High: mechanism exists · Medium: a design call or the private service in the way · Low: outside dependency or strains a product constraint.

Not on the list, on purpose: auto-applying comments to the build, board edits that write straight to git, any watcher. Git is the record; the user is the trigger.
