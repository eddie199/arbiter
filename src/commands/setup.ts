/**
 * `arbiter setup --checkin <feature|quiet|every>` — the one preference the first `/arbiter` asks
 * for, written to arbiter.json. Running it also marks the project as onboarded, so the intro
 * never shows twice. Later: "be quieter" → the agent runs it again.
 */

import { findRoot, now, readConfig, resolvePaths, writeConfig, type Config } from '../store';

export const CHECKINS = ['feature', 'quiet', 'every'] as const;
export type Checkin = (typeof CHECKINS)[number];

export function setup(opts: { checkin?: string; cwd?: string }): { exitCode: 0 | 1; output: Record<string, unknown> } {
  const paths = resolvePaths(findRoot(opts.cwd));
  const config = readConfig(paths);
  if (!config) return { exitCode: 1, output: { status: 'invalid', errors: ['no arbiter.json here — run `npx arbiter init` first'] } };
  const checkin = (opts.checkin ?? config.checkin ?? 'feature') as Checkin;
  if (!CHECKINS.includes(checkin)) return { exitCode: 1, output: { status: 'invalid', errors: [`--checkin must be one of ${CHECKINS.join(' | ')}`] } };
  const next: Config = { ...config, checkin, onboarded: config.onboarded ?? now() };
  writeConfig(paths, next);
  return { exitCode: 0, output: { status: 'saved', checkin, onboarded: next.onboarded } };
}
