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
 *   - **Scope:** pattern:destructive-confirm · **Dimension:** interaction · **Level:** pattern · **Class:** judgment · **Verdict:** rule · **Call:** asked
 *   - **Author:** edmond · **Date:** 2026-09-15T14:32:10Z · **Commit:** a1b2c3d · **Supersedes:** — · **Against:** D-0004
 *
 * `Call`, `Against`, `Candidate` and the `Reworded:` list appear only when set.
 *
 * DECISIONS.md groups entries under `## <Dimension>` headings; the archive is
 * flat and chronological. Round-trip is lossless: parse(format(d)) deep-equals d.
 * The separator ` · ` only joins fields that can't contain it (enums, ids, SHAs,
 * dates, names).
 */

import { Call, Decision, DecisionClass, Dimension, DIMENSIONS, Evidence, ID_PATTERN, Level, StoredVerdict } from './schema';

const SEP = ' · ';
const NONE = '—';

const HEADING = /^#{2,3} ([DP]-\d{4,}) · (.*)$/;
const LIST_ITEM = /^ {2}- (.*)$/;
const FIELD = /\*\*([A-Za-z]+):\*\* (.*?)(?=\s·\s\*\*|$)/g;

/**
 * A value as an entry may hold it: one line, with no `**Field:**` marker of its own. Input is
 * checked before it gets here, but some of it comes from outside the project (a board request's
 * author and words, a scanner's message), and one line break would let it write a whole entry,
 * a rule included.
 */
const text = (s: string): string => s.replace(/\s*[\r\n]+\s*/g, ' ').replace(/\*\*([A-Za-z]+):\*\*/g, '$1:');

