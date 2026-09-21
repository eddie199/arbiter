/**
 * Talking to a hosted board (the Next.js app in hosted/). The only network
 * code in Arbiter, and it runs only for `publish --to` and `pull`.
 *
 * Two files: .arbiter/hosted.json (committed — which site, which project,
 * the share link) and .arbiter/hosted.token (git-ignored — the publish
 * token). Teammates get the first from git and the second from
 * ARBITER_PUBLISH_TOKEN, so everyone updates the same board.
 */

import fs from 'node:fs';
import path from 'node:path';
import { readCandidates, decisionsFor, candidatesDir } from './candidates';
import { Paths, readActive, readArchive, readConfig } from './store';
import type { Decision } from './schema';
import { workId, workSnapshot } from './work';

export interface HostedLink {
  url: string;        // service base url
  projectId: string;
  slug: string;
  shareUrl: string;
  lastPull?: string;
  /** The board version the service holds, as of the last pull. */
  boardVersion?: string | null;
}

export interface PulledComment {
  id: string;
  candidate_id: string;
  decision_id: string | null;
  kind: 'comment' | 'approve';
  author_name: string;
  author_email: string;
  body: string;
  created_at: string;
  /** The board's published_at when this was written. Differs from the current one after a republish. */
  board_version?: string | null;
}

const LINK_FILE = 'hosted.json';
const TOKEN_FILE = 'hosted.token';
const COMMENTS_FILE = 'comments.json';
export const TOKEN_ENV = 'ARBITER_PUBLISH_TOKEN';
export const ADMIN_ENV = 'ARBITER_ADMIN_TOKEN';
const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

export function readLink(paths: Paths): HostedLink | null {
  const f = path.join(paths.archiveDir, LINK_FILE);
  if (!fs.existsSync(f)) return null;
  const raw = JSON.parse(fs.readFileSync(f, 'utf8')) as HostedLink & { token?: string };
  // Older files carried the token inline; move it to the ignored file.
  if (raw.token) {
    writeToken(paths, raw.token);
    delete raw.token;
    writeLink(paths, raw);
  }
  return raw;
}

export function writeLink(paths: Paths, link: HostedLink): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.writeFileSync(path.join(paths.archiveDir, LINK_FILE), JSON.stringify(link, null, 2) + '\n');
}

/** The publish token: env var first (how a team shares it), then the git-ignored file. */
export function readToken(paths: Paths): string | null {
  const env = process.env[TOKEN_ENV]?.trim();
  if (env) return env;
  const f = path.join(paths.archiveDir, TOKEN_FILE);
  return fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim() || null : null;
}

export function writeToken(paths: Paths, token: string): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  fs.writeFileSync(path.join(paths.archiveDir, TOKEN_FILE), token + '\n', { mode: 0o600 });
  // Keep it out of git. (hosted.json used to be ignored too; it's shareable now.)
  const gi = path.join(paths.archiveDir, '.gitignore');
  const lines = (fs.existsSync(gi) ? fs.readFileSync(gi, 'utf8') : '').split('\n').filter((l) => l && l !== LINK_FILE);
  if (!lines.includes(TOKEN_FILE)) lines.push(TOKEN_FILE);
  fs.writeFileSync(gi, lines.join('\n') + '\n');
}

export function readComments(paths: Paths): PulledComment[] {
  const f = path.join(paths.archiveDir, COMMENTS_FILE);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as PulledComment[]) : [];
}

export function writeComments(paths: Paths, comments: PulledComment[]): void {
  fs.writeFileSync(path.join(paths.archiveDir, COMMENTS_FILE), JSON.stringify(comments, null, 2) + '\n');
}

const publishable = (d: Decision) => d.verdict !== 'pending' && d.verdict !== 'retire' && d.level !== 'polish';
const wire = (d: Decision) => ({ id: d.id, change: d.change, decision: d.decision, rejected: d.rejected, verdict: d.verdict, dimension: d.dimension, scope: d.scope, ref: d.ref });

