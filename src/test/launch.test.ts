/**
 * Launch fixes: renaming a piece of work keeps its comments, a board can have a password, a board can
 * be deleted, and the service's own words come through when it refuses a new board.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { queue, record } from '../commands/record';
import { publish, WORKFLOW_FILE } from '../commands/publish';
import { unpublish } from '../commands/unpublish';
import { renameWork } from '../commands/rename';
import { addCandidate } from '../commands/candidate';
import { snapshotWork } from '../commands/snapshot';
import { buildManifest, newPassword, pullHosted, readComments, readLink, writeComments, type PulledComment } from '../hosted';
import { readRequests, writeRequests, type ChangeRequest } from '../requests';
import { readActive, readArchive, readPending, resolvePaths } from '../store';
import { addRename, readRenames, workSnapshot } from '../work';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-launch-'));
const write = (cwd: string, rel: string, data: string | Buffer) => { fs.mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), data); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const decision = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ change: 'Billing is its own tab', decision: 'Billing settings live in their own tab', rationale: 'r', trigger: 'Settings build', scope: 'pattern:settings-tabs', dimension: 'structure', class: 'judgment', verdict: 'accept', level: 'feature', ...over });

interface Calls { method: string; path: string; body: unknown; at: number }
/** The hosted routes the CLI calls, in memory, recording every call in order. */
function fakeService(opts: { createStatus?: number; createError?: string; noPassword?: boolean; noDelete?: boolean; full?: number } = {}) {
  const state = { calls: [] as Calls[], board: null as Record<string, unknown> | null, password: undefined as string | null | undefined, comments: [] as PulledComment[], deleted: false };
  let n = 0;
  return new Promise<{ url: string; state: typeof state; close: () => void }>((resolve) => {
    const server = http.createServer(async (req, res) => {
      const raw = await new Promise<string>((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
      const send = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const url = new URL(req.url!, 'http://x');
      let body: unknown = null;
      try { body = JSON.parse(raw); } catch { /* bytes */ }
      state.calls.push({ method: req.method!, path: url.pathname, body, at: n++ });
      if (req.method === 'POST' && url.pathname === '/api/projects') {
        if (opts.createStatus) return send(opts.createStatus, { error: opts.createError });
        return send(201, { id: 'p1', slug: 'abc123', token: 'tok', url: 'http://x/p/abc123' });
      }
      if (req.headers.authorization !== 'Bearer tok' || state.deleted) return send(401, { error: 'unknown project or bad token' });
      if (url.pathname === '/api/projects/p1/password' && req.method === 'PUT') {
        if (opts.noPassword) return send(404, {});
        state.password = (body as { password: string | null }).password;
        return send(200, { ok: true });
      }
      if (url.pathname === '/api/projects/p1' && req.method === 'DELETE') {
        if (opts.noDelete) return send(405, {});
        state.deleted = true;
        return send(200, { ok: true, pictures: 2, comments: state.comments.length });
      }
      if (url.pathname.startsWith('/api/projects/p1/snapshots/') && opts.full) return send(opts.full, { error: 'this board holds 100 pictures (25 MB), and 100 or 25 MB is the most one board can.' });
      if (url.pathname.startsWith('/api/projects/p1/snapshots/')) return send(200, { ok: true, url: `http://x/snap/${url.pathname.split('/').pop()}.png` });
      if (url.pathname === '/api/projects/p1/board') { state.board = body as Record<string, unknown>; return send(200, { ok: true, candidates: 1 }); }
      if (url.pathname === '/api/projects/p1/comments') return send(200, { comments: state.comments, board_version: null });
      send(404, {});
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, state, close: () => server.close() });
    });
  });
}

const comment = (over: Partial<PulledComment> = {}): PulledComment =>
  ({ id: 'c1', candidate_id: 'W-settings-build', decision_id: null, kind: 'comment', author_name: 'Sam', body: 'Nice', created_at: '2026-10-15T10:00:00.000Z', ...over });

// ── rename ─────────────────────────────────────────────────────────────────

