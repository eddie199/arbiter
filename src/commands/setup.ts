/**
 * `arbiter setup --checkin <feature|quiet|every>` — the one preference the first `/arbiter` asks
 * for, written to arbiter.json. Running it also marks the project as onboarded, so the intro
 * never shows twice. Later: "be quieter" → the agent runs it again.
 *
 * `arbiter setup --app <url>` — where the app runs, so the agent has an address to open for a
 * screenshot instead of assuming localhost. On its own it saves only that: the agent can learn
 * the address before the first /arbiter, and that mustn't skip the intro.
 */

import { findRoot, now, readConfig, resolvePaths, writeConfig, type Config } from '../store';

export const CHECKINS = ['feature', 'quiet', 'every'] as const;
export type Checkin = (typeof CHECKINS)[number];

export function setup(opts: { checkin?: string; app?: string; cwd?: string }): { exitCode: 0 | 1; output: Record<string, unknown> } {
  const paths = resolvePaths(findRoot(opts.cwd));
  const config = readConfig(paths);
  if (!config) return { exitCode: 1, output: { status: 'invalid', errors: ['no arbiter.json here — run `npx arbiter init` first'] } };
  let app = config.app;
  if (opts.app !== undefined) {
    const url = appUrl(opts.app);
    if (url === 'credentials') return { exitCode: 1, output: { status: 'invalid', errors: ['--app goes in arbiter.json, which is committed — give the address without a username or password'] } };
    if (!url) return { exitCode: 1, output: { status: 'invalid', errors: ['--app must be the address the app runs at, like http://localhost:3000'] } };
    app = { url };
  }
  // --app on its own goes before the check-in is read, so a hand-edited arbiter.json can't stop it.
  if (opts.app !== undefined && opts.checkin === undefined) {
    writeConfig(paths, { ...config, app });
    return { exitCode: 0, output: { status: 'saved', app: app!.url } };
  }
  const checkin = (opts.checkin ?? config.checkin ?? 'feature') as Checkin;
  if (!CHECKINS.includes(checkin)) return { exitCode: 1, output: { status: 'invalid', errors: [`--checkin must be one of ${CHECKINS.join(' | ')}`] } };
  const next: Config = { ...config, checkin, onboarded: config.onboarded ?? now(), ...(app && { app }) };
  writeConfig(paths, next);
  return { exitCode: 0, output: { status: 'saved', checkin, onboarded: next.onboarded, ...(app && { app: app.url }) } };
}

/**
 * An http(s) address a route can go on the end of: no query or fragment, no trailing slash.
 * One with a username or password is refused rather than written to a committed file.
 */
function appUrl(raw: string): string | 'credentials' | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    if (u.username || u.password) return 'credentials';
    u.search = '';
    u.hash = '';
    return u.href.replace(/\/+$/, '');
  } catch {
    return null;
  }
}
