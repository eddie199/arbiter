// A project's own DECISIONS.md, and notes written by hand in Arbiter's: neither is ever lost. Before
// 0.1.10 the first recorded rule rewrote DECISIONS.md from the rules alone, so a decision log that was
// there first, or a paragraph typed into the rules file, was gone with no warning.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { agentsLine, init } from '../commands/init';
import { record, retire } from '../commands/record';
import { exportBoard } from '../commands/export';
import { formatActive, isRulesFile, notesOf, parseEntries } from '../format';
import { liveBoard } from '../localboard';
import { readActive, readConfig, resolvePaths, rulesFileAllowed, rulesName, takeRulesMoved, writeActive } from '../store';
import { Decision } from '../schema';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-rules-'));
const read = (cwd: string, rel: string) => fs.readFileSync(path.join(cwd, rel), 'utf8');
const opts = (cwd: string) => ({ cwd, author: 'test' });
const rule = (over: Partial<Decision> = {}) => JSON.stringify({
  decision: 'Half-width cards use icon-only action buttons',
  rationale: 'A labelled button wrapped under the text on mobile',
  trigger: 'Audit page',
  scope: 'pattern:compact-card-actions',
  class: 'judgment',
  dimension: 'interaction',
  verdict: 'rule',
  ...over,
});

const THEIRS = [
  '# Architecture decisions',
  '',
  '## 2026-03-02: Use Postgres, not Mongo',
  '',
  'We need joins for billing reports.',
  '',
].join('\n');

test("init leaves the project's own DECISIONS.md alone, and the rules go in DESIGN-DECISIONS.md", async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'DECISIONS.md'), THEIRS);
  const steps = await init({ cwd, yes: true, skipInstall: true, author: 'test' });

  assert.equal(read(cwd, 'DECISIONS.md'), THEIRS);
  assert.ok(steps.some((s) => s.file === 'DECISIONS.md' && s.outcome === 'unchanged' && s.note === 'yours, so Arbiter leaves it alone'));
  assert.ok(steps.some((s) => s.file === 'DESIGN-DECISIONS.md' && s.outcome === 'created' && s.note === 'your design rules go here'));
  assert.equal(readConfig(resolvePaths(cwd))?.decisions, 'DESIGN-DECISIONS.md');
  assert.equal(rulesName(resolvePaths(cwd)), 'DESIGN-DECISIONS.md');

  // Everything that tells the agent where the rules are says so.
  assert.match(read(cwd, 'CLAUDE.md'), /read `DESIGN-DECISIONS\.md`/);
  assert.match(read(cwd, 'AGENTS.md'), /read `DESIGN-DECISIONS\.md`/);
  const skill = read(cwd, '.claude/skills/arbiter/SKILL.md');
  assert.match(skill, /DESIGN-DECISIONS\.md/);
  // The intro says where the rules go, and that theirs is safe: the one place their file is named.
  assert.match(skill, /Rules go into `DESIGN-DECISIONS\.md` \(your own DECISIONS\.md stays as it is\), and I read them/);
  assert.doesNotMatch(skill.replace(/DESIGN-DECISIONS\.md/g, '').replace('your own DECISIONS.md stays as it is', ''), /DECISIONS\.md/);
  assert.doesNotMatch(read(cwd, '.claude/hooks/arbiter-board.cjs').replace(/DESIGN-DECISIONS\.md/g, ''), /DECISIONS\.md/);
  assert.match(read(cwd, '.arbiter/archive.md'), /`DESIGN-DECISIONS\.md`/);

  // Recording writes there, and theirs is still word for word what it was.
  const r = record(rule(), opts(cwd));
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.output.wrote, ['.arbiter/archive.md', 'DESIGN-DECISIONS.md']);
  assert.equal(read(cwd, 'DECISIONS.md'), THEIRS);
  assert.equal(readActive(resolvePaths(cwd)).length, 1);
  assert.match(read(cwd, 'DESIGN-DECISIONS.md'), /### D-0001 · Half-width cards/);

  // A second init keeps the rules where they are.
  const again = await init({ cwd, yes: true, skipInstall: true });
  assert.ok(again.some((s) => s.file === 'DESIGN-DECISIONS.md' && s.outcome === 'unchanged'));
  assert.equal(readConfig(resolvePaths(cwd))?.decisions, 'DESIGN-DECISIONS.md');
});

