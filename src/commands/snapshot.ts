/**
 * `arbiter snapshot "<piece of work>" --file shot.png` — a picture for a piece of work that
 * isn't a candidate. Named the way the decisions named it (`trigger`); case and punctuation
 * don't matter. Publish carries it to the board's card for that work.
 */

import fs from 'node:fs';
import path from 'node:path';
import { findRoot, readArchive, readPending, resolvePaths } from '../store';
import { publishable } from '../hosted';
import type { Decision } from '../schema';
import { captureImage, copyImage, keepEarlier, restoreEarlier, workDir, workId, workSnapshot } from '../work';

export interface SnapshotResult { exitCode: 0 | 1; output: Record<string, unknown> }

export function snapshotWork(name: string, opts: { file?: string; capture?: boolean; cwd?: string }): SnapshotResult {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const trigger = name.trim();
  if (!trigger) return { exitCode: 1, output: { status: 'invalid', errors: ['name the piece of work, as the decisions did: arbiter snapshot "Settings build" --file shot.png'] } };
  if (!opts.file && !opts.capture) return { exitCode: 1, output: { status: 'invalid', errors: ['pass --file <image> or --capture'] } };
  const id = workId(trigger);
  // A work card is built from judged, non-polish decisions only, so a picture for anything else has
  // nothing to hang on yet. Counting the queue or polish here would report success for a board that stays empty.
  const mine = (d: Decision) => workId(d.trigger) === id;
  const archive = readArchive(paths);
  const pending = readPending(paths);
  const judged = archive.some((d) => mine(d) && publishable(d));
  const queued = pending.filter((d) => mine(d) && d.level !== 'polish').length;
  const polish = [...archive, ...pending].some((d) => mine(d) && d.level === 'polish' && d.verdict !== 'retire');
  // The picture it had becomes an earlier version, so the board can show how the work got here. The same
  // picture attached again isn't a new version.
  const cur = workSnapshot(paths, id);
  const same = !opts.capture && !!cur && sameFile(cur, path.resolve(root, opts.file!));
  const moved = same ? null : keepEarlier(paths, id);
  const r = opts.capture ? captureImage(workDir(paths), id) : copyImage(root, workDir(paths), id, opts.file!);
  if (!r.ok) {
    restoreEarlier(moved);
    return { exitCode: 1, output: { status: 'failed', error: r.error } };
  }
  // Dated when it was attached: a copy keeps the source file's own time on some systems.
  const now = new Date();
  fs.utimesSync(path.join(workDir(paths), r.file), now, now);
  const note = judged
    ? null
    : queued
      ? `"${trigger}" has ${queued} decision${queued === 1 ? '' : 's'} still in the queue — the picture shows on the board once they're judged (/arbiter, or npx arbiter review)`
      : polish
        ? `"${trigger}" only has polish so far, and polish never reaches the board — the picture shows once a feature or pattern decision lands`
        : `no decisions mention "${trigger}" yet — the picture shows once some do`;
  return {
    exitCode: 0,
    output: { status: 'saved', work: trigger, id, file: path.relative(root, path.join(workDir(paths), r.file)), ...(moved ? { earlier: path.relative(root, moved.to) } : {}), ...(note ? { note } : {}) },
  };
}

/** Byte for byte the same image. */
function sameFile(a: string, b: string): boolean {
  try {
    if (fs.statSync(a).size !== fs.statSync(b).size) return false;
    return fs.readFileSync(a).equals(fs.readFileSync(b));
  } catch {
    return false;
  }
}
