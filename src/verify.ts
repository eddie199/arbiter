/**
 * Claim checking. The agent says "used brand.500 in Button.tsx"; we read
 * Button.tsx and look. Read-only, only the files the decision names — never
 * a repo-wide scan. Literal string matching, nothing cleverer: detection is
 * someone else's product.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Evidence } from './schema';

export interface Check {
  kind: 'exists' | 'present' | 'absent';
  file: string;
  needle?: string;
  ok: boolean;
  detail?: string;
}

export interface VerifyResult {
  ok: boolean;
  checks: Check[];
}

/**
 * `present` needles must appear in at least one of the files; `absent` needles
 * must appear in none. Every file must exist.
 */
export function verify(root: string, files: string[], expect: Evidence | null): VerifyResult {
  const checks: Check[] = [];
  const contents = new Map<string, string>();

  for (const f of files) {
    const abs = path.resolve(root, f);
    if (!abs.startsWith(path.resolve(root))) {
      checks.push({ kind: 'exists', file: f, ok: false, detail: 'outside the project' });
      continue;
    }
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      checks.push({ kind: 'exists', file: f, ok: false, detail: 'file not found' });
      continue;
    }
    contents.set(f, fs.readFileSync(abs, 'utf8'));
    checks.push({ kind: 'exists', file: f, ok: true });
  }

  for (const needle of expect?.present ?? []) {
    const find = matcher(needle);
    const hit = [...contents.entries()].find(([, text]) => find(text) >= 0);
    checks.push({
      kind: 'present',
      file: hit?.[0] ?? files.join(', '),
      needle,
      ok: !!hit,
      detail: hit ? undefined : `not found in ${files.length} file${files.length === 1 ? '' : 's'}`,
    });
  }

  for (const needle of expect?.absent ?? []) {
    for (const [f, text] of contents) {
      const line = lineOf(text, needle);
      if (line !== null) checks.push({ kind: 'absent', file: f, needle, ok: false, detail: `found at line ${line}` });
    }
    if (!checks.some((c) => c.kind === 'absent' && c.needle === needle && !c.ok)) {
      checks.push({ kind: 'absent', file: files.join(', '), needle, ok: true });
    }
  }

  return { ok: checks.every((c) => c.ok), checks };
}

/** A needle is a literal string, or a pattern when written `regex:<source>`. */
export function matcher(needle: string): (text: string) => number {
  if (needle.startsWith('regex:')) {
    const re = new RegExp(needle.slice(6));
    return (text) => text.search(re);
  }
  return (text) => text.indexOf(needle);
}

export function lineOf(text: string, needle: string): number | null {
  const i = matcher(needle)(text);
  if (i < 0) return null;
  return text.slice(0, i).split('\n').length;
}

/** True when the decision carries something checkable. */
export function checkable(files: string[], expect: Evidence | null): boolean {
  return files.length > 0 || !!(expect?.present?.length || expect?.absent?.length);
}
