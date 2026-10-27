/**
 * `arbiter review` — the local board: what's waiting for review, and everything decided.
 *
 * Plain node:http on 127.0.0.1. The page is the team board's own, built in the site repo
 * (hosted/local) into templates/board; it reads and writes the same files the CLI does and has no
 * state of its own. Stops when the user presses Done or Ctrl-C.
 *
 * It keeps every answer given, and resolves with the handoff (src/handoff.ts): what was decided,
 * and what's left for the agent to do in the code. With `json`, the agent opened the page and is
 * waiting for that; without, it's saved for the next /arbiter.
 */

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { judge, judgeAll, JudgeAction } from './record';
import { updateCandidate } from './candidate';
import { candidatesDir, decisionsFor, readCandidates } from '../candidates';
import { buildManifest, readComments, readLinkOrNull } from '../hosted';
import { findRoot, readActive, readArchive, readConfig, readPending, resolvePaths, ACTIVE_CAP } from '../store';
import { autoPublish } from '../autopublish';
import { missingPictures } from '../pictures';
import { describe, readRequests } from '../requests';
import { workDir, workId, workSnapshot } from '../work';
import { judgeRequest, RequestAction } from './request';
import { Answer, clearHandoff, decidedAnything, Handoff, mergeHandoffs, readHandoff, saveHandoff, summarize } from '../handoff';

export interface ReviewOptions {
  port?: number;
  open?: boolean;
  /** The agent opened the page and waits on the handoff: it gets it, so nothing is saved for later. */
  json?: boolean;
  cwd?: string;
}

