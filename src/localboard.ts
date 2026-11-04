/**
 * The local board's data, read from the project's files: what `arbiter review` sends the page
 * (/api/board and /api/state) and what `arbiter export` writes into a read-only copy.
 *
 * Built here, apart from the manifest `publish` uploads (src/hosted.ts), so the local board can change
 * what it shows without changing what the team board receives, and the other way round. The shapes
 * are in src/board-types.ts, which the page reads too.
 */

import fs from 'node:fs';
import path from 'node:path';
import { candidatesDir, decisionsFor, readCandidates } from './candidates';
import { ACTIVE_CAP, Paths, readActive, readArchive, readConfig, readPending } from './store';
import type { Decision } from './schema';
import { workId, workSnapshot } from './work';
import { cardOf, readRequests } from './requests';
import { readComments } from './comments';
import { readLinkOrNull } from './hosted';
import { missingPictures } from './pictures';
import type { Agent, Board, BoardCandidate, BoardDecision, BoardRequest, LocalBoard, PendingDecision, QueuedLine, ReviewState } from './board-types';

/** On the board: judged, still in force, and not polish. */
const shown = (d: Decision) => d.verdict !== 'pending' && d.verdict !== 'retire' && d.level !== 'polish';
const toDecision = (d: Decision): BoardDecision => ({ id: d.id, change: d.change, decision: d.decision, rejected: d.rejected, verdict: d.verdict, dimension: d.dimension, scope: d.scope, ref: d.ref });

export interface BoardOptions {
  /** Where the page finds pictures: the review server's `/snapshots/`, or an export's `snapshots/` folder. */
  pictures: string;
  /** The Design rules page. */
  includeRules: boolean;
  /** The review queue: work whose decisions are all still waiting gets a card too, so it's on the board before it's judged. */
  queued: Decision[];
}

/**
 * Every card and rule. A decision made on a screen rides with that screen; the rest are grouped by the
 * piece of work they came from (`trigger`) into a card each. Pictures are links, never bytes.
 */
export function boardOf(paths: Paths, opts: BoardOptions): Board {
  const known = readCandidates(paths);
  const candidates: BoardCandidate[] = known.map((c) => ({
    id: c.id,
    name: c.name,
    feature: c.feature,
    state: c.state,
    author: c.author,
    date: c.date,
    reason: c.reason,
    notes: c.notes,
    supersededBy: c.supersededBy,
    url: null,
    snapshot: c.snapshot && fs.existsSync(path.join(candidatesDir(paths), c.snapshot)) ? `${opts.pictures}${c.snapshot}` : null,
    decisions: decisionsFor(paths, c.id).filter(shown).map(toDecision),
  }));
  // Screenless decisions: one card per piece of work.
  const ids = new Set(known.map((c) => c.id));
  const archive = readArchive(paths);
  const loose = archive.filter((d) => shown(d) && (!d.candidate || !ids.has(d.candidate)));
  const byWork = new Map<string, Decision[]>();
  for (const d of loose) byWork.set(d.trigger, [...(byWork.get(d.trigger) ?? []), d]);
  const waitingOnly = new Map<string, Decision[]>();
  for (const d of opts.queued) {
    if (d.level === 'polish' || (d.candidate && ids.has(d.candidate)) || byWork.has(d.trigger)) continue;
    waitingOnly.set(d.trigger, [...(waitingOnly.get(d.trigger) ?? []), d]);
  }
  const areas = new Map(known.filter((c) => c.feature).map((c) => [c.feature!.toLowerCase(), c.feature!]));
  for (const [trigger, ds] of [...byWork, ...waitingOnly]) {
    const last = ds.reduce((a, b) => (a.date > b.date ? a : b));
    const id = workId(trigger);
    const shot = workSnapshot(paths, id);
    candidates.push({
      // Work has no product area of its own; it joins one only when the trigger names an existing one.
      id, name: trigger, feature: areas.get(trigger.toLowerCase()) ?? null, state: 'recorded', work: true,
      author: last.author, date: last.date, reason: null, notes: '', supersededBy: null, url: null,
      snapshot: shot ? `${opts.pictures}${path.basename(shot)}` : null,
      decisions: ds.filter(shown).map(toDecision),
    });
  }
  // The day each became a rule, for the Design rules page.
  const rules = opts.includeRules ? readActive(paths).map((r) => ({ id: r.id, dimension: r.dimension, decision: r.decision, rationale: r.rationale, candidate: r.candidate ?? null, date: r.date.slice(0, 10) })) : null;
  // The owner's answers to the team's change requests, so a thread shows the answer under its request.
  const requests: BoardRequest[] = readRequests(paths)
    .filter((r) => r.status !== 'open')
    .map((r) => ({
      comment: r.comment,
      id: r.id,
      status: r.status as BoardRequest['status'],
      instead: r.instead,
      reason: r.reason,
      by: r.judgedBy,
      at: r.appliedAt ?? r.judgedAt,
      decisions: r.decisions.flatMap((id) => {
        const d = archive.find((x) => x.id === id);
        return d ? [{ id: d.id, change: d.change ?? d.decision, card: cardOf(paths, d, ids) }] : [];
      }),
    }));
  return { project: path.basename(paths.root), exported: new Date().toISOString().slice(0, 10), candidates, rules, requests };
}

