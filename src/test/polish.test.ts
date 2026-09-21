import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { record, retire, queue } from '../commands/record';
import { addCandidate, updateCandidate } from '../commands/candidate';
import { review } from '../commands/review';
import { drift } from '../commands/drift';
import { rules } from '../commands/rules';
import { readActive, readArchive, resolvePaths } from '../store';
import { verify } from '../verify';
import { readCandidates } from '../candidates';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-polish-'));
const write = (cwd: string, rel: string, text: string) => { fs.mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), text); };
const rule = (over: Record<string, unknown> = {}) => JSON.stringify({ decision: 'Modals for destructive actions', rationale: 'r', trigger: 't', scope: 'pattern:destructive', dimension: 'interaction', class: 'judgment', verdict: 'rule', ...over });

test('retire drops a rule with no replacement; archive keeps both; status reads retired', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(rule(), o);
  assert.equal(retire('D-0001', undefined, o).exitCode, 1, 'why is required');
  assert.equal(retire('D-0009', 'x', o).exitCode, 1, 'must be active');
  const r = retire('D-0001', 'Component library handles it now', o);
  assert.equal(r.exitCode, 0);
  assert.equal(r.output.verdict, 'retire');
  assert.equal(r.output.supersedes, 'D-0001');
  const p = resolvePaths(cwd);
  assert.equal(readActive(p).length, 0);
  assert.equal(readArchive(p).length, 2);
  assert.ok(rules('D-0001', { cwd }).includes('retired by D-0002'));
  assert.ok(rules(undefined, { cwd, archive: true }).includes('retired by D-0002'));
  assert.equal(retire('D-0001', 'again', o).exitCode, 1, 'cannot retire twice');
});

test('regex: needles work in verify and sweep', () => {
  const cwd = tmp();
  write(cwd, 'a.css', 'color: #3b7be0;');
  const r = verify(cwd, ['a.css'], { absent: ['regex:#[0-9a-fA-F]{6}\\b'] });
  assert.equal(r.ok, false);
  assert.ok(verify(cwd, ['a.css'], { present: ['regex:color:\\s*#'] }).ok);
  const rec = record(rule({ class: 'mechanical', dimension: 'visual', scope: 'global', expect: { absent: ['regex:#[0-9a-fA-F]{6}\\b'] } }), { cwd, author: 'test' });
  assert.equal((rec.output.sweep as { violations: number }).violations, 1);
});

test('drift counts accepts and rule breaks per screen', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  write(cwd, 'src/Badge.tsx', '"#3B7BE0"');
  write(cwd, 'src/Card.tsx', 'brand-500');
  record(rule({ class: 'mechanical', dimension: 'visual', scope: 'global', expect: { absent: ['#3B7BE0'] }, files: ['src/Card.tsx'] }), o);
  addCandidate('Billing', { ...o, feature: 'billing' });
  record(rule({ verdict: 'accept', class: 'mechanical', dimension: 'visual', scope: 'file:src/Badge.tsx', files: ['src/Badge.tsx'] }), { ...o, candidate: 'C-0001' });
  const j = JSON.parse(drift({ cwd, json: true }));
  assert.equal(j.screens[0].accepts, 1);
  assert.deepEqual(j.screens[0].broken.map((b: { id: string }) => b.id), ['D-0001']);
  assert.ok(drift({ cwd }).includes('1 rule broken'));
});

test('review page serves candidates, snapshots, and candidate actions', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  write(cwd, 'shot.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  addCandidate('A', { ...o, feature: 'f', snapshot: 'shot.svg' });
  addCandidate('B', { ...o, feature: 'f' });
  queue(rule(), { ...o, candidate: 'C-0001' });
  const port = 48000 + Math.floor(Math.random() * 1000);
  const done = review({ cwd, port, open: false });
  await new Promise((r) => setTimeout(r, 200));

  const state = await get(port, '/api/state');
  assert.equal(state.candidates.length, 2);
  assert.equal(state.pending[0].snapshotUrl, '/snapshots/C-0001.svg');
  assert.equal(state.pending[0].candidateName, 'A');
  assert.equal((await getRaw(port, '/snapshots/C-0001.svg')).status, 200);
  assert.equal((await getRaw(port, '/snapshots/../arbiter.json')).status, 404);

  const up = await post(port, '/api/candidate', { id: 'C-0001', state: 'approved', why: 'because' });
  assert.equal(up.exitCode, 0);
  assert.deepEqual(up.superseded, ['C-0002']);
  assert.equal(readCandidates(resolvePaths(cwd))[1].reason, 'because');

  await post(port, '/api/done', {});
  await done;
});

function getRaw(port: number, p: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => { res.resume(); res.on('end', () => resolve({ status: res.statusCode! })); }).on('error', reject);
  });
}
function get(port: number, p: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))); }).on('error', reject);
  });
}
function post(port: number, p: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => { let d = ''; res.on('data', (c) => (d += c)); res.on('end', () => resolve(JSON.parse(d))); });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('export writes a self-contained folder: index.html, snapshots, stakeholder view only', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  write(cwd, 'shot.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  addCandidate('Settings — single <page>', { ...o, feature: 'settings', snapshot: 'shot.svg' });
  addCandidate('Settings — tabs', { ...o, feature: 'settings' });
  addCandidate('Billing', { ...o, feature: 'billing' });
  record(rule({ change: 'Danger zone is at the bottom', decision: 'Destructive settings live last', rejected: ['Tabs — hid it'] }), { ...o, candidate: 'C-0001' });
  record(rule({ decision: 'h-9', level: 'polish', scope: 'file:x', verdict: 'accept' }), { ...o, candidate: 'C-0001' });
  queue(rule({ decision: 'Pending thing', scope: 'pattern:pending' }), { ...o, candidate: 'C-0001' });
  updateCandidate('C-0001', { ...o, state: 'approved', why: 'tabs hid it' });
  const { exportBoard } = require('../commands/export') as typeof import('../commands/export');

  const r = exportBoard({ cwd, includeRules: true });
  assert.equal(r.candidates, 3);
  assert.equal(r.snapshots, 1);
  const html = fs.readFileSync(r.index, 'utf8');
  assert.ok(fs.existsSync(path.join(r.dir, 'snapshots', 'C-0001.svg')));
  assert.ok(html.includes('Settings — single &lt;page&gt;'), 'escaped');
  assert.ok(html.includes('Superseded by Settings — single &lt;page&gt;'));
  assert.ok(html.includes('Danger zone is at the bottom'), 'Change text, not rule text');
  assert.ok(html.includes('over Tabs'));
  assert.ok(!html.includes('h-9'), 'polish omitted');
  assert.ok(!html.includes('Pending thing'), 'pending omitted');
  assert.ok(html.includes('Standing rules'));
  assert.ok(!html.includes('Make it a rule'), 'no verdict controls');

  const one = exportBoard({ cwd, feature: 'billing', out: 'out-billing' });
  assert.equal(one.candidates, 1);
  assert.ok(!fs.readFileSync(one.index, 'utf8').includes('Settings'));
});
