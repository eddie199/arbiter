import { cn } from './cn';
import { Tooltip } from './tooltip';

/**
 * A row in a list of things that happened (DESIGN.md, "List rows"): a round icon for its kind, what
 * happened in one line with where under it, and the time on the right, a dot first when it's new.
 * Rows are divided by hairlines that start after the icon. A row that opens something underlines its
 * words on hover, as every row on the board does; it doesn't tint or move.
 *
 * `tone` colours the icon: `waiting` is the Waiting blue (`info`), `strong` is fg (a new rule),
 * anything else muted.
 */
export function ListRow({ href, icon, tone, what, where, end, fresh, wrap, className, style }: {
  href?: string;
  icon: React.ReactNode;
  tone?: 'waiting' | 'strong';
  what: React.ReactNode;
  where?: React.ReactNode;
  /** The right-hand side: usually the time, in `Faint`. */
  end?: React.ReactNode;
  /** New since you last looked: a small fg dot before the time. */
  fresh?: boolean;
  /** Let the line under wrap instead of cutting it short (Get started's steps). */
  wrap?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const body = (
    <>
      <span className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-surface-2', tone === 'waiting' ? 'text-info' : tone === 'strong' ? 'text-fg' : 'text-muted')}>{icon}</span>
      <span className="flex min-w-0 flex-1 flex-col gap-px">
        <span className={cn('truncate text-[14px] leading-5 underline-offset-2', href && 'group-hover:underline')}>{what}</span>
        {where ? <span className={cn('text-[12px] leading-4 text-muted', !wrap && 'truncate')}>{where}</span> : null}
      </span>
      <span className="flex shrink-0 items-center gap-2 text-[12px] tabular-nums text-faint">
        {fresh ? <Tooltip label="New since you last looked"><span className="h-1.5 w-1.5 rounded-full bg-fg" /></Tooltip> : null}
        {end}
      </span>
    </>
  );
  const cls = cn(
    'group relative flex items-center gap-3 py-2.5',
    // The hairline above every row but the first, from the words to the edge.
    'not-first:before:absolute not-first:before:left-10 not-first:before:right-0 not-first:before:top-0 not-first:before:h-px not-first:before:bg-border',
    className,
  );
  return href ? <a href={href} className={cls} style={style}>{body}</a> : <div className={cls} style={style}>{body}</div>;
}
