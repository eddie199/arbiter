import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { addCandidate } from '../commands/candidate';
import { queue, record } from '../commands/record';
import { judgeRequest } from '../commands/request';
import { publish } from '../commands/publish';
import { pull } from '../commands/pull';
import { remove } from '../commands/remove';
import { rules } from '../commands/rules';
import { buildManifest } from '../hosted';
import { readRequests } from '../requests';
import { readArchive, resolvePaths } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-requests-'));

/** Just enough of the board service: create, publish, and comments to pull. */
function fakeService(): Promise<{ url: string; boards: unknown[]; comments: Record<string, unknown>[]; close: () => void }> {
  const s = { boards: [] as unknown[], comments: [] as Record<string, unknown>[] };
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const body = await new Promise<string>((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
      const send = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const url = new URL(req.url!, 'http://x');
      if (req.method === 'POST' && url.pathname === '/api/projects') return send(201, { id: 'p1', slug: 's1', token: 'tok', url: 'http://x/p/s1' });
      if (req.method === 'PUT' && url.pathname === '/api/projects/p1/board') { s.boards.push(JSON.parse(body)); return send(200, { ok: true, candidates: 0, url: 'http://x/p/s1' }); }
      if (req.method === 'GET' && url.pathname === '/api/projects/p1/comments') {
        const since = url.searchParams.get('since');
        return send(200, { comments: s.comments.filter((c) => !since || String(c.created_at) > since), board_version: '2026-01-10T09:00:00.000Z', fetched_at: new Date().toISOString() });
      }
      send(404, {});
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, ...s, close: () => server.close() });
    });
  });
}

const change = (over: Record<string, unknown> = {}) => JSON.stringify({
  change: 'The danger zone sits at the bottom of Settings', decision: 'Destructive actions sit last on a settings page',
  rationale: 'Sam could not find it in its own tab', trigger: 'Settings — billing', scope: 'pattern:destructive-placement',
  dimension: 'structure', class: 'judgment', verdict: 'accept', level: 'pattern', ...over,
});

/** A project published once, with Sam's request on the board and pulled down. */
async function withRequest() {
  const cwd = tmp();
  const o = { cwd, author: 'Eddie' };
  addCandidate('Settings — billing', { ...o, feature: 'settings' });
  record(change({ change: 'Danger zone moved into its own tab', decision: 'Danger zone lives in its own tab' }), { ...o, candidate: 'C-0001' });
  const svc = await fakeService();
  await publish({ cwd, to: svc.url });
  svc.comments.push(
    { id: 'k1', candidate_id: 'C-0001', decision_id: 'D-0001', kind: 'request', author_name: 'Sam', author_email: 's@x', body: 'Move the danger zone\nto the bottom', created_at: '2026-01-10T10:00:00.000Z', board_version: '2026-01-10T09:00:00.000Z' },
    { id: 'k2', candidate_id: 'C-0001', decision_id: null, kind: 'comment', author_name: 'Sam', author_email: 's@x', body: 'Nice tabs', created_at: '2026-01-10T10:01:00.000Z' },
  );
  const out = await pull({ cwd });
  return { cwd, o, svc, out, paths: resolvePaths(cwd) };
}

test('pull: "Request change" becomes an open request; a plain comment stays a comment; pulling again adds nothing', async () => {
  const { cwd, svc, out, paths } = await withRequest();
  try {
    assert.ok(out.includes('Sam requests a change on D-0001: Move the danger zone'), out);
    assert.ok(out.includes('→ R-0001'));
    assert.ok(out.includes('1 request to answer'));
    assert.ok(out.includes('Sam: Nice tabs'));
    const [r] = readRequests(paths);
    assert.equal(readRequests(paths).length, 1);
    assert.deepEqual([r.id, r.comment, r.screen, r.decision, r.author, r.status], ['R-0001', 'k1', 'C-0001', 'D-0001', 'Sam', 'open']);

    const again = await pull({ cwd });
    assert.ok(again.startsWith('Nothing new'));
    assert.equal(readRequests(paths).length, 1, 'keyed on the comment — never asked twice');

    // A request pulled by an older Arbiter is already in comments.json: it still becomes one.
    fs.writeFileSync(path.join(paths.archiveDir, 'requests.json'), '[]\n');
    const late = await pull({ cwd });
    assert.ok(late.includes('1 request to answer'), late);
    assert.equal(readRequests(paths).length, 1);
  } finally {
    svc.close();
  }
});

