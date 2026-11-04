// Copied from the site's hosted/components/ThemeToggle.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { useEffect, useState } from 'react';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';

type Theme = 'light' | 'dark';
const KEY = 'arbiter-theme';

/** Light or dark. Loads light; once you pick, it remembers. */
export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('light');
  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY) as Theme | null;
      const t = saved === 'dark' ? 'dark' : 'light';
      setTheme(t);
      document.documentElement.setAttribute('data-theme', t);
    } catch {}
  }, []);
  const toggle = () => {
    const t: Theme = theme === 'dark' ? 'light' : 'dark';
    setTheme(t);
    document.documentElement.setAttribute('data-theme', t);
    try { localStorage.setItem(KEY, t); } catch {}
  };
  const label = theme === 'dark' ? 'Switch to light' : 'Switch to dark';
  return (
    <TooltipProvider>
      <Tooltip label={label}>
        <button onClick={toggle} aria-label={label} className="flex h-8 w-8 items-center justify-center rounded-ui text-muted hover:bg-surface-2 hover:text-fg">
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="8" cy="8" r="3" /><path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3.05 3.05l1.06 1.06M11.9 11.9l1.06 1.06M3.05 12.95l1.06-1.06M11.9 4.1l1.06-1.06" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z" /></svg>
          )}
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}
