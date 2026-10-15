/**
 * `arbiter rename "<old name>" "<new name>"` — rename a piece of work, keeping its comments.
 *
 * A piece of work is the decisions that share a `trigger`, and its card id on the board comes from
 * that name (`Settings build` → `W-settings-build`). Changing the name by hand made a new card and
 * left every comment on the old one, which the board no longer shows. This renames it everywhere
 * the repo keeps it — the archive, the queue, DECISIONS.md, its picture, requests and comments —
 * and notes the move in .arbiter/renamed.json, so the next publish moves the board's comments too.
 *
 * Screens (C-0002) aren't renamed here: their id is a number, so a new name never moves a comment.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findRoot, readActive, readArchive, readPending, resolvePaths, writeActive, writeArchive, writePending } from '../store';
import { readCandidates } from '../candidates';
import { readComments, writeComments } from '../hosted';
import { oneLine, readRequests, writeRequests } from '../requests';
import type { Decision } from '../schema';
import { addRename, workDir, workId, workSnapshot } from '../work';

export interface RenameResult { exitCode: 0 | 1; output: Record<string, unknown> }

const fail = (errors: string[]): RenameResult => ({ exitCode: 1, output: { status: 'invalid', errors } });

export function renameWork(from: string, to: string, opts: { cwd?: string } = {}): RenameResult {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const oldName = oneLine(from ?? '');
  const newName = oneLine(to ?? '');
  if (!oldName || !newName) return fail(['name the piece of work and what to call it: npx arbiter rename "Settings build" "Settings — billing"']);

  const screen = readCandidates(paths).find((c) => c.id === oldName || c.name === oldName);
  if (screen) return fail([`${screen.id} is a screen, not a piece of work. Its id doesn't come from its name, so its comments stay with it whatever it's called.`]);

  // By id, so case and punctuation don't matter, the way `snapshot` finds work. The id itself works too.
  const oldId = /^W-[a-z0-9-]+$/.test(oldName) ? oldName : workId(oldName);
  const newId = workId(newName);
  if (newId === 'W-') return fail([`"${newName}" has no letters or numbers to name a card by`]);
  const mine = (d: Decision) => workId(d.trigger) === oldId;

  const archive = readArchive(paths);
  const pending = readPending(paths);
  const active = readActive(paths);
  const all = [...archive, ...pending];
  const found = all.filter(mine);
  if (!found.length) return fail([`no piece of work called "${oldName}" — name it as its decisions did (npx arbiter rules --archive shows them)`]);
  const current = found[0].trigger;
  if (current === newName) return fail([`"${current}" is already called that`]);
  // Two pieces of work with one id would be one card with two names. Merging them is a different act.
  const taken = newId !== oldId ? all.find((d) => workId(d.trigger) === newId) : undefined;
  if (taken) return fail([`there's already a piece of work called "${taken.trigger}" — renaming "${current}" onto it would merge the two`]);

  const wrote: string[] = [];
  const rename = (ds: Decision[]) => ds.map((d) => (mine(d) ? { ...d, trigger: newName } : d));
  if (archive.some(mine)) { writeArchive(paths, rename(archive)); wrote.push('.arbiter/archive.md'); }
  if (pending.some(mine)) { writePending(paths, rename(pending)); wrote.push('.arbiter/pending.md'); }
  if (active.some(mine)) { writeActive(paths, rename(active)); wrote.push('DECISIONS.md'); }

  if (newId !== oldId) {
    // The picture is filed under the id; it follows. Anything already filed under the new id belongs
    // to no decision (that was checked above), so it's a leftover and goes.
    const shot = workSnapshot(paths, oldId);
    if (shot) {
      const stale = workSnapshot(paths, newId);
      if (stale) fs.rmSync(stale, { force: true });
      const next = path.join(workDir(paths), newId + path.extname(shot));
      fs.renameSync(shot, next);
      wrote.push(`.arbiter/work/${path.basename(next)}`);
    }
    const requests = readRequests(paths);
    if (requests.some((r) => r.screen === oldId)) {
      writeRequests(paths, requests.map((r) => (r.screen === oldId ? { ...r, screen: newId } : r)));
      wrote.push('.arbiter/requests.json');
    }
    const comments = readComments(paths);
    if (comments.some((c) => c.candidate_id === oldId)) {
      writeComments(paths, comments.map((c) => (c.candidate_id === oldId ? { ...c, candidate_id: newId } : c)));
      wrote.push('.arbiter/comments.json');
    }
    addRename(paths, oldId, newId);
    wrote.push('.arbiter/renamed.json');
  }

  return {
    exitCode: 0,
    output: {
      status: 'renamed',
      from: current,
      to: newName,
      decisions: found.length,
      ...(newId !== oldId ? { card: { from: oldId, to: newId } } : {}),
      wrote,
      note: newId !== oldId
        ? 'the board shows the new name, with its comments, after the next `npx arbiter publish`'
        : 'same card on the board; only its name changes, at the next `npx arbiter publish`',
    },
  };
}
