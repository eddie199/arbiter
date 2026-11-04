/**
 * `arbiter review` — the local board: what's waiting for review, and everything decided.
 *
 * Plain node:http on 127.0.0.1. The page is built from board/ into templates/board, and its data from
 * the project's files (src/localboard.ts); it reads and writes the same files the CLI does and has no
 * state of its own. It's meant to stay open beside the work: the page redraws when the files
 * change, whoever changed them. Stops a few seconds after its last tab closes, or on Ctrl-C.
 * Each project gets the same address every time (steadyPort), so a tab you kept picks up again
 * when the board restarts, and running it twice opens the one already running.
 *
 * Every answer is added to the handoff (src/handoff.ts) as it's given: what's left for the agent
 * to do in the code, which it takes with your next message or at the next /arbiter. With `json`,
 * an agent is waiting on the page instead, and gets the handoff when the last tab closes.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { judge, judgeAll, JudgeAction, Judgement, retire, reword, unjudge, unretire } from './record';
import { updateCandidate } from './candidate';
import { candidatesDir, readCandidates } from '../candidates';
import { findRoot, readActive, readPending, resolvePaths } from '../store';
import { autoPublish } from '../autopublish';
import { workDir } from '../work';
import { liveBoard, reviewState } from '../localboard';
import { Answer, clearHandoff, Handoff, HANDOFF_NAME, readHandoff, saveAnswer, summarize, withdrawAnswer, withdrawRemoval } from '../handoff';
import { hookInstalled } from '../hook';
import type { Decision } from '../schema';

export interface ReviewOptions {
  port?: number;
  open?: boolean;
  /** The agent opened the page and waits on the handoff: it gets it, so nothing is saved for later. */
  json?: boolean;
  cwd?: string;
  /** How long after the last tab closes the board stops, in ms: a reload comes back well within it. */
  grace?: number;
}

const GRACE = 10_000;

// Where projects' boards live: below the ports Windows and macOS hand out for outgoing connections,
// and clear of the usual dev servers. A project whose port is taken tries the next few.
const STEADY_FROM = 47000;
const STEADY_SPAN = 1000;
const STEADY_TRIES = 10;

/** The same folder on Windows, whatever its case. */
const sameFolder = (dir: string) => (process.platform === 'win32' ? path.resolve(dir).toLowerCase() : path.resolve(dir));

/** This project's board's port: the same every time for the same folder, so its address doesn't change. */
export function steadyPort(root: string): number {
  return STEADY_FROM + (crypto.createHash('sha1').update(sameFolder(root)).digest().readUInt32BE(0) % STEADY_SPAN);
}

// Geist, as on arbiter.design. Shipped with the package: the page never loads anything from the network.
const FONTS = path.join(__dirname, '..', '..', 'templates', 'fonts');
const FONT_FILES = new Set(['Geist-Variable.woff2', 'GeistMono-Variable.woff2']);
// The local board's page, built from board/ by `npm run build`.
const BOARD = path.join(__dirname, '..', '..', 'templates', 'board');
const BOARD_FILES: Record<string, string> = { '/': 'index.html', '/board.js': 'board.js', '/board.css': 'board.css' };
const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

