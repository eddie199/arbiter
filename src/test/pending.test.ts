import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { queue, judge, judgeAll, record } from '../commands/record';
import { groupByTrigger, rules } from '../commands/rules';
import { review } from '../commands/review';
import { setup } from '../commands/setup';
import { readActive, readArchive, readPending, resolvePaths, writeConfig } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-pending-'));
const input = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    decision: 'Sheets put the primary action bottom-right',
    rationale: 'Header actions collide with close on mobile.',
    trigger: 'Settings build',
    scope: 'pattern:sheet-actions',
    dimension: 'interaction',
    class: 'judgment',
    verdict: 'rule',
    ...over,
  });

test('queue writes to pending only; ids are P-', () => {
  const cwd = tmp();
  // The agent queues before anyone has judged — no verdict in the payload.
  const r1 = queue(input({ verdict: undefined }), { cwd, author: 'test' });
  const r2 = queue(input({ decision: 'Empty states are one line', scope: 'pattern:empty-state', dimension: 'states' }), { cwd, author: 'test' });
  assert.equal(r1.output.id, 'P-0001');
  assert.equal(r2.output.id, 'P-0002');
  const p = resolvePaths(cwd);
  assert.equal(readPending(p).length, 2);
  assert.equal(readArchive(p).length, 0);
  assert.equal(readActive(p).length, 0);
  assert.equal(readPending(p)[0].verdict, 'pending');
});

test('judge: rule, accept, skip, fix', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  queue(input(), o);
  queue(input({ decision: 'Two', scope: 'pattern:two' }), o);
  queue(input({ decision: 'Three', scope: 'pattern:three' }), o);
  queue(input({ decision: 'Four', scope: 'pattern:four' }), o);
  const p = resolvePaths(cwd);

  const r = judge('P-0001', { ...o, as: 'rule' });
  assert.equal(r.exitCode, 0);
  assert.equal(r.output.id, 'D-0001');
  assert.equal(r.output.judged, 'P-0001');
  assert.equal(readActive(p).length, 1);

  const a = judge('P-0002', { ...o, as: 'accept' });
  assert.equal(a.output.verdict, 'accept');
  assert.equal(readActive(p).length, 1);

  const s = judge('P-0003', { ...o, as: 'skip' });
  assert.equal(s.output.status, 'skipped');

  const f = judge('P-0004', { ...o, as: 'fix', to: 'Four, corrected' });
  assert.equal(f.output.verdict, 'fix');
  const fixed = readArchive(p).find((d) => d.id === f.output.id)!;
  assert.equal(fixed.decision, 'Four, corrected');
  assert.ok(fixed.rejected[0].startsWith('Four — corrected by test'));

  assert.equal(readPending(p).length, 0);
  assert.equal(readArchive(p).length, 3, 'skip is recorded nowhere');
});

test('judge as rule with overlap leaves it pending until answered', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  record(input(), o);
  queue(input({ decision: 'Sheets put the primary action bottom-right and sticky' }), o);
  const p = resolvePaths(cwd);

  const r = judge('P-0001', { ...o, as: 'rule' });
  assert.equal(r.exitCode, 2);
  assert.equal(readPending(p).length, 1, 'still pending');

  const r2 = judge('P-0001', { ...o, as: 'rule', supersedes: 'D-0001' });
  assert.equal(r2.exitCode, 0);
  assert.equal(readPending(p).length, 0);
  assert.deepEqual(readActive(p).map((d) => d.id), ['D-0002']);
});

test('judge rejects unknown or malformed ids and fix without --to', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  queue(input(), o);
  assert.equal(judge('P-0009', { ...o, as: 'rule' }).exitCode, 1);
  assert.equal(judge('D-0001', { ...o, as: 'rule' }).exitCode, 1);
  assert.equal(judge('P-0001', { ...o, as: 'fix' }).exitCode, 1);
  assert.equal(readPending(resolvePaths(cwd)).length, 1);
});

test('review server: state, judge, done', async () => {
  const cwd = tmp();
  queue(input(), { cwd, author: 'test' });
  const port = 47000 + Math.floor(Math.random() * 1000);
  const done = review({ cwd, port, open: false });
  await new Promise((r) => setTimeout(r, 200));

  const state = await get(port, '/api/state');
  assert.equal(state.pending.length, 1);
  assert.equal(state.pending[0].id, 'P-0001');

  const judged = await post(port, '/api/judge', { id: 'P-0001', as: 'rule' });
  assert.equal(judged.exitCode, 0);
  assert.equal(judged.id, 'D-0001');
  assert.equal((await get(port, '/api/state')).pending.length, 0);

  await post(port, '/api/done', {});
  await done;
});

function get(port: number, p: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}
function post(port: number, p: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}