export function formatEntry(d: Decision): string {
  return [
    `### ${d.id}${SEP}${text(d.decision)}`,
    '',
    ...(d.change ? [`- **Change:** ${text(d.change)}`] : []),
    `- **Rationale:** ${text(d.rationale)}`,
    ...(d.rejected.length ? ['- **Rejected:**', ...d.rejected.map((r) => `  - ${text(r)}`)] : []),
    ...(d.reworded.length ? ['- **Reworded:**', ...d.reworded.map((r) => `  - ${text(r)}`)] : []),
    `- **Trigger:** ${text(d.trigger)}`,
    `- **Scope:** ${text(d.scope)}${SEP}**Dimension:** ${d.dimension}${SEP}**Level:** ${d.level}${SEP}**Class:** ${d.class}${SEP}**Verdict:** ${d.verdict}${d.call ? `${SEP}**Call:** ${d.call}` : ''}`,
    `- **Author:** ${text(d.author)}${SEP}**Date:** ${text(d.date)}${SEP}**Commit:** ${d.commit ?? NONE}${SEP}**Supersedes:** ${d.supersedes ?? NONE}${d.candidate ? `${SEP}**Candidate:** ${d.candidate}` : ''}${d.against ? `${SEP}**Against:** ${d.against}` : ''}`,
    ...(d.ref ? [`- **Ref:** ${text(d.ref)}`] : []),
    ...(d.files.length ? [`- **Files:** ${d.files.map(text).join(SEP)}`] : []),
    ...(d.paths.length ? [`- **Paths:** ${d.paths.map(text).join(SEP)}`] : []),
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
  // The two indented lists an entry can carry.
  let inList: 'rejected' | 'reworded' | null = null;

  const flush = () => {
    if (!cur) return;
    out.push(complete(cur));
    cur = null;
  };

  for (const raw of lines) {
    // Trailing spaces too (an editor's, or a "- **Rejected:** " typed by hand), as notesOf reads it.
    const line = raw.replace(/\s+$/, '');
    const h = HEADING.exec(line);
    if (h) {
      flush();
      cur = { id: h[1], decision: h[2].trim(), rejected: [], reworded: [] };
      inList = null;
      continue;
    }
    if (/^#{1,6} /.test(line)) {
      // Some other heading — ends the current entry.
      flush();
      continue;
    }
    if (!cur) continue;

    if (inList) {
      const item = LIST_ITEM.exec(line);
      if (item) {
        cur[inList]!.push(item[1].trim());
        continue;
      }
      inList = null;
    }
    if (!line.startsWith('- **')) continue;
    if (line === '- **Rejected:**' || line === '- **Reworded:**') {
      inList = line === '- **Rejected:**' ? 'rejected' : 'reworded';
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
        case 'against': cur.against = val === NONE ? null : val; break;
        case 'call': cur.call = val === NONE ? null : (val as Call); break;
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
    against: p.against ?? null,
    call: p.call ?? null,
    reworded: p.reworded ?? [],
  };
}

const HEADER_TITLE = '# Decisions';
const HEADER_COUNT = /^Active design rules for this project/;
/** The header's last line starts this way in every version, so a rewrite finds where it ends. */
const HEADER_LAST = 'Add entries with `npx arbiter record`.';

export function activeHeader(count: number, cap: number): string {
  return [
    HEADER_TITLE,
    '',
    `Active design rules for this project — ${count} of ${cap}.`,
    '',
    'Read before any UI work. Each entry is a call that was made once and should not be',
    're-made. `Change` is what happened in plain words; `Rationale` is the why; `Rejected` is',
    'what lost, and why; `Trigger` is the case that prompted it. Superseded rules drop out of',
    'here and stay in `.arbiter/archive.md`.',
    '',
    `${HEADER_LAST} Edit by hand if you must: the format round-trips, and notes of your own are kept.`,
    '',
  ].join('\n');
}

/**
 * Whether a rules file is Arbiter's to rewrite: empty, or carrying Arbiter's header or an entry it
 * can read. Anything else (a project's own decision log, say) belongs to someone else.
 */
export function isRulesFile(md: string): boolean {
  if (!md.trim()) return true;
  if (md.replace(/\r\n/g, '\n').split('\n').some((l) => HEADER_COUNT.test(l))) return true;
  try {
    return parseEntries(md).length > 0;
  } catch {
    return false;
  }
}

/** Text in the rules file that isn't Arbiter's header, a dimension heading or an entry. */
export interface Notes { top: string; bottom: string }

/** A field an entry carries, as it's written. These are re-written from the entry; any other line in it is a note. */
const ENTRY_LINE = /^- \*\*(Change|Rationale|Rejected|Reworded|Trigger|Scope|Author|Ref|Files|Paths|Expect):\*\*/;
const DIMENSION_HEADING = new RegExp(`^## (${Object.values(DIMENSION_LABELS).join('|')})$`);
const ANY_HEADING = /^#{1,6} /;
/** The lines of Arbiter's header, as every version wrote them. Written fresh, so never kept as notes. */
const HEADER_LINES = new Set(activeHeader(0, 0).split('\n').filter((l) => l.trim()));
const isHeaderLine = (l: string) => HEADER_LINES.has(l) || HEADER_COUNT.test(l) || l.startsWith(HEADER_LAST);

/**
 * What a person wrote in the rules file, so a rewrite can put it back word for word. It reads the file
 * the way parseEntries does: an entry runs from its heading to the next heading. Its fields are written
 * fresh from the entry; any other line inside it (a remark, a wrapped line, a comment) is a note and
 * moves below the rules, so it can never be read into another rule. Text above the first rule stays
 * above, wherever it sits around Arbiter's header; anything after one goes below. Left out: Arbiter's
 * own header lines, its `## <Dimension>` headings and the entries.
 */
export function notesOf(md: string): Notes {
  const lines = md.replace(/^﻿/, '').replace(/\r\n/g, '\n').split('\n');
  const top: string[] = [];
  const bottom: string[] = [];
  let afterRules = false;
  let inEntry = false;
  // An indented item belongs to an entry only under its Rejected or Reworded line, as parseEntries reads it.
  let inList = false;
  let inNotes = false;
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const line = raw.replace(/\s+$/, '');
    if (HEADING.test(line)) {
      inEntry = true;
      inList = false;
      afterRules = true;
      inNotes = false;
      continue;
    }
    if (ANY_HEADING.test(line)) {
      inEntry = false;
      inList = false;
      if (DIMENSION_HEADING.test(line)) {
        // Only Arbiter's own: one with a rule under it. A person's "## Content" over their notes stays theirs.
        const next = lines.slice(i + 1).find((l) => l.trim());
        if (next !== undefined && HEADING.test(next.replace(/\s+$/, ''))) {
          afterRules = true;
          inNotes = false;
          continue;
        }
      }
    }
    if (!afterRules && isHeaderLine(line)) continue;
    const into = afterRules ? bottom : top;
    if (inEntry && line) {
      if (ENTRY_LINE.test(line)) {
        inList = line === '- **Rejected:**' || line === '- **Reworded:**';
        inNotes = false;
        continue;
      }
      if (inList && LIST_ITEM.test(line)) continue;
      inList = false;
    }
    if (!line) {
      if (inNotes) into.push('');
      continue;
    }
    // Notes from two places between the rules come out as two paragraphs, not run together.
    if (!inNotes && into.length && into[into.length - 1] !== '') into.push('');
    into.push(raw);
    inNotes = true;
  }
  const trim = (a: string[]) => a.join('\n').replace(/^\n+|\n+$/g, '');
  return { top: trim(top), bottom: trim(bottom) };
}

/** The rules file as written: header, notes above the rules, the rules, notes below. No notes: as it always was. */
export function formatActive(decisions: Decision[], cap: number, notes: Notes = { top: '', bottom: '' }): string {
  return activeHeader(decisions.length, cap)
    + (notes.top ? '\n' + notes.top + '\n' : '')
    + '\n' + formatGrouped(decisions)
    + (notes.bottom ? (decisions.length ? '\n' : '') + notes.bottom + '\n' : '');
}

export function archiveHeader(rules = 'DECISIONS.md'): string {
  return [
    '# Decision archive',
    '',
    'Every decision ever recorded, in order. A decision you changed your mind about is superseded,',
    'never rewritten; only `npx arbiter remove` takes an entry out, for a record of something that',
    `never happened. Active rules live in \`${rules}\`; this file is for traceability and is never`,
    'loaded into agent context.',
    '',
  ].join('\n');
}

export function pendingHeader(rules = 'DECISIONS.md'): string {
  return [
    '# Pending decisions',
    '',
    'Queued by the agent, not yet judged. Review with `npx arbiter review` or `/arbiter` in chat.',
    `Judged entries move to \`.arbiter/archive.md\` (and \`${rules}\` if made a rule); skipped`,
    'entries are dropped. Nothing here is in agent context.',
    '',
  ].join('\n');
}
