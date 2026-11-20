// What a release check turned up: a planted picture, an export that reached outside its folder or
// wiped someone's own, and an init that stopped ignoring what the board hands the agent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { addCandidate } from '../commands/candidate';
import { review } from '../commands/review';
import { exportBoard } from '../commands/export';
import { init } from '../commands/init';
import { candidateFile, readCandidates } from '../candidates';
import { resolvePaths } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-safety-'));
const write = (cwd: string, rel: string, text: string) => { fs.mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>fetch("/api/reword")</script></svg>';

function head(port: number, p: string): Promise<{ status: number; headers: http.IncomingHttpHeaders }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers })); }).on('error', reject);
  });
}
function bye(port: number): Promise<void> {
  return new Promise((resolve) => {
    const req = http.request({ host: '127.0.0.1', port, path: '/api/bye', method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { res.resume(); res.on('end', () => resolve()); });
    req.on('error', () => resolve());
    req.end(JSON.stringify({ page: 't' }));
  });
}

test('a picture is served sandboxed: an SVG opened on its own runs nothing as the board', async () => {
  const cwd = tmp();
  write(cwd, 'shot.svg', SVG);
  addCandidate('A', { cwd, author: 'test', feature: 'f', snapshot: 'shot.svg' });
  const port = 47100 + Math.floor(Math.random() * 500); // below 49152, where Windows hands out its own ports
  const done = review({ cwd, port, open: false, grace: 0 });
  await new Promise((r) => setTimeout(r, 200));
  const r = await head(port, '/snapshots/C-0001.svg');
  assert.equal(r.status, 200);
  assert.match(String(r.headers['content-security-policy']), /^sandbox;/);
  assert.match(String(r.headers['content-security-policy']), /default-src 'none'/);
  assert.equal(r.headers['x-content-type-options'], 'nosniff');
  await bye(port);
  await done;
});

test('a card names only its own picture: a path out of the folder is no picture, and export copies nothing from it', () => {
  const cwd = tmp();
  addCandidate('A', { cwd, author: 'test', feature: 'f' });
  const paths = resolvePaths(cwd);
  write(cwd, '.arbiter/hosted.token', 'secret');
  const file = candidateFile(paths, 'C-0001');
  const md = fs.readFileSync(file, 'utf8').replace(/^(# C-0001 · .*)$/m, '$1\n\n![A](../hosted.token)');
  fs.writeFileSync(file, md);
  assert.equal(readCandidates(paths)[0].snapshot, null);
  const r = exportBoard({ cwd });
  assert.ok(!fs.existsSync(path.join(r.dir, 'hosted.token')), 'the token stays where it was');
  assert.equal(r.snapshots, 0);
});

test("export clears only its own pictures: someone's own files in snapshots/ stay, a removed screen's go", () => {
  const cwd = tmp();
  write(cwd, 'shot.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  addCandidate('A', { cwd, author: 'test', feature: 'f', snapshot: 'shot.svg' });
  write(cwd, 'site/snapshots/hero.png', 'mine');
  write(cwd, 'site/snapshots/C-0099.png', 'from an earlier export, its screen since removed');
  exportBoard({ cwd, out: 'site' });
  exportBoard({ cwd, out: 'site' });
  assert.equal(fs.readFileSync(path.join(cwd, 'site/snapshots/hero.png'), 'utf8'), 'mine');
  assert.ok(fs.existsSync(path.join(cwd, 'site/snapshots/C-0001.svg')));
  assert.ok(!fs.existsSync(path.join(cwd, 'site/snapshots/C-0099.png')));
});

test('init keeps .arbiter/.gitignore whole: the token, the handoff, and lines someone added', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.claude'));
  write(cwd, '.arbiter/.gitignore', 'hosted.token\nlast-review.json\nmy-notes.md\n');
  await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  const lines = fs.readFileSync(path.join(cwd, '.arbiter/.gitignore'), 'utf8').split('\n').filter(Boolean);
  assert.deepEqual(lines, ['hosted.token', 'last-review.json', 'my-notes.md']);

  const fresh = tmp();
  fs.mkdirSync(path.join(fresh, '.claude'));
  await init({ cwd: fresh, yes: true, skipInstall: true, author: 'test' });
  assert.deepEqual(fs.readFileSync(path.join(fresh, '.arbiter/.gitignore'), 'utf8').split('\n').filter(Boolean), ['hosted.token', 'last-review.json']);
});
