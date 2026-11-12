import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';

/**
 * Remove, confirmed in a dialog: what it removes and what happens, then Remove or Cancel. A rule asks why
 * first (the reason is what the history keeps), so Remove waits for one; Enter in the box removes.
 */
export function RemoveDialog({ open, onOpenChange, title, body, why, onWhy, busy, error, onRemove }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  title: string;
  body: string;
  /** Present when it asks why: the reason typed so far. */
  why?: string;
  onWhy?: (s: string) => void;
  busy: boolean;
  error: string | null;
  onRemove: () => void;
}) {
  const asks = why !== undefined;
  const ready = !asks || !!why.trim();
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogTitle className="font-semibold tracking-tight">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-[13px] text-muted">{body}</DialogDescription>
        {asks ? (
          <Textarea autoFocus aria-label="Why it’s removed" value={why} placeholder="One line" rows={2} className="mt-4 min-h-14"
            onChange={(e) => onWhy?.(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); if (ready && !busy) onRemove(); } }} />
        ) : null}
        {error ? <p role="alert" className="mt-3 text-[13px] text-bad">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button size="md" variant="ghost" type="button" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button size="md" variant="danger" type="button" onClick={onRemove} disabled={busy || !ready}>{busy ? 'Removing…' : 'Remove'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
