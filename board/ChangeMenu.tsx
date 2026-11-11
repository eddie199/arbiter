import { useEffect, useState } from 'react';
import type { BoardCandidate } from '@/lib/board';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ActionItem, ActionMenu, barDots, DOTS } from '@/components/ui/menu';
import { Icon } from '@/components/ui/icons';
import { Faint } from '@/components/ui/type';
import { errorsOf, post } from './api';
import { go, href } from './route';

/** A change's name from its area and title, the way the board files it: "Review inbox — Sorting". */
export const nameOf = (area: string, title: string): string => {
  const a = area.trim().replace(/\s+/g, ' ');
  const t = title.trim().replace(/\s+/g, ' ');
  return !a || !t || a.toLowerCase() === t.toLowerCase() ? a || t : `${a} — ${t}`;
};

/**
 * "⋯" beside a change's title, the toolbar's height, live board only. Rename (a piece of work: an option
 * screen keeps its id whatever it's called, so it isn't renamed here), the Review inbox at what's waiting
 * on it, and its name or the command for its picture to paste elsewhere.
 */
export function ChangeMenu({ c, area, short, areas, waiting, refresh }: { c: BoardCandidate; area: string; short: string; areas: string[]; waiting: number; refresh: () => Promise<void> }) {
  const [renaming, setRenaming] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const copy = (text: string, done: string) => {
    void navigator.clipboard?.writeText(text).then(() => { setNote(done); setTimeout(() => setNote(null), 1500); }).catch(() => {});
  };
  const picture = c.work ? `npx arbiter snapshot ${JSON.stringify(c.name)} --file shot.png` : `npx arbiter candidate ${c.id} --snapshot shot.png`;
  return (
    <div className="flex shrink-0 items-center gap-2 pt-0.5">
      {note ? <Faint aria-live="polite">{note}</Faint> : null}
      <ActionMenu label="Change options" tip="Rename and more" className={barDots} trigger={DOTS}>
        {c.work ? <ActionItem icon={Icon.pencil} onClick={() => setRenaming(true)}>Rename</ActionItem> : null}
        {waiting ? <ActionItem icon={Icon.tray} hint={String(waiting)} onClick={() => go(href('review', { at: c.id }))}>Review what’s waiting</ActionItem> : null}
        <ActionItem icon={Icon.copy} onClick={() => copy(c.name, 'Name copied')}>Copy name</ActionItem>
        {c.snapshot ? null : <ActionItem icon={Icon.camera} onClick={() => copy(picture, 'Command copied')}>Copy the picture command</ActionItem>}
      </ActionMenu>
      {c.work ? <RenameDialog open={renaming} onOpenChange={setRenaming} name={c.name} area={area} short={short} areas={areas} refresh={refresh} /> : null}
    </div>
  );
}

/**
 * Rename a piece of work: its area, picked from the ones there or typed, and its title. Saved as
 * "Area — Title", so nobody types the dash. Its decisions, picture, waiting items and comments move with
 * it, the agent hears the new name, and the page moves to the new address.
 */
function RenameDialog({ open, onOpenChange, name, area, short, areas, refresh }: { open: boolean; onOpenChange: (o: boolean) => void; name: string; area: string; short: string; areas: string[]; refresh: () => Promise<void> }) {
  const [a, setA] = useState(area);
  const [t, setT] = useState(short === area ? '' : short);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setA(area);
    setT(short === area ? '' : short);
    setError(null);
  }, [open, area, short]);
  const next = nameOf(a, t);
  const same = next === name;

  const save = async () => {
    if (!next || same) return;
    setBusy(true);
    const r = await post('/api/rename', { from: name, to: next });
    setBusy(false);
    if (r.exitCode) { const e = errorsOf(r); setError(e.charAt(0).toUpperCase() + e.slice(1)); return; }
    onOpenChange(false);
    await refresh();
    const to = (r.card as { to?: string } | undefined)?.to;
    if (to) go(href(to));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogTitle className="font-semibold tracking-tight">Rename</DialogTitle>
        <DialogDescription className="mt-1.5 text-[13px] text-muted">Its decisions, picture and comments move with it, and the agent uses the new name from now on.</DialogDescription>
        <form className="mt-4 space-y-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <div>
            <label htmlFor="rename-area" className="block text-[13px] text-muted">Area</label>
            <Input id="rename-area" aria-label="Area" list="rename-areas" value={a} onChange={(e) => { setA(e.target.value); setError(null); }} className="mt-1.5" autoComplete="off" />
            <datalist id="rename-areas">{areas.map((x) => <option key={x} value={x} />)}</datalist>
          </div>
          <div>
            <label htmlFor="rename-title" className="block text-[13px] text-muted">Title</label>
            <Input id="rename-title" aria-label="Title" value={t} onChange={(e) => { setT(e.target.value); setError(null); }} className="mt-1.5" autoComplete="off" autoFocus />
          </div>
          <p className="text-[13px] text-muted">Saved as <span className="text-fg">{next || '…'}</span></p>
          {error ? <p role="alert" className="text-[13px] text-bad">{error}</p> : null}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" size="md" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
            <Button type="submit" size="md" variant="primary" disabled={busy || !next || same}>{busy ? 'Renaming…' : 'Rename'}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
