/**
 * Arbiter Team is in early access, by invitation: a new board needs an invite code, the service's refusal
 * comes through in its own words, and the admin makes, lists and switches off invites.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { record } from '../commands/record';
import { publish } from '../commands/publish';
import { invite } from '../commands/invite';
import { ADMIN_ENV, INVITE_ENV, readLinkOrNull } from '../hosted';
import { resolvePaths } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-invites-'));
const decision = JSON.stringify({ change: 'Billing is its own tab', decision: 'Billing settings live in their own tab', rationale: 'r', trigger: 'Settings build', scope: 'pattern:settings-tabs', dimension: 'structure', class: 'judgment', verdict: 'accept', level: 'feature' });
const project = () => { const cwd = tmp(); assert.equal(record(decision, { cwd }).exitCode, 0); return cwd; };

/** Run with these environment variables, then put them back as they were. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const was = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(vars)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(was)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
}

const CODE = 'ABCD-EFGH-JKMN';
// The service's own words, as the site has them: without a code, Plans and a read-only copy; a code that stopped working, Contact.
const REQUIRED = 'Arbiter Team is in early access, by invitation, so a new team board needs an invite code. Request early access at http://x/plans. To share your board now, npx arbiter export makes a read-only copy anyone can open.';
const ASK_AGAIN = 'Ask for a new one at http://x/contact.';
const norm = (c: string) => c.toUpperCase().replace(/[^A-Z0-9]/g, '');

interface Call { method: string; path: string; body: Record<string, unknown> | null; admin: string | null }
/** The service's routes for boards and invites, in memory, as the site answers them. */
function fakeService(opts: { old?: boolean; boards?: number } = {}) {
  const state = {
    calls: [] as Call[],
    left: opts.boards ?? 3,
    invites: [] as { id: string; note: string; boardsLeft: number; made: number; created: string; off: string | null }[],
  };
  return new Promise<{ url: string; state: typeof state; close: () => void }>((resolve) => {
    const server = http.createServer(async (req, res) => {
      const raw = await new Promise<string>((r) => { let d = ''; req.on('data', (c) => (d += c)); req.on('end', () => r(d)); });
      const send = (status: number, obj: unknown) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
      const url = new URL(req.url!, 'http://x');
      let body: Record<string, unknown> | null = null;
      try { body = JSON.parse(raw); } catch { /* bytes */ }
      const admin = (req.headers['x-admin-token'] as string | undefined) ?? null;
      state.calls.push({ method: req.method!, path: url.pathname, body, admin });
      if (url.pathname.startsWith('/api/invites') && opts.old) { res.writeHead(404, { 'content-type': 'text/html' }); return res.end('<!doctype html><title>404</title>'); }

      if (req.method === 'POST' && url.pathname === '/api/projects') {
        if (admin !== 'adm') {
          const code = typeof body?.invite === 'string' ? body.invite : '';
          if (!code) return send(403, { error: REQUIRED, invite: 'required' });
          if (norm(code) !== norm(CODE) || state.left < 1) return send(403, { error: `That invite code doesn't work: it's mistyped, switched off, or has made all its boards. ${ASK_AGAIN}`, invite: 'refused' });
          state.left--;
        }
        return send(201, { id: 'p1', slug: 'abc123', token: 'tok', url: 'http://x/p/abc123' });
      }
      if (url.pathname === '/api/projects/p1/board') return send(200, { ok: true, candidates: 1 });

      if (url.pathname.startsWith('/api/invites')) {
        if (admin !== 'adm') return send(401, { error: 'admin token required' });
        if (req.method === 'POST' && url.pathname === '/api/invites') {
          const inv = { id: `00000000-0000-4000-8000-00000000000${state.invites.length + 1}`, note: String(body?.note ?? ''), boardsLeft: Number(body?.boards ?? 1), made: 0, created: '2026-11-05T09:00:00.000Z', off: null };
          state.invites.unshift(inv);
          return send(201, { id: inv.id, code: CODE, note: inv.note, boards: inv.boardsLeft });
        }
        if (req.method === 'GET' && url.pathname === '/api/invites') return send(200, { invites: state.invites });
        const id = url.pathname.split('/').pop()!;
        const inv = state.invites.find((i) => i.id === id);
        if (req.method === 'DELETE') {
          if (!inv) return send(404, { error: 'no invite with that id' });
          if (inv.off) return send(200, { ok: true, already: true });
          inv.off = '2026-11-06T09:00:00.000Z';
          return send(200, { ok: true, note: inv.note });
        }
      }
      send(404, {});
    });
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as { port: number };
      resolve({ url: `http://127.0.0.1:${port}`, state, close: () => server.close() });
    });
  });
}

