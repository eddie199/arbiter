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
import { readComments, readLink } from '../hosted';
import { findRoot, readActive, readConfig, readPending, resolvePaths, ACTIVE_CAP } from '../store';

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
    return {
      project: path.basename(root),
      pending: readPending(paths).map((d) => ({ ...d, candidateName: d.candidate ? byId.get(d.candidate)?.name ?? null : null, snapshotUrl: d.candidate ? byId.get(d.candidate)?.snapshotUrl ?? null : null })),
      candidates,
      hosted: readLink(paths)?.shareUrl ?? null,
      boardVersion: readLink(paths)?.boardVersion ?? null,
      active: readActive(paths).length,
      cap: readConfig(paths)?.activeCap ?? ACTIVE_CAP,
    };
  };

  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (req.method === 'GET' && url.pathname === '/') {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        res.end(fs.readFileSync(PAGE, 'utf8'));
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
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/judge-all') {
        const body = JSON.parse(await readBody(req)) as { as: JudgeAction; level?: string; trigger?: string };
        const result = judgeAll({ as: body.as, level: body.level, trigger: body.trigger, cwd });
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'GET' && url.pathname.startsWith('/snapshots/')) {
        const file = path.basename(url.pathname);
        const abs = path.join(candidatesDir(paths), file);
        if (!/^C-\d{4,}\.(png|jpe?g|webp|gif|svg)$/.test(file) || !fs.existsSync(abs)) {
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
    });

    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}/`;
      const s = state();
      process.stdout.write(`Arbiter review — ${s.pending.length} pending · ${s.candidates.length} candidate${s.candidates.length === 1 ? '' : 's'} · ${s.active} of ${s.cap} rules\n${url}\nPress Done in the page, or Ctrl-C here, to stop.\n`);
      if (opts.open !== false) openBrowser(url);
    });

    // Browsers keep connections alive; close() alone would wait on them forever.
    const stop = () => {
      server.close(() => resolve());
      server.closeAllConnections();
    };
    process.on('SIGINT', stop);
  });
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
