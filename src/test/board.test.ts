import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { queue, record } from '../commands/record';
import { review } from '../commands/review';
import { buildManifest } from '../hosted';
import { resolvePaths } from '../store';
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

test('the local board: the publish manifest with pictures as links, what waits for review, and its pages', async () => {
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
  assert.equal(data.pending, 2, 'but the queue counts it');
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
