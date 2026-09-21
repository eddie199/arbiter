/** `arbiter verify [id]` — re-check a decision's claim against its files now. No id: every active rule that carries evidence. */

import { Decision } from '../schema';
import { findRoot, readActive, readArchive, readPending, resolvePaths } from '../store';
import { checkable, verify, VerifyResult } from '../verify';

export function verifyCommand(id: string | undefined, opts: { json?: boolean; cwd?: string } = {}): { text: string; ok: boolean } {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);

  let targets: Decision[];
  if (id) {
    const d = [...readActive(paths), ...readArchive(paths), ...readPending(paths)].find((x) => x.id === id);
    if (!d) throw new Error(`${id} not found`);
    targets = [d];
  } else {
    targets = readActive(paths).filter((d) => checkable(d.files, d.expect));
  }

  const results = targets.map((d) => ({ id: d.id, decision: d.decision, files: d.files, result: checkable(d.files, d.expect) ? verify(root, d.files, d.expect) : null }));
  const ok = results.every((r) => r.result === null || r.result.ok);

  if (opts.json) return { text: JSON.stringify({ ok, results }, null, 2), ok };
  if (!results.length) return { text: 'Nothing to verify — no active rules carry files or expectations.', ok: true };

  const lines: string[] = [];
  for (const r of results) {
    if (!r.result) {
      lines.push(`${r.id}  ${r.decision}`, '        not checkable — no files or expectations');
      continue;
    }
    lines.push(`${r.result.ok ? '✓' : '✗'} ${r.id}  ${r.decision}`);
    for (const c of r.result.checks) {
      if (c.ok && r.result.ok) continue; // quiet when everything passes
      lines.push(`        ${c.ok ? '✓' : '✗'} ${c.kind}${c.needle ? ` "${c.needle}"` : ''} — ${c.file}${c.detail ? ` (${c.detail})` : ''}`);
    }
  }
  lines.push('', ok ? 'All claims hold.' : 'Contradictions found. Fix the code, or record an accept for the exception.');
  return { text: lines.join('\n'), ok };
}

export type { VerifyResult };
