/**
 * 0.2: identity per person, the update notice + `arbiter update`, publish --on-push.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { execFileSync } from 'node:child_process';
import { init, selfVersion, skillMarker, SKILL_MARKER } from '../commands/init';
import { queue, record } from '../commands/record';
import { rules } from '../commands/rules';
import { addCandidate } from '../commands/candidate';
import { publish, WORKFLOW_FILE } from '../commands/publish';
import { update, updateStatus } from '../commands/update';
import { readArchive, resolvePaths, writeConfig } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-02-'));
const git = (cwd: string, ...args: string[]) => execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
const decision = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Destructive actions confirm in a modal', rationale: 'r', trigger: 'Delete flow', scope: 'pattern:destructive-confirm', class: 'judgment', dimension: 'interaction', verdict: 'rule', ...over });

// ── 1. identity ────────────────────────────────────────────────────────────

test('author is whoever is at the keyboard: git user.name beats the committed arbiter.json author', () => {
  const cwd = tmp();
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', author: 'Edmond' });
  git(cwd, 'init', '-q');
  git(cwd, 'config', 'user.name', 'Sam');
  git(cwd, 'config', 'user.email', 'sam@example.com');

  assert.equal(record(decision(), { cwd }).exitCode, 0);
  assert.equal(readArchive(resolvePaths(cwd))[0].author, 'Sam');
  const c = addCandidate('Settings', { cwd });
  assert.equal(c.output.author, undefined); // not echoed — read the file
  assert.ok(fs.readFileSync(path.join(cwd, '.arbiter', 'candidates', 'C-0001.md'), 'utf8').includes('**Author:** Sam'));

  // --author still overrides — an agent recording on someone's behalf.
  record(decision({ scope: 'pattern:other', decision: 'Something else entirely' }), { cwd, author: 'Agent' });
  assert.equal(readArchive(resolvePaths(cwd))[1].author, 'Agent');
});

test('with no git identity at all, arbiter.json author is the fallback', () => {
  const cwd = tmp();
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', author: 'Edmond' });
  // Hide the machine's global/system git config so `git config user.name` comes back empty.
  const saved = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_SYSTEM };
  process.env.GIT_CONFIG_GLOBAL = path.join(cwd, 'no-such-gitconfig');
  process.env.GIT_CONFIG_SYSTEM = path.join(cwd, 'no-such-gitconfig');
  try {
    assert.equal(record(decision(), { cwd }).exitCode, 0);
    assert.equal(readArchive(resolvePaths(cwd))[0].author, 'Edmond');
  } finally {
    if (saved.g === undefined) delete process.env.GIT_CONFIG_GLOBAL; else process.env.GIT_CONFIG_GLOBAL = saved.g;
    if (saved.s === undefined) delete process.env.GIT_CONFIG_SYSTEM; else process.env.GIT_CONFIG_SYSTEM = saved.s;
  }
});

// ── 4. update ──────────────────────────────────────────────────────────────

test('init stamps the skill file; a stale stamp surfaces as `update` in the queue JSON; `update` refreshes it and nothing else', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.claude'));
  await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  const skill = path.join(cwd, '.claude', 'skills', 'arbiter', 'SKILL.md');
  const p = resolvePaths(cwd);
  assert.equal(SKILL_MARKER.exec(fs.readFileSync(skill, 'utf8'))?.[1], selfVersion());
  assert.deepEqual(updateStatus(p), { cli: selfVersion(), skill: selfVersion(), file: '.claude/skills/arbiter/SKILL.md', stale: false });
  assert.equal(queue(decision(), { cwd }).output.update, undefined, 'current → no notice');

  // Someone bumped the package but never re-ran init: the skill file is behind.
  fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace(skillMarker(selfVersion()), skillMarker('0.0.1')));
  assert.equal(updateStatus(p)?.stale, true);
  const q = queue(decision({ scope: 'pattern:two', decision: 'Another' }), { cwd });
  assert.deepEqual(q.output.update, { skill: '0.0.1', cli: selfVersion(), command: 'npx arbiter update' });
  assert.deepEqual(JSON.parse(rules(undefined, { cwd, pending: true, json: true })).update, q.output.update, 'the /arbiter read carries it too');

  // A pre-0.2 skill file has no marker at all: stale, reported as such.
  fs.writeFileSync(skill, fs.readFileSync(skill, 'utf8').replace(/<!-- arbiter skill \S+ -->\n/, ''));
  assert.deepEqual(updateStatus(p), { cli: selfVersion(), skill: null, file: '.claude/skills/arbiter/SKILL.md', stale: true });
  assert.equal((queue(decision({ scope: 'pattern:three', decision: 'Third' }), { cwd }).output.update as { skill: string }).skill, 'before 0.2');

  // A workflow from publish --on-push pins a version; update re-pins it.
  fs.mkdirSync(path.join(cwd, '.github', 'workflows'), { recursive: true });
  fs.writeFileSync(path.join(cwd, WORKFLOW_FILE), '      - run: npx --yes arbiterdesign@0.0.1 publish\n');

  const configBefore = fs.readFileSync(p.config, 'utf8');
  const decisionsBefore = fs.readFileSync(p.decisions, 'utf8');
  const check = await update({ cwd, check: true });
  assert.equal(check.steps.length, 0, '--check changes nothing');
  assert.equal(check.before.stale, true);

  const r = await update({ cwd, skipInstall: true });
  assert.ok(r.ok, JSON.stringify(r.steps));
  assert.deepEqual(r.steps.map((s) => [s.step, s.outcome]), [['package', 'skipped'], ['skill', 'done'], ['workflow', 'done']]);
  assert.equal(r.after.stale, false);
  assert.equal(SKILL_MARKER.exec(fs.readFileSync(skill, 'utf8'))?.[1], selfVersion());
  assert.ok(fs.readFileSync(path.join(cwd, WORKFLOW_FILE), 'utf8').includes(`arbiterdesign@${selfVersion()} publish`));
  assert.equal(fs.readFileSync(p.config, 'utf8'), configBefore, 'arbiter.json untouched');
  assert.equal(fs.readFileSync(p.decisions, 'utf8'), decisionsBefore, 'DECISIONS.md untouched');
  assert.equal(queue(decision({ scope: 'pattern:four', decision: 'Fourth' }), { cwd }).output.update, undefined, 'notice gone');
});

// ── 5. on-push ─────────────────────────────────────────────────────────────

/** Just enough of the hosted service: create, upload, board. Records whether a project was created. */
function fakeService(): Promise<{ url: string; created: number; close: () => void }> {
  const state = { created: 0 };
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      await new Promise<void>((r) => { req.on('data', () => {}); req.on('end', () => r()); });
      const send = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (req.method === 'POST' && req.url === '/api/projects') { state.created++; return send(201, { id: 'p1', slug: 'abc', token: 'tok', url: 'http://x/p/abc' }); }
      if (req.method === 'PUT' && req.url?.endsWith('/board')) return send(200, { ok: true, candidates: 0, url: 'http://x/p/abc' });
      send(404, {});
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, get created() { return state.created; }, close: () => server.close() });
    });
  });
}

