/**
 * `arbiter pull` — bring comments and "looks good" reactions down from the hosted board. A
 * "Request change" becomes a request (R-0001) waiting on the owner's answer.
 */

import { readCandidates } from '../candidates';
import { pullHosted } from '../hosted';
import { dropWithdrawn, oneLine, openRequests, readRequests } from '../requests';
import { findRoot, resolvePaths } from '../store';

export async function pull(opts: { cwd?: string } = {}): Promise<string> {
  const paths = resolvePaths(findRoot(opts.cwd));
  const { link, fresh, current, total } = await pullHosted(paths);
  // Withdrawn first: a request deleted on the board leaves the queue before anything new arrives.
  const withdrawn = dropWithdrawn(paths, new Set(current.filter((c) => c.kind === 'request').map((c) => c.id)));
  // Every request on the board, not only the fresh ones: one pulled by an older Arbiter still counts.
  const opened = new Map(openRequests(paths, current).map((r) => [r.comment, r.id]));
  const waiting = readRequests(paths).filter((r) => r.status === 'open').length;
  const toAnswer = `${waiting} request${waiting === 1 ? '' : 's'} to answer — /arbiter in chat, or npx arbiter review.`;
  const gone = withdrawn.map((r) => `${r.author} withdrew ${r.id} on the board, so it's off your queue: ${oneLine(r.body)}`);
  if (!fresh.length) return [`Nothing new on ${link.shareUrl} (${total} comment${total === 1 ? '' : 's'} so far).`, ...gone, ...(waiting ? [toAnswer] : [])].join('\n');
  const names = new Map(readCandidates(paths).map((c) => [c.id, c.name]));
  const lines = [`${fresh.length} new from ${link.shareUrl}:`, ''];
  const byCand = new Map<string, typeof fresh>();
  for (const c of fresh) byCand.set(c.candidate_id, [...(byCand.get(c.candidate_id) ?? []), c]);
  for (const [cid, cs] of byCand) {
    lines.push(`  ${cid}  ${names.get(cid) ?? (cid.startsWith('W-') ? cid.slice(2).replace(/-/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase()) : '')}`);
    for (const c of cs) {
      const stale = c.board_version && link.boardVersion && c.board_version !== link.boardVersion ? '  (earlier version)' : '';
      const on = c.decision_id ? ` on ${c.decision_id}` : '';
      if (c.kind === 'approve') lines.push(`    ✓ ${c.author_name} — looks good${stale}`);
      else if (c.kind === 'request') lines.push(`    ${c.author_name} requests a change${on}: ${c.body}${stale}${opened.has(c.id) ? `  → ${opened.get(c.id)}` : ''}`);
      else lines.push(`    ${c.author_name}${on}: ${c.body}${stale}`);
    }
  }
  lines.push('', 'Saved to .arbiter/comments.json — npx arbiter review shows them beside each screen. Say "record Sam\'s comment as a rule" in a session to act on one.');
  if (gone.length) lines.push(...gone);
  if (waiting) lines.push(toAnswer);
  return lines.join('\n');
}