test("init keeps using DECISIONS.md when it's Arbiter's, empty, or missing, and writes no setting for it", async () => {
  for (const before of [null, '', '   \n']) {
    const cwd = tmp();
    if (before !== null) fs.writeFileSync(path.join(cwd, 'DECISIONS.md'), before);
    await init({ cwd, yes: true, skipInstall: true, author: 'test' });
    assert.equal(readConfig(resolvePaths(cwd))?.decisions, undefined);
    assert.equal(rulesName(resolvePaths(cwd)), 'DECISIONS.md');
    assert.ok(!fs.existsSync(path.join(cwd, 'DESIGN-DECISIONS.md')));
  }
  // One Arbiter wrote already, rules in it: still Arbiter's.
  const cwd = tmp();
  await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  record(rule(), opts(cwd));
  await init({ cwd, yes: true, skipInstall: true });
  assert.equal(readConfig(resolvePaths(cwd))?.decisions, undefined);
});

test('a project set up by 0.1.9 with its own DECISIONS.md moves its rules out on the next init (what update runs)', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'DECISIONS.md'), THEIRS);
  // What 0.1.9 left: arbiter.json with no "decisions", their file untouched until a rule was recorded.
  fs.writeFileSync(path.join(cwd, 'arbiter.json'), JSON.stringify({ version: 1, destination: 'local', author: 'test', client: 'claude-code' }));
  await init({ cwd, yes: true, skipInstall: true });
  assert.equal(readConfig(resolvePaths(cwd))?.decisions, 'DESIGN-DECISIONS.md');
  assert.equal(read(cwd, 'DECISIONS.md'), THEIRS);
});

test('when DESIGN-DECISIONS.md is taken too, the next name is used; when every name is, init says what to do', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'DECISIONS.md'), THEIRS);
  fs.writeFileSync(path.join(cwd, 'DESIGN-DECISIONS.md'), '# Our design notes\n\nKeep it calm.\n');
  await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  assert.equal(readConfig(resolvePaths(cwd))?.decisions, 'ARBITER-DECISIONS.md');

  const full = tmp();
  for (const f of ['DECISIONS.md', 'DESIGN-DECISIONS.md', 'ARBITER-DECISIONS.md']) fs.writeFileSync(path.join(full, f), THEIRS);
  await assert.rejects(init({ cwd: full, yes: true, skipInstall: true, author: 'test' }), /Set "decisions" in arbiter\.json/);
  for (const f of ['DECISIONS.md', 'DESIGN-DECISIONS.md', 'ARBITER-DECISIONS.md']) assert.equal(read(full, f), THEIRS);
});

test('arbiter.json can only name a Markdown file in the project root, and never one that belongs to something else', () => {
  for (const ok of ['DECISIONS.md', 'DESIGN-DECISIONS.md', 'ui_rules.md']) assert.ok(rulesFileAllowed(ok), ok);
  for (const bad of ['../x.md', 'docs/x.md', '/etc/x.md', 'C:\\x.md', 'x.txt', '.hidden.md', 'README.md', 'claude.md', 'AGENTS.md', '', 7, null]) {
    assert.ok(!rulesFileAllowed(bad), String(bad));
  }
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'arbiter.json'), JSON.stringify({ version: 1, destination: 'local', decisions: '../outside.md' }));
  assert.equal(resolvePaths(cwd).decisions, path.join(cwd, 'DECISIONS.md'));
  fs.writeFileSync(path.join(cwd, 'arbiter.json'), '{ not json');
  assert.equal(resolvePaths(cwd).decisions, path.join(cwd, 'DECISIONS.md'));
});

