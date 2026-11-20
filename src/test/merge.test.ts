/**
 * Work started under a new name that continues an existing change can be merged into it: its decisions
 * take that name, its pictures join that change's in the order they were taken, and the queue's reply
 * points out the changes already in an area when new work starts beside them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { renameWork } from '../commands/rename';
import { snapshotWork } from '../commands/snapshot';
import { queue, record } from '../commands/record';
import { readArchive, resolvePaths, writeConfig } from '../store';
import { workVersions } from '../work';

const project = () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-merge-'));
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local' });
  return cwd;
};
const decided = (trigger: string, n: number) => JSON.stringify({ decision: `${trigger} rule ${n} for the cards`, change: `${trigger} changed ${n}`, rationale: 'r', trigger, scope: `pattern:p${n}`, dimension: 'structure', class: 'judgment', verdict: 'accept', level: 'feature', call: 'asked' });
const picture = (cwd: string, trigger: string, byte: number, at: Date) => {
  const f = path.join(cwd, `p${byte}.png`);
  fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, byte]));
  snapshotWork(trigger, { file: f, cwd });
  const id = 'W-' + trigger.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  fs.utimesSync(path.join(cwd, '.arbiter', 'work', `${id}.png`), at, at);
};

test('renaming onto a name that is taken says how to merge, and merging joins them', () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  record(decided('Overview page — Cards', 1), { cwd, author: 'test' });
  record(decided('Overview page — Card dates', 2), { cwd, author: 'test' });
  picture(cwd, 'Overview page — Cards', 1, new Date(Date.now() - 2 * 864e5));
  picture(cwd, 'Overview page — Card dates', 2, new Date(Date.now() - 864e5));

  const refused = renameWork('Overview page — Card dates', 'Overview page — Cards', { cwd });
  assert.equal(refused.exitCode, 1);
  assert.match(String((refused.output.errors as string[])[0]), /--merge/);

  const merged = renameWork('Overview page — Card dates', 'overview page — cards', { cwd, merge: true });
  assert.equal(merged.exitCode, 0);
  assert.equal(merged.output.status, 'merged');
  assert.equal(merged.output.to, 'Overview page — Cards', 'takes the existing name exactly');
  assert.deepEqual([...new Set(readArchive(paths).map((d) => d.trigger))], ['Overview page — Cards']);

  const v = workVersions(paths, 'W-overview-page-cards');
  assert.equal(v.length, 2, 'both pictures, now one change');
  assert.ok(Date.parse(v[0].date) < Date.parse(v[1].date));
  assert.equal(v[1].file, 'W-overview-page-cards.png', 'the newest, from the merged one, is the picture');
  assert.equal(workVersions(paths, 'W-overview-page-card-dates').length, 0);
});

test('new work beside changes in its area gets the list, and how to merge if it continues one', () => {
  const cwd = project();
  record(decided('Overview page — Cards', 1), { cwd, author: 'test' });
  const out = queue(JSON.stringify({ decision: 'Search is an icon that opens into a field', change: 'Search is now an icon', rationale: 'r', trigger: 'Overview page — Toolbar', scope: 'pattern:search', dimension: 'interaction', class: 'judgment', level: 'pattern', call: 'asked' }), { cwd });
  assert.equal(out.output.status, 'queued');
  assert.equal(out.output.newChange, true);
  assert.deepEqual(out.output.changes, ['Overview page — Cards']);
  assert.match(String(out.output.hint), /--merge/);
  // The same work again isn't new.
  const again = queue(JSON.stringify({ decision: 'Sort sits first in the toolbar', change: 'Sort now comes first', rationale: 'r', trigger: 'Overview page — Toolbar', scope: 'pattern:sort', dimension: 'structure', class: 'judgment', level: 'pattern', call: 'asked' }), { cwd });
  assert.equal(again.output.newChange, undefined);
});
