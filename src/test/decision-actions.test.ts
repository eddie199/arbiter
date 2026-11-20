/**
 * A change page's actions on its decisions: new words for a Change line keep the old ones on the record,
 * a confirmed decision can be made a rule (checked against the rules there), and a decision removed by
 * mistake goes back where it was.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judge, queue, record } from '../commands/record';
import { editChange, promote, restoreDecision } from '../commands/decision';
import { remove } from '../commands/remove';
import { readActive, readArchive, resolvePaths, writeConfig } from '../store';

const project = () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-decision-'));
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local' });
  return cwd;
};
const input = (over: Record<string, unknown>) => JSON.stringify({ rationale: 'r', trigger: 'Billing — Plans', dimension: 'structure', class: 'judgment', level: 'feature', call: 'asked', ...over });

test('new words for a Change line keep the old ones on the record', () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  record(input({ decision: 'Plan cards sit side by side', change: 'Plan cards now sit side by side', scope: 'pattern:plans', verdict: 'accept' }), { cwd, author: 'test' });
  const out = editChange('D-0001', 'The plan cards now sit three across', { cwd });
  assert.equal(out.exitCode, 0);
  const d = readArchive(paths)[0];
  assert.equal(d.change, 'The plan cards now sit three across');
  assert.match(d.reworded[0], /^Change was: Plan cards now sit side by side/);
  assert.equal(editChange('D-0001', 'The plan cards now sit three across', { cwd }).exitCode, 1, 'the same words again is nothing to save');
});

test('a confirmed decision can be made a rule; an overlap asks first', () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  record(input({ decision: 'Plan cards sit side by side on Billing', change: 'Plan cards sit side by side', scope: 'pattern:plan-cards', verdict: 'rule' }), { cwd, author: 'test' });
  record(input({ decision: 'Plan cards sit side by side on the Billing page', change: 'Plan cards line up', scope: 'pattern:plan-cards', verdict: 'accept' }), { cwd, author: 'test' });
  record(input({ decision: 'Prices show per month and per year', change: 'Prices show both periods', scope: 'pattern:prices', verdict: 'accept' }), { cwd, author: 'test' });

  const clean = promote('D-0003', { cwd });
  assert.equal(clean.exitCode, 0);
  assert.ok(readActive(paths).some((d) => d.id === 'D-0003'), 'in DECISIONS.md, same id');
  assert.equal(readArchive(paths).find((d) => d.id === 'D-0003')?.verdict, 'rule');

  const overlap = promote('D-0002', { cwd });
  assert.equal(overlap.exitCode, 2);
  assert.deepEqual((overlap.output.overlaps as { id: string; scope?: string }[]).map((o) => [o.id, o.scope]), [['D-0001', 'pattern:plan-cards']], 'says what both apply to');
  assert.equal(promote('D-0002', { cwd, supersedes: 'D-0001' }).exitCode, 0);
  const active = readActive(paths).map((d) => d.id);
  assert.ok(active.includes('D-0002') && !active.includes('D-0001'), 'it replaced the rule it overlapped');
  assert.equal(promote('D-0002', { cwd }).exitCode, 1, 'a rule already');
});

test('an overlap on a file names the change it is on, not the file', () => {
  const cwd = project();
  const file = { scope: 'file:templates/review.html', trigger: 'Review inbox — Old review page' };
  record(input({ decision: 'The review page uses the board buttons', change: 'Buttons match the board', verdict: 'rule', ...file }), { cwd, author: 'test' });
  record(input({ decision: 'The review page uses the board greys', change: 'Greys match the board', verdict: 'accept', ...file }), { cwd, author: 'test' });
  const overlap = promote('D-0002', { cwd });
  assert.equal(overlap.exitCode, 2);
  assert.deepEqual((overlap.output.overlaps as { id: string; change?: string }[]).map((o) => [o.id, o.change]), [['D-0001', 'Review inbox — Old review page']]);
});

test('a full DECISIONS.md lists its rules, so one can be picked to replace', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-decision-'));
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', activeCap: 1 });
  record(input({ decision: 'Empty states are one grey line', change: 'Empty lists read as one grey line', scope: 'pattern:empty-state', dimension: 'states', verdict: 'rule' }), { cwd, author: 'test' });
  record(input({ decision: 'Prices show per month and per year', change: 'Prices show both periods', scope: 'pattern:prices', verdict: 'accept' }), { cwd, author: 'test' });
  const full = promote('D-0002', { cwd });
  assert.equal(full.exitCode, 3);
  assert.equal(full.output.cap, 1);
  assert.deepEqual((full.output.active as { id: string }[]).map((r) => r.id), ['D-0001']);
  assert.equal(promote('D-0002', { cwd, supersedes: 'D-0001' }).exitCode, 0, 'replacing one makes room');

  // The Review inbox's way to a rule says the same.
  queue(input({ decision: 'Plan names are title case', change: 'Plan names read in title case', scope: 'pattern:plan-names', dimension: 'content' }), { cwd, author: 'test' });
  const queued = judge('P-0001', { cwd, as: 'rule' });
  assert.equal(queued.exitCode, 3);
  assert.equal(queued.output.cap, 1);
  assert.deepEqual((queued.output.active as { id: string }[]).map((r) => r.id), ['D-0002']);
});

test('an overlap from the Review inbox says why in plain words, as the change page does', () => {
  const cwd = project();
  record(input({ decision: 'Plan cards sit side by side on Billing', change: 'Plan cards sit side by side', scope: 'pattern:plan-cards', verdict: 'rule' }), { cwd, author: 'test' });
  record(input({ decision: 'Prices on Billing show both periods', change: 'Prices show both periods', scope: 'pattern:prices', verdict: 'rule' }), { cwd, author: 'test' });
  queue(input({ decision: 'Plan cards put the popular plan in the middle', change: 'The popular plan sits in the middle', scope: 'pattern:plan-cards' }), { cwd, author: 'test' });
  queue(input({ decision: 'Yearly prices on Billing show both periods saved', change: 'Yearly prices show the saving', scope: 'pattern:yearly' }), { cwd, author: 'test' });
  const sure = judge('P-0001', { cwd, as: 'rule' });
  assert.equal(sure.exitCode, 2);
  assert.deepEqual((sure.output.overlaps as { id: string; sure: boolean; scope: string }[]).map((o) => [o.id, o.sure, o.scope]), [['D-0001', true, 'pattern:plan-cards']]);
  const guess = judge('P-0002', { cwd, as: 'rule' });
  assert.equal(guess.exitCode, 2);
  const g = (guess.output.overlaps as { id: string; sure: boolean; words: string[] }[])[0];
  assert.equal(g.sure, false);
  assert.ok(g.words.includes('prices') && !g.words.includes('pric'), 'the words as written, not their stems');
});

test('a decision removed by mistake goes back where it was', () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  for (const n of [1, 2, 3]) record(input({ decision: `Billing decision number ${n}`, change: `Billing changed ${n}`, scope: `pattern:b${n}`, verdict: 'accept' }), { cwd, author: 'test' });
  const before = readArchive(paths);
  const entry = before[1];
  assert.equal(remove('D-0002', { cwd }).exitCode, 0);
  assert.deepEqual(readArchive(paths).map((d) => d.id), ['D-0001', 'D-0003']);
  assert.equal(restoreDecision({ entry, index: 1 }, { cwd }).exitCode, 0);
  assert.deepEqual(readArchive(paths).map((d) => d.id), ['D-0001', 'D-0002', 'D-0003']);
  assert.equal(restoreDecision({ entry, index: 1 }, { cwd }).exitCode, 1, 'only once');
});
