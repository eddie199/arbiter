import { useState } from 'react';
import { BigNumber, Lede, PageTitle, Unit } from '@/components/ui/type';
import { buttonClass } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { Chevron, ExpanderPanel } from '@/components/ui/expander';
import { Kind, Small } from '@/components/ui/icons';
import { ListRow } from '@/components/ui/list-row';
import { Tile, TileHead, TileText, TileTitle } from '@/components/ui/tile';
import { href } from './route';
import { HomeCards } from './HomeCards';

/**
 * Designs in progress, not wired up: Home before anything is recorded, as an onboarding checklist instead
 * of tiles. Nothing here reads the record or ticks itself off; the buttons only go to the pages they name.
 * Four looks of the same four steps, each at its own address:
 *
 *   #/home?look=start            Checklist: a panel, every step open, a button on each
 *   #/home?look=start-accordion  Accordion: only the step you're on is open
 *   #/home?look=start-split      List and detail: the steps on the left, the chosen one large on the right
 *   #/home?look=start-tile       Home tile: a black tile with the progress, then the steps as Home's list rows
 *   #/home?look=start-bento      Bento: steps 1, 2 and 3 as Home tiles of different sizes, no Preferences step
 */

/** Build: a spark, drawn like the rest of Home's icons (16px grid, 1.3 stroke). */
const BUILD = (size = 16) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M8 2.5c.4 2.6 1.9 4.1 4.5 4.5-2.6.4-4.1 1.9-4.5 4.5-.4-2.6-1.9-4.1-4.5-4.5 2.6-.4 4.1-1.9 4.5-4.5z" /><path d="M12.5 11.5v2M11.5 12.5h2" /></svg>;
/** Pictures: a camera, on the same grid. */
const CAMERA = (size = 16) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M2 5.5A1.5 1.5 0 0 1 3.5 4h1.6l1.1-1.5h3.6L10.9 4h1.6A1.5 1.5 0 0 1 14 5.5v6a1.5 1.5 0 0 1-1.5 1.5h-9A1.5 1.5 0 0 1 2 11.5z" /><circle cx="8" cy="8.3" r="2.3" /></svg>;

interface Step { title: string; says: string; icon: (size?: number) => React.ReactElement; action?: { label: string; to: string }; examples?: string[] }
const STEPS: Step[] = [
  {
    title: 'Build something with your agent',
    says: 'Ask for a screen or a change. Arbiter records the design decisions it makes as it goes.',
    icon: BUILD,
    examples: ['“Make a settings page”', '“Tidy up the pricing cards”', '“Add an empty state to the inbox”'],
  },
  {
    title: 'Review what it decided',
    says: 'Each decision waits in the Review inbox. Confirm it, make it a rule, or fix it in your own words.',
    icon: Kind.waiting,
    action: { label: 'Open Review inbox', to: href('review') },
  },
  {
    title: 'Make your first rule',
    says: 'A rule is a call that should always hold. Rules are saved in DECISIONS.md, and every change after follows them.',
    icon: Kind.rule,
    action: { label: 'See Design rules', to: href('rules') },
  },
  {
    title: 'Turn on pictures',
    says: 'Tell Arbiter where your app runs, and each screen that changes gets a picture on the board.',
    icon: CAMERA,
    action: { label: 'Open Preferences', to: href('preferences') },
  },
];
/** How many are done: none, in these designs. The next to do is the one after them. */
const DONE = 0;

export function HomeStart({ look }: { look: string }) {
  // The landing-page looks, with a picture for each step, live in HomeCards.tsx.
  if (look.startsWith('start-cards')) return <HomeCards look={look} />;
  const body = look === 'start-bento' ? <Bento /> : look === 'start-accordion' ? <Accordion /> : look === 'start-split' ? <Split /> : look === 'start-tile' ? <TileLook /> : <Checklist />;
  return (
    <main className={look === 'start-tile' || look === 'start-bento' ? undefined : 'max-w-3xl'}>
      <PageTitle className="home-rise">Let’s get building</PageTitle>
      <Lede className="home-rise [--delay:40ms]">{look === 'start-bento' ? 'Three steps to get going. Once you start, this becomes your build summary.' : 'Get set up in a few steps. Once you start, this becomes your build summary.'}</Lede>
      {body}
      <section className="mt-12">
        <h2 className="home-row mb-1 text-[15px] font-semibold tracking-tight [--r:3]">Latest updates</h2>
        <p className="home-row text-[13px] text-muted [--r:4]">Nothing yet. Every decision your agent records shows up here, newest first.</p>
      </section>
    </main>
  );
}

