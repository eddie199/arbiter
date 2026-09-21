/**
 * File I/O for the two decision files and arbiter.json. No other files in the
 * host project are touched from here.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Decision } from './schema';
import { activeHeader, archiveHeader, formatEntry, formatGrouped, parseEntries, pendingHeader } from './format';

export const ACTIVE_CAP = 40;

export interface Paths {
  root: string;
  decisions: string;
  archiveDir: string;
  archive: string;
  pending: string;
  config: string;
}

export interface Config {
  version: 1;
  destination: 'local' | 'git';
  author?: string;
  client?: 'claude-code' | 'cursor' | 'unknown';
  activeCap?: number;
  /** Project words too common to signal overlap: ["audit", "journey"]. */
  overlap?: { ignore?: string[] };
  /** Globs never swept: ["app/globals.css", "design-reference/**", "docs/**"]. */
  sweep?: { exclude?: string[] };
  /**
   * With destination "git": the export page is regenerated into this folder on every candidate
   * commit, so GitHub Pages (pointed at docs/) serves it at <owner>.github.io/<repo>/arbiter/.
   * Default { dir: "docs/arbiter" }. Set to false to skip.
   */
  pages?: { dir?: string; includeRules?: boolean } | false;
  /** A hosted board to publish to by default: `arbiter publish` with no --to. */
  hosted?: { url?: string };
}

export function resolvePaths(root: string = process.cwd()): Paths {
  return {
    root,
    decisions: path.join(root, 'DECISIONS.md'),
    archiveDir: path.join(root, '.arbiter'),
    archive: path.join(root, '.arbiter', 'archive.md'),
    pending: path.join(root, '.arbiter', 'pending.md'),
    config: path.join(root, 'arbiter.json'),
  };
}

/** Walk up from cwd to find the nearest arbiter.json. Falls back to cwd. */
export function findRoot(start: string = process.cwd()): string {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'arbiter.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return path.resolve(start);
    dir = parent;
  }
}

export function readConfig(paths: Paths): Config | null {
  if (!fs.existsSync(paths.config)) return null;
  return JSON.parse(fs.readFileSync(paths.config, 'utf8')) as Config;
}

export function writeConfig(paths: Paths, config: Config): void {
  fs.writeFileSync(paths.config, JSON.stringify(config, null, 2) + '\n');
}

export function readActive(paths: Paths): Decision[] {
  if (!fs.existsSync(paths.decisions)) return [];
  return parseEntries(fs.readFileSync(paths.decisions, 'utf8'));
}

/** Rewrites DECISIONS.md in full. Entries are re-serialized, so hand edits survive. */
export function writeActive(paths: Paths, decisions: Decision[], cap: number = ACTIVE_CAP): void {
  fs.writeFileSync(paths.decisions, activeHeader(decisions.length, cap) + '\n' + formatGrouped(decisions));
}

export function readArchive(paths: Paths): Decision[] {
  if (!fs.existsSync(paths.archive)) return [];
  return parseEntries(fs.readFileSync(paths.archive, 'utf8'));
}

/** Append-only. Creates the file with its header on first write. */
export function appendArchive(paths: Paths, d: Decision): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  const exists = fs.existsSync(paths.archive);
  const prefix = exists ? '\n' : archiveHeader() + '\n';
  fs.appendFileSync(paths.archive, prefix + formatEntry(d));
}

export function readPending(paths: Paths): Decision[] {
  if (!fs.existsSync(paths.pending)) return [];
  return parseEntries(fs.readFileSync(paths.pending, 'utf8'));
}

/** Rewrites pending.md in full. */
export function writePending(paths: Paths, decisions: Decision[]): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.writeFileSync(paths.pending, pendingHeader() + '\n' + decisions.map(formatEntry).join('\n'));
}

/** Next P- id. Pending ids are never reused within the file but may repeat once it empties. */
export function nextPendingId(pending: Decision[]): string {
  const max = pending.reduce((m, d) => Math.max(m, Number(d.id.slice(2))), 0);
  return `P-${String(max + 1).padStart(4, '0')}`;
}

/** Next sequential id, based on the highest id in the archive. */
export function nextId(archive: Decision[]): string {
  const max = archive.reduce((m, d) => Math.max(m, Number(d.id.slice(2))), 0);
  return `D-${String(max + 1).padStart(4, '0')}`;
}

/** Short SHA of HEAD, or null if not in a git repo. Never throws. */
export function currentCommit(root: string): string | null {
  try {
    return execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}

/** git user.name, or null. Never throws. */
export function gitUserName(root: string): string | null {
  try {
    return execFileSync('git', ['config', 'user.name'], {
      cwd: root,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .toString()
      .trim() || null;
  } catch {
    return null;
  }
}

/** Timestamp without milliseconds: 2026-09-15T14:32:10Z */
export function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
