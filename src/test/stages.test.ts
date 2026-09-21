import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { record, queue, judge, queueFindings } from '../commands/record';
import { sweepCommand } from '../commands/sweep';
import { verifyCommand } from '../commands/verify';
import { addCandidate, updateCandidate } from '../commands/candidate';
import { board } from '../commands/board';
import { readCandidates, parseCandidate, formatCandidate } from '../candidates';
import { readActive, readArchive, readPending, resolvePaths, writeConfig } from '../store';
import { parseFindings } from '../findings';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-stages-'));
const write = (cwd: string, rel: string, text: string) => {
  fs.mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(cwd, rel), text);
};
const mech = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    decision: 'Interactive elements use brand tokens, never raw hex',
    rationale: 'Raw hex drifts.',
    trigger: 'Button build',
    scope: 'global',
    dimension: 'visual',
    class: 'mechanical',
    verdict: 'rule',
    files: ['src/Button.tsx'],
    expect: { present: ['brand-500'], absent: ['#3B7BE0'] },
    ...over,
  });

test('stage 2: contradicted claims are refused; verified once true', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  write(cwd, 'src/Button.tsx', 'const c = "#3B7BE0";');
  const r = record(mech(), o);
  assert.equal(r.exitCode, 4);
  assert.equal(readArchive(resolvePaths(cwd)).length, 0);
  assert.equal((r.output.failed as unknown[]).length, 2);

  assert.equal(record(mech(), { ...o, unverified: true }).exitCode, 0, '--unverified records anyway');
  assert.equal(readActive(resolvePaths(cwd))[0].verified, false);

  write(cwd, 'src/Button.tsx', 'const c = "brand-500";');
  const ok = record(mech({ scope: 'pattern:buttons' }), { ...o, keepBoth: true });
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.output.verified, true);

  assert.equal(verifyCommand(undefined, { cwd }).ok, true, 'both rules hold now the file is fixed');
  write(cwd, 'src/Button.tsx', 'const c = "#3B7BE0"; // regressed');
  assert.equal(verifyCommand(undefined, { cwd }).ok, false, 're-check catches a regression');
});

test('stage 2: accept is never verified; fix is', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  write(cwd, 'src/Hero.tsx', 'bg: "#0A0A0A"');
  const a = record(mech({ verdict: 'accept', files: ['src/Hero.tsx'], expect: { absent: ['#0A0A0A'] } }), o);
  assert.equal(a.exitCode, 0);
  assert.equal(a.output.verified, null);
  const f = record(mech({ verdict: 'fix', files: ['src/Hero.tsx'], expect: { absent: ['#0A0A0A'] } }), o);
  assert.equal(f.exitCode, 4);
});

test('stage 2: findings adapter parses ESLint and flat shapes and queues them', () => {
  const eslint = [{ filePath: '/p/src/A.tsx', messages: [{ ruleId: 'x/no-hex', line: 3, message: 'Raw hex', suggestion: 'Use token' }, { message: 'Other' }] }];
  const flat = { findings: [{ file: 'src/B.tsx', rule: 'r', message: 'm' }, { path: 'src/C.css', description: 'd', line: 9 }, { nope: true }] };
  assert.equal(parseFindings(eslint).length, 2);
  assert.equal(parseFindings(flat).length, 2);
  assert.equal(parseFindings(eslint)[0].suggestion, 'Use token');

  const cwd = tmp();
  write(cwd, 'findings.json', JSON.stringify(flat));
  const r = queueFindings('findings.json', { cwd, author: 'test', tool: 'lint' });
  assert.equal(r.output.queued, 2);
  assert.equal(queueFindings('findings.json', { cwd, author: 'test', tool: 'lint' }).output.skippedDuplicates, 2);
  const p = readPending(resolvePaths(cwd));
  assert.equal(p.length, 2);
  assert.equal(p[0].scope, 'file:src/B.tsx');
  assert.equal(p[0].class, 'mechanical');
});

test('stage 3: sweep finds violations, skips docs and node_modules, queues per file', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  write(cwd, 'src/Button.tsx', 'brand-500');
  write(cwd, 'src/Badge.tsx', 'x = "#3B7BE0"');
  write(cwd, 'src/Hero.tsx', 'a = "#3B7BE0"; b = "#3B7BE0"');
  write(cwd, 'node_modules/lib/index.js', '"#3B7BE0"');
  write(cwd, 'README.md', '#3B7BE0');
  const r = record(mech(), o);
  assert.equal(r.exitCode, 0);
  // Counted per line: Hero's two hits on one line are one violation.
  assert.deepEqual((r.output.sweep as { violations: number; files: number }).violations, 2);
  assert.deepEqual((r.output.sweep as { violations: number; files: number }).files, 2);

  const s = sweepCommand('D-0001', { cwd, queue: true, author: 'test' });
  assert.equal(s.result.violations.length, 2);
  assert.deepEqual(s.queued, ['P-0001', 'P-0002']);
  assert.equal(sweepCommand('D-0001', { cwd, queue: true, author: 'test' }).queued.length, 0, 'no duplicate queue');

  // Confirm one file as an exception: an accept, unverified by design.
  const acc = judge('P-0001', { cwd, author: 'test', as: 'accept' });
  assert.equal(acc.exitCode, 0);
  assert.equal(acc.output.verified, null);
});

test('stage 3: judgment rules cannot sweep', () => {
  const cwd = tmp();
  record(mech({ class: 'judgment', files: [], expect: null }), { cwd, author: 'test' });
  const s = sweepCommand('D-0001', { cwd });
  assert.equal(s.result.sweepable, false);
});

