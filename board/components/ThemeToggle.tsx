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
        {/* The same size as the bar's other icon buttons and its sm buttons (28px), and drawn like its
            refresh icon: a 24 grid and a 1.5px line at 16px. The moon has 12px of ink like the refresh
            icon; the sun's thin rays reach a little further, so it reads the same size. */}
        <button onClick={toggle} aria-label={label} className="flex h-7 w-7 items-center justify-center rounded-ui text-muted hover:bg-surface-2 hover:text-fg">
          {theme === 'dark' ? (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
          )}
        </button>
      </Tooltip>
    </TooltipProvider>
  );
}
