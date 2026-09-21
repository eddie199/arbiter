/**
 * `arbiter record` — the act verb.
 *
 *   record '<json>'                 append a decision now
 *   record --pending '<json>'       queue it in .arbiter/pending.md for later judgment
 *   record P-0003 --as rule         judge a queued decision (accept | rule | skip | fix --to "<what instead>")
 *   record --all --as accept        judge every queued decision the same way  [--level polish] [--trigger "…"]
 *   record --retire D-0003 --why "…"  drop a rule from DECISIONS.md with no replacement; the archive keeps both
 *   record                          (a person at a terminal) walk through it step by step
 *
 * Output is JSON on stdout, always — an agent is usually on the other end.
 *
 * Exit codes:
 *   0  recorded / queued / skipped
 *   1  invalid input or I/O error
 *   2  overlap — nothing written, caller must answer with --supersedes or --keep-both
 *   3  active cap reached — nothing written
 *   4  contradicted — the files named don't match the claim; nothing written (override with --unverified)
 */

import os from 'node:os';
import path from 'node:path';
import { Decision, DecisionInput, DIMENSIONS, PENDING_ID, validateInput, ValidateOptions } from '../schema';
import {
  ACTIVE_CAP,
  appendArchive,
  currentCommit,
  findRoot,
  gitUserName,
  nextId,
  nextPendingId,
  now,
  readActive,
  readArchive,
  readConfig,
  readPending,
  resolvePaths,
  writeActive,
  writePending,
} from '../store';
import { findOverlaps } from '../overlap';
import { checkable, verify } from '../verify';
import { sweep, summarize } from '../sweep';
import { parseFindings, toDecisionInput } from '../findings';
import { Prompter } from './prompt';
import fs from 'node:fs';
import { refreshCandidates } from './candidate';

export interface RecordOptions {
  supersedes?: string;
  /** The ticket this was for: a URL or an issue key. Applies to every item in a bulk judge. */
  ref?: string;
  keepBoth?: boolean;
  author?: string;
  dryRun?: boolean;
  /** Record even if the files contradict the claim. */
  unverified?: boolean;
  candidate?: string;
  cwd?: string;
}

export type JudgeAction = 'accept' | 'rule' | 'skip' | 'fix';

export interface JudgeOptions extends RecordOptions {
  as: JudgeAction;
  /** For `fix`: the corrected decision. */
  to?: string;
}

export interface RecordResult {
  exitCode: 0 | 1 | 2 | 3 | 4;
  output: Record<string, unknown>;
}

// ── Parse + record ─────────────────────────────────────────────────────────

export function record(rawJson: string, opts: RecordOptions = {}): RecordResult {
  const parsed = parse(rawJson);
  if (!parsed.ok) return parsed.result;
  return recordInput(parsed.input, opts);
}

export function queue(rawJson: string, opts: RecordOptions = {}): RecordResult {
  const parsed = parse(rawJson, { pending: true });
  if (!parsed.ok) return parsed.result;
  const paths = resolvePaths(findRoot(opts.cwd));
  const pending = readPending(paths);
  const entry: Decision = { ...fill(parsed.input, opts, paths.root), id: nextPendingId(pending), verdict: 'pending' };

  const checked = check(entry, paths.root, opts);
  if (checked) return checked;

  if (!opts.dryRun) {
    writePending(paths, [...pending, entry]);
    if (entry.candidate) refreshCandidates(paths);
  }
  return {
    exitCode: 0,
    output: {
      status: 'queued',
      id: entry.id,
      dimension: entry.dimension,
      verified: entry.verified,
      pending: pending.length + 1,
      checkin: readConfig(paths)?.checkin ?? 'feature',
      review: 'npx arbiter review',
    },
  };
}

