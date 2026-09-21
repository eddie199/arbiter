/**
 * `arbiter snapshot "<piece of work>" --file shot.png` — a picture for a piece of work that
 * isn't a candidate. Named the way the decisions named it (`trigger`); case and punctuation
 * don't matter. Publish carries it to the board's card for that work.
 */

import path from 'node:path';
import { findRoot, readArchive, readPending, resolvePaths } from '../store';
import { captureImage, copyImage, workDir, workId } from '../work';

export interface SnapshotResult { exitCode: 0 | 1; output: Record<string, unknown> }

export function snapshotWork(name: string, opts: { file?: string; capture?: boolean; cwd?: string }): SnapshotResult {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const trigger = name.trim();
  if (!trigger) return { exitCode: 1, output: { status: 'invalid', errors: ['name the piece of work, as the decisions did: arbiter snapshot "Settings build" --file shot.png'] } };
  if (!opts.file && !opts.capture) return { exitCode: 1, output: { status: 'invalid', errors: ['pass --file <image> or --capture'] } };
  const id = workId(trigger);
  const known = [...readArchive(paths), ...readPending(paths)].some((d) => workId(d.trigger) === id);
  const r = opts.capture ? captureImage(workDir(paths), id) : copyImage(root, workDir(paths), id, opts.file!);
  if (!r.ok) return { exitCode: 1, output: { status: 'failed', error: r.error } };
  return {
    exitCode: 0,
    output: { status: 'saved', work: trigger, id, file: path.relative(root, path.join(workDir(paths), r.file)), ...(known ? {} : { note: `no decisions mention "${trigger}" yet — the picture shows once some do` }) },
  };
}
