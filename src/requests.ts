/**
 * Requests — someone on the board asked for a change, and it has to go somewhere.
 *
 * A comment is input: it sits in .arbiter/comments.json until the owner points at it. A request
 * is a comment that asks for something, so it gets a status and an answer:
 *
 *   open      pulled, nobody has answered it
 *   approved  the owner said Apply (or Apply, but…) — the agent makes the change at the next /arbiter
 *   applied   the change is in the code and recorded; `decisions` says which records did it
 *   declined  the owner said no, with a reason the requester reads on the board
 *
 * Nothing moves without the owner: pull opens them, only the owner approves or declines, and only
 * an approved request can be applied. The board never writes here — publish carries the answers
 * back as part of the board.
 *
 * .arbiter/requests.json, committed, so everyone on the project sees the same answers.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Decision } from './schema';
import type { PulledComment } from './hosted';
import { readCandidates } from './candidates';
import { Paths, readArchive } from './store';
import { workId } from './work';

export const REQUEST_ID = /^R-\d{4,}$/;
export const REQUEST_STATUSES = ['open', 'approved', 'applied', 'declined'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export interface ChangeRequest {
  /** R-0001, sequential. */
  id: string;
  /** The board comment it came from. The board matches its answer to this. */
  comment: string;
  /** The card it was asked on: a candidate (C-0002) or a piece of work (W-settings-billing). */
  screen: string;
  /** The decision it was asked about, when it was asked on one. */
  decision: string | null;
  /** Who asked. */
  author: string;
  /** What they asked, in their words. */
  body: string;
  /** When they asked. */
  date: string;
  /** The board version they were looking at. */
  boardVersion: string | null;
  status: RequestStatus;
  /** Apply, but… — what the owner said to do instead. */
  instead: string | null;
  /** Decline — why not. The requester reads it. */
  reason: string | null;
  /** Who approved or declined it, and when. */
  judgedBy: string | null;
  judgedAt: string | null;
  /** The decisions recorded making the change. */
  decisions: string[];
  appliedAt: string | null;
}

const FILE = 'requests.json';

export function readRequests(paths: Paths): ChangeRequest[] {
  const f = path.join(paths.archiveDir, FILE);
  if (!fs.existsSync(f)) return [];
  // Committed and rewritten on every pull, so a merge conflict is the likely way it breaks: say so
  // plainly, before any command has written anything else.
  try {
    const all = JSON.parse(fs.readFileSync(f, 'utf8'));
    if (!Array.isArray(all)) throw new Error('not a list');
    return all as ChangeRequest[];
  } catch (e) {
    throw new Error(`.arbiter/requests.json can't be read (${(e as Error).message.split('\n')[0]}) — a merge conflict? Fix the file, then run this again.`);
  }
}

export function writeRequests(paths: Paths, requests: ChangeRequest[]): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.writeFileSync(path.join(paths.archiveDir, FILE), JSON.stringify(requests, null, 2) + '\n');
}

export function nextRequestId(requests: ChangeRequest[]): string {
  const max = requests.reduce((m, r) => Math.max(m, Number(r.id.slice(2))), 0);
  return `R-${String(max + 1).padStart(4, '0')}`;
}

/**
 * Every request comment that isn't a request here yet becomes one, open. Keyed on the comment,
 * so pulling twice — or two people pulling the same board — never asks the owner twice.
 */
export function openRequests(paths: Paths, comments: PulledComment[]): ChangeRequest[] {
  const all = readRequests(paths);
  const seen = new Set(all.map((r) => r.comment));
  const added: ChangeRequest[] = [];
  for (const c of comments) {
    // A request with no words, or not attached to a card, is nothing to answer — and saving it would
    // break every later read of the queue.
    if (c.kind !== 'request' || seen.has(c.id) || typeof c.body !== 'string' || !c.body.trim() || typeof c.candidate_id !== 'string' || !c.candidate_id) continue;
    const r: ChangeRequest = {
      id: nextRequestId(all),
      comment: c.id,
      screen: c.candidate_id,
      decision: c.decision_id,
      author: c.author_name,
      body: c.body.trim(),
      date: c.created_at,
      boardVersion: c.board_version ?? null,
      status: 'open',
      instead: null,
      reason: null,
      judgedBy: null,
      judgedAt: null,
      decisions: [],
      appliedAt: null,
    };
    all.push(r);
    added.push(r);
    seen.add(c.id);
  }
  if (added.length) writeRequests(paths, all);
  return added;
}

/**
 * A decision is leaving the record (`remove`). If a request was applied by it, the request no
 * longer is. With nothing left doing it, it goes back to open — not approved: the owner removed
 * that record for a reason, and an approved request is one the agent makes without asking.
 */
export function detachDecision(paths: Paths, decisionId: string): ChangeRequest[] {
  const all = readRequests(paths);
  const touched = all.filter((r) => r.decisions.includes(decisionId));
  if (!touched.length) return [];
  const next = all.map((r): ChangeRequest => {
    if (!r.decisions.includes(decisionId)) return r;
    const decisions = r.decisions.filter((d) => d !== decisionId);
    return decisions.length ? { ...r, decisions } : { ...r, decisions, status: 'open', instead: null, judgedBy: null, judgedAt: null, appliedAt: null };
  });
  writeRequests(paths, next);
  return next.filter((r) => touched.some((t) => t.comment === r.comment));
}

/** Replace one request, found by its comment — unique, where a hand-merged file could repeat an id. */
export function replaceRequest(paths: Paths, all: ChangeRequest[], next: ChangeRequest): void {
  writeRequests(paths, all.map((x) => (x.comment === next.comment ? next : x)));
}

/** One line, however it was typed on the board — for places that need a single line. */
export const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

/**
 * What a card is called. A candidate by its name; a piece of work by the trigger its decisions
 * share — the same name to use as the trigger when recording the change, so it lands on that card.
 */
export function screenName(paths: Paths, screen: string, archive: Decision[] = readArchive(paths)): string | null {
  if (typeof screen !== 'string') return null;
  if (screen.startsWith('C-')) return readCandidates(paths).find((c) => c.id === screen)?.name ?? null;
  return archive.find((d) => workId(d.trigger) === screen)?.trigger ?? null;
}

/** The card a recorded decision shows on: its candidate if that's still a screen, else its piece of work. */
export function cardOf(paths: Paths, d: Decision, candidateIds: Set<string> = new Set(readCandidates(paths).map((c) => c.id))): string {
  return d.candidate && candidateIds.has(d.candidate) ? d.candidate : workId(d.trigger);
}

/** A request as the queue shows it: who asked what, where, and whether the board has moved on since. */
export function describe(paths: Paths, r: ChangeRequest, boardVersion: string | null, archive: Decision[] = readArchive(paths)) {
  return {
    id: r.id,
    author: r.author,
    body: r.body,
    screen: r.screen,
    screenName: screenName(paths, r.screen, archive),
    decision: r.decision,
    // What that decision says, so the question can show it without another lookup.
    decisionText: r.decision ? (archive.find((d) => d.id === r.decision)?.decision ?? null) : null,
    date: r.date,
    // Asked about a board that has since been republished — what they saw may already have changed.
    earlierVersion: !!(r.boardVersion && boardVersion && r.boardVersion !== boardVersion),
    status: r.status,
    instead: r.instead,
    // Approved: what the agent is to make — the ask, or what the owner said instead.
    ...(r.status === 'approved' && { do: r.instead ?? r.body }),
  };
}