test('publish --on-push writes the workflow once and says how to set the secret', async () => {
  const svc = await fakeService();
  try {
    const cwd = tmp();
    writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', author: 'test' });
    const r = await publish({ cwd, to: svc.url, onPush: true });
    assert.ok(r.ok, JSON.stringify(r.steps));
    const byStep = Object.fromEntries(r.steps.map((s) => [s.step, s]));
    assert.equal(byStep.workflow.outcome, 'done');
    assert.equal(byStep.secret.outcome, 'skipped');
    assert.ok(byStep.secret.note?.includes('ARBITER_PUBLISH_TOKEN'), 'the manual instruction names the secret');

    const wf = fs.readFileSync(path.join(cwd, WORKFLOW_FILE), 'utf8');
    assert.ok(wf.includes('branches: [main]'), 'not a git repo → default branch');
    assert.ok(wf.includes(`npx --yes arbiterdesign@${selfVersion()} publish`), 'pinned to this version');
    assert.ok(wf.includes('ARBITER_PUBLISH_TOKEN: ${{ secrets.ARBITER_PUBLISH_TOKEN }}'), 'the secret reaches publish');
    assert.ok(wf.includes("'.arbiter/**'"), 'triggers on decisions');
    assert.ok(wf.includes('concurrency:'), 'two pushes do not race');

    const again = await publish({ cwd, to: svc.url, onPush: true });
    assert.equal(again.steps.find((s) => s.step === 'workflow')?.outcome, 'skipped', 'second run leaves it');

    fs.appendFileSync(path.join(cwd, WORKFLOW_FILE), '# my edit\n');
    const edited = await publish({ cwd, to: svc.url, onPush: true });
    assert.ok(edited.steps.find((s) => s.step === 'workflow')?.note?.includes('leaving your edits'));
  } finally {
    svc.close();
  }
});

test('under CI, publish never creates a board — it refuses without a committed hosted.json', async () => {
  const svc = await fakeService();
  const saved = process.env.CI;
  process.env.CI = 'true';
  try {
    const cwd = tmp();
    writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', author: 'test' });
    const r = await publish({ cwd, to: svc.url });
    assert.equal(r.ok, false);
    assert.equal(r.steps[0].outcome, 'failed');
    assert.ok(r.steps[0].note?.includes('hosted.json'), r.steps[0].note);
    assert.equal(svc.created, 0, 'no project minted');
  } finally {
    if (saved === undefined) delete process.env.CI; else process.env.CI = saved;
    svc.close();
  }
});