test('notes written by hand in the rules file survive every rewrite, above the rules and below them', async () => {
  const cwd = tmp();
  await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  const file = path.join(cwd, 'DECISIONS.md');
  const header = fs.readFileSync(file, 'utf8');
  // A preamble right under the header, and a section of the team's own after the rules.
  fs.writeFileSync(file, header + '\nThis project serves clinicians: calm beats clever.\n\n- Buttons: primary only once per screen.\n');
  record(rule(), opts(cwd));
  fs.appendFileSync(file, '\n## Notes from the team\n\nWe agreed in the October workshop: two type sizes per card at most.\n');
  record(rule({ decision: 'Empty states name the next step', scope: 'pattern:empty-next-step', dimension: 'content', trigger: 'Inbox' }), opts(cwd));
  retire('D-0001', 'Cards got wider', opts(cwd));

  const text = fs.readFileSync(file, 'utf8');
  for (const line of ['This project serves clinicians: calm beats clever.', '- Buttons: primary only once per screen.', '## Notes from the team', 'We agreed in the October workshop: two type sizes per card at most.']) {
    assert.ok(text.includes(line), `lost: ${line}`);
  }
  // Above stays above, below stays below, and the rules are still read right.
  assert.ok(text.indexOf('calm beats clever') < text.indexOf('## Content'));
  assert.ok(text.indexOf('## Notes from the team') > text.indexOf('### D-0002'));
  assert.deepEqual(readActive(resolvePaths(cwd)).map((d) => d.id), ['D-0002']);
  assert.equal(text.match(/^# Decisions$/gm)?.length, 1);
  assert.match(text, /— 1 of 40\./);

  // Rewriting what's there changes nothing: the notes don't drift or double.
  const paths = resolvePaths(cwd);
  writeActive(paths, readActive(paths));
  assert.equal(fs.readFileSync(file, 'utf8'), text);
});

test("a file with no notes is written exactly as before, and an older header isn't kept as a note", () => {
  const one = parseEntries(formatActive([], 40) + '\n' + [
    '## Interaction', '', '### D-0001 · Half-width cards use icon-only action buttons', '',
    '- **Rationale:** A labelled button wrapped', '- **Rejected:**', '  - A full label', '- **Trigger:** Audit page',
    '- **Scope:** pattern:x · **Dimension:** interaction · **Level:** pattern · **Class:** judgment · **Verdict:** rule',
    '- **Author:** test · **Date:** 2026-11-26T00:00:00Z · **Commit:** — · **Supersedes:** —', '',
  ].join('\n'));
  assert.equal(one.length, 1);
  const written = formatActive(one, 40);
  assert.deepEqual(notesOf(written), { top: '', bottom: '' });
  assert.ok(!written.includes('\n\n\n'), 'no stray blank lines where notes would go');
  const plain = formatActive([], 40);
  assert.deepEqual(notesOf(plain), { top: '', bottom: '' });
  // 0.1.9's header ended "Edit by hand if you must — the format round-trips."
  const old = plain.replace(/Add entries with `npx arbiter record`\..*$/m, 'Add entries with `npx arbiter record`. Edit by hand if you must — the format round-trips.');
  assert.notEqual(old, plain);
  assert.deepEqual(notesOf(old), { top: '', bottom: '' });
});

test("a 0.1.9 project whose own DECISIONS.md was never moved: the first rule moves the rules out, and the agent is pointed there", () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'DECISIONS.md'), THEIRS);
  // What 0.1.9 left: arbiter.json with no "decisions", and its line in CLAUDE.md pointing at their file.
  fs.writeFileSync(path.join(cwd, 'arbiter.json'), JSON.stringify({ version: 1, destination: 'local', author: 'test', client: 'claude-code' }));
  fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), '# Ours\n\nKeep PRs small.\n\n' + agentsLine('DECISIONS.md') + '\n');
  assert.equal(isRulesFile(THEIRS), false);

  const r = record(rule(), opts(cwd));
  assert.equal(r.exitCode, 0);
  assert.equal(read(cwd, 'DECISIONS.md'), THEIRS, 'theirs, word for word');
  assert.equal(readConfig(resolvePaths(cwd))?.decisions, 'DESIGN-DECISIONS.md');
  assert.match(read(cwd, 'DESIGN-DECISIONS.md'), /### D-0001 · Half-width cards/);
  assert.deepEqual(r.output.wrote, ['.arbiter/archive.md', 'DESIGN-DECISIONS.md']);
  // The agent is pointed at the new file, and the rest of CLAUDE.md is as it was.
  const claude = read(cwd, 'CLAUDE.md');
  assert.match(claude, /read `DESIGN-DECISIONS\.md`/);
  assert.match(claude, /^# Ours\n\nKeep PRs small\.\n/);
  // What the agent tells the user, once.
  const moved = takeRulesMoved();
  assert.equal(moved?.file, 'DESIGN-DECISIONS.md');
  assert.match(moved!.say, /^You already have a DECISIONS.md, so Arbiter has put your design rules in their own file, DESIGN-DECISIONS.md. Yours stays exactly as it is/);
  assert.equal(takeRulesMoved(), null, 'said once');

  // The next rule goes straight to the new file; nothing moves again.
  record(rule({ decision: 'Empty states name the next step', scope: 'pattern:empty-next-step', dimension: 'content', trigger: 'Inbox' }), opts(cwd));
  assert.equal(takeRulesMoved(), null);
  assert.equal(readActive(resolvePaths(cwd)).length, 2);
  assert.equal(read(cwd, 'DECISIONS.md'), THEIRS);
});

test("with no arbiter.json to say where rules go, someone else's file still keeps every line", () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'DECISIONS.md'), THEIRS);
  record(rule(), opts(cwd));
  const text = read(cwd, 'DECISIONS.md');
  for (const line of THEIRS.split('\n').filter(Boolean)) assert.ok(text.includes(line), `lost: ${line}`);
  assert.equal(readActive(resolvePaths(cwd)).length, 1);
});

test('the board and an exported copy name the rules file, so Design rules says where the rules live', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'DECISIONS.md'), THEIRS);
  await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  record(rule(), opts(cwd));
  assert.equal(liveBoard(resolvePaths(cwd)).rulesFile, 'DESIGN-DECISIONS.md');
  const r = exportBoard({ cwd, includeRules: true, out: 'copy' });
  assert.match(fs.readFileSync(r.index, 'utf8'), /"rulesFile":"DESIGN-DECISIONS\.md"/);
});
