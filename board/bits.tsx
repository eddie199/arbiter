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

/** The Review inbox's tray: the icon the side nav and the phone's top bar give the inbox. */
const TRAY = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M1.5 8.5 3 2.5h8l1.5 6v3h-11z" /><path d="M1.5 8.5h3.25l.75 1.5h3l.75-1.5h3.25" /></svg>;

/**
 * On a card or a row, what's waiting for you: the inbox's tray and how many, in the Waiting pill's
 * colour. The words are there for a screen reader and on hover.
 */
export function ReviewCount({ n }: { n: number }) {
  const words = `${n} to review`;
  return <Badge tone="info" className="gap-1 tabular-nums" title={words}>{TRAY}<span aria-hidden="true">{n}</span><span className="sr-only">{words}</span></Badge>;
}

const icon = (d: React.ReactNode) => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">{d}</svg>;
/** A decision: a tick in a box. Comments and requests use a thread's own glyphs (Comments.tsx). */
const DECIDED = icon(<><rect x="2" y="2" width="12" height="12" rx="3" /><path d="M5.25 8.25 7 10l3.75-4" /></>);
/** The tick at the tray's size, for inside a pill. */
const DECIDED_SMALL = <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><rect x="2" y="2" width="12" height="12" rx="3" /><path d="M5.25 8.25 7 10l3.75-4" /></svg>;
const COMMENTED = icon(<path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />);
const REQUESTED = icon(<path d="M10.5 2.5l3 3-7.5 7.5H3v-3z" />);

/**
 * A card's or a row's counts as icons and numbers, each named on hover and to a screen reader: how
 * many decisions, then comments and open requests when there are any.
 */
export function Counts({ decisions, comments, requests }: { decisions: number; comments: number; requests: number }) {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const items = [
    comments ? { icon: COMMENTED, n: comments, words: plural(comments, 'comment') } : null,
    requests ? { icon: REQUESTED, n: requests, words: plural(requests, 'open request') } : null,
  ].filter((x): x is { icon: React.ReactElement; n: number; words: string } => !!x);
  if (!decisions && !items.length) return null;
  const decided = plural(decisions, 'decision');
  return (
    <span className="inline-flex items-center gap-3 text-[13px] tabular-nums text-muted">
      {/* Decided is a pill like what's waiting, in green: the two read as a pair, to do and done. */}
      {decisions ? <Badge tone="done" className="gap-1 tabular-nums" title={decided}>{DECIDED_SMALL}<span aria-hidden="true">{decisions}</span><span className="sr-only">{decided}</span></Badge> : null}
      {items.map((x) => <span key={x.words} className="inline-flex items-center gap-1" title={x.words}>{x.icon}<span aria-hidden="true">{x.n}</span><span className="sr-only">{x.words}</span></span>)}
    </span>
  );
}

/** A piece of work with nothing judged on it yet: only the local board has these. */
/** Arbiter Team is in early access, by invitation: the Plans page says what it adds, and how to ask. */
export const PLANS = 'https://arbiter.design/plans';

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
