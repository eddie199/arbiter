import { useEffect, useState } from 'react';

/**
 * Pages live in the hash — `#/` (Home), `#/overview`, `#/review`, `#/c/C-0001`, `#/rules`, `#/preferences` —
 * so the same files work served by the CLI or opened straight from disk as an export. Filters ride in the
 * hash's query, like the team board's URL: `#/overview?status=approved&section=Settings&view=list&q=tabs`.
 * A decision or rule to land on is `at`. The Overview was `#/` before Home: `#/` with filters still opens it,
 * so a link kept from then lands where it did. An exported copy has no Home, so its `#/` is the Overview.
 */
export type Page = 'home' | 'overview' | 'review' | 'change' | 'rules' | 'preferences';

export interface Route {
  page: Page;
  id: string | null;
  query: URLSearchParams;
}

export function parse(hash: string): Route {
  const raw = hash.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = new URLSearchParams(qs);
  const parts = path.split('/').filter(Boolean);
  if (parts[0] === 'c' && parts[1]) return { page: 'change', id: decodeURIComponent(parts[1]), query };
  if (parts[0] === 'rules' || parts[0] === 'review' || parts[0] === 'preferences' || parts[0] === 'overview') return { page: parts[0], id: null, query };
  return { page: !parts.length && !qs ? 'home' : 'overview', id: null, query };
}

export function useRoute(): Route {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const on = () => setHash(window.location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return parse(hash);
}

/** A link's href: a page by name, or a change by its id. */
export function href(page: 'home' | 'overview' | 'review' | 'rules' | 'preferences' | string, query?: Record<string, string | string[] | undefined>): string {
  const path = page === 'home' ? '/' : page === 'overview' || page === 'rules' || page === 'review' || page === 'preferences' ? `/${page}` : `/c/${encodeURIComponent(page)}`;
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) for (const x of Array.isArray(v) ? v : v ? [v] : []) params.append(k, x);
  const qs = params.toString();
  return `#${path}${qs ? `?${qs}` : ''}`;
}

export const go = (to: string) => { window.location.hash = to.replace(/^#/, ''); };
