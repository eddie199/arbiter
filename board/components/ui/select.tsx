// Copied from the site's hosted/components/ui/select.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { Select as BaseSelect } from '@base-ui-components/react/select';
import { cn } from './cn';

export interface SelectOption { value: string; label: string; hint?: string }

/** A compact select in the toolbar register: label on the left, value on the right, chevron. */
export function Select({ label, value, options, onChange, className }: { label: string; value: string; options: SelectOption[]; onChange: (v: string) => void; className?: string }) {
  const current = options.find((o) => o.value === value);
  return (
    <BaseSelect.Root value={value} onValueChange={(v) => onChange(String(v ?? ''))}>
      <BaseSelect.Trigger className={cn('inline-flex h-8 items-center gap-1.5 rounded-ui border border-border bg-bg px-2.5 text-[13px] text-fg hover:border-border-strong data-[popup-open]:border-fg', className)}>
        <span className="text-muted">{label}</span>
        <BaseSelect.Value className="font-medium">{current?.label ?? 'All'}</BaseSelect.Value>
        <BaseSelect.Icon className="text-faint">
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </BaseSelect.Icon>
      </BaseSelect.Trigger>
      <BaseSelect.Portal>
        <BaseSelect.Positioner sideOffset={6} align="start" alignItemWithTrigger={false}>
          <BaseSelect.Popup className="min-w-44 rounded-lg border border-border bg-bg p-1 shadow-lg transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <BaseSelect.List>
              {options.map((o) => (
                <BaseSelect.Item key={o.value} value={o.value} className="flex h-8 cursor-default select-none items-center justify-between gap-4 rounded-ui px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2">
                  <BaseSelect.ItemText>{o.label}</BaseSelect.ItemText>
                  {o.hint ? <span className="text-faint">{o.hint}</span> : null}
                </BaseSelect.Item>
              ))}
            </BaseSelect.List>
          </BaseSelect.Popup>
        </BaseSelect.Positioner>
      </BaseSelect.Portal>
    </BaseSelect.Root>
  );
}
