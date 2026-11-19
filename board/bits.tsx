import { areasFor, sameHead, STATUS_LABEL, statusRank, type BoardCandidate, type Status } from '@/lib/board';
import { Badge } from '@/components/ui/badge';
import { Tooltip } from '@/components/ui/tooltip';
import type { LocalBoard } from './types';

/**
 * A change's status as a pill: Approved in green, Rejected in amber, Proposed in grey (not waiting on you
 * in the inbox, so not blue). `tip` says more on hover, as a Clash pill does.
 */
export function StatusBadge({ status, tip }: { status: Status; tip?: string }) {
  const pill = <Badge tone={status === 'approved' ? 'ok' : status === 'rejected' ? 'warn' : 'neutral'} className={tip ? 'cursor-default' : undefined}>{STATUS_LABEL[status]}</Badge>;
  return tip ? <Tooltip label={tip}>{pill}</Tooltip> : pill;
}

/**
 * A set of options: the versions the agent built of one thing to choose between, the options in one area
 * whose names start the same ("Empty state — …"), so two things explored in one area stay two sets.
 * Ordered approved first, then the ones still open, then the rejected, so its first is the one that stands for it.
 */
export function optionSet(cands: BoardCandidate[], areaOf: (c: BoardCandidate) => string, c: BoardCandidate): BoardCandidate[] {
  if (c.work) return [c];
  const area = areaOf(c);
  return cands.filter((x) => !x.work && areaOf(x) === area && sameHead(x, c)).sort((a, b) => statusRank(a) - statusRank(b) || a.id.localeCompare(b.id));
}

/**
 * What the Overview shows: every piece of work, and one card per set of options (its first), so the work
 * stays the main thing and three versions of one component take one place, not three.
 */
export const overviewCards = (cands: BoardCandidate[], areaOf: (c: BoardCandidate) => string) =>
  cands.filter((c) => c.work || optionSet(cands, areaOf, c)[0] === c);

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
  return <Tooltip label={words}><Badge tone="info" className="gap-1 tabular-nums">{TRAY}<span aria-hidden="true">{n}</span><span className="sr-only">{words}</span></Badge></Tooltip>;
}

/** Diverging arrows: one thing, built more than one way. */
const OPTIONS = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M7 12.5V8.5L3 3" /><path d="M7 8.5 11 3" /><path d="M3 6V3h3" /><path d="M8 3h3v3" /></svg>;

/**
 * On a set of options' card or row: how many versions there are, as diverging arrows and a count, in grey
 * (nothing to do, unlike Waiting's blue). Once you've approved one, the others: the card already names it.
 * The words are there for a screen reader and on hover.
 */
export function OptionsCount({ n, others }: { n: number; others?: boolean }) {
  const words = `${n} ${others ? 'other ' : ''}option${n === 1 ? '' : 's'}`;
  return <Tooltip label={words}><Badge className="gap-1 tabular-nums">{OPTIONS}<span aria-hidden="true">{n}</span><span className="sr-only">{words}</span></Badge></Tooltip>;
}

/**
 * Code or an id inside a clash's line, as a small chip in the board's mono, so it reads apart from the
 * words: the text a Code Clash names, the rule a Rule Clash is with.
 */
export const CHIP = 'break-words rounded-[4px] border border-border bg-bg px-[5px] font-mono text-[12.5px] text-fg';

/** A flag: the agent's work disagrees with something and needs your call. */
const FLAG = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M3 12.5V1.75" /><path d="M3 2.25h7.75L9 4.75l1.75 2.5H3" /></svg>;

/**
 * In the Review inbox, a decision the agent's work disagrees with: a Rule Clash goes against a rule in
 * DECISIONS.md, a Code Clash says something the files it names don't. Both flagged, so they read as one kind of thing.
 */
export function ClashBadge({ with: what, tip }: { with: 'Rule' | 'Code'; tip: string }) {
  return <Tooltip label={tip}><Badge tone="bad" className="cursor-default gap-1">{FLAG}{what} Clash</Badge></Tooltip>;
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
 * many decisions, then `then` (a set's options pill, so the pills sit together), then comments and
 * open requests when there are any.
 */
export function Counts({ decisions, comments, requests, then }: { decisions: number; comments: number; requests: number; then?: React.ReactNode }) {
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const items = [
    comments ? { icon: COMMENTED, n: comments, words: plural(comments, 'comment') } : null,
    requests ? { icon: REQUESTED, n: requests, words: plural(requests, 'open request') } : null,
  ].filter((x): x is { icon: React.ReactElement; n: number; words: string } => !!x);
  if (!decisions && !items.length && !then) return null;
  const decided = plural(decisions, 'decision');
  return (
    <span className="inline-flex items-center gap-3 text-[13px] tabular-nums text-muted">
      {/* Decided is a pill like what's waiting, in green: the two read as a pair, to do and done. */}
      {decisions ? <Tooltip label={decided}><Badge tone="done" className="gap-1 tabular-nums">{DECIDED_SMALL}<span aria-hidden="true">{decisions}</span><span className="sr-only">{decided}</span></Badge></Tooltip> : null}
      {then}
      {items.map((x) => <Tooltip key={x.words} label={x.words}><span className="inline-flex items-center gap-1">{x.icon}<span aria-hidden="true">{x.n}</span><span className="sr-only">{x.words}</span></span></Tooltip>)}
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
