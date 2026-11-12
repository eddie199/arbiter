/**
 * `arbiter areas` — where everything sits on the board: Folder → Area → Change → Decision.
 *
 * The agent reads it before naming a piece of work, so new work joins an area that's already there
 * ("Review inbox — Sorting") instead of starting one of its own. `--save` writes the folders, once the
 * person has said yes to them; it's the same file the board's side nav saves (`.arbiter/areas.json`).
 */

import { findRoot, readArchive, readConfig, resolvePaths, type Paths } from '../store';
import { liveBoard } from '../localboard';
import { areasFor, layoutOf, arrangementOf, type Entry } from '../area-names';
import { cleanArrangement, writeArrangement } from '../areas';
import { workId } from '../work';
import type { Decision } from '../schema';

export interface AreaView { name: string; changes: string[] }
export interface FolderView { id: string; name: string; areas: AreaView[] }
export interface Structure { folders: FolderView[]; loose: AreaView[]; counts: { folders: number; areas: number; changes: number } }
export interface AreasResult { exitCode: 0 | 1; output: Record<string, unknown>; text?: string }

/** The board as the side nav shows it: folders with their areas, then the areas in no folder, each with its changes. */
export function structureOf(paths: Paths): Structure {
  const data = liveBoard(paths);
  // Work with nothing judged yet is placed by what's waiting on it, as the board places it.
  const cards = data.board.candidates.map((c) => (c.work && !c.decisions.length ? { ...c, decisions: data.queued[c.id] ?? [] } : c));
  const of = areasFor(cards);
  const changes = new Map<string, string[]>();
  for (const c of cards) changes.set(of(c), [...(changes.get(of(c)) ?? []), c.name]);
  const view = (name: string): AreaView => ({ name, changes: changes.get(name) ?? [] });
  const rows = layoutOf([...changes.keys()], data.arrangement);
  const folders = rows.flatMap((e) => (e.kind === 'folder' ? [{ id: e.id, name: e.name, areas: e.areas.map(view) }] : []));
  const loose = rows.flatMap((e) => (e.kind === 'area' ? [view(e.name)] : []));
  return { folders, loose, counts: { folders: folders.length, areas: changes.size, changes: cards.length } };
}

/** The structure as lines: folders, their areas with a count, the changes under each. */
export function structureText(s: Structure): string {
  const n = (k: number, one: string) => `${k} ${one}${k === 1 ? '' : 's'}`;
  const out = [`Areas · ${[s.counts.folders ? n(s.counts.folders, 'folder') : '', n(s.counts.areas, 'area'), n(s.counts.changes, 'change')].filter(Boolean).join(', ')}`, ''];
  const area = (a: AreaView, indent: string) => {
    out.push(`${indent}${a.name} · ${a.changes.length}`);
    for (const c of a.changes) out.push(`${indent}  ${c}`);
  };
  for (const f of s.folders) {
    out.push(f.name);
    if (!f.areas.length) out.push('  (empty)');
    for (const a of f.areas) area(a, '  ');
  }
  if (s.folders.length && s.loose.length) out.push('Not in a folder');
  for (const a of s.loose) area(a, s.folders.length ? '  ' : '');
  return out.join('\n');
}

export function areasCommand(opts: { cwd?: string; json?: boolean; save?: string } = {}): AreasResult {
  const paths = resolvePaths(findRoot(opts.cwd));
  if (opts.save !== undefined) {
    const saved = saveFolders(paths, opts.save);
    if (saved.exitCode !== 0) return saved;
  }
  const s = structureOf(paths);
  // Turned off in Preferences: the agent doesn't offer to group areas into folders.
  const quiet = readConfig(paths)?.suggestFolders === false;
  return {
    exitCode: 0,
    output: { ...(opts.save !== undefined ? { status: 'saved' } : {}), ...s, ...(quiet ? { suggestFolders: false } : {}) },
    text: structureText(s) + (quiet ? '\n\nFolder suggestions are off (Preferences, on the board): don\'t offer to group areas.' : ''),
  };
}

/**
 * Folders as the agent proposes them, once the person has said yes: `{ "folders": [{ "name", "areas" }] }`.
 * It replaces the folders there were. Every area named has to be on the board, so a typo is caught
 * rather than saved; areas left out stay where they are, in no folder.
 */
