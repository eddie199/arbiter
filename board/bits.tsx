import { areasFor, type BoardCandidate } from '@/lib/board';
import { Badge, stateTone } from '@/components/ui/badge';
import type { LocalBoard } from './types';

/** As in components/Shell.tsx, without the footer that file's Next.js link comes with. */
export function StateBadge({ state, label }: { state: string; label: string }) {
  return <Badge tone={stateTone(state)}>{label}</Badge>;
}

/** Local only: a change with decisions you haven't judged yet. */
export function WaitingBadge() {
  return <Badge tone="info">Waiting</Badge>;
}

/** A piece of work with nothing judged on it yet: only the local board has these. */
export const undecided = (c: { work?: boolean; decisions: unknown[] }) => !!c.work && !c.decisions.length;

/**
 * lib/board's areasFor, with work that's only waiting placed by what's waiting on it: the area
 * it will have once judged, so judging it doesn't move it to another.
 */
export function areasOf(data: LocalBoard): (c: BoardCandidate) => string {
  const placed = (c: BoardCandidate) => (undecided(c) ? { ...c, decisions: data.queued?.[c.id] ?? [] } : c);
  const of = areasFor(data.board.candidates.map(placed));
  return (c) => of(placed(c));
}

export const cap =(n: string) => n.split(', ').map((x) => x.charAt(0).toUpperCase() + x.slice(1)).join(', ');
