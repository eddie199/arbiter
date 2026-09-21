/** `arbiter pull` — bring comments and "looks good" reactions down from the hosted board. */

import { readCandidates } from '../candidates';
import { pullHosted } from '../hosted';
import { findRoot, resolvePaths } from '../store';

export async function pull(opts: { cwd?: string } = {}): Promise<string> {
  const paths = resolvePaths(findRoot(opts.cwd));
  const { link, fresh, total } = await pullHosted(paths);
  if (!fresh.length) return `Nothing new on ${link.shareUrl} (${total} comment${total === 1 ? '' : 's'} so far).`;
  const names = new Map(readCandidates(paths).map((c) => [c.id, c.name]));
  const lines = [`${fresh.length} new from ${link.shareUrl}:`, ''];
  const byCand = new Map<string, typeof fresh>();
  for (const c of fresh) byCand.set(c.candidate_id, [...(byCand.get(c.candidate_id) ?? []), c]);
  for (const [cid, cs] of byCand) {
    lines.push(`  ${cid}  ${names.get(cid) ?? (cid.startsWith('W-') ? cid.slice(2).replace(/-/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase()) : '')}`);
    for (const c of cs) {
      const stale = c.board_version && link.boardVersion && c.board_version !== link.boardVersion ? '  (earlier version)' : '';
      lines.push((c.kind === 'approve' ? `    ✓ ${c.author_name} — looks good` : `    ${c.author_name}${c.decision_id ? ` on ${c.decision_id}` : ''}: ${c.body}`) + stale);
    }
  }
  lines.push('', 'Saved to .arbiter/comments.json — npx arbiter review shows them beside each screen. Say "record Sam\'s comment as a rule" in a session to act on one.');
  return lines.join('\n');
}
