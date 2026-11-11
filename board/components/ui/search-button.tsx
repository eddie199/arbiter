import { useEffect, useState } from 'react';
import { Input } from './input';
import { Tooltip } from './tooltip';

const SEARCH = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><circle cx="6.25" cy="6.25" r="4.25" /><path d="m9.5 9.5 3 3" /></svg>;

/**
 * Search as a square icon button, the toolbar's height, like the "⋯" beside the views. Clicking it opens
 * a field in its place; Enter searches, Esc clears and closes it, and leaving it empty closes it. While a
 * search is on, the field stays open with what was searched, so it's clear the list is narrowed.
 */
export function SearchButton({ value, placeholder, label, onSearch }: { value: string; placeholder: string; label: string; onSearch: (q: string) => void }) {
  const [open, setOpen] = useState(!!value);
  const [text, setText] = useState(value);
  useEffect(() => { setText(value); if (value) setOpen(true); }, [value]);

  if (!open) {
    return (
      <Tooltip label={label}>
      <button type="button" aria-label={label} onClick={() => setOpen(true)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-ui border border-border bg-bg text-muted hover:border-border-strong hover:text-fg">
        {SEARCH}
      </button>
      </Tooltip>
    );
  }
  const close = () => { setText(''); if (value) onSearch(''); setOpen(false); };
  return (
    <form onSubmit={(e) => { e.preventDefault(); onSearch(text.trim()); }} className="relative w-56 shrink-0" role="search">
      <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint">{SEARCH}</span>
      <Input
        autoFocus value={text} placeholder={placeholder} aria-label={label} className="pl-8"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); close(); } }}
        onBlur={() => { if (!text.trim() && !value) setOpen(false); }}
      />
    </form>
  );
}
