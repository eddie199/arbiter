/**
 * `arbiter init` — install into the host project.
 *
 * Writes only files Arbiter owns, plus one merged line in AGENTS.md. Every
 * write is idempotent: a second run reports "unchanged" for everything.
 * Never touches host source files. Never starts anything.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Config, gitUserName, readConfig, resolvePaths, writeActive, writeConfig, ACTIVE_CAP } from '../store';
import { archiveHeader } from '../format';
import { Prompter } from './prompt';

export type Client = 'claude-code' | 'cursor';

export interface InitOptions {
  cwd?: string;
  client?: Client;
  author?: string;
  destination?: 'local' | 'git';
  yes?: boolean;
  skipInstall?: boolean;
}

type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped';
interface Step { file: string; outcome: Outcome; note?: string }

const AGENTS_MARKER = '<!-- arbiter -->';
const AGENTS_LINE =
  `Before any UI work, read \`DECISIONS.md\` — the design decisions this project has already made. Follow them; don't re-decide them. Record new ones with the \`arbiter\` skill. ${AGENTS_MARKER}`;

const PKG_ROOT = path.join(__dirname, '..', '..');
const SKILL_TEMPLATE = path.join(PKG_ROOT, 'templates', 'SKILL.md');

export async function init(opts: InitOptions = {}): Promise<Step[]> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const paths = resolvePaths(root);
  const existing = readConfig(paths);
  const steps: Step[] = [];
  const ask = opts.yes ? null : new Prompter();

  try {
    // ── Question 1 (only if ambiguous): which client? ────────────────────
    let client: Client | undefined = opts.client ?? (existing?.client as Client | undefined);
    if (!client) {
      const detected = detectClient(root);
      if (detected.length === 1) {
        client = detected[0];
        console.log(`Detected ${label(client)}.`);
      } else if (ask) {
        const hint = detected.length ? 'both found' : 'neither found';
        const a = (await ask.question(`Which agent client? (${hint}) [claude-code/cursor] (claude-code): `)).trim();
        client = a === 'cursor' ? 'cursor' : 'claude-code';
      } else {
        client = 'claude-code';
      }
    }

    // ── Question 2: who holds the pen? ───────────────────────────────────
    let author = opts.author ?? existing?.author;
    if (!author) {
      const guess = gitUserName(root) ?? os.userInfo().username;
      if (ask) {
        const a = (await ask.question(`Who decides rules? (author on every record) (${guess}): `)).trim();
        author = a || guess;
      } else {
        author = guess;
      }
    }

    // ── arbiter.json ─────────────────────────────────────────────────────
    const config: Config = { version: 1, destination: 'local', hosted: { url: 'https://arbiter.design' }, ...existing, author, client, ...(opts.destination && { destination: opts.destination }) };
    if (!existing) {
      writeConfig(paths, config);
      steps.push({ file: 'arbiter.json', outcome: 'created' });
    } else if (JSON.stringify(existing) !== JSON.stringify(config)) {
      writeConfig(paths, config);
      steps.push({ file: 'arbiter.json', outcome: 'updated' });
    } else {
      steps.push({ file: 'arbiter.json', outcome: 'unchanged' });
    }

    // ── DECISIONS.md — never overwritten once it exists ──────────────────
    if (fs.existsSync(paths.decisions)) {
      steps.push({ file: 'DECISIONS.md', outcome: 'unchanged' });
    } else {
      writeActive(paths, [], config.activeCap ?? ACTIVE_CAP);
      steps.push({ file: 'DECISIONS.md', outcome: 'created' });
    }

    // ── .arbiter/archive.md ──────────────────────────────────────────────
    fs.mkdirSync(paths.archiveDir, { recursive: true });
    steps.push(writeIfChanged(root, path.join('.arbiter', '.gitignore'), 'hosted.token\n'));
    if (fs.existsSync(paths.archive)) {
      steps.push({ file: '.arbiter/archive.md', outcome: 'unchanged' });
    } else {
      fs.writeFileSync(paths.archive, archiveHeader());
      steps.push({ file: '.arbiter/archive.md', outcome: 'created' });
    }

    // ── Skill file ───────────────────────────────────────────────────────
    const skill = skillFor(client);
    steps.push(writeIfChanged(root, skill.file, skill.content));

    // ── AGENTS.md — merge one line, never overwrite ──────────────────────
    steps.push(mergeAgentsLine(root, 'AGENTS.md', true));

    // ── Client-specific entry points ─────────────────────────────────────
    if (client === 'claude-code') {
      // Claude Code's own context file. Same line, same marker; created if missing so injection has a path that's certain to load.
      steps.push(mergeAgentsLine(root, 'CLAUDE.md', true));
    } else {
      // Cursor has no skill-invoked slash commands; give it a command file that does what `/arbiter` does.
      steps.push(writeIfChanged(root, path.join('.cursor', 'commands', 'arbiter.md'), CURSOR_COMMAND));
    }

    // ── Local dev dependency ─────────────────────────────────────────────
    steps.push(opts.skipInstall ? { file: 'package.json', outcome: 'skipped', note: '--skip-install' } : installSelf(root));
  } finally {
    ask?.close();
  }
  return steps;
}

export function detectClient(root: string): Client[] {
  const out: Client[] = [];
  if (fs.existsSync(path.join(root, '.claude')) || fs.existsSync(path.join(root, 'CLAUDE.md'))) out.push('claude-code');
  if (fs.existsSync(path.join(root, '.cursor')) || fs.existsSync(path.join(root, '.cursorrules'))) out.push('cursor');
  return out;
}

const label = (c: Client) => (c === 'cursor' ? 'Cursor' : 'Claude Code');

function skillFor(client: Client): { file: string; content: string } {
  const template = fs.readFileSync(SKILL_TEMPLATE, 'utf8');
  if (client === 'claude-code') {
    return { file: path.join('.claude', 'skills', 'arbiter', 'SKILL.md'), content: template };
  }
  // Cursor: same body, Cursor's rule frontmatter. "Agent requested" — picked by description.
  const m = /^---\n([\s\S]*?)\n---\n/.exec(template);
  const desc = /^description:\s*(.*)$/m.exec(m?.[1] ?? '')?.[1] ?? 'Record design decisions made during UI work.';
  const body = template.slice(m?.[0].length ?? 0);
  const front = `---\ndescription: ${desc}\nglobs:\nalwaysApply: false\n---\n`;
  return { file: path.join('.cursor', 'rules', 'arbiter.mdc'), content: front + body };
}

function writeIfChanged(root: string, rel: string, content: string): Step {
  const abs = path.join(root, rel);
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (before === content) return { file: rel, outcome: 'unchanged' };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return { file: rel, outcome: before === null ? 'created' : 'updated' };
}

function mergeAgentsLine(root: string, file: string, createIfMissing: boolean): Step {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    if (!createIfMissing) return { file, outcome: 'skipped', note: 'not present' };
    fs.writeFileSync(abs, `# Agent instructions\n\n${AGENTS_LINE}\n`);
    return { file, outcome: 'created' };
  }
  const before = fs.readFileSync(abs, 'utf8');
  if (before.includes(AGENTS_MARKER)) return { file, outcome: 'unchanged' };
  const sep = before.endsWith('\n') ? (before.endsWith('\n\n') ? '' : '\n') : '\n\n';
  fs.writeFileSync(abs, before + sep + AGENTS_LINE + '\n');
  return { file, outcome: 'updated', note: 'one line appended' };
}

const CURSOR_COMMAND = `# Arbiter — review queued design decisions

Run \`npx arbiter rules --pending --json\` and present every queued decision, grouped by dimension, one line each with what it was chosen over. Ask the user to reply per number: confirm · rule · skip · or type what it should be. Then judge each with \`npx arbiter record P-xxxx --as accept|rule|skip|fix --to "…"\`. If the user wrote something after the command, treat it as "record that" and run \`npx arbiter record\` with it as a rule. Follow the arbiter rule file for the full protocol.
`;

/** Add this package to the host's devDependencies so `npx arbiter` resolves locally. */
function installSelf(root: string): Step {
  const self = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
  const hostPkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(hostPkgPath)) {
    return { file: 'package.json', outcome: 'skipped', note: `no package.json here — add ${self.name} as a dev dependency yourself` };
  }
  const host = JSON.parse(fs.readFileSync(hostPkgPath, 'utf8')) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  if (host.devDependencies?.[self.name] || host.dependencies?.[self.name]) {
    return { file: 'package.json', outcome: 'unchanged', note: `${self.name} already a dependency` };
  }

  const pm = fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
  const add = (spec: string): boolean => {
    const args = pm === 'npm' ? ['install', '--save-dev', '--no-audit', '--no-fund', spec] : ['add', '-D', spec];
    try {
      execFileSync(pm, args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
      return true;
    } catch {
      return false;
    }
  };

  // Registry first; fall back to the copy we're running from (unpublished / local dev).
  if (add(`${self.name}@^${self.version}`)) {
    return { file: 'package.json', outcome: 'updated', note: `${self.name} added to devDependencies (${pm})` };
  }
  if (add(PKG_ROOT)) {
    return { file: 'package.json', outcome: 'updated', note: `${self.name} added from ${PKG_ROOT} (registry unavailable)` };
  }
  return { file: 'package.json', outcome: 'skipped', note: `could not install — run: ${pm} ${pm === 'npm' ? 'install --save-dev' : 'add -D'} ${self.name}` };
}
