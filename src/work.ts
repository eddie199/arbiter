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
