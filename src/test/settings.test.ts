/**
 * Settings, as the board's Preferences page saves them to arbiter.json, and the CLI obeying them where it
 * acts: what `record --pending` queues, whether pictures are asked for, and DECISIONS.md's cap.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queue, record } from '../commands/record';
import { areasCommand } from '../commands/areas';
import { saveSettings, settingsOf } from '../settings';
import { readConfig, readPending, resolvePaths, writeConfig } from '../store';

const project = () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-settings-'));
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local' });
  return cwd;
};
const line = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Filters sit in one bar above the list', change: 'The filters now sit in one bar', rationale: 'r', trigger: 'Overview — Filters', scope: 'pattern:filter-bar', dimension: 'structure', class: 'judgment', level: 'pattern', call: 'asked', ...over });

test('a project with no settings saved shows the defaults', () => {
  const s = settingsOf(resolvePaths(project()));
  assert.deepEqual(s, { checkin: 'feature', record: 'pattern', agentCalls: true, pictures: true, app: null, suggestFolders: true, cap: 40, rules: 0 });
});

test('settings are checked, then saved to arbiter.json; a check-in answers the install question', () => {
  const paths = resolvePaths(project());
  const saved = saveSettings(paths, { checkin: 'quiet', record: 'feature', agentCalls: false, pictures: false, suggestFolders: false, app: 'http://localhost:3000/', cap: 30 });
  assert.ok(saved.ok);
  const config = readConfig(paths)!;
  assert.equal(config.checkin, 'quiet');
  assert.ok(config.onboarded, 'choosing a check-in on the page counts as answering it');
  assert.deepEqual(config.record, { level: 'feature', agent: false });
  assert.equal(config.pictures, false);
  assert.equal(config.suggestFolders, false);
  assert.deepEqual(config.app, { url: 'http://localhost:3000' });
  assert.equal(config.activeCap, 30);
  assert.match(fs.readFileSync(paths.decisions, 'utf8'), /0 of 30/, "DECISIONS.md's header says how many it holds");

  // An empty address takes it off.
  assert.ok(saveSettings(paths, { app: '' }).ok);
  assert.equal(readConfig(paths)!.app, undefined);

  const bad = saveSettings(paths, { checkin: 'loud', cap: 0, app: 'https://me:secret@example.com', colour: 'blue' });
  assert.equal(bad.ok, false);
  if (!bad.ok) assert.equal(bad.errors.length, 4);
  assert.equal(readConfig(paths)!.checkin, 'quiet', 'nothing written when anything is wrong');
});

test("the cap can't go below the rules DECISIONS.md already has", () => {
  const cwd = project();
  const paths = resolvePaths(cwd);
  for (const n of [1, 2, 3]) record(JSON.stringify({ decision: `Rule number ${n} for the list`, rationale: 'r', trigger: `Work ${n}`, scope: `pattern:p${n}`, dimension: 'visual', class: 'judgment', verdict: 'rule' }), { cwd, author: 'test', keepBoth: true });
  const r = saveSettings(paths, { cap: 2 });
  assert.equal(r.ok, false);
  if (!r.ok) assert.match(r.errors[0], /has 3 rules/);
  assert.ok(saveSettings(paths, { cap: 3 }).ok);
});

test('features only: a pattern is turned away and nothing is written; a feature and a clash still go in', () => {
  const cwd = project();
  saveSettings(resolvePaths(cwd), { record: 'feature' });
  const out = queue(line(), { cwd });
  assert.equal(out.exitCode, 0, 'not an error: the agent carries on');
  assert.equal(out.output.status, 'not-recorded');
  assert.match(String(out.output.reason), /features only/);
  assert.equal(readPending(resolvePaths(cwd)).length, 0);
  assert.equal(queue(line({ level: 'feature' }), { cwd }).output.status, 'queued');
  assert.equal(queue(line({ against: 'D-0001', trigger: 'Settings' }), { cwd }).output.status !== 'not-recorded', true, 'a clash always needs someone to say which wins');
});

test("with the agent's own calls off, only what the person asked for or corrected is queued", () => {
  const cwd = project();
  saveSettings(resolvePaths(cwd), { agentCalls: false });
  assert.equal(queue(line({ call: 'agent' }), { cwd }).output.status, 'not-recorded');
  assert.equal(queue(line({ call: 'corrected' }), { cwd }).output.status, 'queued');
});

test('pictures off: replies say so and ask for none; folder suggestions off: areas says so', () => {
  const cwd = project();
  saveSettings(resolvePaths(cwd), { pictures: false, suggestFolders: false });
  const out = queue(line(), { cwd });
  assert.equal(out.output.pictures, false);
  assert.equal(out.output.picture, undefined);
  const areas = areasCommand({ cwd });
  assert.equal(areas.output.suggestFolders, false);
  assert.match(String(areas.text), /Folder suggestions are off/);
});