test('judgeAll: --level polish confirms only polish; --trigger scopes to one piece of work', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  const q = (over: Record<string, unknown>) => queue(input({ verdict: undefined, ...over }), o);
  q({ decision: 'Shell', level: 'feature', trigger: 'Settings build', scope: 'file:a.tsx' });
  q({ decision: 'h-9', level: 'polish', trigger: 'Settings build', scope: 'file:a.tsx', change: 'Buttons match at h-9' });
  q({ decision: 'chevron', level: 'polish', trigger: 'Audit page', scope: 'file:b.tsx', change: 'Dropped the chevron' });
  q({ decision: 'Cards', level: 'pattern', trigger: 'Audit page', scope: 'pattern:cards' });
  const p = resolvePaths(cwd);

  const r = judgeAll({ ...o, as: 'accept', level: 'polish', trigger: 'Settings build' });
  assert.equal(r.exitCode, 0);
  assert.equal((r.output.judged as string[]).length, 1);
  assert.deepEqual(readPending(p).map((d) => d.decision), ['Shell', 'chevron', 'Cards']);

  const r2 = judgeAll({ ...o, as: 'accept', level: 'polish' });
  assert.deepEqual(readPending(p).map((d) => d.decision), ['Shell', 'Cards']);
  assert.equal(r2.output.pending, 2);

  assert.equal(judgeAll({ ...o, as: 'fix' }).exitCode, 1, 'fix is never bulk');
  assert.equal(judgeAll({ ...o, as: 'accept', level: 'polish' }).output.status, 'nothing-to-judge');

  const r3 = judgeAll({ ...o, as: 'rule', level: 'pattern' });
  assert.deepEqual(r3.output.judged, ['D-0003']);
  assert.equal(readActive(p).length, 1);
  assert.deepEqual(readPending(p).map((d) => d.decision), ['Shell']);
});

test('groupByTrigger keeps first-appearance order and splits polish', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  const q = (over: Record<string, unknown>) => queue(input({ verdict: undefined, ...over }), o);
  q({ decision: 'b1', trigger: 'B', scope: 'pattern:b1' });
  q({ decision: 'a1', trigger: 'A', scope: 'pattern:a1', level: 'polish' });
  q({ decision: 'b2', trigger: 'B', scope: 'pattern:b2', level: 'polish' });
  q({ decision: 'a2', trigger: 'A', scope: 'pattern:a2', level: 'feature' });
  const groups = groupByTrigger(readPending(resolvePaths(cwd)));
  assert.deepEqual(groups.map((g) => g.trigger), ['B', 'A']);
  assert.deepEqual(groups[0].items.map((d) => d.decision), ['b1']);
  assert.deepEqual(groups[0].polish.map((d) => d.decision), ['b2']);
  assert.deepEqual(groups[1].items.map((d) => d.decision), ['a2']);
  assert.deepEqual(groups[1].polish.map((d) => d.decision), ['a1']);
  assert.ok(rules(undefined, { cwd, pending: true }).includes('confirm all with'));
});

test('archive entries written before level/change existed still parse', () => {
  const cwd = tmp();
  const p = resolvePaths(cwd);
  fs.mkdirSync(p.archiveDir, { recursive: true });
  fs.writeFileSync(p.archive, `# Decision archive

### D-0001 · Old rule

- **Rationale:** because
- **Trigger:** old build
- **Scope:** global · **Dimension:** visual · **Class:** mechanical · **Verdict:** rule
- **Author:** t · **Date:** 2026-09-01T00:00:00Z · **Commit:** — · **Supersedes:** —
`);
  const [d] = readArchive(p);
  assert.equal(d.level, 'pattern');
  assert.equal(d.change, null);
  assert.equal(d.decision, 'Old rule');
});

test('a ticket ref rides from the flag or the payload through queue and judge', () => {
  const cwd = tmp();
  const p = resolvePaths(cwd);
  // --ref on the command wins over the payload; a bare key is fine.
  queue(input({ verdict: undefined, ref: 'https://linear.app/acme/issue/ENG-1' }), { cwd, author: 'test', ref: 'ENG-2' });
  // Payload only.
  queue(input({ verdict: undefined, decision: 'Empty states are one line', scope: 'pattern:empty-state', dimension: 'states', ref: 'https://github.com/acme/app/issues/42' }), { cwd, author: 'test' });
  // None mentioned.
  queue(input({ verdict: undefined, decision: 'Toasts sit bottom-left', scope: 'pattern:toast', dimension: 'states' }), { cwd, author: 'test' });
  assert.deepEqual(readPending(p).map((d) => d.ref), ['ENG-2', 'https://github.com/acme/app/issues/42', null]);

  // Judging keeps it; a bulk judge can stamp one on everything left.
  assert.equal(judge('P-0001', { cwd, author: 'test', as: 'rule' }).exitCode, 0);
  assert.equal(judgeAll({ cwd, author: 'test', as: 'accept', ref: 'ENG-9' }).exitCode, 0);
  assert.deepEqual(readArchive(p).map((d) => [d.id, d.ref]), [['D-0001', 'ENG-2'], ['D-0002', 'ENG-9'], ['D-0003', 'ENG-9']]);
  // And it's in the file as its own line, so a URL never collides with the separator.
  assert.match(fs.readFileSync(p.archive, 'utf8'), /^- \*\*Ref:\*\* ENG-2$/m);
});

test('first /arbiter: the queue reports firstRun until setup records the check-in answer', () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-onboard-'));
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', author: 'test' });
  const before = JSON.parse(rules(undefined, { cwd, pending: true, json: true }));
  assert.equal(before.firstRun, true);
  assert.equal(before.checkin, 'feature');
  const r = setup({ cwd, checkin: 'quiet' });
  assert.equal(r.exitCode, 0);
  const after = JSON.parse(rules(undefined, { cwd, pending: true, json: true }));
  assert.equal(after.firstRun, false);
  assert.equal(after.checkin, 'quiet');
  const queued = queue(JSON.stringify({ change: 'c', decision: 'd', rationale: 'r', trigger: 'T', scope: 'global', dimension: 'visual', class: 'judgment', level: 'polish' }), { cwd, author: 'test' });
  assert.equal((queued.output as { checkin: string }).checkin, 'quiet', 'record --pending tells the agent the setting');
  assert.equal(setup({ cwd, checkin: 'loud' }).exitCode, 1, 'unknown modes are refused');
});
