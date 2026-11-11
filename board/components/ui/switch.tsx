import { useId } from 'react';
import { Switch as BaseSwitch } from '@base-ui-components/react/switch';
import { Tooltip } from './tooltip';

/**
 * On or off, with its words beside it: Base UI's switch inside a label, so clicking the words flips it too,
 * and the words are its name to a screen reader. On is fg, off is the strong border colour.
 * A `tip` explains it on hover over the switch or its words, or on focus.
 */
export function Switch({ checked, onChange, tip, children }: { checked: boolean; onChange: (on: boolean) => void; tip?: string; children: React.ReactNode }) {
  const id = useId();
  const control = (
    <label className="inline-flex cursor-pointer items-center gap-2.5 text-[14px]">
      <BaseSwitch.Root aria-labelledby={id} checked={checked} onCheckedChange={(on) => onChange(on)} className="relative inline-flex h-[18px] w-8 shrink-0 items-center rounded-full bg-border-strong p-0.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-border-strong focus-visible:ring-offset-1 focus-visible:ring-offset-bg data-[checked]:bg-fg">
        <BaseSwitch.Thumb className="block h-3.5 w-3.5 rounded-full bg-bg transition-transform data-[checked]:translate-x-3.5" />
      </BaseSwitch.Root>
      <span id={id}>{children}</span>
    </label>
  );
  return tip ? <Tooltip label={tip}>{control}</Tooltip> : control;
}
