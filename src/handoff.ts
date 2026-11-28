/**
 * The handoff: what you decided on the local board, for the agent to act on.
 *
 * The page records each answer as you give it. What it can't do is change code, so a Fix, a
 * "Follow D-0009" and an approved request wait on the agent, in .arbiter/last-review.json, added to
 * as you go. So does a rule edited or removed on Design rules, since the agent may have read
 * DECISIONS.md before you changed it. The agent takes it with your next message in Claude Code (a
 * hook tells it: see templates/hooks), or at the next /arbiter anywhere. What it was told is kept
 * beside it (last-review.seen.json), and once it's made, `arbiter review --done` clears just that:
 * anything you judged while it worked stays for next time. An agent waiting on the page
 * (`review --json`) gets it when the last tab closes instead.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './store';
import { writeAtomic } from './lock';

/** One answer the page gave, as the server saw it go through. */
export type Answer =
  | { kind: 'decision'; pending: string; as: 'accept' | 'rule' | 'skip' | 'fix'; id?: string; change?: string; to?: string; follows?: string }
  | { kind: 'request'; id: string; status: 'approved' | 'declined'; author: string; screenName: string | null; do?: string; reason?: string }
  | { kind: 'option'; id: string; name: string; state: string }
  /** On Design rules: a rule's new words, a rule removed and why, and a removed one put back. */
  | { kind: 'reword'; id: string; to: string }
  | { kind: 'retire'; id: string; rule: string; why: string }
  | { kind: 'restore'; id: string }
  /** On a change's page: a piece of work renamed, so the agent's next decisions use the new name. */
  | { kind: 'rename'; from: string; to: string }
  /** On a change's page: a decision you'd confirmed, made a rule. In force from now, as any new rule. */
  | { kind: 'rule'; id: string };

/** What's left for the agent: the code side of an answer. */
export type Todo =
  /** Fix: the decision is recorded with your wording; the code still does what was rejected. */
  | { kind: 'fix'; id: string; change: string; to: string }
  /** Follow D-0009: recorded; the code goes back to what the rule says. */
  | { kind: 'follow'; id: string; rule: string; to: string }
  /** An approved request: made, then recorded with --request. */
  | { kind: 'request'; id: string; author: string; screen: string | null; do: string };

export interface Handoff {
  /** `done`: you closed the board's last tab. `closed`: it was stopped some other way, part way through perhaps. */
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
  /** Rules edited on Design rules, with what each says now. Missing from a file written before there were any. */
  reworded?: { id: string; to: string }[];
  /** Rules removed there, with what each said and why: no longer in force. `edited`: new words the agent hadn't heard of yet, for Undo to bring back. */
  removed?: { id: string; rule: string; why: string; edited?: string }[];
  /** Work renamed on a change's page: the agent uses `to` as the trigger from now on. */
  renamed?: { from: string; to: string }[];
  todo: Todo[];
  next: string;
  /** Written by Arbiter before 0.1.9: the hook had told the agent. What it was told is in SEEN now. */
  told?: boolean;
}

export const FILE = 'last-review.json';
/** What the agent was told, as it was told it: what `review --done` clears, and nothing judged since. */
export const SEEN = 'last-review.seen.json';