export function review(opts: ReviewOptions = {}): Promise<Handoff> {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const cwd = root;

  // The review queue, and when the agent makes a code change you ask for: when the last tab closes if
  // it's waiting on the page, with your next message if the Claude Code hook is installed, else at the
  // next /arbiter.
  const state = () => reviewState(paths, opts.json ? 'waiting' : hookInstalled(root) ? 'next-message' : 'arbiter');

  // Judging twenty items shouldn't mean twenty publishes, so the board is updated once, at the
  // end. The page writes the same files the CLI does, but doesn't go through its handlers.
  const boardData = () => liveBoard(paths);

  // What the board is drawn from, as one value that changes when any of it does: the page checks it
  // every few seconds and redraws only then, so work the agent records shows up without a reload.
  // The handoff isn't part of the board, and changes with every answer anyway; nor is .gitignore,
  // which the first answer adds the handoff to.
  const stamp = () => {
    let files = 0;
    let bytes = 0;
    let latest = 0;
    const visit = (f: string) => {
      let st: fs.Stats;
      try { st = fs.statSync(f); } catch { return; }
      if (st.isDirectory()) {
        for (const e of fs.readdirSync(f)) if (e !== HANDOFF_NAME && e !== '.gitignore') visit(path.join(f, e));
        return;
      }
      files++;
      bytes += st.size;
      latest = Math.max(latest, st.mtimeMs);
    };
    for (const f of [paths.decisions, paths.archiveDir, paths.config]) visit(f);
    return `${files}.${bytes}.${latest}`;
  };

  let changed = false;
  // Every answer that went through, in order: the terminal's line about this sitting.
  const answers: Answer[] = [];
  // Each one is handed over as it's given, so the agent can take it while the board stays open.
  const answer = (a: Answer) => {
    answers.push(a);
    saveAnswer(paths, a);
  };
  // What each judgement on the page did, by its queued id, so a misclick can be taken back while the board is open.
  const judged = new Map<string, { j: Judgement; a: Extract<Answer, { kind: 'decision' }> }>();
  const judgedAs = (j: Judgement, a: Extract<Answer, { kind: 'decision' }>) => {
    judged.set(j.item.id, { j, a });
    answer(a);
  };
  // Each rule removed on the Design rules page, as it was, so Undo can put it back.
  const retired = new Map<string, { rule: Decision; id: string; a: Answer }>();

  // The tabs showing the board. Each one says it's there whenever it checks for changes, and says
  // goodbye as it closes; when the last one has gone and none comes back (a reload does), the board stops.
  const pages = new Set<string>();
  let closing: NodeJS.Timeout | null = null;
  let finish: (how: Handoff['finished']) => void = () => {};
  const seen = (page: string) => {
    pages.add(page);
    if (closing) clearTimeout(closing);
    closing = null;
  };
  const gone = (page: string) => {
    pages.delete(page);
    if (!pages.size && !closing) closing = setTimeout(() => finish('done'), opts.grace ?? GRACE);
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
      // DECISIONS.md as it is, for Download on Design rules: the file the agent reads, not a copy of it.
      if (req.method === 'GET' && url.pathname === '/api/decisions') {
        const text = fs.existsSync(paths.decisions) ? fs.readFileSync(paths.decisions, 'utf8') : '';
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="DECISIONS.md"', 'cache-control': 'no-store' });
        res.end(text);
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
        // Read before judging: judging takes it off the queue, and a rule it replaces out of DECISIONS.md.
        const queued = readPending(paths);
        const at = queued.findIndex((d) => d.id === body.id);
        const item = queued[at];
        const active = readActive(paths);
        const was = active.findIndex((d) => d.id === body.supersedes);
        const result = judge(body.id, { as: body.as, to: body.to, supersedes: body.supersedes, keepBoth: body.keepBoth, cwd });
        if (result.exitCode === 0 && item) {
          changed = true;
          const id = body.as === 'skip' ? undefined : String(result.output.id);
          judgedAs(
            { item, at, id, ...(was !== -1 && result.output.supersedes === body.supersedes && { replaced: { rule: active[was], at: was } }) },
            { kind: 'decision', pending: body.id, as: body.as, id, change: item.change ?? item.decision, to: body.to, follows: body.follows },
          );
        }
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/judge-all') {
        const body = JSON.parse(await readBody(req)) as { as: JudgeAction; level?: string; trigger?: string };
        const queued = readPending(paths);
        const result = judgeAll({ as: body.as, level: body.level, trigger: body.trigger, cwd });
        if (result.exitCode === 0) changed = true;
        // A partial run still recorded some: each one that went through is an answer. They went in
        // queue order, so the ones that didn't fail line up with what they were recorded as.
        const failed = new Set(((result.output.failed as { id: string }[] | undefined) ?? []).map((f) => f.id));
        const through = queued.filter((d) => (!body.level || d.level === body.level) && (!body.trigger || d.trigger === body.trigger) && !failed.has(d.id));
        ((result.output.judged as string[] | undefined) ?? []).forEach((judgedId, k) => {
          const item = through[k];
          if (!item) return;
          const id = body.as === 'skip' ? undefined : judgedId;
          judgedAs({ item, at: queued.indexOf(item), id }, { kind: 'decision', pending: item.id, as: body.as, id, change: item.change ?? item.decision });
        });
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/undo') {
        const body = JSON.parse(await readBody(req)) as { id: string };
        const was = judged.get(body.id);
        if (!was) {
          json(res, 200, { exitCode: 1, status: 'invalid', errors: [`Only what was judged on this board since it started can be undone`] });
          return;
        }
        const result = unjudge(was.j, { cwd });
        if (result.exitCode === 0) {
          changed = true;
          judged.delete(body.id);
          answers.splice(answers.indexOf(was.a), 1);
          // A fix the agent has taken may be in the code already: the record is back, the code may not be.
          if (!withdrawAnswer(paths, was.a) && was.a.as === 'fix') result.output.taken = true;
        }
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/reword') {
        const body = JSON.parse(await readBody(req)) as { id: string; to: string };
        const result = reword(body.id, body.to, { cwd });
        // The agent may have read the old words already: it hears the new ones as it hears a fix.
        if (result.exitCode === 0) {
          changed = true;
          answer({ kind: 'reword', id: body.id, to: String(result.output.decision) });
        }
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/retire') {
        const body = JSON.parse(await readBody(req)) as { id: string; why: string };
        const rule = readActive(paths).find((d) => d.id === body.id);
        const result = retire(body.id, body.why, { cwd });
        if (result.exitCode === 0 && rule) {
          changed = true;
          const a: Answer = { kind: 'retire', id: body.id, rule: rule.decision, why: body.why.trim() };
          retired.set(body.id, { rule, id: String(result.output.id), a });
          answer(a);
        }
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/unretire') {
        const body = JSON.parse(await readBody(req)) as { id: string };
        const was = retired.get(body.id);
        if (!was) {
          json(res, 200, { exitCode: 1, status: 'invalid', errors: [`Only a rule removed on this board since it started can be put back`] });
          return;
        }
        const result = unretire(was, { cwd });
        if (result.exitCode === 0) {
          changed = true;
          retired.delete(body.id);
          // Not heard of yet: the agent never hears of it. Heard of: it hears the rule is back.
          if (withdrawRemoval(paths, body.id)) answers.splice(answers.indexOf(was.a), 1);
          else answer({ kind: 'restore', id: body.id });
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
          answer({ kind: 'option', id: body.id, name: c?.name ?? body.id, state: body.state });
        }
        json(res, 200, { exitCode: result.exitCode, ...result.output });
        return;
      }
      if (req.method === 'GET' && url.pathname === '/api/stamp') {
        const page = url.searchParams.get('page');
        if (page) seen(page);
        json(res, 200, { stamp: stamp() });
        return;
      }
      // Which project's board this is: a second `arbiter review` asks, to open this one instead.
      if (req.method === 'GET' && url.pathname === '/api/who') {
        json(res, 200, { board: 'arbiter', root });
        return;
      }
      if (req.method === 'POST' && url.pathname === '/api/bye') {
        const body = JSON.parse(await readBody(req)) as { page?: string };
        if (body.page) gone(body.page);
        json(res, 200, { ok: true });
        return;
      }
      res.writeHead(404);
      res.end();
    };

    // This project's own port, or the next free one after it. Already running there: open that one,
    // unless an agent is waiting on this sitting's handoff, which only a board of its own can give it.
    const place = async () => {
      const steady = steadyPort(root);
      const ports = opts.port !== undefined ? [opts.port] : Array.from({ length: STEADY_TRIES }, (_, i) => steady + i);
      for (const port of ports) {
        if (await listen(server, port)) return started();
        const there = await whoIsAt(port);
        if (there && sameFolder(there) === sameFolder(root) && !opts.json) {
          const url = `http://127.0.0.1:${port}/`;
          say(`Arbiter review is already open for this project.\n${url}#/review\n`);
          if (opts.open !== false) openBrowser(`${url}#/review`);
          return stop('closed');
        }
      }
      if (opts.port === undefined && (await listen(server, 0))) return started();
      process.stderr.write(`arbiter: port ${opts.port} is in use.\n`);
      process.exitCode = 1;
      stop('closed');
    };
    const started = () => {
      const addr = server.address() as { port: number };
      const url = `http://127.0.0.1:${addr.port}/`;
      let s: ReturnType<typeof state>;
      let candidates: number;
      try {
        s = state();
        candidates = readCandidates(paths).length;
      } catch (e) {
        process.stderr.write(`arbiter: ${(e as Error).message}\n`);
        process.exitCode = 1;
        stop('closed');
        return;
      }
      // With --json, stdout is the handoff and nothing else; the agent reads it whole.
      say(`Arbiter review — ${s.pending.length} pending · ${candidates} candidate${candidates === 1 ? '' : 's'} · ${s.active} of ${s.cap} rules\n${url}#/review\nClose the tab, or press Ctrl-C here, to stop.\n`);
      // Straight to what's waiting: that's what `review` is opened for.
      if (opts.open !== false) openBrowser(`${url}#/review`);
    };
    place().catch((e: Error) => {
      process.stderr.write(`arbiter: ${e.message}\n`);
      process.exitCode = 1;
      stop('closed');
    });

    const say = (text: string) => (opts.json ? process.stderr : process.stdout).write(text);

    // Browsers keep connections alive; close() alone would wait on them forever.
    let stopping = false;
    const stop = (how: Handoff['finished']) => {
      if (stopping) return;
      stopping = true;
      if (closing) clearTimeout(closing);
      process.removeListener('SIGINT', onSigint);
      server.close(async () => {
        if (changed) {
          const line = await autoPublish(cwd);
          if (line) say(line + '\n');
        }
        // An agent waiting on the page gets everything waiting for it, this sitting's and any before,
        // so it's not kept for later as well. Stopped any other way, it may not have been there to
        // read it: it stays. Nobody waiting: the terminal hears about this sitting, and it all stays.
        const waiting = readHandoff(paths);
        if (opts.json && waiting) {
          if (how === 'done') clearHandoff(paths);
          resolve({ ...waiting, finished: how });
        } else resolve(summarize(answers, how));
      });
      server.closeAllConnections();
    };
    finish = stop;
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

/** Listens on the port if it's free: false when something else has it, or the system keeps it back. */
function listen(server: http.Server, port: number): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const failed = (e: NodeJS.ErrnoException) => {
      server.removeListener('listening', ok);
      if (e.code === 'EADDRINUSE' || e.code === 'EACCES') resolve(false);
      else reject(e);
    };
    const ok = () => {
      server.removeListener('error', failed);
      resolve(true);
    };
    server.once('error', failed);
    server.once('listening', ok);
    server.listen(port, '127.0.0.1');
  });
}

/** The project folder of the Arbiter board on this port, or null if it's something else or nothing answers. */
function whoIsAt(port: number): Promise<string | null> {
  return new Promise((resolve) => {
    const req = http.get({ host: '127.0.0.1', port, path: '/api/who', timeout: 1000 }, (res) => {
      let data = '';
      res.setEncoding('utf8');
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          const body = JSON.parse(data) as { board?: string; root?: string };
          resolve(res.statusCode === 200 && body.board === 'arbiter' && body.root ? body.root : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(null));
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
