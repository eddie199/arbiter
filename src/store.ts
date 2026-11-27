/**
 * File I/O for the two decision files and arbiter.json. No other files in the
 * host project are touched from here.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Decision } from './schema';
import { archiveHeader, formatActive, formatEntry, isRulesFile, notesOf, parseEntries, pendingHeader } from './format';
import { writeAtomic } from './lock';

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
  /** When the agent adds its one line: after feature-level work (default), never, or after every piece of work. */
  checkin?: 'feature' | 'quiet' | 'every';
  /** Set once the check-in question is answered: at install, or by `setup --checkin` after it. */
  onboarded?: string;
  /** Set when the first /arbiter's intro was handed to the agent, so it's said once. */
  introduced?: string;
  /** Where the app runs, so the agent has an address to open for screenshots. Set by `arbiter setup --app`. */
  app?: { url: string };
  /**
   * What `record --pending` queues, from Preferences on the board. `level`: the smallest call queued,
   * "pattern" (features and patterns, the default) or "feature" (features only). `agent: false`: only
   * what the person asked for or corrected; the agent's own calls aren't queued. A clash always is.
   */
  record?: { level?: 'pattern' | 'feature'; agent?: boolean };
  /** False: no pictures. Nothing asks for one, and replies to `record` say `pictures: false`. */
  pictures?: boolean;
  /** False: the agent doesn't offer to group areas into folders. `arbiter areas` says so. */
  suggestFolders?: boolean;
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
  /**
   * A hosted board to publish to by default: `arbiter publish` with no --to.
   * `auto` republishes whenever the record changes — for projects with no GitHub, no CI, or no
   * repository at all. Set by `arbiter publish --auto`.
   */
  hosted?: { url?: string; auto?: boolean };
  /**
   * The rules file, when it isn't DECISIONS.md: a file name in the project's root. Set by `init`
   * when the project already had a DECISIONS.md of its own, which Arbiter then leaves alone.
   */
  decisions?: string;
}

/** The rules file's name when arbiter.json doesn't give another. */
export const RULES_FILE = 'DECISIONS.md';
/** Where the rules go instead when the project's DECISIONS.md is someone else's, in order. */
export const RULES_FILE_ALTERNATIVES = ['DESIGN-DECISIONS.md', 'ARBITER-DECISIONS.md'];
/** Files a rules file may never be: Arbiter rewrites its rules file in full. CANDIDATES.md is Arbiter's own index. */
const NEVER_RULES = new Set(['readme.md', 'claude.md', 'agents.md', 'changelog.md', 'license.md', 'contributing.md', 'candidates.md', 'design.md']);
/** Names Windows keeps for devices, whatever follows the dot. */
const DEVICE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])\./i;

/**
 * A rules file arbiter.json may name: a Markdown file in the project's root and nothing else, so
 * the setting can't reach outside the project or into a file that belongs to something else. A
 * different spelling of DECISIONS.md is refused too: on Windows and macOS it is the same file.
 */
export function rulesFileAllowed(name: unknown): name is string {
  if (typeof name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(name)) return false;
  const lower = name.toLowerCase();
  return !NEVER_RULES.has(lower) && !DEVICE.test(name) && !(lower === RULES_FILE.toLowerCase() && name !== RULES_FILE);
}

/** The rules file arbiter.json names, or DECISIONS.md. A missing or unreadable arbiter.json is the default. */
function rulesFileOf(root: string): string {
  try {
    const name = (JSON.parse(fs.readFileSync(path.join(root, 'arbiter.json'), 'utf8')) as { decisions?: unknown }).decisions;
    if (rulesFileAllowed(name)) return name;
  } catch {
    // No arbiter.json yet, or one that isn't JSON: readConfig says so where it matters.
  }
  return RULES_FILE;
}

/** The rules file's name as people see it in messages, the skill and the board: `DECISIONS.md` unless arbiter.json names another. */
export function rulesName(paths: Paths): string {
  return path.basename(paths.decisions);
}

