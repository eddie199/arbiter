import { RadioGroup } from '@base-ui-components/react/radio-group';
import { Radio } from '@base-ui-components/react/radio';
import { Tooltip, TooltipProvider } from './tooltip';

/**
 * One of a few choices, side by side, the toolbar's height: Base UI's radio group, so the arrow keys move
 * between them. The chosen one is tinted, in fg; the rest are muted. It wraps on a narrow screen.
 * A choice with a `tip` explains itself on hover or focus; moving along the row, the next one shows at once.
 */
export function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { value: T; label: string; tip?: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <TooltipProvider delay={300}>
      <RadioGroup value={value} onValueChange={(v) => onChange(v as T)} aria-label={label} className="inline-flex max-w-full flex-wrap gap-0.5 rounded-ui border border-border bg-bg p-0.5">
        {options.map((o) => {
          const choice = (
            <Radio.Root key={o.value} value={o.value} className="inline-flex h-[26px] cursor-default items-center rounded-[4px] px-2.5 text-[13px] text-muted outline-none hover:text-fg focus-visible:ring-1 focus-visible:ring-border-strong data-[checked]:bg-surface-2 data-[checked]:text-fg">
              {o.label}
            </Radio.Root>
          );
          return o.tip ? <Tooltip key={o.value} label={o.tip}>{choice}</Tooltip> : choice;
        })}
      </RadioGroup>
    </TooltipProvider>
  );
}
