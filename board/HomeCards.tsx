import { useEffect, useRef, useState } from 'react';
import { BigNumber, Id, Lede, PageTitle } from '@/components/ui/type';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Chevron, ExpanderPanel } from '@/components/ui/expander';
import { cn } from '@/components/ui/cn';
import { Kind, Small } from '@/components/ui/icons';
import { Tooltip } from '@/components/ui/tooltip';
import { href } from './route';
import { ReviewCount } from './bits';

/**
 * A design in progress, not wired up: Home before anything is recorded as a landing page's "how it
 * works", three steps, each with a small picture of the thing itself. Build is a chat with the agent;
 * Review is an inbox card with its real buttons; Rules is DECISIONS.md. The pictures are drawn with the
 * board's own parts, inert: nothing in them can be clicked or focused. Three layouts:
 *
 *   #/home?look=start-cards         Columns: three cards side by side, picture on top
 *   #/home?look=start-cards-bento   Bento: four steps in two tile rows, Keep track as the fourth
 *     …-bento-big      Build biggest: three wide, both rows; Review two wide; Rules and Keep track a tile each
 *     …-bento-zigzag   Zigzag: wide short cards, 3·2 over 2·3, words beside the picture on the wide ones
 *     …-bento-tall     Four tall: four equal columns, each both rows tall, words over the picture
 *   #/home?look=start-cards-rows    Rows: a step a row, words and picture alternating sides
 */

interface Step { n: number; title: string; /** For a one-tile card. */ short?: string; says: string; link?: { label: string; to: string }; Picture: (p: Look) => React.ReactElement }
/** How big a picture is drawn: `window` gives the chat its top line, `long` an earlier exchange too; `compact` is a small bento card's. */
interface Look { window?: boolean; long?: boolean; compact?: boolean; tight?: boolean; narrow?: boolean; /** Compact, with room for one more line (Rules' third rule). */ roomy?: boolean }

const STEPS: Step[] = [
  { n: 1, title: 'Build', says: 'Ask your agent for a screen or a change. It records each design decision it makes.', Picture: Chat },
  { n: 2, title: 'Review', says: 'Its decisions wait in your Review inbox. Confirm them, make one a rule, or fix it in your own words.', link: { label: 'Open Review inbox', to: href('review') }, Picture: Inbox },
  { n: 3, title: 'Keep the rules', short: 'Rules', says: 'Rules are saved in DECISIONS.md, and every change after follows them, so the product stays consistent.', link: { label: 'See Design rules', to: href('rules') }, Picture: Rules },
];

/** The bento's fourth step: everything you build stays on the board, day by day. */
const TRACK: Step = { n: 4, title: 'Keep track', says: 'Every change keeps its pictures and decisions. Compare before and after, and see how it got here.', link: { label: 'See Overview', to: href('overview') }, Picture: Compare };

export function HomeCards({ look }: { look: string }) {
  const bento = look.startsWith('start-cards-bento');
  const layout = bento ? <Bento look={look} layout={BENTOS[look] ?? BENTOS['start-cards-bento']} /> : look === 'start-cards-rows' ? <Rows /> : <Columns />;
  return (
    <main>
      <PageTitle className="home-rise">Let’s get building</PageTitle>
      <Lede className="home-rise [--delay:40ms]">How it works, in {bento ? 'four' : 'three'} steps. Once you start, this becomes your build summary.</Lede>
      {layout}
      <Commands />
      <section className="mt-16">
        <h2 className="home-row mb-1 text-[15px] font-semibold tracking-tight [--r:4]">Latest updates</h2>
        <p className="home-row text-[13px] text-muted [--r:5]">Nothing yet. Every decision your agent records shows up here, newest first.</p>
      </section>
    </main>
  );
}

/* ——— Commands ——— */

/**
 * The key things you can type, in Claude Code's chat and in the terminal: an accordion, one open at a
 * time. Each row is the command and what it's for; open, it says a little more, with Copy. Only commands
 * Arbiter has: `/arbiter` and a phrase its skill listens for (templates/SKILL.md), and `npx arbiter …`
 * (src/index.ts).
 */
