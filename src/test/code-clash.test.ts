/**
 * The Review inbox reads the files a waiting decision names each time it loads: its Code Clash says what
 * they say now, goes once the code is fixed, and says so when a file has gone since it was queued.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queue } from '../commands/record';
import { reviewState } from '../localboard';
import { resolvePaths, writeConfig } from '../store';
import { verify } from '../verify';

const project = () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-clash-'));
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local' });
  return cwd;
};
const input = (over: Record<string, unknown>) => JSON.stringify({ rationale: 'Long names lost the part that told them apart', trigger: 'Projects — List', dimension: 'content', class: 'mechanical', level: 'pattern', call: 'agent', scope: 'pattern:project-names', decision: 'Project names wrap to a second line, never cut off', change: 'Project names wrap instead of being cut off', ...over });

test('a Code Clash is what the files say now, read again each time the inbox loads', () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  const css = path.join(cwd, 'list.css');
  fs.writeFileSync(css, '.name { text-overflow: ellipsis; white-space: nowrap; }\n');
  const queued = queue(input({ files: ['list.css'], expect: { absent: ['text-overflow'] } }), { cwd, author: 'test', unverified: true });
  assert.equal(queued.exitCode, 0, JSON.stringify(queued.output));
  const clash = () => reviewState(paths, 'arbiter').pending[0].codeClash;

  assert.deepEqual(clash()?.map((c) => [c.kind, c.file, c.needle]), [['absent', 'list.css', 'text-overflow']]);
  fs.writeFileSync(css, '.name { overflow-wrap: anywhere; }\n');
  assert.equal(clash(), null, 'fixed since it was queued: no clash');
  fs.rmSync(css);
  assert.deepEqual(clash()?.map((c) => [c.kind, c.detail]), [['exists', 'file not found']], 'gone since: the card says so');
});

test('a decision that names no files never has a Code Clash', () => {
  const cwd = project();
  queue(input({ class: 'judgment' }), { cwd, author: 'test' });
  assert.equal(reviewState(resolvePaths(cwd), 'arbiter').pending[0].codeClash, null);
});

test('a pattern found where it shouldn’t be says the text it matched', () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, 'profile.css'), '.name { color: #3B7BE0; }\n');
  const [c] = verify(cwd, ['profile.css'], { absent: ['regex:#[0-9a-fA-F]{6}\\b'] }).checks.filter((x) => !x.ok);
  assert.equal(c.found, '#3B7BE0');
});