const creates = (calls: Call[]) => calls.filter((c) => c.method === 'POST' && c.path === '/api/projects');

test('without an invite, a new board is refused: where to ask, how to use a code, and nothing saved', async () => {
  const cwd = project();
  const svc = await fakeService();
  try {
    const r = await withEnv({ [INVITE_ENV]: undefined, [ADMIN_ENV]: undefined, CI: undefined }, () => publish({ cwd, to: svc.url }));
    assert.equal(r.ok, false);
    assert.match(r.steps[0].note!, /Arbiter Team is in early access, by invitation.*Request early access at http:\/\/x\/plans\./);
    assert.match(r.steps[0].note!, /npx arbiter export makes a read-only copy/);
    assert.match(r.steps[0].note!, /npx arbiter publish --invite <code>/);
    assert.equal(readLinkOrNull(resolvePaths(cwd)), null, 'no board, so no link');
    assert.equal(creates(svc.state.calls)[0].body!.invite, undefined, 'no code is sent when there is none');
  } finally {
    svc.close();
  }
});

test('an invite makes the board; later publishes need none, and the code is kept nowhere', async () => {
  const cwd = project();
  const svc = await fakeService();
  try {
    await withEnv({ [INVITE_ENV]: undefined, [ADMIN_ENV]: undefined, CI: undefined }, async () => {
      const first = await publish({ cwd, to: svc.url, invite: ' abcd-efgh-jkmn ' });
      assert.equal(first.ok, true, JSON.stringify(first.steps));
      assert.equal(creates(svc.state.calls)[0].body!.invite, 'abcd-efgh-jkmn', 'sent as typed, trimmed: the service reads it either way');
      const again = await publish({ cwd, to: svc.url });
      assert.equal(again.ok, true, JSON.stringify(again.steps));
    });
    assert.equal(creates(svc.state.calls).length, 1, 'one board, made once');
    assert.equal(svc.state.left, 2);
    const kept = fs.readdirSync(path.join(cwd, '.arbiter')).map((f) => fs.readFileSync(path.join(cwd, '.arbiter', f), 'utf8')).join('\n');
    assert.ok(!/ABCD|abcd-efgh/i.test(kept), 'the code is in no file');
  } finally {
    svc.close();
  }
});

test(`${INVITE_ENV} works like --invite`, async () => {
  const cwd = project();
  const svc = await fakeService();
  try {
    const r = await withEnv({ [INVITE_ENV]: CODE, [ADMIN_ENV]: undefined, CI: undefined }, () => publish({ cwd, to: svc.url }));
    assert.equal(r.ok, true, JSON.stringify(r.steps));
    assert.equal(creates(svc.state.calls)[0].body!.invite, CODE);
  } finally {
    svc.close();
  }
});

test("a code that doesn't work is refused in the service's own words", async () => {
  const cwd = project();
  const svc = await fakeService({ boards: 0 });
  try {
    const r = await withEnv({ [INVITE_ENV]: undefined, [ADMIN_ENV]: undefined, CI: undefined }, () => publish({ cwd, to: svc.url, invite: CODE }));
    assert.equal(r.ok, false);
    assert.match(r.steps[0].note!, /That invite code doesn't work: it's mistyped, switched off, or has made all its boards\. Ask for a new one at http:\/\/x\/contact\./);
    assert.doesNotMatch(r.steps[0].note!, /--invite <code>/, 'they had a code: no need to say how to use one');
  } finally {
    svc.close();
  }
});