const COMMANDS: { cmd: string; what: string; more: string; copy?: string }[] = [
  { cmd: '/arbiter', what: 'Review what’s waiting, in the chat', more: 'Goes through each decision the agent made, one at a time, without opening the board. It also picks up the fixes you asked for here.', copy: '/arbiter' },
  { cmd: '“make that a rule”', what: 'Turn a decision into a design rule', more: 'Say it in the chat. It’s saved to DECISIONS.md, so every change after follows it.' },
  { cmd: 'npx arbiter review', what: 'Open this board', more: 'Starts the board for this project. It stops a few seconds after you close its last tab.', copy: 'npx arbiter review' },
  { cmd: 'npx arbiter export', what: 'Share a read-only copy', more: 'Writes the board as a folder anyone can open, with no review queue. Nothing is sent anywhere.', copy: 'npx arbiter export' },
];

function Commands() {
  const [open, setOpen] = useState<string | null>(null);
  return (
    <section className="mt-16" aria-labelledby="commands-title">
      <div className="mb-1 flex items-baseline justify-between">
        <h2 id="commands-title" className="text-[15px] font-semibold tracking-tight">Commands</h2>
        <p className="text-[12px] text-muted">In Claude Code and your terminal</p>
      </div>
      <ul className="mt-2">
            {COMMANDS.map((c) => {
              const on = open === c.cmd;
              const id = `cmd-${c.cmd.replace(/\W+/g, '-')}`;
              return (
                <li key={c.cmd} className="border-t border-border first:border-t-0">
                  <button type="button" onClick={() => setOpen(on ? null : c.cmd)} aria-expanded={on} aria-controls={id} className="group flex w-full items-center gap-3 py-2.5 text-left">
                    <code className="shrink-0 rounded-[4px] bg-surface-2 px-1.5 py-0.5 font-mono text-[12px] text-fg">{c.cmd}</code>
                    <span className="min-w-0 flex-1 truncate text-[14px] text-muted underline-offset-2 group-hover:text-fg group-hover:underline">{c.what}</span>
                    <Chevron open={on} className="text-faint" />
                  </button>
                  <ExpanderPanel id={id} open={on} grow>
                    <div className="flex items-start justify-between gap-6 pb-3">
                      <p className="max-w-lg text-[13px] text-muted">{c.more}</p>
                      {c.copy ? <CopyButton text={c.copy} /> : null}
                    </div>
                  </ExpanderPanel>
                </li>
              );
            })}
      </ul>
    </section>
  );
}

/** Copy a command; says so for a moment. */
function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500); } catch {}
  };
  return <button type="button" onClick={() => void copy()} className={cn(buttonClass('ghost', 'sm'), 'shrink-0')}>{done ? 'Copied' : 'Copy'}</button>;
}

/* ——— The pictures ——— */

/** Where a picture sits: a white panel inside the grey card, so the parts in it read as the board's own. */
function Frame({ tight, className, children }: { tight?: boolean; className?: string; children: React.ReactNode }) {
  return <div inert aria-hidden="true" className={cn('relative overflow-hidden rounded-[14px] border border-border bg-bg', tight ? 'p-3' : 'p-4', className)}>{children}</div>;
}

/**
 * The chat box's words. At rest, "Ask for a change" with a blinking caret; while you point at the card,
 * a request types itself out in its place (revealed a step at a time), and the send button lifts once it's
 * typed. With reduced motion the request simply shows.
 */
function Typing() {
  return (
    <span className="relative min-w-0 flex-1 truncate text-[12px]">
      <span className="text-faint transition-opacity duration-150 group-hover/card:opacity-0 motion-reduce:transition-none">Ask for a change<span className="ml-px inline-block h-3.5 w-px translate-y-0.5 bg-fg align-baseline motion-safe:animate-pulse" /></span>
      <span className="absolute inset-y-0 left-0 whitespace-nowrap text-fg [clip-path:inset(0_100%_0_0)] group-hover/card:animate-[home-type_900ms_steps(15,end)_120ms_forwards] motion-reduce:group-hover/card:animate-none motion-reduce:group-hover/card:[clip-path:none]">Add a dark mode</span>
    </span>
  );
}

