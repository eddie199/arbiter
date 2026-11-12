/**
 * What a change's page can do to one of its decisions, beside what Design rules does to a rule: fix
 * the words of its Change line, make a decision you only confirmed a rule, and put back a decision
 * removed from the page by mistake. Removing one is `remove`; a rule is retired instead.
 */

import { ACTIVE_CAP, findRoot, now, readActive, readArchive, readConfig, resolvePaths, writeActive, writeArchive } from '../store';
import { DECISION_ID, type Decision } from '../schema';
import { explainOverlaps, findOverlaps } from '../overlap';
import { refreshCandidates } from './candidate';
import { readCandidates } from '../candidates';

export interface DecisionResult { exitCode: 0 | 1 | 2 | 3; output: Record<string, unknown> }

const fail = (errors: string[]): DecisionResult => ({ exitCode: 1, output: { status: 'invalid', errors } });

/**
 * New words for what happened, the Change line, on a decision that isn't a rule (a rule's own words are
 * reworded on Design rules). The id stays; the old words stay on the entry, under Reworded, so editing
 * tidies the wording without quietly changing what was decided.
 */
export function editChange(id: string, to: string | undefined, opts: { cwd?: string } = {}): DecisionResult {
  if (!DECISION_ID.test(id)) return fail([`not a decision id: ${id} (looks like D-0003)`]);
  const next = to?.replace(/\s+/g, ' ').trim();
  if (!next) return fail(['say what changed, in one line']);
  const paths = resolvePaths(findRoot(opts.cwd));
  const archive = readArchive(paths);
  const entry = archive.find((d) => d.id === id);
  if (!entry) return fail([`${id} is not in the record`]);
  const was = entry.change ?? entry.decision;
  if (next === was) return fail([`${id} already says that`]);
  const edited: Decision = { ...entry, change: next, reworded: [...entry.reworded, `Change was: ${was} (until ${now().slice(0, 10)})`] };
  writeArchive(paths, archive.map((d) => (d.id === id ? edited : d)));
  // A rule's entry in DECISIONS.md carries its Change line too.
  const active = readActive(paths);
  if (active.some((d) => d.id === id)) writeActive(paths, active.map((d) => (d.id === id ? { ...d, change: next, reworded: edited.reworded } : d)), readConfig(paths)?.activeCap ?? ACTIVE_CAP);
  if (entry.candidate) refreshCandidates(paths);
  return { exitCode: 0, output: { status: 'edited', id, change: next } };
}

/**
 * Make it a rule, for a decision you only confirmed: the same entry, now a rule in DECISIONS.md, so its
 * id and its page stay as they are. Checked against the rules already there, as any new rule is: an
 * overlap comes back (exit 2) to keep both or replace one, and a full DECISIONS.md (exit 3) waits for room.
 */
export function promote(id: string, opts: { cwd?: string; keepBoth?: boolean; supersedes?: string } = {}): DecisionResult {
  if (!DECISION_ID.test(id)) return fail([`not a decision id: ${id} (looks like D-0003)`]);
  const paths = resolvePaths(findRoot(opts.cwd));
  const archive = readArchive(paths);
  const entry = archive.find((d) => d.id === id);
  if (!entry) return fail([`${id} is not in the record`]);
  let active = readActive(paths);
  if (active.some((d) => d.id === id)) return fail([`${id} is a rule already`]);
  if (entry.verdict !== 'accept' && entry.verdict !== 'fix') return fail([`${id} can't become a rule`]);
  const config = readConfig(paths);
  const cap = config?.activeCap ?? ACTIVE_CAP;
  if (opts.supersedes) {
    if (!active.some((d) => d.id === opts.supersedes)) return fail([`${opts.supersedes} is not an active rule`]);
    active = active.filter((d) => d.id !== opts.supersedes);
  } else if (!opts.keepBoth) {
    const overlaps = findOverlaps(entry, active, { ignore: config?.overlap?.ignore });
    // Each with why, as the Review inbox has it: what both apply to (a sure match), or the words they share
    // (a guess), so a guess doesn't read as sure.
    if (overlaps.length) return { exitCode: 2, output: { status: 'overlap', overlaps: explainOverlaps(entry, overlaps, active, new Map(readCandidates(paths).map((c) => [c.id, c.name]))) } };
  }
  // Full: the rules there, so one can be picked for this to replace without leaving the page.
  if (active.length >= cap) return { exitCode: 3, output: { status: 'cap', cap, active: active.map((d) => ({ id: d.id, decision: d.decision })), errors: [`DECISIONS.md is full (${cap} rules). Remove one first, or raise the limit in Preferences.`] } };
  const rule: Decision = { ...entry, verdict: 'rule', ...(opts.supersedes ? { supersedes: opts.supersedes } : {}) };
  writeArchive(paths, archive.map((d) => (d.id === id ? rule : d)));
  writeActive(paths, [...active, rule], cap);
  if (rule.candidate) refreshCandidates(paths);
  return { exitCode: 0, output: { status: 'rule', id, active: `${active.length + 1} of ${cap}`, ...(opts.supersedes ? { replaced: opts.supersedes } : {}) } };
}

/** Undo for a decision removed on the board: back in the record where it was. */
export function restoreDecision(r: { entry: Decision; index: number }, opts: { cwd?: string } = {}): DecisionResult {
  const paths = resolvePaths(findRoot(opts.cwd));
  const archive = readArchive(paths);
  if (archive.some((d) => d.id === r.entry.id)) return fail([`${r.entry.id} is in the record already`]);
  const next = [...archive];
  next.splice(Math.min(r.index, next.length), 0, r.entry);
  writeArchive(paths, next);
  if (r.entry.candidate) refreshCandidates(paths);
  return { exitCode: 0, output: { status: 'restored', id: r.entry.id } };
}
