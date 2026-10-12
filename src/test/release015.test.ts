/**
 * 0.1.5's smaller pieces: polish has no card for a picture, the agent can learn where the app
 * runs, and init leaves Arbiter's own repo alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../commands/init';
import { judge, queueFindings, record } from '../commands/record';
import { setup } from '../commands/setup';
import { snapshotWork } from '../commands/snapshot';
import { readConfig, resolvePaths, writeConfig } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-015-'));
const o = (cwd: string) => ({ cwd, author: 'test' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const decision = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Plan cards sit above the invoice table', rationale: 'r', trigger: 'Billing page', scope: 'file:app/billing/page.tsx', class: 'judgment', dimension: 'structure', verdict: 'accept', level: 'pattern', ...over });
const initialised = () => {
  const cwd = tmp();
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', author: 'test' });
  return cwd;
};

test('snapshot says so when the work is only polish, which never reaches the board', () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'shot.png'), PNG);
  record(decision({ level: 'polish', decision: 'Card padding is 16px' }), o(cwd));
  const only = snapshotWork('Billing page', { cwd, file: 'shot.png' });
  assert.equal(only.exitCode, 0);
  assert.match(String(only.output.note), /only has polish so far/);

  record(decision(), o(cwd));
  const carded = snapshotWork('Billing page', { cwd, file: 'shot.png' });
  assert.equal(carded.output.note, undefined, 'a pattern decision gives the picture a card');
});

test('setup --app saves where the app runs; on its own it leaves the intro and check-in alone', () => {
  const cwd = initialised();
  const r = setup({ app: 'http://localhost:3000/', cwd });
  assert.equal(r.exitCode, 0);
  assert.equal(r.output.app, 'http://localhost:3000', 'no trailing slash, so a route goes on the end');
  const config = readConfig(resolvePaths(cwd))!;
  assert.equal(config.app?.url, 'http://localhost:3000');
  assert.equal(config.onboarded, undefined, 'the first /arbiter still shows the intro');
  assert.equal(config.checkin, undefined, 'nobody chose a check-in yet');

  assert.equal(setup({ app: 'localhost:3000', cwd }).exitCode, 1, 'an address needs its http://');

  const both = setup({ checkin: 'every', app: 'https://staging.example.com', cwd });
  assert.equal(both.output.app, 'https://staging.example.com');
  assert.ok(readConfig(resolvePaths(cwd))!.onboarded);
});

test('setup --app drops a query or fragment, refuses a password, and works beside a hand-edited check-in', () => {
  const cwd = initialised();
  const paths = resolvePaths(cwd);
  assert.equal(setup({ app: 'http://localhost:3000/app?tab=1#top', cwd }).output.app, 'http://localhost:3000/app', 'a route goes on the end');

  const secret = setup({ app: 'https://user:secret@staging.example.com', cwd });
  assert.equal(secret.exitCode, 1, 'arbiter.json is committed');
  assert.equal(readConfig(paths)!.app?.url, 'http://localhost:3000/app', 'nothing written');

  writeConfig(paths, { ...readConfig(paths)!, checkin: 'loud' as never });
  assert.equal(setup({ app: 'http://localhost:5173', cwd }).exitCode, 0, '--app alone never reads the check-in');
  assert.equal(readConfig(paths)!.app?.url, 'http://localhost:5173');
  assert.equal(setup({ cwd }).exitCode, 1, 'a check-in outside the three is still refused where it would be written');
});

test('a scanner finding never asks for a picture: it is a line in a file, not a screen', () => {
  const cwd = initialised();
  fs.writeFileSync(path.join(cwd, 'lint.json'), JSON.stringify([{ file: 'src/a.tsx', line: 3, rule: 'no-hex', message: 'Raw hex colour', suggestion: 'Use brand-500' }]));
  const queued = queueFindings('lint.json', o(cwd));
  assert.equal(queued.exitCode, 0);
  const [id] = queued.output.ids as string[];
  const judged = judge(id, { ...o(cwd), as: 'accept' });
  assert.equal(judged.exitCode, 0);
  assert.equal(judged.output.picture, undefined);

  assert.ok(record(decision(), o(cwd)).output.picture, 'a change someone made on a screen still asks');
});

test("record's picture line names the app's address when arbiter.json has it", () => {
  const cwd = initialised();
  assert.doesNotMatch(String(record(decision(), o(cwd)).output.picture), /The app runs at/);
  setup({ app: 'http://localhost:3000', cwd });
  const r = record(decision({ decision: 'Pay now is the primary button', dimension: 'content' }), o(cwd));
  assert.match(String(r.output.picture), /The app runs at http:\/\/localhost:3000; if you can open that screen/);
});

test("init in Arbiter's own repo doesn't make the package depend on itself", async () => {
  const cwd = tmp();
  const pkg = JSON.stringify({ name: 'arbiterdesign', version: '0.0.0' }, null, 2) + '\n';
  fs.writeFileSync(path.join(cwd, 'package.json'), pkg);
  const steps = await init({ cwd, yes: true, author: 'test' });
  const step = steps.find((s) => s.file === 'package.json')!;
  assert.equal(step.outcome, 'unchanged');
  assert.match(String(step.note), /itself/);
  assert.equal(fs.readFileSync(path.join(cwd, 'package.json'), 'utf8'), pkg, 'package.json untouched');
});