/** Build: you ask, the agent answers and says what it recorded, and the box to ask the next thing. */
function Chat({ window, long, tight }: Look) {
  if (tight) return (
    <Frame tight className="flex flex-col justify-end gap-1.5">
      <p className="home-row ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-fg px-3 py-1 text-[12px] text-bg [--r:2]">Make a settings page</p>
      <p className="home-row mr-auto flex max-w-[95%] items-center gap-1.5 rounded-2xl rounded-bl-md border border-border bg-surface px-3 py-1 text-[12px] [--r:4]"><span className="truncate">Done. Two columns.</span><ReviewCount n={3} /></p>
      <div className="home-row flex h-8 items-center gap-2 rounded-full border border-border bg-bg pl-3 pr-1 [--r:6]">
        <Typing />
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-fg text-bg transition-transform duration-200 group-hover/card:-translate-y-0.5 group-hover/card:delay-[1000ms] motion-reduce:transition-none">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9.5v-7M3 5.5l3-3 3 3" /></svg>
        </span>
      </div>
    </Frame>
  );
  return (
    <Frame className="flex flex-col justify-end gap-2">
      {window || long ? (
        /* The window's own top line, so the room above the messages reads as a chat, not a gap. */
        <p className="-mx-4 -mt-4 mb-auto flex items-center gap-2 border-b border-border px-4 py-2.5 text-[12px] text-muted">
          <span className="flex gap-1" aria-hidden="true"><i className="h-2 w-2 rounded-full bg-border-strong" /><i className="h-2 w-2 rounded-full bg-border-strong" /><i className="h-2 w-2 rounded-full bg-border-strong" /></span>
          <span className="ml-1">Your agent</span>
        </p>
      ) : null}
      {long ? <>
        <p className="home-row ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-fg px-3 py-1.5 text-[12px] text-bg opacity-60 [--r:1]">Tidy up the pricing cards</p>
        <div className="home-row mr-auto max-w-[90%] rounded-2xl rounded-bl-md border border-border bg-surface px-3 py-2 text-[12px] opacity-60 [--r:1]">
          <p>Done. One button style across the three plans.</p>
          <p className="mt-1.5 flex items-center gap-1.5 text-muted"><ReviewCount n={2} /> to review</p>
        </div>
        <p className="home-row my-1 text-center text-[11px] text-faint [--r:2]">Today</p>
      </> : null}
      <p className="home-row ml-auto max-w-[85%] rounded-2xl rounded-br-md bg-fg px-3 py-1.5 text-[12px] text-bg [--r:2]">Make a settings page</p>
      <div className="home-row mr-auto max-w-[90%] rounded-2xl rounded-bl-md border border-border bg-surface px-3 py-2 text-[12px] [--r:4]">
        <p>Done. Two columns, with the toggles grouped.</p>
        <p className="mt-1.5 flex items-center gap-1.5 text-muted"><ReviewCount n={3} /> to review</p>
      </div>
      <div className="home-row mt-1 flex h-9 items-center gap-2 rounded-full border border-border bg-bg pl-3.5 pr-1 [--r:6]">
        <Typing />
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-fg text-bg transition-transform duration-200 group-hover/card:-translate-y-0.5 group-hover/card:delay-[1000ms] motion-reduce:transition-none">
          <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><path d="M6 9.5v-7M3 5.5l3-3 3 3" /></svg>
        </span>
      </div>
    </Frame>
  );
}

