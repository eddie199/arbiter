/**
 * `arbiter export` — the local board as a folder, for people without the repo. Open index.html, or
 * put the folder on any static host (`publish --to pages` does). No server, no login.
 *
 * The same pages `arbiter review` serves (templates/board), read-only: every change with its
 * picture, and the design rules if asked for. No review queue, no buttons, and no comments: people
 * wrote those on the team board, not in a file that gets passed around.
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { boardOf } from '../localboard';
import type { LocalBoard } from '../board-types';
import { candidatesDir } from '../candidates';
import { historyFile, workDir } from '../work';
import { findRoot, resolvePaths, rulesName } from '../store';
import { readArrangement } from '../areas';

export interface ExportOptions {
  out?: string;
  feature?: string;
  includeRules?: boolean;
  open?: boolean;
  cwd?: string;
}

export interface ExportResult {
  dir: string;
  index: string;
  candidates: number;
  snapshots: number;
}

const BOARD = path.join(__dirname, '..', '..', 'templates', 'board');
const FONTS = path.join(__dirname, '..', '..', 'templates', 'fonts');
const PICTURES = 'snapshots/';
// Line and paragraph separators end a line inside a <script>, so they are escaped like <.
const LINE_SEP = String.fromCharCode(0x2028);
const PARA_SEP = String.fromCharCode(0x2029);

export function exportBoard(opts: ExportOptions = {}): ExportResult {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const outDir = path.resolve(root, opts.out ?? 'arbiter-export');
  const snapDir = path.join(outDir, 'snapshots');
  // Pictures from an earlier export go: a screen since removed mustn't stay in a folder people get sent.
  // Only those, by their names: anything else in a snapshots/ folder is someone's own, and stays.
  clearPictures(snapDir);
  fs.mkdirSync(snapDir, { recursive: true });

  const manifest = boardOf(paths, { pictures: PICTURES, includeRules: !!opts.includeRules, queued: [] });
  let cards = manifest.candidates;
  if (opts.feature) cards = cards.filter((c) => c.feature === opts.feature);

  let snapshots = 0;
  for (const c of cards) {
    if (!c.snapshot) continue;
    const file = c.snapshot.slice(PICTURES.length);
    const src = path.join(file.startsWith('W-') ? workDir(paths) : candidatesDir(paths), file);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(snapDir, file));
      snapshots++;
    } else c.snapshot = null;
    // Its earlier pictures too, so the copy shows how it got here.
    if (c.versions) {
      c.versions = c.versions.filter((v) => {
        const rel = v.src.slice(PICTURES.length);
        if (rel === file) return true;
        const abs = historyFile(paths, rel);
        if (!abs) return false;
        fs.mkdirSync(path.dirname(path.join(snapDir, rel)), { recursive: true });
        fs.copyFileSync(abs, path.join(snapDir, rel));
        return true;
      });
      if (c.versions.length < 2) delete c.versions;
    }
  }

  // Read-only: `live: false` keeps the review pages, Done and the team board buttons out of it.
  const board = { ...manifest, candidates: cards, requests: [] };
  // The folders as you made them, so the copy's side nav reads the same as yours. Nobody can move them in it.
  const data: LocalBoard = { board, comments: [], waiting: {}, queued: {}, pending: 0, hosted: null, version: null, live: false, arrangement: readArrangement(paths), settings: null, rulesFile: rulesName(paths) };
  // In a <script>, so nothing in a name can close the tag or run.
  const json = JSON.stringify(data).replace(/</g, '\\u003c').split(LINE_SEP).join('\\u2028').split(PARA_SEP).join('\\u2029');
  // Functions, not strings: a `$&` in someone's decision would otherwise be read as a pattern.
  const html = fs.readFileSync(path.join(BOARD, 'index.html'), 'utf8')
    .replace('</head>', () => `<style>${fontFaces()}</style>\n</head>`)
    .replace('<script src="board.js">', () => `<script>window.__ARBITER_BOARD__ = ${json};</script>\n<script src="board.js">`);
  const index = path.join(outDir, 'index.html');
  fs.writeFileSync(index, html);
  for (const f of ['board.js', 'board.css']) fs.copyFileSync(path.join(BOARD, f), path.join(outDir, f));

  if (opts.open) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', index] : [index];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* path is printed anyway */ }
  }
  return { dir: outDir, index, candidates: cards.length, snapshots };
}

/**
 * The pictures an export writes, and only those: a card's or a piece of work's own (C-0001.png,
 * W-settings-billing.png) and its earlier ones under history/<W-…>/. A folder left empty goes too.
 */
function clearPictures(snapDir: string): void {
  const id = /^(C-\d{4,}|W-[a-z0-9-]{1,48})$/;
  const picture = /^(C-\d{4,}|W-[a-z0-9-]{1,48})\.(png|jpe?g|webp|gif|svg)$/;
  const list = (dir: string) => { try { return fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; } };
  for (const e of list(snapDir)) if (e.isFile() && picture.test(e.name)) fs.rmSync(path.join(snapDir, e.name));
  const history = path.join(snapDir, 'history');
  for (const e of list(history)) if (e.isDirectory() && id.test(e.name)) fs.rmSync(path.join(history, e.name), { recursive: true, force: true });
  for (const dir of [history, snapDir]) if (fs.existsSync(dir) && !list(dir).length) fs.rmdirSync(dir);
}

/**
 * Geist, inside the page. Opened from disk, a browser won't load a font file sitting next to it, and
 * the board would fall back to the system font.
 */
function fontFaces(): string {
  const face = (family: string, file: string) =>
    `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${fs.readFileSync(path.join(FONTS, file)).toString('base64')}) format("woff2");font-weight:100 900;font-display:swap}`;
  return face('Geist', 'Geist-Variable.woff2') + face('Geist Mono', 'GeistMono-Variable.woff2');
}
