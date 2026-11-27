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
import { chooseRulesFile, Config, gitUserName, now, readConfig, resolvePaths, rulesMovedLine, writeActive, writeConfig, ACTIVE_CAP, RULES_FILE } from '../store';
import { archiveHeader } from '../format';
import { Prompter } from './prompt';
import { CHECKINS, type Checkin } from './setup';
import { installHook } from '../hook';
import { FILE as HANDOFF_FILE, SEEN } from '../handoff';
import { LOCK } from '../lock';

export type Client = 'claude-code' | 'cursor';

export interface InitOptions {
  cwd?: string;
  client?: Client;
  author?: string;
  destination?: 'local' | 'git';
  /** The check-in answer, when it's already known: an agent asked in chat, or a script. */
  checkin?: string;
  yes?: boolean;
  skipInstall?: boolean;
  /** Someone at the terminal to answer. Default: stdin is a terminal. An agent's isn't, so nothing is asked. */
  interactive?: boolean;
}

type Outcome = 'created' | 'updated' | 'unchanged' | 'skipped';
/** `attention`: something the person has to do, shown under "Needs you". */
export interface Step { file: string; outcome: Outcome; note?: string; attention?: boolean }

const AGENTS_MARKER = '<!-- arbiter -->';
/**
 * The one line in AGENTS.md and CLAUDE.md. It's always loaded, so it carries the one thing that has
 * to hold even when the skill isn't: which wins when a decision and the design system disagree.
 * Without it the decision won 17 times in 20; with it the design system won 20 in 20, and an
 * exception won 20 in 20 (clash study, Opus 5.5, October 2026).
 */
export const agentsLine = (rules: string = RULES_FILE) =>
  `Before any UI work, read \`${rules}\` — the design decisions this project has already made. Follow them; don't re-decide them. Record new ones with the \`arbiter\` skill. ` +
  `If the request, or the design system (DESIGN.md, design-system or pattern docs, component guidelines, or the shared components), goes against a decision, don't build yet: ask first, the way the \`arbiter\` skill shows. A decision written as an exception ("Exception to the design system: …") beats the design system without asking: follow it and say so. ${AGENTS_MARKER}`;
export const AGENTS_LINE = agentsLine();

export const PKG_ROOT = path.join(__dirname, '..', '..');
const SKILL_TEMPLATE = path.join(PKG_ROOT, 'templates', 'SKILL.md');

/** The version of the package that's running. */
export function selfVersion(): string {
  return (JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as { version: string }).version;
}

/**
 * The skill file is a copy: it goes stale when the package moves on and nobody re-runs init.
 * A comment on its first body line says which version wrote it, so `update` can tell without
 * touching the network. A skill file with no marker predates 0.1.3 — always stale.
 */
export const SKILL_MARKER = /<!-- arbiter skill (\S+) -->/;
export const skillMarker = (version: string) => `<!-- arbiter skill ${version} -->`;

/** Where the skill lives for a client. */
export function skillPath(client: Client): string {
  return client === 'cursor' ? path.join('.cursor', 'rules', 'arbiter.mdc') : path.join('.claude', 'skills', 'arbiter', 'SKILL.md');
}