/** Review: an inbox card as the Review inbox draws it, with its buttons; another waits behind it. Compact: the change and the buttons. */
function Inbox({ compact, narrow, roomy }: Look) {
  // Compact with room (the zigzag's taller rows): the inbox card itself, without its Rejected line, the next one peeking out.
  if (compact && roomy) return (
    <Frame tight className="flex flex-col justify-center pb-5">
      <div className="absolute inset-x-7 bottom-2 h-5 rounded-lg border border-border bg-surface opacity-70" />
      <div className="home-row relative rounded-lg border border-border bg-surface p-3 shadow-sm [--r:3]">
        <div className="flex items-center gap-1.5">
          <Id>P-0012</Id>
          <Badge tone="info">Pattern</Badge>
          <Badge>Visual</Badge>
        </div>
        <p className="mt-2 text-[12px] font-medium">Small buttons on cards</p>
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button size="sm" variant="primary">Confirm</Button>
          <Button size="sm">Make it a rule</Button>
        </div>
      </div>
    </Frame>
  );
  if (narrow) return (
    <Frame tight className="flex flex-col justify-center gap-2">
      <p className="home-row flex min-w-0 items-center gap-1.5 [--r:3]"><Id>P-0012</Id><Badge tone="info">Pattern</Badge></p>
      <p className="home-row text-[12px] font-medium [--r:3]">Small buttons on cards</p>
      <div className="home-row mt-1 flex flex-col gap-1.5 [--r:4]">
        <Button size="sm" variant="primary" className="w-full">Confirm</Button>
        <Button size="sm" className="w-full">Make it a rule</Button>
      </div>
    </Frame>
  );
  if (compact) return (
    <Frame tight className="flex flex-col justify-center gap-2.5">
      <p className="home-row flex min-w-0 items-center gap-2 text-[12px] [--r:3]"><Id className="shrink-0">P-0012</Id><span className="truncate font-medium">Small buttons on cards</span></p>
      <div className="home-row flex items-center gap-1.5 [--r:4]">
        <Button size="sm" variant="primary">Confirm</Button>
        <Button size="sm">Make it a rule</Button>
      </div>
    </Frame>
  );
  return (
    <Frame className="flex flex-col justify-center">
      {/* The next one, peeking out underneath. */}
      <div className="absolute inset-x-8 bottom-2.5 h-6 rounded-lg border border-border bg-surface opacity-70" />
      <div className="home-row relative rounded-lg border border-border bg-surface p-3 shadow-sm [--r:3]">
        <div className="flex flex-wrap items-center gap-1.5">
          <Id>P-0012</Id>
          <Badge tone="info">Pattern</Badge>
          <Badge>Visual</Badge>
        </div>
        <p className="mt-2 text-[12px] font-medium">Small buttons on cards</p>
        <p className="mt-0.5 text-[12px] text-muted">Rejected: full-width buttons</p>
        <div className="mt-3 flex items-center gap-1.5">
          <Button size="sm" variant="primary">Confirm</Button>
          <Button size="sm">Make it a rule</Button>
        </div>
      </div>
    </Frame>
  );
}

const RULES: [string, string][] = [
  ['D-0007', 'Small buttons on cards'],
  ['D-0010', 'Cool, flat greys'],
  ['D-0018', 'Three type weights'],
];

/** Rules: DECISIONS.md, a rule a line, each with its id and a tick for being followed. Compact: two rules, no file name. */
function Rules({ compact, narrow, roomy }: Look) {
  compact = compact || narrow;
  return (
    <Frame tight={compact} className="flex flex-col justify-center">
      {compact ? null : <p className="home-row mb-2 flex items-center gap-1.5 font-mono text-[11px] text-faint [--r:2]">
        <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round"><path d="M3 1.5h4l2.5 2.5v6.5H3z" /><path d="M7 1.5V4h2.5" /></svg>
        DECISIONS.md
      </p>}
      <ul>
        {RULES.slice(0, compact && !roomy ? 2 : 3).map(([id, rule], k) => (
          <li key={id} className={cn('home-row flex items-center gap-2.5 border-border py-2', compact ? 'py-1.5 not-first:border-t' : 'border-t')} style={{ ['--r' as string]: 3 + k }}>
            <span className="text-fg">{Kind.rule(14)}</span>
            {narrow ? null : <Id className="shrink-0">{id}</Id>}
            <span className="min-w-0 flex-1 truncate text-[12px]">{rule}</span>
            {narrow ? null : <Badge tone="ok">Rule</Badge>}
          </li>
        ))}
      </ul>
    </Frame>
  );
}

