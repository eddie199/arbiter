/**
 * Candidates: one generated screen or direction, with a state.
 *
 *   generated → in_review → approved | rejected | superseded
 *
 * One markdown file each in .arbiter/candidates/, snapshot image beside it.
 * Decisions link to a candidate from their side (`candidate: C-0001`); the
 * list in the candidate file is regenerated on every write, so it's a view,
 * not a second source of truth. GitHub renders these files as-is — that's
 * the whole git destination.
 */

import fs from 'node:fs';
import path from 'node:path';
import { Decision } from './schema';
import { Paths, readArchive, readPending } from './store';

export const STATES = ['generated', 'in_review', 'approved', 'rejected', 'superseded'] as const;
export type CandidateState = (typeof STATES)[number];

export interface Candidate {
  id: string;
  name: string;
  feature: string | null;
  state: CandidateState;
  /** File name of the snapshot inside .arbiter/candidates/, or null. */
  snapshot: string | null;
  author: string;
  date: string;
  commit: string | null;
  supersededBy: string | null;
  reason: string | null;
  notes: string;
}

const SEP = ' · ';
const NONE = '—';

export function candidatesDir(paths: Paths): string {
  return path.join(paths.archiveDir, 'candidates');
}

export function candidateFile(paths: Paths, id: string): string {
  return path.join(candidatesDir(paths), `${id}.md`);
}

export function readCandidates(paths: Paths): Candidate[] {
  const dir = candidatesDir(paths);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^C-\d{4,}\.md$/.test(f))
    .sort()
    .map((f) => parseCandidate(fs.readFileSync(path.join(dir, f), 'utf8')));
}

export function nextCandidateId(all: Candidate[]): string {
  const max = all.reduce((m, c) => Math.max(m, Number(c.id.slice(2))), 0);
  return `C-${String(max + 1).padStart(4, '0')}`;
}

/** Decisions made for this candidate, judged or pending. */
export function decisionsFor(paths: Paths, id: string): Decision[] {
  return [...readArchive(paths), ...readPending(paths)].filter((d) => d.candidate === id);
}

export function writeCandidate(paths: Paths, c: Candidate): void {
  fs.mkdirSync(candidatesDir(paths), { recursive: true });
  fs.writeFileSync(candidateFile(paths, c.id), formatCandidate(c, decisionsFor(paths, c.id)));
}

export function formatCandidate(c: Candidate, decisions: Decision[]): string {
  const lines = [
    `# ${c.id}${SEP}${c.name}`,
    '',
    ...(c.snapshot ? [`![${c.name}](${c.snapshot})`, ''] : []),
    `- **Feature:** ${c.feature ?? NONE}`,
    `- **State:** ${c.state}`,
    `- **Author:** ${c.author}${SEP}**Date:** ${c.date}${SEP}**Commit:** ${c.commit ?? NONE}`,
    `- **Superseded by:** ${c.supersededBy ?? NONE}${SEP}**Reason:** ${c.reason ?? NONE}`,
    '',
    '## Decisions',
    '',
  ];
  if (!decisions.length) lines.push('_None linked yet._');
  for (const d of decisions) {
    const tag = d.verdict === 'pending' ? 'pending' : d.verdict;
    lines.push(`- **${d.id}** · ${d.decision} _(${tag}${d.rejected.length ? `, over: ${d.rejected.map((r) => r.split(' — ')[0]).join(', ')}` : ''})_`);
  }
  lines.push('', '## Notes', '', c.notes || '_None._', '');
  return lines.join('\n');
}

const HEADING = /^# (C-\d{4,}) · (.*)$/;
const IMG = /^!\[.*?\]\((.+?)\)$/;
const FIELD = /\*\*([A-Za-z ]+):\*\* (.*?)(?=\s·\s\*\*|$)/g;

export function parseCandidate(md: string): Candidate {
  const lines = md.split('\n');
  const c: Partial<Candidate> = { snapshot: null, feature: null, supersededBy: null, reason: null, notes: '', commit: null };
  let section: 'head' | 'decisions' | 'notes' = 'head';
  const notes: string[] = [];

  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const h = HEADING.exec(line);
    if (h) {
      c.id = h[1];
      c.name = h[2].trim();
      continue;
    }
    if (line === '## Decisions') { section = 'decisions'; continue; }
    if (line === '## Notes') { section = 'notes'; continue; }
    if (section === 'notes') { notes.push(line); continue; }
    if (section !== 'head') continue;

    const img = IMG.exec(line);
    if (img) { c.snapshot = img[1]; continue; }
    if (!line.startsWith('- **')) continue;
    for (const m of line.slice(2).matchAll(FIELD)) {
      const key = m[1].toLowerCase();
      const val = m[2].trim();
      const v = val === NONE ? null : val;
      switch (key) {
        case 'feature': c.feature = v; break;
        case 'state': c.state = val as CandidateState; break;
        case 'author': c.author = val; break;
        case 'date': c.date = val; break;
        case 'commit': c.commit = v; break;
        case 'superseded by': c.supersededBy = v; break;
        case 'reason': c.reason = v; break;
      }
    }
  }
  const notesText = notes.join('\n').trim();
  c.notes = notesText === '_None._' ? '' : notesText;
  for (const k of ['id', 'name', 'state', 'author', 'date'] as const) {
    if (c[k] === undefined) throw new Error(`candidate ${c.id ?? '?'} is missing: ${k}`);
  }
  return c as Candidate;
}
