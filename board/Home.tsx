import { useEffect, useRef, useState } from 'react';
import { DIMENSION_LABEL, nameIn, sentence, type BoardCandidate, type BoardDecision } from '@/lib/board';
import { clock, dayWords } from '@/components/When';
import { BigNumber, Lede, PageTitle, Unit } from '@/components/ui/type';
import { Tile, TileGrid, TileHead, TileText, TileTitle } from '@/components/ui/tile';
import { ListRow } from '@/components/ui/list-row';
import { ExpanderButton, ExpanderPanel, usePanelId } from '@/components/ui/expander';
import { Icon, Kind, Small } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/tooltip';
import { Menu } from '@base-ui-components/react/menu';
import { ITEM, POPUP } from '@/components/ui/menu';
import { cn } from '@/components/ui/cn';
import type { GitEdits, LocalBoard } from './types';
import { getGit } from './api';
import { href } from './route';
import { areasOf } from './bits';

/**
 * Home: the board's first page, on the live board only (DESIGN.md, "Home"). A build summary in tiles,
 * then Latest updates, all from the project's own files: the record, the review queue, DECISIONS.md,
 * and git for Not committed. What the board can't see, it says so rather than showing example numbers:
 * fixes aren't recorded yet, and how long you've been on something needs the agent's chat files.
 */
export function Home({ data, waiting }: { data: LocalBoard; waiting: number }) {
  const cands = data.board.candidates;
  const areaOf = areasOf(data);
  const events = eventsOf(data);
  const latest = events[0];
  // The name the record has for you, from its latest change: "eddie" reads "Eddie".
  const who = latest?.card.author?.split(/[\s@.]/)[0];
  const name = who ? who.charAt(0).toUpperCase() + who.slice(1) : null;

  return (
    <main>
      <PageTitle className="home-rise">Let’s get building{name ? `, ${name}` : ''}</PageTitle>
      <Lede className="home-rise [--delay:40ms]">Your build summary and the latest updates in this project.</Lede>
      {/* On first load, with nothing recorded yet, every tile shows its own empty state and Get started
          stands where Latest updates will be: the page keeps its shape, so nothing jumps when the first
          decision lands. */}
      <TileGrid className="mt-6">
          <WaitingTile n={waiting} first={!events.length} />
          <RecentTile cands={cands} areaOf={areaOf} />
          <WorkingTile latest={latest} events={events} areaOf={areaOf} />
          <TypeTile data={data} />
          <WeekTile events={events} areaOf={areaOf} />
          <NotCommittedTile />
          <RulesTile />
      </TileGrid>
      {events.length ? <Updates events={events} areaOf={areaOf} /> : <GetStarted />}
    </main>
  );
}

/* ——— What happened, from the record ——— */

type EvKind = 'decided' | 'rule' | 'oneOff' | 'waiting';
interface Ev { card: BoardCandidate; at: Date; kind: EvKind; id: string; text: string; against?: string }

/** Everything dated in the record and the queue, newest first: each judged decision, and each one waiting. */
function eventsOf(data: LocalBoard): Ev[] {
  const out: Ev[] = [];
  for (const c of data.board.candidates) {
    for (const d of c.decisions) {
      const at = d.date ? new Date(d.date) : null;
      if (!at || Number.isNaN(at.getTime())) continue;
      out.push({ card: c, at, kind: kindOf(d), id: d.id, text: d.change ?? d.decision, against: d.against });
    }
    for (const q of data.queued?.[c.id] ?? []) {
      const at = new Date(q.date);
      if (!Number.isNaN(at.getTime())) out.push({ card: c, at, kind: 'waiting', id: q.id, text: q.change ?? q.decision });
    }
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime());
}
const kindOf = (d: BoardDecision): EvKind => (d.verdict === 'rule' ? 'rule' : d.against ? 'oneOff' : 'decided');

