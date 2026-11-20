// Writes take turns: several `arbiter` commands at once, or one beside the board, each lands. And the
// agent clears only what it was handed: a fix judged while it worked waits for next time.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { queue } from '../commands/record';
import { review } from '../commands/review';
import { rules } from '../commands/rules';
import { readArchive, readPending, resolvePaths } from '../store';
import { handoffDone, readHandoff, saveAnswer, SEEN, takeHandoff } from '../handoff';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-lock-'));
const CLI = path.join(__dirname, '..', 'index.js');
const HOOK = path.join(__dirname, '..', '..', 'templates', 'hooks', 'arbiter-board.cjs');
const item = (i: number) => JSON.stringify({ trigger: `Screen ${i}`, change: `Buttons on screen ${i} are blue`, decision: `Buttons on screen ${i} are blue`, rationale: 'Matches the brand', dimension: 'visual', level: 'pattern', class: 'judgment', scope: `pattern:button-${i}` });
const run = (cwd: string, args: string[]): Promise<string> => new Promise((resolve) => {
  const p = spawn(process.execPath, [CLI, ...args], { cwd });
  let out = '';
  p.stdout.on('data', (c) => (out += c));
  p.on('close', () => resolve(out));
});
const runHook = (cwd: string): string => execFileSync(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_PROJECT_DIR: cwd }, input: '{}' }).toString();

test('six `record --pending` at once: six in the queue, six ids, no lock left behind', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'arbiter.json'), JSON.stringify({ version: 1, destination: 'local' }));
  const outs = await Promise.all([1, 2, 3, 4, 5, 6].map((i) => run(cwd, ['record', '--pending', item(i)])));
  const ids = outs.map((o) => JSON.parse(o).id as string).sort();
  assert.deepEqual(ids, ['P-0001', 'P-0002', 'P-0003', 'P-0004', 'P-0005', 'P-0006']);
  assert.equal(readPending(resolvePaths(cwd)).length, 6);
  assert.ok(!fs.existsSync(path.join(cwd, '.arbiter', '.lock')));
  assert.deepEqual(fs.readdirSync(path.join(cwd, '.arbiter')).filter((f) => f.endsWith('.tmp')), [], 'no half-written files left');
});

test('a lock left by a process that died is cleared, and the write goes ahead', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'arbiter.json'), JSON.stringify({ version: 1, destination: 'local' }));
  fs.mkdirSync(path.join(cwd, '.arbiter'));
  const lock = path.join(cwd, '.arbiter', '.lock');
  fs.writeFileSync(lock, '999999\n');
  const minuteAgo = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, minuteAgo, minuteAgo); // held a minute: no write takes that long
  const out = JSON.parse(await run(cwd, ['record', '--pending', item(1)]));
  assert.equal(out.id, 'P-0001');
});

test('a lock held now is waited for, never taken: the write goes once it is let go', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'arbiter.json'), JSON.stringify({ version: 1, destination: 'local' }));
  fs.mkdirSync(path.join(cwd, '.arbiter'));
  const lock = path.join(cwd, '.arbiter', '.lock');
  fs.writeFileSync(lock, '999999\n'); // fresh, whoever wrote it
  const writing = run(cwd, ['record', '--pending', item(1)]);
  await new Promise((r) => setTimeout(r, 700));
  assert.ok(!fs.existsSync(path.join(cwd, '.arbiter', 'pending.md')), 'still waiting its turn');
  fs.rmSync(lock);
  assert.equal(JSON.parse(await writing).id, 'P-0001');
});

test('the board and the agent writing at once: every click and every command lands', async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'arbiter.json'), JSON.stringify({ version: 1, destination: 'local' }));
  for (let i = 1; i <= 6; i++) queue(item(i), { cwd, author: 'test' });
  const port = 47700 + Math.floor(Math.random() * 200); // below 49152, where Windows hands out its own ports
  const done = review({ cwd, port, open: false, grace: 0 });
  await new Promise((r) => setTimeout(r, 200));
  const judge = (id: string) => post(port, '/api/judge', { id, as: 'accept' });
  try {
    const [clicks, agent] = await Promise.all([
      Promise.all(['P-0001', 'P-0002', 'P-0003', 'P-0004', 'P-0005', 'P-0006'].map(judge)),
      Promise.all([7, 8, 9, 10].map((i) => run(cwd, ['record', '--pending', item(i)]))),
    ]);
    assert.deepEqual(clicks.map((c) => c.exitCode), [0, 0, 0, 0, 0, 0]);
    const pending = readPending(resolvePaths(cwd));
    assert.deepEqual(pending.map((d) => d.trigger).sort(), ['Screen 10', 'Screen 7', 'Screen 8', 'Screen 9'], "the agent's four, and none judged comes back");
    assert.equal(new Set(agent.map((o) => JSON.parse(o).id)).size, 4);
    const judged = readArchive(resolvePaths(cwd));
    assert.equal(judged.length, 6);
    assert.equal(new Set(judged.map((d) => d.id)).size, 6, 'six decisions, six ids');
  } finally {
    await post(port, '/api/bye', { page: 't' });
    await done;
  }
});

test('the agent clears what it was handed, and a fix judged while it worked waits for next time', () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  saveAnswer(paths, { kind: 'decision', pending: 'P-0001', as: 'fix', id: 'D-0001', change: 'Save at the bottom', to: 'Save at the top' });
  assert.match(runHook(cwd), /D-0001/, 'the hook hands it over');
  assert.ok(fs.existsSync(path.join(paths.archiveDir, SEEN)));
  // While the agent works on D-0001, another fix comes in from the board.
  saveAnswer(paths, { kind: 'decision', pending: 'P-0002', as: 'fix', id: 'D-0002', change: 'Tabs on settings', to: 'One page' });
  assert.deepEqual(handoffDone(paths), { status: 'done', left: 1 });
  assert.deepEqual(readHandoff(paths)!.todo.map((t) => t.id), ['D-0002'], 'only what it was handed is gone');
  const again = runHook(cwd);
  assert.match(again, /D-0002/);
  assert.doesNotMatch(again, /D-0001/, 'made already: not said again');
  assert.deepEqual(handoffDone(paths), { status: 'done', left: 0 });
  assert.equal(readHandoff(paths), null, 'all made: the file goes');
});

test('done before anything was handed over clears nothing; /arbiter hands it over as the hook does', () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  saveAnswer(paths, { kind: 'decision', pending: 'P-0001', as: 'fix', id: 'D-0001', change: 'A', to: 'B' });
  assert.equal(handoffDone(paths).status, 'not-taken');
  assert.equal(readHandoff(paths)!.todo.length, 1, 'still waiting');
  const q = JSON.parse(rules(undefined, { cwd, pending: true, json: true }));
  assert.equal(q.lastReview.done, 'npx arbiter review --done');
  assert.deepEqual(handoffDone(paths), { status: 'done', left: 0 });
  assert.equal(takeHandoff(paths), null);
});

function post(port: number, p: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d ? JSON.parse(d) : {}));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