test('rename moves a piece of work everywhere the repo keeps it, and notes the move for the board', () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  assert.equal(record(decision(), { cwd }).exitCode, 0);
  assert.equal(record(decision({ decision: 'The danger zone sits at the bottom of Settings', scope: 'pattern:danger-zone', verdict: 'rule' }), { cwd }).exitCode, 0);
  assert.equal(queue(decision({ decision: 'Billing shows the plan first', scope: 'pattern:billing-plan', verdict: undefined }), { cwd }).exitCode, 0);
  assert.equal(record(decision({ trigger: 'Reports', decision: 'Reports filter as you pick', scope: 'pattern:filters' }), { cwd }).exitCode, 0);
  write(cwd, 'shot.png', PNG);
  assert.equal(snapshotWork('Settings build', { cwd, file: 'shot.png' }).exitCode, 0);
  writeComments(paths, [comment(), comment({ id: 'c2', candidate_id: 'W-reports' })]);
  writeRequests(paths, [{ id: 'R-0001', comment: 'c3', screen: 'W-settings-build', decision: null, author: 'Sam', body: 'x', date: '2026-10-15', boardVersion: null, status: 'open', instead: null, reason: null, judgedBy: null, judgedAt: null, decisions: [], appliedAt: null } as ChangeRequest]);

  const r = renameWork('settings BUILD', 'Settings — billing', { cwd });
  assert.equal(r.exitCode, 0, JSON.stringify(r.output));
  assert.equal(r.output.from, 'Settings build', 'found by id, whatever the case');
  assert.deepEqual(r.output.card, { from: 'W-settings-build', to: 'W-settings-billing' });
  assert.equal(r.output.decisions, 3);

  assert.deepEqual(readArchive(paths).map((d) => d.trigger), ['Settings — billing', 'Settings — billing', 'Reports']);
  assert.deepEqual(readPending(paths).map((d) => d.trigger), ['Settings — billing']);
  assert.equal(readActive(paths)[0].trigger, 'Settings — billing', 'the rule in DECISIONS.md too');
  assert.equal(workSnapshot(paths, 'W-settings-build'), null);
  assert.ok(workSnapshot(paths, 'W-settings-billing'), 'the picture follows');
  assert.equal(readRequests(paths)[0].screen, 'W-settings-billing');
  assert.deepEqual(readComments(paths).map((c) => c.candidate_id), ['W-settings-billing', 'W-reports'], 'only its own comments move');
  assert.deepEqual(readRenames(paths), [{ from: 'W-settings-build', to: 'W-settings-billing' }]);

  // The board gets the move with the new card.
  const { manifest } = buildManifest(paths);
  assert.deepEqual(manifest.renamed, [{ from: 'W-settings-build', to: 'W-settings-billing' }]);
  assert.ok((manifest.candidates as { id: string }[]).some((c) => c.id === 'W-settings-billing'));
});

test('rename refuses what it can\'t do cleanly, and a change of case keeps the card', () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  record(decision(), { cwd });
  record(decision({ trigger: 'Reports', scope: 'pattern:filters', decision: 'Reports filter as you pick' }), { cwd });
  addCandidate('Settings — tabs', { cwd });

  assert.match(String((renameWork('Nothing here', 'X', { cwd }).output.errors as string[])[0]), /no piece of work called "Nothing here"/);
  assert.match(String((renameWork('Settings build', 'reports', { cwd }).output.errors as string[])[0]), /already a piece of work called "Reports".*merge/);
  assert.match(String((renameWork('C-0001', 'Anything', { cwd }).output.errors as string[])[0]), /C-0001 is a screen/);
  assert.match(String((renameWork('Settings build', '!!!', { cwd }).output.errors as string[])[0]), /no letters or numbers/);

  const r = renameWork('W-settings-build', 'Settings Build', { cwd });
  assert.equal(r.exitCode, 0, JSON.stringify(r.output));
  assert.equal(r.output.card, undefined, 'same id: nothing for the board to move');
  assert.equal(readArchive(paths)[0].trigger, 'Settings Build');
  assert.deepEqual(readRenames(paths), []);
});

