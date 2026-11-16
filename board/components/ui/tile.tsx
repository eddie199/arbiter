import { cn } from './cn';
import { Tooltip } from './tooltip';

/**
 * Home's tiles (DESIGN.md, "Home"). Home only: every other page keeps hairline lists and cards.
 *
 * A tile sits in `TileGrid`, squares of about 160px, five across at the board's full width, and spans
 * one or two columns and rows. 22px corners, 16px inside, a light grain over its colour. Grey is the
 * usual; black for the tiles that read as charts; red for Waiting for you alone, the one red fill on
 * the board. Text inside that should be quiet uses `--tile-quiet` (`text-[var(--tile-quiet)]`, or
 * `TileText quiet`): muted on grey, faint on black, white on red.
 */
type Tone = 'grey' | 'black' | 'red';

const TONES: Record<Tone, string> = {
  grey: 'bg-surface-2 text-fg [--grain:.55] [--tile-quiet:var(--muted)]',
  black: 'bg-fg text-bg [--grain:.3] [--tile-quiet:var(--faint)]',
  red: 'bg-brand text-brand-fg [--grain:.28] [--tile-quiet:var(--brand-fg)]',
};

/** Squares of 160px at the board's width (five across, 16px apart), fewer and a little wider or narrower as the page narrows. */
export function TileGrid({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('grid auto-rows-[160px] grid-flow-row-dense grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-4', className)} {...p} />;
}

/**
 * One tile. `i` is its place in reading order, for the settle-in (45ms apart, off with reduced motion).
 * A tile that opens a panel under it is `spill`, so the panel can grow out of it.
 */
export function Tile({ tone = 'grey', cols = 1, rows = 1, i = 0, spill, className, style, ...p }: React.ComponentProps<'div'> & { tone?: Tone; cols?: 1 | 2; rows?: 1 | 2; i?: number; spill?: boolean }) {
  return (
    <div
      style={{ gridColumn: cols > 1 ? `span ${cols}` : undefined, gridRow: rows > 1 ? `span ${rows}` : undefined, ['--i' as string]: i, ...style }}
      className={cn('tile-grain home-tile relative flex flex-col justify-between rounded-[22px] p-4', spill ? 'overflow-visible' : 'overflow-hidden', TONES[tone], className)}
      {...p}
    />
  );
}

/**
 * A tile's title, top left, 12px. `tip` says what the tile shows, on hover or keyboard focus, in the
 * board's black tooltip, so the title is focusable when it has one.
 */
export function TileTitle({ tip, className, children }: { tip?: string; className?: string; children: React.ReactNode }) {
  const title = <p tabIndex={tip ? 0 : undefined} className={cn('flex w-fit items-center gap-1.5 rounded-[4px] text-[12px] leading-[1.35] focus-visible:outline-1 focus-visible:outline-current focus-visible:outline-offset-2', className)}>{children}</p>;
  return tip ? <Tooltip label={tip}>{title}</Tooltip> : title;
}

/** A tile's 12px line: under the big number, or quiet at the top right. `quiet` takes the tile's quiet colour. */
export function TileText({ quiet, className, ...p }: React.HTMLAttributes<HTMLParagraphElement> & { quiet?: boolean }) {
  return <p className={cn('text-[12px] leading-[1.35]', quiet && 'text-[var(--tile-quiet)]', className)} {...p} />;
}

/** A tile's top line: the title on the left, anything quiet on the right. */
export function TileHead({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('flex items-center justify-between gap-2', className)} {...p} />;
}
