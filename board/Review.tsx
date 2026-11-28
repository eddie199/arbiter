import { useEffect, useRef, useState } from 'react';
import { DIMENSION_LABEL, scopeWords, sentence } from '@/lib/board';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { Screenshot } from '@/components/Screenshot';
import { Faint, Id, KeyValues, Label, Meta, PageTitle } from '@/components/ui/type';
import { MultiSelect } from '@/components/ui/multi-select';
import { Select } from '@/components/ui/select';
import { ActionItem, ActionMenu, ActionSeparator, barDots, DOTS, dotsTrigger } from '@/components/ui/menu';
import { Icon } from '@/components/ui/icons';
import { When } from '@/components/When';
import { BeforeNow } from './Versions';
import { CHIP, ClashBadge, rulesFile } from './bits';
import { CompactIcon, ListIcon, SingleIcon, ViewToggle } from './Toolbar';
import type { Agent, PendingDecision, ReviewState } from './types';
import { errorsOf, post, whenAgent, type Reply } from './api';
import { go, href } from './route';
import { Tooltip } from '@/components/ui/tooltip';
import { clashWords, FullDialog, MismatchDialog, OverlapDialog, type FailedCheck, type Overlap, type RuleLine } from './RuleDialogs';

/** What happened to an item judged in this sitting: it stays in place, collapsed to one line. */
export interface Result { item: PendingDecision; kind: 'ok' | 'skip'; text: string }
export type Results = Record<string, Result>;

const SORT_KEY = 'arbiter-review-sort';
type Sort = 'new' | 'old' | 'big';
const SORTS: { value: Sort; label: string; hint?: string }[] = [
  { value: 'new', label: 'Newest' },
  { value: 'old', label: 'Oldest' },
  { value: 'big', label: 'Biggest', hint: 'Clashes, then features' },
];
type View = 'list' | 'compact' | 'single';
const VIEWS = [
  { value: 'compact' as const, label: 'Compact', icon: CompactIcon },
  { value: 'list' as const, label: 'List', icon: ListIcon },
  { value: 'single' as const, label: 'Single', icon: SingleIcon },
];
/** Typing in a box, or in a dialog like the picture's viewer: the keys are its, not the page's. */
const typing = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || !!t.closest('[role="dialog"]'));

/** A clash with a rule or with the code: checked one by one, never in Confirm all or Skip all. */
const clash = (d: PendingDecision) => !!d.againstRule || !!d.codeClash;
/** Biggest first: a clash needs a call made, then a feature outweighs a pattern, and polish comes last. */
const weight = (d: PendingDecision) => (clash(d) ? 0 : d.level === 'feature' ? 1 : d.level === 'pattern' ? 2 : 3);
const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/**
 * The Review inbox: what the agent decided and you haven't judged, grouped by the piece of work it came
 * from. Each decision reads as it will on the board (Change, Pattern, Rejected, Applies to), with
 * Why, since that's what you judge by. Confirm, Make it a rule, Skip, or Fix it in your own words.
 * It's the one place you judge: a change marked Waiting links here, `at` its card, and the page opens at that work.
 * Sorted newest, oldest or biggest first, and narrowed by area like the Overview, in the hash: `#/review?area=Settings`.
 * Seen as the list, or Single: one decision at a time, judged from the keyboard.
 * Anything judged here can be taken back with Undo on its row while the board stays open.
 */