test('renames chain, and a name that comes back into use is never moved away from', () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  addRename(paths, 'W-a', 'W-b');
  addRename(paths, 'W-b', 'W-c');
  assert.deepEqual(readRenames(paths), [{ from: 'W-a', to: 'W-c' }, { from: 'W-b', to: 'W-c' }], 'the oldest name leads to the newest');
  addRename(paths, 'W-d', 'W-a');
  assert.deepEqual(readRenames(paths), [{ from: 'W-b', to: 'W-c' }, { from: 'W-d', to: 'W-a' }], 'W-a is a live name again');

  // A piece of work recorded again under an old name is a card: its comments stay on it.
  record(decision({ trigger: 'b' }), { cwd });
  const { manifest } = buildManifest(paths);
  assert.deepEqual(manifest.renamed, [{ from: 'W-d', to: 'W-a' }]);
});

test('pull takes the board\'s card for comments already on file', async () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  record(decision(), { cwd });
  const svc = await fakeService();
  try {
    assert.ok((await publish({ cwd, to: svc.url })).ok);
    writeComments(paths, [comment()]);
    svc.state.comments = [comment({ candidate_id: 'W-settings-billing' })];
    await pullHosted(paths);
    assert.equal(readComments(paths)[0].candidate_id, 'W-settings-billing');
  } finally {
    svc.close();
  }
});

// ── password ───────────────────────────────────────────────────────────────

