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
import { randomInt } from 'node:crypto';
import { readCandidates, decisionsFor, candidatesDir } from './candidates';
import { Paths, readActive, readArchive, readConfig } from './store';
import type { Decision } from './schema';
import { readRenames, workId, workSnapshot } from './work';
import { cardOf, readRequests } from './requests';

export interface HostedLink {
  url: string;        // service base url
  projectId: string;
  slug: string;
  shareUrl: string;
  /** No longer written: pull fetches every comment. Older files may still carry it. */
  lastPull?: string;
  /** The board version the service holds, as of the last pull. */
  boardVersion?: string | null;
}

/** The link for places that only want to know about the board, where a broken hosted.json shouldn't stop the command. */
export function readLinkOrNull(paths: Paths): HostedLink | null {
  try {
    return readLink(paths);
  } catch {
    return null;
  }
}

export interface PulledComment {
  id: string;
  candidate_id: string;
  decision_id: string | null;
  /** `request` — "Request change" on the board: it becomes a request (R-0001) the owner answers. */
  kind: 'comment' | 'approve' | 'request';
  author_name: string;
  /** The board sends it; it's never kept. comments.json is committed, and a public repo would publish it. */
  author_email?: string;
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

/** Every comment on file, minus email addresses: nothing here needs them, and the file is committed. */
export function writeComments(paths: Paths, comments: PulledComment[]): void {
  const kept = comments.map(({ author_email: _email, ...c }) => c);
  fs.writeFileSync(path.join(paths.archiveDir, COMMENTS_FILE), JSON.stringify(kept, null, 2) + '\n');
}

export const publishable = (d: Decision) => d.verdict !== 'pending' && d.verdict !== 'retire' && d.level !== 'polish';
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
  const archive = readArchive(paths);
  const loose = archive.filter((d) => publishable(d) && (!d.candidate || !ids.has(d.candidate)));
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
  // The day each became a rule, for the board's Design rules page.
  const rules = opts.includeRules ? readActive(paths).map((r) => ({ id: r.id, dimension: r.dimension, decision: r.decision, rationale: r.rationale, candidate: r.candidate ?? null, date: r.date.slice(0, 10) })) : null;
  // The owner's answers to requests made on the board, matched there by comment. An open request
  // needs nothing sent — the board already has it. What happened is the recorded change itself,
  // polish included, so the requester reads it even when no card shows that decision.
  const requests = readRequests(paths)
    .filter((r) => r.status !== 'open')
    .map((r) => ({
      comment: r.comment,
      id: r.id,
      status: r.status,
      instead: r.instead,
      reason: r.reason,
      by: r.judgedBy,
      at: r.appliedAt ?? r.judgedAt,
      decisions: r.decisions.flatMap((id) => {
        const d = archive.find((x) => x.id === id);
        return d ? [{ id: d.id, change: d.change ?? d.decision, card: cardOf(paths, d, ids) }] : [];
      }),
    }));
  // Renamed pieces of work, so the board moves their comments. Not one whose old name is a card again:
  // the board would move the new card's comments away to the old one's new name.
  const live = new Set(candidates.map((c) => c.id as string));
  const renamed = readRenames(paths).filter((r) => !live.has(r.from));
  return { manifest: { project: path.basename(paths.root), exported: new Date().toISOString().slice(0, 10), candidates, rules, requests, renamed }, skipped };
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

/** The service's own floor for a board password. */
export const PASSWORD_MIN = 8;

/**
 * A password nobody will guess: 12 characters from 31 that can't be misread (no 0/o, 1/l/i), in
 * three groups so it can be read out. About 59 bits.
 */
export function newPassword(): string {
  const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
  const pick = () => Array.from({ length: 4 }, () => abc[randomInt(abc.length)]).join('');
  return `${pick()}-${pick()}-${pick()}`;
}

/**
 * Create the project on first publish; then the password, if one was given; then the images, one
 * request each; then the board. The password goes before anything else, so a new board is never
 * readable without it. Keeps every request under Vercel's 4.5 MB body cap however many screens there are.
 *
 * `password`: a string sets it, null takes it off, left out leaves it as it is.
 */
export async function publishHosted(paths: Paths, serviceUrl: string, opts: { admin?: string; password?: string | null } = {}): Promise<{ link: HostedLink; candidates: number; snapshots: number; skipped: string[]; created: boolean }> {
  const base = serviceUrl.replace(/\/$/, '');
  let link = readLink(paths);
  let created = false;
  if (!link || link.url !== base) {
    // Automation republishes an existing board; it never creates one. Without this, a repo where
    // hosted.json wasn't committed would mint a fresh orphan board on every push.
    if (process.env.CI && !process.env.ARBITER_CREATE_IN_CI) {
      throw new Error(`no .arbiter/hosted.json for ${base} — publish once from a laptop and commit that file, so CI updates the existing board instead of creating a new one`);
    }
    const admin = opts.admin ?? process.env[ADMIN_ENV];
    const r = await api(`${base}/api/projects`, { method: 'POST', body: JSON.stringify({ name: path.basename(paths.root) }), admin });
    if (r.status === 401) throw new Error(`${base} only lets an admin create boards. Ask whoever runs it for the token, then: npx arbiter publish --to ${base} --admin-token <token>`);
    // The service says which limit it was: this network's, or everyone's.
    if (r.status === 429) throw new Error(typeof r.body.error === 'string' ? r.body.error : `${base} is busy right now — try again in an hour`);
    if (!r.ok) throw new Error(`could not create project on ${base}: ${r.body.error ?? r.status}`);
    link = { url: base, projectId: String(r.body.id), slug: String(r.body.slug), shareUrl: String(r.body.url) };
    writeLink(paths, link);
    writeToken(paths, String(r.body.token));
    created = true;
  }
  const token = readToken(paths);
  if (!token) throw new Error(`no publish token for ${link.shareUrl}. Teammate? Get it from whoever first published, then: ${TOKEN_ENV}=<token> npx arbiter publish`);
  if (opts.password !== undefined) {
    const pw = await api(`${base}/api/projects/${link.projectId}/password`, { method: 'PUT', body: JSON.stringify({ password: opts.password }), token });
    if (pw.status === 401) throw new Error(`the publish token was refused by ${base} — wrong ${TOKEN_ENV}, or the project was deleted`);
    if (pw.status === 404 || pw.status === 405) throw new Error(`${base} doesn't take board passwords yet — it runs an older Arbiter than this one. Nothing was published.`);
    if (!pw.ok) throw new Error(`password not ${opts.password === null ? 'removed' : 'set'}: ${pw.body.error ?? pw.status}. Nothing was published.`);
  }
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

/**
 * Fetch every comment on the board; merge the new ones into .arbiter/comments.json. All of them,
 * not only those since last time: it's how a request deleted on the board is noticed, and a
 * cursor could skip a comment that landed mid-pull. `current` is what the board holds now.
 */
export async function pullHosted(paths: Paths): Promise<{ link: HostedLink; fresh: PulledComment[]; current: PulledComment[]; total: number }> {
  const link = readLink(paths);
  if (!link) throw new Error('no hosted board — run `npx arbiter publish --to <url>` first');
  const token = readToken(paths);
  if (!token) throw new Error(`no publish token for ${link.shareUrl}. Get it from whoever first published, then: ${TOKEN_ENV}=<token> npx arbiter pull`);
  const r = await api(`${link.url}/api/projects/${link.projectId}/comments`, { token });
  if (!r.ok) throw new Error(`pull failed: ${r.body.error ?? r.status}`);
  // An empty list would read as every request withdrawn, so a reply without one is a failure.
  if (!Array.isArray(r.body.comments)) throw new Error('pull failed: the board sent no comment list');
  const current = r.body.comments as PulledComment[];
  // What's on file keeps its words, but takes the board's card: a renamed piece of work's comments
  // move there at publish, and a copy pulled before that would still point at the old card.
  const onBoard = new Map(current.map((c) => [c.id, c]));
  const existing = readComments(paths).map((c) => {
    const now = onBoard.get(c.id);
    return now && now.candidate_id !== c.candidate_id ? { ...c, candidate_id: now.candidate_id } : c;
  });
  const seen = new Set(existing.map((c) => c.id));
  const fresh = current.filter((c) => !seen.has(c.id));
  const merged = [...existing, ...fresh].sort((a, b) => String(a.created_at ?? '').localeCompare(String(b.created_at ?? '')));
  writeComments(paths, merged);
  // hosted.json is committed: rewrite it only when the board has moved on, or every pull on every
  // machine would leave it changed, and two of them would conflict.
  const boardVersion = (r.body.board_version as string | null) ?? link.boardVersion ?? null;
  if (boardVersion !== (link.boardVersion ?? null)) {
    const { lastPull: _old, ...rest } = link;
    writeLink(paths, { ...rest, boardVersion });
  }
  return { link, fresh, current, total: merged.length };
}

/**
 * Delete the board from the service: the board, its pictures, every comment. Comments are pulled
 * into .arbiter/comments.json first, so nothing said on the board is lost with it. Then the link
 * goes, so nothing here publishes to a board that no longer exists.
 */
export async function unpublishHosted(paths: Paths): Promise<{ link: HostedLink; saved: number; pictures: number; comments: number }> {
  const link = readLink(paths);
  if (!link) throw new Error('this project has no hosted board (.arbiter/hosted.json)');
  const token = readToken(paths);
  if (!token) throw new Error(`no publish token for ${link.shareUrl}. Only someone who can publish the board can delete it: ${TOKEN_ENV}=<token> npx arbiter unpublish --yes`);
  const { total } = await pullHosted(paths);
  const r = await api(`${link.url}/api/projects/${link.projectId}`, { method: 'DELETE', token });
  if (r.status === 401) throw new Error(`${link.url} refused the publish token — wrong ${TOKEN_ENV}, or the board is already gone. If it is, delete .arbiter/hosted.json and .arbiter/hosted.token.`);
  if (r.status === 404 || r.status === 405) throw new Error(`${link.url} can't delete boards yet — it runs an older Arbiter than this one. Nothing was deleted.`);
  if (!r.ok) throw new Error(`delete failed: ${r.body.error ?? r.status}. Nothing here was changed.`);
  for (const f of [LINK_FILE, TOKEN_FILE]) fs.rmSync(path.join(paths.archiveDir, f), { force: true });
  return { link, saved: total, pictures: Number(r.body.pictures ?? 0), comments: Number(r.body.comments ?? 0) };
}
