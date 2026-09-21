/** `arbiter board` — candidates and their states. Read only. */

import { Candidate, readCandidates, decisionsFor } from '../candidates';
import { findRoot, readConfig, resolvePaths } from '../store';
import { linkFor, pagesUrl } from '../destination';

export function board(opts: { feature?: string; json?: boolean; cwd?: string } = {}): string {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const config = readConfig(paths);
  let all = readCandidates(paths);
  if (opts.feature) all = all.filter((c) => c.feature === opts.feature);

  const withDecisions = all.map((c) => ({ ...c, decisions: decisionsFor(paths, c.id).map((d) => d.id), link: linkFor(root, config, c.id) }));
  if (opts.json) return JSON.stringify({ count: all.length, candidates: withDecisions }, null, 2);
  if (!all.length) return opts.feature ? `No candidates for ${opts.feature}.` : 'No candidates yet. Add one with `npx arbiter candidate add "<name>" --feature <feature>`.';

  const counts = new Map<string, number>();
  for (const c of all) counts.set(c.state, (counts.get(c.state) ?? 0) + 1);
  const lines = [`${all.length} candidate${all.length === 1 ? '' : 's'} · ${[...counts].map(([s, n]) => `${n} ${s.replace('_', ' ')}`).join(' · ')}`];
  const pages = pagesUrl(root, config);
  if (pages) lines.push(`Board page: ${pages}  (GitHub Pages → docs/, once pushed)`);

  const features = [...new Set(all.map((c) => c.feature ?? '—'))];
  const w = Math.max(...all.map((c) => c.name.length));
  for (const f of features) {
    lines.push('', f);
    for (const c of withDecisions.filter((c) => (c.feature ?? '—') === f)) {
      const state = c.state === 'superseded' ? `superseded → ${c.supersededBy}` : c.state.replace('_', ' ');
      lines.push(`  ${c.id}  ${c.name.padEnd(w)}  ${state.padEnd(22)} ${c.author}  ${c.date.slice(0, 10)}${c.decisions.length ? `  ${c.decisions.join(', ')}` : ''}`);
      if (c.reason) lines.push(`${' '.repeat(w + 12)}"${c.reason}"`);
      if (c.link && config?.destination === 'git') lines.push(`${' '.repeat(w + 12)}${c.link}`);
    }
  }
  return lines.join('\n');
}

export type { Candidate };