/* ——— Parts the looks share ——— */

/** A step's number in a ring: fg on the one to do next, quiet on the rest. A done one would be a tick in green. */
function Ring({ n }: { n: number }) {
  return <span className={cn('flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[11px] tabular-nums', n - 1 === DONE ? 'border-fg text-fg' : 'border-border-strong text-muted')}>{n}</span>;
}

function Bar({ className }: { className?: string }) {
  return (
    <div className={cn('h-1 overflow-hidden rounded-full bg-surface-2', className)} role="progressbar" aria-valuemin={0} aria-valuemax={STEPS.length} aria-valuenow={DONE} aria-label="Steps done">
      <div className="h-full rounded-full bg-fg" style={{ width: `${(DONE / STEPS.length) * 100}%` }} />
    </div>
  );
}

/** "Get started" and how many are done, with the bar. */
function PanelHead() {
  return (
    <div className="flex items-center justify-between gap-6 px-5 py-4">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">Get started</h2>
        <p className="mt-0.5 text-[13px] text-muted">{DONE} of {STEPS.length} done</p>
      </div>
      <Bar className="w-32" />
    </div>
  );
}

function Examples({ list, className }: { list: string[]; className?: string }) {
  return (
    <div className={cn('flex flex-wrap gap-1.5', className)}>
      <span className="text-[12px] leading-6 text-faint">Try</span>
      {list.map((x) => <span key={x} className="inline-flex h-6 items-center rounded-full bg-surface-2 px-2.5 text-[12px] text-fg">{x}</span>)}
    </div>
  );
}

const Panel = ({ children }: { children: React.ReactNode }) => (
  <section className="home-rise mt-6 overflow-hidden rounded-lg border border-border bg-surface [--delay:80ms]">{children}</section>
);

/* ——— Checklist: every step open, a button on each ——— */

