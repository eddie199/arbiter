/**
 * Markdown serialization for decisions. One format, two files.
 *
 *   ### D-0001 · Destructive actions confirm in a modal, never inline
 *
 *   - **Change:** The delete-project link now opens a confirm modal
 *   - **Rationale:** Inline confirms get clicked through; a modal forces the pause.
 *   - **Rejected:**
 *     - Inline confirm — clicked through without reading
 *   - **Trigger:** Delete-project flow used an inline "Are you sure?" link
 *   - **Scope:** pattern:destructive-confirm · **Dimension:** interaction · **Level:** pattern · **Class:** judgment · **Verdict:** rule
 *   - **Author:** edmond · **Date:** 2026-09-15T14:32:10Z · **Commit:** a1b2c3d · **Supersedes:** —
 *
 * DECISIONS.md groups entries under `## <Dimension>` headings; the archive is
 * flat and chronological. Round-trip is lossless: parse(format(d)) deep-equals d.
 * The separator ` · ` only joins fields that can't contain it (enums, ids, SHAs,
 * dates, names).
 */

import { Decision, DecisionClass, Dimension, DIMENSIONS, Evidence, ID_PATTERN, Level, StoredVerdict } from './schema';

const SEP = ' · ';
const NONE = '—';

const HEADING = /^#{2,3} ([DP]-\d{4,}) · (.*)$/;
const REJECTED_ITEM = /^ {2}- (.*)$/;
const FIELD = /\*\*([A-Za-z]+):\*\* (.*?)(?=\s·\s\*\*|$)/g;

export function formatEntry(d: Decision): string {
  return [
    `### ${d.id}${SEP}${d.decision}`,
    '',
    ...(d.change ? [`- **Change:** ${d.change}`] : []),
    `- **Rationale:** ${d.rationale}`,
    ...(d.rejected.length ? ['- **Rejected:**', ...d.rejected.map((r) => `  - ${r}`)] : []),
    `- **Trigger:** ${d.trigger}`,
    `- **Scope:** ${d.scope}${SEP}**Dimension:** ${d.dimension}${SEP}**Level:** ${d.level}${SEP}**Class:** ${d.class}${SEP}**Verdict:** ${d.verdict}`,
    `- **Author:** ${d.author}${SEP}**Date:** ${d.date}${SEP}**Commit:** ${d.commit ?? NONE}${SEP}**Supersedes:** ${d.supersedes ?? NONE}${d.candidate ? `${SEP}**Candidate:** ${d.candidate}` : ''}`,
    ...(d.ref ? [`- **Ref:** ${d.ref}`] : []),
    ...(d.files.length ? [`- **Files:** ${d.files.join(SEP)}`] : []),
    ...(d.paths.length ? [`- **Paths:** ${d.paths.join(SEP)}`] : []),
    ...(d.expect ? [`- **Expect:** ${JSON.stringify(d.expect)}${SEP}**Verified:** ${d.verified === null ? NONE : d.verified ? 'yes' : 'no'}`] : []),
    '',
  ].join('\n');
}

export const DIMENSION_LABELS: Record<Dimension, string> = {
  structure: 'Structure',
  interaction: 'Interaction',
  states: 'States',
  content: 'Content',
  visual: 'Visual',
  motion: 'Motion',
  access: 'Accessibility',
};

/** Entries grouped under `## <Dimension>` headings, in fixed dimension order, by id within. */
export function formatGrouped(decisions: Decision[]): string {
  const blocks: string[] = [];
  for (const dim of DIMENSIONS) {
    const group = decisions.filter((d) => d.dimension === dim).sort((a, b) => a.id.localeCompare(b.id));
    if (!group.length) continue;
    blocks.push(`## ${DIMENSION_LABELS[dim]}\n\n${group.map(formatEntry).join('\n')}`);
  }
  return blocks.join('\n');
}

/**
 * Parse every `## D-xxxx` entry out of a markdown document. Anything before the
 * first entry (headers, prose) is ignored, so files can carry a human preamble.
 */
