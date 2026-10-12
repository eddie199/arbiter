/**
 * The review nudge: at 5, 10, 15 changes waiting, the queue tells the agent to ask whether to
 * review now. Polish isn't counted, because nobody is asked about it, and quiet means quiet.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { judge, queue, queueFindings } from '../commands/record';
import { setup } from '../commands/setup';
import { resolvePaths, writeConfig } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-nudge-'));
const o = (cwd: string) => ({ cwd, author: 'test' });
let n = 0;
const change = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: `Decision ${++n}`, rationale: 'r', trigger: 'Settings', scope: 'pattern:settings', class: 'judgment', dimension: 'interaction', level: 'pattern', ...over });
const ASK5 = 'You have 5 changes waiting in Arbiter. Review them now? (yes / no)';

test('every 5 changes waiting, the queue asks whether to review now; polish is not counted', () => {
  const cwd = tmp();
  for (let i = 1; i <= 4; i++) {
    const r = queue(change(), o(cwd));
    assert.equal(r.output.waiting, i);
    assert.equal(r.output.ask, undefined, `nothing at ${i}`);
  }
  for (let i = 0; i < 3; i++) {
    const p = queue(change({ level: 'polish' }), o(cwd));
    assert.equal(p.output.waiting, 4, 'polish is logged with its group, never asked about');
    assert.equal(p.output.ask, undefined);
  }
  const fifth = queue(change(), o(cwd));
  assert.equal(fifth.output.waiting, 5);
  assert.equal(fifth.output.ask, ASK5);

  // A "no" just waits: nothing again until 10.
  for (let i = 6; i <= 9; i++) assert.equal(queue(change(), o(cwd)).output.ask, undefined, `nothing at ${i}`);
  assert.equal(queue(change(), o(cwd)).output.ask, 'You have 10 changes waiting in Arbiter. Review them now? (yes / no)');
});

test('judging brings the count down, and it asks again when the count climbs back to 5', () => {
  const cwd = tmp();
  for (let i = 0; i < 5; i++) queue(change(), o(cwd));
  for (const id of ['P-0001', 'P-0002', 'P-0003']) assert.equal(judge(id, { ...o(cwd), as: 'accept' }).exitCode, 0);

  const three = queue(change(), o(cwd));
  assert.equal(three.output.waiting, 3);
  assert.equal(three.output.ask, undefined);
  queue(change(), o(cwd));
  assert.equal(queue(change(), o(cwd)).output.ask, ASK5);
});

test('a dry run never asks; scanner findings count toward the question', () => {
  const cwd = tmp();
  for (let i = 1; i <= 4; i++) queue(change(), o(cwd));
  const dry = queue(change(), { ...o(cwd), dryRun: true });
  assert.equal(dry.output.waiting, 5);
  assert.equal(dry.output.ask, undefined, 'nothing was written, so nothing new to review');

  fs.writeFileSync(path.join(cwd, 'lint.json'), JSON.stringify([{ file: 'a.tsx', rule: 'no-hex', message: 'Raw hex colour' }, { file: 'b.tsx', rule: 'no-hex', message: 'Raw hex colour' }]));
  const found = queueFindings('lint.json', o(cwd));
  assert.equal(found.output.waiting, 6, 'from 4 to 6 passes 5');
  assert.equal(found.output.ask, 'You have 6 changes waiting in Arbiter. Review them now? (yes / no)');
});

test('someone who chose "Nothing until I ask" is never asked', () => {
  const cwd = tmp();
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', author: 'test' });
  assert.equal(setup({ checkin: 'quiet', cwd }).exitCode, 0);
  for (let i = 1; i <= 5; i++) {
    const r = queue(change(), o(cwd));
    assert.equal(r.output.checkin, 'quiet');
    assert.equal(r.output.ask, undefined);
  }
  assert.equal(queue(change(), o(cwd)).output.waiting, 6, 'still counted, just not asked');
});
