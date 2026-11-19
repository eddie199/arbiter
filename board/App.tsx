import { useCallback, useEffect, useRef, useState } from 'react';
import { areasOf, overviewCards, PLANS } from './bits';
import { clock, dayWords, fullDate } from '@/components/When';
import { Lockup } from '@/components/ui/mark';
import { buttonClass } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ThemeToggle } from '@/components/ThemeToggle';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import type { LocalBoard, ReviewState } from './types';
import { getBoard, getStamp, getState, sayBye } from './api';
import { href, useRoute, type Route } from './route';
import { Overview } from './Overview';
import { Change } from './Change';
import { Rules } from './Rules';
import { Preferences } from './Preferences';
import { ReviewPage, type Results } from './Review';
import { AreasNav, folderIn, layoutOf } from './Areas';

/**
 * The local board: the team board's shell (TopNav, Sidebar, SectionBar in components/) around its
 * pages, drawn from this project's files, with the review queue as pages of its own beside them.
 * The review pages come last in the rail, under Design rules: the board first, then what's waiting for you.
 * Preferences sit at the very bottom, on their own: it's visited rarely, and only on the live board.
 *
 * It's meant to stay open beside the work, so it keeps itself current: what the agent records shows
 * up within seconds, and there's nothing to finish. Close the tab when you're done with it.
 */
export function App({ initial }: { initial: LocalBoard }) {
  const route = useRoute();
  const [data, setData] = useState(initial);
  const [state, setState] = useState<ReviewState | null>(null);
  // What was judged in this sitting stays on the page, collapsed, until the next visit.
  const [results, setResults] = useState<Results>({});
  const [stopped, setStopped] = useState(false);
  const [updated, setUpdated] = useState<Date | null>(null);
  const live = initial.live;

  // A judged decision joins the board, so both are read again after every answer.
  const refresh = useCallback(async () => {
    if (!live) return;
    const [b, s] = await Promise.all([getBoard(), getState()]);
    setData(b);
    setState(s);
    setUpdated(new Date());
  }, [live]);
  useEffect(() => { void refresh(); }, [refresh]);

  // Every few seconds while the tab is in view, and as soon as you come back to it: has anything the
  // board is drawn from changed? Redraw only when it has. A server that stops answering has stopped.
  useEffect(() => {
    if (!live) return;
    let last: string | null = null;
    let misses = 0;
    const check = async () => {
      if (document.hidden) return;
      const stamp = await getStamp();
      if (stamp === null) {
        if (++misses >= 2) setStopped(true);
        return;
      }
      misses = 0;
      setStopped(false);
      if (last !== null && stamp !== last) void refresh();
      last = stamp;
    };
    const now = () => void check();
    now();
    const timer = setInterval(now, 3000);
    document.addEventListener('visibilitychange', now);
    window.addEventListener('focus', now);
    // Back from the browser's cache after a goodbye: checking says it's here again.
    window.addEventListener('pageshow', now);
    window.addEventListener('pagehide', sayBye);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', now);
      window.removeEventListener('focus', now);
      window.removeEventListener('pageshow', now);
      window.removeEventListener('pagehide', sayBye);
    };
  }, [live, refresh]);

  const cands = data.board.candidates;
  const areaOf = areasOf(data);
  const names = [...new Set(cands.map(areaOf))];
  // Counted as the Overview shows them: a set of options is one.
  const shown = overviewCards(cands, areaOf);
  const sections = names.length === 1 ? [] : names.map((n) => ({ name: n, count: shown.filter((c) => areaOf(c) === n).length }));
  const rules = data.board.rules?.length ?? 0;
  const at = route.query.get('at');
  // A folder of areas you made in the side nav, when the Overview is showing one.
  const folder = folderIn(data, names, route.page === 'overview' ? route.query.get('folder') : null);
  // What's waiting for you: an old one-off fix left in a queue from before isn't asked about.
  const waiting = state ? state.pending.filter((d) => d.level !== 'polish').length : data.pending;

  // The tab carries the inbox's count, so what arrives shows in the tab strip while you work elsewhere.
  // A stopped board can't count, so its tab drops it.
  useEffect(() => {
    const count = live && waiting && !stopped ? `(${waiting}) ` : '';
    document.title = `${count}${folder?.name ?? titleOf(route, data)} · ${data.board.project}`;
  }, [route, data, live, waiting, stopped, folder?.name]);

  let page: React.ReactNode;
  if (route.page === 'review') {
    const areaOfCard = (id: string) => { const c = cands.find((x) => x.id === id); return c ? areaOf(c) : null; };
    page = !live ? <NotHere /> : state ? <ReviewPage state={state} at={at} area={route.query.getAll('area')} areaOfCard={areaOfCard} results={results} onJudged={(r) => setResults((x) => ({ ...x, ...r }))} onUndone={(id) => setResults(({ [id]: _, ...x }) => x)} refresh={refresh} /> : <Loading />;
  } else if (route.page === 'change') {
    const c = cands.find((x) => x.id === route.id);
    page = c ? <Change key={c.id} data={data} c={c} at={at} kinds={[...route.query.getAll('type'), ...route.query.getAll('kind')]} refresh={refresh} /> : <NotHere />;
  } else if (route.page === 'rules') page = <Rules data={data} at={at} cap={state?.cap} refresh={refresh} query={route.query} />;
  else if (route.page === 'preferences') page = live && data.settings ? <Preferences data={data} refresh={refresh} /> : <NotHere />;
  else page = <Overview data={data} query={route.query} folder={folder} />;

  const nav = { route, data, sections, rules, waiting, refresh };
  return (
    <>
      <TopBar data={data} waiting={waiting} page={route.page} areas={sections.length > 0} updated={updated} stopped={stopped} onRefresh={async () => {
        try { await refresh(); setStopped(false); } catch { setStopped(true); }
      }} />
      <div className="mx-auto grid max-w-6xl grid-cols-1 gap-10 px-5 pb-24 pt-8 md:grid-cols-[13rem_minmax(0,1fr)]">
        <Rail {...nav} />
        <div className="min-w-0">
          <Chips {...nav} />
          {stopped ? (
            <div className="mb-5 rounded-lg border border-border bg-surface px-4 py-3 text-[13px]">
              <span className="font-semibold tracking-tight">This board has stopped.</span>{' '}
              <span className="text-muted">What’s on it may be out of date. Run <code className="font-mono text-[12px]">npx arbiter review</code> to start it again, and this page picks up by itself.</span>
            </div>
          ) : null}
          {page}
          {/* Under the two pages that show the whole board, not under every change or the inbox. */}
          {route.page === 'overview' || route.page === 'rules' ? <footer className="mt-20 text-[12px] text-faint">{live
            ? 'Only you see this board. It runs on your computer, from this project’s files. Made with Arbiter.'
            : `A read-only copy of this project’s design decisions${data.board.exported ? `, as of ${fullDate(data.board.exported)}` : ''}. Feedback goes to whoever sent it. Made with Arbiter.`}</footer> : null}
        </div>
      </div>
    </>
  );
}

