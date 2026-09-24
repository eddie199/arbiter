/**
 * Keeping a board current without GitHub, CI, or even a git repository.
 *
 * `publish --on-push` needs GitHub Actions, which needs GitHub. A git hook would at least need a
 * repository. Plenty of projects have neither — local only, or deployed straight to a server — and
 * for them the board goes stale the moment someone forgets to publish.
 *
 * The board changes when the record changes, so that's the moment to republish: after judging,
 * after a screen changes state, after a picture is attached or removed. `hosted.auto` in
 * arbiter.json turns it on. Nothing watches anything; this runs inside a command the user ran.
 *
 * Still only two things touch the network — publish and pull — and this is publish, switched on
 * deliberately in a committed file where everyone on the project can see it.
 */

import { readLink } from './hosted';
import { findRoot, readConfig, resolvePaths } from './store';

/** Off unless arbiter.json says `hosted.auto` and the project has been published once. */
export function autoPublishOn(cwd?: string): boolean {
  const paths = resolvePaths(findRoot(cwd));
  return !!readConfig(paths)?.hosted?.auto && !!readLink(paths);
}

/**
 * Republish, if it's on. Returns a line to print, or null. Never throws and never changes an exit
 * code: a board that failed to update is worth a sentence, not a failed command — the record is
 * already written, and git is what actually holds it.
 */
export async function autoPublish(cwd?: string): Promise<string | null> {
  if (!autoPublishOn(cwd)) return null;
  const link = readLink(resolvePaths(findRoot(cwd)))!;
  const { publish } = await import('./commands/publish');
  try {
    // Always the board this project is already linked to. Falling through to the default host
    // would create a second, empty board somewhere else entirely.
    const r = await publish({ cwd, to: link.url });
    if (r.ok && r.url) return `Board updated — ${r.url}`;
    const failed = r.steps.find((s) => s.outcome === 'failed');
    return `Board not updated: ${failed?.note ?? 'publish failed'} — run \`npx arbiter publish\` when you can.`;
  } catch (e) {
    return `Board not updated: ${(e as Error).message} — run \`npx arbiter publish\` when you can.`;
  }
}
