/**
 * Where a change sits on the board: Folder → Area → Change → Decision. One definition, read by the
 * page (board/lib/board.ts, board/Areas.tsx) and by the CLI (`arbiter areas`, the reply to `record`),
 * so what the agent is told about areas is what the board shows. No runtime imports: the page's build
 * reads this file too.
 *
 * An area comes from the change itself: the feature a set of options was explored for, or the first
 * part of a piece of work's name ("Settings — billing" is Settings). Folders are made on top, by the
 * person or proposed by the agent, and hold areas by name (`.arbiter/areas.json`).
 */
import type { Arrangement } from './board-types';

/** A change to the whole product — type, colour, spacing, voice — rather than to a place in it. */
export const FOUNDATIONS = 'Foundations';

export type Areable = { feature: string | null; work?: boolean; name: string; decisions: { scope?: string }[] };

/**
 * "Settings — billing", "Settings—billing", "Settings: billing", "Settings - billing" → "Settings". The way
 * the agent is asked to name work. A dash needs no spaces; a hyphen does, or "Sign-in page" would split.
 */
export const headOf = (name: string): string | null => {
  const head = name.split(/\s*[—–]\s*|\s+-\s+|:\s+/)[0].trim();
  return head && head !== name.trim() ? head : null;
};
/**
 * Two options are in one set, the versions of one thing to choose between, when they share their feature
 * (the area) and what their names start with: "Empty state — illustration" and "Empty state — checklist"
 * are one set; "Row layout — compact", in the same area, is another. Names with no head share one set.
 * The board groups by it, and approving one supersedes only the rest of its set.
 */
export const sameHead = (a: { name: string }, b: { name: string }): boolean =>
  (headOf(a.name) ?? '').toLowerCase() === (headOf(b.name) ?? '').toLowerCase();

/**
 * A set's name: what its options' names start with ("Empty state", in Projects), or its area when the names
 * only say that ("Project card — compact" in Project card, "Card — compact" in Card component).
 */
export const setName = (area: string, c: { name: string }): string => {
  const head = headOf(c.name);
  return head && !area.toLowerCase().startsWith(head.toLowerCase()) ? head : area;
};
const everywhere = (c: Areable) => c.decisions.length > 0 && c.decisions.every((d) => d.scope === 'global');
/** `name` starts with the area `k` at a word boundary: "reports filters", "reports—x", "reports: x" — not "reportsx". */
const under = (name: string, k: string) => name === k || (name.startsWith(k) && /^[\s:—–]/.test(name.slice(k.length)));

/**
 * The product area each card belongs to — what the board groups by, and what the rail lists.
 * A set of options has one: the feature it was explored for. A change that was simply made
 * (a piece of work) takes one from its name: "Settings — billing" is Settings, and "Reports
 * filters" is Reports when Reports is an area on this board. A change where every decision
 * applies everywhere is Foundations. Anything else is an area of its own, by its name.
 *
 * Needs the whole board: which areas exist decides where a name like "Reports filters" goes.
 */
export function areasFor(cards: Areable[]): (c: Areable) => string {
  const known = new Map<string, string>();
  const learn = (name: string) => { if (!known.has(name.toLowerCase())) known.set(name.toLowerCase(), name); };
  for (const c of cards) if (c.feature) learn(c.feature);
  for (const c of cards) {
    if (!c.work || c.feature) continue;
    // A named head is an area; so is a plain change's whole name ("Reports"), unless it's a foundation.
    const head = headOf(c.name);
    if (head) learn(head);
    else if (!everywhere(c)) learn(c.name.trim());
  }
  // Longest first, so "Settings billing" isn't taken by an area called "Set".
  const byLength = [...known.entries()].sort((a, b) => b[0].length - a[0].length);
  return (c) => {
    if (c.feature) return c.feature;
    const lower = c.name.trim().toLowerCase();
    // An area it sits under — never itself: its own name is an area for others, not a match for it.
    for (const [k, v] of byLength) if (k !== lower && under(lower, k)) return v;
    if (everywhere(c)) return FOUNDATIONS;
    return known.get(lower) ?? c.name.trim();
  };
}

/** A row in the Areas list: a folder holding areas, or an area on its own. */
export type Entry = { kind: 'folder'; id: string; name: string; areas: string[] } | { kind: 'area'; name: string };

const low = (s: string) => s.toLowerCase();
export const keyOf = (e: Entry) => (e.kind === 'folder' ? `folder:${e.id}` : low(e.name));

/**
 * The Areas list as it was arranged: that order first, then anything new in the board's own order. A
 * folder keeps only the areas on the board now, and an area sits in one folder at most.
 */
export function layoutOf(names: string[], arr: Arrangement | null): Entry[] {
  const known = new Map(names.map((n) => [low(n), n]));
  const filed = new Set<string>();
  const folders: Entry[] = (arr?.folders ?? []).map((f) => {
    const areas: string[] = [];
    for (const a of f.areas) {
      const n = known.get(low(a));
      if (n && !filed.has(low(n))) { filed.add(low(n)); areas.push(n); }
    }
    return { kind: 'folder', id: f.id, name: f.name, areas };
  });
  const all: Entry[] = [...folders, ...names.filter((n) => !filed.has(low(n))).map((name) => ({ kind: 'area' as const, name }))];
  const byKey = new Map(all.map((e) => [keyOf(e), e]));
  const out: Entry[] = [];
  const used = new Set<string>();
  for (const k of arr?.order ?? []) {
    const e = byKey.get(k.startsWith('folder:') ? k : low(k));
    if (e && !used.has(keyOf(e))) { used.add(keyOf(e)); out.push(e); }
  }
  for (const e of all) if (!used.has(keyOf(e))) out.push(e);
  return out;
}

/** The rows as they're saved. */
export const arrangementOf = (es: Entry[]): Arrangement => ({
  folders: es.flatMap((e) => (e.kind === 'folder' ? [{ id: e.id, name: e.name, areas: e.areas }] : [])),
  order: es.map((e) => (e.kind === 'folder' ? `folder:${e.id}` : e.name)),
});