function titleOf(route: Route, data: LocalBoard): string {
  if (route.page === 'review') return 'Review inbox';
  if (route.page === 'rules') return 'Design rules';
  if (route.page === 'preferences') return 'Preferences';
  if (route.page === 'change') return data.board.candidates.find((c) => c.id === route.id)?.name ?? 'Not here';
  const s = route.query.getAll('section');
  return s.length === 1 ? s[0] : 'Overview';
}

function Loading() {
  return <main className="py-16 text-center text-[13px] text-muted">Loading…</main>;
}

function NotHere() {
  return (
    <main className="px-6 py-16 text-center">
      <p className="font-semibold tracking-tight">That isn’t here</p>
      <p className="mt-1 text-[13px] text-muted">It may have been renamed or removed. <a href={href('overview')} className="underline hover:text-fg">Back to the overview</a></p>
    </main>
  );
}

const OUT = <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 17 17 7" /><path d="M7 7h10v10" /></svg>;

/**
 * The team board's top bar: the lockup and the project, tagged Local, since the two boards look alike
 * on purpose and only one of them is shared; on the right a short guide to the board, the theme and
 * the team board.
 * On a phone, where the links to the pages scroll away with the page, it also keeps the Review inbox
 * and its count in view. A live board says when it last read the files, beside a button to read them now.
 */