/** Queue one pending decision per finding in a scanner's JSON output. */
export function queueFindings(file: string, opts: RecordOptions & { tool?: string } = {}): RecordResult {
  const paths = resolvePaths(findRoot(opts.cwd));
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(path.resolve(paths.root, file), 'utf8'));
  } catch (e) {
    return fail([`could not read findings: ${(e as Error).message}`]);
  }
  const findings = parseFindings(raw);
  if (!findings.length) return fail(['no findings recognised in that file — expected an array of { file, message, line?, rule?, suggestion? } or ESLint-style output']);

  const tool = opts.tool ?? path.basename(file, path.extname(file));
  const pending = readPending(paths);
  const seen = new Set(pending.map((d) => d.trigger));
  const added: string[] = [];
  let skipped = 0;
  for (const f of findings) {
    const input = toDecisionInput(f, paths.root, tool);
    if (seen.has(input.trigger)) {
      skipped++;
      continue;
    }
    const entry: Decision = { ...fill(input, opts, paths.root), id: nextPendingId([...pending]), verdict: 'pending' };
    pending.push(entry);
    seen.add(entry.trigger);
    added.push(entry.id);
  }
  if (!opts.dryRun) writePending(paths, pending);
  return { exitCode: 0, output: { status: 'queued', tool, queued: added.length, skippedDuplicates: skipped, ids: added, pending: pending.length, review: 'npx arbiter review' } };
}

function parse(rawJson: string, options: ValidateOptions = {}): { ok: true; input: DecisionInput } | { ok: false; result: RecordResult } {
  let raw: unknown;
  try {
    raw = JSON.parse(rawJson);
  } catch (e) {
    return { ok: false, result: fail(['input is not valid JSON: ' + (e as Error).message]) };
  }
  const v = validateInput(raw, options);
  if (!v.ok) return { ok: false, result: fail(v.errors) };
  return { ok: true, input: v.value };
}

// ── Retire a rule ──────────────────────────────────────────────────────────

/** A rule dies with no replacement. Appends a `retire` entry pointing at it; the rule leaves DECISIONS.md. */
export function retire(ruleId: string, why: string | undefined, opts: RecordOptions = {}): RecordResult {
  const paths = resolvePaths(findRoot(opts.cwd));
  const active = readActive(paths);
  const rule = active.find((d) => d.id === ruleId);
  if (!rule) return fail([`${ruleId} is not an active rule`]);
  if (!why?.trim()) return fail(['retire needs --why "<reason>" — the reason is the record']);
  const input: DecisionInput = {
    decision: `Retired: ${rule.decision}`,
    rationale: why.trim(),
    rejected: [],
    trigger: `retire ${rule.id}`,
    scope: rule.scope,
    dimension: rule.dimension,
    class: rule.class,
    verdict: 'retire',
    supersedes: rule.id,
  };
  return recordInput(input, opts);
}

// ── Judge a pending item ───────────────────────────────────────────────────

export function judge(pendingId: string, opts: JudgeOptions): RecordResult {
  if (!PENDING_ID.test(pendingId)) return fail([`not a pending id: ${pendingId} (looks like P-0003)`]);
  const paths = resolvePaths(findRoot(opts.cwd));
  const pending = readPending(paths);
  const item = pending.find((d) => d.id === pendingId);
  if (!item) return fail([`${pendingId} is not in the pending queue`]);

  const rest = pending.filter((d) => d.id !== pendingId);

  if (opts.as === 'skip') {
    if (!opts.dryRun) writePending(paths, rest);
    return { exitCode: 0, output: { status: 'skipped', id: pendingId, pending: rest.length } };
  }

  const { id: _id, verdict: _v, ...base } = item;
  let input: DecisionInput;
  if (opts.as === 'fix') {
    const to = opts.to?.trim();
    if (!to) return fail(['fix needs --to "<what it should be instead>"']);
    input = {
      ...base,
      decision: to,
      rejected: [`${item.decision} — corrected by ${opts.author ?? item.author}`, ...item.rejected],
      verdict: 'fix',
    };
  } else {
    input = { ...base, verdict: opts.as };
  }

  const result = recordInput(input, opts);
  if (result.exitCode === 0 && !opts.dryRun) writePending(paths, rest);
  if (result.exitCode === 0) result.output.pending = rest.length;
  result.output.judged = pendingId;
  return result;
}

/** Judge every pending item at once — the bulk verb. Filter by --level and/or --trigger. */
export function judgeAll(opts: JudgeOptions & { level?: string; trigger?: string }): RecordResult {
  if (opts.as === 'fix') return fail(['fix is one at a time — it needs its own --to']);
  const paths = resolvePaths(findRoot(opts.cwd));
  const targets = readPending(paths).filter(
    (d) => (!opts.level || d.level === opts.level) && (!opts.trigger || d.trigger === opts.trigger),
  );
  if (!targets.length) return { exitCode: 0, output: { status: 'nothing-to-judge', judged: [], pending: readPending(paths).length } };

  const judged: string[] = [];
  const failed: { id: string; output: Record<string, unknown> }[] = [];
  for (const d of targets) {
    const r = judge(d.id, opts);
    if (r.exitCode === 0) judged.push(String(r.output.id ?? d.id));
    else failed.push({ id: d.id, output: r.output });
  }
  return {
    exitCode: failed.length ? 1 : 0,
    output: {
      status: failed.length ? 'partial' : 'recorded',
      as: opts.as,
      judged,
      ...(failed.length && { failed }),
      pending: readPending(paths).length,
    },
  };
}