export function summarize(answers: Answer[], finished: Handoff['finished'], at = new Date().toISOString()): Handoff {
  const h: Handoff = { finished, at, confirmed: [], rules: [], fixed: [], skipped: [], declined: [], options: [], reworded: [], removed: [], renamed: [], todo: [], next: '' };
  for (const a of answers) {
    if (a.kind === 'option') h.options.push({ id: a.id, name: a.name, state: a.state });
    else if (a.kind === 'rename') h.renamed = renames(h.renamed ?? [], [{ from: a.from, to: a.to }]);
    // A rule back in DECISIONS.md after the agent heard it was gone is in force again, as a new one is.
    else if (a.kind === 'restore' || a.kind === 'rule') h.rules.push(a.id);
    else if (a.kind === 'reword' || a.kind === 'retire') rulesChanged(h, a.kind === 'reword' ? [{ id: a.id, to: a.to }] : [], a.kind === 'retire' ? [{ id: a.id, rule: a.rule, why: a.why }] : []);
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

/**
 * Only a rule's latest words count, and none for a rule removed since. Those go with the removal,
 * so a removal put back brings them back too.
 */
function rulesChanged(h: Handoff, reworded: NonNullable<Handoff['reworded']>, removed: NonNullable<Handoff['removed']>): void {
  const was = h.reworded ?? [];
  const later = new Set([...reworded, ...removed].map((r) => r.id));
  h.reworded = [...was.filter((r) => !later.has(r.id)), ...reworded];
  // Made a rule and removed again: the removal is what's true now.
  h.rules = h.rules.filter((id) => !removed.some((r) => r.id === id));
  h.removed = [...(h.removed ?? []), ...removed.map((r) => {
    const edited = was.find((x) => x.id === r.id)?.to;
    return edited ? { ...r, edited } : r;
  })];
}

/** Renamed twice, A to B then B to C: one rename, A to C. Renamed back: none. */
function renames(was: { from: string; to: string }[], next: { from: string; to: string }[]): { from: string; to: string }[] {
  let out = [...was];
  for (const r of next) {
    const before = out.find((x) => x.to === r.from);
    out = out.filter((x) => x !== before);
    const from = before ? before.from : r.from;
    if (from !== r.to) out.push({ from, to: r.to });
  }
  return out;
}

function nextStep(h: Handoff): string {
  const rules = (h.reworded?.length || h.removed?.length ? ' Rules were edited or removed on Design rules: follow DECISIONS.md as it is now.' : '')
    + (h.renamed?.length ? ' Work was renamed on the board: use each new name as the trigger from now on.' : '');
  if (!h.todo.length) return `Nothing to change in the code.${rules}`;
  return `Make each change in todo. They're recorded already, so don't judge or record them again. An approved request is the exception: record its change with --request <id> once it's made.${rules}`;
}

/** Anything decided at all. A sitting where nothing was answered hands nothing over. */
export const decidedAnything = (h: Handoff): boolean =>
  !!(h.confirmed.length || h.rules.length || h.fixed.length || h.skipped.length || h.declined.length || h.options.length || h.reworded?.length || h.removed?.length || h.renamed?.length || h.todo.length);

/** One line for the person at the terminal, when nobody's waiting on the JSON. `when` is when the agent hears of it. */
export function handoffLine(h: Handoff, when = 'at the next /arbiter'): string | null {
  if (!decidedAnything(h)) return null;
  const parts = [
    h.confirmed.length && `${h.confirmed.length} confirmed`,
    h.rules.length && `${h.rules.length} made ${h.rules.length === 1 ? 'a rule' : 'rules'}`,
    h.fixed.length && `${h.fixed.length} fixed`,
    h.skipped.length && `${h.skipped.length} skipped`,
    h.reworded?.length && `${h.reworded.length} ${h.reworded.length === 1 ? 'rule' : 'rules'} edited`,
    h.removed?.length && `${h.removed.length} ${h.removed.length === 1 ? 'rule' : 'rules'} removed`,
    h.renamed?.length && `${h.renamed.length} renamed`,
  ].filter(Boolean);
  const said = parts.length ? `Recorded: ${parts.join(', ')}.` : 'Recorded.';
  if (!h.todo.length) return said;
  return `${said} ${h.todo.length} ${h.todo.length === 1 ? 'change waits' : 'changes wait'} for your agent, which picks ${h.todo.length === 1 ? 'it' : 'them'} up ${when}.`;
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
    reworded: earlier.reworded ?? [],
    removed: earlier.removed ?? [],
    renamed: renames(earlier.renamed ?? [], h.renamed ?? []),
    todo: [...earlier.todo, ...h.todo],
  };
  rulesChanged(merged, h.reworded ?? [], h.removed ?? []);
  merged.next = nextStep(merged);
  return merged;
}

/**
 * Saved for the next /arbiter, which reads it with the queue. Kept out of git: it's one person's
 * sitting, and a teammate's agent mustn't make it.
 */
export function saveHandoff(paths: Paths, h: Handoff): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  // The next step names the rules file as DECISIONS.md; a project whose rules are elsewhere hears its own.
  const rules = path.basename(paths.decisions);
  const named = rules === 'DECISIONS.md' || !h.next ? h : { ...h, next: h.next.split('DECISIONS.md').join(rules) };
  writeAtomic(path.join(paths.archiveDir, FILE), JSON.stringify(named, null, 2) + '\n');
  const gi = path.join(paths.archiveDir, '.gitignore');
  const lines = (fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '').split(/\r?\n/).filter(Boolean);
  const missing = [FILE, SEEN].filter((x) => !lines.includes(x));
  if (missing.length) fs.writeFileSync(gi, [...lines, ...missing].join('\n') + '\n');
}

/**
 * What's waiting, handed to the agent: kept as it was given (SEEN), so `review --done` clears that and
 * no more. The Claude Code hook keeps the same copy when it speaks.
 */
