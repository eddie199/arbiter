import { useEffect, useState } from 'react';
import type { BoardCandidate } from '@/lib/board';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
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
 * screen keeps its id whatever it's called, so it isn't renamed here), Merge into another piece of work it
 * continues, the Review inbox at what's waiting on it, and its name or the command for its picture to paste
 * elsewhere.
 */
export function ChangeMenu({ c, area, short, areas, others, waiting, refresh }: { c: BoardCandidate; area: string; short: string; areas: string[]; others: { name: string; area: string }[]; waiting: number; refresh: () => Promise<void> }) {
  const [renaming, setRenaming] = useState(false);
  const [merging, setMerging] = useState(false);
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
        {c.work && others.length ? <ActionItem icon={Icon.merge} onClick={() => setMerging(true)}>Merge into…</ActionItem> : null}
        {waiting ? <ActionItem icon={Icon.tray} hint={String(waiting)} onClick={() => go(href('review', { at: c.id }))}>Review what’s waiting</ActionItem> : null}
        <ActionItem icon={Icon.copy} onClick={() => copy(c.name, 'Name copied')}>Copy name</ActionItem>
        {c.snapshot ? null : <ActionItem icon={Icon.camera} onClick={() => copy(picture, 'Command copied')}>Copy the picture command</ActionItem>}
      </ActionMenu>
      {c.work ? <RenameDialog open={renaming} onOpenChange={setRenaming} name={c.name} area={area} short={short} areas={areas} refresh={refresh} /> : null}
      {c.work && others.length ? <MergeDialog open={merging} onOpenChange={setMerging} name={c.name} area={area} others={others} refresh={refresh} /> : null}
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
    if (r.exitCode) return setError(errorsOf(r));
    onOpenChange(false);
    await refresh();
    const to = (r.card as { to?: string } | undefined)?.to;
    if (to) go(href(to));
  };

  return (
    // Not closed while it's saving: closed mid-rename, the page would still move to the new name.
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
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

/**
 * Merge into another piece of work: for work started under a new name that continues an existing change.
 * Pick the change it continues (the ones in its own area first). Its decisions take that name, its pictures
 * join that change's in the order they were taken, its comments move, and the agent hears the name. The
 * page moves to the change it joined.
 */
function MergeDialog({ open, onOpenChange, name, area, others, refresh }: { open: boolean; onOpenChange: (o: boolean) => void; name: string; area: string; others: { name: string; area: string }[]; refresh: () => Promise<void> }) {
  const sorted = [...others].sort((a, b) => (a.area === area ? 0 : 1) - (b.area === area ? 0 : 1) || a.name.localeCompare(b.name));
  const [into, setInto] = useState(sorted[0]?.name ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setInto(sorted[0]?.name ?? ''); setError(null); } }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const merge = async () => {
    if (!into) return;
    setBusy(true);
    const r = await post('/api/rename', { from: name, to: into, merge: true });
    setBusy(false);
    if (r.exitCode) return setError(errorsOf(r));
    onOpenChange(false);
    await refresh();
    const to = (r.card as { to?: string } | undefined)?.to;
    if (to) go(href(to));
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent>
        <DialogTitle className="font-semibold tracking-tight">Merge into another change</DialogTitle>
        <DialogDescription className="mt-1.5 text-[13px] text-muted">Use merge when this work is part of another change. It moves everything here into the change you pick.</DialogDescription>
        <div className="mt-4">
          <Select label="Into" value={into} options={sorted.map((o) => ({ value: o.name, label: o.name }))} onChange={setInto} />
        </div>
        <p className="mt-3 text-[13px] text-muted">This page goes away after you merge.</p>
        {error ? <p role="alert" className="mt-2 text-[13px] text-bad">{error}</p> : null}
        <div className="flex justify-end gap-2 pt-5">
          <Button type="button" size="md" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" size="md" variant="primary" onClick={() => void merge()} disabled={busy || !into}>{busy ? 'Merging…' : 'Merge'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
