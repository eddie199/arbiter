// Copied from the site's hosted/components/ui/type.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
import { cn } from './cn';

/**
 * The board's type system — the same hierarchy as the marketing page.
 * Hierarchy comes from colour and size, not weight jumps:
 *
 *   PageTitle     22px · semibold · tight         the one thing this page is about
 *   Lede          15px · regular · muted          one sentence under the title
 *   SectionTitle  15px · semibold · tight         "Decided here"; counts in regular muted
 *   Label         13px · regular · muted          the left column of any key/value
 *   value         14px · regular · fg             (plain text, no class)
 *   Meta          13px · regular · muted          who · when · where
 *   Id            12px · mono · muted             D-0017, C-0004
 *   Faint         12px · regular · faint          the least important thing on the line
 *   BigNumber     48px · light · tight            Home only: the figure a tile is about
 *
 * Categories (dimension, status, verdict) are Badges, Title case. Nothing is uppercase.
 * One exception to two weights: a decision's Change line is medium. And one on Home only: its big
 * numbers are light (300), recorded on the PC as D-0033.
 * Use these instead of writing sizes by hand so every board page reads the same.
 */

export function PageTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h1 className={cn('text-[22px] font-semibold tracking-tight', className)} {...p} />;
}

export function Lede({ className, ...p }: React.HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn('mt-1.5 text-[15px] text-muted', className)} {...p} />;
}

/** `count` renders after the title in regular muted; `aside` after that, fainter. */
export function SectionTitle({ children, count, aside, className, ...p }: React.HTMLAttributes<HTMLHeadingElement> & { count?: number | string | null; aside?: React.ReactNode }) {
  return (
    <h2 className={cn('mb-3 text-[15px] font-semibold tracking-tight', className)} {...p}>
      {children}
      {count != null && count !== '' ? <span className="font-normal text-muted"> · {count}</span> : null}
      {aside ? <span className="font-normal text-faint"> · {aside}</span> : null}
    </h2>
  );
}

export function Label({ className, ...p }: React.HTMLAttributes<HTMLElement>) {
  return <dt className={cn('text-[13px] text-muted', className)} {...p} />;
}

export function Meta({ className, ...p }: React.HTMLAttributes<HTMLElement>) {
  return <span className={cn('text-[13px] text-muted', className)} {...p} />;
}

export function Id({ className, ...p }: React.HTMLAttributes<HTMLElement>) {
  return <span className={cn('font-mono text-xs text-muted', className)} {...p} />;
}

export function Faint({ className, ...p }: React.HTMLAttributes<HTMLElement>) {
  return <span className={cn('text-xs text-faint', className)} {...p} />;
}

/**
 * Home only: the figure a tile is about, 48px light, tight and tabular. A unit sits beside it small, in
 * the tile's quiet colour: `<BigNumber unit="fix">1</BigNumber>`, or `<Unit>` inside for "1h 34m".
 */
export function BigNumber({ children, unit, className, ...p }: React.HTMLAttributes<HTMLSpanElement> & { unit?: React.ReactNode }) {
  return (
    <span className={cn('block whitespace-nowrap text-[48px] font-light leading-none tracking-[-0.04em] tabular-nums', className)} {...p}>
      {children}{unit != null ? <Unit>{unit}</Unit> : null}
    </span>
  );
}

/** A big number's unit: 20px, its tracking back to normal, in the tile's quiet colour. */
export function Unit({ className, ...p }: React.HTMLAttributes<HTMLSpanElement>) {
  return <span className={cn('ml-0.5 text-[20px] tracking-normal text-[var(--tile-quiet,var(--muted))]', className)} {...p} />;
}

/** Key/value rows: a fixed label column, values in fg. The shape of every decision and every properties block. */
export function KeyValues({ className, children, cols = '6rem' }: { className?: string; children: React.ReactNode; cols?: string }) {
  return <dl className={cn('grid gap-x-3 gap-y-1.5 text-[14px]', className)} style={{ gridTemplateColumns: `${cols} minmax(0, 1fr)` }}>{children}</dl>;
}

/** Inline key/value pairs across one line — the properties row under a page title. */
export function PropertyRow({ className, children }: { className?: string; children: React.ReactNode }) {
  return <dl className={cn('mt-4 flex flex-wrap items-center gap-x-8 gap-y-2 text-[13px]', className)}>{children}</dl>;
}
export function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="flex items-center gap-2"><Label>{label}</Label><dd className="flex items-center gap-1.5">{children}</dd></div>;
}
