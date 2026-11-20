import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { queue, record, retire } from '../commands/record';
import { review } from '../commands/review';
import { buildManifest } from '../hosted';
import { boardOf, liveBoard } from '../localboard';
import { readPending, resolvePaths } from '../store';
import { workDir } from '../work';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-board-'));
const input = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    decision: 'Settings is one scrolling page',
    change: 'Settings is one scrolling page with a sticky nav',
    rationale: 'Tabs hid the danger zone',
    trigger: 'Settings build',
    scope: 'pattern:settings-layout',
    dimension: 'structure',
    class: 'judgment',
    level: 'feature',
    ...over,
  });

test('the local board: its cards with pictures as links, what waits for review, and its pages', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(input({ verdict: 'rule' }), o);
  queue(input({ decision: 'Delete asks for the name', change: 'Delete asks you to type the name', scope: 'pattern:destructive-confirm', dimension: 'interaction', level: 'pattern' }), o);
  queue(input({ decision: 'Buttons line up', change: 'The buttons in the row line up', scope: 'pattern:row', dimension: 'visual', level: 'polish' }), o);
  const paths = resolvePaths(cwd);
  fs.mkdirSync(workDir(paths), { recursive: true });
  fs.writeFileSync(path.join(workDir(paths), 'W-settings-build.png'), 'not really a png');

  // Publishing still sends the bytes; the local board gets a link the review server serves.
  const inline = buildManifest(paths).manifest.candidates as { snapshot: unknown }[];
  assert.equal(typeof inline[0].snapshot, 'object');

  const p = 45800 + Math.floor(Math.random() * 200); // below 49152, where Windows hands out its own ports
  const done = review({ cwd, port: p, open: false, grace: 0 });
  await new Promise((r) => setTimeout(r, 200));

  const data = JSON.parse((await get(p, '/api/board')).body);
  assert.equal(data.board.candidates.length, 1);
  assert.equal(data.board.candidates[0].id, 'W-settings-build');
  assert.equal(data.board.candidates[0].snapshot, '/snapshots/W-settings-build.png');
  assert.equal(data.board.rules.length, 1, 'rules always, here');
  assert.deepEqual(data.waiting, { 'W-settings-build': 1 }, 'polish is never waited on');
  assert.equal(data.pending, 1, 'an old one-off fix left in a queue is not counted as waiting');
  assert.equal(data.hosted, null);
  assert.equal(data.live, true, 'served, so the queue can be judged');
  assert.equal((await get(p, data.board.candidates[0].snapshot)).status, 200);

  // The board is the page: the review queue is one of its pages now.
  const page = await get(p, '/');
  assert.equal(page.status, 200);
  assert.match(page.body, /<div id="root"><\/div>/);
  assert.equal((await get(p, '/board.js')).status, 200);
  assert.equal((await get(p, '/board.css')).status, 200);
  assert.equal((await get(p, '/board')).status, 301, 'where the board used to be');
  assert.equal((await get(p, '/board/')).status, 301);
  assert.equal((await get(p, '/review.html')).status, 404, 'the old page is gone');
  assert.equal((await get(p, '/package.json')).status, 404, 'only the board’s own files');

  await post(p, '/api/bye', { page: 't' });
  await done;
});

test('the local board builds its own data, apart from what publish uploads', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(input({ verdict: 'accept' }), o);
  // Work with nothing judged yet: only the local board shows it, as a card waiting for review.
  queue(input({ trigger: 'Reports', decision: 'Reports filter by date', change: 'Reports have a date filter', scope: 'pattern:report-filters' }), o);
  const paths = resolvePaths(cwd);
  fs.mkdirSync(workDir(paths), { recursive: true });
  fs.writeFileSync(path.join(workDir(paths), 'W-settings-build.png'), 'not really a png');

  const local = boardOf(paths, { pictures: 'snapshots/', includeRules: false, queued: readPending(paths) });
  assert.deepEqual(local.candidates.map((c) => c.id), ['W-settings-build', 'W-reports']);
  assert.equal(local.candidates[0].snapshot, 'snapshots/W-settings-build.png', 'a link where the page finds it');
  assert.deepEqual(local.candidates[1].decisions, [], 'waiting, nothing on it judged yet');
  assert.equal(local.rules, null);

  const live = liveBoard(paths);
  assert.equal(live.board.candidates[0].snapshot, '/snapshots/W-settings-build.png', 'served by `arbiter review`');
  assert.deepEqual(live.waiting, { 'W-reports': 1 });

  // Publishing is untouched: the picture's bytes, and no card for work nobody has judged.
  const up = buildManifest(paths).manifest.candidates as { id: string; snapshot: unknown }[];
  assert.deepEqual(up.map((c) => c.id), ['W-settings-build']);
  assert.equal(typeof up[0].snapshot, 'object');
});

