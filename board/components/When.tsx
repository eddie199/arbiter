/**
 * Dates, one way across the whole board. A day reads the way people say it: Today, Yesterday, 3 days ago,
 * then the date ("4 Nov", with the year only when it isn't this one). A time of day is in the viewer's own
 * clock. The exact date and time show on hover.
 *
 * A record that has only a day ("2026-09-18", a rule's date) is that calendar day wherever you are, so it's
 * read as a local date, not as midnight in London.
 */

import { Tooltip } from '@/components/ui/tooltip';

const DAY_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parse(iso: string): Date | null {
  const m = DAY_ONLY.exec(iso) ? iso.split('-').map(Number) : null;
  const d = m ? new Date(m[0], m[1] - 1, m[2]) : new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Today, Yesterday, 3 days ago, then "4 Nov" ("4 Nov 2025" in another year). */
export function dayWords(iso: string, now = new Date()): string {
  const d = parse(iso);
  if (!d) return '';
  const days = Math.round((new Date(now.toDateString()).getTime() - new Date(d.toDateString()).getTime()) / 864e5);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days > 1 && days < 7) return `${days} days ago`;
  return fullDate(iso, d.getFullYear() !== now.getFullYear());
}

/** "4 Nov", or "4 Nov 2026" with `year`. */
export function fullDate(iso: string, year = true): string {
  const d = parse(iso);
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', ...(year ? { year: 'numeric' } : {}) }) : iso;
}

/** The time of day, in the viewer's own clock: "5:39 pm" or "17:39". */
export const clock = (d: Date): string => d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** For the hover: the whole date, and the time when the record has one. */
function exact(iso: string): string {
  const d = parse(iso);
  if (!d) return iso;
  const day = d.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  return DAY_ONLY.test(iso) ? day : `${day}, ${clock(d)}`;
}

/**
 * When something happened, in the board's one way. `time` adds the time of day, for a page about one
 * thing (a change's own page); lists show the day alone.
 */
export function When({ iso, time = false, className }: { iso: string; time?: boolean; className?: string }) {
  const d = parse(iso);
  if (!d) return <span className={className}>{iso}</span>;
  const text = time && !DAY_ONLY.test(iso) ? `${dayWords(iso)}, ${clock(d)}` : dayWords(iso);
  return <Tooltip label={exact(iso)}><time dateTime={iso} className={className}>{text}</time></Tooltip>;
}