test('answering: apply, apply but…, decline — decline needs a reason; nothing is applied until the change is recorded', async () => {
  const { cwd, o, svc } = await withRequest();
  try {
    const noWhy = judgeRequest('R-0001', { ...o, as: 'decline' });
    assert.equal(noWhy.exitCode, 1);
    assert.ok(String((noWhy.output.errors as string[])[0]).includes('Sam reads it'));
    assert.equal(judgeRequest('R-0009', { ...o, as: 'apply' }).exitCode, 1);

    const d = judgeRequest('R-0001', { ...o, as: 'decline', why: 'The tab tested better' });
    assert.equal(d.exitCode, 0);
    assert.equal(d.output.status, 'declined');
    assert.equal(readRequests(resolvePaths(cwd))[0].reason, 'The tab tested better');

    // Changed their mind: a decline can be taken back.
    const a = judgeRequest('R-0001', { ...o, as: 'apply', to: 'keep the tab, make the delete button red' });
    assert.equal(a.exitCode, 0);
    assert.equal(a.output.status, 'approved');
    assert.equal(a.output.do, 'keep the tab, make the delete button red');
    assert.ok(String(a.output.next).includes('--request R-0001'));
    assert.ok(String(a.output.next).includes('Settings — billing'), 'names the trigger that lands it on the same card');
    const r = readRequests(resolvePaths(cwd))[0];
    assert.equal(r.status, 'approved');
    assert.equal(r.reason, null);
    assert.equal(r.judgedBy, 'Eddie');
    assert.equal(readArchive(resolvePaths(cwd)).length, 1, 'approving changes no code and records nothing');
  } finally {
    svc.close();
  }
});

test('record --request: only an approved request; the change lands on the screen it was asked on, and the request is applied', async () => {
  const { cwd, o, svc, paths } = await withRequest();
  try {
    const early = record(change(), { ...o, request: 'R-0001' });
    assert.equal(early.exitCode, 1, 'open — the owner has not said yes');
    assert.ok(String((early.output.errors as string[])[0]).includes('--as apply'));
    assert.equal(readArchive(paths).length, 1, 'nothing written');

    judgeRequest('R-0001', { ...o, as: 'apply' });
    assert.equal(queue(change(), { ...o, request: 'R-0001' }).exitCode, 1, 'no queueing — it was already approved');

    const done = record(change(), { ...o, request: 'R-0001' });
    assert.equal(done.exitCode, 0, JSON.stringify(done.output));
    assert.deepEqual(done.output.request, { id: 'R-0001', status: 'applied', author: 'Sam' });
    assert.equal(done.output.candidate, 'C-0001', 'the screen it was asked on');
    const d = readArchive(paths).find((x) => x.id === done.output.id)!;
    assert.deepEqual(d.rejected, [], 'applied as asked — nothing of the ask was rejected');
    const r = readRequests(paths)[0];
    assert.equal(r.status, 'applied');
    assert.deepEqual(r.decisions, [d.id]);
    assert.ok(r.appliedAt);

    assert.equal(judgeRequest('R-0001', { ...o, as: 'decline', why: 'x' }).exitCode, 1, 'applied is final');
  } finally {
    svc.close();
  }
});

test('Apply, but…: the ask is kept as the alternative that lost', async () => {
  const { o, svc, paths } = await withRequest();
  try {
    judgeRequest('R-0001', { ...o, as: 'apply', to: 'keep the tab, make the delete button red' });
    const done = record(change({ change: 'The delete button in the danger-zone tab is red', decision: 'Destructive buttons are red' }), { ...o, request: 'R-0001' });
    assert.equal(done.exitCode, 0);
    const d = readArchive(paths).find((x) => x.id === done.output.id)!;
    assert.equal(d.rejected[0], "Move the danger zone to the bottom — Sam's request, applied differently", 'one line, however it was typed');
  } finally {
    svc.close();
  }
});

test('publish carries the answers back — not open ones — with what actually changed and the card it is on', async () => {
  const { cwd, o, svc, paths } = await withRequest();
  try {
    let requests = buildManifest(paths).manifest.requests as unknown[];
    assert.deepEqual(requests, [], 'open: the board already knows');

    judgeRequest('R-0001', { ...o, as: 'apply' });
    requests = buildManifest(paths).manifest.requests as { status: string }[];
    assert.equal((requests[0] as { status: string }).status, 'approved', 'Sam sees the yes before the change');

    // Polish never reaches a card, but the requester still reads what happened.
    const done = record(change({ level: 'polish', change: 'Danger zone moved to the bottom', decision: 'Danger zone moved to the bottom' }), { ...o, request: 'R-0001' });
    await publish({ cwd, to: svc.url });
    const board = svc.boards[svc.boards.length - 1] as { requests: Record<string, unknown>[] };
    assert.deepEqual(board.requests[0], {
      comment: 'k1', id: 'R-0001', status: 'applied', instead: null, reason: null, by: 'Eddie', at: readRequests(paths)[0].appliedAt,
      decisions: [{ id: done.output.id, change: 'Danger zone moved to the bottom', card: 'C-0001' }],
    });
  } finally {
    svc.close();
  }
});