test('stage 4: candidates round-trip; approve supersedes siblings with reason', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  const a = addCandidate('Settings — single page', { ...o, feature: 'settings', notes: 'first pass' });
  const b = addCandidate('Settings — tabs', { ...o, feature: 'settings' });
  const c = addCandidate('Billing', { ...o, feature: 'billing' });
  assert.deepEqual([a.output.id, b.output.id, c.output.id], ['C-0001', 'C-0002', 'C-0003']);

  queue(mech({ class: 'judgment', files: [], expect: null, scope: 'pattern:settings-layout', dimension: 'structure' }), { ...o, candidate: 'C-0001' });
  const md = fs.readFileSync(path.join(cwd, '.arbiter/candidates/C-0001.md'), 'utf8');
  assert.ok(md.includes('**P-0001**'), 'candidate page lists linked pending decision');

  const up = updateCandidate('C-0001', { ...o, state: 'approved', why: 'tabs hid the danger zone' });
  assert.deepEqual(up.output.superseded, ['C-0002']);
  const all = readCandidates(resolvePaths(cwd));
  const tabs = all.find((x) => x.id === 'C-0002')!;
  assert.equal(tabs.state, 'superseded');
  assert.equal(tabs.supersededBy, 'C-0001');
  assert.equal(tabs.reason, 'tabs hid the danger zone');
  assert.equal(all.find((x) => x.id === 'C-0003')!.state, 'generated', 'other feature untouched');

  for (const cand of all) assert.deepEqual(parseCandidate(formatCandidate(cand, [])), cand);
  assert.ok(board({ cwd }).includes('superseded → C-0001'));
  assert.equal(updateCandidate('C-0003', { ...o, state: 'superseded' }).exitCode, 1, 'superseded needs --by');
});

test('stage 5: git destination writes index, commits candidate files only, links to GitHub', () => {
  const cwd = tmp();
  const git = (...a: string[]) => execFileSync('git', a, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@t');
  git('config', 'user.name', 'T');
  git('remote', 'add', 'origin', 'https://github.com/acme/app.git');
  write(cwd, 'src/unrelated.ts', 'x');
  git('add', '-A');
  git('commit', '-qm', 'init');
  write(cwd, 'src/unrelated.ts', 'y — uncommitted, must stay uncommitted');
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'git', author: 'test' });

  const r = addCandidate('Billing v1', { cwd, feature: 'billing' });
  assert.equal(r.output.destination, 'git');
  assert.ok(r.output.committed);
  assert.deepEqual(r.output.links, ['https://github.com/acme/app/blob/main/.arbiter/candidates/C-0001.md']);
  assert.ok(fs.existsSync(path.join(cwd, 'CANDIDATES.md')));
  assert.equal(r.output.pages, 'https://acme.github.io/app/arbiter/');
  assert.ok(fs.existsSync(path.join(cwd, 'docs/arbiter/index.html')), 'board page exported for GitHub Pages');
  assert.ok(git('show', '--stat', '--oneline', 'HEAD').includes('docs/arbiter/index.html'), 'and committed');
  assert.ok(git('log', '-1', '--pretty=%s').startsWith('arbiter: add C-0001'));
  assert.equal(git('status', '--porcelain', 'src/'), 'M src/unrelated.ts', 'host changes never swept into the commit');

  const again = updateCandidate('C-0001', { cwd, notes: 'unchanged state' });
  assert.ok(again.output.committed, 'edits commit too');
});

test('stage 5: local destination commits nothing', () => {
  const cwd = tmp();
  const r = addCandidate('X', { cwd, author: 'test' });
  assert.equal(r.output.destination, 'local');
  assert.equal(r.output.committed, undefined);
  assert.ok(!fs.existsSync(path.join(cwd, 'CANDIDATES.md')));
});

test('sweep: rule.files narrows the scan; config excludes apply; globs match', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  write(cwd, 'app/components/A.tsx', '"#3B7BE0"');
  write(cwd, 'app/globals.css', '--brand: #3B7BE0;');
  write(cwd, 'docs/ref.html', '#3B7BE0');
  write(cwd, 'design-reference/x/y.html', '#3B7BE0');
  write(cwd, 'arbiter.json', JSON.stringify({ version: 1, destination: 'local', sweep: { exclude: ['app/globals.css', 'docs/**', 'design-reference/**'] } }));

  const wide = record(mech({ files: [], expect: { absent: ['#3B7BE0'] } }), o);
  assert.equal((wide.output.sweep as { files: number }).files, 1, 'excludes removed three of four');

  const narrow = record(mech({ scope: 'pattern:components', files: [], paths: ['app/components'], expect: { absent: ['#3B7BE0'] } }), { ...o, keepBoth: true });
  const s = sweepCommand(narrow.output.id as string, { cwd });
  assert.equal(s.result.scanned, 'rule.paths');
  assert.equal(s.result.filesScanned, 1);
});

test('overlap: generic UI nouns and other dimensions do not trigger possible matches', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(mech({ class: 'judgment', files: [], expect: null, decision: 'Audit run button shows a spinner while the scan is running', dimension: 'states', scope: 'pattern:audit-run' }), o);
  const r = record(mech({ class: 'judgment', files: [], expect: null, decision: 'Audit empty state offers a Run first audit button', dimension: 'states', scope: 'pattern:audit-empty' }), o);
  assert.equal(r.exitCode, 0, 'shared: audit, run, button, state — but button/run/state are generic and audit alone is not enough');

  write(cwd, 'arbiter.json', JSON.stringify({ version: 1, destination: 'local', overlap: { ignore: ['spinner'] } }));
  const r2 = record(mech({ class: 'judgment', files: [], expect: null, decision: 'Journeys board shows a spinner while journeys load', dimension: 'interaction', scope: 'pattern:board-loading' }), o);
  assert.equal(r2.exitCode, 0, 'different dimension never matches on wording');
});
