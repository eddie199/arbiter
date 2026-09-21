/**
 * `arbiter drift` — deviations per screen, screen-versus-system.
 *
 * For each candidate: how many exceptions were accepted for it, how many of
 * its claims were unverified, and which active mechanical rules its files
 * currently break. The number a design lead takes to their manager.
 */

import { readCandidates, decisionsFor } from '../candidates';
import { Decision } from '../schema';
import { findRoot, readActive, resolvePaths } from '../store';
import { verify } from '../verify';

interface Row {
  id: string;
  name: string;
  feature: string | null;
  state: string;
  accepts: number;
  fixes: number;
  rules: number;
  unverified: number;
  files: number;
  broken: { id: string; decision: string; where: string[] }[];
}

export function drift(opts: { feature?: string; json?: boolean; cwd?: string } = {}): string {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const active = readActive(paths);
  const mechanical = active.filter((d) => d.class === 'mechanical' && d.expect?.absent?.length);
  let candidates = readCandidates(paths);
  if (opts.feature) candidates = candidates.filter((c) => c.feature === opts.feature);

  const rows: Row[] = candidates.map((c) => {
    const ds = decisionsFor(paths, c.id);
    const files = [...new Set(ds.flatMap((d) => d.files))];
    const broken = mechanical
      .map((rule) => {
        const r = verify(root, files, { absent: rule.expect!.absent });
        const where = r.checks.filter((k) => k.kind === 'absent' && !k.ok).map((k) => `${k.file}${k.detail ? ` (${k.detail})` : ''}`);
        return { id: rule.id, decision: rule.decision, where };
      })
      .filter((b) => b.where.length);
    return {
      id: c.id,
      name: c.name,
      feature: c.feature,
      state: c.state,
      accepts: count(ds, 'accept'),
      fixes: count(ds, 'fix'),
      rules: count(ds, 'rule'),
      unverified: ds.filter((d) => d.verified === false).length,
      files: files.length,
      broken,
    };
  });

  if (opts.json) return JSON.stringify({ rulesChecked: mechanical.map((d) => d.id), screens: rows }, null, 2);
  if (!rows.length) return 'No candidates to measure. Drift is per screen — register screens with `npx arbiter candidate add`.';

  const totals = rows.reduce((t, r) => ({ accepts: t.accepts + r.accepts, broken: t.broken + r.broken.length }), { accepts: 0, broken: 0 });
  const lines = [`Drift across ${rows.length} screen${rows.length === 1 ? '' : 's'} — ${totals.accepts} accepted exception${totals.accepts === 1 ? '' : 's'} · ${totals.broken} rule break${totals.broken === 1 ? '' : 's'} · ${mechanical.length} mechanical rule${mechanical.length === 1 ? '' : 's'} checked`];
  const w = Math.max(...rows.map((r) => r.name.length));
  const features = [...new Set(rows.map((r) => r.feature ?? '—'))];
  for (const f of features) {
    lines.push('', f);
    for (const r of rows.filter((r) => (r.feature ?? '—') === f)) {
      const bits = [`${r.accepts} accept${r.accepts === 1 ? '' : 's'}`];
      if (r.unverified) bits.push(`${r.unverified} unverified`);
      bits.push(r.broken.length ? `${r.broken.length} rule${r.broken.length === 1 ? '' : 's'} broken` : r.files ? 'clean' : 'no files to check');
      lines.push(`  ${r.id}  ${r.name.padEnd(w)}  ${r.state.replace('_', ' ').padEnd(11)} ${bits.join(' · ')}`);
      for (const b of r.broken) lines.push(`${' '.repeat(w + 24)}✗ ${b.id} ${b.decision} — ${b.where.join(', ')}`);
    }
  }
  return lines.join('\n');
}

const count = (ds: Decision[], v: string) => ds.filter((d) => d.verdict === v).length;
