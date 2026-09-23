/**
 * `arbiter candidate` — the act verb for generated screens.
 *
 *   candidate add "<name>" [--feature f] [--snapshot img] [--notes text]
 *   candidate C-0002 --state approved [--why "…"] [--keep-others]
 *   candidate C-0002 --state rejected --why "…"
 *   candidate C-0002 --snapshot new.png
 *
 * Approving one direction supersedes its siblings (same feature, still open)
 * with the reason retained — the rejected branches are the point.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  Candidate, CandidateState, STATES, candidatesDir, nextCandidateId, readCandidates, writeCandidate,
} from '../candidates';
import { currentCommit, findRoot, gitUserName, now, readConfig, resolvePaths } from '../store';
import { deliver, DeliveryResult } from '../destination';

export interface CandidateOptions {
  feature?: string;
  snapshot?: string;
  /** macOS only: drag-select a region of the screen as the snapshot. */
  capture?: boolean;
  notes?: string;
  state?: string;
  why?: string;
  by?: string;
  keepOthers?: boolean;
  author?: string;
  cwd?: string;
}

export interface CandidateResult {
  exitCode: 0 | 1;
  output: Record<string, unknown>;
}

export function addCandidate(name: string, opts: CandidateOptions = {}): CandidateResult {
  if (!name?.trim()) return fail(['a name is required']);
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const config = readConfig(paths);
  const all = readCandidates(paths);
  const c: Candidate = {
    id: nextCandidateId(all),
    name: name.trim(),
    feature: opts.feature?.trim() || null,
    state: 'generated',
    snapshot: null,
    author: opts.author ?? gitUserName(root) ?? config?.author ?? os.userInfo().username,
    date: now(),
    commit: currentCommit(root),
    supersededBy: null,
    reason: null,
    notes: opts.notes?.trim() ?? '',
  };
  if (opts.snapshot) {
    const snap = copySnapshot(paths, c.id, opts.snapshot);
    if (!snap.ok) return fail([snap.error]);
    c.snapshot = snap.file;
  }
  if (opts.capture) {
    const cap = captureScreen(paths, c.id);
    if (!cap.ok) return fail([cap.error]);
    c.snapshot = cap.file;
  }
  writeCandidate(paths, c);
  const delivered = deliver(paths, config, [c], `add ${c.id} — ${c.name}`);
  return { exitCode: 0, output: { status: 'added', id: c.id, name: c.name, feature: c.feature, state: c.state, snapshot: c.snapshot, file: rel(root, paths, c.id), ...delivered } };
}

export function updateCandidate(id: string, opts: CandidateOptions = {}): CandidateResult {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const config = readConfig(paths);
  const all = readCandidates(paths);
  const c = all.find((x) => x.id === id);
  if (!c) return fail([`${id} not found`]);

  const changed: Candidate[] = [];
  const superseded: string[] = [];

  if (opts.state) {
    if (!(STATES as readonly string[]).includes(opts.state)) return fail([`state must be one of ${STATES.join(' | ')}`]);
    const state = opts.state as CandidateState;
    if (state === 'superseded' && !opts.by) return fail(['superseded needs --by <candidate id>']);
    if (opts.by && !all.some((x) => x.id === opts.by)) return fail([`${opts.by} not found`]);
    c.state = state;
    c.supersededBy = state === 'superseded' ? opts.by! : null;
    if (opts.why !== undefined) c.reason = opts.why.trim() || null;
    if (state === 'approved' && !opts.keepOthers && c.feature) {
      for (const sib of all) {
        if (sib.id === c.id || sib.feature !== c.feature) continue;
        if (sib.state !== 'generated' && sib.state !== 'in_review') continue;
        sib.state = 'superseded';
        sib.supersededBy = c.id;
        sib.reason = sib.reason ?? (opts.why?.trim() || `${c.id} approved`);
        changed.push(sib);
        superseded.push(sib.id);
      }
    }
  } else if (opts.why !== undefined) {
    c.reason = opts.why.trim() || null;
  }
  if (opts.snapshot) {
    const snap = copySnapshot(paths, c.id, opts.snapshot);
    if (!snap.ok) return fail([snap.error]);
    c.snapshot = snap.file;
  }
  if (opts.capture) {
    const cap = captureScreen(paths, c.id);
    if (!cap.ok) return fail([cap.error]);
    c.snapshot = cap.file;
  }
  if (opts.notes !== undefined) c.notes = opts.notes.trim();
  if (opts.feature !== undefined) c.feature = opts.feature.trim() || null;

  changed.unshift(c);
  for (const x of changed) writeCandidate(paths, x);
  const delivered = deliver(paths, config, changed, `${c.id} ${c.state} — ${c.name}`);
  return {
    exitCode: 0,
    output: { status: 'updated', id: c.id, name: c.name, state: c.state, ...(superseded.length && { superseded }), file: rel(root, paths, c.id), ...delivered },
  };
}

/** Refresh every candidate file (decision lists are a view; call after decisions change). */
export function refreshCandidates(paths: ReturnType<typeof resolvePaths>): void {
  for (const c of readCandidates(paths)) writeCandidate(paths, c);
}

function copySnapshot(paths: ReturnType<typeof resolvePaths>, id: string, src: string): { ok: true; file: string } | { ok: false; error: string } {
  const abs = path.resolve(paths.root, src);
  if (!fs.existsSync(abs)) return { ok: false, error: `snapshot not found: ${src}` };
  const ext = path.extname(abs).toLowerCase() || '.png';
  if (!['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'].includes(ext)) return { ok: false, error: `snapshot must be an image (png, jpg, webp, gif, svg), got ${ext}` };
  const file = `${id}${ext}`;
  fs.mkdirSync(candidatesDir(paths), { recursive: true });
  fs.copyFileSync(abs, path.join(candidatesDir(paths), file));
  return { ok: true, file };
}

/**
 * Drag-to-select a screen region with macOS's built-in `screencapture -i`.
 * No browser, no dependency. Escape cancels and leaves the candidate as is.
 */
function captureScreen(paths: ReturnType<typeof resolvePaths>, id: string): { ok: true; file: string } | { ok: false; error: string } {
  if (process.platform !== 'darwin') return { ok: false, error: '--capture uses macOS screencapture; on other platforms pass --snapshot <image>' };
  const file = `${id}.png`;
  fs.mkdirSync(candidatesDir(paths), { recursive: true });
  const out = path.join(candidatesDir(paths), file);
  process.stderr.write('Drag to select the region to capture (Esc to cancel)…\n');
  try {
    execFileSync('screencapture', ['-i', '-x', out], { stdio: 'ignore' });
  } catch {
    return { ok: false, error: 'screencapture failed' };
  }
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) return { ok: false, error: 'capture cancelled — no snapshot saved' };
  return { ok: true, file };
}

const rel = (root: string, paths: ReturnType<typeof resolvePaths>, id: string) => path.relative(root, path.join(candidatesDir(paths), `${id}.md`));

function fail(errors: string[]): CandidateResult {
  return { exitCode: 1, output: { status: 'invalid', errors } };
}

export type { DeliveryResult };