export function parseEntries(md: string): Decision[] {
  const out: Decision[] = [];
  const lines = md.split('\n');
  let cur: Partial<Decision> | null = null;
  let inRejected = false;

  const flush = () => {
    if (!cur) return;
    out.push(complete(cur));
    cur = null;
  };

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const h = HEADING.exec(line);
    if (h) {
      flush();
      cur = { id: h[1], decision: h[2].trim(), rejected: [] };
      inRejected = false;
      continue;
    }
    if (/^#{1,6} /.test(line)) {
      // Some other heading — ends the current entry.
      flush();
      continue;
    }
    if (!cur) continue;

    if (inRejected) {
      const item = REJECTED_ITEM.exec(line);
      if (item) {
        cur.rejected!.push(item[1].trim());
        continue;
      }
      inRejected = false;
    }
    if (!line.startsWith('- **')) continue;
    if (line === '- **Rejected:**') {
      inRejected = true;
      continue;
    }

    for (const m of line.slice(2).matchAll(FIELD)) {
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      switch (key) {
        case 'change': cur.change = val; break;
        case 'level': cur.level = val as Level; break;
        case 'rationale': cur.rationale = val; break;
        case 'trigger': cur.trigger = val; break;
        case 'scope': cur.scope = val; break;
        case 'dimension': cur.dimension = val as Dimension; break;
        case 'class': cur.class = val as DecisionClass; break;
        case 'verdict': cur.verdict = val as StoredVerdict; break;
        case 'author': cur.author = val; break;
        case 'date': cur.date = val; break;
        case 'commit': cur.commit = val === NONE ? null : val; break;
        case 'supersedes': cur.supersedes = val === NONE ? null : val; break;
        case 'ref': cur.ref = val === NONE ? null : val; break;
        case 'candidate': cur.candidate = val === NONE ? null : val; break;
        case 'files': cur.files = val.split(SEP).map((f) => f.trim()).filter(Boolean); break;
        case 'paths': cur.paths = val.split(SEP).map((f) => f.trim()).filter(Boolean); break;
        case 'expect': cur.expect = JSON.parse(val) as Evidence; break;
        case 'verified': cur.verified = val === NONE ? null : val === 'yes'; break;
      }
    }
  }
  flush();
  return out;
}

function complete(p: Partial<Decision>): Decision {
  const missing = (['id', 'decision', 'rationale', 'trigger', 'scope', 'dimension', 'class', 'verdict', 'author', 'date'] as const)
    .filter((k) => p[k] === undefined);
  if (missing.length) {
    throw new Error(`entry ${p.id ?? '?'} is missing: ${missing.join(', ')}`);
  }
  if (!ID_PATTERN.test(p.id!)) throw new Error(`bad id: ${p.id}`);
  return {
    id: p.id!,
    decision: p.decision!,
    change: p.change ?? null,
    // Entries written before levels existed read as pattern — the middle ground.
    level: p.level ?? 'pattern',
    rationale: p.rationale!,
    rejected: p.rejected ?? [],
    trigger: p.trigger!,
    scope: p.scope!,
    dimension: p.dimension!,
    class: p.class!,
    verdict: p.verdict!,
    author: p.author!,
    date: p.date!,
    commit: p.commit ?? null,
    supersedes: p.supersedes ?? null,
    ref: p.ref ?? null,
    files: p.files ?? [],
    paths: p.paths ?? [],
    expect: p.expect ?? null,
    verified: p.expect ? (p.verified ?? null) : null,
    candidate: p.candidate ?? null,
  };
}

export function activeHeader(count: number, cap: number): string {
  return [
    '# Decisions',
    '',
    `Active design rules for this project — ${count} of ${cap}.`,
    '',
    'Read before any UI work. Each entry is a call that was made once and should not be',
    're-made. `Change` is what happened in plain words; `Rationale` is the why; `Rejected` is',
    'what lost, and why; `Trigger` is the case that prompted it. Superseded rules drop out of',
    'here and stay in `.arbiter/archive.md`.',
    '',
    'Add entries with `npx arbiter record`. Edit by hand if you must — the format round-trips.',
    '',
  ].join('\n');
}

export function archiveHeader(): string {
  return [
    '# Decision archive',
    '',
    'Every decision ever recorded, in order. A decision you changed your mind about is superseded,',
    'never rewritten; only `npx arbiter remove` takes an entry out, for a record of something that',
    'never happened. Active rules live in `DECISIONS.md`; this file is for traceability and is never',
    'loaded into agent context.',
    '',
  ].join('\n');
}

export function pendingHeader(): string {
  return [
    '# Pending decisions',
    '',
    'Queued by the agent, not yet judged. Review with `npx arbiter review` or `/arbiter` in chat.',
    'Judged entries move to `.arbiter/archive.md` (and `DECISIONS.md` if made a rule); skipped',
    'entries are dropped. Nothing here is in agent context.',
    '',
  ].join('\n');
}