// Geist, as on arbiter.design. Shipped with the package: the page never loads anything from the network.
const FONTS = path.join(__dirname, '..', '..', 'templates', 'fonts');
const FONT_FILES = new Set(['Geist-Variable.woff2', 'GeistMono-Variable.woff2']);
// The local board: the team board's pages, built in the site repo (hosted/local) and copied here.
const BOARD = path.join(__dirname, '..', '..', 'templates', 'board');
const BOARD_FILES: Record<string, string> = { '/': 'index.html', '/board.js': 'board.js', '/board.css': 'board.css' };
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function review(opts: ReviewOptions = {}): Promise<Handoff> {
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
      // The rules in force, for the Rules tab: what's already settled before you make another.
      rules: active,
      // An agent is waiting on Done: the page says so instead of "at the next /arbiter".
      handoff: !!opts.json,
      active: active.length,
      cap: readConfig(paths)?.activeCap ?? ACTIVE_CAP,
    };
  };

  // Judging twenty items shouldn't mean twenty publishes, so the board is updated once, at the
  // end. The page writes the same files the CLI does, but doesn't go through its handlers.
  // What the local board draws: the manifest `publish` uploads, its pictures as links served here,
  // and what only this machine knows: what's waiting for review, and the team's pulled comments.
  const boardData = () => {
    const { manifest } = buildManifest(paths, { includeRules: true, pictures: 'link' });
    const queued = readPending(paths);
    const waiting: Record<string, number> = {};
    for (const d of queued) {
      if (d.level === 'polish') continue;
      const card = d.candidate ?? workId(d.trigger);
      waiting[card] = (waiting[card] ?? 0) + 1;
    }
    const link = readLinkOrNull(paths);
    return { board: manifest, comments: readComments(paths), waiting, pending: queued.length, hosted: link?.shareUrl ?? null, version: link?.boardVersion ?? null, live: true };
  };

  let changed = false;
  // Every answer that went through, in order, for the handoff.
  const answers: Answer[] = [];
  // A sitting before this one that nobody acted on yet: it's handed over with this one.
  const earlier = readHandoff(paths);
  const sitting = (how: Handoff['finished']) => mergeHandoffs(earlier, summarize(answers, how));
  // Saved after every answer, so a page stopped some other way (an agent's command cut off,
  // a closed terminal) still leaves its answers for the next /arbiter.
  const keep = () => {
    const h = sitting('closed');
    if (decidedAnything(h)) saveHandoff(paths, h);
  };

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

      if (req.method === 'GET' && BOARD_FILES[url.pathname]) {
        const file = path.join(BOARD, BOARD_FILES[url.pathname]);
        res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'cache-control': 'no-cache' });
        fs.createReadStream(file).pipe(res);
        return;
      }
      // Where the board was before the review queue moved into it.
      if (req.method === 'GET' && (url.pathname === '/board' || url.pathname === '/board/')) {
        res.writeHead(301, { location: '/' });
        res.end();
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
      if (req.method === 'GET' && url.pathname === '/api/board') {
        json(res, 200, boardData());
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/judge') {
        const body = JSON.parse(await readBody(req)) as {
          id: string;
          as: JudgeAction;
          to?: string;
          supersedes?: string;
          keepBoth?: boolean;
          /** Follow D-0009 on a clash: a fix to the rule's wording, and the code goes back to the rule. */
          follows?: string;
        };
        // Read before judging: judging takes it off the queue.
        const item = readPending(paths).find((d) => d.id === body.id);
        const result = judge(body.id, { as: body.as, to: body.to, supersedes: body.supersedes, keepBoth: body.keepBoth, cwd });
        if (result.exitCode === 0) {
          changed = true;
          answers.push({
            kind: 'decision',
            pending: body.id,
            as: body.as,
            id: body.as === 'skip' ? undefined : String(result.output.id),
            change: item?.change ?? item?.decision,
            to: body.to,
            follows: body.follows,
          });
          keep();
        }
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/judge-all') {
        const body = JSON.parse(await readBody(req)) as { as: JudgeAction; level?: string; trigger?: string };
        const result = judgeAll({ as: body.as, level: body.level, trigger: body.trigger, cwd });
        if (result.exitCode === 0) changed = true;
        // A partial run still recorded some: each one that went through is an answer.
        for (const id of (result.output.judged as string[] | undefined) ?? []) {
          answers.push({ kind: 'decision', pending: id, as: body.as, id: body.as === 'skip' ? undefined : id });
        }
        keep();
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/request') {
        const body = JSON.parse(await readBody(req)) as { id: string; as: RequestAction; to?: string; why?: string };
        const result = judgeRequest(body.id, { as: body.as, to: body.to, why: body.why, cwd });
        if (result.exitCode === 0) {
          changed = true;
          const o = result.output;
          answers.push({
            kind: 'request',
            id: body.id,
            status: o.status === 'declined' ? 'declined' : 'approved',
            author: String(o.author),
            screenName: (o.screenName as string | null) ?? null,
            do: o.do as string | undefined,
            reason: o.reason as string | undefined,
          });
          keep();
        }
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
      if (req.method === 'GET' && url.pathname.startsWith('/fonts/')) {
        const file = path.basename(url.pathname);
        if (!FONT_FILES.has(file)) {
          res.writeHead(404);
          res.end();
          return;
        }
        res.writeHead(200, { 'content-type': 'font/woff2', 'cache-control': 'max-age=86400' });
        fs.createReadStream(path.join(FONTS, file)).pipe(res);
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/candidate') {
        const body = JSON.parse(await readBody(req)) as { id: string; state: string; why?: string; keepOthers?: boolean };
        const result = updateCandidate(body.id, { state: body.state, why: body.why, keepOthers: body.keepOthers, cwd });
        if (result.exitCode === 0) {
          changed = true;
          const c = readCandidates(paths).find((x) => x.id === body.id);
          answers.push({ kind: 'option', id: body.id, name: c?.name ?? body.id, state: body.state });
          keep();
        }
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/done') {
        json(res, 200, { ok: true });
        stop('done');
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
        stop('closed');
        return;
      }
      const asks = s.requests.filter((r) => r.status === 'open').length;
      // With --json, stdout is the handoff and nothing else; the agent reads it whole.
      say(`Arbiter review — ${s.pending.length} pending${asks ? ` · ${asks} request${asks === 1 ? '' : 's'}` : ''} · ${s.candidates.length} candidate${s.candidates.length === 1 ? '' : 's'} · ${s.active} of ${s.cap} rules\n${url}#/review\nPress Done in the page, or Ctrl-C here, to stop.\n`);
      // Straight to what's waiting: that's what `review` is opened for.
      if (opts.open !== false) openBrowser(`${url}#/review`);
    });

    const say = (text: string) => (opts.json ? process.stderr : process.stdout).write(text);

    // Browsers keep connections alive; close() alone would wait on them forever.
    let stopping = false;
    const stop = (how: Handoff['finished']) => {
      if (stopping) return;
      stopping = true;
      process.removeListener('SIGINT', onSigint);
      server.close(async () => {
        if (changed) {
          const line = await autoPublish(cwd);
          if (line) say(line + '\n');
        }
        const handoff = sitting(how);
        // The agent waiting on Done gets it now, so it's not saved for later as well. Stopped any
        // other way, the agent may not have been there to read it: it stays for the next /arbiter.
        if (opts.json && how === 'done') clearHandoff(paths);
        else if (decidedAnything(handoff)) saveHandoff(paths, handoff);
        resolve(handoff);
      });
      server.closeAllConnections();
    };
    const onSigint = () => stop('closed');
    process.on('SIGINT', onSigint);
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
