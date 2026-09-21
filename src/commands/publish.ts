/**
 * `arbiter publish` — put the board online, one command.
 *
 * The only command that touches the network, and only because the user typed
 * it. Everything else in Arbiter is local.
 *
 *   1. destination → git (if not already)
 *   2. export the board page, commit it with the candidate files
 *   3. enable GitHub Pages for docs/ via `gh` (if installed and signed in)
 *   4. git push
 *   5. print the link
 */

import { execFileSync } from 'node:child_process';
import { readCandidates, writeCandidate } from '../candidates';
import { deliver, pagesUrl } from '../destination';
import { findRoot, readConfig, resolvePaths, writeConfig } from '../store';
import { publishHosted } from '../hosted';

/** Where `arbiter publish` goes when nothing says otherwise. */
export const DEFAULT_HOST = 'https://arbiter.design';

export interface PublishOptions {
  noPush?: boolean;
  /** A hosted board. `--to pages` picks GitHub Pages instead. */
  to?: string;
  admin?: string;
  cwd?: string;
}

export interface PublishResult {
  ok: boolean;
  steps: { step: string; outcome: 'done' | 'skipped' | 'failed'; note?: string }[];
  url: string | null;
}

export async function publish(opts: PublishOptions = {}): Promise<PublishResult> {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const steps: PublishResult['steps'] = [];
  const done = (step: string, note?: string) => steps.push({ step, outcome: 'done', note });
  const skip = (step: string, note: string) => steps.push({ step, outcome: 'skipped', note });
  const fail = (step: string, note: string) => steps.push({ step, outcome: 'failed', note });

  // Hosted by default: the flag, then arbiter.json, then arbiter.design. `--to pages` is the git route.
  const chosen = opts.to ?? readConfig(paths)?.hosted?.url ?? DEFAULT_HOST;
  const to = chosen === 'pages' || chosen === 'git' ? null : chosen;
  if (to) {
    try {
      const r = await publishHosted(paths, to, { admin: opts.admin });
      if (r.created) done('project', `created on ${to} — link in .arbiter/hosted.json (commit it); token in .arbiter/hosted.token (git-ignored — teammates set ARBITER_PUBLISH_TOKEN)`);
      done('board', `${r.candidates} screen${r.candidates === 1 ? '' : 's'} published${r.snapshots ? `, ${r.snapshots} image${r.snapshots === 1 ? '' : 's'}` : ''}`);
      for (const s of r.skipped) skip('snapshot', s);
      return { ok: true, steps, url: r.link.shareUrl };
    } catch (e) {
      fail('hosted', (e as Error).message);
      return { ok: false, steps, url: null };
    }
  }

  if (!git(root, ['rev-parse', '--is-inside-work-tree'])) {
    fail('git', 'not a git repository — run `git init` and add a GitHub remote first');
    return { ok: false, steps, url: null };
  }
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const gh = remote && /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  if (!gh) {
    fail('remote', 'no GitHub remote named origin — `git remote add origin git@github.com:you/repo.git`');
    return { ok: false, steps, url: null };
  }
  const [, owner, repo] = gh;

  // 1. destination → git
  let config = readConfig(paths) ?? { version: 1 as const, destination: 'local' as const };
  if (config.destination !== 'git') {
    config = { ...config, destination: 'git' };
    writeConfig(paths, config);
    done('destination', 'arbiter.json → "git"');
  } else skip('destination', 'already git');

  // 2. export + commit (deliver does both; rewriting candidates refreshes their decision lists)
  const candidates = readCandidates(paths);
  for (const c of candidates) writeCandidate(paths, c);
  const delivered = deliver(paths, config, candidates, 'publish board');
  if (delivered.committed) done('commit', `${delivered.committed} — board page, ${candidates.length} candidate${candidates.length === 1 ? '' : 's'}`);
  else skip('commit', 'nothing changed since last publish');

  // 3. GitHub Pages via gh
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  if (!has('gh')) {
    skip('pages', `gh not installed — once, on github.com: ${owner}/${repo} → Settings → Pages → Deploy from a branch → ${branch} / docs → Save`);
  } else if (!ghOk(root)) {
    skip('pages', `gh not signed in (run \`gh auth login\`) — or once, on github.com: ${owner}/${repo} → Settings → Pages → Deploy from a branch → ${branch} / docs → Save`);
  } else {
    const existing = ghApi(root, ['repos/' + owner + '/' + repo + '/pages']);
    if (existing && existing.includes('"path":"/docs"') && existing.includes(`"branch":"${branch}"`)) {
      skip('pages', 'already on (docs/)');
    } else {
      const method = existing ? 'PUT' : 'POST';
      const r = ghApi(root, ['-X', method, 'repos/' + owner + '/' + repo + '/pages', '-f', `source[branch]=${branch}`, '-f', 'source[path]=/docs'], true);
      if (r !== null) done('pages', `GitHub Pages → ${branch} / docs`);
      else fail('pages', `could not enable — once, on github.com: ${owner}/${repo} → Settings → Pages → Deploy from a branch → ${branch} / docs → Save`);
    }
  }

  // 4. push
  if (opts.noPush) skip('push', '--no-push');
  else if (git(root, ['push', '-u', 'origin', branch]) !== null) done('push', `origin/${branch}`);
  else fail('push', 'git push failed — check access to the remote, then `git push`');

  const url = pagesUrl(root, config);
  const ok = steps.every((s) => s.outcome !== 'failed');
  return { ok, steps, url };
}

function git(root: string, args: string[]): string | null {
  try {
    return execFileSync('git', args, { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  } catch {
    return null;
  }
}
function has(cmd: string): boolean {
  try {
    execFileSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
function ghOk(root: string): boolean {
  try {
    execFileSync('gh', ['auth', 'status'], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}
function ghApi(root: string, args: string[], write = false): string | null {
  try {
    return execFileSync('gh', ['api', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString();
  } catch {
    return write ? null : null;
  }
}
