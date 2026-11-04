/**
 * The live board: open beside the work, not a sitting. It redraws when the files change, hands
 * each answer over as it's given, stops when its last tab closes, and in Claude Code a hook tells
 * the agent with your next message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { queue } from '../commands/record';
import { review, steadyPort } from '../commands/review';
import { resolvePaths } from '../store';
import { clearHandoff, readHandoff, saveAnswer } from '../handoff';
import { HOOK_COMMAND, hookInstalled, installHook } from '../hook';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-live-'));
const o = (cwd: string) => ({ cwd, author: 'test' });
const input = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Save sits bottom-right', change: 'Save moved to the bottom right', rationale: 'r', trigger: 'Settings build', scope: 'pattern:save', dimension: 'structure', class: 'judgment', ...over });
const port = () => 44900 + Math.floor(Math.random() * 900); // below 49152, where Windows hands out its own ports
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const HOOK = path.join(__dirname, '..', '..', 'templates', 'hooks', 'arbiter-board.cjs');
const runHook = (cwd: string): string => execFileSync(process.execPath, [HOOK], { env: { ...process.env, CLAUDE_PROJECT_DIR: cwd }, input: '{}' }).toString();

test('the page sees the board change when the agent records, and only then', async () => {
  const cwd = tmp();
  queue(input(), o(cwd));
  const p = port();
  const done = review({ cwd, port: p, open: false, grace: 0 });
  await wait();
  const first = (await get(p, '/api/stamp?page=a')).stamp;
  assert.equal((await get(p, '/api/stamp?page=a')).stamp, first, 'nothing changed');

  // The handoff isn't the board: an answer kept for the agent alone doesn't redraw it.
  saveAnswer(resolvePaths(cwd), { kind: 'decision', pending: 'P-0009', as: 'fix', id: 'D-0009', change: 'x', to: 'y' });
  assert.equal((await get(p, '/api/stamp?page=a')).stamp, first);

  await wait(20);
  queue(input({ decision: 'Tabs on settings', change: 'Settings has tabs', scope: 'pattern:tabs' }), o(cwd));
  assert.notEqual((await get(p, '/api/stamp?page=a')).stamp, first, 'the agent recorded something: redraw');

  await post(p, '/api/bye', { page: 'a' });
  await done;
});

test('each answer is handed over as it is given, and what the agent took is not handed over again', async () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  queue(input(), o(cwd)); // P-0001
  queue(input({ decision: 'Tabs on settings', change: 'Settings has tabs', scope: 'pattern:tabs' }), o(cwd)); // P-0002
  const p = port();
  const done = review({ cwd, port: p, open: false, grace: 0 });
  await wait();

  await post(p, '/api/judge', { id: 'P-0001', as: 'fix', to: 'Save stays at the top' });
  assert.deepEqual(readHandoff(paths)?.todo.map((t) => (t as { to: string }).to), ['Save stays at the top'], 'there for the agent at once');

  // The agent takes it with the user's next message, makes it, and deletes the file, all while the board stays open.
  clearHandoff(paths);
  await post(p, '/api/judge', { id: 'P-0002', as: 'fix', to: 'Settings stays one page' });
  assert.deepEqual(readHandoff(paths)?.todo.map((t) => (t as { to: string }).to), ['Settings stays one page'], 'only what is new');

  await post(p, '/api/bye', { page: 't' });
  const sitting = await done;
  assert.equal(sitting.fixed.length, 2, 'the terminal hears about the whole sitting');
});

test('the board stops when its last tab closes, and a reload in between keeps it open', async () => {
  const cwd = tmp();
  const p = port();
  let stopped = false;
  const done = review({ cwd, port: p, open: false, grace: 300 }).then(() => (stopped = true));
  await wait();
  await get(p, '/api/stamp?page=a');
  await get(p, '/api/stamp?page=b');

  await post(p, '/api/bye', { page: 'a' });
  await wait(400);
  assert.equal(stopped, false, 'another tab is still open');

  await post(p, '/api/bye', { page: 'b' });
  await wait(100);
  await get(p, '/api/stamp?page=c'); // b reloaded, as c
  await wait(400);
  assert.equal(stopped, false, 'a reload comes back within the grace');

  await post(p, '/api/bye', { page: 'c' });
  await done;
  assert.equal(stopped, true, 'the last tab closed');
});

test('the hook tells the agent once, and again only when something new arrives', () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  assert.equal(runHook(cwd), '', 'nothing on the board: nothing said');

  // Confirming needs nothing from the agent.
  saveAnswer(paths, { kind: 'decision', pending: 'P-0001', as: 'accept', id: 'D-0001' });
  assert.equal(runHook(cwd), '');

  saveAnswer(paths, { kind: 'decision', pending: 'P-0002', as: 'fix', id: 'D-0002', change: 'Save moved to the bottom right', to: 'Save stays at the top' });
  const said = JSON.parse(runHook(cwd)).hookSpecificOutput;
  assert.equal(said.hookEventName, 'UserPromptSubmit');
  assert.match(said.additionalContext, /One change waits for you/);
  assert.match(said.additionalContext, /D-0002: they corrected it\. The code still does "Save moved to the bottom right"; make it do "Save stays at the top"\./);
  assert.match(said.additionalContext, /delete \.arbiter\/last-review\.json/);
  assert.equal(runHook(cwd), '', 'told once');

  saveAnswer(paths, { kind: 'decision', pending: 'P-0003', as: 'rule', id: 'D-0003' });
  const again = JSON.parse(runHook(cwd)).hookSpecificOutput.additionalContext;
  assert.match(again, /D-0002/, 'still waiting, so said again with the new one');
  assert.match(again, /New rules in DECISIONS\.md, in force from now: D-0003/);
});

test('the hook tells the agent about rules edited or removed on Design rules', () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  saveAnswer(paths, { kind: 'reword', id: 'D-0001', to: 'Status pills are outlined' });
  saveAnswer(paths, { kind: 'reword', id: 'D-0001', to: 'Status pills are outlined, filter pills filled' });
  saveAnswer(paths, { kind: 'retire', id: 'D-0002', rule: 'Tabs on settings', why: 'Settings is one page now' });
  const said = JSON.parse(runHook(cwd)).hookSpecificOutput.additionalContext;
  assert.match(said, /D-0001 now says "Status pills are outlined, filter pills filled"/);
  assert.doesNotMatch(said, /now says "Status pills are outlined"$/m, 'only its latest words');
  assert.match(said, /Stop following them/);
  assert.match(said, /D-0002 \("Tabs on settings"\): Settings is one page now/);
  assert.doesNotMatch(said, /what you changed/, 'nothing for the code');
  assert.equal(runHook(cwd), '', 'told once');
});

test('init puts the hook beside the hooks already there, once, and leaves a hand-edited settings file alone', async () => {
  const cwd = tmp();
  const theirs = { permissions: { allow: ['Bash(npm test)'] }, hooks: { UserPromptSubmit: [{ hooks: [{ type: 'command', command: 'echo hi' }] }], Stop: [{ hooks: [{ type: 'command', command: 'say done' }] }] } };
  fs.mkdirSync(path.join(cwd, '.claude'));
  fs.writeFileSync(path.join(cwd, '.claude', 'settings.json'), JSON.stringify(theirs));

  assert.deepEqual(installHook(cwd).map((s) => s.outcome), ['created', 'updated']);
  assert.deepEqual(installHook(cwd).map((s) => s.outcome), ['unchanged', 'unchanged'], 'a second run changes nothing');
  const s = JSON.parse(fs.readFileSync(path.join(cwd, '.claude', 'settings.json'), 'utf8'));
  assert.deepEqual(s.permissions, theirs.permissions);
  assert.deepEqual(s.hooks.Stop, theirs.hooks.Stop);
  assert.deepEqual(s.hooks.UserPromptSubmit.map((e: { hooks: { command: string }[] }) => e.hooks[0].command), ['echo hi', HOOK_COMMAND]);
  assert.ok(hookInstalled(cwd));

  // The board says when the agent will hear: with the next message, now the hook is there.
  const p = port();
  const done = review({ cwd, port: p, open: false, grace: 0 });
  await wait();
  assert.equal((await get(p, '/api/state')).agent, 'next-message');
  await post(p, '/api/bye', { page: 't' });
  await done;

  const odd = tmp();
  fs.mkdirSync(path.join(odd, '.claude'));
  fs.writeFileSync(path.join(odd, '.claude', 'settings.json'), '{ // mine\n}');
  const steps = installHook(odd);
  assert.equal(steps[1].outcome, 'skipped');
  assert.equal(fs.readFileSync(path.join(odd, '.claude', 'settings.json'), 'utf8'), '{ // mine\n}');
  assert.ok(!hookInstalled(odd));
});

test('a project keeps its address, and running the board again opens the one already running', async () => {
  const cwd = tmp();
  const p = steadyPort(cwd);
  assert.equal(steadyPort(cwd), p, 'the same folder, the same port');
  assert.ok(p >= 47000 && p < 48000);
  assert.notEqual(steadyPort('/work/shop'), steadyPort('/work/blog'), 'another project, another port');

  const done = review({ cwd, open: false, grace: 0 });
  await wait();
  assert.equal((await get(p, '/api/who')).board, 'arbiter', 'at its own address, with no --port');
  await get(p, '/api/stamp?page=a');

  // Again while it runs: no second board. This one says where the first is, and is done.
  const again = await review({ cwd, open: false, grace: 0 });
  assert.equal(again.confirmed.length, 0);
  assert.ok((await get(p, '/api/stamp?page=a')).stamp, 'the first is still open');

  await post(p, '/api/bye', { page: 'a' });
  await done;
});

test('a port something else has moves the board along one, and an agent waiting gets a board of its own', async () => {
  const cwd = tmp();
  const p = steadyPort(cwd);
  const other = http.createServer((_, res) => res.end('not a board'));
  await new Promise<void>((r) => other.listen(p, '127.0.0.1', r));

  const done = review({ cwd, open: false, grace: 0 });
  await wait();
  assert.equal((await get(p + 1, '/api/who')).board, 'arbiter', 'the next port along');

  // An agent waiting on this sitting's handoff can't share the running board: it gets one further along.
  const agent = review({ cwd, open: false, grace: 0, json: true });
  await wait();
  assert.equal((await get(p + 2, '/api/who')).board, 'arbiter');

  await post(p + 2, '/api/bye', { page: 't' });
  await agent;
  await post(p + 1, '/api/bye', { page: 't' });
  await done;
  other.close();
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