function get(p: number, route: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: p, path: route }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: d }));
    }).on('error', reject);
  });
}
function post(p: number, route: string, body: unknown): Promise<unknown> {
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

test('an exception carries the rule it goes against to the board, with the rule’s reason', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(input({ verdict: 'rule', trigger: 'Privacy', decision: 'Settings save straight away', change: 'Privacy switches save as you flip them', rationale: 'Nothing to forget to save', scope: 'pattern:settings-autosave', dimension: 'interaction' }), o);
  record(input({ verdict: 'accept', against: 'D-0001', call: 'asked', trigger: 'Billing', decision: 'Changing plan waits for a Confirm button', change: 'Changing plan waits for a Confirm button', scope: 'file:app/billing.tsx', dimension: 'interaction' }), o);
  const board = boardOf(resolvePaths(cwd), { pictures: 'snapshots/', includeRules: false, queued: [] });
  const of = (id: string) => board.candidates.flatMap((c) => c.decisions).find((d) => d.id === id)!;
  assert.deepEqual(of('D-0002').against, { id: 'D-0001', decision: 'Settings save straight away', rationale: 'Nothing to forget to save' });
  assert.equal(of('D-0001').against, undefined, 'a rule is no exception');
});

test('a rule on Design rules carries its exceptions, and the clashes waiting against it on the live board only', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(input({ verdict: 'rule', trigger: 'Settings — Privacy', decision: 'Settings save straight away', rationale: 'Nothing to forget to save', scope: 'pattern:settings-autosave', dimension: 'interaction' }), o);
  record(input({ verdict: 'accept', against: 'D-0001', call: 'asked', trigger: 'Settings — Billing', decision: 'Changing plan waits for a Confirm button', change: 'Changing plan waits for a Confirm button', scope: 'file:app/billing.tsx', dimension: 'interaction' }), o);
  queue(input({ against: 'D-0001', trigger: 'Settings — Notifications', decision: 'Notifications save with a Save button', change: 'Notifications uses a Save button', scope: 'file:app/notifications.tsx', dimension: 'interaction' }), o);
  const paths = resolvePaths(cwd);
  const live = boardOf(paths, { pictures: '/snapshots/', includeRules: true, queued: readPending(paths) }).rules!.find((r) => r.id === 'D-0001')!;
  assert.deepEqual(live.exceptions, [{ id: 'D-0002', card: 'W-settings-billing', name: 'Settings — Billing', change: 'Changing plan waits for a Confirm button' }]);
  assert.deepEqual(live.waiting?.map((x) => [x.card, x.change]), [['W-settings-notifications', 'Notifications uses a Save button']]);
  // An export carries no queue, so nothing waits on its rules.
  const exported = boardOf(paths, { pictures: 'snapshots/', includeRules: true, queued: [] }).rules!.find((r) => r.id === 'D-0001')!;
  assert.equal(exported.exceptions?.length, 1);
  assert.deepEqual(exported.waiting, []);
});

test('Design rules keeps the rules taken out, the latest first, each saying how it left, and so does its pill', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(input({ verdict: 'rule', decision: 'An empty list shows a picture and one line', scope: 'pattern:empty-list', dimension: 'states' }), o);
  record(input({ verdict: 'rule', decision: 'Filters sit in a side panel', scope: 'pattern:filters', dimension: 'structure' }), o);
  assert.equal(retire('D-0001', 'Trying new empty states', o).exitCode, 0);
  assert.equal(record(input({ verdict: 'rule', decision: 'Filters are a row of chips', scope: 'pattern:filters', dimension: 'structure' }), { ...o, supersedes: 'D-0002' }).exitCode, 0);
  const board = boardOf(resolvePaths(cwd), { pictures: 'snapshots/', includeRules: true, queued: [] });
  assert.deepEqual(board.rules!.map((r) => r.id), ['D-0004']);
  assert.deepEqual(board.retired!.map((r) => [r.id, r.ended?.kind]), [['D-0002', 'replaced'], ['D-0001', 'retired']]);
  assert.deepEqual(board.retired![0].ended?.by, { id: 'D-0004', decision: 'Filters are a row of chips' });
  assert.equal(board.retired![1].ended?.why, 'Trying new empty states');
  // On its change's page, the decision says the same.
  const d = board.candidates.flatMap((c) => c.decisions).find((x) => x.id === 'D-0001')!;
  assert.equal(d.active, false);
  assert.equal(d.ended?.kind, 'retired');
  assert.equal(boardOf(resolvePaths(cwd), { pictures: 'snapshots/', includeRules: false, queued: [] }).retired, null, 'only with the rules');
});