function Checklist() {
  return (
    <Panel>
      <PanelHead />
      <ol>
        {STEPS.map((s, k) => (
          <li key={s.title} className="flex items-start gap-4 border-t border-border px-5 py-4">
            <span className="mt-px"><Ring n={k + 1} /></span>
            <div className="min-w-0 flex-1">
              <p className="text-[14px] leading-5">{s.title}</p>
              <p className="mt-0.5 max-w-lg text-[13px] text-muted">{s.says}</p>
              {s.examples ? <Examples list={s.examples} className="mt-2.5" /> : null}
            </div>
            {s.action ? <a href={s.action.to} className={cn(buttonClass('secondary', 'sm'), 'shrink-0')}>{s.action.label}</a> : null}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

/* ——— Accordion: only the step you're on is open; the rest are one line each ——— */

function Accordion() {
  const [open, setOpen] = useState(DONE);
  return (
    <Panel>
      <PanelHead />
      <ol>
        {STEPS.map((s, k) => {
          const on = open === k;
          return (
            <li key={s.title} className="border-t border-border">
              <button type="button" onClick={() => setOpen(on ? -1 : k)} aria-expanded={on} className="group flex w-full items-center gap-4 px-5 py-3.5 text-left">
                <Ring n={k + 1} />
                <span className={cn('flex-1 text-[14px] underline-offset-2 group-hover:underline', on || k === DONE ? 'text-fg' : 'text-muted')}>{s.title}</span>
                <Chevron open={on} className="text-faint" />
              </button>
              <ExpanderPanel open={on} grow>
                {/* Lined up under the step's title: the row's 20px, the ring's 20px and the 16px between. */}
                <div className="pb-5 pl-14 pr-5">
                  <p className="max-w-lg text-[13px] text-muted">{s.says}</p>
                  {s.examples ? <Examples list={s.examples} className="mt-2.5" /> : null}
                  {s.action ? <a href={s.action.to} className={cn(buttonClass(k === DONE ? 'primary' : 'secondary', 'sm'), 'mt-3')}>{s.action.label}</a> : null}
                </div>
              </ExpanderPanel>
            </li>
          );
        })}
      </ol>
    </Panel>
  );
}

/* ——— List and detail: the steps on the left, the chosen one large on the right ——— */

function Split() {
  const [cur, setCur] = useState(DONE);
  const s = STEPS[cur];
  return (
    <section className="home-rise mt-6 grid overflow-hidden rounded-lg border border-border bg-surface [--delay:80ms] md:grid-cols-[16rem_minmax(0,1fr)]">
      <div className="border-b border-border p-2 md:border-b-0 md:border-r">
        <div className="px-3 pb-3 pt-2">
          <h2 className="text-[15px] font-semibold tracking-tight">Get started</h2>
          <p className="mt-0.5 text-[13px] text-muted">{DONE} of {STEPS.length} done</p>
          <Bar className="mt-3" />
        </div>
        <ol className="space-y-0.5">
          {STEPS.map((x, k) => (
            <li key={x.title}>
              {/* Picked the way the side nav marks where you are: a tint, fg words. */}
              <button type="button" onClick={() => setCur(k)} aria-current={k === cur ? 'step' : undefined}
                className={cn('flex min-h-9 w-full items-center gap-3 rounded-ui px-3 py-1.5 text-left text-[13px]', k === cur ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg')}>
                <Ring n={k + 1} />
                <span className="min-w-0">{x.title}</span>
              </button>
            </li>
          ))}
        </ol>
      </div>
      <div className="flex min-h-72 flex-col p-6">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-2 text-fg">{s.icon()}</span>
        <p className="mt-5 text-[12px] text-faint">Step {cur + 1} of {STEPS.length}</p>
        <h3 className="mt-1 text-[15px] font-semibold tracking-tight">{s.title}</h3>
        <p className="mt-1.5 max-w-md text-[14px] text-muted">{s.says}</p>
        {s.examples ? <Examples list={s.examples} className="mt-4" /> : null}
        <div className="mt-auto flex items-center gap-2 pt-6">
          {s.action ? <a href={s.action.to} className={buttonClass(cur === DONE ? 'primary' : 'secondary', 'sm')}>{s.action.label}</a> : null}
          {cur < STEPS.length - 1 ? <button type="button" onClick={() => setCur(cur + 1)} className={cn(buttonClass('ghost', 'sm'), 'gap-1')}>Next step {Small.arrow}</button> : null}
        </div>
      </div>
    </section>
  );
}

/* ——— Home tile: a black tile with the progress, then the steps as Home's list rows ——— */

function TileLook() {
  return (
    <>
      {/* One black tile the width of the grid, the tile language Home will have once building starts. */}
      <div className="tile-grain home-tile relative mt-6 flex h-40 flex-col justify-between overflow-hidden rounded-[22px] bg-fg p-4 text-bg [--grain:.3] [--tile-quiet:var(--faint)]">
        <TileHead>
          <TileTitle tip="Four steps to your first decision. This page becomes your build summary once you start.">Get started</TileTitle>
          <TileText quiet>{STEPS.length} steps</TileText>
        </TileHead>
        <div className="flex items-end justify-between gap-6">
          <BigNumber>{DONE}<Unit>{` of ${STEPS.length} done`}</Unit></BigNumber>
          {/* A segment a step: the next one in the accent red (Home's mark for what needs you), the rest faint. */}
          <div className="mb-1 flex w-56 gap-1" aria-hidden="true">
            {STEPS.map((x, k) => <i key={x.title} className={cn('h-1.5 flex-1 rounded-full', k < DONE ? 'bg-current' : k === DONE ? 'bg-brand' : 'bg-[color-mix(in_srgb,currentColor_20%,transparent)]')} />)}
          </div>
        </div>
      </div>
      <ol className="mt-4 flex flex-col">
        {STEPS.map((s, k) => (
          <li key={s.title} className="home-row" style={{ ['--r' as string]: k + 1 }}>
            <ListRow icon={s.icon(14)} tone={k === DONE ? 'strong' : undefined} what={s.title} where={s.says} wrap
              className={k ? 'before:absolute before:left-10 before:right-0 before:top-0 before:h-px before:bg-border' : undefined}
              end={s.action ? <a href={s.action.to} className="group/a inline-flex items-center gap-1 text-[12px] text-muted hover:text-fg">{s.action.label} <span className="transition-transform duration-150 group-hover/a:translate-x-0.5 motion-reduce:transition-none">{Small.arrow}</span></a> : <span className="text-[12px] text-faint">Start here</span>} />
          </li>
        ))}
      </ol>
    </>
  );
}

/* ——— Bento: steps 1, 2 and 3 as Home tiles of different sizes ——— */

/**
 * The first step large and black, three columns by two rows, with requests to start from; Review and
 * Make rules beside it, two columns each, one above the other, each with the page it goes to. The step's
 * number is the tile's big light figure. Below the board's widest layout the three stack.
 */
function Bento() {
  const [build, review, rules] = STEPS;
  return (
    <div className="mt-6 grid auto-rows-[160px] grid-cols-1 gap-4 lg:grid-cols-5">
      <Tile tone="black" i={0} className="lg:col-span-3 row-span-2">
        <TileHead>
          <TileTitle tip="Your agent records the design decisions it makes as it builds.">Build</TileTitle>
          {/* The one red mark: where to begin. */}
          <TileText className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-brand" aria-hidden="true" />Start here</TileText>
        </TileHead>
        <div>
          <TileText quiet className="mb-1.5">Try asking your agent</TileText>
          {build.examples!.map((ask, k) => (
            <div key={ask} className="flex h-[29px] items-center justify-between gap-3 border-t border-[color-mix(in_srgb,currentColor_22%,transparent)] text-[13px]">
              <span className="truncate">{ask}</span>
              <span className="shrink-0 text-[12px] text-[var(--tile-quiet)]">{['New screen', 'Restyle', 'A state'][k]}</span>
            </div>
          ))}
        </div>
        <div className="flex items-end justify-between gap-6">
          <BigNumber>1</BigNumber>
          <TileText quiet className="max-w-[16rem] text-right">{build.says}</TileText>
        </div>
      </Tile>
      <BentoStep i={1} n={2} name="Review" tip="What the agent decided waits in the Review inbox until you’ve judged it." step={review} short="Confirm what it decided, or fix it in your own words." />
      <BentoStep i={2} n={3} name="Make rules" tip="Rules are saved in DECISIONS.md, and every change after follows them." step={rules} short="Keep the calls that should always hold. They’re saved in DECISIONS.md." />
    </div>
  );
}

/** Review and Make rules: the step's name and icon on top; its number, what it is and where to go at the bottom. */
function BentoStep({ i, n, name, tip, step, short }: { i: number; n: number; name: string; tip: string; step: Step; short: string }) {
  return (
    <Tile i={i} className="group lg:col-span-2">
      <TileHead>
        <TileTitle className="relative z-10" tip={tip}>{name}</TileTitle>
        {step.icon()}
      </TileHead>
      <div className="flex items-end justify-between gap-6">
        <BigNumber>{n}</BigNumber>
        <div className="max-w-[13rem] text-right">
          <TileText quiet>{short}</TileText>
          {step.action ? (
            <a href={step.action.to} className="mt-1.5 inline-flex items-center gap-1 text-[12px] leading-[1.35] after:absolute after:inset-0 after:rounded-[22px]">
              <span className="underline-offset-2 group-hover:underline">{step.action.label}</span>
              <span className="transition-transform duration-150 group-hover:translate-x-0.5 motion-reduce:transition-none">{Small.arrow}</span>
            </a>
          ) : null}
        </div>
      </div>
    </Tile>
  );
}