export function takeHandoff(paths: Paths): Handoff | null {
  const h = readHandoff(paths);
  if (h) writeAtomic(path.join(paths.archiveDir, SEEN), JSON.stringify(h, null, 2) + '\n');
  return h;
}

/**
 * The agent has made what it was told: that comes out of the file. Anything judged on the board since
 * stays, for the hook to say at the next message. Nothing handed over yet: nothing is cleared.
 */
export function handoffDone(paths: Paths): { status: 'done' | 'nothing' | 'not-taken'; left: number; errors?: string[] } {
  const h = readHandoff(paths);
  const seenFile = path.join(paths.archiveDir, SEEN);
  let seen: Handoff | null = null;
  try { seen = JSON.parse(fs.readFileSync(seenFile, 'utf8')) as Handoff; } catch { /* never handed over */ }
  if (!h) {
    fs.rmSync(seenFile, { force: true });
    return { status: 'nothing', left: 0 };
  }
  if (!seen) return { status: 'not-taken', left: h.todo.length, errors: ['Nothing was handed over yet, so nothing was cleared: read it first with npx arbiter rules --pending --json'] };
  const key = (x: unknown) => JSON.stringify(x);
  const minus = <T>(now: T[] | undefined, was: T[] | undefined): T[] => {
    const gone = new Set((was ?? []).map(key));
    return (now ?? []).filter((x) => !gone.has(key(x)));
  };
  const { told: _told, ...rest } = h;
  const left: Handoff = {
    ...rest,
    confirmed: minus(h.confirmed, seen.confirmed),
    rules: minus(h.rules, seen.rules),
    fixed: minus(h.fixed, seen.fixed),
    skipped: minus(h.skipped, seen.skipped),
    declined: minus(h.declined, seen.declined),
    options: minus(h.options, seen.options),
    reworded: minus(h.reworded, seen.reworded),
    removed: minus(h.removed, seen.removed),
    renamed: minus(h.renamed, seen.renamed),
    todo: minus(h.todo, seen.todo),
  };
  left.next = nextStep(left);
  if (decidedAnything(left)) saveHandoff(paths, left);
  else clearHandoff(paths);
  fs.rmSync(seenFile, { force: true });
  return { status: 'done', left: left.todo.length };
}

/**
 * One answer, added to what's already waiting. Added, never rewritten from the sitting: the agent
 * may have taken the file and made it while the board was still open, and a rewrite would hand
 * those changes over a second time.
 */
export function saveAnswer(paths: Paths, a: Answer): void {
  const h = mergeHandoffs(readHandoff(paths), summarize([a], 'closed'));
  if (decidedAnything(h)) saveHandoff(paths, h);
}

/**
 * An answer taken back on the page: out of what's waiting, so the agent never acts on it. False when
 * the agent has taken it already, and may have made the change.
 */
export function withdrawAnswer(paths: Paths, a: Extract<Answer, { kind: 'decision' }>): boolean {
  const h = readHandoff(paths);
  const id = a.as === 'skip' ? a.pending : a.id ?? a.pending;
  const list = a.as === 'skip' ? 'skipped' : a.as === 'accept' ? 'confirmed' : a.as === 'rule' ? 'rules' : 'fixed';
  if (!h?.[list].includes(id)) return false;
  // Rewritten as it is otherwise, `told` and all: taking one back is nothing new for the hook to say.
  const next: Handoff = { ...h, [list]: h[list].filter((x) => x !== id), todo: h.todo.filter((t) => t.kind === 'request' || t.id !== id) };
  next.next = nextStep(next);
  if (decidedAnything(next)) saveHandoff(paths, next);
  else clearHandoff(paths);
  return true;
}

/** A removal put back on the page: out of what's waiting. False when the agent has heard of it already. */
export function withdrawRemoval(paths: Paths, id: string): boolean {
  const h = readHandoff(paths);
  const gone = h?.removed?.find((r) => r.id === id);
  if (!h || !gone) return false;
  const next: Handoff = {
    ...h,
    removed: h.removed!.filter((r) => r.id !== id),
    ...(gone.edited && { reworded: [...(h.reworded ?? []), { id, to: gone.edited }] }),
  };
  next.next = nextStep(next);
  if (decidedAnything(next)) saveHandoff(paths, next);
  else clearHandoff(paths);
  return true;
}

/** Handed over: the agent has it, so the next /arbiter mustn't make it a second time. */
export function clearHandoff(paths: Paths): void {
  fs.rmSync(path.join(paths.archiveDir, FILE), { force: true });
  fs.rmSync(path.join(paths.archiveDir, SEEN), { force: true });
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
export const HANDOFF_NAME = FILE;
