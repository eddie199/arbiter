/**
 * Pieces of work — the groups the queue already makes (`trigger`) — as the hosted board shows
 * them. A piece of work isn't a candidate: nothing competes, nothing is approved. But it can
 * carry a picture, kept in .arbiter/work/ under a stable id derived from its name.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import type { Paths } from './store';

const IMAGE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg'];

/** `Settings build` → `W-settings-build`: stable across republishes, so comments on it survive. */
export const workId = (trigger: string): string => 'W-' + trigger.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);

export const workDir = (paths: Paths): string => path.join(paths.archiveDir, 'work');

/**
 * Pieces of work renamed after the fact, old id to new: .arbiter/renamed.json, committed. The id comes
 * from the name, so a renamed piece of work is a new card on the board, and the comments on the old
 * card have to be told where it went. Every publish sends the list, from whoever's machine, and the
 * board moves what's still on an old id; once moved, sending it again changes nothing.
 */
export interface Rename { from: string; to: string }
const RENAMED_FILE = 'renamed.json';

export function readRenames(paths: Paths): Rename[] {
  const f = path.join(paths.archiveDir, RENAMED_FILE);
  if (!fs.existsSync(f)) return [];
  try {
    const all = JSON.parse(fs.readFileSync(f, 'utf8').replace(/^﻿/, ''));
    if (!Array.isArray(all)) throw new Error('not a list');
    return (all as Rename[]).filter((r) => typeof r?.from === 'string' && typeof r?.to === 'string');
  } catch (e) {
    throw new Error(`.arbiter/${RENAMED_FILE} can't be read (${(e as Error).message.split('\n')[0]}) — a merge conflict? Fix the file, then run this again.`);
  }
}

/**
 * Note one rename. Earlier names that led to `from` now lead to `to`, so a card renamed twice still
 * gathers all its comments; and nothing leads away from `to`, which is a live name again.
 */
export function addRename(paths: Paths, from: string, to: string): void {
  const all = readRenames(paths)
    .filter((r) => r.from !== to && r.from !== from)
    .map((r) => (r.to === from ? { ...r, to } : r));
  all.push({ from, to });
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.writeFileSync(path.join(paths.archiveDir, RENAMED_FILE), JSON.stringify(all, null, 2) + '\n');
}

/** The snapshot file for a piece of work, if one was attached. */
export function workSnapshot(paths: Paths, id: string): string | null {
  for (const ext of IMAGE_EXT) {
    const f = path.join(workDir(paths), id + ext);
    if (fs.existsSync(f)) return f;
  }
  return null;
}

/** Copy an image in as `<dir>/<id><ext>`; any earlier one for that id goes. */
export function copyImage(root: string, dir: string, id: string, src: string): { ok: true; file: string } | { ok: false; error: string } {
  const abs = path.resolve(root, src);
  if (!fs.existsSync(abs)) return { ok: false, error: `snapshot not found: ${src}` };
  const ext = path.extname(abs).toLowerCase() || '.png';
  if (!IMAGE_EXT.includes(ext)) return { ok: false, error: `snapshot must be an image (png, jpg, webp, gif, svg), got ${ext}` };
  fs.mkdirSync(dir, { recursive: true });
  for (const e of IMAGE_EXT) if (e !== ext && fs.existsSync(path.join(dir, id + e))) fs.unlinkSync(path.join(dir, id + e));
  fs.copyFileSync(abs, path.join(dir, id + ext));
  return { ok: true, file: id + ext };
}

/** Drag-to-select a screen region with macOS's built-in `screencapture -i`. Escape cancels. */
export function captureImage(dir: string, id: string): { ok: true; file: string } | { ok: false; error: string } {
  if (process.platform !== 'darwin') return { ok: false, error: '--capture uses macOS screencapture; on other platforms pass an image file' };
  fs.mkdirSync(dir, { recursive: true });
  const out = path.join(dir, `${id}.png`);
  process.stderr.write('Drag to select the region to capture (Esc to cancel)…\n');
  try {
    execFileSync('screencapture', ['-i', '-x', out], { stdio: 'ignore' });
  } catch {
    return { ok: false, error: 'screencapture failed' };
  }
  if (!fs.existsSync(out) || fs.statSync(out).size === 0) return { ok: false, error: 'capture cancelled — no snapshot saved' };
  return { ok: true, file: `${id}.png` };
}
