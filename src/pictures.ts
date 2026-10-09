/**
 * Which cards should have a picture and don't. The board covers a card without one in an icon
 * of its kind, so a missing picture never looks broken there, which is exactly why nobody
 * notices. This tells the only people who can still fix it: the agent at `record`, the author
 * at `publish` and on the review page. Never the board's viewers.
 *
 * A change earns a picture when you could point at it on one screen and a still would show it:
 * its layout, its words, its looks. Behaviour doesn't show in a still (interaction, motion,
 * access), a state is photographed only if you were already looking at it, and a global change
 * has no one screen. Polish never reaches the board, so it never asks either.
 */

import { readCandidates, type Candidate } from './candidates';
import type { Decision, Dimension } from './schema';
import type { Paths } from './store';
import { workId, workSnapshot } from './work';

const PICTURED: readonly Dimension[] = ['structure', 'content', 'visual'];

/** Would a picture of one screen show this change, on a card the board will have? */
export const needsPicture = (d: Pick<Decision, 'scope' | 'dimension' | 'level' | 'verdict'>): boolean =>
  d.scope !== 'global' && d.level !== 'polish' && d.verdict !== 'retire' && PICTURED.includes(d.dimension);

export interface MissingPicture {
  /** The card's name, as the board shows it. */
  name: string;
  /** The command that attaches one. */
  command: string;
}

/**
 * One entry per card that should have a picture and has none. Cards are found the way the board
 * builds them: a decision on a known candidate rides with it, the rest group by piece of work.
 * A rejected or replaced direction is gone from the app, so nothing asks for its picture.
 */
export function missingPictures(paths: Paths, decisions: Decision[], candidates: Candidate[] = readCandidates(paths)): MissingPicture[] {
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const out = new Map<string, MissingPicture>();
  for (const d of decisions) {
    if (!needsPicture(d)) continue;
    const c = d.candidate ? byId.get(d.candidate) : undefined;
    if (c) {
      if (c.snapshot || c.state === 'rejected' || c.state === 'superseded') continue;
      out.set(c.id, { name: c.name, command: `npx arbiter candidate ${c.id} --snapshot shot.png` });
    } else {
      const id = workId(d.trigger);
      if (workSnapshot(paths, id)) continue;
      out.set(id, { name: d.trigger, command: `npx arbiter snapshot ${JSON.stringify(d.trigger)} --file shot.png` });
    }
  }
  return [...out.values()];
}

/** The line an agent reads in `record`'s reply. */
export const pictureHint = (m: MissingPicture): string =>
  `No picture of "${m.name}" yet. If you can open that screen, take one now (see Screenshots in the skill): ${m.command}`;