const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const weekStart = (d: Date) => { const x = startOfDay(d); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** "Card status · Overview page": the change without its area, then the area; just the area when they're the same. */
const whereOf = (c: BoardCandidate, area: string) => { const n = nameIn(area, c.name); return n.toLowerCase() === area.toLowerCase() ? area : `${n} · ${area}`; };

/* ——— Motion helpers: Home only, nothing moves with reduced motion ——— */

const useReducedMotion = () => useState(() => typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches)[0];
/** When a tile has settled in (its place in reading order, 45ms apart), for a chart to start drawing. */
const landed = (i: number) => 80 + i * 45 + 380;

/** True once the tile has landed: a chart draws then. At once with reduced motion. */
function useLanded(i: number): boolean {
  const reduced = useReducedMotion();
  const [on, setOn] = useState(reduced);
  useEffect(() => { if (reduced) return; const t = setTimeout(() => setOn(true), landed(i)); return () => clearTimeout(t); }, [i, reduced]);
  return on;
}

/** A number counting up to `to` once, after its tile lands; later changes show at once. */
function useCountUp(to: number, i: number): number {
  const reduced = useReducedMotion();
  const [n, setN] = useState(reduced ? to : 0);
  const first = useRef(!reduced);
  useEffect(() => {
    if (!first.current) { setN(to); return; }
    first.current = false;
    let raf = 0;
    const t0 = performance.now() + landed(i) - 200;
    const step = (t: number) => {
      const p = Math.min(1, Math.max(0, (t - t0) / 700));
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => { cancelAnimationFrame(raf); setN(to); };
  }, [to, i]);
  return n;
}

/* ——— The tiles ——— */

/** Waiting for you: red while anything waits, the board's one red fill; grey and "All caught up" when nothing does. */
function WaitingTile({ n, first }: { n: number; first: boolean }) {
  return (
    <Tile tone={n ? 'red' : 'grey'} i={0} className="group cursor-pointer transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100">
      <TileHead className="relative z-10">
        <TileTitle tip="Changes waiting for your review. Confirm each one, or make it a design rule.">Waiting for you</TileTitle>
        {Kind.waiting()}
      </TileHead>
      <div>
        <BigNumber>{n}</BigNumber>
        {/* The whole tile is the link: this line is what it says. */}
        <a href={href('review')} className="mt-2 inline-flex items-center gap-1 text-[12px] leading-[1.35] after:absolute after:inset-0 after:rounded-[22px] focus-visible:outline-none">
          {n ? 'Review now' : first ? 'Nothing yet' : 'All caught up'}
          {n ? <span className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none">{Small.arrow}</span> : null}
        </a>
      </div>
    </Tile>
  );
}

/** Recently decided: the latest eight changes by their latest judged decision, three in view, a row at a time. */
function RecentTile({ cands, areaOf }: { cands: BoardCandidate[]; areaOf: (c: BoardCandidate) => string }) {
  const last = (c: BoardCandidate) => c.decisions.map((d) => d.date ?? '').filter(Boolean).sort().pop() || c.date;
  const rows = cands.filter((c) => c.decisions.length).map((c) => ({ c, last: last(c) })).sort((a, b) => b.last.localeCompare(a.last)).slice(0, 8);
  const box = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ first: 0, top: false, more: rows.length > 3 });
  const read = () => {
    const el = box.current;
    if (!el) return;
    setView({ first: Math.round(el.scrollTop / ROW), top: el.scrollTop > 1, more: el.scrollHeight - el.clientHeight - el.scrollTop > 1 });
  };
  useEffect(read, [rows.length]);
  const fade = `linear-gradient(to bottom, transparent 0, #000 ${view.top ? 14 : 0}px, #000 calc(100% - ${view.more ? 14 : 0}px), transparent 100%)`;
  return (
    <Tile tone="black" cols={2} i={1}>
      <TileHead>
        <TileTitle tip="Your latest decisions, newest first. Click one to open its change.">Recently decided</TileTitle>
        {rows.length > 3 ? <span className="flex gap-[3px]" aria-hidden="true">{rows.map((r, k) => <i key={r.c.id} className={cn('h-1 w-1 rounded-full transition-colors duration-200 motion-reduce:transition-none', k >= view.first && k < view.first + 3 ? 'bg-current' : 'bg-[color-mix(in_srgb,currentColor_25%,transparent)]')} />)}</span> : null}
      </TileHead>
      {rows.length ? (
        <div ref={box} onScroll={read} tabIndex={0} role="list" aria-label={`Recently decided, latest ${rows.length}`} style={{ maskImage: fade, WebkitMaskImage: fade }}
          className="h-[87px] snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-[4px] [scrollbar-width:none] focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-[var(--faint)] [&::-webkit-scrollbar]:hidden">
          {rows.map(({ c, last }) => {
            const area = areaOf(c);
            const n = nameIn(area, c.name);
            return (
              <div key={c.id} role="listitem">
                <a href={href(c.id)} className="group flex h-[29px] snap-start items-center justify-between gap-3 border-t border-[color-mix(in_srgb,currentColor_22%,transparent)] text-[13px]">
                  <span className="min-w-0 truncate"><span className="underline-offset-2 group-hover:underline">{n}</span>{n.toLowerCase() === area.toLowerCase() ? null : <span className="text-[12px] text-[var(--tile-quiet)]"> {area}</span>}</span>
                  <span className="shrink-0 text-[12px] text-[var(--tile-quiet)]">{dayWords(last)}</span>
                </a>
              </div>
            );
          })}
        </div>
      ) : <TileText quiet>Nothing decided yet</TileText>}
    </Tile>
  );
}
const ROW = 29;

/**
 * Working on: the change the agent recorded most recently, and how many decisions it has. Not how long
 * you've been on it: that comes from the agent's chat files, which the board doesn't read. The dot
 * breathes while the latest record is within the last half hour.
 */
function WorkingTile({ latest, events, areaOf }: { latest?: Ev; events: Ev[]; areaOf: (c: BoardCandidate) => string }) {
  if (!latest) return (
    <Tile i={2}>
      <TileTitle tip="The change the agent recorded most recently, and how many decisions it has.">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-fg opacity-25" aria-hidden="true" />Working on
      </TileTitle>
      <div>
        <BigNumber className="text-[var(--tile-quiet)]">—</BigNumber>
        <TileText quiet className="mt-2">Nothing yet</TileText>
      </div>
    </Tile>
  );
  const c = latest.card;
  const area = areaOf(c);
  const n = events.filter((e) => e.card.id === c.id).length;
  const live = Date.now() - latest.at.getTime() < 30 * 60e3;
  const today = sameDay(latest.at, new Date());
  const label = nameIn(area, c.name);
  return (
    <Tile i={2} className="group transition-transform duration-150 active:scale-[0.98] motion-reduce:transition-none motion-reduce:active:scale-100">
      <TileTitle className="relative z-10" tip={`The change the agent recorded most recently, ${dayWords(latest.at.toISOString()).toLowerCase()} at ${clock(latest.at)}, and how many decisions it has.`}>
        <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full bg-fg', live ? 'home-breathe' : 'opacity-25')} aria-hidden="true" />
        {today ? 'Working on' : 'Last worked on'}
      </TileTitle>
      <div className="min-w-0">
        <BigNumber unit={n === 1 ? 'decision' : 'decisions'}>{n}</BigNumber>
        <a href={href(c.id)} className="mt-2 block truncate text-[12px] leading-[1.35] after:absolute after:inset-0 after:rounded-[22px]">
          <span className="underline-offset-2 group-hover:underline">{label}</span>{label.toLowerCase() === area.toLowerCase() ? null : <span className="text-[var(--tile-quiet)]"> {area}</span>}
        </a>
      </div>
    </Tile>
  );
}

/** Type: the design rules by type as a shape, one corner per type, the thinnest in red. Hover a corner to read it. */
function TypeTile({ data }: { data: LocalBoard }) {
  const rules = data.board.rules ?? [];
  const types = Object.keys(DIMENSION_LABEL);
  const counts = types.map((t) => rules.filter((r) => r.dimension === t).length);
  const sum = rules.length;
  const max = Math.max(1, ...counts);
  const low = Math.min(...counts);
  const on = useLanded(3);
  const [hot, setHot] = useState<number | null>(null);
  const R = 42;
  const pt = (i: number, r: number) => { const a = (-90 + (i * 360) / types.length) * (Math.PI / 180); return [50 + r * Math.cos(a), 50 + r * Math.sin(a)]; };
  const f = (p: number[]) => p.map((n) => n.toFixed(1)).join(',');
  const ring = (r: number) => types.map((_, i) => f(pt(i, r))).join(' ');
  const dots = counts.map((v, i) => pt(i, Math.max(5, (v / max) * R)));
  // Short words, so the line fits the tile: "access", not "accessibility". More than two say how many instead.
  const thin = types.map((t, i) => (counts[i] === low ? (t === 'access' ? 'access' : DIMENSION_LABEL[t].toLowerCase()) : null)).filter(Boolean) as string[];
  const named = thin.length > 2 ? `${thin.length} types` : thin.join(', ');
  const cap = hot !== null ? `${DIMENSION_LABEL[types[hot]]}: ${counts[hot]}` : low ? `Thin on ${named}` : thin.length > 2 ? `Gaps in ${named}` : `${thin.length > 1 ? 'Gaps' : 'Gap'}: ${named}`;
  const meta = hot !== null ? `${Math.round((counts[hot] / Math.max(1, sum)) * 100)}%` : plural(sum, 'design rule');
  return (
    <Tile tone="black" i={3}>
      <TileHead>
        <TileTitle tip="Your design rules by type, one corner each. Red marks the types with the fewest rules.">Type</TileTitle>
        <TileText quiet>{meta}</TileText>
      </TileHead>
      <>
        <svg viewBox="0 0 100 100" width="92" height="92" className="self-center overflow-visible" role="img" aria-label={types.map((t, i) => `${DIMENSION_LABEL[t]} ${counts[i]}`).join(', ')} onPointerLeave={() => setHot(null)}>
          <g fill="none" stroke="currentColor" strokeWidth=".8">
            {[R / 3, (2 * R) / 3, R].map((r) => <polygon key={r} points={ring(r)} strokeOpacity=".14" />)}
            {types.map((_, i) => <line key={i} x1="50" y1="50" x2={pt(i, R)[0].toFixed(1)} y2={pt(i, R)[1].toFixed(1)} strokeOpacity={hot === i ? '.5' : '.14'} />)}
          </g>
          {sum ? <>
          <polygon points={dots.map(f).join(' ')} fill="currentColor" fillOpacity={hot !== null ? '.1' : '.18'} stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round"
            style={{ transformOrigin: '50px 50px', transform: on ? 'scale(1)' : 'scale(0)' }} className="transition-transform duration-[400ms] ease-[var(--ease-out)] motion-reduce:transition-none" />
          {dots.map(([x, y], i) => (
            <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r={hot === i ? 4 : 2.7} fill={counts[i] === low ? 'var(--brand)' : 'currentColor'}
              style={{ opacity: on ? (hot !== null && hot !== i ? 0.45 : 1) : 0, transitionDelay: on && hot === null ? `${200 + i * 30}ms` : '0ms' }}
              className="transition-[opacity,r] duration-200 motion-reduce:transition-none" />
          ))}
          {dots.map(([x, y], i) => <circle key={`h${i}`} cx={x.toFixed(1)} cy={y.toFixed(1)} r="10" fill="transparent" onPointerEnter={() => setHot(i)} />)}
          </> : null}
        </svg>
        <TileText className={cn('truncate transition-colors duration-150', hot !== null ? 'text-current' : 'text-[var(--tile-quiet)]')}>{sum ? cap : 'No design rules yet'}</TileText>
      </>
    </Tile>
  );
}

interface DayCard { card: BoardCandidate; decided: number; rules: number; waiting: number }
interface Day { date: Date; cards: DayCard[]; future: boolean }

/** Every week from where the record starts to this one, each day's changes with how many decisions and rules. */
function weeksOf(events: Ev[]): { start: Date; days: Day[] }[] {
  const now = new Date();
  const first = events.length ? weekStart(events[events.length - 1].at) : weekStart(now);
  const byDay = new Map<string, Map<string, DayCard>>();
  for (const e of events) {
    const k = startOfDay(e.at).toDateString();
    const m = byDay.get(k) ?? new Map<string, DayCard>();
    byDay.set(k, m);
    const dc = m.get(e.card.id) ?? { card: e.card, decided: 0, rules: 0, waiting: 0 };
    m.set(e.card.id, dc);
    if (e.kind === 'waiting') dc.waiting++;
    else { dc.decided++; if (e.kind === 'rule') dc.rules++; }
  }
  const weeks: { start: Date; days: Day[] }[] = [];
  for (let s = new Date(first); s <= now; s = new Date(s.getFullYear(), s.getMonth(), s.getDate() + 7)) {
    weeks.push({
      start: s,
      days: Array.from({ length: 7 }, (_, i) => {
        const date = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
        return { date, future: date > now, cards: [...(byDay.get(date.toDateString())?.values() ?? [])] };
      }),
    });
  }
  return weeks;
}
const changesIn = (w: { days: Day[] }) => new Set(w.days.flatMap((d) => d.cards.map((c) => c.card.id))).size;
const monthDay = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
function rangeOf(start: Date): string {
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
  return start.getMonth() === end.getMonth() ? `${start.getDate()} – ${monthDay(end)}` : `${monthDay(start)} – ${monthDay(end)}`;
}

/**
 * This week: how many changes, and a column of dots for each day's changes, today in red. ‹ › step back
 * through weeks to where the record starts. The tile, or its "changes ⌄", opens a day's changes in a
 * panel that grows out from under it; a day opens its own.
 */
function WeekTile({ events, areaOf }: { events: Ev[]; areaOf: (c: BoardCandidate) => string }) {
  const weeks = weeksOf(events);
  const [w, setW] = useState(weeks.length - 1);
  const cur = Math.min(w, weeks.length - 1);
  const week = weeks[cur];
  const [open, setOpen] = useState(-1);
  const tile = useRef<HTMLDivElement>(null);
  const id = usePanelId();
  const n = changesIn(week);
  const big = useCountUp(n, 4);
  const today = new Date();
  const label = cur === weeks.length - 1 ? 'This week' : cur === weeks.length - 2 ? 'Last week' : rangeOf(week.start);
  const vs = !events.length ? '' : cur === 0 ? 'Where the record starts' : `${changesIn(weeks[cur - 1])} ${cur === weeks.length - 1 ? 'last week' : 'the week before'}`;
  const latestDay = week.days.reduce((a, d, i) => (d.cards.length ? i : a), -1);
  const toggle = () => setOpen((o) => (o >= 0 ? -1 : latestDay));
  const go = (to: number) => { setOpen(-1); setW(to); };
  useEffect(() => {
    if (open < 0) return;
    const away = (e: MouseEvent) => { if (!tile.current?.contains(e.target as Node)) setOpen(-1); };
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(-1); };
    document.addEventListener('click', away);
    document.addEventListener('keydown', esc);
    return () => { document.removeEventListener('click', away); document.removeEventListener('keydown', esc); };
  }, [open]);
  const day = open >= 0 ? week.days[open] : null;
  const step = 'flex h-5 w-5 items-center justify-center rounded-ui text-muted transition-colors hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)] hover:text-fg disabled:invisible';
  return (
    <Tile ref={tile} cols={2} i={4} spill onClick={(e) => { if (!(e.target as HTMLElement).closest('button,a') && latestDay >= 0) toggle(); }}
      className={cn('cursor-pointer', open >= 0 ? 'z-20' : 'z-[2]')}>
      <TileHead>
        <div className="-ml-1 flex items-center gap-0.5">
          <button type="button" className={step} aria-label="Previous week" disabled={cur === 0} onClick={() => go(cur - 1)}>{Small.left}</button>
          <TileTitle tip="Changes made each day. Use the arrows to see earlier weeks.">{label}</TileTitle>
          <button type="button" className={step} aria-label="Next week" disabled={cur === weeks.length - 1} onClick={() => go(cur + 1)}>{Small.right}</button>
        </div>
        <TileText quiet>{vs}</TileText>
      </TileHead>
      <div className="flex items-end justify-between">
        <div>
          <BigNumber>{n ? `+${big}` : '0'}</BigNumber>
          <TileText quiet className="mt-2">
            {latestDay >= 0
              ? <ExpanderButton open={open >= 0} onToggle={toggle} controls={id} className="text-[var(--tile-quiet)] hover:text-fg">{n === 1 ? 'change' : 'changes'}</ExpanderButton>
              : 'No changes'}
          </TileText>
        </div>
        <div className="flex h-[104px] items-end" role="group" aria-label={`${label}, each day`}>
          {week.days.map((d, i) => {
            const isToday = sameDay(d.date, today);
            const k = d.cards.length;
            const words = `${d.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}: ${plural(k, 'change')}`;
            return (
              <button key={i} type="button" disabled={!k} aria-label={words} aria-expanded={k ? open === i : undefined} aria-controls={k ? id : undefined}
                onClick={() => setOpen((o) => (o === i ? -1 : i))}
                className={cn('group/day flex h-[104px] w-[26px] flex-col items-center justify-end gap-1 rounded-ui focus-visible:outline-1 focus-visible:outline-brand', open === i ? 'text-brand' : 'text-fg enabled:hover:text-brand')}>
                {k ? <span className={cn('text-[11px] leading-[14px] transition-colors', open === i ? 'text-brand' : 'text-muted group-enabled/day:group-hover/day:text-brand')}>{k}</span> : null}
                <span className="flex flex-col-reverse items-center gap-[1.8px]">
                  {k ? Array.from({ length: Math.min(k, 14) }, (_, j) => (
                    <i key={j} style={{ transitionDelay: `${j * 18}ms` }} className={cn('h-[5px] w-[5px] rounded-full bg-current transition-transform duration-200 motion-reduce:transition-none group-enabled/day:group-hover/day:-translate-y-0.5', open === i && '-translate-y-0.5')} />
                  )) : <i className={cn('rounded-full bg-border-strong', d.future ? 'h-[3.2px] w-[3.2px]' : 'h-[4.6px] w-[4.6px]')} />}
                </span>
                <span className={cn('mt-0.5 text-[11px] leading-[14px]', isToday ? 'text-brand' : 'text-faint')}>{'MTWTFSS'[i]}</span>
              </button>
            );
          })}
        </div>
      </div>
      {/* Grows from under the tile, tucked 22px up behind it with the same curve, so the corners never open up. */}
      <div className={cn('absolute inset-x-0 top-[calc(100%-22px)] -z-10 rounded-b-[22px] bg-surface-2 pt-[22px] transition-shadow duration-[250ms]', day && 'shadow-[0_18px_28px_-14px_rgba(0,0,0,.22)]')} onClick={(e) => e.stopPropagation()}>
        <div className="tile-grain pointer-events-none absolute inset-x-0 bottom-0 top-[22px] rounded-b-[22px] [--grain:.55]" />
        <ExpanderPanel id={id} open={!!day} grow>
          {day ? (
            <div className="relative px-4 pb-3.5 pt-0.5">
              <div className="flex items-baseline justify-between border-t border-[color-mix(in_srgb,var(--fg)_8%,transparent)] pb-1.5 pt-2.5 text-[12px]">
                <span>{day.date.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}</span>
                <span className="text-muted">{plural(day.cards.length, 'change')}</span>
              </div>
              <div className="flex h-[18px] items-center text-[11px] text-faint"><span className="flex-1" /><span className="w-14 text-right">Decided</span><span className="w-14 text-right">Rules</span></div>
              {day.cards.map(({ card, decided, rules, waiting }) => {
                const area = areaOf(card);
                const nm = nameIn(area, card.name);
                return (
                  <a key={card.id} href={href(card.id)} className="group flex h-[26px] items-center border-t border-[color-mix(in_srgb,var(--fg)_6%,transparent)] text-[13px]">
                    <span className="min-w-0 flex-1 truncate"><span className="underline-offset-2 group-hover:underline">{nm}</span> <span className="text-[12px] text-faint">{nm.toLowerCase() === area.toLowerCase() ? '' : area}{waiting ? `${nm.toLowerCase() === area.toLowerCase() ? '' : ' · '}waiting` : ''}</span></span>
                    <span className="w-14 shrink-0 text-right text-[12px] tabular-nums text-muted">{decided}</span>
                    <span className={cn('w-14 shrink-0 text-right text-[12px] tabular-nums', rules ? 'text-fg' : 'text-muted')}>{rules}</span>
                  </a>
                );
              })}
            </div>
          ) : <div />}
        </ExpanderPanel>
      </div>
    </Tile>
  );
}

