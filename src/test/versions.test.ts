/**
 * A piece of work's earlier pictures: a new picture keeps the last one as an earlier version, the same
 * picture twice isn't a new one, a rename takes them along, the board lists them oldest first, and the
 * Review inbox gets the picture from before a decision once a newer one was taken after it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { snapshotWork } from '../commands/snapshot';
import { renameWork } from '../commands/rename';
import { queue, record } from '../commands/record';
import { boardOf, reviewState } from '../localboard';
import { readPending, resolvePaths, writeConfig, writePending } from '../store';
import { KEEP_VERSIONS, workVersions } from '../work';

const project = () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-versions-'));
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local' });
  return cwd;
};
// Distinct tiny images: the bytes differ, so each counts as a new picture.
const image = (cwd: string, name: string, byte: number) => {
  const f = path.join(cwd, name);
  fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, byte]));
  return f;
};
const decided = (trigger: string) => JSON.stringify({ decision: `${trigger} uses one layout`, change: `${trigger} now uses one layout`, rationale: 'r', trigger, scope: 'pattern:p', dimension: 'structure', class: 'judgment', verdict: 'accept', level: 'feature', call: 'asked' });

test('a new picture keeps the last one; the same picture again is not a new version', () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  assert.equal(snapshotWork('Billing — Plans', { file: image(cwd, 'a.png', 1), cwd }).exitCode, 0);
  assert.equal(workVersions(paths, 'W-billing-plans').length, 1);
  const second = snapshotWork('Billing — Plans', { file: image(cwd, 'b.png', 2), cwd });
  assert.ok(second.output.earlier, 'says where the earlier picture went');
  const all = workVersions(paths, 'W-billing-plans');
  assert.equal(all.length, 2);
  assert.match(all[0].file, /^history\/W-billing-plans\//);
  assert.equal(all[1].file, 'W-billing-plans.png', 'the current picture stays where it always was');
  assert.ok(Date.parse(all[0].date) <= Date.parse(all[1].date), 'oldest first');
  snapshotWork('Billing — Plans', { file: path.join(cwd, 'b.png'), cwd });
  assert.equal(workVersions(paths, 'W-billing-plans').length, 2, 'the same picture again adds nothing');
});

test(`only the ${KEEP_VERSIONS} most recent earlier pictures are kept`, () => {
  const cwd = project();
  for (let i = 0; i < KEEP_VERSIONS + 3; i++) snapshotWork('Settings', { file: image(cwd, `s${i}.png`, i + 10), cwd });
  assert.equal(workVersions(resolvePaths(cwd), 'W-settings').length, KEEP_VERSIONS + 1);
});

test('a rename takes the earlier pictures along, and the board lists them', () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  record(decided('To review'), { cwd, author: 'test' });
  snapshotWork('To review', { file: image(cwd, 'a.png', 1), cwd });
  snapshotWork('To review', { file: image(cwd, 'b.png', 2), cwd });
  assert.equal(renameWork('To review', 'Review inbox — Sorting', { cwd }).exitCode, 0);
  assert.equal(workVersions(paths, 'W-to-review').length, 0);
  assert.equal(workVersions(paths, 'W-review-inbox-sorting').length, 2);
  const card = boardOf(paths, { pictures: '/snapshots/', includeRules: false, queued: [] }).candidates.find((c) => c.id === 'W-review-inbox-sorting')!;
  assert.equal(card.versions?.length, 2);
  assert.match(card.versions![0].src, /^\/snapshots\/history\/W-review-inbox-sorting\//);
  assert.ok(card.decisions[0].date, 'decisions carry their date, to place them among the pictures');
});

test('the inbox shows the picture from before a decision once a newer one was taken after it', () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  snapshotWork('Billing — Plans', { file: image(cwd, 'a.png', 1), cwd });
  // The first picture is from an hour ago; the work then changed.
  const hourAgo = new Date(Date.now() - 3600e3);
  fs.utimesSync(path.join(paths.archiveDir, 'work', 'W-billing-plans.png'), hourAgo, hourAgo);
  queue(JSON.stringify({ decision: 'Plan cards sit side by side', change: 'Plan cards now sit side by side', rationale: 'r', trigger: 'Billing — Plans', scope: 'pattern:plan-cards', dimension: 'structure', class: 'judgment', level: 'pattern', call: 'asked' }), { cwd });
  // Queued a moment before the new picture, as an agent does: decisions first, then the picture.
  const [d] = readPending(paths);
  writePending(paths, [{ ...d, date: new Date(Date.now() - 1000).toISOString().replace(/\.\d{3}Z$/, 'Z') }]);
  assert.equal(reviewState(paths, 'arbiter').pending[0].before, null, 'one picture: nothing to compare yet');
  snapshotWork('Billing — Plans', { file: image(cwd, 'b.png', 2), cwd });
  const before = reviewState(paths, 'arbiter').pending[0].before;
  assert.ok(before);
  assert.match(before!.src, /^\/snapshots\/history\/W-billing-plans\//);
});
