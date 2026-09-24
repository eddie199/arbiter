/**
 * `arbiter remove` and `arbiter unlink` — the exits Arbiter was missing.
 *
 * Three verbs, and they mean different things:
 *
 *   retire   it was real, it's over        → the rule leaves DECISIONS.md, the archive keeps it
 *   remove   it was never real             → it leaves the record entirely
 *   unlink   it was real, wrongly attached → the decision stays, its screen doesn't
 *
 * Append-only is right for judgments: a call you changed your mind about is superseded, and that
 * history is the point. It's wrong for mistakes. A test entry, an agent misfire, or a screen
 * invented to work around a bug isn't history — it's a record that says something false, and
 * keeping it forever makes the archive less trustworthy, not more.
 *
 * So `remove` deletes. Git holds the history for anyone who has it, and the output prints what
 * went, in full, for anyone who doesn't. Nothing is removed while something still points at it.
 */

import fs from 'node:fs';
import path from 'node:path';
import { CANDIDATE_ID, DECISION_ID } from '../schema';
import { formatEntry } from '../format';
import { ACTIVE_CAP, findRoot, readActive, readArchive, readConfig, readPending, resolvePaths, writeActive, writeArchive, writePending, type Paths } from '../store';
import { candidateFile, candidatesDir, readCandidates, writeCandidate } from '../candidates';
import { deliver } from '../destination';
import { workId, workSnapshot } from '../work';

export interface RemoveOptions {
  cwd?: string;
  /** Remove a candidate even though decisions are linked to it; they are unlinked first. */
  force?: boolean;
}

export interface RemoveResult {
  exitCode: 0 | 1;
  output: Record<string, unknown>;
}

const fail = (errors: string[]): RemoveResult => ({ exitCode: 1, output: { status: 'invalid', errors } });

// ── remove ─────────────────────────────────────────────────────────────────

export function remove(id: string, opts: RemoveOptions = {}): RemoveResult {
  const raw = id?.trim() ?? '';
  if (DECISION_ID.test(raw)) return removeDecision(raw, opts);
  if (CANDIDATE_ID.test(raw)) return removeCandidate(raw, opts);
  if (/^P-\d{4,}$/.test(raw)) return fail([`${raw} is still in the queue — drop it with: npx arbiter record ${raw} --as skip`]);
  return fail([`not something that can be removed: ${raw} (a decision like D-0004, a candidate like C-0001, or a piece of work by name)`]);
}

function removeDecision(id: string, opts: RemoveOptions): RemoveResult {
  const paths = resolvePaths(findRoot(opts.cwd));
  const archive = readArchive(paths);
  const entry = archive.find((d) => d.id === id);
  if (!entry) return fail([`${id} is not in the archive`]);

  const active = readActive(paths);
  const isActive = active.some((d) => d.id === id);
  if (isActive && !opts.force) {
    return fail([
      `${id} is an active rule. If the rule is real and simply over, retiring keeps it in the record: npx arbiter record --retire ${id} --why "<reason>"`,
      `If it was never a real rule, take it out of both: npx arbiter remove ${id} --force`,
    ]);
  }
  const later = archive.find((d) => d.supersedes === id);
  if (later) {
    return fail([`${later.id} supersedes ${id} — removing it would leave ${later.id} pointing at nothing. Remove ${later.id} first if neither is real.`]);
  }

  writeArchive(paths, archive.filter((d) => d.id !== id));
  if (isActive) {
    const config = readConfig(paths);
    writeActive(paths, active.filter((d) => d.id !== id), config?.activeCap ?? ACTIVE_CAP);
  }
  const touched = refreshLinked(paths, entry.candidate);
  // Removing a rule doesn't bring back the one it replaced: that one may have been real, and
  // guessing would put a rule back the user never re-confirmed. Say so rather than lose it quietly.
  const replaced = entry.supersedes && archive.find((d) => d.id === entry.supersedes);
  // Ids come from the highest in the file, so taking the last one out frees it for the next
  // decision. Locally that's harmless; on a board already published, comments point at the id.
  const reused = archive.every((d) => d.id <= id) ? id : null;
  return {
    exitCode: 0,
    output: {
      status: 'removed',
      id,
      decision: entry.decision,
      ...(replaced ? { note: `${replaced.id} — which ${id} replaced — is still inactive. Record it again if it should apply.` } : {}),
      ...(reused ? { idReuse: `${id} was the newest, so the next decision recorded will take that id again. If this board is published, comments on the old ${id} will read as if they were about the new one — republish after recording.` } : {}),
      wrote: ['.arbiter/archive.md', ...(isActive ? ['DECISIONS.md'] : []), ...touched],
      // Printed in full so it can be put back by hand — not everyone has git.
      removed: formatEntry(entry).trimEnd(),
    },
  };
}