/**
 * Not committed: this branch's edits not yet committed, read from git every few seconds while the tab is
 * in view. The branch opens a menu of the repository's other worktrees. Not a git repository: no tile.
 */
function NotCommittedTile() {
  const [git, setGit] = useState<GitEdits | null | undefined>(undefined);
  const [pick, setPick] = useState(0);
  useEffect(() => {
    let stop = false;
    // The first read always happens, so the tile is there from the start; after that, only while the tab is in view.
    const read = async (first?: boolean) => { if (document.hidden && !first) return; const g = await getGit(); if (!stop) setGit(g); };
    void read(true);
    const t = setInterval(() => void read(), 10000);
    const back = () => void read();
    document.addEventListener('visibilitychange', back);
    return () => { stop = true; clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, []);
  if (!git?.worktrees.length) return null;
  return <NotCommittedBody git={git} pick={Math.min(pick, git.worktrees.length - 1)} onPick={setPick} />;
}

function NotCommittedBody({ git, pick, onPick }: { git: GitEdits; pick: number; onPick: (i: number) => void }) {
  const wt = git.worktrees[pick];
  const clean = !wt.files;
  const big = useCountUp(wt.added, 5);
  const branch = wt.branch ?? `${wt.name} (no branch)`;
  return (
    <Tile i={5}>
      <div className="min-w-0">
        <TileTitle tip="Edits on this branch not yet committed to git: lines added and removed, and files changed.">
          {clean ? null : <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden="true" />}
          {clean ? 'All committed' : 'Not committed'}
        </TileTitle>
        {git.worktrees.length > 1 ? (
          <Menu.Root>
            <Menu.Trigger aria-label={`Branch: ${branch}`} className="group/b mt-0.5 flex max-w-full items-center gap-0.5 rounded-[4px] text-[12px] leading-[1.35] text-muted hover:text-fg data-[popup-open]:text-fg">
              <span className="truncate">{branch}</span>
              <span className="transition-transform duration-[250ms] group-data-[popup-open]/b:rotate-180 motion-reduce:transition-none">{Small.chevron}</span>
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner sideOffset={6} align="start" className="z-50">
                <Menu.Popup className={cn(POPUP, 'min-w-60')}>
                  <Menu.RadioGroup value={String(pick)} onValueChange={(v) => onPick(Number(v))}>
                    {git.worktrees.map((w, i) => (
                      <Menu.RadioItem key={w.path} value={String(i)} className={cn(ITEM, 'h-auto min-h-10 py-1')}>
                        <span className="flex min-w-0 items-center gap-2">
                          <span className="flex w-3.5 shrink-0 justify-center text-muted group-data-[highlighted]:text-fg">{i === pick ? Icon.check : null}</span>
                          <span className="grid min-w-0 leading-4"><span className="truncate">{w.branch ?? 'No branch'}</span><span className="truncate text-[12px] text-faint">{w.name}</span></span>
                        </span>
                        <span className="text-[12px] tabular-nums text-faint">{w.files ? `+${w.added}` : '0'}</span>
                      </Menu.RadioItem>
                    ))}
                  </Menu.RadioGroup>
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        ) : <p className="mt-0.5 truncate text-[12px] leading-[1.35] text-muted">{branch}</p>}
      </div>
      <div>
        <BigNumber>{clean ? '0' : `+${big}`}</BigNumber>
        <TileText quiet className="mt-2">{clean ? 'Nothing to commit' : wt.removed ? `−${wt.removed} · ${plural(wt.files, 'file')}` : plural(wt.files, 'file')}</TileText>
      </div>
    </Tile>
  );
}

/**
 * Design rules: meant to show the weeks your rules did the work above a line, and the times the AI
 * missed one and you fixed it below it, in red. Fixes aren't recorded yet, so it says so instead of
 * showing example numbers.
 */
function RulesTile() {
  return (
    <Tile tone="black" cols={2} i={6}>
      <TileHead>
        <TileTitle tip="When your rules did the work, and when the AI missed one and you fixed it.">Design rules</TileTitle>
        <TileText quiet>This week</TileText>
      </TileHead>
      <div>
        <p className="text-[13px] font-semibold tracking-tight">Fixes aren’t recorded yet</p>
        <TileText quiet className="mt-1 max-w-[17rem]">When the AI misses one of your rules and you fix it, it’ll show here.</TileText>
      </div>
    </Tile>
  );
}

/* ——— Get started, on first load ——— */

const STEPS: [string, string][] = [
  ['Build something with your agent', 'Ask for a screen or a change. It records the design decisions it makes as it goes.'],
  ['Review them here', 'Each one waits in the Review inbox: confirm it, make it a rule, or fix it in your own words.'],
  ['Rules keep it consistent', 'They’re saved in DECISIONS.md, and everything new follows them.'],
];

/** Before anything is recorded: three steps where Latest updates will be, as list rows with a number for an icon. */
function GetStarted() {
  return (
    <section className="mt-[72px]" aria-labelledby="start-title">
      <h2 id="start-title" className="home-row mb-1 text-[15px] font-semibold tracking-tight">Get started</h2>
      <ol className="flex flex-col">
        {STEPS.map(([what, where], k) => (
          <li key={what} className="home-row" style={{ ['--r' as string]: k + 1 }}>
            <ListRow icon={<span className="text-[12px] tabular-nums">{k + 1}</span>} tone="strong" what={what} where={where} wrap className={k ? 'before:absolute before:left-10 before:right-0 before:top-0 before:h-px before:bg-border' : undefined} />
          </li>
        ))}
      </ol>
    </section>
  );
}

/* ——— Latest updates ——— */

interface Update { key: string; at: Date; kind: EvKind; what: string; where: string; href: string; card: BoardCandidate }

/**
 * The record's latest updates, newest first: each rule made and one-off kept on its own row, the rest of
 * a day's decisions on one change folded into one, and what's waiting on a change as one row that goes to
 * the Review inbox.
 */
function updatesOf(events: Ev[], areaOf: (c: BoardCandidate) => string): Update[] {
  const out: Update[] = [];
  const folded = new Map<string, Ev[]>();
  const waiting = new Map<string, Ev[]>();
  for (const e of events) {
    const area = areaOf(e.card);
    if (e.kind === 'waiting') { waiting.set(e.card.id, [...(waiting.get(e.card.id) ?? []), e]); continue; }
    if (e.kind === 'decided') { const k = `${e.card.id} ${startOfDay(e.at).toDateString()}`; folded.set(k, [...(folded.get(k) ?? []), e]); continue; }
    out.push({
      key: e.id, at: e.at, kind: e.kind, card: e.card, where: whereOf(e.card, area), href: href(e.card.id, { at: e.id }),
      what: e.kind === 'rule' ? `New rule ${e.id}: ${e.text}` : `One-off against ${e.against}: ${e.text}`,
    });
  }
  for (const [k, list] of folded) {
    const c = list[0].card;
    out.push({ key: k, at: list[0].at, kind: 'decided', card: c, where: whereOf(c, areaOf(c)), href: href(c.id, list.length === 1 ? { at: list[0].id } : undefined), what: list.length === 1 ? sentence(list[0].text) : `${list.length} decisions on ${nameIn(areaOf(c), c.name)}` });
  }
  for (const [id, list] of waiting) {
    const c = list[0].card;
    out.push({ key: `w ${id}`, at: list[0].at, kind: 'waiting', card: c, where: whereOf(c, areaOf(c)), href: href('review', { at: id }), what: `${plural(list.length, 'decision')} waiting for you` });
  }
  return out.sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, MOST);
}
/** How many updates Home shows at most, and how many before "Show N more". */
const MOST = 20, SHOWN = 8;
const SEEN_KEY = 'arbiter-home-seen';

/** "Today", "Yesterday", the weekday within this week, then "Thursday, 15 Oct". */
function dayLabel(d: Date): string {
  const now = new Date();
  const days = Math.round((startOfDay(now).getTime() - startOfDay(d).getTime()) / 864e5);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (d >= weekStart(now)) return d.toLocaleDateString('en-GB', { weekday: 'long' });
  return d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short', ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
}

function Updates({ events, areaOf }: { events: Ev[]; areaOf: (c: BoardCandidate) => string }) {
  const rows = updatesOf(events, areaOf);
  const [open, setOpen] = useState(false);
  const id = usePanelId();
  // New since you last opened Home: read once, then this visit is the last one.
  const [seen] = useState<number>(() => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } });
  useEffect(() => { try { localStorage.setItem(SEEN_KEY, String(Date.now())); } catch {} }, []);
  if (!rows.length) return null;
  const allThisWeek = rows.every((r) => r.at >= weekStart(new Date()));
  const shown = rows.slice(0, SHOWN), more = rows.slice(SHOWN);
  const list = (part: Update[], after?: Update, offset = 0) => {
    const out: React.ReactNode[] = [];
    let group: Update[] = [];
    let prev = after;
    const flush = (label: boolean) => {
      if (!group.length) return;
      out.push(
        <div key={group[0].key + 'g'}>
          {label ? <p className="home-row mb-1 mt-5 text-[12px] text-faint" style={{ ['--r' as string]: offset + out.length }}>{dayLabel(group[0].at)}</p> : null}
          <div className="flex flex-col">
            {group.map((u, k) => (
              <ListRow key={u.key} href={u.href} className="home-row" style={{ ['--r' as string]: offset + out.length + k }}
                icon={u.kind === 'waiting' ? Kind.waiting(14) : u.kind === 'rule' ? Kind.rule(14) : u.kind === 'oneOff' ? Kind.oneOff(14) : Kind.decided(14)}
                tone={u.kind === 'waiting' ? 'waiting' : u.kind === 'rule' ? 'strong' : undefined}
                what={u.what} where={u.where} fresh={!!seen && u.at.getTime() > seen}
                end={u.kind === 'waiting'
                  ? <span className="inline-flex items-center gap-1 text-info">Review <span className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none">{Small.arrow}</span></span>
                  : <Tooltip label={u.at.toLocaleString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', hour: 'numeric', minute: '2-digit' })}><time dateTime={u.at.toISOString()}>{clock(u.at)}</time></Tooltip>} />
            ))}
          </div>
        </div>,
      );
      group = [];
    };
    let labelNext = !after;
    for (const u of part) {
      if (prev && !sameDay(prev.at, u.at)) { flush(labelNext); labelNext = true; }
      group.push(u);
      prev = u;
    }
    flush(labelNext);
    return out;
  };
  return (
    <section className="mt-[72px]" aria-labelledby="updates-title">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 id="updates-title" className="text-[15px] font-semibold tracking-tight">Latest updates</h2>
        <p className="text-[12px] text-muted">{allThisWeek ? 'This week' : `Since ${monthDay(rows[rows.length - 1].at)}`}</p>
      </div>
      {list(shown)}
      {more.length ? <>
        <ExpanderPanel id={id} open={open} grow>{list(more, shown[shown.length - 1], 0)}</ExpanderPanel>
        <ExpanderButton open={open} onToggle={() => setOpen((o) => !o)} controls={id} className="-mx-2 mt-2 h-7 px-2 text-[13px] hover:bg-surface-2">
          {open ? 'Show less' : `Show ${more.length} more`}
        </ExpanderButton>
      </> : null}
    </section>
  );
}

