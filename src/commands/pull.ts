/**
 * `arbiter pull` — bring comments and "looks good" reactions down from the hosted board. A
 * "Request change" becomes a request (R-0001) waiting on the owner's answer.
 */

import { readCandidates } from '../candidates';
import { pullHosted, readComments } from '../hosted';
import { openRequests } from '../requests';
import { findRoot, resolvePaths } from '../store';

export async function pull(opts: { cwd?: string } = {}): Promise<string> {
  const paths = resolvePaths(findRoot(opts.cwd));
  const { link, fresh, total } = await pullHosted(paths);
  // Every request comment on file, not only the fresh ones: one pulled by an older Arbiter still counts.
  const opened = new Map(openRequests(paths, readComments(paths)).map((r) => [r.comment, r.id]));
  const toAnswer = `${opened.size} request${opened.size === 1 ? '' : 's'} to answer — /arbiter in chat, or npx arbiter review.`;
  if (!fresh.length) return [`Nothing new on ${link.shareUrl} (${total} comment${total === 1 ? '' : 's'} so far).`, ...(opened.size ? [toAnswer] : [])].join('\n');
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
  if (opened.size) lines.push(toAnswer);
  return lines.join('\n');
}
