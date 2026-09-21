import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { addCandidate, updateCandidate } from '../commands/candidate';
import { record } from '../commands/record';
import { publish } from '../commands/publish';
import { pull } from '../commands/pull';
import { snapshotWork } from '../commands/snapshot';
import { buildManifest, readComments, readLink, readToken } from '../hosted';
import { resolvePaths } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-hosted-'));
const write = (cwd: string, rel: string, data: string | Buffer) => { fs.mkdirSync(path.join(cwd, path.dirname(rel)), { recursive: true }); fs.writeFileSync(path.join(cwd, rel), data); };
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');

/** A stand-in for hosted/: same three routes, same shapes, in memory. */
function fakeService(): Promise<{ url: string; state: { boards: Record<string, unknown>; comments: unknown[]; tokens: Record<string, string> }; close: () => void }> {
  const state = { boards: {} as Record<string, unknown>, comments: [] as unknown[], tokens: {} as Record<string, string> };
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const body = await new Promise<string>((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
      const send = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const url = new URL(req.url!, 'http://x');
      const auth = req.headers.authorization?.replace('Bearer ', '');
      if (req.method === 'POST' && url.pathname === '/api/projects') {
        const id = 'p1'; state.tokens[id] = 'tok-secret';
        return send(201, { id, slug: 'abc123', token: 'tok-secret', url: 'http://x/p/abc123' });
      }
      const m = /^\/api\/projects\/([^/]+)\/(board|comments|snapshots\/(?:C-\d+|W-[a-z0-9-]+))$/.exec(url.pathname);
      if (!m) return send(404, {});
      if (state.tokens[m[1]] !== auth) return send(401, { error: 'bad token' });
      if (m[2].startsWith('snapshots/') && req.method === 'PUT') {
        const type = req.headers['content-type'] ?? '';
        if (!/^image\/(png|jpeg|webp|gif)$/.test(type)) return send(400, { error: 'type' });
        if (!body.length) return send(400, { error: 'empty' });
        return send(200, { ok: true, url: `http://x/snap/${m[2].slice(10)}.png` });
      }
      if (m[2] === 'board' && req.method === 'PUT') {
        const b = JSON.parse(body);
        for (const c of b.candidates) if (c.snapshot && typeof c.snapshot !== 'string') return send(400, { error: 'bytes inline — upload through the snapshots route' });
        state.boards[m[1]] = b;
        return send(200, { ok: true, candidates: b.candidates.length, url: 'http://x/p/abc123' });
      }
      if (m[2] === 'comments' && req.method === 'GET') {
        const since = url.searchParams.get('since');
        const list = (state.comments as { created_at: string }[]).filter((c) => !since || c.created_at > since);
        return send(200, { comments: list, fetched_at: new Date().toISOString() });
      }
      send(405, {});
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, state, close: () => server.close() });
    });
  });
}

