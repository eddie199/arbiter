// Copied from the site's hosted/components/ui/tooltip.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { Tooltip as BaseTooltip } from '@base-ui-components/react/tooltip';

export const TooltipProvider = BaseTooltip.Provider;

export function Tooltip({ label, children }: { label: string; children: React.ReactElement<Record<string, unknown>> }) {
  return (
    <BaseTooltip.Root>
      <BaseTooltip.Trigger render={children} />
      <BaseTooltip.Portal>
        <BaseTooltip.Positioner sideOffset={6} className="z-[60]">
          <BaseTooltip.Popup className="max-w-64 rounded-ui bg-fg px-2 py-1 text-[12px] text-bg shadow-md transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">{label}</BaseTooltip.Popup>
        </BaseTooltip.Positioner>
      </BaseTooltip.Portal>
    </BaseTooltip.Root>
  );
}
