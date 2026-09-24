/**
 * remove, unlink, and the snapshot warning that sent someone chasing a bug that wasn't there.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judge, queue, record } from '../commands/record';
import { addCandidate, updateCandidate } from '../commands/candidate';
import { remove, removeSnapshot, unlink } from '../commands/remove';
import { snapshotWork } from '../commands/snapshot';
import { readActive, readArchive, readPending, resolvePaths } from '../store';
import { readCandidates } from '../candidates';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-rm-'));
const o = (cwd: string) => ({ cwd, author: 'test' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const decision = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Destructive actions confirm in a modal', rationale: 'r', trigger: 'Delete flow', scope: 'pattern:destructive-confirm', class: 'judgment', dimension: 'interaction', verdict: 'accept', ...over });

// ── remove a decision ──────────────────────────────────────────────────────

test('remove takes a decision out of the archive and hands back the record', () => {
  const cwd = tmp();
  record(decision(), o(cwd));
  record(decision({ decision: 'A second, real one', scope: 'file:b.tsx' }), o(cwd));

  const r = remove('D-0001', { cwd });
  assert.equal(r.exitCode, 0);
  assert.equal(r.output.status, 'removed');
  assert.match(String(r.output.removed), /Destructive actions confirm in a modal/, 'printed in full — not everyone has git');

  const left = readArchive(resolvePaths(cwd));
  assert.deepEqual(left.map((d) => d.id), ['D-0002'], 'the other one is untouched');
  assert.equal(r.output.idReuse, undefined, 'D-0001 was not the newest, so no id comes free');
  assert.equal(remove('D-0001', { cwd }).exitCode, 1, 'gone for good');

  // Taking the newest out frees its id for the next record, which matters once a board is published.
  const newest = remove('D-0002', { cwd });
  assert.match(String(newest.output.idReuse), /D-0002 was the newest/);
  record(decision({ decision: 'Recorded after the removal' }), o(cwd));
  assert.equal(readArchive(resolvePaths(cwd))[0].id, 'D-0001', 'ids restart from the highest left');
});

test('remove refuses while something still points at the record', () => {
  const cwd = tmp();
  const rule = { verdict: 'rule', decision: 'Save buttons sit bottom-right', scope: 'pattern:save' };
  record(decision(rule), o(cwd));

  // An active rule is a different act: it was real, so retiring keeps it in the archive.
  const active = remove('D-0001', { cwd });
  assert.equal(active.exitCode, 1);
  assert.match(String((active.output.errors as string[])[0]), /--retire D-0001/, 'points at the right verb');
  assert.match(String((active.output.errors as string[])[1]), /--force/, 'but a rule that was never real can still go');

  // Superseded, so no longer active — but now another decision references it.
  record(decision({ ...rule, decision: 'Save buttons sit top-right', supersedes: 'D-0001' }), o(cwd));
  assert.equal(readActive(resolvePaths(cwd)).length, 1);
  const superseded = remove('D-0001', { cwd });
  assert.equal(superseded.exitCode, 1);
  assert.match(String((superseded.output.errors as string[])[0]), /D-0002 supersedes D-0001/);

  // D-0002 is the active rule now, so it takes --force — which is the only way out when a rule
  // was never real: retiring it would add a second false record, and then neither could go.
  assert.equal(remove('D-0002', { cwd }).exitCode, 1);
  const forced = remove('D-0002', { cwd, force: true });
  assert.equal(forced.exitCode, 0);
  assert.deepEqual(forced.output.wrote, ['.arbiter/archive.md', 'DECISIONS.md']);
  assert.equal(readActive(resolvePaths(cwd)).length, 0, 'out of the rules file too');

  assert.match(String(forced.output.note), /D-0001 — which D-0002 replaced — is still inactive/, 'removing a replacement never revives what it replaced');

  // D-0001 left DECISIONS.md when it was superseded and didn't come back, so nothing guards it now.
  const first = remove('D-0001', { cwd });
  assert.equal(first.exitCode, 0);
  assert.equal(first.output.note, undefined);
  assert.equal(readArchive(resolvePaths(cwd)).length, 0);
});

test('a queued decision is skipped, not removed', () => {
  const cwd = tmp();
  queue(decision({ verdict: undefined }), o(cwd));
  const r = remove('P-0001', { cwd });
  assert.equal(r.exitCode, 1);
  assert.match(String((r.output.errors as string[])[0]), /--as skip/);
});

// ── remove a candidate ─────────────────────────────────────────────────────

test('remove takes a screen, its picture and its page; linked decisions block it unless forced', () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'shot.png'), PNG);
  addCandidate('Settings — billing', { ...o(cwd), feature: 'settings', snapshot: 'shot.png' });
  record(decision({ decision: 'Plan and card side by side' }), { ...o(cwd), candidate: 'C-0001' });

  const blocked = remove('C-0001', { cwd });
  assert.equal(blocked.exitCode, 1);
  const errors = (blocked.output.errors as string[]).join(' ');
  assert.match(errors, /D-0001/, 'names what is linked');
  assert.match(errors, /arbiter unlink D-0001/, 'offers the way to keep them');
  assert.match(errors, /--force/, 'and the way through');
  assert.ok(fs.existsSync(path.join(cwd, '.arbiter', 'candidates', 'C-0001.md')), 'nothing written');

  const r = remove('C-0001', { cwd, force: true });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.output.unlinked, ['D-0001']);
  assert.equal(readCandidates(resolvePaths(cwd)).length, 0);
  assert.ok(!fs.existsSync(path.join(cwd, '.arbiter', 'candidates', 'C-0001.md')));
  assert.ok(!fs.existsSync(path.join(cwd, '.arbiter', 'candidates', 'C-0001.png')), 'the picture goes with it');
  assert.equal(readArchive(resolvePaths(cwd))[0].candidate, null, 'the decision survives, detached');
});

test('remove refuses a screen another one says superseded it', () => {
  const cwd = tmp();
  addCandidate('Settings — tabs', { ...o(cwd), feature: 'settings' });
  addCandidate('Settings — one page', { ...o(cwd), feature: 'settings' });
  updateCandidate('C-0002', { ...o(cwd), state: 'approved', why: 'tabs hid the danger zone' });

  const r = remove('C-0002', { cwd });
  assert.equal(r.exitCode, 1);
  assert.match(String((r.output.errors as string[])[0]), /C-0001 says it was superseded by C-0002/);
});

// ── remove a picture ───────────────────────────────────────────────────────

test('remove --snapshot takes the picture and leaves the record', () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'shot.png'), PNG);
  record(decision({ trigger: 'Settings — billing' }), o(cwd));
  snapshotWork('Settings — billing', { cwd, file: 'shot.png' });
  const shot = path.join(cwd, '.arbiter', 'work', 'W-settings-billing.png');
  assert.ok(fs.existsSync(shot));

  const r = removeSnapshot('Settings — billing', { cwd });
  assert.equal(r.exitCode, 0);
  assert.ok(!fs.existsSync(shot));
  assert.match(String(r.output.note), /until the next/, 'says the board keeps the old one for now');
  assert.equal(readArchive(resolvePaths(cwd)).length, 1, 'the decision stays');
  assert.equal(removeSnapshot('Settings — billing', { cwd }).exitCode, 1, 'nothing left to remove');

  // A screen's picture comes off the screen, and its page stops showing it.
  fs.writeFileSync(path.join(cwd, 'shot.png'), PNG);
  addCandidate('Reports', { ...o(cwd), snapshot: 'shot.png' });
  assert.equal(removeSnapshot('C-0001', { cwd }).exitCode, 0);
  assert.equal(readCandidates(resolvePaths(cwd))[0].snapshot, null);
  assert.ok(!fs.readFileSync(path.join(cwd, '.arbiter', 'candidates', 'C-0001.md'), 'utf8').includes('!['));
});

// ── unlink ─────────────────────────────────────────────────────────────────

test('unlink detaches decisions from a screen and leaves both', () => {
  const cwd = tmp();
  addCandidate('Passport — mobile', { ...o(cwd), feature: 'passport' });
  record(decision({ decision: 'Fields stack under 640px' }), { ...o(cwd), candidate: 'C-0001' });
  queue(decision({ verdict: undefined, decision: 'Still queued' }), { ...o(cwd), candidate: 'C-0001' });

  const r = unlink(['D-0001', 'P-0001'], { cwd });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(r.output.ids, ['D-0001', 'P-0001']);
  assert.deepEqual(r.output.from, ['C-0001']);

  const p = resolvePaths(cwd);
  assert.equal(readArchive(p)[0].candidate, null, 'archived one detached');
  assert.equal(readPending(p)[0].candidate, null, 'queued one too');
  assert.equal(readCandidates(p).length, 1, 'the screen stays');
  assert.ok(fs.readFileSync(path.join(cwd, '.arbiter', 'candidates', 'C-0001.md'), 'utf8').includes('_None linked yet._'), 'its page caught up');

  assert.equal(unlink(['D-0001'], { cwd }).exitCode, 1, 'already loose');
  assert.equal(unlink(['D-0099'], { cwd }).exitCode, 1, 'unknown id');
  assert.equal(unlink(['C-0001'], { cwd }).exitCode, 1, 'not a decision id');
});

test('--candidate links a decision at the moment it is judged', () => {
  const cwd = tmp();
  addCandidate('Settings — billing', o(cwd));
  queue(decision({ verdict: undefined }), o(cwd));
  const judged = judge('P-0001', { cwd, as: 'accept', candidate: 'C-0001' });
  assert.equal(judged.exitCode, 0);
  assert.equal(judged.output.candidate, 'C-0001');
  assert.ok(fs.readFileSync(path.join(cwd, '.arbiter', 'candidates', 'C-0001.md'), 'utf8').includes('D-0001'));
});

// ── the warning that misled someone ────────────────────────────────────────

test('a snapshot for work still in the queue says so; once judged it says nothing', () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'shot.png'), PNG);

  // Nothing mentions it at all.
  const unknown = snapshotWork('Passport details mobile', { cwd, file: 'shot.png' });
  assert.match(String(unknown.output.note), /no decisions mention/);

  // Queued but unjudged — the board builds work cards from the archive, so there'd be no card.
  queue(decision({ verdict: undefined, trigger: 'Passport details mobile' }), o(cwd));
  const queued = snapshotWork('Passport details mobile', { cwd, file: 'shot.png' });
  assert.match(String(queued.output.note), /still in the queue/);
  assert.match(String(queued.output.note), /once they're judged/);

  // Judged — there's a card, so nothing to warn about.
  judge('P-0001', { cwd, as: 'accept' });
  assert.equal(snapshotWork('Passport details mobile', { cwd, file: 'shot.png' }).output.note, undefined);
});
