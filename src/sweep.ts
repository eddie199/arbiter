/**
 * Sweep: apply a mechanical rule backwards. Search existing source for the
 * rule's forbidden strings (`expect.absent`). Read-only; reports, never edits.
 * Only mechanical rules with `absent` needles can sweep — judgment rules
 * inform generation and nothing more.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Decision, parseScope } from './schema';
import { matcher } from './verify';

export interface Violation {
  file: string;
  line: number;
  needle: string;
  text: string;
}

export interface SweepResult {
  sweepable: boolean;
  reason?: string;
  needles: string[];
  filesScanned: number;
  violations: Violation[];
  /** Where the scan set came from — so a too-wide sweep explains itself. */
  scanned: 'rule.paths' | 'scope' | 'project';
  excluded: string[];
}

export interface SweepOptions {
  /** Globs never scanned. From arbiter.json → sweep.exclude. `**` matches across directories. */
  exclude?: string[];
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'out', '.next', '.nuxt', 'coverage', '.arbiter', '.turbo', '.cache', 'vendor']);
const SOURCE_EXT = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte', '.astro', '.css', '.scss', '.less', '.html']);
const MAX_FILES = 5000;
const MAX_BYTES = 1_000_000;

export function sweep(root: string, rule: Decision, opts: SweepOptions = {}): SweepResult {
  const needles = rule.expect?.absent ?? [];
  const excluded = opts.exclude ?? [];
  const none = (reason: string): SweepResult => ({ sweepable: false, reason, needles, filesScanned: 0, violations: [], scanned: 'project', excluded });
  if (rule.class !== 'mechanical') return none('judgment rules cannot sweep — they inform, they never enforce');
  if (!needles.length) return none('rule has no expect.absent strings to search for');

  const { files: candidates, scanned } = targetFiles(root, rule);
  const skip = excluded.map(globToRegex);
  const files = candidates.filter((f) => !skip.some((re) => re.test(f)));
  const violations: Violation[] = [];
  for (const f of files) {
    const abs = path.join(root, f);
    let text: string;
    try {
      if (fs.statSync(abs).size > MAX_BYTES) continue;
      text = fs.readFileSync(abs, 'utf8');
    } catch {
      continue;
    }
    const finders = needles.map((n) => [n, matcher(n)] as const);
    if (!finders.some(([, find]) => find(text) >= 0)) continue;
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      for (const [n, find] of finders) if (find(line) >= 0) violations.push({ file: f, line: i + 1, needle: n, text: line.trim().slice(0, 120) });
    });
  }
  return { sweepable: true, needles, filesScanned: files.length, violations, scanned, excluded };
}

/**
 * The scan set, narrowest first: the rule's `paths` (files or directories)
 * if it has any; else a file: scope; else every source file in the project.
 * A pattern: rule with no `paths` sweeps the whole project — name the
 * directories it applies to if that's too wide.
 */
function targetFiles(root: string, rule: Decision): { files: string[]; scanned: SweepResult['scanned'] } {
  const expand = (p: string): string[] => {
    const abs = path.resolve(root, p);
    if (!abs.startsWith(path.resolve(root)) || !fs.existsSync(abs)) return [];
    return fs.statSync(abs).isFile() ? [rel(root, abs)] : walk(abs, root);
  };
  if (rule.paths.length) return { files: [...new Set(rule.paths.flatMap(expand))], scanned: 'rule.paths' };
  const scope = parseScope(rule.scope);
  if (scope.kind === 'file') return { files: expand(scope.target!), scanned: 'scope' };
  return { files: walk(root, root), scanned: 'project' };
}

/**
 * A path relative to the root, always with `/`. Windows' path.relative gives `docs\ref.html`,
 * but excludes and rule.paths are written as globs with `/` — unnormalised, every exclude
 * silently matched nothing there. It's also what gets recorded and published, so one project's
 * violations shouldn't read differently depending on who swept.
 */
const rel = (root: string, abs: string): string => path.relative(root, abs).split(path.sep).join('/');

function walk(dir: string, root: string, out: string[] = []): string[] {
  if (out.length >= MAX_FILES) return out;
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) break;
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name) && !e.name.startsWith('.')) walk(path.join(dir, e.name), root, out);
    } else if (e.isFile() && SOURCE_EXT.has(path.extname(e.name))) {
      out.push(rel(root, path.join(dir, e.name)));
    }
  }
  return out;
}

/** Minimal glob: `**` any depth, `*` within a segment, `?` one char. Anchored to the relative path. */
export function globToRegex(glob: string): RegExp {
  let out = '';
  const g = glob.replace(/\\/g, '/');
  for (let i = 0; i < g.length; i++) {
    const ch = g[i];
    if (ch === '*' && g[i + 1] === '*') {
      if (g[i + 2] === '/') { out += '(?:.*/)?'; i += 2; }
      else { out += '.*'; i += 1; }
    } else if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else out += ch.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function summarize(r: SweepResult): { violations: number; files: number } {
  return { violations: r.violations.length, files: new Set(r.violations.map((v) => v.file)).size };
}
