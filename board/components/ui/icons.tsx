/**
 * The board's icons, one set per use (DESIGN.md, "Icons"), drawn in the text colour with round caps.
 *
 * `Icon`: the menus' icons, so every "⋯" menu reads the same: 14px, a 1.5 stroke. A menu item shows one
 * left of its words (see ActionItem in menu.tsx).
 */
const icon = (d: React.ReactNode) => <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>;

const FOLDER_PATH = 'M1.75 4A1.25 1.25 0 0 1 3 2.75h2.5l1.25 1.5H11A1.25 1.25 0 0 1 12.25 5.5v5A1.25 1.25 0 0 1 11 11.75H3A1.25 1.25 0 0 1 1.75 10.5z';

export const Icon = {
  download: icon(<path d="M7 2v7M4 6.5 7 9.5l3-3M2.5 11.5h9" />),
  copy: icon(<><rect x="4.5" y="4.5" width="7.5" height="7.5" rx="1.5" /><path d="M9.5 4.5V3.5A1.5 1.5 0 0 0 8 2H3.5A1.5 1.5 0 0 0 2 3.5V8a1.5 1.5 0 0 0 1.5 1.5h1" /></>),
  pencil: icon(<path d="M9.5 2.5 11.5 4.5 5 11H3V9zM8.25 3.75l2 2" />),
  tray: icon(<><path d="M1.5 8.5 3 2.5h8l1.5 6v3h-11z" /><path d="M1.5 8.5h3.25l.75 1.5h3l.75-1.5h3.25" /></>),
  camera: icon(<><path d="M1.5 5A1.5 1.5 0 0 1 3 3.5h1.25L5.25 2h3.5l1 1.5H11A1.5 1.5 0 0 1 12.5 5v5A1.5 1.5 0 0 1 11 11.5H3A1.5 1.5 0 0 1 1.5 10z" /><circle cx="7" cy="7.25" r="2" /></>),
  check: icon(<path d="M3 7.5 5.75 10.25 11 4.25" />),
  skip: icon(<><path d="M2.5 9.75a4.5 4.5 0 0 1 8.4-2.25" /><path d="M11.25 3.75V7.5H7.5" /></>),
  open: icon(<><path d="M8 2.5h3.5V6M11.5 2.5 6.5 7.5" /><path d="M10 8.5V11a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1h2.5" /></>),
  folder: icon(<path d={FOLDER_PATH} />),
  folderPlus: icon(<><path d={FOLDER_PATH} /><path d="M7 6.25v3.5M5.25 8h3.5" /></>),
  folderMinus: icon(<><path d={FOLDER_PATH} /><path d="M5.25 8h3.5" /></>),
  sort: icon(<path d="M2 3.5h10M2 7h7M2 10.5h4" />),
  up: icon(<path d="M7 11.5v-9M3.5 6 7 2.5 10.5 6" />),
  down: icon(<path d="M7 2.5v9M3.5 8 7 11.5 10.5 8" />),
  moveTo: icon(<path d="M2.5 7h9M8 3.5 11.5 7 8 10.5" />),
  moveOut: icon(<path d="M11.5 7h-9M6 3.5 2.5 7 6 10.5" />),
  merge: icon(<><path d="M3 2.5v2.5a4 4 0 0 0 4 4h4.5" /><path d="M3 11.5V9" /><path d="M9 6.5l2.5 2.5L9 11.5" /></>),
};

/**
 * `Kind`: Home's icons, drawn on a 16px grid with a thinner stroke (1.3). Shown at 16px on a tile, and at
 * 14px in a list row's round icon (`size`). The same thing has the same icon everywhere: the tray is
 * what's waiting, a tick in a circle is decided, a shield is a rule.
 */
const kind = (d: React.ReactNode) => (size = 16) => <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0">{d}</svg>;

export const Kind = {
  waiting: kind(<><path d="M2 9.5 3.75 3h8.5L14 9.5V13H2z" /><path d="M2 9.5h4l.75 1.5h2.5l.75-1.5h4" /></>),
  decided: kind(<><circle cx="8" cy="8" r="6" /><path d="M5.6 8.2l1.7 1.7 3.2-3.5" /></>),
  rule: kind(<><path d="M8 1.5 13 3.5v4c0 3.2-2.2 5.6-5 6.9-2.8-1.3-5-3.7-5-6.9v-4z" /><path d="M5.8 8.2l1.6 1.6 3-3.2" /></>),
  oneOff: kind(<path d="M8 14V9M8 9 4.5 4.5M8 9l3.5-4.5M3 6.5V4h2.5M13 6.5V4h-2.5" />),
  confirmed: kind(<path d="M2.5 8.5l2.5 2.5 5-6M8.5 10.5l.5.5 5-6" />),
};

/** `Small`: arrows and chevrons, 12px, a 1.5 stroke. The chevron is ⌄; an expander flips it while open. */
export const Small = {
  arrow: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M2.5 6h7M6.5 3l3 3-3 3" /></svg>,
  chevron: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M2.5 4.5 6 8l3.5-3.5" /></svg>,
  left: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M7.5 2.5 4 6l3.5 3.5" /></svg>,
  right: <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="shrink-0"><path d="M4.5 2.5 8 6l-3.5 3.5" /></svg>,
};