test('the queue shows requests: open to answer, approved to make; rules R-0001 shows one', async () => {
  const { cwd, o, svc } = await withRequest();
  try {
    let q = JSON.parse(rules(undefined, { cwd, pending: true, json: true }));
    assert.equal(q.requests.open.length, 1);
    assert.equal(q.requests.open[0].screenName, 'Settings — billing');
    assert.equal(q.requests.open[0].body, 'Move the danger zone\nto the bottom');
    assert.equal(q.requests.approved.length, 0);
    assert.equal(q.count, 0, 'requests are not queued decisions');

    const text = rules(undefined, { cwd, pending: true });
    assert.ok(text.startsWith('Requests from the board — 1 to answer'), text);
    assert.ok(text.includes('R-0001  Sam, on Settings — billing (D-0001)'));
    assert.ok(!text.includes('All caught up'));

    judgeRequest('R-0001', { ...o, as: 'apply', to: 'make it red' });
    q = JSON.parse(rules(undefined, { cwd, pending: true, json: true }));
    assert.equal(q.requests.open.length, 0);
    assert.equal(q.requests.approved[0].instead, 'make it red');
    assert.ok(rules('R-0001', { cwd }).includes('approved by Eddie — do instead: make it red'));

    record(change(), { ...o, request: 'R-0001' });
    assert.equal(rules(undefined, { cwd, pending: true }), 'Nothing pending. All caught up.');
  } finally {
    svc.close();
  }
});

test('removing the decision that applied a request opens it again — the agent never remakes it unasked', async () => {
  const { o, svc, paths } = await withRequest();
  try {
    judgeRequest('R-0001', { ...o, as: 'apply', to: 'make it red' });
    const done = record(change(), { ...o, request: 'R-0001' });
    const r = remove(String(done.output.id), { cwd: o.cwd });
    assert.equal(r.exitCode, 0);
    assert.ok(String(r.output.requests).includes('R-0001 is open again'));
    const req = readRequests(paths)[0];
    assert.equal(req.status, 'open');
    assert.deepEqual(req.decisions, []);
    assert.equal(req.appliedAt, null);
    assert.equal(req.instead, null, 'the old answer goes with it');
    assert.equal(JSON.parse(rules(undefined, { cwd: o.cwd, pending: true, json: true })).requests.approved.length, 0);
  } finally {
    svc.close();
  }
});

test('review findings: bad files, bad comments, duplicate ids, --request misuse, removing a screen with a waiting request', async () => {
  const { cwd, o, svc, paths } = await withRequest();
  try {
    const file = path.join(paths.archiveDir, 'requests.json');
    const good = fs.readFileSync(file, 'utf8');

    // A merge conflict in requests.json stops remove before it writes anything — the archive is untouched.
    const archiveBefore = fs.readFileSync(paths.archive, 'utf8');
    fs.writeFileSync(file, '<<<<<<< ours\n[]\n=======\n[]\n>>>>>>> theirs\n');
    assert.throws(() => remove('D-0001', { cwd }), /requests\.json can't be read/);
    assert.equal(fs.readFileSync(paths.archive, 'utf8'), archiveBefore);
    fs.writeFileSync(file, good);

    // A request with no body or no card never enters the queue, so it can't break later reads.
    const { openRequests } = await import('../requests');
    const junk = [
      { id: 'j1', candidate_id: 'C-0001', decision_id: null, kind: 'request', author_name: 'X', author_email: 'x@x', body: null, created_at: '2026-01-10T11:00:00.000Z' },
      { id: 'j2', candidate_id: null, decision_id: null, kind: 'request', author_name: 'X', author_email: 'x@x', body: 'hi', created_at: '2026-01-10T11:00:00.000Z' },
    ] as unknown as Parameters<typeof openRequests>[1];
    assert.deepEqual(openRequests(paths, junk), []);
    assert.ok(rules(undefined, { cwd, pending: true, json: true }));

    // Two entries sharing an id (a hand-merged file): answering one leaves the other alone.
    const twin = { ...readRequests(paths)[0], comment: 'k9', body: 'Something else entirely' };
    fs.writeFileSync(file, JSON.stringify([...readRequests(paths), twin], null, 2));
    judgeRequest('R-0001', { ...o, as: 'decline', why: 'no' });
    const [first, second] = readRequests(paths);
    assert.equal(first.status, 'declined');
    assert.equal(second.body, 'Something else entirely', 'not overwritten by the first');
    assert.equal(second.status, 'open');
    fs.writeFileSync(file, good);

    // --request can't ride on --all.
    const { judgeAll } = await import('../commands/record');
    judgeRequest('R-0001', { ...o, as: 'apply' });
    queue(change({ change: 'Unrelated', decision: 'Unrelated' }), o);
    assert.equal(judgeAll({ ...o, as: 'accept', request: 'R-0001' }).exitCode, 1);
    assert.equal(readRequests(paths)[0].status, 'approved');

    // A screen with a request still waiting on it can't be removed out from under it.
    const gone = remove('C-0001', { cwd, force: true });
    assert.equal(gone.exitCode, 1);
    assert.ok(String((gone.output.errors as string[])[0]).includes('R-0001 (Sam)'));
  } finally {
    svc.close();
  }
});
