// Copied from the site's hosted/components/When.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { useEffect, useState } from 'react';

/**
 * A moment from the record, as `dd/mm/yy · hh:mm` — `dd/mm/yy` alone when the record
 * has only a day. The server renders UTC; after mount it becomes the viewer's own
 * zone. The full ISO sits in the title.
 */
export function When({ iso, className }: { iso: string; className?: string }) {
  const [text, setText] = useState(() => format(iso, true));
  useEffect(() => { setText(format(iso)); }, [iso]);
  return <time dateTime={iso} title={iso} className={className}>{text}</time>;
}

function format(iso: string, utc = false): string {
  const dayOnly = /^\d{4}-\d{2}-\d{2}$/.test(iso);
  const d = new Date(dayOnly ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return iso;
  const zone = dayOnly || utc ? { timeZone: 'UTC' } : {};
  const day = new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit', ...zone }).format(d);
  if (dayOnly) return day;
  const time = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...zone }).format(d);
  return `${day} · ${time}`;
}
