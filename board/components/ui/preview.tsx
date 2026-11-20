// Copied from the site's hosted/components/ui/preview.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { PreviewCard } from '@base-ui-components/react/preview-card';

/** Hover a thumbnail, see the screen. Opens after a short delay; the trigger stays a plain element. */
export function ImagePreview({ src, alt, children }: { src: string; alt: string; children: React.ReactElement<Record<string, unknown>> }) {
  return (
    <PreviewCard.Root>
      <PreviewCard.Trigger render={children} delay={250} closeDelay={80} />
      <PreviewCard.Portal>
        <PreviewCard.Positioner side="right" sideOffset={12} align="start" collisionPadding={16}>
          <PreviewCard.Popup className="w-[min(476px,55vw)] overflow-hidden rounded-lg border border-border bg-bg shadow-xl transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0">
            <img src={src} alt={alt} className="block h-auto w-full" />
          </PreviewCard.Popup>
        </PreviewCard.Positioner>
      </PreviewCard.Portal>
    </PreviewCard.Root>
  );
}
