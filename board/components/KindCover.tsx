// Copied from the site's hosted/components/KindCover.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
import { DIMENSION_LABEL, type BoardDecision } from '@/lib/board';

/**
 * What stands in the picture frame when a change has no screenshot — a copy change, a font, a
 * motion curve, a focus order. An icon and the kind of change, so the grid keeps one card shape
 * and a text-only change doesn't read as a missing picture.
 */

// One mark per dimension, drawn like the rest of the board's icons: 24px box, 1.5 stroke.
const MARKS: Record<string, string> = {
  structure: 'M4 4h16v16H4zM4 10h16M10 10v10',
  interaction: 'M6 3l13 7.5-5.8 1.6L10.5 18z',
  states: 'M12 4l8 4-8 4-8-4zM4 12l8 4 8-4M4 16l8 4 8-4',
  content: 'M4 6h16M4 11h16M4 16h10',
  visual: 'M12 3.5c3 4 6 6.8 6 10.5a6 6 0 0 1-12 0c0-3.7 3-6.5 6-10.5z',
  motion: 'M3 12c3-6.5 6-6.5 9 0s6 6.5 9 0',
  access: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 7.5v.01M8 10h8M12 10v4l-2.5 4M12 14l2.5 4',
};
const CHANGE = 'M5 5h14v14H5zM9 12h6';

/** The kind of change a card is: its most common dimension, the first one on a tie. */
export function kindOf(decisions: Pick<BoardDecision, 'dimension'>[]): string | null {
  const count = new Map<string, number>();
  for (const d of decisions) if (d.dimension) count.set(d.dimension, (count.get(d.dimension) ?? 0) + 1);
  let best: string | null = null;
  for (const [dim, n] of count) if (!best || n > count.get(best)!) best = dim;
  return best;
}

function Mark({ kind, size }: { kind: string | null; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={(kind && MARKS[kind]) || CHANGE} />
    </svg>
  );
}

/**
 * The full cover, for a card's picture frame. With nothing decided on it yet there's no kind to
 * name: an option is a layout someone explored, so it shows as one; a plain change is just a change.
 */
export function KindCover({ decisions, option }: { decisions: Pick<BoardDecision, 'dimension'>[]; option?: boolean }) {
  const kind = kindOf(decisions) ?? (option ? 'structure' : null);
  const label = kindOf(decisions) ? DIMENSION_LABEL[kind!] ?? kind : option ? 'Option' : 'Change';
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
      <Mark kind={kind} size={26} />
      <span className="text-[13px]">{label}</span>
    </div>
  );
}

/** The mark alone, for a list row's thumbnail. */
export function KindThumb({ decisions, className }: { decisions: Pick<BoardDecision, 'dimension'>[]; className: string }) {
  return <div className={`${className} flex items-center justify-center text-muted`}><Mark kind={kindOf(decisions)} size={16} /></div>;
}
