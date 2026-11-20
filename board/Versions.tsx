import { useRef, useState } from 'react';
import type { BoardVersion } from '../src/board-types';
import { Button } from '@/components/ui/button';
import { Dialog, DialogClose, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { Faint, Meta } from '@/components/ui/type';
import { Screenshot } from '@/components/Screenshot';
import { clock, dayWords } from '@/components/When';

/** "9 Nov, 5:39 pm", the way a change's page gives a time. */
export const takenAt = (v: BoardVersion) => (v.date ? `${dayWords(v.date)}, ${clock(new Date(v.date))}` : 'Now');

/**
 * A change's pictures, under the big one: a small thumbnail for each, oldest first, the one showing
 * outlined. Clicking one shows it above. Compare opens the before and after slider. Only for a change
 * that has had more than one picture.
 */
export function VersionRow({ versions, shown, onShow }: { versions: BoardVersion[]; shown: number; onShow: (i: number) => void }) {
  const [comparing, setComparing] = useState(false);
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2">
      <Meta className="mr-1">Versions</Meta>
      <TooltipProvider delay={300}>
        {versions.map((v, i) => (
          <Tooltip key={v.src} label={`Version ${i + 1} · ${takenAt(v)}${i === versions.length - 1 ? ' · now' : ''}`}>
            <button type="button" onClick={() => onShow(i)} aria-pressed={i === shown} aria-label={`Version ${i + 1}, from ${takenAt(v)}`}
              className={`relative block aspect-[3/2] w-12 overflow-hidden rounded-[4px] border bg-surface-2 ${i === shown ? 'border-fg ring-1 ring-fg' : 'border-border hover:border-border-strong'}`}>
              <img src={v.src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
              <span aria-hidden="true" className="absolute bottom-0.5 right-0.5 rounded-[3px] bg-bg/90 px-1 text-[11px] leading-tight tabular-nums text-muted">{i + 1}</span>
            </button>
          </Tooltip>
        ))}
      </TooltipProvider>
      <Faint className="ml-auto tabular-nums">{shown + 1} of {versions.length}</Faint>
      <Button size="sm" variant="secondary" onClick={() => setComparing(true)}>Compare</Button>
      <Compare open={comparing} onOpenChange={setComparing} versions={versions} from={Math.max(0, versions.length - 2)} to={versions.length - 1} alt="" />
    </div>
  );
}

/**
 * Before and after, one over the other: drag across the picture, or use the slider under it, to wipe
 * from one to the other. Any two of a change's pictures, picked at the top; the one before and the
 * current one to start with.
 */
export function Compare({ open, onOpenChange, versions, from, to, alt, numbered = true }: { open: boolean; onOpenChange: (o: boolean) => void; versions: BoardVersion[]; from: number; to: number; alt: string; numbered?: boolean }) {
  const [a, setA] = useState(from);
  const [b, setB] = useState(to);
  const [at, setAt] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  // Each by its number on the change's page (none for the inbox's pair), and when it was taken.
  const options = versions.map((v, i) => ({ value: String(i), label: `${numbered ? `Version ${i + 1} · ` : ''}${v.date && i === versions.length - 1 ? `${takenAt(v)} · now` : takenAt(v)}` }));
  const move = (x: number) => {
    const r = box.current?.getBoundingClientRect();
    if (r) setAt(Math.round(Math.min(100, Math.max(0, ((x - r.left) / r.width) * 100))));
  };
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (o) { setA(from); setB(to); setAt(50); } }}>
      <DialogContent wide>
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-3">
          <DialogTitle className="mr-2 font-semibold tracking-tight">Compare</DialogTitle>
          <Select label="Before" value={String(a)} options={options} onChange={(v) => setA(Number(v))} />
          <Select label="After" value={String(b)} options={options} onChange={(v) => setB(Number(v))} />
          <DialogClose render={<Button size="sm" variant="ghost" className="ml-auto">Close</Button>} />
        </div>
        <div className="min-h-0 flex-1 overflow-auto bg-surface-2 p-4 sm:p-8">
          <div ref={box} className="relative mx-auto max-w-5xl cursor-ew-resize select-none overflow-hidden rounded-md border border-border bg-bg"
            onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); move(e.clientX); }}
            onPointerMove={(e) => { if (e.buttons) move(e.clientX); }}>
            <img src={versions[b]?.src} alt={`${alt} after`} className="block h-auto w-full" draggable={false} />
            <img src={versions[a]?.src} alt={`${alt} before`} className="absolute left-0 top-0 block h-auto w-full" draggable={false} style={{ clipPath: `inset(0 ${100 - at}% 0 0)` }} />
            <div className="pointer-events-none absolute inset-y-0 w-0.5 bg-fg" style={{ left: `calc(${at}% - 1px)` }} />
            <span className="pointer-events-none absolute bottom-2 left-2 rounded-full border border-border bg-bg/90 px-2 py-0.5 text-[12px] text-muted">{numbered ? `Version ${a + 1}` : 'Before'}</span>
            <span className="pointer-events-none absolute bottom-2 right-2 rounded-full border border-border bg-bg/90 px-2 py-0.5 text-[12px] text-muted">{numbered ? `Version ${b + 1}` : 'Now'}</span>
          </div>
          <input type="range" min={0} max={100} step={1} value={at} onChange={(e) => setAt(Number(e.target.value))} aria-label="Before and after" className="mx-auto mt-4 block w-full max-w-5xl accent-[var(--color-fg)]" />
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * In the Review inbox: the picture from before this decision beside the one now, each labelled, with
 * Compare for the slider, at the top right of Now. Used when the change's picture was retaken after the decision was queued.
 */