/**
 * What `/api/board` sends: the board, plus what only this machine knows: what's waiting for review,
 * and the team's comments as the last `pull` brought them.
 */
export function liveBoard(paths: Paths): LocalBoard {
  const queued = readPending(paths);
  const board = boardOf(paths, { pictures: '/snapshots/', includeRules: true, queued });
  const ids = new Set(readCandidates(paths).map((c) => c.id));
  const waiting: Record<string, number> = {};
  // Enough of each to draw a card and place it in its area before anything on it is judged.
  const lines: Record<string, QueuedLine[]> = {};
  for (const d of queued) {
    if (d.level === 'polish') continue;
    const card = cardOf(paths, d, ids);
    waiting[card] = (waiting[card] ?? 0) + 1;
    (lines[card] ??= []).push({ id: d.id, change: d.change ?? null, decision: d.decision, dimension: d.dimension, scope: d.scope });
  }
  const link = readLinkOrNull(paths);
  return { board, comments: readComments(paths), waiting, queued: lines, pending: queued.length, hosted: link?.shareUrl ?? null, version: link?.boardVersion ?? null, live: true };
}

/** What `/api/state` sends: the review queue. */
export function reviewState(paths: Paths, agent: Agent): ReviewState {
  const candidates = readCandidates(paths);
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const ids = new Set(byId.keys());
  const active = readActive(paths);
  // The card a decision is on: its picture, a screen's or a piece of work's.
  const shotOf = (card: string) => {
    if (card.startsWith('C-')) {
      const c = byId.get(card);
      return c?.snapshot ? `/snapshots/${c.snapshot}` : null;
    }
    const f = workSnapshot(paths, card);
    return f ? `/snapshots/${path.basename(f)}` : null;
  };
  const pending: PendingDecision[] = readPending(paths).map((d) => {
    // The card it waits on, so a change marked Waiting can open the Review inbox at its work.
    const card = cardOf(paths, d, ids);
    return {
      ...d,
      card,
      // The rule a clash is with, while it's still in force: the page offers Follow / Replace / Keep as exception.
      againstRule: d.against ? active.filter((r) => r.id === d.against).map((r) => ({ id: r.id, decision: r.decision }))[0] ?? null : null,
      candidateName: d.candidate ? byId.get(d.candidate)?.name ?? null : null,
      // Its card's picture, so what changed is in view where it's judged.
      snapshotUrl: shotOf(card),
      picture: missingPictures(paths, [d], candidates)[0] ?? null,
    };
  });
  return { project: path.basename(paths.root), pending, active: active.length, cap: readConfig(paths)?.activeCap ?? ACTIVE_CAP, agent };
}
