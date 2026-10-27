/**
 * `arbiter unpublish --yes` — take the hosted board down, for everyone.
 *
 * The board is a window onto the record, so deleting it loses nothing the repo holds: decisions,
 * rules, pictures and requests all stay. What lives only on the board is what people said there,
 * so the comments are pulled into .arbiter/comments.json first. Then the board, its pictures and
 * its comments are deleted from the service, and the link here goes with them.
 *
 * Without --yes it deletes nothing and says what it would, because nothing brings a board back:
 * publishing again makes a new one, at a new link, with no comments.
 */

import fs from 'node:fs';
import path from 'node:path';
import { ADMIN_ENV, parseBoardLink, readLinkOrNull, takedownHosted, unpublishHosted } from '../hosted';
import { findRoot, resolvePaths } from '../store';
import { WORKFLOW_FILE, type PublishResult } from './publish';

/**
 * With `board` and `admin`: a takedown of any board on a server you run, by its link, with the
 * server's admin token from ARBITER_ADMIN_TOKEN. Needs no project here and changes nothing in one.
 */
export async function unpublish(opts: { yes?: boolean; cwd?: string; board?: string; admin?: boolean } = {}): Promise<PublishResult> {
  if (opts.board || opts.admin) return takedown(opts);
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const steps: PublishResult['steps'] = [];
  const link = readLinkOrNull(paths);
  if (!link) {
    steps.push({ step: 'board', outcome: 'failed', note: 'this project has no hosted board (.arbiter/hosted.json)' });
    return { ok: false, steps, url: null };
  }
  if (!opts.yes) {
    steps.push({
      step: 'board',
      outcome: 'skipped',
      note: `nothing deleted. This deletes ${link.shareUrl} for everyone: the board, its pictures and every comment on it, saving the comments to .arbiter/comments.json first. To go ahead: npx arbiter unpublish --yes`,
    });
    return { ok: false, steps, url: link.shareUrl };
  }

  try {
    const r = await unpublishHosted(paths);
    steps.push({ step: 'comments', outcome: 'done', note: `${r.saved} saved to .arbiter/comments.json` });
    steps.push({ step: 'board', outcome: 'done', note: `deleted ${r.link.shareUrl}, with ${r.pictures} picture${r.pictures === 1 ? '' : 's'} and ${r.comments} comment${r.comments === 1 ? '' : 's'}` });
    steps.push({ step: 'link', outcome: 'done', note: 'removed .arbiter/hosted.json and .arbiter/hosted.token — commit that, so teammates stop publishing to it' });
  } catch (e) {
    steps.push({ step: 'board', outcome: 'failed', note: (e as Error).message });
    return { ok: false, steps, url: null };
  }
  // The workflow would now run on every push and fail: it never creates a board from CI.
  if (fs.existsSync(path.join(root, WORKFLOW_FILE))) {
    steps.push({ step: 'workflow', outcome: 'skipped', note: `${WORKFLOW_FILE} still runs on every push, and will fail now there's no board. Delete it` });
  }
  return { ok: true, steps, url: null };
}

async function takedown(opts: { yes?: boolean; board?: string; admin?: boolean }): Promise<PublishResult> {
  const fail = (note: string): PublishResult => ({ ok: false, steps: [{ step: 'board', outcome: 'failed', note }], url: null });
  if (!opts.admin) return fail("a board link is for taking down someone else's board, with --admin. To delete this project's own board, leave the link out");
  if (!opts.board) return fail('--admin needs the link of the board to take down: npx arbiter unpublish <board link> --admin --yes');
  const board = parseBoardLink(opts.board);
  if (!board) return fail(`${opts.board} isn't a board link. One looks like https://arbiter.design/p/abc123`);
  const admin = process.env[ADMIN_ENV]?.trim();
  if (!admin) return fail(`set ${ADMIN_ENV} to the admin token of ${board.origin} first`);
  if (!opts.yes) {
    return {
      ok: false,
      steps: [{ step: 'board', outcome: 'skipped', note: `nothing deleted. This deletes ${board.shareUrl} for everyone: the board, its pictures and every comment on it, and its owner can't get the comments back. To go ahead: npx arbiter unpublish ${board.shareUrl} --admin --yes` }],
      url: board.shareUrl,
    };
  }
  try {
    const r = await takedownHosted(board.shareUrl, admin);
    return { ok: true, steps: [{ step: 'board', outcome: 'done', note: `deleted ${r.shareUrl}, with ${r.pictures} picture${r.pictures === 1 ? '' : 's'} and ${r.comments} comment${r.comments === 1 ? '' : 's'}` }], url: null };
  } catch (e) {
    return fail((e as Error).message);
  }
}