/**
 * Keep track: one screen before and after a change, wiped like a change's Compare: before on the left,
 * after on the right, the divider between with its handle. A sketch of a screen, not a real one: before
 * has one wide card with a full-width button; after, two cards with small buttons.
 */
function Compare(_: Look) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    // The picture can't be pointed at (it's inert), so the card it sits in listens.
    const card = el?.closest<HTMLElement>('.tile-grain');
    if (!el || !card) return;
    const move = (e: PointerEvent) => {
      const r = el.getBoundingClientRect();
      const x = Math.min(0.92, Math.max(0.08, (e.clientX - r.left) / r.width));
      el.style.setProperty('--x', `${(x * 100).toFixed(1)}%`);
    };
    const leave = () => el.style.removeProperty('--x');
    card.addEventListener('pointermove', move);
    card.addEventListener('pointerleave', leave);
    return () => { card.removeEventListener('pointermove', move); card.removeEventListener('pointerleave', leave); };
  }, []);
  const screen = (after: boolean) => (
    <div className="flex h-full flex-col gap-1.5 rounded-md border border-border bg-surface p-2.5">
      <i className="h-1.5 w-10 rounded-full bg-border-strong" />
      <i className="h-1 w-20 rounded-full bg-border" />
      {after ? (
        <div className="mt-auto grid grid-cols-2 gap-1.5">
          {[0, 1].map((k) => (
            <div key={k} className="flex flex-col gap-1 rounded-[4px] border border-border bg-bg p-1.5">
              <i className="h-1 w-3/4 rounded-full bg-border-strong" />
              <i className="h-1 w-1/2 rounded-full bg-border" />
              <i className="mt-0.5 h-2.5 w-7 rounded-[3px] bg-fg" />
            </div>
          ))}
        </div>
      ) : (
        <div className="mt-auto flex flex-col gap-1 rounded-[4px] border border-border bg-bg p-1.5">
          <i className="h-1 w-1/2 rounded-full bg-border-strong" />
          <i className="h-1 w-1/3 rounded-full bg-border" />
          <i className="mt-0.5 h-2.5 w-full rounded-[3px] bg-fg" />
        </div>
      )}
    </div>
  );
  return (
    <Frame tight>
      <div ref={box} className="relative h-full">
        <div className="absolute inset-0">{screen(false)}</div>
        <div className="home-wipe absolute inset-0">{screen(true)}</div>
        {/* The divider and its handle, as Compare draws them. */}
        <div className="home-wipe-line absolute inset-y-0 w-px -translate-x-1/2 bg-fg">
          <span className="absolute left-1/2 top-1/2 flex h-4 w-4 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-fg bg-bg" />
        </div>
        <span className="absolute left-1.5 top-1.5 rounded-full border border-border bg-bg px-1.5 text-[11px] leading-4 text-muted">Before</span>
        <span className="absolute right-1.5 top-1.5 rounded-full border border-border bg-bg px-1.5 text-[11px] leading-4 text-fg">After</span>
      </div>
    </Frame>
  );
}

/* ——— The words ——— */

/** The step's number in a ring, its title, what it is, and where to go. */
function Words({ s, big, className }: { s: Step; big?: boolean; className?: string }) {
  return (
    <div className={className}>
      {big ? <BigNumber className="mb-3">{s.n}</BigNumber> : <span className="mb-3 flex h-6 w-6 items-center justify-center rounded-full border border-border-strong text-[12px] tabular-nums text-fg">{s.n}</span>}
      <h3 className="text-[15px] font-semibold tracking-tight">{s.title}</h3>
      <p className="mt-1 max-w-sm text-[13px] text-muted">{s.says}</p>
      {s.link ? (
        <a href={s.link.to} className="group mt-3 inline-flex items-center gap-1 text-[13px] text-fg">
          <span className="underline-offset-2 group-hover:underline">{s.link.label}</span>
          <span className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none">{Small.arrow}</span>
        </a>
      ) : null}
    </div>
  );
}

