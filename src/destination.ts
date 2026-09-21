/**
 * Destination adapter. Capture and record are identical everywhere; only
 * delivery differs.
 *
 *   local  — files in .arbiter/candidates/. Nothing else.
 *   git    — also a CANDIDATES.md index at the root, the export page under
 *            docs/arbiter/ for GitHub Pages, and a commit of all of it so
 *            GitHub renders and serves them. Never pushes. Prints the links
 *            that will work once the branch is pushed.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Candidate, readCandidates, candidatesDir } from './candidates';
import { Config, Paths } from './store';
import { exportBoard } from './commands/export';

export const DEFAULT_PAGES_DIR = 'docs/arbiter';

export interface DeliveryResult {
  destination: 'local' | 'git';
  committed?: string | null;
  links?: string[];
  /** The GitHub Pages URL for the export page, once Pages is on and the branch is pushed. */
  pages?: string | null;
  warning?: string;
}

export function deliver(paths: Paths, config: Config | null, changed: Candidate[], message: string): DeliveryResult {
  const destination = config?.destination ?? 'local';
  if (destination !== 'git') return { destination: 'local' };

  writeIndex(paths);
  const root = paths.root;
  const pagesDir = config?.pages === false ? null : path.resolve(root, config?.pages?.dir ?? DEFAULT_PAGES_DIR);
  if (pagesDir) exportBoard({ cwd: root, out: pagesDir, includeRules: config?.pages && config.pages.includeRules });
  if (!git(root, ['rev-parse', '--is-inside-work-tree'])) {
    return { destination, committed: null, warning: 'destination is git but this is not a git repository — files written, nothing committed' };
  }
  const rel = (p: string) => path.relative(root, p);
  git(root, ['add', '--', rel(candidatesDir(paths)), 'CANDIDATES.md', ...(pagesDir ? [rel(pagesDir)] : [])]);
  const staged = git(root, ['diff', '--cached', '--name-only']);
  let committed: string | null = null;
  if (staged) {
    git(root, ['commit', '-q', '-m', `arbiter: ${message}`]);
    committed = git(root, ['rev-parse', '--short', 'HEAD']);
  }
  return {
    destination,
    committed,
    links: changed.map((c) => linkFor(root, config, c.id)).filter((l): l is string => !!l),
    pages: pagesDir ? pagesUrl(root, config) : null,
  };
}

/** Where GitHub Pages will serve the export, if Pages is pointed at docs/ and origin is GitHub. */
export function pagesUrl(root: string, config: Config | null): string | null {
  if (config?.destination !== 'git' || config.pages === false) return null;
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const m = remote && /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (!m) return null;
  const dir = (config.pages?.dir ?? DEFAULT_PAGES_DIR).replace(/\\/g, '/').replace(/\/+$/, '');
  const sub = dir.startsWith('docs/') ? dir.slice(5) : dir === 'docs' ? '' : dir;
  return `https://${m[1].toLowerCase()}.github.io/${m[2]}/${sub ? sub + '/' : ''}`;
}

/** Root-level index GitHub renders: every candidate, by feature, linking to its page. */
export function writeIndex(paths: Paths): void {
  const all = readCandidates(paths);
  const features = [...new Set(all.map((c) => c.feature ?? '—'))];
  const lines = ['# Candidates', '', 'Generated screens and their state. Managed by `arbiter` — each row links to the candidate page with its snapshot, decisions, and reasoning.', ''];
  for (const f of features) {
    lines.push(`## ${f}`, '', '| Id | Name | State | Author | Date |', '|---|---|---|---|---|');
    for (const c of all.filter((c) => (c.feature ?? '—') === f)) {
      const state = c.state === 'superseded' ? `superseded → ${c.supersededBy}` : c.state.replace('_', ' ');
      lines.push(`| [${c.id}](.arbiter/candidates/${c.id}.md) | ${c.name} | ${state} | ${c.author} | ${c.date.slice(0, 10)} |`);
    }
    lines.push('');
  }
  fs.writeFileSync(path.join(paths.root, 'CANDIDATES.md'), lines.join('\n'));
}

/** GitHub URL for a candidate page, if the origin remote is GitHub. */
export function linkFor(root: string, config: Config | null, id: string): string | null {
  if (config?.destination !== 'git') return null;
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const m = remote && /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (!m) return null;
  return `https://github.com/${m[1]}/${m[2]}/blob/${branch}/.arbiter/candidates/${id}.md`;
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}