test('publish --to creates the project once, uploads the board, pull merges comments', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  write(cwd, 'shot.png', PNG);
  write(cwd, 'shot.svg', '<svg xmlns="http://www.w3.org/2000/svg"/>');
  addCandidate('Billing v2', { ...o, feature: 'billing', snapshot: 'shot.png' });
  addCandidate('Billing v1', { ...o, feature: 'billing', snapshot: 'shot.svg' });
  record(JSON.stringify({ change: 'Plan and card side by side', decision: 'Two half-width cards', rationale: 'r', trigger: 'Billing', scope: 'file:b.tsx', dimension: 'structure', class: 'judgment', verdict: 'accept', level: 'feature' }), { ...o, candidate: 'C-0001' });
  record(JSON.stringify({ decision: 'h-9', rationale: 'r', trigger: 'Billing', scope: 'file:b.tsx', dimension: 'visual', class: 'mechanical', verdict: 'accept', level: 'polish' }), { ...o, candidate: 'C-0001' });
  updateCandidate('C-0001', { ...o, state: 'approved', why: 'card was below the fold' });
  // Ordinary work, no candidate: still reaches the board, as a card named for the piece of work — with a picture if one was attached.
  record(JSON.stringify({ change: 'Filters apply as you pick them', decision: 'Report filters apply immediately', rationale: 'r', trigger: 'Reports filters', scope: 'pattern:filters', dimension: 'interaction', class: 'judgment', verdict: 'accept', level: 'pattern' }), o);
  assert.equal(snapshotWork('reports filters', { cwd, file: 'shot.png' }).exitCode, 0, 'name matching is forgiving');

  const svc = await fakeService();
  try {
    const { manifest, skipped } = buildManifest(resolvePaths(cwd));
    const cands = manifest.candidates as { id: string; snapshot: unknown; decisions: unknown[] }[];
    assert.equal(cands[0].decisions.length, 1, 'polish left out');
    const work = cands.find((c) => c.id === 'W-reports-filters') as { name: string; state: string; work: boolean; decisions: unknown[]; snapshot: unknown } | undefined;
    assert.ok(work, 'screenless decision rides as a work card');
    assert.ok(work!.snapshot, 'its picture rides too');
    assert.equal(work!.name, 'Reports filters'); assert.equal(work!.state, 'recorded'); assert.equal(work!.work, true); assert.equal(work!.decisions.length, 1);
    assert.ok(cands[0].snapshot, 'png included');
    assert.equal(cands[1].snapshot, null, 'svg not uploaded');
    assert.equal(skipped.length, 1);

    const r1 = await publish({ cwd, to: svc.url });
    assert.ok(r1.ok, JSON.stringify(r1.steps));
    assert.equal(r1.url, 'http://x/p/abc123');
    assert.ok(r1.steps.some((s) => s.step === 'project' && s.outcome === 'done'));
    const link = readLink(resolvePaths(cwd))!;
    assert.equal((link as { token?: string }).token, undefined, 'no secret in the shareable file');
    assert.equal(readToken(resolvePaths(cwd)), 'tok-secret');
    const gi = fs.readFileSync(path.join(cwd, '.arbiter', '.gitignore'), 'utf8');
    assert.ok(gi.includes('hosted.token') && !gi.includes('hosted.json'), 'token file ignored, link file shareable');

    const r2 = await publish({ cwd, to: svc.url });
    assert.ok(!r2.steps.some((s) => s.step === 'project'), 'second publish reuses the project');
    const board = svc.state.boards.p1 as { candidates: { id: string; state: string; snapshot: unknown }[] };
    assert.equal(board.candidates[0].state, 'approved');
    assert.equal(board.candidates[0].snapshot, 'http://x/snap/C-0001.png', 'manifest carries the uploaded URL, not bytes');
    assert.equal(board.candidates[1].snapshot, null);
    assert.equal(board.candidates.find((c) => c.id === 'W-reports-filters')!.snapshot, 'http://x/snap/W-reports-filters.png');

    // A PM says something.
    svc.state.comments.push({ id: 'c1', candidate_id: 'C-0001', decision_id: null, kind: 'approve', author_name: 'Sam', author_email: 's@x', body: '', created_at: '2026-09-16T10:00:00.000Z' });
    svc.state.comments.push({ id: 'c2', candidate_id: 'C-0001', decision_id: null, kind: 'comment', author_name: 'Sam', author_email: 's@x', body: 'Why not a sheet?', created_at: '2026-09-16T10:01:00.000Z' });
    const out = await pull({ cwd });
    assert.ok(out.includes('✓ Sam — looks good'));
    assert.ok(out.includes('Sam: Why not a sheet?'));
    assert.equal(readComments(resolvePaths(cwd)).length, 2);

    const again = await pull({ cwd });
    assert.ok(again.startsWith('Nothing new'));
    assert.equal(readComments(resolvePaths(cwd)).length, 2, 'no duplicates');
  } finally {
    svc.close();
  }
});

test('publish --to fails cleanly when the service is down', async () => {
  const cwd = tmp();
  const r = await publish({ cwd, to: 'http://127.0.0.1:1' });
  assert.equal(r.ok, false);
  assert.equal(r.steps[0].outcome, 'failed');
});


test('a teammate with hosted.json and ARBITER_PUBLISH_TOKEN updates the same project; without the token gets told what to do', async () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  addCandidate('X', { ...o, feature: 'f' });
  const svc = await fakeService();
  try {
    await publish({ cwd, to: svc.url });
    // Simulate a clone: link file present, token file absent.
    fs.rmSync(path.join(cwd, '.arbiter', 'hosted.token'));
    const r = await publish({ cwd, to: svc.url });
    assert.equal(r.ok, false);
    assert.ok(r.steps[0].note!.includes('ARBITER_PUBLISH_TOKEN'));

    process.env.ARBITER_PUBLISH_TOKEN = 'tok-secret';
    try {
      const r2 = await publish({ cwd, to: svc.url });
      assert.ok(r2.ok, JSON.stringify(r2.steps));
      assert.ok(!r2.steps.some((s) => s.step === 'project'), 'same project, not a second one');
    } finally {
      delete process.env.ARBITER_PUBLISH_TOKEN;
    }
  } finally {
    svc.close();
  }
});

test('a site with an admin token refuses project creation without it, with a clear message', async () => {
  const cwd = tmp();
  addCandidate('X', { cwd, author: 'test', feature: 'f' });
  const server = http.createServer((req, res) => {
    req.resume();
    if (req.method === 'PUT') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end('{"ok":true,"candidates":1,"url":"http://x/p/s"}'); }
    if (req.headers['x-admin-token'] !== 'admin-1') { res.writeHead(401, { 'content-type': 'application/json' }); return res.end('{"error":"admin token required"}'); }
    res.writeHead(201, { 'content-type': 'application/json' }); res.end(JSON.stringify({ id: 'p', slug: 's', token: 't', url: 'http://x/p/s' }));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const url = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  try {
    const r = await publish({ cwd, to: url });
    assert.equal(r.ok, false);
    assert.ok(r.steps[0].note!.includes('--admin-token'));
    const r2 = await publish({ cwd, to: url, admin: 'admin-1' });
    assert.ok(r2.steps.some((s) => s.step === 'project' && s.outcome === 'done'));
  } finally {
    server.close();
  }
});
