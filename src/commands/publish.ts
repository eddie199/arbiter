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

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readCandidates, writeCandidate } from '../candidates';
import { deliver, pagesUrl } from '../destination';
import { findRoot, readConfig, resolvePaths, writeConfig } from '../store';
import { publishHosted, readToken, TOKEN_ENV } from '../hosted';
import { selfVersion } from './init';

/** Where `arbiter publish` goes when nothing says otherwise. */
export const DEFAULT_HOST = 'https://arbiter.design';
/** The GitHub Actions workflow `--on-push` writes. `update` re-pins the version in it. */
export const WORKFLOW_FILE = path.join('.github', 'workflows', 'arbiter.yml');

export interface PublishOptions {
  noPush?: boolean;
  /** A hosted board. `--to pages` picks GitHub Pages instead. */
  to?: string;
  admin?: string;
  /** Also write a GitHub Actions workflow that republishes on every push, and set its secret. */
  onPush?: boolean;
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
      if (opts.onPush) for (const s of onPush(root, paths)) steps.push(s);
      return { ok: steps.every((s) => s.outcome !== 'failed'), steps, url: r.link.shareUrl };
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

/**
 * Keep the board current without anyone remembering to publish: a workflow that runs `publish`
 * when decisions land on the default branch. The publish token becomes a repository secret —
 * set through `gh` when it's signed in, otherwise a one-line instruction. The workflow itself
 * is committed by the user; Arbiter only commits under `destination: git`.
 */
function onPush(root: string, paths: ReturnType<typeof resolvePaths>): PublishResult['steps'] {
  const steps: PublishResult['steps'] = [];
  const branch = git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'main';
  const file = path.join(root, WORKFLOW_FILE);
  const content = workflow(branch, selfVersion());
  if (!fs.existsSync(file)) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, content);
    steps.push({ step: 'workflow', outcome: 'done', note: `${WORKFLOW_FILE} — commit it with .arbiter/hosted.json` });
  } else if (fs.readFileSync(file, 'utf8') === content) {
    steps.push({ step: 'workflow', outcome: 'skipped', note: `${WORKFLOW_FILE} already there` });
  } else {
    steps.push({ step: 'workflow', outcome: 'skipped', note: `${WORKFLOW_FILE} exists and differs — leaving your edits` });
  }

  const token = readToken(paths);
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const gh = remote && /github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/.exec(remote);
  const manual = `once, on github.com: Settings → Secrets and variables → Actions → New repository secret → ${TOKEN_ENV} = the contents of .arbiter/hosted.token`;
  if (!token) steps.push({ step: 'secret', outcome: 'skipped', note: `no publish token here — ${manual}` });
  else if (!gh) steps.push({ step: 'secret', outcome: 'skipped', note: `no GitHub remote named origin — ${manual}` });
  else if (!has('gh') || !ghOk(root)) steps.push({ step: 'secret', outcome: 'skipped', note: `gh not ${has('gh') ? 'signed in' : 'installed'} — ${manual}` });
  else {
    try {
      // The token goes in on stdin, not argv, so it never shows in a process list.
      execFileSync('gh', ['secret', 'set', TOKEN_ENV, '--repo', `${gh[1]}/${gh[2]}`], { cwd: root, input: token, stdio: ['pipe', 'ignore', 'ignore'] });
      steps.push({ step: 'secret', outcome: 'done', note: `${TOKEN_ENV} set on ${gh[1]}/${gh[2]}` });
    } catch {
      steps.push({ step: 'secret', outcome: 'failed', note: `gh could not set the secret — ${manual}` });
    }
  }
  return steps;
}

function workflow(branch: string, version: string): string {
  return [
    '# Written by `npx arbiter publish --on-push`. Republishes the board when decisions land.',
    '# Needs one repository secret, ARBITER_PUBLISH_TOKEN: the contents of .arbiter/hosted.token.',
    '# `npx arbiter update` re-pins the version below.',
    'name: Arbiter',
    'on:',
    '  push:',
    `    branches: [${branch}]`,
    '    paths:',
    "      - '.arbiter/**'",
    "      - 'DECISIONS.md'",
    "      - 'CANDIDATES.md'",
    'concurrency:',
    '  group: arbiter-publish',
    '  cancel-in-progress: true',
    'jobs:',
    '  publish:',
    '    runs-on: ubuntu-latest',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - uses: actions/setup-node@v4',
    '        with:',
    '          node-version: 20',
    `      - run: npx --yes arbiterdesign@${version} publish`,
    '        env:',
    '          ARBITER_PUBLISH_TOKEN: ${{ secrets.ARBITER_PUBLISH_TOKEN }}',
    '',
  ].join('\n');
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
