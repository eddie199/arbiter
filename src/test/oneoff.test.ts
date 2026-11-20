/**
 * One-off fixes to a single screen aren't recorded, for now: the record command turns them away and
 * writes nothing, and a sweep's per-file items are calls to make, so they're patterns.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { oneOffGate, record } from '../commands/record';
import { sweepCommand } from '../commands/sweep';
import { readArchive, readPending, resolvePaths } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-oneoff-'));
const input = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Buttons in the row match heights', change: 'The buttons in the row now match', rationale: 'r', trigger: 'Settings build', scope: 'file:a.tsx', dimension: 'visual', class: 'judgment', ...over });

test('a one-off fix is turned away and nothing is written; anything else goes through', () => {
  const turned = oneOffGate(input({ level: 'polish' }));
  assert.equal(turned?.exitCode, 0, 'not an error: the agent carries on');
  assert.equal(turned?.output.status, 'not-recorded');
  assert.match(String(turned?.output.reason), /aren't recorded/);
  assert.equal(oneOffGate(input({ level: 'pattern' })), null);
  assert.equal(oneOffGate(input()), null, 'no level is the default, a pattern');
  assert.equal(oneOffGate('not json'), null, 'left for the record command to refuse');
});

test("a sweep's file-by-file items are patterns, so they're asked about", () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'a.css'), 'color: #3B7BE0;');
  record(JSON.stringify({ decision: 'Colours come from tokens', rationale: 'r', trigger: 't', scope: 'global', dimension: 'visual', class: 'mechanical', verdict: 'rule', expect: { absent: ['#3B7BE0'] } }), { cwd, author: 'test' });
  sweepCommand('D-0001', { cwd, queue: true, author: 'test' });
  const queued = readPending(resolvePaths(cwd));
  assert.ok(queued.length >= 1);
  assert.deepEqual([...new Set(queued.map((d) => d.level))], ['pattern']);
  assert.equal(readArchive(resolvePaths(cwd)).filter((d) => d.level === 'polish').length, 0);
});