/**
 * Where this project's rules live, at install. DECISIONS.md, unless the project already has one of
 * its own (a decision log, say): Arbiter rewrites its rules file whenever a rule changes, so it never
 * takes over a file it didn't write. Then the first free name of the alternatives. A name arbiter.json
 * already gives is kept, so a re-run never moves the rules.
 */
export function chooseRulesFile(root: string, existing: Config | null): string {
  const named = existing?.decisions;
  // A name set by hand is kept only while it's free or Arbiter's: never someone else's file.
  if (rulesFileAllowed(named) && (!fs.existsSync(path.join(root, named)) || isRulesFile(fs.readFileSync(path.join(root, named), 'utf8')))) return named;
  for (const name of [RULES_FILE, ...RULES_FILE_ALTERNATIVES]) {
    const abs = path.join(root, name);
    if (!fs.existsSync(abs) || isRulesFile(fs.readFileSync(abs, 'utf8'))) return name;
  }
  throw new Error(`${[RULES_FILE, ...RULES_FILE_ALTERNATIVES].join(', ')} are all files of your own, so Arbiter has nowhere to keep its rules. Set "decisions" in arbiter.json to a new file name, like "UI-DECISIONS.md", and run init again.`);
}

/**
 * How the agent and the board run Arbiter in this project. `npx arbiter` finds the copy install added to
 * package.json. With none there (no package.json, or install couldn't add it), `npx arbiter` would fetch
 * the npm package called arbiter, which is someone else's, so the full name is used instead.
 */
export function arbiterCommand(root: string): string {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
    if (pkg.name === 'arbiterdesign' || pkg.devDependencies?.arbiterdesign || pkg.dependencies?.arbiterdesign) return 'npx arbiter';
  } catch {
    // No package.json, or one that isn't JSON.
  }
  return 'npx arbiterdesign';
}

/** Text that runs `npx arbiter …`, as this project runs it. */
export const withCommand = (text: string, command: string) => (command === 'npx arbiter' ? text : text.replace(/npx arbiter(?![A-Za-z])/g, command));

/** What to tell the user when this command moved the rules to a file of their own: once, then null. */
let moved: string | null = null;
export function takeRulesMoved(): { file: string; say: string } | null {
  const file = moved;
  moved = null;
  return file ? { file, say: rulesMovedLine(file, true) } : null;
}

/** The one line that says why the rules are in another file. `now`: it happened just now, not at install. */
export function rulesMovedLine(file: string, now = false): string {
  return now
    ? `You already have a DECISIONS.md, so Arbiter has put your design rules in their own file, ${file}. Yours stays exactly as it is: Arbiter never writes to it.`
    : `You already have a DECISIONS.md, so Arbiter keeps your design rules in their own file, ${file}. Yours stays exactly as it is: Arbiter never writes to it.`;
}

/**
 * Points `paths` at the rules file arbiter.json names now. A board started before the rules moved, or
 * any `paths` resolved before, would otherwise read and write the old file, which may be someone else's.
 */
function syncRulesPath(paths: Paths): void {
  const now = path.join(paths.root, rulesFileOf(paths.root));
  if (now !== paths.decisions) paths.decisions = now;
}

/**
 * Before the first write into DECISIONS.md: if it isn't Arbiter's (the project's own, from before an
 * install that checked, with no `npx arbiter update` since, or with no install at all), it's left alone.
 * The rules go in a new file of their own, arbiter.json says which (made, if there's none), and what
 * points the agent at the rules points there instead. With no free name, nothing moves: the file is
 * still written with every line of theirs kept.
 */