export function BeforeNow({ before, now, alt, height }: { before: BoardVersion; now: string; alt: string; height: number }) {
  const [comparing, setComparing] = useState(false);
  const pair: BoardVersion[] = [before, { src: now, date: '' }];
  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Meta className="mb-1.5 block">Before · {dayWords(before.date)}</Meta><Screenshot src={before.src} alt={`${alt}, before`} height={height} /></div>
        <div>
          {/* Compare sits at the top right of Now, on the label line, so both pictures start at the same height. */}
          <div className="mb-1.5 flex items-baseline justify-between gap-3"><Meta>Now</Meta><button type="button" onClick={() => setComparing(true)} className="text-[13px] text-muted hover:text-fg hover:underline">Compare</button></div>
          <Screenshot src={now} alt={alt} height={height} />
        </div>
      </div>
      <Compare open={comparing} onOpenChange={setComparing} versions={pair} from={0} to={1} alt={alt} numbered={false} />
    </div>
  );
}

/**
 * A change's decisions under the picture each one led to: a decision recorded before a picture was
 * taken shows with that picture. Ones recorded after the last picture come first, under "Since the
 * last picture". Newest first, the groups and the decisions in each, so the page reads from now back to the start.
 */
export function byVersion<D extends { date?: string }>(decisions: D[], versions: BoardVersion[]): { version: number | null; decisions: D[] }[] {
  const t = versions.map((v) => Date.parse(v.date));
  // Every version gets its place, with or without decisions, so the timeline never skips one.
  const groups = new Map<number, D[]>(versions.map((_, i) => [i, [] as D[]]));
  for (const d of decisions) {
    const at = d.date ? Date.parse(d.date) : NaN;
    const i = Number.isNaN(at) ? versions.length - 1 : t.findIndex((x) => x >= at);
    const k = i === -1 ? -1 : i;
    groups.set(k, [...(groups.get(k) ?? []), d]);
  }
  return [...groups.entries()].sort((x, y) => (x[0] === -1 ? -1 : y[0] === -1 ? 1 : y[0] - x[0])).map(([k, ds]) => ({ version: k === -1 ? null : k, decisions: [...ds].reverse() }));
}

/**
 * Decided here, grouped by version, newest first: a heading for each, its number in bold and when it was
 * taken in muted on the left; "Show version" on the far right, the same on every one, to put it in the
 * picture. Which one is showing is marked by its thumbnail and the label on the picture. Every version
 * gets its heading, with "No new decisions" when it has none, so the order never skips one.
 */
export function VersionGroups<D>({ groups, versions, onShow, item }: { groups: { version: number | null; decisions: D[] }[]; versions: BoardVersion[]; onShow: (i: number) => void; item: (d: D) => React.ReactNode }) {
  const latest = versions.length - 1;
  return (
    <div>
      {groups.map((g, i) => (
        <div key={g.version ?? 'since'} className={i ? 'mt-8' : ''}>
          <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
            <h3 className="text-[14px] font-semibold tracking-tight">{g.version === null ? 'Since the last picture' : `Version ${g.version + 1}`}</h3>
            <span className="text-[12px] text-muted">{g.version === null ? 'Not pictured yet' : `${takenAt(versions[g.version])}${g.version === latest ? ' · now' : ''}`}</span>
            {g.version !== null ? (
              <span className="ml-auto text-[12px] text-faint"><button type="button" onClick={() => onShow(g.version!)} className="hover:text-fg hover:underline">Show version</button></span>
            ) : null}
          </div>
          {/* A hairline under the heading, none between its decisions: the version is what groups them
              (D-0034, an exception to D-0017's hairline-divided list, for version sections only). */}
          {g.decisions.length ? <ol className="border-t border-border">{g.decisions.map(item)}</ol> : <p className="border-t border-border py-3 text-[13px] text-faint">No new decisions at this version.</p>}
        </div>
      ))}
    </div>
  );
}