export function ReviewPage({ state, at, area, areaOfCard, results, onJudged, onUndone, refresh }: { state: ReviewState; at: string | null; area: string[]; areaOfCard: (card: string) => string | null; results: Results; onJudged: (r: Results) => void; onUndone: (id: string) => void; refresh: () => Promise<void> }) {
  const [sort, setSort] = useState<Sort>(() => { try { const s = localStorage.getItem(SORT_KEY); return s === 'old' || s === 'big' ? s : 'new'; } catch { return 'new'; } });
  const pickSort = (s: Sort) => { setSort(s); try { localStorage.setItem(SORT_KEY, s); } catch {} };
  // Compact every time the inbox opens, the first in the toggle. Another view lasts until you leave.
  const [view, setView] = useState<View>('compact');
  const pickView = (v: View) => setView(v);
  // The decision Single shows, kept by id so one arriving while you read doesn't move you.
  const [cur, setCur] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Taken back on disk first, then its card comes back where the row was. A fix the agent has made
  // already is back in the queue, but the code may have changed with it, so that's said.
  const undo = async (id: string): Promise<string | null> => {
    const res = await post('/api/undo', { id });
    if (res.exitCode !== 0) return errorsOf(res);
    await refresh();
    onUndone(id);
    setNotice(res.taken ? 'Taken back. Your agent had already made that fix in the code, so check it there too.' : null);
    return null;
  };

  // One-off fixes aren't asked about: an old one left in a queue from before stays out of the inbox.
  const asked = state.pending.filter((d) => d.level !== 'polish');
  // Judged ones stay where they were until the next visit, so the page doesn't jump under you.
  const done = Object.values(results).filter((r) => !state.pending.some((p) => p.id === r.item.id)).map((r) => r.item);
  const when = (d: PendingDecision) => d.date + d.id;
  const newest = (a: PendingDecision, b: PendingDecision) => (when(a) < when(b) ? 1 : when(a) > when(b) ? -1 : 0);
  // A piece of work with no card on the board yet is placed by its own name.
  const areaOf = (d: PendingDecision) => areaOfCard(d.card) ?? d.trigger;
  const areaCounts = new Map<string, number>();
  for (const d of asked) areaCounts.set(areaOf(d), (areaCounts.get(areaOf(d)) ?? 0) + 1);
  const areas = [...areaCounts].map(([a, n]) => ({ value: a, label: a, hint: String(n) }));
  const picked = area.filter((a) => areaCounts.has(a) || done.some((d) => areaOf(d) === a));
  const all = [...asked, ...done]
    .filter((d) => !picked.length || picked.includes(areaOf(d)))
    .sort((a, b) => (sort === 'big' ? weight(a) - weight(b) || newest(a, b) : sort === 'old' ? -newest(a, b) : newest(a, b)));
  const clashes = all.filter((d) => clash(d) && !results[d.id]);
  // What Confirm all and Skip all at the top take: everything shown and still waiting, but not a clash
  // with a rule or the code, which you check one by one.
  const bulk = all.filter((d) => !results[d.id] && !clash(d));
  const landing = useRef<HTMLElement>(null);
  const target = at ? all.find((d) => d.card === at)?.trigger : undefined;
  useEffect(() => {
    if (landing.current) landing.current.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, [at]);

  const judged = (d: PendingDecision, as: 'accept' | 'skip'): Result => (as === 'accept' ? { item: d, kind: 'ok', text: 'Confirmed' } : { item: d, kind: 'skip', text: 'Skipped' });

  // A group's decisions, confirmed or skipped one by one. One that overlaps a rule stays, for you to answer on its card.
  const judgeGroup = async (list: PendingDecision[], as: 'accept' | 'skip') => {
    const next: Results = {};
    for (const d of list) {
      const res = await post('/api/judge', { id: d.id, as });
      if (res.exitCode === 0) next[d.id] = judged(d, as);
    }
    onJudged(next);
    await refresh();
  };

  if (!all.length) {
    return (
      <main className="max-w-4xl">
        <PageTitle>Review inbox</PageTitle>
        <Meta className="mt-0.5 block">Nothing waiting for you.</Meta>
        <div className="mt-6 rounded-lg border border-dashed border-border-strong px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">All caught up</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">Nothing waiting. The agent queues its decisions here when a piece of work settles.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="max-w-4xl">
      <div className="mb-4">
        <PageTitle>Review inbox</PageTitle>
        <Meta className="mt-0.5 block">{asked.length
          ? `${asked.length} waiting. Confirm what’s right, make what should always hold a rule, and fix the rest in your own words.`
          : 'Nothing left waiting. What you decided is on the board now.'}</Meta>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-border pb-3">
        <Select label="Sort" value={sort} options={SORTS} onChange={(v) => pickSort(v as Sort)} />
        {areas.length > 1 ? <MultiSelect label="Area" values={picked} options={areas} onChange={(v) => go(href('review', { area: v }))} /> : null}
        <div className="ml-auto flex flex-wrap items-center gap-3">
          {bulk.length > 1 ? <BulkMenu list={bulk} clashes={clashes.length} filtered={picked.length > 0} onGo={(as) => judgeGroup(bulk, as)} /> : null}
          <ViewToggle value={view} options={VIEWS} onChange={pickView} />
        </div>
      </div>
      {notice ? <p className="mt-3 flex items-baseline gap-3 text-[13px]">{notice}<button type="button" onClick={() => setNotice(null)} className="text-muted hover:text-fg hover:underline">Dismiss</button></p> : null}
      {view === 'single' ? (
        <Single all={all} results={results} at={at} cur={cur} setCur={setCur} agent={state.agent} onJudged={(r) => { onJudged({ [r.item.id]: r }); void refresh(); }} onUndo={undo} onList={() => pickView('list')} />
      ) : groupByTrigger(all).map((g) => {
        const items = g.items;
        const waiting = items.filter((d) => !results[d.id]).length;
        const pics = [...new Map(items.filter((d) => !results[d.id] && d.picture).map((d) => [d.picture!.command, d.picture!])).values()];
        // What Confirm all and Skip all take: the group's decisions still waiting, but not a clash, which you check one by one.
        const plain = items.filter((d) => !results[d.id] && !clash(d));
        // Its card on the board, when it has one.
        const onBoard = items.map((d) => d.card).find((card) => areaOfCard(card) !== null) ?? null;
        const command = pics.map((p) => p.command).join('\n');
        return (
          <section key={g.trigger} ref={g.trigger === target ? landing : undefined} className="mt-8 scroll-mt-20">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              {/* SectionTitle's shape: the work and how many wait, the number alone. Its actions sit behind
                  "⋯": Confirm all, Skip all, open it on the board, and, when it has no picture, the command
                  that takes one. */}
              <h2 className="text-[15px] font-semibold tracking-tight">
                {g.trigger}
                {waiting ? <span className="font-normal text-muted"> · {waiting}</span> : null}
              </h2>
              {plain.length || onBoard || pics.length ? (
                <ActionMenu label={`Decisions on ${g.trigger}: options`} className={dotsTrigger} trigger={DOTS}>
                  {plain.length ? <ActionItem icon={Icon.check} onClick={() => void judgeGroup(plain, 'accept')} hint={String(plain.length)}>Confirm all</ActionItem> : null}
                  {plain.length ? <ActionItem icon={Icon.skip} onClick={() => void judgeGroup(plain, 'skip')} hint={String(plain.length)}>Skip all</ActionItem> : null}
                  {plain.length && (onBoard || pics.length) ? <ActionSeparator /> : null}
                  {onBoard ? <ActionItem icon={Icon.open} onClick={() => go(href(onBoard))}>Open on the board</ActionItem> : null}
                  {pics.length ? <ActionItem icon={Icon.camera} onClick={() => { void navigator.clipboard?.writeText(command).catch(() => {}); }}>Copy the picture command</ActionItem> : null}
                </ActionMenu>
              ) : null}
            </div>
            <div className={`grid ${view === 'compact' ? 'gap-2' : 'gap-3'}`}>
              {items.map((d, i) => (results[d.id] ? <Judged key={d.id} r={results[d.id]} onUndo={undo} /> : <DecisionCard key={d.id} d={d} i={i} n={items.length} agent={state.agent} compact={view === 'compact'} onJudged={(r) => { onJudged({ [d.id]: r }); void refresh(); }} />))}
            </div>
          </section>
        );
      })}
    </main>
  );
}

/**
 * Confirm all and Skip all for everything the inbox is showing (in the areas picked, if any), behind a
 * "⋯" the toolbar's height, as each group has its own. It's every decision at once, so each asks first,
 * in a small dialog that says what happens. A clash, with a rule or the code, is left for you to check one
 * by one either way, and each one can still be taken back with Undo while the page is open.
 */
function BulkMenu({ list, clashes, filtered, onGo }: { list: PendingDecision[]; clashes: number; filtered: boolean; onGo: (as: 'accept' | 'skip') => Promise<void> }) {
  const [asking, setAsking] = useState<'accept' | 'skip' | null>(null);
  const [busy, setBusy] = useState(false);
  const n = list.length;
  const verb = asking === 'skip' ? 'Skip' : 'Confirm';
  const go = async () => {
    if (!asking) return;
    setBusy(true);
    try { await onGo(asking); } finally { setBusy(false); setAsking(null); }
  };
  return (
    <>
      <ActionMenu label={`All ${n} decisions${filtered ? ' shown' : ''}: confirm or skip them`} tip="Confirm or skip all" className={barDots} trigger={DOTS}>
        <ActionItem icon={Icon.check} onClick={() => setAsking('accept')} hint={String(n)}>Confirm all</ActionItem>
        <ActionItem icon={Icon.skip} onClick={() => setAsking('skip')} hint={String(n)}>Skip all</ActionItem>
      </ActionMenu>
      <Dialog open={asking !== null} onOpenChange={(o) => { if (!o && !busy) setAsking(null); }}>
        <DialogContent>
          <DialogTitle className="font-semibold tracking-tight">{verb} all {n} decisions{filtered ? ' shown' : ''}?</DialogTitle>
          <DialogDescription className="mt-1.5 text-[13px] text-muted">
            {asking === 'skip' ? 'Each one leaves the queue and isn’t recorded anywhere.' : 'Each one joins the board as approved.'}
            {clashes ? ` ${clashes === 1 ? '1 clash stays' : `${clashes} clashes stay`} for you to check one by one.` : ''}
            {' '}You can undo any of them while this page is open.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button size="md" variant="ghost" onClick={() => setAsking(null)} disabled={busy}>Cancel</Button>
            <Button size="md" variant="primary" onClick={() => void go()} disabled={busy}>{busy ? `${asking === 'skip' ? 'Skipping' : 'Confirming'}…` : `${verb} all ${n}`}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * One decision at a time, in the order and area picked above, the picture bigger. Each button has its
 * key: C, R, S and F (Keep as exception, Follow, Make this the rule and Skip on a clash: E, F, R, S); left and right
 * move without judging. Judged, it moves on to the next and says above what it recorded, with Undo (Z)
 * to bring it back.
 */
function Single({ all, results, at, cur, setCur, agent, onJudged, onUndo, onList }: { all: PendingDecision[]; results: Results; at: string | null; cur: string | null; setCur: (id: string) => void; agent: Agent; onJudged: (r: Result) => void; onUndo: (id: string) => Promise<string | null>; onList: () => void }) {
  const queue = all.filter((d) => !results[d.id]);
  const [last, setLast] = useState<Result | null>(null);
  // Where it was: once that one is judged, the one after it has its place.
  const pos = useRef(0);
  let i = queue.findIndex((d) => d.id === cur);
  if (i === -1) i = cur === null ? Math.max(0, at ? queue.findIndex((d) => d.card === at) : 0) : Math.min(pos.current, queue.length - 1);
  pos.current = Math.max(0, i);
  const d = queue[i];
  useEffect(() => { if (d && d.id !== cur) setCur(d.id); }, [d, cur, setCur]);
  const move = (by: number) => { const n = queue[i + by]; if (n) setCur(n.id); };
  // Taken back, it's the one in view again, ready to judge.
  const undo = async (id: string) => {
    const err = await onUndo(id);
    if (!err) { setCur(id); setLast(null); }
    return err;
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target)) return;
      const by = e.key === 'ArrowRight' || e.key === 'j' ? 1 : e.key === 'ArrowLeft' || e.key === 'k' ? -1 : 0;
      if (!by) return;
      e.preventDefault();
      move(by);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!d) {
    const judged = all.length - queue.length;
    return (
      <div className="mt-8">
        {last ? <Judged key={last.item.id} r={last} onUndo={undo} keys /> : null}
        <div className="mt-3 rounded-lg border border-dashed border-border-strong px-6 py-14 text-center">
          <p className="font-semibold tracking-tight">All caught up</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">You judged {judged} in this sitting. <button type="button" onClick={onList} className="underline hover:text-fg">See them in the list</button></p>
        </div>
      </div>
    );
  }

  const nav = <>
    <Tooltip label="Previous (←)"><Button className="w-8 px-0!" disabled={i === 0} onClick={() => move(-1)} aria-label="Previous">{ArrowLeft}</Button></Tooltip>
    <Tooltip label="Next (→)"><Button className="w-8 px-0!" disabled={i === queue.length - 1} onClick={() => move(1)} aria-label="Next">{ArrowRight}</Button></Tooltip>
  </>;
  return (
    <div className="mt-8">
      {last ? <div className="mb-4"><Judged key={last.item.id} r={last} onUndo={undo} keys /></div> : null}
      <div className="mb-3 flex min-h-7 items-center gap-3">
        <h2 className="min-w-0 truncate text-[15px] font-semibold tracking-tight">{d.trigger}</h2>
        <span className="ml-auto shrink-0 text-[13px] tabular-nums text-muted" aria-live="polite">{i + 1} of {queue.length}</span>
      </div>
      <DecisionCard key={d.id} d={d} agent={agent} keys wide nav={nav} onJudged={(r) => { setLast(r); onJudged(r); }} />
      <p className="mt-3 text-[12px] text-faint">Press the number on a button to choose it. <Kbd>←</Kbd> <Kbd>→</Kbd> move between decisions without judging.</p>
    </div>
  );
}

const ArrowLeft = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M14 8H2M7 3 2 8l5 5" /></svg>;
const ArrowRight = <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 8h12M9 3l5 5-5 5" /></svg>;

const Kbd = ({ children }: { children: React.ReactNode }) => <kbd className="rounded-[4px] border border-border px-1 font-mono text-[11px] text-muted">{children}</kbd>;

function groupByTrigger(list: PendingDecision[]) {
  const out: { trigger: string; items: PendingDecision[]; polish: PendingDecision[] }[] = [];
  for (const d of list) {
    let g = out.find((x) => x.trigger === d.trigger);
    if (!g) { g = { trigger: d.trigger, items: [], polish: [] }; out.push(g); }
    (d.level === 'polish' ? g.polish : g.items).push(d);
  }
  return out;
}

/** What a judged decision became, faded, with Undo at full strength: it's the one thing left to do here. */
function Judged({ r, onUndo, keys }: { r: Result; onUndo?: (id: string) => Promise<string | null>; keys?: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-[13px]">
      <span className="min-w-0 opacity-60"><span className={r.kind === 'ok' ? 'text-ok' : 'text-muted'}>{r.kind === 'ok' ? '✓' : '—'}</span> <span className="font-medium">{sentence(r.item.change ?? r.item.decision)}</span></span>
      <span className="flex shrink-0 flex-wrap items-baseline gap-x-3">
        <span className="text-muted opacity-60">{r.text}</span>
        {onUndo ? <Undo id={r.item.id} onUndo={onUndo} keys={keys} /> : null}
      </span>
    </div>
  );
}

/** Takes a judgement back, or Z where the keys are on. If it can't be, it says why in its place. */
function Undo({ id, onUndo, keys }: { id: string; onUndo: (id: string) => Promise<string | null>; keys?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    if (busy) return;
    setBusy(true);
    setError(await onUndo(id));
    setBusy(false);
  };
  useEffect(() => {
    if (!keys || error) return;
    // Z, and the Ctrl+Z or Cmd+Z people reach for anyway.
    const onKey = (e: KeyboardEvent) => {
      if (e.altKey || e.shiftKey || typing(e.target) || e.key.toLowerCase() !== 'z') return;
      e.preventDefault();
      void run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  if (error) return <span role="alert" className="text-bad">{error}</span>;
  return (
    <button type="button" disabled={busy} onClick={() => void run()} aria-keyshortcuts={keys ? 'Z' : undefined} className="inline-flex items-baseline gap-1.5 font-medium text-fg hover:underline disabled:opacity-40">
      Undo{keys ? <kbd className="font-mono text-[11px] opacity-60">Z</kbd> : null}
    </button>
  );
}

type Panel =
  | { kind: 'fix' }
  // What Make it a rule stopped to ask, in a dialog, with what was sent and what to say once it's done.
  | { kind: 'overlap'; overlaps: Overlap[]; body: Record<string, unknown>; done?: string }
  | { kind: 'full'; rules: RuleLine[]; cap: number; body: Record<string, unknown>; done?: string }
  | { kind: 'mismatch'; failed: FailedCheck[]; body: Record<string, unknown>; done?: string }
  | { kind: 'message'; text: string; bad?: boolean };


/** One decision waiting for you, in the board's decision shape: its picture if it's visual, id and badges, then the lines. */
function DecisionCard({ d, i, n, agent, keys, wide, nav, compact, onJudged }: { d: PendingDecision; i?: number; n?: number; agent: Agent; keys?: boolean; wide?: boolean; nav?: React.ReactNode; compact?: boolean; onJudged: (r: Result) => void }) {
  const [panel, setPanel] = useState<Panel | null>(null);
  // Compact: closed to its top line and its Change until opened.
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fix, setFix] = useState('');
  const dim = DIMENSION_LABEL[d.dimension] ?? cap(d.dimension);
  const r = d.againstRule;
  // Applies to names a screen, never a file: a decision about one file is about the change it was made on.
  const applies = d.scope.startsWith('file:') ? d.candidateName || d.trigger : scopeWords(d.scope);
  // Only a visual change is shown by a picture; for the rest the screen is beside the point.
  const shot = d.dimension === 'visual' ? d.snapshotUrl : null;

  const send = async (body: Record<string, unknown>, done?: string) => {
    setBusy(true);
    const res = await post('/api/judge', { id: d.id, ...body });
    setBusy(false);
    if (res.exitCode === 2) return setPanel({ kind: 'overlap', overlaps: (res.overlaps as Overlap[]) ?? [], body, done });
    if (res.exitCode === 3) return setPanel({ kind: 'full', rules: (res.active as RuleLine[]) ?? [], cap: Number(res.cap), body, done });
    if (res.exitCode === 4) return setPanel({ kind: 'mismatch', failed: (res.failed as FailedCheck[]) ?? [], body, done });
    if (res.exitCode !== 0) return setPanel({ kind: 'message', text: errorsOf(res), bad: true });
    setPanel(null);
    const skipped = res.status === 'skipped';
    onJudged({
      item: d,
      kind: skipped ? 'skip' : 'ok',
      text: skipped ? 'Skipped' : done ?? `Recorded ${res.id} as ${res.verdict}${res.supersedes ? `, replacing ${res.supersedes}` : ''}${res.verdict === 'fix' ? `. Your agent makes the change ${whenAgent(agent)}` : ''}`,
    });
  };

  // Each button says what it does on hover.
  const skip = { key: 's', label: 'Skip', variant: 'ghost' as const, tip: 'Takes it out of the inbox without recording it.', run: () => void send({ as: 'skip' }) };
  // Goes against a rule: you say which wins, so none of the answers is filled. Keep as exception sits where
  // Confirm does on other cards (both keep what the agent did), and Make this the rule where Make it a rule does.
  const actions: { key: string; label: string; variant?: 'primary' | 'ghost'; tip: string; run: () => void }[] = r ? [
    { key: 'e', label: 'Keep as exception', tip: `This screen keeps it. ${r.id} stays for everything else.`, run: () => void send({ as: 'accept' }, `Recorded as an exception to ${r.id}.`) },
    { key: 'f', label: `Follow ${r.id}`, tip: `Your agent changes it to match ${r.id}.`, run: () => void send({ as: 'fix', to: r.decision, follows: r.id }, `Recorded. Your agent changes it to match ${r.id} ${whenAgent(agent)}.`) },
    { key: 'r', label: 'Make this the rule', variant: 'ghost', tip: `Replaces ${r.id}, which moves to the archive.`, run: () => void send({ as: 'rule', supersedes: r.id }) },
    skip,
  ] : [
    { key: 'c', label: 'Confirm', variant: 'primary', tip: 'Keeps it as it is. It joins the board as approved.', run: () => void send({ as: 'accept' }) },
    ...(d.level !== 'polish' ? [{ key: 'r', label: 'Make it a rule', tip: `Adds it to ${rulesFile()}, so your agent follows it from now on.`, run: () => void send({ as: 'rule' }) }] : []),
    skip,
    { key: 'f', label: 'Fix', variant: 'ghost' as const, tip: 'Say what it should be instead. Your agent makes the change.', run: () => { setFix(''); setPanel({ kind: 'fix' }); } },
  ];
  // The fix and a message are answered on the card; the rest ask in a dialog, over the card as it was.
  const inline = panel?.kind === 'fix' || panel?.kind === 'message';

  useEffect(() => {
    if (!keys) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || busy || typing(e.target)) return;
      if (panel) {
        if (e.key === 'Escape') setPanel(null);
        return;
      }
      // A button's number, 1 for the first, the same on every card; its old letter still works.
      const a = /^[1-9]$/.test(e.key) ? actions[Number(e.key) - 1] : actions.find((x) => x.key === e.key.toLowerCase());
      if (!a) return;
      e.preventDefault();
      a.run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // In Single they're the page's main controls: all one size and outlined, Confirm filled.
  const buttons = actions.map((a, k) => (
    <Tooltip key={a.key} label={a.tip}>
      <Button size={nav ? 'md' : 'sm'} variant={nav && a.variant === 'ghost' ? 'secondary' : a.variant} className={nav ? 'px-2.5!' : undefined} disabled={busy} onClick={a.run} aria-keyshortcuts={keys ? `${k + 1} ${a.key.toUpperCase()}` : undefined}>
        {a.label}{keys ? <kbd className="font-mono text-[11px] opacity-60">{k + 1}</kbd> : null}
      </Button>
    </Tooltip>
  ));

  // Its top line: id, size, type, and when. No name: on the local board it's always you.
  const head = (
    <span className="flex flex-wrap items-center gap-2">
      <Id>{d.id}</Id>
      <Badge tone="info">{cap(d.level)}</Badge>
      <Badge>{dim}</Badge>
      {r ? <ClashBadge with="Rule" tip={`Clashes with ${r.id}, a rule in ${rulesFile()}`} /> : null}
      {d.codeClash ? <ClashBadge with="Code" tip="Clashes with the code: the files it names say otherwise" /> : null}
      <Faint className="ml-auto"><When iso={d.date} />{n ? ` · ${(i ?? 0) + 1} of ${n}` : ''}</Faint>
    </span>
  );
  const change = sentence(d.change ?? d.decision);
  // Everything under the Change line.
  const rest = (
    <>
      {d.change && d.change !== d.decision ? <><Label>Pattern</Label><dd className="text-muted">{sentence(d.decision)}</dd></> : null}
      {d.rejected.length ? <><Label>Rejected</Label><dd className="text-muted">{d.rejected.map((x) => <div key={x}>{sentence(x)}</div>)}</dd></> : null}
      {d.rationale ? <><Label>Why</Label><dd className="text-muted">{sentence(d.rationale)}</dd></> : null}
      {applies ? <><Label>Applies to</Label><dd className="text-muted">{applies}</dd></> : null}
      {d.ref ? <><Label>Ticket</Label><dd className="text-muted">{/^https?:\/\//i.test(d.ref) ? <a href={d.ref} target="_blank" rel="noreferrer" className="underline hover:text-fg">{d.ref}</a> : d.ref}</dd></> : null}
      {/* What it clashes with, last, just above the buttons: the thing to weigh before choosing one. */}
      {/* One Clashes row for both kinds, red like the pills (the flag is the pills' alone): the rule, then
          each thing the files say otherwise, as they are now. */}
      {r || d.codeClash ? (
        <>
          <dt className="text-[13px] text-bad">Clashes</dt>
          <dd className="text-muted">
            {/* The rule's id in the chip the code's text has, linking to it under Design rules; its words stay muted. */}
            {r ? <div><Tooltip label={`${r.rationale ? `${sentence(r.rationale).replace(/\.$/, '')}. ` : ''}See it under Design rules.`}><a href={href('rules', { at: r.id })} className={`${CHIP} hover:border-border-strong`}>{r.id}</a></Tooltip> {sentence(r.decision)}</div> : null}
            {(d.codeClash ?? []).map((f, k) => <div key={k}>{clashWords(f)}</div>)}
          </dd>
        </>
      ) : null}
    </>
  );

  // Its buttons and whatever it's asking (the fix, an overlap), under the rows, in every view.
  const after = (
    <>
      {inline || nav ? null : <div className="mt-3 flex flex-wrap items-center gap-1.5">{buttons}</div>}

      {panel?.kind === 'fix' ? (
        <form className="mt-3 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); if (fix.trim()) void send({ as: 'fix', to: fix.trim() }); }}>
          <p className="mb-2 text-[13px] text-muted">What should it be instead?</p>
          <Textarea autoFocus value={fix} onChange={(e) => setFix(e.target.value)} placeholder={sentence(d.decision)} rows={2} onKeyDown={(e) => {
            if (e.key === 'Escape') setPanel(null);
            else if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); if (fix.trim()) void send({ as: 'fix', to: fix.trim() }); }
          }} />
          <div className="mt-2 flex items-center gap-1.5">
            <Button size="sm" variant="primary" disabled={busy || !fix.trim()}>Save fix</Button>
            {keys ? <Faint className="ml-1">Enter saves, Shift+Enter for a new line, Esc cancels</Faint> : null}
            <Button size="sm" variant="ghost" type="button" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}



      {panel?.kind === 'message' ? (
        <div className="mt-3 flex items-center gap-3 border-t border-border pt-3 text-[14px]">
          <p className={panel.bad ? 'text-bad' : undefined}>{panel.text}</p>
          <Button size="sm" variant="ghost" onClick={() => setPanel(null)}>OK</Button>
        </div>
      ) : null}
    </>
  );
  // Make it a rule's questions, in the same dialogs as a change's page. A fix is checked as its new words.
  const asked = panel && 'body' in panel ? panel : null;
  const mine = { id: d.id, decision: typeof asked?.body.to === 'string' ? asked.body.to : d.decision };
  // Each answer adds to what was sent (anyway, keep both), except a Replace, which settles the overlap Keep both did.
  const again = (extra: Record<string, unknown>) => {
    if (!asked) return;
    const { keepBoth: _kept, ...rest } = asked.body;
    void send({ ...('supersedes' in extra ? rest : asked.body), ...extra }, asked.done);
  };
  const close = () => setPanel(null);
  const dialogs = (
    <>
      <OverlapDialog mine={mine} busy={busy} onClose={close} overlaps={panel?.kind === 'overlap' ? panel.overlaps : null} onKeepBoth={() => again({ keepBoth: true })} onReplace={(id) => again({ supersedes: id })} />
      <FullDialog mine={mine} busy={busy} onClose={close} full={panel?.kind === 'full' ? panel : null} onReplace={(id) => again({ supersedes: id })} />
      <MismatchDialog mine={mine} busy={busy} onClose={close} failed={panel?.kind === 'mismatch' ? panel.failed : null} anyway={asked?.body.as === 'rule' ? 'Make it a rule anyway' : 'Save fix anyway'} onAnyway={() => again({ unverified: true })} />
    </>
  );
  const arrow = <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 text-faint transition-transform ${open ? 'rotate-180' : ''}`}><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;
  const toggle = () => setOpen((o) => !o);

  // Compact is this card folded to its top line and its change, the top line where List and Single have it.
  // The change sits under it, without its label. Clicking the row opens the rest beneath it; the arrow sits
  // on the line with the date, down while closed and up while open.
  const card = compact ? (
    <div id={d.id} className="scroll-mt-20 rounded-lg border border-border bg-surface p-4">
      <div role="button" tabIndex={0} aria-expanded={open} onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } }}
        className="-m-2 cursor-pointer rounded-ui p-2 outline-none hover:bg-surface-2 focus-visible:ring-1 focus-visible:ring-border-strong">
        <div className="flex items-center gap-3"><span className="min-w-0 flex-1">{head}</span>{arrow}</div>
        <p className="mt-1.5 max-w-2xl text-[14px] font-medium">{change}</p>
      </div>
      {open ? (
        <>
          <KeyValues className="mt-3 max-w-2xl">{rest}</KeyValues>
          {shot ? <div className="mt-4">{d.before ? <BeforeNow before={d.before} now={shot} alt={d.candidateName ?? d.trigger} height={200} /> : <Screenshot src={shot} alt={d.candidateName ?? d.trigger} height={240} />}</div> : null}
          {after}
        </>
      ) : null}
    </div>
  ) : (
    <div id={d.id} className="scroll-mt-20 rounded-lg border border-border bg-surface p-4">
      {/* The picture of its screen or its work across the top; with the one from before, when it was retaken since. */}
      {shot ? <div className="mb-4">{d.before ? <BeforeNow before={d.before} now={shot} alt={d.candidateName ?? d.trigger} height={wide ? 280 : 200} /> : <Screenshot src={shot} alt={d.candidateName ?? d.trigger} height={wide ? 360 : 240} />}</div> : null}
      <div className="mb-3">{head}</div>
      <KeyValues className="max-w-2xl">
        <Label>Change</Label>
        <dd className="font-medium">{change}</dd>
        {rest}
      </KeyValues>
      {after}
    </div>
  );
  if (!nav) return <>{card}{dialogs}</>;

  // Single: the buttons sit under the card on the page itself, across its width, the arrows at the end.
  // While the card asks something (the fix, an overlap), it's answered there, so the row steps back.
  return (
    <>
      {card}
      {dialogs}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        {inline ? <Faint>{panel?.kind === 'fix' ? 'Write the fix above. Esc cancels.' : 'Choose above to carry on.'}</Faint> : buttons}
        <div className="ml-auto flex items-center gap-2">{nav}</div>
      </div>
    </>
  );
}

