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

/**
 * Earlier pictures of a piece of work, so the board can show how it got where it is. A new picture
 * doesn't overwrite the last: the last moves to `.arbiter/work/history/<id>/<when it was taken>.<ext>`,
 * and the newest stays where it always was, `<id>.<ext>`, so everything that reads the current picture
 * still finds it. The ten most recent earlier pictures are kept.
 */
export const KEEP_VERSIONS = 10;
const HISTORY = 'history';
const STAMP = /^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})(?:-(\d{3}))?Z$/;

const stampOf = (d: Date): string => d.toISOString().replace(/:/g, '-').replace('.', '-');
const dateOfStamp = (s: string): string | null => {
  const m = STAMP.exec(s);
  return m ? `${m[1]}T${m[2]}:${m[3]}:${m[4]}.${m[5] ?? '000'}Z` : null;
};

/** The current picture moves into the history, dated when it was taken. Returns where it went, to put it back if the new one fails. */
export function keepEarlier(paths: Paths, id: string): { from: string; to: string } | null {
  const cur = workSnapshot(paths, id);
  if (!cur) return null;
  const dir = path.join(workDir(paths), HISTORY, id);
  fs.mkdirSync(dir, { recursive: true });
  const to = path.join(dir, stampOf(fs.statSync(cur).mtime) + path.extname(cur).toLowerCase());
  fs.renameSync(cur, to);
  // Only the most recent earlier pictures stay.
  const all = fs.readdirSync(dir).filter((f) => dateOfStamp(path.parse(f).name)).sort();
  for (const f of all.slice(0, Math.max(0, all.length - KEEP_VERSIONS))) fs.rmSync(path.join(dir, f), { force: true });
  return { from: cur, to };
}

/** A new picture didn't come: the one moved into the history goes back. */
export function restoreEarlier(moved: { from: string; to: string } | null): void {
  if (moved && fs.existsSync(moved.to) && !fs.existsSync(moved.from)) fs.renameSync(moved.to, moved.from);
}

/** A renamed piece of work takes its earlier pictures with it. */
export function moveHistory(paths: Paths, from: string, to: string): boolean {
  const src = path.join(workDir(paths), HISTORY, from);
  if (!fs.existsSync(src)) return false;
  const dst = path.join(workDir(paths), HISTORY, to);
  fs.rmSync(dst, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.renameSync(src, dst);
  return true;
}

/**
 * Every picture of a piece of work, oldest first, the current one last: `file` relative to
 * `.arbiter/work/`, and when it was taken. Empty when there's no picture.
 */
export function workVersions(paths: Paths, id: string): { file: string; date: string }[] {
  const out: { file: string; date: string }[] = [];
  const dir = path.join(workDir(paths), HISTORY, id);
  if (fs.existsSync(dir)) {
    for (const f of fs.readdirSync(dir).sort()) {
      const date = dateOfStamp(path.parse(f).name);
      if (date && IMAGE_EXT.includes(path.extname(f).toLowerCase())) out.push({ file: `${HISTORY}/${id}/${f}`, date });
    }
  }
  const cur = workSnapshot(paths, id);
  if (cur) out.push({ file: path.basename(cur), date: fs.statSync(cur).mtime.toISOString() });
  return out;
}

/** An earlier picture's path under `.arbiter/work/`, as a URL names it: `history/W-…/2026-11-09T17-39-00-000Z.png`. Null for anything else. */
export function historyFile(paths: Paths, rel: string): string | null {
  const m = /^history\/(W-[a-z0-9-]{1,48})\/([0-9T-]+Z)\.(png|jpe?g|webp|gif|svg)$/.exec(rel);
  if (!m || !dateOfStamp(m[2])) return null;
  const abs = path.join(workDir(paths), HISTORY, m[1], `${m[2]}.${m[3]}`);
  return fs.existsSync(abs) ? abs : null;
}

/**
 * A piece of work merged into another: every picture of both, by when each was taken, becomes the
 * other's. The newest is its picture; the rest are its earlier pictures, the most recent ten kept.
 * False when the merged one had no pictures.
 */
export function mergePictures(paths: Paths, from: string, to: string): boolean {
  const mine = workVersions(paths, from);
  if (!mine.length) return false;
  const all = [...mine, ...workVersions(paths, to)].map((v) => ({ abs: path.join(workDir(paths), v.file), date: v.date }));
  const dir = path.join(workDir(paths), HISTORY, to);
  fs.mkdirSync(dir, { recursive: true });
  // Everything into the history first, named by when it was taken; then the newest comes back out.
  const staged = all.map((v) => {
    let dest = path.join(dir, stampOf(new Date(v.date)) + path.extname(v.abs).toLowerCase());
    if (dest !== v.abs && fs.existsSync(dest)) dest = path.join(dir, stampOf(new Date(Date.parse(v.date) + 1)) + path.extname(v.abs).toLowerCase());
    if (dest !== v.abs) fs.renameSync(v.abs, dest);
    return { abs: dest, date: v.date };
  }).sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const newest = staged[staged.length - 1];
  const cur = path.join(workDir(paths), to + path.extname(newest.abs));
  fs.renameSync(newest.abs, cur);
  fs.utimesSync(cur, new Date(newest.date), new Date(newest.date));
  const left = fs.readdirSync(dir).filter((f) => dateOfStamp(path.parse(f).name)).sort();
  for (const f of left.slice(0, Math.max(0, left.length - KEEP_VERSIONS))) fs.rmSync(path.join(dir, f), { force: true });
  fs.rmSync(path.join(workDir(paths), HISTORY, from), { recursive: true, force: true });
  return true;
}