// ── Core ───────────────────────────────────────────────────────────────────

export function recordInput(input: DecisionInput, opts: RecordOptions = {}): RecordResult {
  if (opts.supersedes && opts.keepBoth) return fail(['--supersedes and --keep-both are mutually exclusive']);
  if (opts.supersedes && input.verdict !== 'rule' && input.verdict !== 'retire') return fail(['--supersedes only applies when verdict is `rule`']);

  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const config = readConfig(paths);
  const cap = config?.activeCap ?? ACTIVE_CAP;

  const active = readActive(paths);
  const archive = readArchive(paths);
  const supersedes = opts.supersedes ?? input.supersedes ?? null;
  const entry: Decision = { ...fill(input, opts, root), id: nextId(archive), supersedes };

  // An `accept` is a deviation by definition — nothing to verify. Rules and fixes make claims.
  if (entry.verdict !== 'accept') {
    const checked = check(entry, root, opts);
    if (checked) return checked;
  }

  let nextActive = active;

  if (entry.verdict === 'retire') {
    if (!active.some((d) => d.id === supersedes)) return fail([`${supersedes} is not an active rule`]);
    nextActive = active.filter((d) => d.id !== supersedes);
  }

  if (entry.verdict === 'rule') {
    if (supersedes) {
      const target = active.find((d) => d.id === supersedes);
      if (!target) {
        const inArchive = archive.some((d) => d.id === supersedes);
        return fail([
          inArchive
            ? `${supersedes} is in the archive but not active — it was already superseded or was never a rule`
            : `${supersedes} does not exist`,
        ]);
      }
      nextActive = active.filter((d) => d.id !== supersedes);
    } else if (!opts.keepBoth) {
      const overlaps = findOverlaps(input, active, { ignore: config?.overlap?.ignore });
      if (overlaps.length) {
        return {
          exitCode: 2,
          output: {
            status: 'overlap',
            message: `This rule overlaps ${overlaps.length} active rule${overlaps.length === 1 ? '' : 's'}. Nothing was written. Ask the user which it replaces, then re-run.`,
            candidate: input,
            overlaps,
            options: [
              ...overlaps.map((o) => ({
                flag: `--supersedes ${o.id}`,
                effect: `${o.id} leaves DECISIONS.md and stays in the archive; the new rule records supersedes: ${o.id}`,
              })),
              { flag: '--keep-both', effect: 'both rules stay active' },
            ],
          },
        };
      }
    }

    if (nextActive.length >= cap) {
      return {
        exitCode: 3,
        output: {
          status: 'cap',
          message: `DECISIONS.md holds ${nextActive.length} of ${cap} rules. Nothing was written. Supersede an existing rule with --supersedes <id> to make room.`,
          candidate: input,
          active: nextActive.map((d) => ({ id: d.id, decision: d.decision, scope: d.scope })),
        },
      };
    }
    nextActive = [...nextActive, entry];
  }

  if (!opts.dryRun) {
    appendArchive(paths, entry);
    if (entry.verdict === 'rule' || entry.verdict === 'retire') writeActive(paths, nextActive, cap);
    if (entry.candidate) refreshCandidates(paths);
  }

  // A new mechanical rule reaches backwards: say how much existing code it touches.
  let sweepSummary: Record<string, unknown> | undefined;
  if (entry.verdict === 'rule' && entry.class === 'mechanical' && entry.expect?.absent?.length) {
    const r = sweep(root, entry, { exclude: config?.sweep?.exclude });
    const sum = summarize(r);
    sweepSummary = { ...sum, command: `npx arbiter sweep ${entry.id}`, hint: sum.violations ? 'Ask the user: fix now, queue for review, or ignore?' : 'No existing violations.' };
  }

  return {
    exitCode: 0,
    output: {
      status: opts.dryRun ? 'dry-run' : 'recorded',
      id: entry.id,
      decision: entry.decision,
      verdict: entry.verdict,
      scope: entry.scope,
      dimension: entry.dimension,
      supersedes: entry.supersedes,
      verified: entry.verified,
      candidate: entry.candidate,
      active: `${nextActive.length} of ${cap}`,
      wrote: opts.dryRun ? [] : entry.verdict === 'rule' || entry.verdict === 'retire' ? ['.arbiter/archive.md', 'DECISIONS.md'] : ['.arbiter/archive.md'],
      ...(sweepSummary && { sweep: sweepSummary }),
    },
  };
}

