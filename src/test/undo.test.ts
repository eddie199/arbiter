/**
 * Undo on the local board: a judgement taken back while the board is open. The decision leaves the
 * record, a rule it replaced is a rule again, the item waits where it was, and the agent never hears of it.
 * And on Design rules: a rule reworded or removed, and a removed one put back.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { queue, record } from '../commands/record';
import { review } from '../commands/review';
import { readActive, readArchive, readPending, resolvePaths } from '../store';
import { clearHandoff, readHandoff } from '../handoff';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-undo-'));
const input = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    decision: 'Sheets put the primary action bottom-right',
    rationale: 'Header actions collide with close on mobile',
    trigger: 'Settings build',
    scope: 'pattern:sheet-actions',
    dimension: 'interaction',
    class: 'judgment',
    ...over,
  });
// Its own range: another test file's board on the same port would move this one along, and the test would post to the wrong board.
const port = () => 46000 + Math.floor(Math.random() * 900);
const wait = () => new Promise((r) => setTimeout(r, 200));
const ids = (list: { id: string }[]) => list.map((d) => d.id);

async function board(cwd: string) {
  const p = port();
  const done = review({ cwd, port: p, open: false, grace: 0 });
  await wait();
  return { p, close: async () => { await post(p, '/api/bye', { page: 't' }); await done; } };
}

test('a confirm, a skip and a fix taken back: each waits where it was, and the agent never hears of it', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  queue(input({ decision: 'Empty lists are one grey line', scope: 'pattern:empty', dimension: 'states' }), o); // P-0001
  queue(input({ decision: 'Save sits bottom-right', scope: 'pattern:save' }), o); // P-0002
  queue(input({ decision: 'The delete button is red', scope: 'pattern:delete-colour', dimension: 'visual' }), o); // P-0003
  const paths = resolvePaths(cwd);
  const b = await board(cwd);

  assert.equal((await post(b.p, '/api/judge', { id: 'P-0002', as: 'accept' })).id, 'D-0001');
  assert.deepEqual(readHandoff(paths)?.confirmed, ['D-0001']);
  const back = await post(b.p, '/api/undo', { id: 'P-0002' });
  assert.equal(back.exitCode, 0);
  assert.equal(back.removed, 'D-0001');
  assert.deepEqual(ids(readArchive(paths)), [], 'out of the record');
  assert.deepEqual(ids(readPending(paths)), ['P-0001', 'P-0002', 'P-0003'], 'waiting where it was, with its id');
  assert.equal(readHandoff(paths), null, 'nothing left for the agent');

  assert.equal((await post(b.p, '/api/judge', { id: 'P-0003', as: 'skip' })).exitCode, 0);
  assert.equal((await post(b.p, '/api/undo', { id: 'P-0003' })).exitCode, 0);
  assert.deepEqual(ids(readPending(paths)), ['P-0001', 'P-0002', 'P-0003']);

  await post(b.p, '/api/judge', { id: 'P-0003', as: 'fix', to: 'The delete button stays grey until hovered' });
  await post(b.p, '/api/judge', { id: 'P-0001', as: 'accept' });
  assert.equal(readHandoff(paths)?.todo.length, 1);
  assert.equal((await post(b.p, '/api/undo', { id: 'P-0003' })).exitCode, 0);
  const h = readHandoff(paths);
  assert.deepEqual(h?.todo, [], 'the fix is no longer asked of the agent');
  assert.deepEqual(h?.confirmed.length, 1, 'what else was decided stays');

  assert.equal((await post(b.p, '/api/undo', { id: 'P-0003' })).exitCode, 1, 'once only');
  assert.equal((await post(b.p, '/api/undo', { id: 'P-0002' })).exitCode, 1, 'nothing judged here to take back');
  await b.close();
});

test('a rule that replaced another, taken back: the old rule is a rule again', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(input({ verdict: 'rule', decision: 'Deleting a project asks in a dialog', scope: 'pattern:destructive' }), o); // D-0001
  record(input({ verdict: 'rule', decision: 'Tabs on settings', scope: 'pattern:tabs', dimension: 'structure' }), o); // D-0002
  queue(input({ decision: 'Deleting a project undoes instead of asking', scope: 'pattern:destructive' }), o); // P-0001
  const paths = resolvePaths(cwd);
  const b = await board(cwd);

  const r = await post(b.p, '/api/judge', { id: 'P-0001', as: 'rule', supersedes: 'D-0001' });
  assert.equal(r.exitCode, 0);
  assert.deepEqual(ids(readActive(paths)).sort(), ['D-0002', 'D-0003']);
  const back = await post(b.p, '/api/undo', { id: 'P-0001' });
  assert.equal(back.reinstated, 'D-0001');
  assert.deepEqual(ids(readActive(paths)).sort(), ['D-0001', 'D-0002'], 'in its place in DECISIONS.md, which groups rules by kind');
  assert.deepEqual(ids(readArchive(paths)), ['D-0001', 'D-0002']);
  assert.deepEqual(ids(readPending(paths)), ['P-0001']);
  await b.close();
});

test('once something builds on it, it stays', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  queue(input({ decision: 'Deleting a project asks in a dialog', scope: 'pattern:destructive' }), o); // P-0001
  const paths = resolvePaths(cwd);
  const b = await board(cwd);

  assert.equal((await post(b.p, '/api/judge', { id: 'P-0001', as: 'rule' })).id, 'D-0001');
  // The agent replaces it from the chat while the page is open.
  record(input({ verdict: 'rule', decision: 'Deleting a project undoes instead of asking', scope: 'pattern:destructive' }), { ...o, supersedes: 'D-0001' });
  const back = await post(b.p, '/api/undo', { id: 'P-0001' });
  assert.equal(back.exitCode, 1);
  assert.match(back.errors[0], /D-0002 has replaced D-0001/);
  assert.deepEqual(ids(readPending(paths)), [], 'nothing changed');
  await b.close();
});

test('a fix the agent has already taken says so when it is taken back', async () => {
  const cwd = tmp();
  queue(input({ decision: 'The delete button is red', scope: 'pattern:delete-colour', dimension: 'visual' }), { cwd, author: 'test' });
  const paths = resolvePaths(cwd);
  const b = await board(cwd);

  await post(b.p, '/api/judge', { id: 'P-0001', as: 'fix', to: 'The delete button stays grey until hovered' });
  clearHandoff(paths); // the agent took it
  const back = await post(b.p, '/api/undo', { id: 'P-0001' });
  assert.equal(back.exitCode, 0);
  assert.equal(back.taken, true);
  await b.close();
});

test('Confirm all, taken back one at a time', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  for (const [decision, scope] of [['Labels sit above fields', 'pattern:labels'], ['Buttons are 32px tall', 'pattern:button-height'], ['Cards have 16px padding', 'pattern:card-padding']]) {
    queue(input({ decision, scope, level: 'polish', dimension: 'visual' }), o);
  }
  const paths = resolvePaths(cwd);
  const b = await board(cwd);

  const all = await post(b.p, '/api/judge-all', { as: 'accept', level: 'polish' });
  assert.deepEqual(all.judged, ['D-0001', 'D-0002', 'D-0003']);
  const back = await post(b.p, '/api/undo', { id: 'P-0002' });
  assert.equal(back.removed, 'D-0002', 'the one it was recorded as');
  assert.deepEqual(readArchive(paths).map((d) => d.decision), ['Labels sit above fields', 'Cards have 16px padding']);
  assert.deepEqual(ids(readPending(paths)), ['P-0002']);
  await b.close();
});

test('on Design rules: a rule reworded, removed, and put back as it was', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(input({ verdict: 'rule', decision: 'Deleting a project asks in a dialog', scope: 'pattern:destructive' }), o); // D-0001
  record(input({ verdict: 'rule', decision: 'Tabs on settings', scope: 'pattern:tabs', dimension: 'structure' }), o); // D-0002
  const paths = resolvePaths(cwd);
  const rule = () => readActive(paths).find((d) => d.id === 'D-0001');
  const b = await board(cwd);

  assert.equal((await post(b.p, '/api/reword', { id: 'D-0001', to: 'Deleting a project or a team asks in a dialog' })).exitCode, 0);
  assert.equal(rule()?.decision, 'Deleting a project or a team asks in a dialog');
  assert.deepEqual(readHandoff(paths)?.reworded, [{ id: 'D-0001', to: 'Deleting a project or a team asks in a dialog' }], 'the agent hears the new words');

  assert.notEqual((await post(b.p, '/api/retire', { id: 'D-0001', why: ' ' })).exitCode, 0, 'the reason is the record');
  assert.equal((await post(b.p, '/api/retire', { id: 'D-0001', why: 'Deleting undoes now' })).exitCode, 0);
  assert.deepEqual(ids(readActive(paths)), ['D-0002']);
  assert.deepEqual(readHandoff(paths)?.removed?.map((r) => [r.id, r.why]), [['D-0001', 'Deleting undoes now']], 'and that it is gone');
  assert.deepEqual(readHandoff(paths)?.reworded, [], 'not its words, now it is gone');

  assert.equal((await post(b.p, '/api/unretire', { id: 'D-0001' })).exitCode, 0);
  assert.deepEqual(readHandoff(paths)?.removed, [], 'put back before the agent heard: it never hears of it');
  assert.deepEqual(readHandoff(paths)?.reworded?.map((r) => r.id), ['D-0001'], 'but still hears the new words');
  assert.deepEqual(ids(readActive(paths)).sort(), ['D-0001', 'D-0002']);
  assert.equal(rule()?.decision, 'Deleting a project or a team asks in a dialog', 'as it was, new words and all');
  assert.deepEqual(ids(readArchive(paths)), ['D-0001', 'D-0002'], 'the removal is out of the record');
  assert.notEqual((await post(b.p, '/api/unretire', { id: 'D-0001' })).exitCode, 0, 'once only');
  assert.notEqual((await post(b.p, '/api/unretire', { id: 'D-0002' })).exitCode, 0, 'nothing removed here to put back');

  // Removed, and the agent hears of it before it's put back: then it hears the rule is back.
  await post(b.p, '/api/retire', { id: 'D-0002', why: 'Settings is one page now' });
  clearHandoff(paths);
  assert.equal((await post(b.p, '/api/unretire', { id: 'D-0002' })).exitCode, 0);
  assert.deepEqual(readHandoff(paths)?.rules, ['D-0002']);
  await b.close();
});

test('Download on Design rules: DECISIONS.md as it is, as a file', async () => {
  const cwd = tmp();
  record(input({ verdict: 'rule', decision: 'Deleting a project asks in a dialog', scope: 'pattern:destructive' }), { cwd, author: 'test' });
  const b = await board(cwd);
  const res = await new Promise<{ headers: http.IncomingHttpHeaders; body: string }>((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: b.p, path: '/api/decisions' }, (r) => {
      let d = '';
      r.on('data', (c) => (d += c));
      r.on('end', () => resolve({ headers: r.headers, body: d }));
    }).on('error', reject);
  });
  assert.match(String(res.headers['content-disposition']), /attachment; filename="DECISIONS.md"/);
  assert.equal(res.body, fs.readFileSync(path.join(cwd, 'DECISIONS.md'), 'utf8'));
  await b.close();
});

function post(p: number, route: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: p, path: route, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d ? JSON.parse(d) : null));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