/** A grey card in Home's tile language: 22px corners, the grain, the picture first. */
function Card({ i, className, children }: { i: number; className?: string; children: React.ReactNode }) {
  return <div style={{ ['--i' as string]: i }} className={cn('tile-grain home-tile relative overflow-hidden rounded-[22px] bg-surface-2 [--grain:.55]', className)}>{children}</div>;
}

/* ——— Three layouts ——— */

/** Columns: three cards side by side, the picture on top at one height, the words under it. */
function Columns() {
  return (
    <div className="mt-6 grid gap-4 lg:grid-cols-3">
      {STEPS.map((s, k) => (
        <Card key={s.n} i={k} className="flex flex-col gap-5 p-4">
          <div className="h-56 [&>div]:h-full"><s.Picture /></div>
          <Words s={s} className="px-1 pb-1" />
        </Card>
      ))}
    </div>
  );
}

/**
 * A bento card: which step, where it sits on the five-column, two-row grid (lg and up; below that the
 * cards stack), how its top reads, how big its picture is, and whether its words sit beside the picture
 * (a wide, one-row card) instead of over it.
 */
interface Slot { step: Step; span: string; head: Head; pic?: Look; side?: boolean }
const [BUILD_STEP, REVIEW_STEP, RULES_STEP] = STEPS;

/** Four steps in two tile rows (160px each), the height Home's tiles will take, four ways; the zigzag's rows are taller, so nothing in it is squeezed. */
const ROWS: Record<string, string> = { 'start-cards-bento-zigzag': 'lg:grid-rows-[224px_224px]' };
const BENTOS: Record<string, Slot[]> = {
  // Build two wide and both rows tall; Review three wide; under it Rules two wide and Keep track a tile.
  'start-cards-bento': [
    { step: BUILD_STEP, span: 'lg:col-span-2 lg:row-span-2', head: 'line', pic: { window: true } },
    { step: REVIEW_STEP, span: 'lg:col-span-3', head: 'compact', pic: { compact: true } },
    { step: RULES_STEP, span: 'lg:col-span-2', head: 'compact', pic: { compact: true } },
    { step: TRACK, span: 'lg:col-span-1', head: 'narrow' },
  ],
  // Build biggest: three wide and both rows; Review two wide; Rules and Keep track a tile each under it.
  'start-cards-bento-big': [
    { step: BUILD_STEP, span: 'lg:col-span-3 lg:row-span-2', head: 'line', pic: { window: true } },
    { step: REVIEW_STEP, span: 'lg:col-span-2', head: 'compact', pic: { compact: true } },
    { step: RULES_STEP, span: 'lg:col-span-1', head: 'narrow', pic: { narrow: true } },
    { step: TRACK, span: 'lg:col-span-1', head: 'narrow' },
  ],
  // Zigzag: 3·2 over 2·3. The wide cards put their words beside the picture.
  'start-cards-bento-zigzag': [
    { step: BUILD_STEP, span: 'lg:col-span-3', head: 'stack', side: true },
    { step: REVIEW_STEP, span: 'lg:col-span-2', head: 'compact', pic: { compact: true, roomy: true } },
    { step: RULES_STEP, span: 'lg:col-span-2', head: 'compact', pic: { compact: true, roomy: true } },
    { step: TRACK, span: 'lg:col-span-3', head: 'stack', side: true },
  ],
  // Four tall: equal columns on a four-column grid, each both rows tall, words over the picture.
  'start-cards-bento-tall': [
    { step: BUILD_STEP, span: 'lg:row-span-2', head: 'stack', pic: { tight: true } },
    { step: REVIEW_STEP, span: 'lg:row-span-2', head: 'stack', pic: { narrow: true } },
    { step: RULES_STEP, span: 'lg:row-span-2', head: 'stack', pic: { narrow: true } },
    { step: TRACK, span: 'lg:row-span-2', head: 'stack' },
  ],
};

