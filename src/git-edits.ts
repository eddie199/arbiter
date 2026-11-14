/**
 * Edits not yet committed, for Home's Not committed tile on the local board: lines added and removed,
 * and files changed, in each worktree of the project's repository, the one the board runs in first.
 * Read from git when the page asks; nothing is kept. Not a git repository: null, and Home leaves the
 * tile out.
 */

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GitEdits, GitWorktree } from './board-types';

/** The most worktrees the tile's branch menu lists. */
const MOST = 12;
/** A new file bigger than this isn't read to count its lines (it still counts as a file). */
const BIGGEST = 1_000_000;

const git = (cwd: string, args: string[]): string | null => {
  try {
    return execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'], timeout: 4000 }).toString();
  } catch {
    return null;
  }
};

/** Lines in a new file git doesn't track yet, as `git diff` would count them once it's added. Binary or very big: none. */
function linesIn(file: string): number {
  try {
    if (fs.statSync(file).size > BIGGEST) return 0;
    const text = fs.readFileSync(file);
    if (text.includes(0)) return 0;
    const s = text.toString('utf8');
    return s ? s.split('\n').length - (s.endsWith('\n') ? 1 : 0) : 0;
  } catch {
    return 0;
  }
}

/** One worktree's uncommitted edits: what `git diff HEAD` counts, plus the lines of new files it doesn't track yet. */
function editsIn(dir: string, branch: string | null): GitWorktree {
  let added = 0, removed = 0;
  for (const line of (git(dir, ['diff', 'HEAD', '--numstat']) ?? '').split('\n')) {
    const [a, r] = line.split('\t');
    if (/^\d+$/.test(a)) added += Number(a);
    if (/^\d+$/.test(r)) removed += Number(r);
  }
  for (const f of (git(dir, ['ls-files', '--others', '--exclude-standard']) ?? '').split('\n').filter(Boolean)) added += linesIn(path.join(dir, f));
  const files = (git(dir, ['status', '--porcelain']) ?? '').split('\n').filter(Boolean).length;
  return { path: dir, name: path.basename(dir), branch, added, removed, files };
}

export function uncommitted(root: string): GitEdits | null {
  const top = git(root, ['rev-parse', '--show-toplevel'])?.trim();
  if (!top) return null;
  const list: { dir: string; branch: string | null }[] = [];
  let cur: { dir: string; branch: string | null } | null = null;
  for (const line of (git(top, ['worktree', 'list', '--porcelain']) ?? '').split('\n')) {
    if (line.startsWith('worktree ')) list.push((cur = { dir: line.slice(9), branch: null }));
    else if (line.startsWith('branch ') && cur) cur.branch = line.slice(7).replace(/^refs\/heads\//, '');
  }
  if (!list.length) list.push({ dir: top, branch: git(top, ['branch', '--show-current'])?.trim() || null });
  // The board's own worktree first, then the rest as git lists them.
  const here = list.find((w) => path.resolve(w.dir) === path.resolve(top)) ?? list[0];
  const rest = list.filter((w) => w !== here).slice(0, MOST - 1);
  return { worktrees: [here, ...rest].map((w) => editsIn(w.dir, w.branch)) };
}
