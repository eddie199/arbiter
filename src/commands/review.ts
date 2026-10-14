/**
 * `arbiter review` — a local page for judging pending decisions.
 *
 * Plain node:http on 127.0.0.1, one HTML file, no framework. Reads and writes
 * the same files the CLI does; the page has no state of its own. Stops when
 * the user presses Done or Ctrl-C.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { judge, judgeAll, JudgeAction } from './record';
import { updateCandidate } from './candidate';
import { candidatesDir, decisionsFor, readCandidates } from '../candidates';
import { readComments, readLinkOrNull } from '../hosted';
import { findRoot, readActive, readArchive, readConfig, readPending, resolvePaths, ACTIVE_CAP } from '../store';
import { autoPublish } from '../autopublish';
import { missingPictures } from '../pictures';
import { describe, readRequests } from '../requests';
import { workDir, workSnapshot } from '../work';
import { judgeRequest, RequestAction } from './request';

export interface ReviewOptions {
  port?: number;
  open?: boolean;
  cwd?: string;
}

const PAGE = path.join(__dirname, '..', '..', 'templates', 'review.html');

export function review(opts: ReviewOptions = {}): Promise<void> {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const cwd = root;

  const state = () => {
    const comments = readComments(paths);
    const candidates = readCandidates(paths).map((c) => ({
      ...c,
      snapshotUrl: c.snapshot ? `/snapshots/${c.snapshot}` : null,
      decisions: decisionsFor(paths, c.id).map((d) => ({ id: d.id, decision: d.decision, verdict: d.verdict })),
      comments: comments.filter((x) => x.candidate_id === c.id),
    }));
    const byId = new Map(candidates.map((c) => [c.id, c]));
    const version = readLinkOrNull(paths)?.boardVersion ?? null;
    const archive = readArchive(paths);
    // The card a request was made on: its picture, a candidate's or a piece of work's.
    const shotOf = (screen: string) => {
      if (screen.startsWith('C-')) return byId.get(screen)?.snapshotUrl ?? null;
      const f = workSnapshot(paths, screen);
      return f ? `/snapshots/${path.basename(f)}` : null;
    };
    const active = readActive(paths);
    return {
      project: path.basename(root),
      pending: readPending(paths).map((d) => ({
        ...d,
        // The rule a clash is with, while it's still in force: the page offers Follow / Replace / Keep as exception.
        againstRule: d.against ? active.filter((r) => r.id === d.against).map((r) => ({ id: r.id, decision: r.decision }))[0] ?? null : null,
        candidateName: d.candidate ? byId.get(d.candidate)?.name ?? null : null,
        snapshotUrl: d.candidate ? byId.get(d.candidate)?.snapshotUrl ?? null : null,
        picture: missingPictures(paths, [d], candidates)[0] ?? null,
      })),
      // Open ones to answer; approved ones waiting on the agent — shown so it's clear nothing is lost.
      requests: readRequests(paths)
        .filter((r) => r.status === 'open' || r.status === 'approved')
        .map((r) => ({ ...describe(paths, r, version, archive), snapshotUrl: shotOf(r.screen) })),
      candidates,
      hosted: readLinkOrNull(paths)?.shareUrl ?? null,
      boardVersion: readLinkOrNull(paths)?.boardVersion ?? null,
      active: active.length,
      cap: readConfig(paths)?.activeCap ?? ACTIVE_CAP,
    };
  };

  // Judging twenty items shouldn't mean twenty publishes, so the board is updated once, at the
  // end. The page writes the same files the CLI does, but doesn't go through its handlers.
  let changed = false;

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        await handle(req, res);
      } catch (e) {
        // A broken requests.json, say: the page shows the message instead of the server dying.
        if (!res.headersSent) json(res, 500, { exitCode: 1, errors: [(e as Error).message] });
        else res.end();
      }
    });

    const handle = async (req: http.IncomingMessage, res: http.ServerResponse) => {
      // This machine, by its own name, and nothing else. A site that points a domain of its own at
      // 127.0.0.1 (DNS rebinding) is same-origin to the browser, so the JSON check below can't stop
      // it, but its requests carry that domain as their Host.
      if (!fromHere(req)) {
        res.writeHead(403);
        res.end();
        return;
      }
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(PAGE, 'utf8'));
        return;
      }
      // Every write is JSON from this page. A form or a plain-text POST from another site in the same
      // browser can't set that header without asking first — and nothing here answers when it asks.
      if (req.method === 'POST' && !String(req.headers['content-type'] ?? '').startsWith('application/json')) {
        res.writeHead(415);
        res.end();
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/state') {
        json(res, 200, state());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/judge') {
        const body = JSON.parse(await readBody(req)) as {
          id: string;
          as: JudgeAction;
          to?: string;
          supersedes?: string;
          keepBoth?: boolean;
        };
        const result = judge(body.id, { as: body.as, to: body.to, supersedes: body.supersedes, keepBoth: body.keepBoth, cwd });
        if (result.exitCode === 0) changed = true;
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/judge-all') {
        const body = JSON.parse(await readBody(req)) as { as: JudgeAction; level?: string; trigger?: string };
        const result = judgeAll({ as: body.as, level: body.level, trigger: body.trigger, cwd });
        if (result.exitCode === 0) changed = true;
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/request') {
        const body = JSON.parse(await readBody(req)) as { id: string; as: RequestAction; to?: string; why?: string };
        const result = judgeRequest(body.id, { as: body.as, to: body.to, why: body.why, cwd });
        if (result.exitCode === 0) changed = true;
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/snapshots/')) {
        const file = path.basename(url.pathname);
        const abs = path.join(file.startsWith('W-') ? workDir(paths) : candidatesDir(paths), file);
        if (!/^(C-\d{4,}|W-[a-z0-9-]{1,48})\.(png|jpe?g|webp|gif|svg)$/.test(file) || !fs.existsSync(abs)) {
          res.writeHead(404);
          res.end();
          return;
        }
        const type = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.svg': 'image/svg+xml' }[path.extname(file)] ?? 'application/octet-stream';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache' });
        fs.createReadStream(abs).pipe(res);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/candidate') {
        const body = JSON.parse(await readBody(req)) as { id: string; state: string; why?: string; keepOthers?: boolean };
        const result = updateCandidate(body.id, { state: body.state, why: body.why, keepOthers: body.keepOthers, cwd });
        if (result.exitCode === 0) changed = true;
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/done') {
        json(res, 200, { ok: true });
        stop();
        return;
      }
      res.writeHead(404);
      res.end();
    };

    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}/`;
      let s: ReturnType<typeof state>;
      try {
        s = state();
      } catch (e) {
        process.stderr.write(`arbiter: ${(e as Error).message}\n`);
        process.exitCode = 1;
        stop();
        return;
      }
      const asks = s.requests.filter((r) => r.status === 'open').length;
      process.stdout.write(`Arbiter review — ${s.pending.length} pending${asks ? ` · ${asks} request${asks === 1 ? '' : 's'}` : ''} · ${s.candidates.length} candidate${s.candidates.length === 1 ? '' : 's'} · ${s.active} of ${s.cap} rules\n${url}\nPress Done in the page, or Ctrl-C here, to stop.\n`);
      if (opts.open !== false) openBrowser(url);
    });

    // Browsers keep connections alive; close() alone would wait on them forever.
    const stop = () => {
      server.close(async () => {
        if (changed) {
          const line = await autoPublish(cwd);
          if (line) process.stdout.write(line + '\n');
        }
        resolve();
      });
      server.closeAllConnections();
    };
    process.on('SIGINT', stop);
  });
}

const LOCAL = /^(127\.0\.0\.1|localhost|\[::1\])(:\d+)?$/i;

/** Addressed to this machine, and, when a page sent it, sent by a page on this machine. */
export function fromHere(req: Pick<http.IncomingMessage, 'headers'>): boolean {
  if (!LOCAL.test(String(req.headers.host ?? ''))) return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    return LOCAL.test(new URL(origin).host);
  } catch {
    return false;
  }
}

function json(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve) => {
    let data = '';
    req.setEncoding('utf8');
    req.on('data', (c) => (data += c));
    req.on('end', () => resolve(data));
  });
}

function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
  const args = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(cmd, args, { stdio: 'ignore', detached: true }).unref();
  } catch {
    // Printed URL is the fallback.
  }
}