export async function init(opts: InitOptions = {}): Promise<Step[]> {
  const root = path.resolve(opts.cwd ?? process.cwd());
  const paths = resolvePaths(root);
  const existing = readConfig(paths);
  const steps: Step[] = [];
  // Nobody at the terminal (an agent ran this, or --yes): nothing is asked, or even printed as a
  // question. The closing lines hand the check-in question to the agent instead.
  const ask = opts.yes || !(opts.interactive ?? !!process.stdin.isTTY) ? null : new Prompter();
  // Before anything is asked or written: a project whose names are all taken stops here, untouched.
  const rulesFile = chooseRulesFile(root, existing);

  try {
    if (opts.checkin !== undefined && !(CHECKINS as readonly string[]).includes(opts.checkin)) throw new Error(`--checkin must be one of ${CHECKINS.join(' | ')}`);
    let client: Client | undefined = opts.client ?? (existing?.client as Client | undefined);
    const detected = client ? [] : detectClient(root);
    if (!client && detected.length === 1) client = detected[0];
    const askClient = !client && !!ask;
    const askCheckinNow = !existing?.onboarded && opts.checkin === undefined && !!ask;
    const questions = Number(askClient) + Number(askCheckinNow);
    if (questions) process.stdout.write(`Arbiter is installed. ${questions === 1 ? 'One question' : 'Two questions'} before you start:\n`);

    // ── Which agent (only when the project doesn't say) ──────────────────
    if (!client) client = askClient ? await askClientQuestion(ask!) : 'claude-code';

    // ── Who holds the pen: git's user.name, as the record already prefers; never asked ──
    const author = opts.author ?? existing?.author ?? gitUserName(root) ?? os.userInfo().username;

    // ── How Arbiter checks in while you work ─────────────────────────────
    // Asked once, here, so no /arbiter has to. Nobody at the terminal: it stays unanswered, and the
    // closing lines hand the question to the agent.
    let checkin = existing?.checkin;
    let onboarded = existing?.onboarded;
    if (opts.checkin !== undefined) {
      checkin = opts.checkin as Checkin;
      onboarded ??= now();
    } else if (askCheckinNow) {
      const picked = await askCheckin(ask);
      if (picked) {
        checkin = picked;
        onboarded = now();
      }
    }

    // ── arbiter.json ─────────────────────────────────────────────────────
    const config: Config = {
      version: 1,
      destination: 'local',
      hosted: { url: 'https://arbiter.design' },
      ...existing,
      author,
      client,
      ...(opts.destination && { destination: opts.destination }),
      ...(checkin && { checkin }),
      ...(onboarded && { onboarded }),
      ...(rulesFile !== RULES_FILE && { decisions: rulesFile }),
    };
    if (!existing) {
      writeConfig(paths, config);
      steps.push({ file: 'arbiter.json', outcome: 'created' });
    } else if (JSON.stringify(existing) !== JSON.stringify(config)) {
      writeConfig(paths, config);
      steps.push({ file: 'arbiter.json', outcome: 'updated' });
    } else {
      steps.push({ file: 'arbiter.json', outcome: 'unchanged' });
    }

    // ── The rules file — never overwritten once it exists ────────────────
    // Resolved again: arbiter.json may only now say where the rules go.
    const rules = { ...paths, decisions: path.join(root, rulesFile) };
    if (rulesFile !== RULES_FILE && fs.existsSync(path.join(root, RULES_FILE))) {
      steps.push({ file: RULES_FILE, outcome: 'unchanged', note: 'yours, so Arbiter leaves it alone' });
    }
    if (fs.existsSync(rules.decisions)) {
      steps.push({ file: rulesFile, outcome: 'unchanged' });
    } else {
      writeActive(rules, [], config.activeCap ?? ACTIVE_CAP);
      steps.push({ file: rulesFile, outcome: 'created', ...(rulesFile !== RULES_FILE && { note: 'your design rules go here' }) });
    }

    // ── .arbiter/archive.md ──────────────────────────────────────────────
    fs.mkdirSync(paths.archiveDir, { recursive: true });
    // Never committed: the publish token, what the board hands this machine's agent and what it was told
    // (a teammate's agent mustn't make it), and the lock a write holds for a moment. Lines already there
    // stay, so a re-run never un-ignores anything.
    const ignore = path.join(paths.archiveDir, '.gitignore');
    const had = fs.existsSync(ignore) ? fs.readFileSync(ignore, 'utf8').split(/\r?\n/).filter(Boolean) : [];
    const lines = [...had, ...['hosted.token', HANDOFF_FILE, SEEN, LOCK].filter((x) => !had.includes(x))];
    steps.push(writeIfChanged(root, path.join('.arbiter', '.gitignore'), lines.join('\n') + '\n'));
    if (fs.existsSync(paths.archive)) {
      steps.push({ file: '.arbiter/archive.md', outcome: 'unchanged' });
    } else {
      fs.writeFileSync(paths.archive, archiveHeader(rulesFile));
      steps.push({ file: '.arbiter/archive.md', outcome: 'created' });
    }

    // ── Skill file ───────────────────────────────────────────────────────
    const skill = skillFor(client, rulesFile);
    steps.push(writeIfChanged(root, skill.file, skill.content));

    // ── AGENTS.md — merge one line, never overwrite ──────────────────────
    steps.push(mergeAgentsLine(root, 'AGENTS.md', true, agentsLine(rulesFile)));

    // ── Client-specific entry points ─────────────────────────────────────
    if (client === 'claude-code') {
      // Claude Code's own context file. Same line, same marker; created if missing so injection has a path that's certain to load.
      steps.push(mergeAgentsLine(root, 'CLAUDE.md', true, agentsLine(rulesFile)));
      // The hook that hands the agent what you judged on the board, with your next message.
      steps.push(...installHook(root, rulesFile));
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

/** Only asked when the project has signs of both, or of neither. */
async function askClientQuestion(ask: Prompter): Promise<Client> {
  let q = '\nWhich agent do you use in this project?\n  1. Claude Code\n  2. Cursor\nPick 1 or 2 (Enter for 1): ';
  for (;;) {
    const a = await ask.answer(q);
    const t = (a ?? '').trim().toLowerCase();
    if (a === null || !t || t === '1' || t === 'claude-code' || t === 'claude code') return 'claude-code';
    if (t === '2' || t === 'cursor') return 'cursor';
    q = 'Pick 1 or 2 (Enter for 1): ';
  }
}

/** The one preference Arbiter asks for. The skill asks the same, in the same words, when install couldn't. */
const CHECKIN_QUESTION = 'How should Arbiter check in while you work?';
const CHECKIN_OPTIONS: { mode: Checkin; label: string; detail: string }[] = [
  { mode: 'feature', label: 'A line after big work (recommended)', detail: 'When a feature settles, one sentence on what changed.' },
  { mode: 'quiet', label: 'Nothing until I ask', detail: 'Quiet, unless something clashes with a rule.' },
  { mode: 'every', label: 'A line after everything', detail: 'One sentence every time a piece of work settles.' },
];

/**
 * The check-in question at the terminal. Enter takes the recommended one. Null when input ended
 * with no answer: an agent ran install, and a choice nobody made mustn't be recorded as theirs.
 */
export async function askCheckin(ask: Prompter): Promise<Checkin | null> {
  const menu = CHECKIN_OPTIONS.map((o, i) => `  ${i + 1}. ${o.label}. ${o.detail}`).join('\n');
  let q = `\n${CHECKIN_QUESTION}\n${menu}\nPick 1, 2 or 3 (Enter for 1): `;
  for (;;) {
    const a = await ask.answer(q);
    if (a === null) return null;
    const t = a.trim().toLowerCase();
    if (!t) return 'feature';
    const n = Number(t);
    if (Number.isInteger(n) && n >= 1 && n <= CHECKIN_OPTIONS.length) return CHECKIN_OPTIONS[n - 1].mode;
    if ((CHECKINS as readonly string[]).includes(t)) return t as Checkin;
    q = 'Pick 1, 2 or 3 (Enter for 1): ';
  }
}

const YOURE_SET = "You're set. Start a new agent session and build as usual.\nWhen you're ready to review what you've built, type /arbiter.";

/** Long lines broken at spaces, for a terminal. */
function wrap(text: string, width = 84): string {
  const out: string[] = [];
  let line = '';
  for (const word of text.split(' ')) {
    if (line && line.length + 1 + word.length > width) {
      out.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  return [...out, line].join('\n');
}

const and = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/**
 * What install prints after its question: what it did in a sentence or two, anything that needs the
 * person, and what to do next. The file-by-file list only with --verbose. A re-run says what changed.
 */
export function installReport(root: string, steps: Step[], opts: { verbose?: boolean; closing?: boolean } = {}): string {
  const config = readConfig(resolvePaths(root));
  const rules = config?.decisions ?? RULES_FILE;
  const fresh = steps.some((s) => s.file === 'arbiter.json' && s.outcome === 'created');
  const theirs = steps.some((s) => s.file === RULES_FILE && s.note?.startsWith('yours'));
  const changed = (f: string) => steps.some((s) => s.file === f && (s.outcome === 'created' || s.outcome === 'updated'));
  const out: string[] = [];

  if (opts.verbose) {
    const w = Math.max(...steps.map((s) => s.file.length));
    out.push(steps.map((s) => `  ${s.file.padEnd(w)}  ${s.outcome}${s.note ? `  — ${s.note}` : ''}`).join('\n'), '');
  }
  if (theirs && changed(rules)) out.push(wrap(rulesMovedLine(rules)), '');

  if (fresh) {
    const told = ['CLAUDE.md', 'AGENTS.md'].filter(changed);
    const where = config?.client === 'cursor'
      ? "Arbiter's rule and /arbiter command are in .cursor/."
      : "Arbiter's skill and hook are in .claude/.";
    out.push(wrap(`Added ${rules} for your design rules and .arbiter/ for the record. ${told.length ? `Your agent's instructions (${and(told)}) got one line telling it to read your rules before UI work, and ${where}` : where}`), '');
  } else {
    const updated = steps.filter((s) => (s.outcome === 'created' || s.outcome === 'updated') && !s.attention).map((s) => s.file);
    out.push(updated.length ? wrap(`Updated: ${and(updated)}.`) : 'Already set up. Nothing changed.', '');
  }

  const needs = steps.filter((s) => s.attention);
  if (needs.length) {
    const w = Math.max(...needs.map((s) => s.file.length));
    out.push('Needs you:', ...needs.map((s) => `  ${s.file.padEnd(w)}  ${s.note ?? s.outcome}`), '');
  }
  // An agent's hand-off ends with the same words for it to say; printing them here as well would say it twice.
  if (opts.closing === false) { /* the hand-off has it */ }
  else if (fresh) out.push(YOURE_SET);
  else if (steps.some((s) => !s.attention && (s.outcome === 'created' || s.outcome === 'updated'))) out.push('Start a new agent session so your agent picks this up.');
  return out.join('\n').replace(/\n+$/, '') + '\n';
}

/**
 * Install's closing lines when an agent ran it: nobody at the terminal saw anything, so the agent says
 * it in chat, in the same words a person at the terminal gets. The check-in question, when it's still
 * unanswered, goes on its own: bundled with review questions it got dismissed with them and came back
 * on every /arbiter. `rulesNote`: the project had its own DECISIONS.md.
 */
export function checkinHandoff(rulesNote?: string, askQuestion = true): string {
  const w = Math.max(...CHECKINS.map((c) => c.length));
  const say = ['Arbiter is installed.', ...(rulesNote ? [rulesNote] : []), ...(askQuestion ? [`One question before you start: ${CHECKIN_QUESTION[0].toLowerCase()}${CHECKIN_QUESTION.slice(1)}`] : [])].join(' ');
  return [
    '',
    'Agent: nobody saw this at a terminal. Tell the user now, in chat, in these words:',
    `  "${say}"`,
    ...(askQuestion
      ? [
          'Then ask it as one pick-one question on its own:',
          ...CHECKIN_OPTIONS.map((o) => `  ${o.mode.padEnd(w)}  ${o.label}. ${o.detail}`),
          'Save their answer: npx arbiter setup --checkin feature (or quiet, or every). No answer means feature.',
        ]
      : []),
    `Then: "You're set. Start a new session and build as usual. When you're ready to review what you've built, type /arbiter."`,
    '',
  ].join('\n');
}

/**
 * A template that names the rules file, naming this project's. The templates say DECISIONS.md,
 * and every mention of it is the rules file.
 */
export const withRulesFile = (text: string, rules: string) => (rules === RULES_FILE ? text : text.split(RULES_FILE).join(rules));

function skillFor(client: Client, rules: string): { file: string; content: string } {
  // A Windows checkout with autocrlf hands us CRLF; the frontmatter regex and the marker line assume LF.
  let template = withRulesFile(fs.readFileSync(SKILL_TEMPLATE, 'utf8').replace(/\r\n/g, '\n'), rules);
  // The first /arbiter's intro says where the rules go; when that isn't their DECISIONS.md, it says theirs is safe.
  if (rules !== RULES_FILE) template = template.split(`Rules go into \`${rules}\`, and I read them`).join(`Rules go into \`${rules}\` (your own ${RULES_FILE} stays as it is), and I read them`);
  const m = /^---\n([\s\S]*?)\n---\n/.exec(template);
  // The version marker is the first body line, under the frontmatter, so both clients carry it.
  const body = skillMarker(selfVersion()) + '\n' + template.slice(m?.[0].length ?? 0);
  if (client === 'claude-code') {
    return { file: skillPath(client), content: (m?.[0] ?? '') + body };
  }
  // Cursor: same body, Cursor's rule frontmatter. "Agent requested" — picked by description.
  const desc = /^description:\s*(.*)$/m.exec(m?.[1] ?? '')?.[1] ?? 'Record design decisions made during UI work.';
  const front = `---\ndescription: ${desc}\nglobs:\nalwaysApply: false\n---\n`;
  return { file: skillPath(client), content: front + body };
}

function writeIfChanged(root: string, rel: string, content: string): Step {
  const abs = path.join(root, rel);
  // The label is written with `/` on every platform, like the literals above it and
  // updateStatus's file. Only the name shown changes; abs is the platform's own path.
  const name = rel.split(path.sep).join('/');
  const before = fs.existsSync(abs) ? fs.readFileSync(abs, 'utf8') : null;
  if (before === content) return { file: name, outcome: 'unchanged' };
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return { file: name, outcome: before === null ? 'created' : 'updated' };
}

function mergeAgentsLine(root: string, file: string, createIfMissing: boolean, line: string = AGENTS_LINE): Step {
  const abs = path.join(root, file);
  if (!fs.existsSync(abs)) {
    if (!createIfMissing) return { file, outcome: 'skipped', note: 'not present' };
    fs.writeFileSync(abs, `# Agent instructions\n\n${line}\n`);
    return { file, outcome: 'created' };
  }
  const before = fs.readFileSync(abs, 'utf8');
  if (before.includes(AGENTS_MARKER)) {
    // The marked line is Arbiter's: an older Arbiter wrote different words, so swap in these.
    // Only that line — whatever else the file says, and where the line sits in it, stays.
    const after = before.replace(/^.*<!-- arbiter -->.*$/m, () => line);
    if (after === before) return { file, outcome: 'unchanged' };
    fs.writeFileSync(abs, after);
    return { file, outcome: 'updated', note: 'Arbiter line refreshed' };
  }
  const sep = before.endsWith('\n') ? (before.endsWith('\n\n') ? '' : '\n') : '\n\n';
  fs.writeFileSync(abs, before + sep + line + '\n');
  return { file, outcome: 'updated', note: 'one line appended' };
}

/**
 * Everything that tells the agent where the rules are, pointed at `rules`: the line in AGENTS.md and
 * CLAUDE.md, the skill and the board hook. Only what install already wrote is touched. For when the
 * rules move to a file of their own after install (store.ts claimRulesFile).
 */
export function pointAgentsAt(root: string, client: string | undefined, rules: string): Step[] {
  const steps: Step[] = [];
  for (const f of ['AGENTS.md', 'CLAUDE.md']) {
    const abs = path.join(root, f);
    if (fs.existsSync(abs) && fs.readFileSync(abs, 'utf8').includes(AGENTS_MARKER)) steps.push(mergeAgentsLine(root, f, false, agentsLine(rules)));
  }
  for (const c of ['claude-code', 'cursor'] as const) {
    if (fs.existsSync(path.join(root, skillPath(c)))) {
      const skill = skillFor(c, rules);
      steps.push(writeIfChanged(root, skill.file, skill.content));
    }
  }
  if (client !== 'cursor' && fs.existsSync(path.join(root, '.claude', 'hooks', 'arbiter-board.cjs'))) steps.push(...installHook(root, rules));
  return steps;
}

const CURSOR_COMMAND = `# Arbiter — review queued design decisions

Run \`npx arbiter rules --pending --json\` and present every queued decision, grouped by dimension, one line each with what it was chosen over. Ask the user to reply per number: confirm · rule · skip · or type what it should be. Then judge each with \`npx arbiter record P-xxxx --as accept|rule|skip|fix --to "…"\`. If the user wrote something after the command, treat it as "record that" and run \`npx arbiter record\` with it as a rule. Follow the arbiter rule file for the full protocol.
`;

export type Pm = 'npm' | 'pnpm' | 'yarn';

/** Which package manager the host uses, by lockfile. */
export function detectPm(root: string): Pm {
  return fs.existsSync(path.join(root, 'pnpm-lock.yaml')) ? 'pnpm' : fs.existsSync(path.join(root, 'yarn.lock')) ? 'yarn' : 'npm';
}

/**
 * Add a dev dependency. Quiet; true on success.
 *
 * On Windows the package managers are .cmd shims, which execFile can't run on its own — it
 * raises ENOENT. `shell: true` fixes that but makes Node warn about unescaped arguments
 * (DEP0190) on every install, which is the first thing a new user would see. Going through
 * cmd.exe resolves the shim with the arguments still a real array, so neither happens.
 */
export function addDevDependency(root: string, pm: Pm, spec: string): boolean {
  const args = pm === 'npm' ? ['install', '--save-dev', '--no-audit', '--no-fund', spec] : ['add', '-D', spec];
  const win = process.platform === 'win32';
  try {
    execFileSync(win ? 'cmd.exe' : pm, win ? ['/c', pm, ...args] : args, { cwd: root, stdio: ['ignore', 'ignore', 'ignore'] });
    return true;
  } catch {
    return false;
  }
}

/** Add this package to the host's devDependencies so `npx arbiter` resolves locally. */
function installSelf(root: string): Step {
  const self = JSON.parse(fs.readFileSync(path.join(PKG_ROOT, 'package.json'), 'utf8')) as { name: string; version: string };
  const hostPkgPath = path.join(root, 'package.json');
  if (!fs.existsSync(hostPkgPath)) {
    return { file: 'package.json', outcome: 'skipped', attention: true, note: `no package.json here. Add ${self.name} as a dev dependency yourself, or type npx ${self.name} where you'd type npx arbiter.` };
  }
  const host = JSON.parse(fs.readFileSync(hostPkgPath, 'utf8')) as { name?: string; dependencies?: Record<string, string>; devDependencies?: Record<string, string> };
  // Arbiter's own repo, dogfooding: `npx arbiter` already resolves to the package itself.
  if (host.name === self.name) {
    return { file: 'package.json', outcome: 'unchanged', note: `this is ${self.name} itself — not adding it as its own dependency` };
  }
  if (host.devDependencies?.[self.name] || host.dependencies?.[self.name]) {
    return { file: 'package.json', outcome: 'unchanged', note: `${self.name} already a dependency` };
  }

  const pm = detectPm(root);
  const add = (spec: string): boolean => addDevDependency(root, pm, spec);

  // Registry first; fall back to the copy we're running from (unpublished / local dev).
  if (add(`${self.name}@^${self.version}`)) {
    return { file: 'package.json', outcome: 'updated', note: `${self.name} added to devDependencies (${pm})` };
  }
  if (add(PKG_ROOT)) {
    return { file: 'package.json', outcome: 'updated', note: `${self.name} added from ${PKG_ROOT} (registry unavailable)` };
  }
  return { file: 'package.json', outcome: 'skipped', attention: true, note: `couldn't install it. Run: ${pm} ${pm === 'npm' ? 'install --save-dev' : 'add -D'} ${self.name}` };
}