function TopBar({ data, waiting, page, areas, updated, stopped, onRefresh }: { data: LocalBoard; waiting: number; page: Route['page']; areas: boolean; updated: Date | null; stopped: boolean; onRefresh: () => Promise<void> }) {
  return (
    <div className="sticky top-0 z-30 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto flex h-12 max-w-6xl items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <a href={href('overview')} className="flex items-center"><Lockup size={18} /></a>
          <span className="hidden text-faint sm:inline">/</span>
          <a href={href('overview')} className="hidden text-muted hover:text-fg sm:inline">{data.board.project}</a>
          {data.live
            ? <Tooltip label="Only you see this board. It runs on your computer, from this project’s files."><Badge className="cursor-default">Local</Badge></Tooltip>
            : <Tooltip label={`A copy of this project’s design decisions${data.board.exported ? `, as of ${fullDate(data.board.exported)}` : ''}. It doesn’t update, and feedback goes to whoever sent it.`}><Badge className="cursor-default">Read-only Copy</Badge></Tooltip>}
        </div>
        {/* Relative, so the popovers in it hang from the bar's right end, not from their buttons. */}
        <nav className="relative flex items-center gap-1 text-[13px]">
          {data.live ? <Updated at={updated} stopped={stopped} onRefresh={onRefresh} /> : null}
          {data.live && waiting ? (
            <Tooltip label="Review inbox"><a href={href('review')} aria-label={`Review inbox: ${waiting} waiting`} aria-current={page === 'review' ? 'page' : undefined} className={`flex h-7 items-center gap-1.5 rounded-ui px-2 tabular-nums md:hidden ${page === 'review' ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg'}`}>
              {ReviewIcon}{waiting}
            </a></Tooltip>
          ) : null}
          <BoardHelp data={data} page={page} areas={areas} />
          <ThemeToggle />
          {/* An exported copy is someone else's to read: no team board to share from it. */}
          {/* On a phone the bar also carries Local and the inbox count, so the share button is shorter there. */}
          {data.live ? <>
            {/* Centred by eye: the icon button before it has 8px of space inside around its icon, the button after has none. */}
            <span className="mr-2 h-4 w-px bg-border" />
            {data.hosted
              ? <a href={data.hosted} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}><span className="hidden sm:inline">Open team board</span><span className="sm:hidden">Team board</span> {OUT}</a>
              : <ShareBoard />}
          </> : null}
        </nav>
      </div>
    </div>
  );
}

const RefreshIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" /><path d="M21 3v5h-5" /></svg>;

/** A time of day, with the day as well when it isn't today. */
function timeOf(d: Date): string {
  return d.toDateString() === new Date().toDateString() ? clock(d) : `${dayWords(d.toISOString())}, ${clock(d)}`;
}

/**
 * When the board last read the files, and a button to read them now. It reads them by itself when
 * they change, so the time is when something last changed, or when you last refreshed. The button
 * turns for a moment, so a refresh that found nothing new still shows it ran. At phone width the
 * bar leaves both out: the board updates by itself, and the bar needs the room for the guide.
 */
