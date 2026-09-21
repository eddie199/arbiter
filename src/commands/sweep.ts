/**
 * `arbiter sweep <rule-id>` — find existing violations of a mechanical rule.
 * Prints them; never edits. `--queue` turns each affected file into a pending
 * decision so the reviewer can confirm (accept the exception) or fix.
 */

import { Decision } from '../schema';
import { findRoot, nextPendingId, readActive, readArchive, readConfig, readPending, resolvePaths, writePending, currentCommit, now } from '../store';
import { sweep, summarize, SweepResult } from '../sweep';

export interface SweepOptions {
  json?: boolean;
  queue?: boolean;
  author?: string;
  cwd?: string;
}

export function sweepCommand(id: string, opts: SweepOptions = {}): { text: string; result: SweepResult; queued: string[] } {
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const rule = [...readActive(paths), ...readArchive(paths)].find((d) => d.id === id);
  if (!rule) throw new Error(`${id} not found`);

  const result = sweep(root, rule, { exclude: readConfig(paths)?.sweep?.exclude });
  const sum = summarize(result);
  const byFile = new Map<string, typeof result.violations>();
  for (const v of result.violations) byFile.set(v.file, [...(byFile.get(v.file) ?? []), v]);

  const queued: string[] = [];
  if (opts.queue && result.violations.length) {
    const pending = readPending(paths);
    const seen = new Set(pending.map((d) => d.trigger));
    for (const [file, vs] of byFile) {
      const trigger = `sweep ${rule.id}: ${vs.length} violation${vs.length === 1 ? '' : 's'} in ${file}`;
      if (seen.has(trigger)) continue;
      const entry: Decision = {
        id: nextPendingId(pending),
        date: now(),
        author: opts.author ?? rule.author,
        class: 'mechanical',
        change: null,
        level: 'polish',
        dimension: rule.dimension,
        decision: rule.decision,
        rejected: [],
        trigger,
        verdict: 'pending',
        scope: `file:${file}`,
        rationale: `${rule.id} applies here. Confirm to allow this file as an exception; fix to bring it in line.`,
        supersedes: null,
        ref: null,
        commit: currentCommit(root),
        files: [file],
        paths: [],
        expect: rule.expect,
        verified: false,
        candidate: null,
      };
      pending.push(entry);
      queued.push(entry.id);
    }
    writePending(paths, pending);
  }

  if (opts.json) return { text: JSON.stringify({ rule: { id: rule.id, decision: rule.decision }, ...result, summary: sum, queued }, null, 2), result, queued };

  const lines = [`${rule.id} · ${rule.decision}`];
  if (!result.sweepable) {
    lines.push(`Cannot sweep: ${result.reason}.`);
    return { text: lines.join('\n'), result, queued };
  }
  lines.push(`Searched ${result.filesScanned} file${result.filesScanned === 1 ? '' : 's'} for ${result.needles.map((n) => `"${n}"`).join(', ')}.`);
  if (!result.violations.length) {
    lines.push('No existing violations.');
    return { text: lines.join('\n'), result, queued };
  }
  lines.push(`Found ${sum.violations} violation${sum.violations === 1 ? '' : 's'} across ${sum.files} file${sum.files === 1 ? '' : 's'}:`, '');
  if (result.scanned === 'project' && sum.files > 10) {
    lines.push(`  (swept the whole project — too wide? give the rule "paths": ["app/components"], or add "sweep": { "exclude": ["app/globals.css", "docs/**"] } to arbiter.json)`, '');
  }
  for (const [file, vs] of byFile) {
    lines.push(`  ${file}`);
    for (const v of vs.slice(0, 5)) lines.push(`    ${String(v.line).padStart(4)}  ${v.text}`);
    if (vs.length > 5) lines.push(`         … ${vs.length - 5} more`);
  }
  lines.push('');
  if (queued.length) lines.push(`Queued ${queued.length} for review (${queued.join(', ')}) — npx arbiter review`);
  else lines.push('Fix now (ask the agent), queue for review (--queue), or ignore.');
  return { text: lines.join('\n'), result, queued };
}
