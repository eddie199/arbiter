/**
 * The Claude Code hook. Before each message you send, it tells the agent what you've judged on
 * the local board since its last turn that needs the code changed, so the agent makes it then,
 * without waiting for /arbiter. A script in .claude/hooks/ (templates/hooks/arbiter-board.cjs),
 * run by a UserPromptSubmit entry in .claude/settings.json. Claude Code only: Cursor and Codex
 * have no such hook, and pick it up at /arbiter.
 *
 * The script is plain node with nothing to install, since it runs before every message: it reads
 * one file and, nearly always, finds nothing to say.
 */

import fs from 'node:fs';
import path from 'node:path';

const SCRIPT = path.join('.claude', 'hooks', 'arbiter-board.cjs');
const SETTINGS = path.join('.claude', 'settings.json');
const TEMPLATE = path.join(__dirname, '..', 'templates', 'hooks', 'arbiter-board.cjs');
/** Claude Code sets the project's root in this; the script finds the board's files from there. */
export const HOOK_COMMAND = 'node "$CLAUDE_PROJECT_DIR/.claude/hooks/arbiter-board.cjs"';

type Entry = { matcher?: string; hooks?: { type?: string; command?: string }[] };
type Settings = { hooks?: Record<string, Entry[]> } & Record<string, unknown>;

const ours = (e: Entry) => (e.hooks ?? []).some((h) => h.command?.includes('arbiter-board.cjs'));

/** Both halves in place: the script, and the entry that runs it. */
export function hookInstalled(root: string): boolean {
  if (!fs.existsSync(path.join(root, SCRIPT))) return false;
  try {
    const s = JSON.parse(fs.readFileSync(path.join(root, SETTINGS), 'utf8')) as Settings;
    return (s.hooks?.UserPromptSubmit ?? []).some(ours);
  } catch {
    return false;
  }
}

export interface HookStep { file: string; outcome: 'created' | 'updated' | 'unchanged' | 'skipped'; note?: string }

/**
 * Write the script, and add the entry to .claude/settings.json beside whatever is there. A
 * settings file that isn't plain JSON is left alone: rewriting it could lose what someone wrote.
 */
export function installHook(root: string): HookStep[] {
  const steps: HookStep[] = [];
  const script = path.join(root, SCRIPT);
  const content = fs.readFileSync(TEMPLATE, 'utf8').replace(/\r\n/g, '\n');
  const before = fs.existsSync(script) ? fs.readFileSync(script, 'utf8') : null;
  if (before === content) steps.push({ file: '.claude/hooks/arbiter-board.cjs', outcome: 'unchanged' });
  else {
    fs.mkdirSync(path.dirname(script), { recursive: true });
    fs.writeFileSync(script, content);
    steps.push({ file: '.claude/hooks/arbiter-board.cjs', outcome: before === null ? 'created' : 'updated' });
  }

  const file = path.join(root, SETTINGS);
  const exists = fs.existsSync(file);
  let settings: Settings = {};
  if (exists) {
    try {
      settings = JSON.parse(fs.readFileSync(file, 'utf8')) as Settings;
    } catch {
      steps.push({ file: '.claude/settings.json', outcome: 'skipped', note: `not plain JSON, so left alone. Add a UserPromptSubmit hook running: ${HOOK_COMMAND}` });
      return steps;
    }
  }
  const entries = settings.hooks?.UserPromptSubmit ?? [];
  const mine = entries.find(ours);
  if (mine?.hooks?.some((h) => h.command === HOOK_COMMAND)) {
    steps.push({ file: '.claude/settings.json', outcome: 'unchanged' });
    return steps;
  }
  const entry: Entry = { hooks: [{ type: 'command', command: HOOK_COMMAND }] };
  const next = mine ? entries.map((e) => (e === mine ? entry : e)) : [...entries, entry];
  settings = { ...settings, hooks: { ...settings.hooks, UserPromptSubmit: next } };
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(settings, null, 2) + '\n');
  steps.push({ file: '.claude/settings.json', outcome: exists ? 'updated' : 'created' });
  return steps;
}
