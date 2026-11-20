import { useEffect, useRef, useState } from 'react';
import { Menu } from '@base-ui-components/react/menu';
import { DOTS, ITEM, ItemLabel, POPUP } from '@/components/ui/menu';
import { Icon } from '@/components/ui/icons';
import type { LocalBoard } from './types';
import { arrangementOf, keyOf, layoutOf, type Entry } from '../src/area-names';
import { errorsOf, post } from './api';
import { href, type Route } from './route';
import { Tooltip } from '@/components/ui/tooltip';
import { saveKeys } from './keys';

/**
 * Areas in the side nav, with folders you make: name one, drag areas into it, drag rows to reorder.
 * The folders are saved in the project (`.arbiter/areas.json`, through the board's server), so
 * teammates and an exported copy see them too. Areas stay automatic; a folder holds them by name, so
 * new work in an area lands in its folder. Everything a drag does, the menus do too: "⋯" on the
 * Areas heading (New folder, Sort A to Z) and on each row, for the keyboard. An exported copy shows the
 * folders and lets you open them, nothing more.
 */

export { layoutOf };
export type { Entry };

type Dragged = { kind: 'area'; name: string } | { kind: 'folder'; id: string };
type Zone = 'before' | 'after' | 'into';
/** Where a drag would land: on a row at the top of the list, or on an area inside a folder. */
type Target = { kind: 'top'; key: string } | { kind: 'inner'; folder: string; name: string };

const low = (s: string) => s.toLowerCase();
const copy = (es: Entry[]): Entry[] => es.map((e) => (e.kind === 'folder' ? { ...e, areas: [...e.areas] } : e));
const newId = () => Math.random().toString(36).slice(2, 10);

/** A folder by its id, with the areas in it that are on the board now: what the Overview shows for it. */
export function folderIn(data: LocalBoard, names: string[], id: string | null): { id: string; name: string; areas: string[] } | null {
  if (!id) return null;
  const f = layoutOf(names, data.arrangement).find((e) => e.kind === 'folder' && e.id === id);
  return f && f.kind === 'folder' ? { id: f.id, name: f.name, areas: f.areas } : null;
}

/** Takes what's dragged out, then puts it where it was dropped. A folder never goes inside a folder. */
function dropped(es: Entry[], what: Dragged, at: Target, zone: Zone): Entry[] {
  if (what.kind === 'folder' && at.kind === 'inner') return es;
  if (at.kind === 'top' && at.key === (what.kind === 'folder' ? `folder:${what.id}` : low(what.name))) return es;
  if (at.kind === 'inner' && what.kind === 'area' && low(at.name) === low(what.name)) return es;
  let next = copy(es);
  let item: Entry;
  if (what.kind === 'area') {
    next = next.filter((e) => !(e.kind === 'area' && low(e.name) === low(what.name)));
    for (const e of next) if (e.kind === 'folder') e.areas = e.areas.filter((a) => low(a) !== low(what.name));
    item = { kind: 'area', name: what.name };
  } else {
    const f = next.find((e) => e.kind === 'folder' && e.id === what.id);
    if (!f) return es;
    next = next.filter((e) => e !== f);
    item = f;
  }
  if (at.kind === 'top') {
    const i = next.findIndex((e) => keyOf(e) === at.key);
    if (i < 0) return es;
    const t = next[i];
    if (zone === 'into' && t.kind === 'folder' && item.kind === 'area') t.areas.push(item.name);
    else next.splice(zone === 'after' ? i + 1 : i, 0, item);
  } else {
    const f = next.find((e) => e.kind === 'folder' && e.id === at.folder);
    if (!f || f.kind !== 'folder' || item.kind !== 'area') return es;
    const j = f.areas.findIndex((a) => low(a) === low(at.name));
    f.areas.splice(j < 0 ? f.areas.length : zone === 'after' ? j + 1 : j, 0, item.name);
  }
  return next;
}