test('the admin token still makes a board without an invite', async () => {
  const cwd = project();
  const svc = await fakeService();
  try {
    const r = await withEnv({ [INVITE_ENV]: undefined, [ADMIN_ENV]: undefined, CI: undefined }, () => publish({ cwd, to: svc.url, admin: 'adm' }));
    assert.equal(r.ok, true, JSON.stringify(r.steps));
    assert.equal(svc.state.left, 3, 'no invite spent');
  } finally {
    svc.close();
  }
});

test('invite: needs the admin token; makes one, lists them, switches one off', async () => {
  const svc = await fakeService();
  try {
    assert.match((await withEnv({ [ADMIN_ENV]: undefined }, () => invite('Sam', { to: svc.url }))).out, new RegExp(`Set ${ADMIN_ENV} to the admin token of ${svc.url.replace(/[.]/g, '\\.')} first`));
    assert.equal(svc.state.calls.length, 0, 'nothing sent without it');

    await withEnv({ [ADMIN_ENV]: 'adm' }, async () => {
      const made = await invite('Sam at Acme', { to: svc.url, boards: '5' });
      assert.equal(made.ok, true, made.out);
      assert.deepEqual(svc.state.calls.at(-1)!.body, { note: 'Sam at Acme', boards: 5 });
      assert.match(made.out, /Invite for Sam at Acme, good for 5 boards\. This is the only time the code is shown/);
      assert.match(made.out, new RegExp(`npx arbiterdesign@latest publish --invite ${CODE}`));

      assert.equal((await invite(undefined, { to: svc.url, boards: '0' })).out, '--boards: a whole number, 1 or more.');
      assert.equal(svc.state.calls.length, 1, 'refused before anything is sent');

      const list = await invite(undefined, { to: svc.url, list: true });
      assert.match(list.out, /^1 invite on /);
      assert.match(list.out, /Sam at Acme\s+0 boards made, 5 left\s+5 Nov\s+00000000-0000-4000-8000-000000000001/);

      const id = svc.state.invites[0].id;
      assert.equal((await invite(undefined, { to: svc.url, off: id })).out, 'Switched off: Sam at Acme. It makes no more boards; the boards it made stay up.');
      assert.equal((await invite(undefined, { to: svc.url, off: id })).out, 'That invite was already off.');
      assert.match((await invite(undefined, { to: svc.url, list: true })).out, /0 boards made, off since 6 Nov/);
      const unknown = await invite(undefined, { to: svc.url, off: 'nope' });
      assert.equal(unknown.ok, false);
      assert.equal(unknown.out, 'no invite with that id');
    });

    const wrong = await withEnv({ [ADMIN_ENV]: 'nope' }, () => invite('Sam', { to: svc.url }));
    assert.equal(wrong.ok, false);
    assert.match(wrong.out, /refused the admin token/);
  } finally {
    svc.close();
  }
});

test("invite against a server that doesn't do invites says so", async () => {
  const svc = await fakeService({ old: true });
  try {
    const r = await withEnv({ [ADMIN_ENV]: 'adm' }, () => invite('Sam', { to: svc.url }));
    assert.equal(r.ok, false);
    assert.match(r.out, /doesn't do invites yet: it runs an older Arbiter than this one/);
  } finally {
    svc.close();
  }
});

test('invite with no --boards leaves the number to the service, which makes a code good for 1 board', async () => {
  const svc = await fakeService();
  try {
    await withEnv({ [ADMIN_ENV]: 'adm' }, async () => {
      const made = await invite('Robin', { to: svc.url });
      assert.equal(made.ok, true, made.out);
      assert.deepEqual(svc.state.calls.at(-1)!.body, { note: 'Robin' });
      assert.match(made.out, /Invite for Robin, good for 1 board\. This is the only time the code is shown/);
    });
  } finally {
    svc.close();
  }
});
