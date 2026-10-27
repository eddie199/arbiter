import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { askCheckin, checkinHandoff, init } from '../commands/init';
import { Prompter } from '../commands/prompt';
import { record } from '../commands/record';
import { readActive, readConfig, resolvePaths } from '../store';

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

test('install asks the check-in question once; nobody at the terminal leaves it for the agent', async () => {
  const cwd = tmp();
  await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  const unasked = readConfig(resolvePaths(cwd))!;
  assert.equal(unasked.onboarded, undefined, 'no answer recorded that nobody gave');
  assert.equal(unasked.checkin, undefined);
  assert.match(checkinHandoff(), /npx arbiter setup --checkin feature/);
  assert.match(checkinHandoff(), /ask the user now, in chat/);

  // The agent asked in chat and passes the answer along.
  await init({ cwd, yes: true, skipInstall: true, checkin: 'quiet' });
  const answered = readConfig(resolvePaths(cwd))!;
  assert.equal(answered.checkin, 'quiet');
  assert.ok(answered.onboarded);

  // A second install keeps the answer and when it was given.
  await init({ cwd, yes: true, skipInstall: true });
  assert.deepEqual(readConfig(resolvePaths(cwd)), answered);

  await assert.rejects(init({ cwd, yes: true, skipInstall: true, checkin: 'loud' }), /--checkin must be one of/);
});

test('the check-in question at the terminal: a number or a name, Enter for the recommended, null with nobody there', async () => {
  const ask = (input: string[]) => {
    const p = new Prompter(Readable.from(input));
    return askCheckin(p).finally(() => p.close());
  };
  assert.equal(await ask(['2\n']), 'quiet');
  assert.equal(await ask(['every\n']), 'every');
  assert.equal(await ask(['\n']), 'feature', 'Enter takes the recommended one');
  assert.equal(await ask(['loud\n', '3\n']), 'every', 'asks again until it gets one of the three');
  assert.equal(await ask([]), null, "an agent's closed input isn't an answer");
});
