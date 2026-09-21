/**
 * `arbiter export` — a static, self-contained folder of the board for people
 * without the repo. index.html + snapshots. No server, no JS, no login.
 *
 * Stakeholder view only: screen, state, who approved, why the others lost,
 * what was decided — in plain Change language. No verdict buttons, no scope
 * tags. Feedback comes back through a human; comments never become rules.
 *
 * The cheap test of Stage 6's assumption: does a stakeholder, given a link,
 * actually look?
 */

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { Candidate, CandidateState, candidatesDir, decisionsFor, readCandidates } from '../candidates';
import { Decision, DIMENSIONS, Dimension } from '../schema';
import { DIMENSION_LABELS } from '../format';
import { findRoot, readActive, readConfig, resolvePaths } from '../store';

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

const STATE_ORDER: CandidateState[] = ['approved', 'in_review', 'generated', 'rejected', 'superseded'];
const STATE_LABEL: Record<CandidateState, string> = { approved: 'Approved', in_review: 'In review', generated: 'Generated', rejected: 'Rejected', superseded: 'Superseded' };

export function exportBoard(opts: ExportOptions = {}): ExportResult {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const outDir = path.resolve(root, opts.out ?? 'arbiter-export');
  const snapDir = path.join(outDir, 'snapshots');
  fs.mkdirSync(snapDir, { recursive: true });

  let candidates = readCandidates(paths);
  if (opts.feature) candidates = candidates.filter((c) => c.feature === opts.feature);
  const byId = new Map(candidates.map((c) => [c.id, c]));

  let snapshots = 0;
  for (const c of candidates) {
    if (!c.snapshot) continue;
    const src = path.join(candidatesDir(paths), c.snapshot);
    if (!fs.existsSync(src)) continue;
    fs.copyFileSync(src, path.join(snapDir, c.snapshot));
    snapshots++;
  }

  const project = readConfig(paths)?.author ? path.basename(root) : path.basename(root);
  const html = page({
    project,
    generated: new Date().toISOString().slice(0, 10),
    candidates,
    byId,
    decisions: (id: string) => decisionsFor(paths, id).filter((d) => d.verdict !== 'pending' && d.level !== 'polish'),
    rules: opts.includeRules ? readActive(paths) : null,
  });
  const index = path.join(outDir, 'index.html');
  fs.writeFileSync(index, html);

  if (opts.open) {
    const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'cmd' : 'xdg-open';
    const args = process.platform === 'win32' ? ['/c', 'start', '', index] : [index];
    try { spawn(cmd, args, { stdio: 'ignore', detached: true }).unref(); } catch { /* path is printed anyway */ }
  }
  return { dir: outDir, index, candidates: candidates.length, snapshots };
}

// ── rendering ──────────────────────────────────────────────────────────────

interface PageData {
  project: string;
  generated: string;
  candidates: Candidate[];
  byId: Map<string, Candidate>;
  decisions: (id: string) => Decision[];
  rules: Decision[] | null;
}

function page(d: PageData): string {
  const features = [...new Set(d.candidates.map((c) => c.feature ?? 'Other'))];
  const body = d.candidates.length
    ? features.map((f) => section(f, d.candidates.filter((c) => (c.feature ?? 'Other') === f), d)).join('\n')
    : `<p class="empty">Nothing to show yet.</p>`;
  const rules = d.rules ? rulesSection(d.rules) : '';
  const counts = STATE_ORDER.map((s) => [s, d.candidates.filter((c) => c.state === s).length] as const).filter(([, n]) => n);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(d.project)} — design decisions</title>