function removeCandidate(id: string, opts: RemoveOptions): RemoveResult {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const all = readCandidates(paths);
  const c = all.find((x) => x.id === id);
  if (!c) return fail([`${id} is not a candidate here`]);

  const by = all.find((x) => x.supersededBy === id);
  if (by) return fail([`${by.id} says it was superseded by ${id} — clear that first: npx arbiter candidate ${by.id} --state generated`]);

  const archive = readArchive(paths);
  const pending = readPending(paths);
  const linked = [...archive, ...pending].filter((d) => d.candidate === id);
  if (linked.length && !opts.force) {
    return fail([
      `${linked.length} decision${linked.length === 1 ? '' : 's'} still linked to ${id}: ${linked.map((d) => d.id).join(', ')}.`,
      `Detach them and keep them: npx arbiter unlink ${linked.map((d) => d.id).join(' ')}`,
      `Or remove the screen and detach them in one go: npx arbiter remove ${id} --force`,
    ]);
  }
  if (linked.length) unlinkAll(paths, linked.map((d) => d.id));

  const file = candidateFile(paths, id);
  const shot = c.snapshot ? path.join(candidatesDir(paths), c.snapshot) : null;
  const before = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  fs.rmSync(file, { force: true });
  if (shot) fs.rmSync(shot, { force: true });

  const config = readConfig(paths);
  const delivered = deliver(paths, config, [], `remove ${id}`);
  return {
    exitCode: 0,
    output: {
      status: 'removed',
      id,
      name: c.name,
      ...(linked.length ? { unlinked: linked.map((d) => d.id) } : {}),
      ...(all.every((x) => x.id <= id) ? { idReuse: `${id} was the newest, so the next screen added will take that id again.` } : {}),
      wrote: [path.relative(root, file), ...(shot ? [path.relative(root, shot)] : [])].map((p) => p.split(path.sep).join('/')),
      removed: before.trimEnd(),
      ...(delivered.destination === 'git' ? { destination: 'git', committed: delivered.committed } : {}),
    },
  };
}

/** `arbiter remove --snapshot "<piece of work>"` — the picture goes, the work stays. */
export function removeSnapshot(name: string, opts: RemoveOptions = {}): RemoveResult {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const trigger = name?.trim() ?? '';
  if (!trigger) return fail(['name the piece of work, as the decisions did: npx arbiter remove --snapshot "Settings — billing"']);

  // A candidate's picture belongs to the candidate; take it off there.
  const cand = readCandidates(paths).find((c) => c.id === trigger || c.name === trigger);
  if (cand) {
    if (!cand.snapshot) return fail([`${cand.id} has no picture`]);
    const shot = path.join(candidatesDir(paths), cand.snapshot);
    fs.rmSync(shot, { force: true });
    writeCandidate(paths, { ...cand, snapshot: null });
    const delivered = deliver(paths, readConfig(paths), [{ ...cand, snapshot: null }], `remove snapshot ${cand.id}`);
    return {
      exitCode: 0,
      output: { status: 'removed', id: cand.id, wrote: [path.relative(root, shot).split(path.sep).join('/')], ...(delivered.destination === 'git' ? { committed: delivered.committed } : {}) },
    };
  }

  const id = workId(trigger);
  const file = workSnapshot(paths, id);
  if (!file) return fail([`no picture attached to "${trigger}"`]);
  fs.rmSync(file, { force: true });
  return {
    exitCode: 0,
    output: {
      status: 'removed',
      work: trigger,
      id,
      wrote: [path.relative(root, file).split(path.sep).join('/')],
      note: 'the board keeps the old picture until the next `npx arbiter publish`',
    },
  };
}

// ── unlink ─────────────────────────────────────────────────────────────────

/** Detach recorded decisions from their screen. The decisions stay exactly as they are. */
export function unlink(ids: string[], opts: RemoveOptions = {}): RemoveResult {
  const paths = resolvePaths(findRoot(opts.cwd));
  const wanted = (ids ?? []).map((i) => i.trim()).filter(Boolean);
  if (!wanted.length) return fail(['name at least one decision: npx arbiter unlink D-0004']);

  const bad = wanted.filter((i) => !DECISION_ID.test(i) && !/^P-\d{4,}$/.test(i));
  if (bad.length) return fail([`not decision ids: ${bad.join(', ')} (D-0004, or P-0003 while queued)`]);

  const archive = readArchive(paths);
  const pending = readPending(paths);
  const known = new Map([...archive, ...pending].map((d) => [d.id, d]));
  const missing = wanted.filter((i) => !known.has(i));
  if (missing.length) return fail([`not found: ${missing.join(', ')}`]);

  const unattached = wanted.filter((i) => !known.get(i)!.candidate);
  if (unattached.length === wanted.length) return fail([`already attached to no screen: ${unattached.join(', ')}`]);

  const changed = wanted.filter((i) => known.get(i)!.candidate);
  const from = new Set(changed.map((i) => known.get(i)!.candidate!));
  unlinkAll(paths, changed);
  return {
    exitCode: 0,
    output: {
      status: 'unlinked',
      ids: changed,
      from: [...from],
      ...(unattached.length ? { alreadyLoose: unattached } : {}),
      wrote: ['.arbiter/archive.md', ...refreshMany(paths, from)],
    },
  };
}

// ── shared ─────────────────────────────────────────────────────────────────

/** Clear `candidate` on the named decisions, wherever they live, and refresh the screens they left. */
function unlinkAll(paths: Paths, ids: string[]): void {
  const set = new Set(ids);
  const archive = readArchive(paths);
  if (archive.some((d) => set.has(d.id))) {
    writeArchive(paths, archive.map((d) => (set.has(d.id) ? { ...d, candidate: null } : d)));
  }
  const pending = readPending(paths);
  if (pending.some((d) => set.has(d.id))) {
    writePending(paths, pending.map((d) => (set.has(d.id) ? { ...d, candidate: null } : d)));
  }
}

/** A screen's file lists its decisions, so it has to be rewritten when that list changes. */
function refreshLinked(paths: Paths, candidate: string | null): string[] {
  if (!candidate) return [];
  return refreshMany(paths, new Set([candidate]));
}

function refreshMany(paths: Paths, ids: Set<string>): string[] {
  const wrote: string[] = [];
  for (const c of readCandidates(paths)) {
    if (!ids.has(c.id)) continue;
    writeCandidate(paths, c);
    wrote.push(`.arbiter/candidates/${c.id}.md`);
  }
  return wrote;
}
