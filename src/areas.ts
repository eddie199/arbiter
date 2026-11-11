/**
 * Folders in the local board's side nav: what you make under Areas, name, and drag areas into. Saved
 * in `.arbiter/areas.json`, beside the record, so it travels with the project: teammates and an
 * exported copy see the same folders. Areas themselves stay automatic (src/board-types.ts, `areasFor`
 * on the page); a folder only holds them, by name, so a change that joins an area joins its folder too.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './store';
import type { Arrangement, AreaFolder } from './board-types';

export const AREAS_FILE = 'areas.json';
const MAX_FOLDERS = 50;
const MAX_NAME = 60;
const MAX_AREA = 200;
const MAX_ORDER = 1000;
const FOLDER_ID = /^[a-z0-9]{1,24}$/;

export const areasPath = (paths: Paths) => path.join(paths.archiveDir, AREAS_FILE);

/** The saved folders, or null when there are none. A file that doesn't read is no folders, not a broken board. */
export function readArrangement(paths: Paths): Arrangement | null {
  const file = areasPath(paths);
  if (!fs.existsSync(file)) return null;
  try {
    const r = cleanArrangement(JSON.parse(fs.readFileSync(file, 'utf8')));
    return r.ok ? r.value : null;
  } catch {
    return null;
  }
}

/**
 * What the page sent, checked and tidied: names trimmed, an area in one folder at most (the first),
 * one entry per thing in the order. Anything it can't make sense of is refused whole, with why.
 */
export function cleanArrangement(input: unknown): { ok: true; value: Arrangement } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  const raw = (input ?? {}) as { folders?: unknown; order?: unknown };
  if (!Array.isArray(raw.folders)) errors.push('folders must be a list');
  if (raw.order !== undefined && !Array.isArray(raw.order)) errors.push('order must be a list');
  if (errors.length) return { ok: false, errors };
  const list = raw.folders as unknown[];
  if (list.length > MAX_FOLDERS) return { ok: false, errors: [`At most ${MAX_FOLDERS} folders`] };

  const folders: AreaFolder[] = [];
  const ids = new Set<string>();
  const names = new Set<string>();
  const filed = new Set<string>();
  for (const f of list) {
    const x = (f ?? {}) as { id?: unknown; name?: unknown; areas?: unknown };
    const id = typeof x.id === 'string' ? x.id : '';
    const name = typeof x.name === 'string' ? x.name.replace(/\s+/g, ' ').trim() : '';
    if (!FOLDER_ID.test(id)) { errors.push(`A folder id must be letters and digits: ${JSON.stringify(x.id)}`); continue; }
    if (ids.has(id)) { errors.push(`Two folders share the id ${id}`); continue; }
    if (!name) { errors.push('A folder needs a name'); continue; }
    if (name.length > MAX_NAME) { errors.push(`A folder name is ${MAX_NAME} characters at most`); continue; }
    if (names.has(name.toLowerCase())) { errors.push(`There's already a folder called ${name}`); continue; }
    if (!Array.isArray(x.areas)) { errors.push(`${name}: areas must be a list`); continue; }
    ids.add(id);
    names.add(name.toLowerCase());
    const areas: string[] = [];
    for (const a of x.areas) {
      if (typeof a !== 'string') continue;
      const area = a.trim();
      if (!area || area.length > MAX_AREA || filed.has(area.toLowerCase())) continue;
      filed.add(area.toLowerCase());
      areas.push(area);
    }
    folders.push({ id, name, areas });
  }
  if (errors.length) return { ok: false, errors };

  const order: string[] = [];
  const seen = new Set<string>();
  for (const k of (raw.order as unknown[] | undefined) ?? []) {
    if (typeof k !== 'string') continue;
    const key = k.trim();
    if (!key || key.length > MAX_AREA + 7 || seen.has(key.toLowerCase())) continue;
    // A folder that isn't there, or an area that's inside a folder, has no place at the top.
    if (key.startsWith('folder:') ? !ids.has(key.slice(7)) : filed.has(key.toLowerCase())) continue;
    seen.add(key.toLowerCase());
    order.push(key);
    if (order.length >= MAX_ORDER) break;
  }
  return { ok: true, value: { folders, order } };
}

/** Saves the folders. With none left and no order of your own, the file goes, and the board is as it was. */
export function writeArrangement(paths: Paths, a: Arrangement): void {
  const file = areasPath(paths);
  if (!a.folders.length && !a.order.length) {
    if (fs.existsSync(file)) fs.rmSync(file);
    return;
  }
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(a, null, 2)}\n`);
}