<style>
  :root { color-scheme: light dark; --bg:#fafaf9; --card:#fff; --ink:#1c1917; --muted:#78716c; --line:#e7e5e4; --tag:#f5f5f4; --ok:#15803d; --bad:#b91c1c; --warn:#b45309; }
  @media (prefers-color-scheme: dark) { :root { --bg:#0c0a09; --card:#1c1917; --ink:#fafaf9; --muted:#a8a29e; --line:#292524; --tag:#292524; --ok:#4ade80; --bad:#f87171; --warn:#fbbf24; } }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--ink); font:16px/1.55 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif; padding:0 20px 80px; }
  header, main { max-width: 920px; margin: 0 auto; }
  header { padding: 40px 0 8px; }
  header h1 { font-size: 22px; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
  header p { color: var(--muted); margin: 6px 0 0; font-size: 14px; }
  h2 { font-size: 13px; font-weight: 600; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 44px 0 14px; }
  .cand { display: grid; grid-template-columns: minmax(0,1fr) minmax(0,1fr); gap: 24px; background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 22px 24px; margin-bottom: 14px; }
  .cand.lesser { grid-template-columns: 220px minmax(0,1fr); padding: 16px 20px; opacity: .85; }
  @media (max-width: 680px) { .cand, .cand.lesser { grid-template-columns: 1fr; } }
  .shot { border: 1px solid var(--line); border-radius: 8px; overflow: hidden; background: var(--tag); min-height: 60px; display:flex; align-items:center; justify-content:center; color: var(--muted); font-size: 13px; }
  .shot img { display:block; width:100%; height:auto; }
  h3 { font-size: 18px; font-weight: 600; margin: 0 0 4px; letter-spacing: -0.01em; }
  .lesser h3 { font-size: 15px; }
  .state { font-size: 12px; font-weight: 500; padding: 2px 9px; border-radius: 999px; background: var(--tag); color: var(--muted); vertical-align: 2px; margin-left: 8px; }
  .state.approved { color: var(--ok); } .state.rejected, .state.superseded { color: var(--bad); } .state.in_review { color: var(--warn); }
  .who { color: var(--muted); font-size: 14px; margin: 0 0 10px; }
  .reason { font-style: italic; margin: 0 0 12px; }
  .decs h4 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); margin: 14px 0 6px; font-weight: 600; }
  .decs ul { margin: 0; padding-left: 18px; }
  .decs li { margin: 3px 0; }
  .decs li small { color: var(--muted); display: block; }
  .empty { color: var(--muted); text-align: center; padding: 80px 0; }
  .rules { margin-top: 60px; border-top: 1px solid var(--line); padding-top: 30px; }
  .rules ul { padding-left: 18px; } .rules li { margin: 6px 0; } .rules li small { color: var(--muted); display: block; }
  footer { max-width: 920px; margin: 60px auto 0; color: var(--muted); font-size: 13px; }
</style>
</head>
<body>
<header>
  <h1>${esc(d.project)} — design decisions</h1>
  <p>${d.candidates.length} screen${d.candidates.length === 1 ? '' : 's'}${counts.length ? ' · ' + counts.map(([s, n]) => `${n} ${STATE_LABEL[s].toLowerCase()}`).join(' · ') : ''} · exported ${d.generated}</p>
</header>
<main>
${body}
${rules}
</main>
<footer>Read-only. Feedback goes to whoever owns these decisions — they decide what becomes a rule. Made with Arbiter.</footer>
</body>
</html>
`;
}

function section(feature: string, cands: Candidate[], d: PageData): string {
  const sorted = [...cands].sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || a.id.localeCompare(b.id));
  return `<h2>${esc(feature)}</h2>\n${sorted.map((c) => card(c, d)).join('\n')}`;
}

function card(c: Candidate, d: PageData): string {
  const lesser = c.state === 'rejected' || c.state === 'superseded';
  const by = c.supersededBy ? d.byId.get(c.supersededBy) : null;
  const state = c.state === 'superseded' && by ? `Superseded by ${esc(by.name)}` : STATE_LABEL[c.state];
  const shot = c.snapshot ? `<img src="snapshots/${esc(c.snapshot)}" alt="${esc(c.name)}">` : 'No screenshot';
  const decs = d.decisions(c.id);
  const decisions = decs.length
    ? `<div class="decs"><h4>Decided here</h4><ul>${decs.map((x) => `<li>${esc(x.change ?? x.decision)}${x.rejected.length ? `<small>over ${esc(x.rejected.map((r) => r.split(' — ')[0]).join(', '))}</small>` : ''}</li>`).join('')}</ul></div>`
    : '';
  return `<article class="cand${lesser ? ' lesser' : ''}">
  <div class="shot">${shot}</div>
  <div>
    <h3>${esc(c.name)}<span class="state ${c.state}">${state}</span></h3>
    <p class="who">${esc(c.author)} · ${c.date.slice(0, 10)}</p>
    ${c.reason ? `<p class="reason">“${esc(c.reason)}”</p>` : ''}
    ${c.notes ? `<p>${esc(c.notes)}</p>` : ''}
    ${decisions}
  </div>
</article>`;
}

function rulesSection(rules: Decision[]): string {
  if (!rules.length) return '';
  const groups = DIMENSIONS.map((dim) => [dim, rules.filter((r) => r.dimension === dim)] as const).filter(([, rs]) => rs.length);
  return `<section class="rules"><h2>Standing rules — ${rules.length}</h2>${groups
    .map(([dim, rs]) => `<h4>${DIMENSION_LABELS[dim as Dimension]}</h4><ul>${rs.map((r) => `<li>${esc(r.decision)}<small>${esc(r.rationale)}</small></li>`).join('')}</ul>`)
    .join('')}</section>`;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
}