function Updated({ at, stopped, onRefresh }: { at: Date | null; stopped: boolean; onRefresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const click = async () => {
    setBusy(true);
    await Promise.all([onRefresh(), new Promise((r) => setTimeout(r, 500))]);
    setBusy(false);
  };
  return (
    <div className="hidden items-center sm:flex">
      {at || stopped ? (
        <Tooltip label="The board checks for changes every few seconds and redraws when something changes."><span className="whitespace-nowrap pl-1 text-[12px] tabular-nums text-muted">
          {stopped ? 'Stopped' : `Updated ${timeOf(at!)}`}
        </span></Tooltip>
      ) : null}
      <TooltipProvider>
        <Tooltip label="Refresh">
          <button type="button" onClick={click} disabled={busy} aria-label="Refresh" className="flex h-7 w-7 items-center justify-center rounded-ui text-muted hover:bg-surface-2 hover:text-fg">
            <span className={`flex ${busy ? 'animate-spin motion-reduce:animate-none' : ''}`}>{RefreshIcon}</span>
          </button>
        </Tooltip>
      </TooltipProvider>
    </div>
  );
}

/** Open or closed, for a popover drawn inside `box`: a click outside it, or Escape, closes it. */
function usePop() {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  return { open, setOpen, box };
}

/** The top bar's popovers hang from the right end of the bar, so on a phone they stay on screen. */
const POP = 'absolute right-0 top-[calc(100%+8px)] z-40 w-[340px] max-w-[calc(100vw-2.5rem)] rounded-lg border border-border bg-bg p-3 text-[13px] text-muted shadow-lg';

/** A question mark in a circle, drawn like the refresh and theme icons: 12px of ink on a 16px icon. */
const HelpIcon = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M9.4 9.3a2.7 2.7 0 0 1 5.25.9c0 1.8-2.7 2.7-2.7 2.7" /><path d="M12 16.5h.01" /></svg>;

/**
 * What each part of the board is for, one line each, behind the ? in the top bar. Each part goes to
 * its page, and the one you're on is tinted, as in the rail. A read-only copy has no Review inbox, and
 * its rules aren't the reader's own, so it says less.
 */
function BoardHelp({ data, page, areas }: { data: LocalBoard; page: Route['page']; areas: boolean }) {
  const { open, setOpen, box } = usePop();
  const live = data.live;
  const parts = [
    { href: href('overview'), icon: OverviewIcon, name: 'Overview', on: page === 'overview', says: `Every change, with its picture. Open one for the decisions behind it and what was turned down.${areas ? ' Areas group them by part of the product.' : ''}` },
    ...(live || data.board.rules?.length ? [{ href: href('rules'), icon: RulesIcon, name: 'Design rules', on: page === 'rules', says: live ? 'The rules you’ve saved in DECISIONS.md. Everything new follows them.' : 'The rules this project’s designs follow.' }] : []),
    ...(live ? [{ href: href('review'), icon: ReviewIcon, name: 'Review inbox', on: page === 'review', says: 'What the agent decided that you haven’t judged yet. Confirm it, make it a rule, or fix it.' }] : []),
    ...(live ? [{ href: href('preferences'), icon: PreferencesIcon, name: 'Preferences', on: page === 'preferences', says: 'When the agent checks in, what it records, and pictures. Saved in arbiter.json.' }] : []),
  ];
  return (
    <div ref={box}>
      <TooltipProvider>
        <Tooltip label="How this board works">
          <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-label="How this board works" className={`flex h-7 w-7 items-center justify-center rounded-ui hover:bg-surface-2 hover:text-fg ${open ? 'bg-surface-2 text-fg' : 'text-muted'}`}>
            {HelpIcon}
          </button>
        </Tooltip>
      </TooltipProvider>
      {open ? (
        <div className={POP}>
          <p className="font-semibold tracking-tight text-fg">How this board works</p>
          <p className="mt-1">{live
            ? 'Your agent records design decisions as it builds. They show up here within seconds.'
            : 'A read-only copy of this project’s design decisions. It doesn’t update.'}</p>
          <ul className="-mx-1.5 mt-2 space-y-0.5">
            {parts.map((p) => (
              <li key={p.name}>
                <a href={p.href} onClick={() => setOpen(false)} aria-current={p.on ? 'page' : undefined} className={`flex gap-2.5 rounded-ui px-1.5 py-1.5 hover:bg-surface-2 ${p.on ? 'bg-surface-2' : ''}`}>
                  <span className="mt-[3px] text-muted">{p.icon}</span>
                  <span className="min-w-0">
                    <span className="block text-fg">{p.name}</span>
                    <span className="block">{p.says}</span>
                  </span>
                </a>
              </li>
            ))}
          </ul>
          {live ? <p className="mt-2 border-t border-border pt-2.5 text-[12px] text-faint">You can also review in chat with <code className="font-mono">/arbiter</code>.</p> : null}
        </div>
      ) : null}
    </div>
  );
}


/**
 * No team board yet: the ways to share this one, in the order the Plans page puts them. First a
 * read-only copy, a folder from `arbiter export`, which works for everyone and sends nothing to
 * Arbiter. Then Arbiter Team, in early access by invitation, linking to the Plans page. The page
 * shares nothing by itself. Someone invited gets their publish line, with their code, from whoever
 * invited them, so it isn't here.
 */
function ShareBoard() {
  const { open, setOpen, box } = usePop();
  return (
    <div ref={box}>
      <button type="button" onClick={() => setOpen((v) => !v)} className={buttonClass('secondary', 'sm')} aria-expanded={open} aria-label="Share board"><span className="hidden sm:inline">Share board</span><span className="sm:hidden">Share</span></button>
      {open ? (
        <div className={POP}>
          <p className="font-semibold tracking-tight text-fg">Share read-only board</p>
          <p className="mt-1">A folder anyone can open, or your own GitHub Pages site. Nothing goes to Arbiter.</p>
          <Command text="npx arbiter export" className="mt-2.5" />
          <div className="-mx-3 my-3 border-t border-border" />
          <p className="font-semibold tracking-tight text-fg">Arbiter Team<span className="font-normal text-faint"> · Early access</span></p>
          <p className="mt-1">A private board where your team comments and requests changes. By invitation.</p>
          <div className="mt-2.5">
            <a href={PLANS} target="_blank" rel="noreferrer" className={buttonClass('secondary', 'sm')}>Request early access {OUT}</a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** A command to run, with Copy. Selected either way, so a blocked clipboard still leaves it one keypress from copied. */
function Command({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState('Copy');
  const code = useRef<HTMLElement>(null);
  const copy = async () => {
    const el = code.current;
    if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s?.removeAllRanges(); s?.addRange(r); }
    try { await navigator.clipboard.writeText(text); setCopied('Copied'); } catch { setCopied(document.execCommand('copy') ? 'Copied' : 'Selected'); }
  };
  return (
    <div className={`flex items-center gap-2 ${className ?? ''}`}>
      <code ref={code} className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap rounded-ui bg-surface-2 px-2 py-1 font-mono text-[12px] text-fg">{text}</code>
      <button type="button" onClick={copy} className={buttonClass('ghost', 'sm')}>{copied}</button>
    </div>
  );
}

const KEY = 'arbiter-rail';
const OverviewIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true" className="shrink-0"><rect x="1" y="1" width="5" height="7" rx="1" /><rect x="8" y="1" width="5" height="4" rx="1" /><rect x="8" y="7" width="5" height="6" rx="1" /><rect x="1" y="10" width="5" height="3" rx="1" /></svg>;
const RulesIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" className="shrink-0"><path d="M4.5 3.5h7.5M4.5 7h7.5M4.5 10.5h7.5" /><circle cx="2" cy="3.5" r=".6" fill="currentColor" /><circle cx="2" cy="7" r=".6" fill="currentColor" /><circle cx="2" cy="10.5" r=".6" fill="currentColor" /></svg>;
/** What's waiting for you: a tray. */
/** Preferences: two sliders. */
const PreferencesIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" className="shrink-0"><path d="M1.5 4h3M8 4h4.5M1.5 10h6.5M11.5 10h1" /><circle cx="6.25" cy="4" r="1.75" /><circle cx="9.75" cy="10" r="1.75" /></svg>;
const ReviewIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M1.5 8.5 3 2.5h8l1.5 6v3h-11z" /><path d="M1.5 8.5h3.25l.75 1.5h3l.75-1.5h3.25" /></svg>;

interface Item { href: string; label: string; hint?: string; icon?: React.ReactNode; on: boolean }
interface Nav { route: Route; data: LocalBoard; sections: { name: string; count: number }[]; rules: number; waiting: number; refresh: () => Promise<void> }

/** components/Sidebar.tsx, reading the hash instead of the router, with the review pages after Design rules. */
function Rail({ route, data, sections, rules, waiting, refresh }: Nav) {
  const picked = route.query.getAll('section');
  const section = picked.length === 1 ? picked[0] : '';
  const view = route.query.get('view') === 'list' ? 'list' : undefined;
  const onOverview = route.page === 'overview';
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setClosed(JSON.parse(localStorage.getItem(KEY) ?? '{}')); } catch {} }, []);
  const toggle = (k: string) => setClosed((c) => { const n = { ...c, [k]: !c[k] }; try { localStorage.setItem(KEY, JSON.stringify(n)); } catch {} return n; });

  const groups: { key: string; title?: string; items: Item[] }[] = [
    { key: 'all', items: [{ href: href('overview', { view }), label: 'Overview', hint: String(overviewCards(data.board.candidates, areasOf(data)).length), icon: OverviewIcon, on: onOverview && !section && !route.query.get('folder') }] },
    { key: 'sections', title: 'Areas', items: sections.map((s) => ({ href: href('overview', { section: s.name, view }), label: s.name, hint: String(s.count), on: onOverview && section === s.name })) },
    { key: 'rules', items: rules ? [{ href: href('rules'), label: 'Design rules', hint: String(rules), icon: RulesIcon, on: route.page === 'rules' }] : [] },
    {
      key: 'review',
      items: data.live ? [{ href: href('review'), label: 'Review inbox', hint: waiting ? String(waiting) : undefined, icon: ReviewIcon, on: route.page === 'review' }] : [],
    },
    { key: 'preferences', items: data.live && data.settings ? [{ href: href('preferences'), label: 'Preferences', icon: PreferencesIcon, on: route.page === 'preferences' }] : [] },
  ].filter((g) => g.items.length);

  return (
    <aside className="sticky top-16 hidden self-start md:block">
      {/* 10px wider, to the left: the icons and chevrons start where the logo does, and a row's tint reaches past it. */}
      <nav className="-ml-2.5 w-[calc(13rem+0.625rem)] text-[14px]">
        {groups.map((g, i) => {
          if (g.key === 'sections') return <AreasNav key="sections" data={data} names={sections.map((s) => s.name)} counts={new Map(sections.map((s) => [s.name, s.count]))} route={route} view={view} folded={!!closed.sections} onFold={() => toggle('sections')} refresh={refresh} />;
          const folded = !!g.title && !!closed[g.key];
          const activeInside = g.items.some((it) => it.on);
          return (
            <div key={g.key} className={!i ? '' : g.key === 'sections' ? 'mt-2' /* Areas belongs under Overview */ : 'mt-4'}>
              {g.title ? (
                <button type="button" onClick={() => toggle(g.key)} aria-expanded={!folded} className="group mb-1 flex h-7 w-full items-center gap-1 rounded-ui px-2.5 text-[12px] text-faint hover:bg-surface-2 hover:text-muted">
                  <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform ${folded ? '' : 'rotate-90'}`}><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  <span>{g.title}</span>
                  {folded && activeInside ? <Tooltip label="Current page is in here"><span className="ml-auto h-1.5 w-1.5 rounded-full bg-fg" /></Tooltip> : null}
                </button>
              ) : null}
              {folded ? null : (
                <ul className={g.title ? 'ml-3 space-y-0.5 border-l border-border' : 'space-y-0.5'}>
                  {g.items.map((it) => (
                    <li key={it.href}>
                      <a href={it.href} aria-current={it.on ? 'page' : undefined} className={`flex h-8 items-center justify-between px-2.5 transition-colors ${g.title ? '-ml-px rounded-r-ui border-l' : 'rounded-ui'} ${it.on ? 'border-fg bg-surface-2 text-fg' : 'border-transparent text-muted hover:bg-surface-2 hover:text-fg'}`}>
                        <span className="flex min-w-0 items-center gap-2">{it.icon}<span className="truncate">{it.label}</span></span>
                        {it.hint ? <span className={`text-[12px] tabular-nums ${it.on ? 'text-muted' : 'text-faint'}`}>{it.hint}</span> : null}
                      </a>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

/** components/SectionBar.tsx: below md the rail is hidden, and this row of chips stands in for it. */
function Chips({ route, data, sections, rules, waiting }: Nav) {
  const picked = route.query.getAll('section');
  const section = picked.length === 1 ? picked[0] : '';
  const onBoard = route.page === 'overview';
  const chip = (on: boolean) => `shrink-0 rounded-full border px-3 py-1 text-[13px] ${on ? 'border-fg bg-fg text-bg' : 'border-border text-muted hover:border-border-strong hover:text-fg'}`;
  return (
    <div className="-mx-5 mb-5 flex gap-2 overflow-x-auto px-5 pb-1 md:hidden [scrollbar-width:none]">
      <a href={href('overview')} className={chip(onBoard && !section && !route.query.get('folder'))}>Overview</a>
      {layoutOf(sections.map((s) => s.name), data.arrangement).filter((e) => data.live || e.kind !== 'folder' || e.areas.some((a) => sections.some((s) => s.name === a))).map((e) => e.kind === 'folder'
        ? <a key={`f-${e.id}`} href={href('overview', { folder: e.id })} className={chip(onBoard && route.query.get('folder') === e.id)}>{e.name} <span className="opacity-60">{e.areas.reduce((n, a) => n + (sections.find((s) => s.name === a)?.count ?? 0), 0)}</span></a>
        : <a key={e.name} href={href('overview', { section: e.name })} className={chip(onBoard && section === e.name)}>{e.name} <span className="opacity-60">{sections.find((s) => s.name === e.name)?.count}</span></a>)}
      {rules ? <a href={href('rules')} className={chip(route.page === 'rules')}>Design rules</a> : null}
      {data.live ? <a href={href('review')} className={chip(route.page === 'review')}>Review inbox{waiting ? <span className="opacity-60"> {waiting}</span> : null}</a> : null}
      {data.live && data.settings ? <a href={href('preferences')} className={chip(route.page === 'preferences')}>Preferences</a> : null}
    </div>
  );
}
