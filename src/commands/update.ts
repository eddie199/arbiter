/**
 * `arbiter update` — bring a project up to the newest Arbiter, and `updateStatus`, the offline
 * check behind the agent's one-line notice.
 *
 * Two things go stale independently: the package pinned in the host's devDependencies, and the
 * skill file init copied into the project — the agent's whole protocol. The second is the one
 * that matters, and it's detectable with no network: init stamps the skill with the version
 * that wrote it. Nothing here checks the registry; "is there a newer version" is the package
 * manager's job when `update` runs.
 *
 *   1. install arbiterdesign@latest as a dev dependency (skipped without a package.json)
 *   2. re-run init from the *installed* copy — the running process is the old version
 *   3. re-pin the publish workflow, if there is one
 *
 * Never touches arbiter.json's settings, DECISIONS.md, or the archive: init leaves those alone.
 */

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { addDevDependency, detectPm, init, selfVersion, skillPath, SKILL_MARKER, type Client } from './init';
import { WORKFLOW_FILE } from './publish';
import { findRoot, readConfig, resolvePaths, type Paths } from '../store';

export interface UpdateStatus {
  /** The version running now. */
  cli: string;
  /** The version that wrote the project's skill file; null = a pre-0.2 file with no marker. */
  skill: string | null;
  /** The skill file, relative to the root, or null if init never wrote one. */
  file: string | null;
  /** The skill file is from a different version than the CLI. False when there's no skill file at all. */
  stale: boolean;
}

/** Offline. Null when this isn't an Arbiter project. */
export function updateStatus(paths: Paths): UpdateStatus | null {
  const config = readConfig(paths);
  if (!config) return null;
  const cli = selfVersion();
  const clients: Client[] = config.client === 'cursor' ? ['cursor'] : config.client === 'claude-code' ? ['claude-code'] : ['claude-code', 'cursor'];
  const file = clients.map(skillPath).find((f) => fs.existsSync(path.join(paths.root, f))) ?? null;
  if (!file) return { cli, skill: null, file: null, stale: false };
  const skill = SKILL_MARKER.exec(fs.readFileSync(path.join(paths.root, file), 'utf8'))?.[1] ?? null;
  return { cli, skill, file: file.split(path.sep).join('/'), stale: skill !== cli };
}

/** What `record --pending` and `rules --pending --json` carry when the skill file is behind. */
export function updateNotice(paths: Paths): { update?: { skill: string; cli: string; command: string } } {
  const s = updateStatus(paths);
  return s?.stale ? { update: { skill: s.skill ?? 'before 0.2', cli: s.cli, command: 'npx arbiter update' } } : {};
}

export interface UpdateOptions {
  cwd?: string;
  /** Report only; change nothing. */
  check?: boolean;
  /** Refresh the skill from the running copy without touching package.json. */
  skipInstall?: boolean;
}

export interface UpdateResult {
  ok: boolean;
  before: UpdateStatus;
  after: UpdateStatus;
  steps: { step: string; outcome: 'done' | 'skipped' | 'failed'; note?: string }[];
}

export async function update(opts: UpdateOptions = {}): Promise<UpdateResult> {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const before = updateStatus(paths);
  if (!before) throw new Error('no arbiter.json here — run `npx arbiter init` first');
  const steps: UpdateResult['steps'] = [];
  if (opts.check) return { ok: true, before, after: before, steps };
  const done = (step: string, note?: string) => steps.push({ step, outcome: 'done', note });
  const skip = (step: string, note: string) => steps.push({ step, outcome: 'skipped', note });
  const fail = (step: string, note: string) => steps.push({ step, outcome: 'failed', note });

  // 1. the package
  let installed: { version: string; bin: string } | null = null;
  if (opts.skipInstall) skip('package', '--skip-install');
  else if (!fs.existsSync(path.join(root, 'package.json'))) skip('package', 'no package.json here — the skill is refreshed from this copy');
  else {
    const pm = detectPm(root);
    if (addDevDependency(root, pm, 'arbiterdesign@latest')) {
      installed = installedCopy(root);
      done('package', installed ? `arbiterdesign ${installed.version} (${pm})` : `installed (${pm})`);
    } else fail('package', `${pm} could not install arbiterdesign@latest — check the network, then re-run`);
  }

  // 2. the skill — from the copy that was just installed, so a new template lands, not this one's
  try {
    if (installed && installed.version !== selfVersion()) {
      execFileSync(process.execPath, [installed.bin, 'init', '--yes', '--skip-install'], { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
      done('skill', `refreshed by arbiter ${installed.version}`);
    } else {
      await init({ cwd: root, yes: true, skipInstall: true });
      done('skill', `refreshed by this copy (${selfVersion()})`);
    }
  } catch (e) {
    fail('skill', `init failed: ${(e as Error).message.split('\n')[0]}`);
  }

  // 3. the publish workflow, if publish --on-push wrote one: it pins a version
  const wf = path.join(root, WORKFLOW_FILE);
  if (fs.existsSync(wf)) {
    const to = installed?.version ?? selfVersion();
    const text = fs.readFileSync(wf, 'utf8');
    const next = text.replace(/arbiterdesign@[^\s'"]+/g, `arbiterdesign@${to}`);
    if (next !== text) {
      fs.writeFileSync(wf, next);
      done('workflow', `${WORKFLOW_FILE} → arbiterdesign@${to} (commit it)`);
    } else skip('workflow', `already arbiterdesign@${to}`);
  }

  const after = updateStatus(paths) ?? before;
  return { ok: steps.every((s) => s.outcome !== 'failed'), before, after, steps };
}

/** The package as installed in the host's node_modules, if it's there. */
function installedCopy(root: string): { version: string; bin: string } | null {
  const dir = path.join(root, 'node_modules', 'arbiterdesign');
  const pkg = path.join(dir, 'package.json');
  const bin = path.join(dir, 'dist', 'index.js');
  if (!fs.existsSync(pkg) || !fs.existsSync(bin)) return null;
  return { version: (JSON.parse(fs.readFileSync(pkg, 'utf8')) as { version: string }).version, bin };
}