/**
 * The upload manifest: every judged, non-polish decision, and the rules. A decision attached to a
 * candidate rides with that screen; the rest are grouped by the piece of work they came from
 * (`trigger`) and become a card each — no picture, state `recorded`. Most work is one direction,
 * iterated; the board shouldn't be empty for it.
 */
export function buildManifest(paths: Paths, opts: { includeRules?: boolean } = {}): { manifest: Record<string, unknown>; skipped: string[] } {
  const skipped: string[] = [];
  const known = readCandidates(paths);
  const candidates: Record<string, unknown>[] = known.map((c) => {
    let snapshot: { type: string; data: string } | null = null;
    if (c.snapshot) {
      const ext = path.extname(c.snapshot).toLowerCase();
      const type = IMAGE_TYPES[ext];
      const file = path.join(candidatesDir(paths), c.snapshot);
      if (type && fs.existsSync(file)) snapshot = { type, data: fs.readFileSync(file).toString('base64') };
      else skipped.push(`${c.id}: ${c.snapshot} (${type ? 'missing' : 'svg/unsupported — hosted takes png, jpg, webp, gif'})`);
    }
    return {
      id: c.id,
      name: c.name,
      feature: c.feature,
      state: c.state,
      author: c.author,
      date: c.date,
      reason: c.reason,
      notes: c.notes,
      supersededBy: c.supersededBy,
      url: null,
      snapshot,
      decisions: decisionsFor(paths, c.id).filter(publishable).map(wire),
    };
  });
  // Screenless decisions: one card per piece of work.
  const ids = new Set(known.map((c) => c.id));
  const loose = readArchive(paths).filter((d) => publishable(d) && (!d.candidate || !ids.has(d.candidate)));
  const byWork = new Map<string, Decision[]>();
  for (const d of loose) byWork.set(d.trigger, [...(byWork.get(d.trigger) ?? []), d]);
  const areas = new Map(known.filter((c) => c.feature).map((c) => [c.feature!.toLowerCase(), c.feature!]));
  for (const [trigger, ds] of byWork) {
    const last = ds.reduce((a, b) => (a.date > b.date ? a : b));
    const id = workId(trigger);
    let snapshot: { type: string; data: string } | null = null;
    const shot = workSnapshot(paths, id);
    if (shot) {
      const type = IMAGE_TYPES[path.extname(shot).toLowerCase()];
      if (type) snapshot = { type, data: fs.readFileSync(shot).toString('base64') };
      else skipped.push(`${id}: ${path.basename(shot)} (svg/unsupported — hosted takes png, jpg, webp, gif)`);
    }
    candidates.push({
      // Work has no product area of its own; it joins one only when the trigger names an existing one.
      id, name: trigger, feature: areas.get(trigger.toLowerCase()) ?? null, state: 'recorded', work: true,
      author: last.author, date: last.date, reason: null, notes: '', supersededBy: null, url: null, snapshot,
      decisions: ds.map(wire),
    });
  }
  const rules = opts.includeRules ? readActive(paths).map((r) => ({ id: r.id, dimension: r.dimension, decision: r.decision, rationale: r.rationale, candidate: r.candidate ?? null })) : null;
  return { manifest: { project: path.basename(paths.root), exported: new Date().toISOString().slice(0, 10), candidates, rules }, skipped };
}

async function api(url: string, init: RequestInit & { token?: string; admin?: string } = {}): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const headers: Record<string, string> = { 'content-type': 'application/json', ...(init.headers as Record<string, string> | undefined) };
  // Raw bytes go up as-is; everything else is JSON.
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.admin) headers['x-admin-token'] = init.admin;
  const res = await fetch(url, { ...init, headers });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { /* non-json error */ }
  return { ok: res.ok, status: res.status, body };
}

/**
 * Create the project on first publish; then the images, one request each; then the board.
 * Keeps every request under Vercel's 4.5 MB body cap however many screens there are.
 */