function claimRulesFile(paths: Paths): void {
  if (!fs.existsSync(paths.decisions)) return;
  let config: Config | null;
  try {
    config = readConfig(paths);
  } catch {
    if (!isRulesFile(fs.readFileSync(paths.decisions, 'utf8'))) {
      throw new Error(`arbiter.json isn't valid JSON, so Arbiter can't tell where its rules go, and ${rulesName(paths)} isn't one it wrote. Nothing was written to it. Fix arbiter.json, then try again.`);
    }
    return;
  }
  if (config && rulesFileAllowed(config.decisions) && config.decisions !== RULES_FILE) return;
  if (isRulesFile(fs.readFileSync(paths.decisions, 'utf8'))) return;
  // Only a name nobody's using: rules already in a file mean arbiter.json lost track, and a guess could write over them.
  const name = RULES_FILE_ALTERNATIVES.find((n) => {
    const abs = path.join(paths.root, n);
    return !fs.existsSync(abs) || !fs.readFileSync(abs, 'utf8').trim();
  });
  if (!name) return;
  writeConfig(paths, { ...(config ?? { version: 1, destination: 'local' }), decisions: name });
  paths.decisions = path.join(paths.root, name);
  moved = name;
  try {
    // Here and not at the top: init reads this file, so a top-level import would go round in a circle.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('./commands/init') as typeof import('./commands/init')).pointAgentsAt(paths.root, config?.client, name);
  } catch {
    // The rules are safe either way; `npx arbiter update` points the agent at them.
  }
}

export function resolvePaths(root: string = process.cwd()): Paths {
  return {
    root,
    decisions: path.join(root, rulesFileOf(root)),
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
  writeAtomic(paths.config, JSON.stringify(config, null, 2) + '\n');
}

export function readActive(paths: Paths): Decision[] {
  syncRulesPath(paths);
  if (!fs.existsSync(paths.decisions)) return [];
  return parseEntries(fs.readFileSync(paths.decisions, 'utf8'));
}

/**
 * Rewrites the rules file in full. Entries are re-serialized, so hand edits to them survive, and
 * anything else written in the file (a preamble, a section of notes) is kept word for word: above
 * the rules if it was above them, below otherwise.
 */
export function writeActive(paths: Paths, decisions: Decision[], cap: number = ACTIVE_CAP): void {
  syncRulesPath(paths);
  claimRulesFile(paths);
  const before = fs.existsSync(paths.decisions) ? fs.readFileSync(paths.decisions, 'utf8') : '';
  // A file arbiter.json names by hand that turns out to be someone else's: never written into.
  if (before.trim() && !isRulesFile(before) && rulesName(paths) !== RULES_FILE) {
    throw new Error(`arbiter.json names ${rulesName(paths)} as the rules file, but it isn't one Arbiter wrote, so nothing was written to it. Point "decisions" in arbiter.json at a new file name.`);
  }
  writeAtomic(paths.decisions, formatActive(decisions, cap, notesOf(before)));
}

export function readArchive(paths: Paths): Decision[] {
  if (!fs.existsSync(paths.archive)) return [];
  return parseEntries(fs.readFileSync(paths.archive, 'utf8'));
}

/** Append-only. Creates the file with its header on first write. */
export function appendArchive(paths: Paths, d: Decision): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  const exists = fs.existsSync(paths.archive);
  const prefix = exists ? '\n' : archiveHeader(rulesName(paths)) + '\n';
  fs.appendFileSync(paths.archive, prefix + formatEntry(d));
}

/**
 * Rewrites the archive in full. Only `remove`, `unlink` and `rename` use this: the archive is append-only
 * for judgments — a decision you changed your mind about is superseded, never rewritten — but a
 * record of something that never happened is noise, not history, and has to be able to leave.
 */
export function writeArchive(paths: Paths, decisions: Decision[]): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  writeAtomic(paths.archive, archiveHeader(rulesName(paths)) + '\n' + decisions.map(formatEntry).join('\n'));
}

export function readPending(paths: Paths): Decision[] {
  if (!fs.existsSync(paths.pending)) return [];
  return parseEntries(fs.readFileSync(paths.pending, 'utf8'));
}

/** Rewrites pending.md in full. */
export function writePending(paths: Paths, decisions: Decision[]): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  writeAtomic(paths.pending, pendingHeader(rulesName(paths)) + '\n' + decisions.map(formatEntry).join('\n'));
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

/**
 * Whoever is at the keyboard. arbiter.json's author is committed, so in a shared repo it names
 * whoever ran init — it's the fallback for a machine with no git identity, not the default.
 */
export function currentAuthor(root: string): string {
  return gitUserName(root) ?? readConfig(resolvePaths(root))?.author ?? os.userInfo().username;
}

/** Timestamp without milliseconds: 2026-09-15T14:32:10Z */
export function now(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}
