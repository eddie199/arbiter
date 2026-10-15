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
import { readLinkOrNull, unpublishHosted } from '../hosted';
import { findRoot, resolvePaths } from '../store';
import { WORKFLOW_FILE, type PublishResult } from './publish';

export async function unpublish(opts: { yes?: boolean; cwd?: string } = {}): Promise<PublishResult> {
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
