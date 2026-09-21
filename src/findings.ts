/**
 * External findings adapter. A design-drift scanner ran and wrote JSON; we
 * turn each finding into a pending decision so a human attaches a verdict
 * instead of the finding being silently ignored. Detection is never
 * implemented here — findings are input, never output.
 *
 * Accepted shapes (best effort):
 *   ESLint:  [{ filePath, messages: [{ ruleId, message, line, fix? }] }]
 *   Flat:    [{ file|path|filePath, line?, rule|ruleId|id?, message|msg|description, suggestion|fix|replacement? }]
 *   Wrapped: { findings|results|issues: [ ...either of the above ] }
 */

import path from 'node:path';
import { DecisionInput } from './schema';

export interface Finding {
  file: string;
  line: number | null;
  rule: string | null;
  message: string;
  suggestion: string | null;
}

export function parseFindings(raw: unknown): Finding[] {
  let list: unknown = raw;
  if (list && typeof list === 'object' && !Array.isArray(list)) {
    const o = list as Record<string, unknown>;
    list = o.findings ?? o.results ?? o.issues ?? o.violations ?? [];
  }
  if (!Array.isArray(list)) return [];

  const out: Finding[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const file = str(o.file ?? o.path ?? o.filePath ?? o.filename);
    if (!file) continue;

    if (Array.isArray(o.messages)) {
      // ESLint-style: one entry per message.
      for (const m of o.messages as Record<string, unknown>[]) {
        const message = str(m.message);
        if (!message) continue;
        out.push({ file, line: num(m.line), rule: str(m.ruleId ?? m.rule), message, suggestion: str(m.suggestion ?? m.replacement ?? (m.fix as Record<string, unknown> | undefined)?.text) });
      }
      continue;
    }
    const message = str(o.message ?? o.msg ?? o.description ?? o.text);
    if (!message) continue;
    out.push({ file, line: num(o.line), rule: str(o.rule ?? o.ruleId ?? o.id ?? o.code), message, suggestion: str(o.suggestion ?? o.fix ?? o.replacement ?? o.expected) });
  }
  return out;
}

/** Turn a finding into the decision the reviewer will judge. */
export function toDecisionInput(f: Finding, root: string, tool: string): DecisionInput {
  const rel = path.isAbsolute(f.file) ? path.relative(root, f.file) : f.file;
  const where = f.line ? `${rel}:${f.line}` : rel;
  return {
    decision: f.suggestion ? f.suggestion : f.message,
    rationale: `${tool} flagged: ${f.message}`,
    rejected: [],
    trigger: `finding${f.rule ? ` ${f.rule}` : ''} at ${where}`,
    scope: `file:${rel}`,
    dimension: 'visual',
    class: 'mechanical',
    verdict: 'rule',
    files: [rel],
  };
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
