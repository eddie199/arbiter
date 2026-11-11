// Copied from the site's hosted/components/ui/multi-select.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { Menu as BaseMenu } from '@base-ui-components/react/menu';
import { cn } from './cn';

type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'neutral';
export interface MultiOption { value: string; label: string; hint?: string; tone?: Tone }

const DOT: Record<Tone, string> = { ok: 'bg-ok', warn: 'bg-warn', bad: 'bg-bad', info: 'bg-info', neutral: 'bg-faint' };
const PILL: Record<Tone, string> = { ok: 'bg-ok-bg text-ok', warn: 'bg-warn-bg text-warn', bad: 'bg-bad-bg text-bad', info: 'bg-surface-2 text-info', neutral: 'bg-surface-2 text-fg' };

/**
 * A filter that takes several values: label and what's chosen on the trigger, a checklist in the
 * menu that stays open while you tick. Every filter looks the same as Sort beside it: the label in
 * grey, what's chosen after it. `icon` puts a filter mark in front, for a page whose one filter is it
 * (Design rules' Type).
 */
export function MultiSelect({ label, values, options, onChange, icon }: { label: string; values: string[]; options: MultiOption[]; onChange: (v: string[]) => void; icon?: boolean }) {
  const chosen = options.filter((o) => values.includes(o.value));
  const summary = !chosen.length ? 'All' : chosen.length === 1 ? chosen[0].label : `${chosen.length} selected`;
  const toggle = (v: string, on: boolean) => onChange(on ? [...values, v] : values.filter((x) => x !== v));
  return (
    <BaseMenu.Root>
      <BaseMenu.Trigger
        className={cn(
          'inline-flex h-8 items-center gap-1.5 rounded-ui border border-border bg-bg px-2.5 text-[13px] text-fg hover:border-border-strong data-[popup-open]:border-fg',
        )}
      >
        {icon ? <svg width="13" height="13" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="text-muted"><path d="M1.5 2.5h11l-4.25 5v4l-2.5 1.25V7.5z" /></svg> : null}
        <span className="text-muted">{label}</span>
        <span className="font-medium">{summary}</span>
        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className="text-faint"><path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
      </BaseMenu.Trigger>
      <BaseMenu.Portal>
        <BaseMenu.Positioner sideOffset={6} align="start">
          <BaseMenu.Popup className="min-w-48 rounded-lg border border-border bg-bg p-1 shadow-lg transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            {options.map((o) => (
              <BaseMenu.CheckboxItem
                key={o.value}
                checked={values.includes(o.value)}
                onCheckedChange={(on) => toggle(o.value, on)}
                closeOnClick={false}
                className="group flex h-8 cursor-default select-none items-center gap-2 rounded-ui px-2 text-[13px] text-fg outline-none data-[highlighted]:bg-surface-2"
              >
                <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[4px] border border-border-strong group-data-[checked]:border-fg group-data-[checked]:bg-fg">
                  <BaseMenu.CheckboxItemIndicator className="text-bg">
                    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 5.25 4.1 7.3 8 2.8" /></svg>
                  </BaseMenu.CheckboxItemIndicator>
                </span>
                {o.tone ? <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[o.tone])} aria-hidden="true" /> : null}
                <span className="flex-1">{o.label}</span>
                {o.hint ? <span className="text-faint">{o.hint}</span> : null}
              </BaseMenu.CheckboxItem>
            ))}
          </BaseMenu.Popup>
        </BaseMenu.Positioner>
      </BaseMenu.Portal>
    </BaseMenu.Root>
  );
}

/** One chosen value, shown under the filters: say what it is, click × to drop it. */
export function FilterPill({ label, prefix, tone = 'neutral', onRemove }: { label: string; prefix?: string; tone?: Tone; onRemove: () => void }) {
  return (
    <span className={cn('inline-flex h-7 items-center gap-1 rounded-full pl-2.5 pr-1 text-[13px]', PILL[tone])}>
      {prefix ? <span className="opacity-70">{prefix}</span> : null}
      <span className="font-medium">{label}</span>
      <button type="button" onClick={onRemove} aria-label={`Remove ${prefix ? `${prefix} ` : ''}${label}`} title="Remove" className="ml-0.5 flex h-5 w-5 items-center justify-center rounded-full hover:bg-fg/10">
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" /></svg>
      </button>
    </span>
  );
}