test('publish --password makes one up, sets it before anything is uploaded, and prints it once', async () => {
  const cwd = tmp();
  record(decision(), { cwd });
  const svc = await fakeService();
  try {
    const r = await publish({ cwd, to: svc.url, password: true });
    assert.ok(r.ok, JSON.stringify(r.steps));
    const pw = svc.state.password!;
    assert.match(pw, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
    const step = r.steps.find((s) => s.step === 'password')!;
    assert.ok(step.note!.startsWith(pw), 'shown, since nothing else can show it');
    const order = svc.state.calls.map((c) => `${c.method} ${c.path}`);
    assert.ok(order.indexOf('PUT /api/projects/p1/password') < order.indexOf('PUT /api/projects/p1/board'), 'password before the board');
    assert.ok(!fs.readFileSync(path.join(cwd, '.arbiter', 'hosted.json'), 'utf8').includes(pw), 'not kept in the repo');

    // A later publish leaves it alone.
    const calls = svc.state.calls.length;
    assert.ok((await publish({ cwd, to: svc.url })).ok);
    assert.ok(!svc.state.calls.slice(calls).some((c) => c.path.endsWith('/password')));

    // One you chose is set, not echoed; --no-password takes it off.
    const mine = await publish({ cwd, to: svc.url, password: 'correct horse battery' });
    assert.equal(svc.state.password, 'correct horse battery');
    assert.ok(!JSON.stringify(mine.steps).includes('correct horse'));
    const off = await publish({ cwd, to: svc.url, password: false });
    assert.equal(svc.state.password, null);
    assert.match(off.steps.find((s) => s.step === 'password')!.note!, /anyone with the link/);
  } finally {
    svc.close();
  }
});

test('a short password, or one for GitHub Pages, is refused before anything is created', async () => {
  const cwd = tmp();
  record(decision(), { cwd });
  const svc = await fakeService();
  try {
    const short = await publish({ cwd, to: svc.url, password: 'abc' });
    assert.equal(short.ok, false);
    assert.match(short.steps[0].note!, /at least 8 characters/);
    assert.equal(svc.state.calls.length, 0, 'no board made');
    const pages = await publish({ cwd, to: 'pages', password: true });
    assert.equal(pages.ok, false);
    assert.match(pages.steps[0].note!, /GitHub Pages site is public/);
  } finally {
    svc.close();
  }
});

test('a service without passwords says so, and nothing is published', async () => {
  const cwd = tmp();
  record(decision(), { cwd });
  const svc = await fakeService({ noPassword: true });
  try {
    const r = await publish({ cwd, to: svc.url, password: true });
    assert.equal(r.ok, false);
    assert.match(r.steps.find((s) => s.outcome === 'failed')!.note!, /doesn't take board passwords yet.*Nothing was published/);
    assert.ok(!svc.state.calls.some((c) => c.path.endsWith('/board')), 'the board never went up without its password');
  } finally {
    svc.close();
  }
});

test('made-up passwords differ and avoid characters that misread', () => {
  const seen = new Set(Array.from({ length: 50 }, newPassword));
  assert.equal(seen.size, 50);
  for (const p of seen) assert.ok(!/[01ilo]/.test(p), p);
});

// ── unpublish ──────────────────────────────────────────────────────────────

test('unpublish deletes nothing without --yes; with it, saves the comments, deletes the board and forgets the link', async () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  record(decision(), { cwd });
  const svc = await fakeService();
  try {
    assert.ok((await publish({ cwd, to: svc.url })).ok);
    write(cwd, WORKFLOW_FILE, 'on: push');
    svc.state.comments = [comment(), comment({ id: 'c2', body: 'Why tabs?' })];

    const dry = await unpublish({ cwd });
    assert.equal(dry.ok, false);
    assert.match(dry.steps[0].note!, /nothing deleted\. This deletes http:\/\/x\/p\/abc123 for everyone.*--yes/);
    assert.ok(!svc.state.calls.some((c) => c.method === 'DELETE'));

    const r = await unpublish({ cwd, yes: true });
    assert.ok(r.ok, JSON.stringify(r.steps));
    assert.equal(readComments(paths).length, 2, 'what was said on the board is kept');
    assert.ok(svc.state.deleted);
    assert.match(r.steps.find((s) => s.step === 'board')!.note!, /deleted http:\/\/x\/p\/abc123, with 2 pictures and 2 comments/);
    assert.equal(readLink(paths), null);
    assert.ok(!fs.existsSync(path.join(cwd, '.arbiter', 'hosted.token')));
    assert.match(r.steps.find((s) => s.step === 'workflow')!.note!, /still runs on every push/);
    assert.equal(readArchive(paths).length, 1, 'the record is untouched');

    const again = await unpublish({ cwd, yes: true });
    assert.equal(again.ok, false);
    assert.match(again.steps[0].note!, /no hosted board/);
  } finally {
    svc.close();
  }
});

test('unpublish against an older service changes nothing here', async () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  record(decision(), { cwd });
  const svc = await fakeService({ noDelete: true });
  try {
    assert.ok((await publish({ cwd, to: svc.url })).ok);
    const r = await unpublish({ cwd, yes: true });
    assert.equal(r.ok, false);
    assert.match(r.steps[0].note!, /can't delete boards yet/);
    assert.ok(readLink(paths), 'still linked');
  } finally {
    svc.close();
  }
});

// ── creating a board ───────────────────────────────────────────────────────

test('when the service refuses a new board, its own reason comes through', async () => {
  const cwd = tmp();
  record(decision(), { cwd });
  const svc = await fakeService({ createStatus: 429, createError: '10 new boards in the last hour from this network is the limit. Try again in an hour, or republish one you already have.' });
  try {
    const r = await publish({ cwd, to: svc.url });
    assert.equal(r.ok, false);
    assert.match(r.steps[0].note!, /from this network is the limit/);
  } finally {
    svc.close();
  }
});

test('a picture the board has no room for is left off, and the rest of the board still publishes', async () => {
  for (const status of [413, 507]) {
    const cwd = tmp();
    record(decision(), { cwd });
    write(cwd, 'shot.png', PNG);
    snapshotWork('Settings build', { cwd, file: 'shot.png' });
    const svc = await fakeService({ full: status });
    try {
      const r = await publish({ cwd, to: svc.url });
      assert.ok(r.ok, JSON.stringify(r.steps));
      const card = (svc.state.board!.candidates as { id: string; snapshot: unknown }[]).find((c) => c.id === 'W-settings-build')!;
      assert.equal(card.snapshot, null, 'no picture rather than no board');
      assert.match(r.steps.find((s) => s.step === 'snapshot')!.note!, /W-settings-build: not uploaded — this board holds 100 pictures/);
    } finally {
      svc.close();
    }
  }
});
