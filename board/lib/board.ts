/**
 * The board's words and groupings: how a card finds its area, how a scope reads, what a state is called.
 * Copied from the site's hosted/lib/board.ts (site bff92c0, 4 Nov 2026), without the team board's
 * upload checks and storage limits. The local board owns it now.
 *
 * The data's shape lives with the CLI that sends it, in src/board-types.ts.
 */
import type { BoardDecision, BoardRequest, CandidateState } from '../../src/board-types';

export type { Board, BoardCandidate, BoardDecision, BoardRequest, BoardRule, CandidateState } from '../../src/board-types';

/** Record text shown as a sentence: first letter up, the rest as written. */
export const sentence = (s: string): string => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * A name without the area it already sits under, so the breadcrumb doesn't say it twice:
 * "Billing — plan names" in Billing is "Plan names"; "Reports filters" in Reports is "Filters".
 * A name that is the area, or doesn't start with it, stays as it is.
 */
export function nameIn(area: string, name: string): string {
  const n = name.trim(), a = area.trim();
  if (!a || !n.toLowerCase().startsWith(a.toLowerCase())) return n;
  // Only at a word boundary: "Settingsfoo" isn't in Settings.
  const m = /^(?:\s*[—–]\s*|\s+-\s+|:\s+|\s+)(.+)$/.exec(n.slice(a.length));
  return m ? sentence(m[1].trim()) : n;
}

/** How a change finds its area: shared with the CLI, so `arbiter areas` and the board agree. */
export { FOUNDATIONS, areasFor } from '../../src/area-names';

/** `pattern:compact-card-actions` → "Compact card actions, anywhere"; `file:app/x.tsx` → "x.tsx"; `global` → "Everywhere". */
export function scopeWords(scope?: string): string | null {
  if (!scope) return null;
  if (scope === 'global') return 'Everywhere';
  const i = scope.indexOf(':');
  const kind = scope.slice(0, i), target = scope.slice(i + 1);
  if (kind === 'file') return target.split('/').pop() ?? target;
  return target.replace(/[-_]+/g, ' ').replace(/^\w/, (ch) => ch.toUpperCase()) + ', anywhere';
}

/**
 * Everything said in a thread, oldest first: each comment, each request, and the owner's answer
 * to a request, one message apiece. A request is only marked as one; its answer is a reply like any other.
 */
export function conversation(notes: { id: string; kind: string; author_name: string; created_at: string }[], requests: BoardRequest[]): { who: string; at: string }[] {
  const said = notes.flatMap((n) => {
    const own = { who: n.author_name, at: n.created_at };
    const a = n.kind === 'request' ? requests.find((r) => r.comment === n.id) : undefined;
    return a ? [own, { who: a.by ?? 'The owner', at: a.at ?? n.created_at }] : [own];
  });
  return said.sort((x, y) => Date.parse(x.at) - Date.parse(y.at));
}

export const STATE_ORDER: CandidateState[] = ['approved', 'in_review', 'generated', 'recorded', 'rejected', 'superseded'];
/** In a designer's words. The record keeps its own (`generated`, `superseded`, `recorded`); only the board says these. */
export const STATE_LABEL: Record<CandidateState, string> = { approved: 'Approved', in_review: 'In review', generated: 'Draft', recorded: 'Decided', rejected: 'Rejected', superseded: 'Replaced' };
export const DIMENSION_LABEL: Record<string, string> = { structure: 'Structure', interaction: 'Interaction', states: 'States', content: 'Content', visual: 'Visual', motion: 'Motion', access: 'Accessibility' };

/** A change page with at least this many decisions, of more than one kind, gets a Kind filter. */
export const KIND_FILTER_AT = 6;

/**
 * The Kind filter's options on a change page: each kind its decisions are, with how many, in the
 * record's order. None for a short page, or one of a single kind: there's nothing to narrow.
 */
export function kindOptions(decisions: BoardDecision[]): { value: string; label: string; hint: string }[] {
  const counts = new Map<string, number>();
  for (const d of decisions) if (d.dimension) counts.set(d.dimension, (counts.get(d.dimension) ?? 0) + 1);
  if (decisions.length < KIND_FILTER_AT || counts.size < 2) return [];
  const order = Object.keys(DIMENSION_LABEL);
  return [...counts].sort(([a], [b]) => order.indexOf(a) - order.indexOf(b)).map(([k, n]) => ({ value: k, label: DIMENSION_LABEL[k] ?? k, hint: String(n) }));
}