/**
 * Check a decision's claim against its files. Sets `verified`; returns a
 * failing result if contradicted and the caller didn't say --unverified.
 */
function check(entry: Decision, root: string, opts: RecordOptions): RecordResult | null {
  if (!checkable(entry.files, entry.expect)) return null;
  const r = verify(root, entry.files, entry.expect);
  entry.verified = r.ok;
  if (r.ok || opts.unverified) return null;
  const failed = r.checks.filter((c) => !c.ok);
  return {
    exitCode: 4,
    output: {
      status: 'contradicted',
      message: `The files don't match the claim (${failed.length} check${failed.length === 1 ? '' : 's'} failed). Nothing was written. Fix the code or correct the claim; --unverified records it anyway, marked unverified.`,
      candidate: { decision: entry.decision, files: entry.files, expect: entry.expect },
      failed,
    },
  };
}

/** Fill the fields the caller doesn't supply. Id is set by the caller. */
function fill(input: DecisionInput, opts: RecordOptions, root: string): Omit<Decision, 'id'> {
  const config = readConfig(resolvePaths(root));
  return {
    date: input.date ?? now(),
    author: opts.author ?? input.author ?? config?.author ?? gitUserName(root) ?? os.userInfo().username,
    class: input.class,
    dimension: input.dimension,
    decision: input.decision,
    change: input.change ?? null,
    level: input.level ?? 'pattern',
    rejected: input.rejected ?? [],
    trigger: input.trigger,
    verdict: input.verdict,
    scope: input.scope,
    rationale: input.rationale,
    supersedes: input.supersedes ?? null,
    ref: opts.ref ?? input.ref ?? null,
    commit: input.commit ?? currentCommit(root),
    files: input.files ?? [],
    paths: input.paths ?? [],
    expect: input.expect ?? null,
    verified: null,
    candidate: opts.candidate ?? input.candidate ?? null,
  };
}

function fail(errors: string[]): RecordResult {
  return { exitCode: 1, output: { status: 'invalid', errors } };
}

// ── Interactive ────────────────────────────────────────────────────────────

/**
 * Walk a person through a decision at the terminal. Selection where possible,
 * one line of typing where not. Returns the JSON `record` expects.
 */
export async function interactiveInput(): Promise<string> {
  const ask = new Prompter();
  try {
    process.stdout.write('Record a design decision. One line each; Enter accepts the default.\n\n');
    const decision = await ask.required('Decision — what was chosen, as a rule someone could follow');
    const rationale = await ask.required('Why');
    const rejected: string[] = [];
    for (;;) {
      const r = (await ask.question(rejected.length ? 'Another rejected option (Enter to stop): ' : 'Rejected option, as "<option> — <why it lost>" (Enter to skip): ')).trim();
      if (!r) break;
      rejected.push(r);
    }
    const dimension = await ask.pick('Dimension', DIMENSIONS, 'interaction');
    const scope = await ask.required('Scope — global, pattern:<name>, or file:<path>', 'global');
    const verdictPick = await ask.pick('Is this', ['a standing rule', 'a one-off exception'] as const, 'a standing rule');
    const cls = await ask.pick('Could a tool check it (colours, spacing, type)?', ['no — judgment', 'yes — mechanical'] as const, 'no — judgment');
    const input: DecisionInput = {
      decision,
      rationale,
      rejected,
      trigger: 'Recorded by hand at the terminal',
      scope,
      dimension,
      class: cls.startsWith('yes') ? 'mechanical' : 'judgment',
      verdict: verdictPick.startsWith('a standing') ? 'rule' : 'accept',
    };
    process.stdout.write('\n');
    return JSON.stringify(input);
  } finally {
    ask.close();
  }
}
