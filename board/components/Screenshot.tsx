// Copied from the site's hosted/components/Screenshot.tsx (site bff92c0, 4 Nov 2026). The local board owns it now.
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Dialog, DialogTrigger, DialogContent, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';

type Size = { w: number; h: number };

/** Taller than wide by this much: a phone, or a page shot the length of one. Shown phone-width, never stretched. */
const isTall = (s: Size | null) => !!s && s.h > s.w * 1.2;
/** How wide a tall screen sits inline, and at the viewer's starting zoom. */
const TALL_INLINE = 360;
const TALL_BASE = 520;
/** Zoom steps, relative to the starting size. */
const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3];
const BASE = ZOOMS.indexOf(1);

/** The image's own pixel size once it's known — a cached image loads before hydration, so check `complete` too. */
function useNaturalSize(): [Size | null, (img: HTMLImageElement | null) => void] {
  const [size, setSize] = useState<Size | null>(null);
  const measure = useCallback((img: HTMLImageElement | null) => {
    if (!img) return;
    const read = () => { if (img.naturalWidth) setSize({ w: img.naturalWidth, h: img.naturalHeight }); };
    if (img.complete) read();
    else img.addEventListener('load', read, { once: true });
  }, []);
  return [size, measure];
}

/**
 * The screenshot in a card of its own: a tinted, padded frame with the image on its
 * own border. Hover shows the zoom cursor; click opens it in the viewer.
 * The icon in the corner toggles cropped (default) and the whole screen inline.
 * Below sm the crop is meaningless — a desktop shot in a phone-wide box is a sliver —
 * so the whole screen shows and the toggle is hidden. A tall (phone) screen sits
 * centred at phone width rather than stretched across the frame.
 */
/** `tag`: a small label in the frame's bottom-left corner, like "Version 2". */
export function Screenshot({ src, alt, height = 400, tag }: { src: string | null; alt: string; height?: number; tag?: string }) {
  const [full, setFull] = useState(false);
  const [size, measure] = useNaturalSize();
  // No picture, no frame: the page goes straight to what was decided.
  if (!src) return null;
  const label = full ? 'Show cropped' : 'Show the whole screen';
  const tall = isTall(size);
  return (
    <TooltipProvider>
      <Dialog>
        <div className={`relative overflow-hidden rounded-lg border border-border bg-surface-2 p-4 sm:p-6 ${full ? '' : 'sm:h-[var(--shot)]'}`} style={{ '--shot': `${height}px` } as React.CSSProperties}>
          <Tooltip label="Open full size"><DialogTrigger className="mx-auto block w-full cursor-zoom-in overflow-hidden rounded-md border border-border bg-bg text-left shadow-sm sm:h-full" style={tall ? { maxWidth: TALL_INLINE } : undefined}>
            <img key={src} ref={measure} src={src} alt={alt} className={full ? 'block h-auto w-full' : 'block h-auto w-full sm:h-full sm:object-cover sm:object-top'} />
          </DialogTrigger></Tooltip>
          {full ? null : <div className="pointer-events-none absolute inset-x-0 bottom-0 hidden h-20 bg-gradient-to-t from-surface-2 to-transparent sm:block" />}
          {tag ? <span className="pointer-events-none absolute bottom-6 left-6 rounded-full border border-border bg-bg/90 px-2 py-0.5 text-[12px] text-muted shadow-sm">{tag}</span> : null}
          <Tooltip label={label}>
            <button type="button" onClick={() => setFull((v) => !v)} aria-pressed={full} aria-label={label} className="absolute right-6 top-6 hidden h-7 w-7 items-center justify-center rounded-ui border border-border bg-bg text-muted shadow-sm hover:border-border-strong hover:text-fg sm:flex">
              {full ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M5.5 1.5v4h-4M8.5 12.5v-4h4M1.5 5.5 5.5 5.5M8.5 8.5l4 4" /><path d="M1.5 1.5 5.5 5.5M12.5 12.5 8.5 8.5" /></svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M8.5 1.5h4v4M5.5 12.5h-4v-4M12.5 1.5 8 6M1.5 12.5 6 8" /></svg>
              )}
            </button>
          </Tooltip>
        </div>
        <DialogContent wide>
          <Viewer src={src} alt={alt} />
        </DialogContent>
      </Dialog>
    </TooltipProvider>
  );
}

/**
 * The full image, in a fixed frame that scrolls. It opens centred and at the top, at a size you
 * can read: the frame's width for a desktop shot, phone width for a tall one — never shrunk to
 * fit the height, which turns a long phone page into a sliver. Zoom steps from there with the
 * buttons, + / − / 0, or a pinch; what's in the middle of the frame stays there.
 */