export async function publishHosted(paths: Paths, serviceUrl: string, opts: { admin?: string } = {}): Promise<{ link: HostedLink; candidates: number; snapshots: number; skipped: string[]; created: boolean }> {
  const base = serviceUrl.replace(/\/$/, '');
  let link = readLink(paths);
  let created = false;
  if (!link || link.url !== base) {
    const admin = opts.admin ?? process.env[ADMIN_ENV];
    const r = await api(`${base}/api/projects`, { method: 'POST', body: JSON.stringify({ name: path.basename(paths.root) }), admin });
    if (r.status === 401) throw new Error(`${base} needs an admin token to create projects. Ask whoever runs it, then: ${ADMIN_ENV}=<token> npx arbiter publish --to ${base}`);
    if (!r.ok) throw new Error(`could not create project on ${base}: ${r.body.error ?? r.status}`);
    link = { url: base, projectId: String(r.body.id), slug: String(r.body.slug), shareUrl: String(r.body.url) };
    writeLink(paths, link);
    writeToken(paths, String(r.body.token));
    created = true;
  }
  const token = readToken(paths);
  if (!token) throw new Error(`no publish token for ${link.shareUrl}. Teammate? Get it from whoever first published, then: ${TOKEN_ENV}=<token> npx arbiter publish`);
  const config = readConfig(paths);
  const { manifest, skipped } = buildManifest(paths, { includeRules: !!(config?.pages && config.pages.includeRules) });
  let snapshots = 0;
  for (const c of manifest.candidates as { id: string; snapshot: { type: string; data: string } | string | null }[]) {
    if (!c.snapshot || typeof c.snapshot === 'string') continue;
    const up = await api(`${base}/api/projects/${link.projectId}/snapshots/${c.id}`, { method: 'PUT', body: Buffer.from(c.snapshot.data, 'base64'), headers: { 'content-type': c.snapshot.type }, token });
    if (up.status === 401) throw new Error(`the publish token was refused by ${base} — wrong ${TOKEN_ENV}, or the project was deleted`);
    if (!up.ok) throw new Error(`${c.id}: snapshot upload failed: ${up.body.error ?? up.status}`);
    c.snapshot = String(up.body.url);
    snapshots++;
  }
  const r = await api(`${base}/api/projects/${link.projectId}/board`, { method: 'PUT', body: JSON.stringify(manifest), token });
  if (r.status === 401) throw new Error(`the publish token was refused by ${base} — wrong ${TOKEN_ENV}, or the project was deleted`);
  if (!r.ok) throw new Error(`publish failed: ${r.body.error ?? r.status}`);
  return { link, candidates: Number(r.body.candidates ?? 0), snapshots, skipped, created };
}

/** Fetch comments since the last pull; merge into .arbiter/comments.json. */
export async function pullHosted(paths: Paths): Promise<{ link: HostedLink; fresh: PulledComment[]; total: number }> {
  const link = readLink(paths);
  if (!link) throw new Error('no hosted board — run `npx arbiter publish --to <url>` first');
  const token = readToken(paths);
  if (!token) throw new Error(`no publish token for ${link.shareUrl}. Get it from whoever first published, then: ${TOKEN_ENV}=<token> npx arbiter pull`);
  const q = link.lastPull ? `?since=${encodeURIComponent(link.lastPull)}` : '';
  const r = await api(`${link.url}/api/projects/${link.projectId}/comments${q}`, { token });
  if (!r.ok) throw new Error(`pull failed: ${r.body.error ?? r.status}`);
  const fresh = (r.body.comments as PulledComment[]) ?? [];
  const existing = readComments(paths);
  const seen = new Set(existing.map((c) => c.id));
  const merged = [...existing, ...fresh.filter((c) => !seen.has(c.id))].sort((a, b) => a.created_at.localeCompare(b.created_at));
  writeComments(paths, merged);
  writeLink(paths, { ...link, lastPull: String(r.body.fetched_at ?? new Date().toISOString()), boardVersion: (r.body.board_version as string | null) ?? link.boardVersion ?? null });
  return { link, fresh, total: merged.length };
}
