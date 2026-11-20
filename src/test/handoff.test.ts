import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { queue, record } from '../commands/record';
import { rules } from '../commands/rules';
import { review } from '../commands/review';
import { resolvePaths } from '../store';
import { handoffLine, readHandoff, summarize } from '../handoff';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-handoff-'));
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
const port = () => 44000 + Math.floor(Math.random() * 900); // below 49152, where Windows hands out its own ports
const wait = () => new Promise((r) => setTimeout(r, 200));

test('an agent waiting on the page gets what was decided and the code left to change when the last tab closes, and nothing is kept for later', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  const rule = record(input({ verdict: 'rule', decision: 'Deleting a project undoes instead of confirming', scope: 'pattern:destructive-undo', dimension: 'interaction' }), o);
  assert.equal(rule.output.id, 'D-0001');
  queue(input({ decision: 'Empty lists are one grey line', scope: 'pattern:empty', dimension: 'states' }), o); // P-0001
  queue(input({ decision: 'Save sits bottom-right', scope: 'pattern:save' }), o); // P-0002
  queue(input({ decision: 'Tabs on settings', scope: 'pattern:tabs', dimension: 'structure' }), o); // P-0003
  queue(input({ decision: 'The delete button is red', change: 'Delete turned red', scope: 'pattern:delete-colour', dimension: 'visual' }), o); // P-0004
  queue(input({ decision: 'Deleting asks to confirm in a dialog', change: 'Delete now asks in a dialog', against: 'D-0001', scope: 'pattern:destructive-confirm' }), o); // P-0005
  const paths = resolvePaths(cwd);

  const p = port();
  const done = review({ cwd, port: p, open: false, grace: 0, json: true });
  await wait();
  assert.equal((await get(p, '/api/state')).agent, 'waiting', 'the page knows an agent is waiting');

  assert.equal((await post(p, '/api/judge', { id: 'P-0001', as: 'accept' })).exitCode, 0);
  assert.equal((await post(p, '/api/judge', { id: 'P-0002', as: 'rule' })).exitCode, 0);
  assert.equal((await post(p, '/api/judge', { id: 'P-0003', as: 'skip' })).exitCode, 0);
  assert.equal((await post(p, '/api/judge', { id: 'P-0004', as: 'fix', to: 'The delete button stays grey until hovered' })).exitCode, 0);
  // Saved as it goes: an agent's command cut off here still leaves the answers for the next /arbiter.
  assert.equal(readHandoff(paths)?.todo.length, 1, 'kept after each answer');
  assert.equal((await post(p, '/api/judge', { id: 'P-0005', as: 'fix', to: 'Deleting a project undoes instead of confirming', follows: 'D-0001' })).exitCode, 0);

  await post(p, '/api/bye', { page: 't' });
  const h = await done;

  assert.equal(h.finished, 'done');
  assert.equal(h.confirmed.length, 1);
  assert.equal(h.rules.length, 1);
  assert.deepEqual(h.skipped, ['P-0003']);
  assert.equal(h.fixed.length, 2);
  assert.deepEqual(
    h.todo.map((t) => t.kind),
    ['fix', 'follow'],
  );
  assert.deepEqual(h.todo[0], { kind: 'fix', id: h.fixed[0], change: 'Delete turned red', to: 'The delete button stays grey until hovered' });
  assert.deepEqual(h.todo[1], { kind: 'follow', id: h.fixed[1], rule: 'D-0001', to: 'Deleting a project undoes instead of confirming' });
  assert.match(h.next, /don't judge or record them again/);
  assert.equal(readHandoff(paths), null, 'handed over, so not saved for the next /arbiter as well');
});

test('nobody waiting: the sitting is saved for the next /arbiter, kept out of git, and the next sitting hands both over', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  queue(input({ decision: 'The delete button is red', change: 'Delete turned red', scope: 'pattern:delete-colour', dimension: 'visual' }), o); // P-0001
  queue(input({ decision: 'Save sits bottom-right', change: 'Save moved to the bottom right', scope: 'pattern:save' }), o); // P-0002
  const paths = resolvePaths(cwd);

  let p = port();
  let done = review({ cwd, port: p, open: false, grace: 0 });
  await wait();
  assert.equal((await get(p, '/api/state')).agent, 'arbiter', 'nobody waiting, and no hook: the next /arbiter');
  await post(p, '/api/judge', { id: 'P-0001', as: 'fix', to: 'The delete button stays grey until hovered' });
  await post(p, '/api/bye', { page: 't' });
  const first = await done;
  assert.equal(handoffLine(first), 'Recorded: 1 fixed. 1 change waits for your agent, which picks it up at the next /arbiter.');

  const saved = readHandoff(paths);
  assert.equal(saved?.todo.length, 1);
  assert.ok(fs.readFileSync(path.join(paths.archiveDir, '.gitignore'), 'utf8').split('\n').includes('last-review.json'), 'one person’s, out of git');
  const q = JSON.parse(rules(undefined, { cwd, pending: true, json: true }));
  assert.equal(q.lastReview.file, '.arbiter/last-review.json');
  assert.equal(q.lastReview.todo[0].to, 'The delete button stays grey until hovered');

  // The agent opens the next sitting before acting on the first: both come to it, then the file goes.
  p = port();
  done = review({ cwd, port: p, open: false, grace: 0, json: true });
  await wait();
  await post(p, '/api/judge', { id: 'P-0002', as: 'fix', to: 'Save stays at the top' });
  await post(p, '/api/bye', { page: 't' });
  const both = await done;
  assert.deepEqual(both.todo.map((t) => (t as { to: string }).to), ['The delete button stays grey until hovered', 'Save stays at the top']);
  assert.equal(readHandoff(paths), null);
  assert.equal(JSON.parse(rules(undefined, { cwd, pending: true, json: true })).lastReview, undefined);
});

test('the handoff: requests and options, and a sitting with nothing in it', () => {
  const h = summarize(
    [
      { kind: 'request', id: 'R-0001', status: 'approved', author: 'Sam', screenName: 'Settings — billing', do: 'Move the danger zone to the bottom' },
      { kind: 'request', id: 'R-0002', status: 'declined', author: 'Priya', screenName: null, reason: 'It stays in its own tab' },
      { kind: 'option', id: 'C-0001', name: 'Settings — single page', state: 'approved' },
    ],
    'closed',
  );
  assert.deepEqual(h.todo, [{ kind: 'request', id: 'R-0001', author: 'Sam', screen: 'Settings — billing', do: 'Move the danger zone to the bottom' }]);
  assert.deepEqual(h.declined, [{ id: 'R-0002', author: 'Priya', reason: 'It stays in its own tab' }]);
  assert.equal(h.options[0].name, 'Settings — single page');
  assert.match(h.next, /--request <id>/);

  const empty = summarize([], 'done');
  assert.equal(empty.next, 'Nothing to change in the code.');
  assert.equal(handoffLine(empty), null, 'nothing to say');
});

function get(p: number, route: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: p, path: route }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}
function post(p: number, route: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: p, path: route, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