export function saveFolders(paths: Paths, raw: string): AreasResult {
  let input: { folders?: { id?: string; name?: string; areas?: string[] }[] };
  try { input = JSON.parse(raw); } catch (e) { return fail([`not JSON: ${(e as Error).message}`]); }
  if (!Array.isArray(input?.folders)) return fail(['expected { "folders": [{ "name": "Local board", "areas": ["Review inbox", "Change page"] }] }']);
  const s = structureOf(paths);
  const known = new Map([...s.folders.flatMap((f) => f.areas), ...s.loose].map((a) => [a.name.toLowerCase(), a.name]));
  const unknown = input.folders.flatMap((f) => (f.areas ?? []).filter((a) => !known.has(String(a).trim().toLowerCase())));
  if (unknown.length) return fail([`not an area on the board: ${unknown.join(', ')}`, `areas: ${[...known.values()].join(', ')}`]);

  // Ids from names, kept for folders that already had one, so the board's open folders stay open.
  const had = new Map(s.folders.map((f) => [f.name.toLowerCase(), f.id]));
  const used = new Set<string>();
  const idFor = (name: string) => {
    const base = had.get(name.toLowerCase()) ?? (name.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20) || 'folder');
    let id = base;
    for (let i = 2; used.has(id); i++) id = `${base.slice(0, 20)}${i}`;
    used.add(id);
    return id;
  };
  const folders: Entry[] = input.folders.map((f) => ({ kind: 'folder', id: f.id && /^[a-z0-9]{1,24}$/.test(f.id) ? f.id : idFor(String(f.name ?? '')), name: String(f.name ?? ''), areas: (f.areas ?? []).map((a) => known.get(String(a).trim().toLowerCase())!) }));
  const filed = new Set(folders.flatMap((f) => (f.kind === 'folder' ? f.areas.map((a) => a.toLowerCase()) : [])));
  // The folders first, in the order given, then every area left out, in the order it had.
  const rest: Entry[] = [...s.folders.flatMap((f) => f.areas), ...s.loose].filter((a) => !filed.has(a.name.toLowerCase())).map((a) => ({ kind: 'area', name: a.name }));
  const r = cleanArrangement(arrangementOf([...folders, ...rest]));
  if (!r.ok) return fail(r.errors);
  writeArrangement(paths, r.value);
  return { exitCode: 0, output: { status: 'saved' } };
}

/**
 * For the reply to `record --pending`: the area a piece of work landed in, and, when it's the first
 * decision of new work that starts an area of its own, the areas already there, so the agent can
 * rename it into one of them.
 */
export function placement(paths: Paths, entry: Decision, earlier: Decision[]): Record<string, unknown> {
  if (entry.candidate) return {};
  try {
    const s = structureOf(paths);
    const all = [...s.folders.flatMap((f) => f.areas.map((a) => ({ ...a, folder: f.name as string | null }))), ...s.loose.map((a) => ({ ...a, folder: null as string | null }))];
    const mine = all.find((a) => a.changes.some((c) => workId(c) === workId(entry.trigger)));
    if (!mine) return {};
    const first = !earlier.some((d) => workId(d.trigger) === workId(entry.trigger)) && !readArchive(paths).some((d) => workId(d.trigger) === workId(entry.trigger));
    const others = all.filter((a) => a !== mine).map((a) => a.name);
    const fresh = first && mine.changes.length === 1 && others.length > 0;
    // New work beside changes already in its area: it may continue one of them, and then it belongs in it.
    const beside = first && !fresh ? mine.changes.filter((c) => workId(c) !== workId(entry.trigger)) : [];
    return {
      area: mine.name,
      ...(mine.folder ? { folder: mine.folder } : {}),
      ...(fresh ? {
        newArea: true,
        areas: others.slice(0, 40),
        hint: `"${entry.trigger}" starts an area of its own. If it belongs in one of these, rename it: npx arbiter rename "${entry.trigger}" "<Area> — <what changed>"`,
      } : {}),
      ...(beside.length ? {
        newChange: true,
        changes: beside.slice(0, 40),
        hint: `"${entry.trigger}" is a new change in ${mine.name}. If it continues one of these, merge it, so its picture becomes that change's next version: npx arbiter rename "${entry.trigger}" "<that change>" --merge`,
      } : {}),
    };
  } catch {
    // Where it sits is a courtesy: a board that won't read never stops a decision being queued.
    return {};
  }
}

const fail = (errors: string[]): AreasResult => ({ exitCode: 1, output: { status: 'invalid', errors } });
