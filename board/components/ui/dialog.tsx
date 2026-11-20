// Copied from the site's hosted/components/ui/dialog.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { Dialog as BaseDialog } from '@base-ui-components/react/dialog';
import { cn } from './cn';

export const Dialog = BaseDialog.Root;
export const DialogTrigger = BaseDialog.Trigger;
export const DialogClose = BaseDialog.Close;
export const DialogTitle = BaseDialog.Title;
export const DialogDescription = BaseDialog.Description;

export function DialogContent({ className, children, wide, ...props }: Omit<React.ComponentProps<typeof BaseDialog.Popup>, 'className'> & { className?: string; wide?: boolean }) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop className="fixed inset-0 z-40 bg-black/60 transition-opacity data-[ending-style]:opacity-0 data-[starting-style]:opacity-0" />
      <BaseDialog.Popup
        className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[90vh] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-bg shadow-xl transition-all data-[ending-style]:scale-[.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[.98] data-[starting-style]:opacity-0',
          // Wide is a fixed viewport — the image viewer scrolls and zooms inside it, so the frame never jumps.
          wide ? 'flex h-[90vh] w-[min(96vw,1400px)] flex-col overflow-hidden' : 'w-[min(92vw,480px)] overflow-auto p-5',
          className,
        )}
        {...props}
      >
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  );
}
