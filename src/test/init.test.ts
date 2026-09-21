import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../commands/init';
import { record } from '../commands/record';
import { readActive, resolvePaths } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-init-'));

test('init is idempotent and merges AGENTS.md', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.claude'));
  fs.writeFileSync(path.join(cwd, 'AGENTS.md'), '# Rules\n\nUse pnpm.\n');

  const first = await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  assert.deepEqual(first.map((s) => [s.file, s.outcome]), [
    ['arbiter.json', 'created'],
    ['DECISIONS.md', 'created'],
    ['.arbiter/.gitignore', 'created'],
    ['.arbiter/archive.md', 'created'],
    ['.claude/skills/arbiter/SKILL.md', 'created'],
    ['AGENTS.md', 'updated'],
    ['CLAUDE.md', 'created'],
    ['package.json', 'skipped'],
  ]);
  assert.equal((fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8').match(/<!-- arbiter -->/g) ?? []).length, 1);

  const agents = fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8');
  assert.ok(agents.startsWith('# Rules\n\nUse pnpm.\n'), 'existing content kept');
  assert.equal((agents.match(/<!-- arbiter -->/g) ?? []).length, 1);

  // Record a rule between runs — a second init must not clobber it.
  record(JSON.stringify({ decision: 'Keep me', rationale: 'r', trigger: 't', scope: 'global', dimension: 'content', class: 'judgment', verdict: 'rule' }), { cwd, author: 'test' });

  const second = await init({ cwd, yes: true, skipInstall: true });
  assert.ok(second.every((s) => s.outcome === 'unchanged' || s.outcome === 'skipped'), JSON.stringify(second));
  assert.equal((fs.readFileSync(path.join(cwd, 'AGENTS.md'), 'utf8').match(/<!-- arbiter -->/g) ?? []).length, 1);
  assert.equal(readActive(resolvePaths(cwd)).length, 1, 'DECISIONS.md not overwritten');

  const config = JSON.parse(fs.readFileSync(path.join(cwd, 'arbiter.json'), 'utf8'));
  assert.equal(config.destination, 'local');
  assert.equal(config.author, 'test');
  assert.equal(config.client, 'claude-code');
});

test('init writes a Cursor rule when told to', async () => {
  const cwd = tmp();
  await init({ cwd, yes: true, skipInstall: true, client: 'cursor', author: 'test' });
  const mdc = fs.readFileSync(path.join(cwd, '.cursor', 'rules', 'arbiter.mdc'), 'utf8');
  assert.ok(mdc.startsWith('---\ndescription: '));
  assert.ok(mdc.includes('alwaysApply: false'));
  assert.ok(mdc.includes('# Arbiter'));
  assert.ok(fs.existsSync(path.join(cwd, '.cursor', 'commands', 'arbiter.md')));
  assert.ok(!fs.existsSync(path.join(cwd, 'CLAUDE.md')), 'no CLAUDE.md for a Cursor project');
});