/** An area into a folder, or out of one to sit just under it. */
function movedTo(es: Entry[], area: string, folder: string | null): Entry[] {
  const from = es.find((e) => e.kind === 'folder' && e.areas.some((a) => low(a) === low(area)));
  if (folder) {
    const f = es.find((e) => e.kind === 'folder' && e.id === folder);
    return f ? dropped(es, { kind: 'area', name: area }, { kind: 'top', key: `folder:${folder}` }, 'into') : es;
  }
  return from ? dropped(es, { kind: 'area', name: area }, { kind: 'top', key: keyOf(from) }, 'after') : es;
}

/** One step up or down its own list: the top of Areas, or inside its folder. */
function nudged(es: Entry[], key: string, by: -1 | 1): Entry[] {
  const next = copy(es);
  const swap = <T,>(list: T[], i: number) => {
    const j = i + by;
    if (i < 0 || j < 0 || j >= list.length) return false;
    [list[i], list[j]] = [list[j], list[i]];
    return true;
  };
  if (swap(next, next.findIndex((e) => keyOf(e) === key))) return next;
  for (const e of next) if (e.kind === 'folder' && swap(e.areas, e.areas.findIndex((a) => low(a) === key))) return next;
  return es;
}

const sortedAZ = (es: Entry[]): Entry[] => copy(es)
  .map((e) => (e.kind === 'folder' ? { ...e, areas: [...e.areas].sort((a, b) => a.localeCompare(b)) } : e))
  .sort((a, b) => a.name.localeCompare(b.name));

const OPEN = 'arbiter-folders';
const readOpen = (): Set<string> => { try { return new Set(JSON.parse(localStorage.getItem(OPEN) ?? '[]') as string[]); } catch { return new Set(); } };
const keepOpen = (s: Set<string>) => { try { localStorage.setItem(OPEN, JSON.stringify([...s])); } catch {} };

const Chevron = ({ open }: { open: boolean }) => <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>;

/** "⋯", and a menu under it. Shown on a row's hover or focus, and kept while its menu is open. Named on hover. */
function Dots({ label, tip, className = '', back, children }: { label: string; tip: string; className?: string; back: () => boolean; children: React.ReactNode }) {
  return (
    <Menu.Root>
      <Tooltip label={tip}>
        <Menu.Trigger aria-label={label} className={`flex h-6 w-6 items-center justify-center rounded-ui text-faint hover:bg-surface-2 hover:text-fg data-[popup-open]:bg-surface-2 data-[popup-open]:text-fg ${className}`}>{DOTS}</Menu.Trigger>
      </Tooltip>
      <Menu.Portal>
        <Menu.Positioner sideOffset={4} align="start" className="z-50">
          <Menu.Popup className={POPUP} finalFocus={back}>{children}</Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  );
}

function Item({ onClick, disabled, icon, children }: { onClick: () => void; disabled?: boolean; icon: React.ReactNode; children: React.ReactNode }) {
  return <Menu.Item className={ITEM} onClick={onClick} disabled={disabled}><ItemLabel icon={icon}>{children}</ItemLabel></Menu.Item>;
}

/** A folder's name, typed in place: Enter or clicking away saves, Esc puts it back. */
function NameInput({ value, onDone }: { value: string; onDone: (name: string | null) => void }) {
  const done = useRef(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { const t = setTimeout(() => input.current?.focus(), 0); return () => clearTimeout(t); }, []);
  const finish = (v: string | null) => { if (done.current) return; done.current = true; onDone(v); };
  return (
    <input
      ref={input} autoFocus defaultValue={value} maxLength={60} aria-label="Folder name" placeholder="Folder name"
      onFocus={(e) => e.currentTarget.select()}
      onKeyDown={saveKeys(() => finish(input.current?.value ?? ''), () => finish(null))}
      onBlur={(e) => finish(e.currentTarget.value)}
      className="h-7 min-w-0 flex-1 rounded-ui border border-border-strong bg-bg px-2 text-[14px] text-fg outline-none placeholder:text-faint"
    />
  );
}