function Bento({ look, layout }: { look: string; layout: Slot[] }) {
  const four = layout === BENTOS['start-cards-bento-tall'];
  // Taller rows get a little more room inside each card too.
  const pad = ROWS[look] ? 'p-5' : 'p-4';
  return (
    <div className={cn('mt-6 grid gap-4', ROWS[look] ?? 'lg:grid-rows-[160px_160px]', four ? 'sm:grid-cols-2 lg:grid-cols-4' : 'lg:grid-cols-5')}>
      {layout.map(({ step, span, head, pic, side }, k) => {
        const Pic = step.Picture;
        return (
          <Card key={step.n} i={k} className={cn('group/card', span, head === 'narrow' && 'group', pad, side ? 'grid gap-6 sm:grid-cols-[minmax(0,13rem)_minmax(0,1fr)]' : 'flex flex-col gap-3')}>
            <BentoHead s={step} head={head} />
            <div className={cn('flex-1 lg:min-h-0 [&>div]:h-full', head === 'line' || head === 'stack' && !side ? 'min-h-48' : 'min-h-20')}><Pic {...pic} /></div>
            {/* A one-tile card has no room for a link beside its title: the whole card goes there. */}
            {head === 'narrow' && step.link ? <a href={step.link.to} aria-label={step.link.label} className="absolute inset-0 rounded-[22px]" /> : null}
          </Card>
        );
      })}
    </div>
  );
}

/**
 * A bento card's top, four ways. `line`: the title with its line under it and the link at the right (the
 * big card). `compact`: the title, its line in a tooltip, and the link at the right. `narrow`: the title
 * alone, its line in a tooltip; the whole card is the link. `stack`: title, line and link one under the
 * other, for a narrow column of words.
 */
type Head = 'line' | 'compact' | 'narrow' | 'stack';

function BentoHead({ s, head }: { s: Step; head: Head }) {
  const told = head === 'line' || head === 'stack';
  const title = (
    <p tabIndex={told ? undefined : 0} className="flex w-fit items-center gap-2 rounded-[4px] text-[15px] font-semibold tracking-tight">
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-border-strong text-[11px] font-normal tabular-nums">{s.n}</span>{head === 'narrow' ? s.short ?? s.title : s.title}
    </p>
  );
  const link = s.link ? (
    <a href={s.link.to} className="group/l inline-flex shrink-0 items-center gap-1 text-[12px] text-muted hover:text-fg">
      <span className="underline-offset-2 group-hover/l:underline">{s.link.label}</span>
      <span className="transition-transform duration-150 group-hover/l:translate-x-0.5 motion-reduce:transition-none">{Small.arrow}</span>
    </a>
  ) : null;
  if (head === 'stack') return (
    <div className="px-1">
      {title}
      <p className="mt-1 text-[13px] text-muted">{s.says}</p>
      {link ? <div className="mt-2">{link}</div> : null}
    </div>
  );
  return (
    // Compact: the link on the heading's line, centred on it. With a line under the title, it stays at the top.
    <div className={cn('flex justify-between gap-4 px-1', head === 'compact' ? 'items-center' : 'items-start', head === 'narrow' && 'relative z-10')}>
      <div className="min-w-0">
        {told ? title : <Tooltip label={s.says}>{title}</Tooltip>}
        {head === 'line' ? <p className="mt-1 max-w-md text-[13px] text-muted">{s.says}</p> : null}
      </div>
      {head === 'narrow' || !link ? null : <span className={head === 'compact' ? undefined : 'mt-0.5'}>{link}</span>}
    </div>
  );
}

/** Rows: a step a row, the big light number and words on one side, the picture on the other, alternating. */
function Rows() {
  return (
    <div className="mt-8 flex flex-col gap-4">
      {STEPS.map((s, k) => (
        <Card key={s.n} i={k} className="grid items-center gap-6 p-6 md:grid-cols-2">
          <Words s={s} big className={cn('md:px-2', k % 2 ? 'md:order-2' : '')} />
          <div className="h-56 [&>div]:h-full"><s.Picture /></div>
        </Card>
      ))}
    </div>
  );
}
