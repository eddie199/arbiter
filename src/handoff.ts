/**
 * The handoff: what you decided in one sitting on the Review Board, for the agent to act on.
 *
 * The page records each answer as you give it. What it can't do is change code, so a Fix, a
 * "Follow D-0009" and an approved request wait on the agent. When the agent opened the page and is
 * waiting (`review --json`), it gets this when you press Done. When you opened the page yourself,
 * it's saved to .arbiter/last-review.json, and the next /arbiter picks it up.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './store';

/** One answer the page gave, as the server saw it go through. */
export type Answer =
  | { kind: 'decision'; pending: string; as: 'accept' | 'rule' | 'skip' | 'fix'; id?: string; change?: string; to?: string; follows?: string }
  | { kind: 'request'; id: string; status: 'approved' | 'declined'; author: string; screenName: string | null; do?: string; reason?: string }
  | { kind: 'option'; id: string; name: string; state: string };

/** What's left for the agent: the code side of an answer. */
export type Todo =
  /** Fix: the decision is recorded with your wording; the code still does what was rejected. */
  | { kind: 'fix'; id: string; change: string; to: string }
  /** Follow D-0009: recorded; the code goes back to what the rule says. */
  | { kind: 'follow'; id: string; rule: string; to: string }
  /** An approved request: made, then recorded with --request. */
  | { kind: 'request'; id: string; author: string; screen: string | null; do: string };

export interface Handoff {
  /** `done`: you pressed Done. `closed`: the page was stopped some other way, part way through perhaps. */
  finished: 'done' | 'closed';
  at: string;
  /** Recorded decisions, by id. */
  confirmed: string[];
  rules: string[];
  fixed: string[];
  /** Pending ids dropped from the queue. */
  skipped: string[];
  declined: { id: string; author: string; reason: string }[];
  options: { id: string; name: string; state: string }[];
  todo: Todo[];
  next: string;
}

const FILE = 'last-review.json';

export function summarize(answers: Answer[], finished: Handoff['finished'], at = new Date().toISOString()): Handoff {
  const h: Handoff = { finished, at, confirmed: [], rules: [], fixed: [], skipped: [], declined: [], options: [], todo: [], next: '' };
  for (const a of answers) {
    if (a.kind === 'option') h.options.push({ id: a.id, name: a.name, state: a.state });
    else if (a.kind === 'request') {
      if (a.status === 'declined') h.declined.push({ id: a.id, author: a.author, reason: a.reason ?? '' });
      else h.todo.push({ kind: 'request', id: a.id, author: a.author, screen: a.screenName, do: a.do ?? '' });
    } else if (a.as === 'skip') h.skipped.push(a.pending);
    else if (a.as === 'accept') h.confirmed.push(a.id ?? a.pending);
    else if (a.as === 'rule') h.rules.push(a.id ?? a.pending);
    else {
      h.fixed.push(a.id ?? a.pending);
      const id = a.id ?? a.pending;
      if (a.follows) h.todo.push({ kind: 'follow', id, rule: a.follows, to: a.to ?? '' });
      else h.todo.push({ kind: 'fix', id, change: a.change ?? '', to: a.to ?? '' });
    }
  }
  h.next = nextStep(h);
  return h;
}

function nextStep(h: Handoff): string {
  if (!h.todo.length) return 'Nothing to change in the code.';
  return "Make each change in todo. They're recorded already, so don't judge or record them again. An approved request is the exception: record its change with --request <id> once it's made.";
}

/** Anything decided at all. A sitting where nothing was answered hands nothing over. */
export const decidedAnything = (h: Handoff): boolean =>
  !!(h.confirmed.length || h.rules.length || h.fixed.length || h.skipped.length || h.declined.length || h.options.length || h.todo.length);

/** One line for the person at the terminal, when nobody's waiting on the JSON. */
export function handoffLine(h: Handoff): string | null {
  if (!decidedAnything(h)) return null;
  const parts = [
    h.confirmed.length && `${h.confirmed.length} confirmed`,
    h.rules.length && `${h.rules.length} made ${h.rules.length === 1 ? 'a rule' : 'rules'}`,
    h.fixed.length && `${h.fixed.length} fixed`,
    h.skipped.length && `${h.skipped.length} skipped`,
  ].filter(Boolean);
  const said = parts.length ? `Recorded: ${parts.join(', ')}.` : 'Recorded.';
  if (!h.todo.length) return said;
  return `${said} ${h.todo.length} ${h.todo.length === 1 ? 'change waits' : 'changes wait'} for your agent, which picks ${h.todo.length === 1 ? 'it' : 'them'} up at the next /arbiter.`;
}

/**
 * An earlier sitting nobody acted on, then this one: a second sitting adds to the first rather
 * than replacing it, so nothing waiting on the agent is lost.
 */
export function mergeHandoffs(earlier: Handoff | null, h: Handoff): Handoff {
  if (!earlier) return h;
  const merged: Handoff = {
    ...h,
    confirmed: [...earlier.confirmed, ...h.confirmed],
    rules: [...earlier.rules, ...h.rules],
    fixed: [...earlier.fixed, ...h.fixed],
    skipped: [...earlier.skipped, ...h.skipped],
    declined: [...earlier.declined, ...h.declined],
    options: [...earlier.options, ...h.options],
    todo: [...earlier.todo, ...h.todo],
  };
  merged.next = nextStep(merged);
  return merged;
}

/**
 * Saved for the next /arbiter, which reads it with the queue. Kept out of git: it's one person's
 * sitting, and a teammate's agent mustn't make it.
 */
export function saveHandoff(paths: Paths, h: Handoff): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.writeFileSync(path.join(paths.archiveDir, FILE), JSON.stringify(h, null, 2) + '\n');
  const gi = path.join(paths.archiveDir, '.gitignore');
  const lines = (fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '').split('\n').filter(Boolean);
  if (!lines.includes(FILE)) fs.writeFileSync(gi, [...lines, FILE].join('\n') + '\n');
}

/** Handed over: the agent has it, so the next /arbiter mustn't make it a second time. */
export function clearHandoff(paths: Paths): void {
  fs.rmSync(path.join(paths.archiveDir, FILE), { force: true });
}

export function readHandoff(paths: Paths): Handoff | null {
  const f = path.join(paths.archiveDir, FILE);
  if (!fs.existsSync(f)) return null;
  try {
    return JSON.parse(fs.readFileSync(f, 'utf8')) as Handoff;
  } catch {
    return null;
  }
}

export const HANDOFF_FILE = `.arbiter/${FILE}`;