export function AreasNav({ data, names, counts, route, view, folded, onFold, refresh }: {
  data: LocalBoard; names: string[]; counts: Map<string, number>; route: Route; view?: string; folded: boolean; onFold: () => void; refresh: () => Promise<void>;
}) {
  const live = data.live;
  const fromData = () => layoutOf(names, data.arrangement);
  const key = JSON.stringify([names, data.arrangement]);
  const [saved, setSaved] = useState<Entry[]>(fromData);
  const [entries, setEntries] = useState<Entry[]>(fromData);
  // What the files say wins, unless you're in the middle of naming a folder.
  const [editing, setEditing] = useState<{ id: string; fresh: boolean } | null>(null);
  const naming = useRef(false);
  const back = () => !naming.current;
  const startNaming = (id: string, fresh: boolean) => { naming.current = true; setEditing({ id, fresh }); };
  useEffect(() => { const e = fromData(); setSaved(e); if (!editing) setEntries(e); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [key]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  useEffect(() => setOpen(readOpen()), []);
  const [error, setError] = useState('');
  const [drag, setDrag] = useState<Dragged | null>(null);
  const [over, setOver] = useState<{ at: string; zone: Zone } | null>(null);

  const onOverview = route.page === 'overview';
  const picked = route.query.getAll('section');
  const section = onOverview && picked.length === 1 ? picked[0] : '';
  const folderOn = onOverview ? route.query.get('folder') : null;
  const isOpen = (id: string) => open.has(id);
  const toggle = (id: string, to?: boolean) => setOpen((s) => {
    const n = new Set(s);
    if (to ?? !n.has(id)) n.add(id); else n.delete(id);
    keepOpen(n);
    return n;
  });
  // The folder holding the area you're on opens, so where you are is in view.
  useEffect(() => {
    if (!section) return;
    const f = entries.find((e) => e.kind === 'folder' && e.areas.some((a) => low(a) === low(section)));
    if (f && f.kind === 'folder' && !open.has(f.id)) toggle(f.id, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [section]);

  const save = async (next: Entry[]) => {
    setError('');
    const before = saved;
    setEntries(next);
    setSaved(next);
    try {
      const r = await post('/api/areas', arrangementOf(next));
      if (r.exitCode !== 0) throw new Error(errorsOf(r));
      // The rest of the page (a folder's title, the phone chips) reads the saved file.
      void refresh();
    } catch (e) {
      setError(`Not saved: ${(e as Error).message}`);
      setEntries(before);
      setSaved(before);
    }
  };

  const newFolder = (withArea?: string) => {
    const id = newId();
    let next = copy(entries);
    if (withArea) {
      next = next.filter((e) => !(e.kind === 'area' && low(e.name) === low(withArea)));
      for (const e of next) if (e.kind === 'folder') e.areas = e.areas.filter((a) => low(a) !== low(withArea));
    }
    setEntries([{ kind: 'folder', id, name: '', areas: withArea ? [withArea] : [] }, ...next]);
    startNaming(id, true);
    toggle(id, true);
  };
  const named = (id: string, name: string | null) => {
    const fresh = editing?.fresh;
    naming.current = false;
    setEditing(null);
    const clean = name?.replace(/\s+/g, ' ').trim() ?? '';
    const was = entries.find((e) => e.kind === 'folder' && e.id === id);
    if (!clean || (!fresh && was?.name === clean)) { setEntries(saved); return; }
    if (entries.some((e) => e.kind === 'folder' && e.id !== id && low(e.name) === low(clean))) {
      setError(`There's already a folder called ${clean}`);
      setEntries(saved);
      return;
    }
    void save(entries.map((e) => (e.kind === 'folder' && e.id === id ? { ...e, name: clean } : e)));
  };
  const removeFolder = (id: string) => void save(entries.flatMap((e) => (e.kind === 'folder' && e.id === id ? e.areas.map((name) => ({ kind: 'area' as const, name })) : [e])));

  const folders = entries.filter((e): e is Extract<Entry, { kind: 'folder' }> => e.kind === 'folder');
  const hasFolders = folders.length > 0;
  const activeInside = !!section || !!folderOn;
  const dragging = !!drag;

  // Where a drag over a row would land: on a folder's middle it goes in; otherwise above or below.
  const zoneOf = (e: React.DragEvent, intoAllowed: boolean): Zone => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    if (intoAllowed && y > 0.25 && y < 0.75) return 'into';
    return y < 0.5 ? 'before' : 'after';
  };
  const dragProps = (what: Dragged) => (live ? {
    draggable: true,
    onDragStart: (e: React.DragEvent) => { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', what.kind === 'area' ? what.name : what.id); setDrag(what); },
    onDragEnd: () => { setDrag(null); setOver(null); },
  } : {});
  const dropProps = (at: Target, id: string, intoAllowed: boolean) => (live ? {
    onDragOver: (e: React.DragEvent) => {
      if (!drag || (drag.kind === 'folder' && at.kind === 'inner')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const zone = zoneOf(e, intoAllowed && drag.kind === 'area');
      if (over?.at !== id || over.zone !== zone) setOver({ at: id, zone });
    },
    onDragLeave: (e: React.DragEvent) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver((o) => (o?.at === id ? null : o)); },
    onDrop: (e: React.DragEvent) => {
      e.preventDefault();
      const zone = over?.at === id ? over.zone : 'before';
      const what = drag;
      setDrag(null);
      setOver(null);
      if (!what) return;
      const next = dropped(entries, what, at, zone);
      if (next === entries) return;
      if (zone === 'into' && at.kind === 'top') toggle(at.key.slice(7), true);
      void save(next);
    },
  } : {});
  const mark = (id: string) => (over?.at !== id ? '' : over.zone === 'before' ? 'shadow-[inset_0_2px_0_0_var(--fg)]' : over.zone === 'after' ? 'shadow-[inset_0_-2px_0_0_var(--fg)]' : 'bg-surface-2 ring-1 ring-inset ring-border-strong');

  const row = (on: boolean) => `flex h-8 items-center justify-between -ml-px rounded-r-ui border-l transition-colors ${on ? 'border-fg bg-surface-2 text-fg' : 'border-transparent text-muted hover:bg-surface-2 hover:text-fg'}`;
  const hint = (n: number | undefined, on: boolean) => (n ? <span className={`text-[12px] tabular-nums ${on ? 'text-muted' : 'text-faint'}`}>{n}</span> : null);
  const rowDots = 'absolute right-1 top-1 bg-surface-2 opacity-0 group-hover/row:opacity-100 focus-visible:opacity-100 data-[popup-open]:opacity-100';

  const areaRow = (name: string, inFolder: string | null, list: string[], index: number) => {
    const on = section === name;
    const id = inFolder ? `${inFolder}/${low(name)}` : low(name);
    const at: Target = inFolder ? { kind: 'inner', folder: inFolder, name } : { kind: 'top', key: low(name) };
    return (
      <li key={id} className={`group/row relative ${drag?.kind === 'area' && low(drag.name) === low(name) ? 'opacity-40' : ''}`} {...dropProps(at, id, false)}>
        <a href={href('overview', { section: name, view })} aria-current={on ? 'page' : undefined} {...dragProps({ kind: 'area', name })}
          className={`${row(on)} ${mark(id)} gap-2 pr-2.5 ${hasFolders ? 'pl-[26px]' : 'pl-2.5'}`}>
          <span className="truncate">{name}</span>
          {hint(counts.get(name), on)}
        </a>
        {live ? (
          <Dots label={`${name}: options`} tip="Move to a folder and more" className={rowDots} back={back}>
            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger className={ITEM}><ItemLabel icon={Icon.moveTo}>Move to</ItemLabel><Chevron open={false} /></Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner sideOffset={4} alignOffset={-4} className="z-50">
                  <Menu.Popup className={POPUP} finalFocus={back}>
                    {folders.filter((f) => f.id !== inFolder).map((f) => <Item key={f.id} icon={Icon.folder} onClick={() => { toggle(f.id, true); void save(movedTo(entries, name, f.id)); }}>{f.name}</Item>)}
                    {inFolder ? <Item icon={Icon.moveOut} onClick={() => void save(movedTo(entries, name, null))}>Out of the folder</Item> : null}
                    <Item icon={Icon.folderPlus} onClick={() => newFolder(name)}>New folder…</Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>
            <Item icon={Icon.up} disabled={index === 0} onClick={() => void save(nudged(entries, low(name), -1))}>Move up</Item>
            <Item icon={Icon.down} disabled={index === list.length - 1} onClick={() => void save(nudged(entries, low(name), 1))}>Move down</Item>
          </Dots>
        ) : null}
      </li>
    );
  };

  return (
    <div className="mt-2">
      <div className="mb-1 flex h-7 items-center rounded-ui hover:bg-surface-2">
        <button type="button" onClick={onFold} aria-expanded={!folded} className="flex h-7 min-w-0 flex-1 items-center gap-1 px-2.5 text-[12px] text-faint hover:text-muted">
          <Chevron open={!folded} />
          <span>Areas</span>
          {folded && activeInside ? <Tooltip label="Current page is in here"><span className="ml-auto h-1.5 w-1.5 rounded-full bg-fg" /></Tooltip> : null}
        </button>
        {live ? (
          <Dots label="Areas: options" tip="New folder and more" className="mr-0.5" back={back}>
            <Item icon={Icon.folderPlus} onClick={() => { if (folded) onFold(); newFolder(); }}>New folder</Item>
            <Item icon={Icon.sort} onClick={() => void save(sortedAZ(entries))}>Sort A to Z</Item>
          </Dots>
        ) : null}
      </div>
      {folded ? null : (
        <ul className="ml-3 space-y-0.5 border-l border-border">
          {entries.map((e, i) => {
            if (e.kind === 'area') return areaRow(e.name, null, entries.map(keyOf), i);
            // A read-only copy has only decided work, so a folder whose areas are all still waiting is empty
            // there; it isn't listed. On the live board an empty folder stays, to drag areas into.
            if (!live && !e.areas.some((a) => counts.get(a))) return null;
            const id = `folder:${e.id}`;
            const on = folderOn === e.id;
            const count = e.areas.reduce((n, a) => n + (counts.get(a) ?? 0), 0);
            const opened = isOpen(e.id) || (dragging && over?.at === id && over.zone === 'into');
            return (
              <li key={id} className={drag?.kind === 'folder' && drag.id === e.id ? 'opacity-40' : ''}>
                <div className={`group/row relative ${row(on)} ${mark(id)} pr-2.5`} {...dropProps({ kind: 'top', key: id }, id, true)}>
                  <Tooltip label={opened ? 'Close folder' : 'Open folder'}>
                    <button type="button" onClick={() => toggle(e.id)} aria-expanded={opened} aria-label={`${opened ? 'Close' : 'Open'} ${e.name || 'folder'}`} className="flex h-8 w-[26px] shrink-0 items-center justify-center text-faint hover:text-fg">
                      <Chevron open={opened} />
                    </button>
                  </Tooltip>
                  {editing?.id === e.id ? <NameInput value={e.name} onDone={(n) => named(e.id, n)} /> : <>
                    <a href={href('overview', { folder: e.id, view })} aria-current={on ? 'page' : undefined} {...dragProps({ kind: 'folder', id: e.id })} className="flex h-8 min-w-0 flex-1 items-center pr-2">
                      <span className="truncate">{e.name}</span>
                    </a>
                    {hint(count, on)}
                    {live ? (
                      <Dots label={`${e.name} folder: options`} tip="Rename and more" className={rowDots} back={back}>
                        <Item icon={Icon.pencil} onClick={() => startNaming(e.id, false)}>Rename</Item>
                        <Item icon={Icon.up} disabled={i === 0} onClick={() => void save(nudged(entries, id, -1))}>Move up</Item>
                        <Item icon={Icon.down} disabled={i === entries.length - 1} onClick={() => void save(nudged(entries, id, 1))}>Move down</Item>
                        <Item icon={Icon.folderMinus} onClick={() => removeFolder(e.id)}>Remove folder</Item>
                      </Dots>
                    ) : null}
                  </>}
                </div>
                {opened ? (
                  <ul className="ml-[13px] mt-0.5 space-y-0.5 border-l border-border">
                    {e.areas.map((a, j) => areaRow(a, e.id, e.areas, j))}
                    {!e.areas.length ? <li className="flex h-8 items-center px-2.5 text-[12px] text-faint">{live ? 'Drag areas here' : 'Empty'}</li> : null}
                  </ul>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {error ? <p role="alert" className="mt-1 px-1.5 text-[12px] text-bad">{error}</p> : null}
    </div>
  );
}