function Viewer({ src, alt }: { src: string; alt: string }) {
  const [size, measure] = useNaturalSize();
  const box = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState(0);
  const [step, setStep] = useState(BASE);
  // Where the view was, as a fraction of the image, so a zoom keeps it in place. `y` null: stay at the top.
  const anchor = useRef<{ x: number; y: number | null } | null>(null);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => { const cs = getComputedStyle(el); setRoom(el.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)); };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const go = useCallback((to: (s: number) => number) => {
    const el = box.current;
    if (el) anchor.current = { x: (el.scrollLeft + el.clientWidth / 2) / el.scrollWidth, y: el.scrollTop === 0 ? null : (el.scrollTop + el.clientHeight / 2) / el.scrollHeight };
    setStep((s) => Math.max(0, Math.min(ZOOMS.length - 1, to(s))));
  }, []);

  useLayoutEffect(() => {
    const el = box.current, a = anchor.current;
    if (!el || !a) return;
    el.scrollLeft = a.x * el.scrollWidth - el.clientWidth / 2;
    if (a.y !== null) el.scrollTop = a.y * el.scrollHeight - el.clientHeight / 2;
    anchor.current = null;
  }, [step]);

  // Keys while the viewer is open; a trackpad pinch (a wheel with ctrl) zooms instead of the page.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === '+' || e.key === '=') go((s) => s + 1);
      else if (e.key === '-' || e.key === '_') go((s) => s - 1);
      else if (e.key === '0') go(() => BASE);
    };
    let pinch = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      e.preventDefault();
      pinch += e.deltaY;
      if (Math.abs(pinch) < 40) return;
      go((s) => s + (pinch < 0 ? 1 : -1));
      pinch = 0;
    };
    const el = box.current;
    window.addEventListener('keydown', onKey);
    el?.addEventListener('wheel', onWheel, { passive: false });
    return () => { window.removeEventListener('keydown', onKey); el?.removeEventListener('wheel', onWheel); };
  }, [go]);

  const base = size && room > 0 ? Math.min(size.w, room, isTall(size) ? TALL_BASE : Infinity) : null;
  const width = base ? Math.round(base * ZOOMS[step]) : null;
  const pct = size && width ? Math.round((width / size.w) * 100) : null;

  return (
    <>
      <div className="flex items-center justify-between gap-3 border-b border-border py-2 pl-4 pr-2">
        <DialogTitle className="min-w-0 truncate text-[13px] font-normal text-muted">{alt}</DialogTitle>
        <div className="flex shrink-0 items-center gap-1">
          <ZoomButton label="Zoom out" disabled={step === 0} onClick={() => go((s) => s - 1)}><path d="M3 7h8" /></ZoomButton>
          <Tooltip label="Back to the starting size (0)"><button type="button" onClick={() => go(() => BASE)} className="h-7 min-w-14 rounded-ui px-2 text-[13px] tabular-nums text-muted hover:bg-surface-2 hover:text-fg">{pct ? `${pct}%` : '—'}</button></Tooltip>
          <ZoomButton label="Zoom in" disabled={step === ZOOMS.length - 1} onClick={() => go((s) => s + 1)}><path d="M3 7h8M7 3v8" /></ZoomButton>
          <span className="mx-1 h-4 w-px bg-border" aria-hidden="true" />
          <Tooltip label="Close (Esc)">
            <DialogClose aria-label="Close" className="flex h-7 w-7 items-center justify-center rounded-ui text-muted hover:bg-surface-2 hover:text-fg">
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><path d="M3.5 3.5l7 7M10.5 3.5l-7 7" /></svg>
            </DialogClose>
          </Tooltip>
        </div>
      </div>
      <div ref={box} className="min-h-0 flex-1 overflow-auto bg-surface-2 p-4 sm:p-8">
        {/* Block with auto margins, not flex centring: zoomed wider than the frame, it still scrolls from its left edge. */}
        <img key={src} ref={measure} src={src} alt={alt} className="mx-auto block h-auto max-w-none rounded-md border border-border bg-bg shadow-sm" style={{ width: width ?? 0, visibility: width ? 'visible' : 'hidden' }} />
      </div>
    </>
  );
}

function ZoomButton({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <Tooltip label={label}><button type="button" aria-label={label} disabled={disabled} onClick={onClick} className="flex h-7 w-7 items-center justify-center rounded-ui text-muted hover:bg-surface-2 hover:text-fg disabled:opacity-40 disabled:hover:bg-transparent">
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">{children}</svg>
    </button></Tooltip>
  );
}
