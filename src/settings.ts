/**
 * Settings, as the local board's Preferences page shows and saves them. They live in arbiter.json, beside
 * the check-in answer, so everyone on the project shares them and the CLI reads them where it acts:
 * `record --pending` keeps out what they say isn't recorded, pictures stop being asked for, and
 * `areas` says when folder suggestions are off.
 */

import { ACTIVE_CAP, now, readActive, readConfig, writeActive, writeConfig, type Config, type Paths } from './store';
import { appUrl, CHECKINS, type Checkin } from './commands/setup';
import type { BoardSettings } from './board-types';

/** The most rules DECISIONS.md can be set to hold: more is more for the agent to read before every change. */
export const MAX_CAP = 100;

export function settingsOf(paths: Paths, config: Config | null = readConfig(paths)): BoardSettings {
  return {
    checkin: config?.checkin ?? 'feature',
    record: config?.record?.level ?? 'pattern',
    agentCalls: config?.record?.agent ?? true,
    pictures: config?.pictures ?? true,
    app: config?.app?.url ?? null,
    suggestFolders: config?.suggestFolders ?? true,
    cap: config?.activeCap ?? ACTIVE_CAP,
    rules: readActive(paths).length,
  };
}

const KEYS = ['checkin', 'record', 'agentCalls', 'pictures', 'app', 'suggestFolders', 'cap'] as const;

/**
 * One or more settings from the page, checked, then written to arbiter.json. A new cap also rewrites
 * DECISIONS.md's header, which says how many it holds. Choosing a check-in here answers the question
 * install asks, so the project counts as onboarded, as `setup --checkin` does.
 */
export function saveSettings(paths: Paths, raw: unknown): { ok: true; settings: BoardSettings } | { ok: false; errors: string[] } {
  const config = readConfig(paths);
  if (!config) return { ok: false, errors: ['no arbiter.json here — run `npx arbiter init` first'] };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, errors: ['expected an object of settings'] };
  const body = raw as Record<string, unknown>;
  const errors: string[] = [];
  const unknown = Object.keys(body).filter((k) => !(KEYS as readonly string[]).includes(k));
  if (unknown.length) errors.push(`not a setting: ${unknown.join(', ')}`);

  const next: Config = { ...config };
  if ('checkin' in body) {
    if (!(CHECKINS as readonly unknown[]).includes(body.checkin)) errors.push(`checkin must be one of ${CHECKINS.join(' | ')}`);
    else {
      next.checkin = body.checkin as Checkin;
      next.onboarded = config.onboarded ?? now();
    }
  }
  if ('record' in body) {
    if (body.record !== 'pattern' && body.record !== 'feature') errors.push('record must be pattern (features and patterns) or feature (features only)');
    else next.record = { ...next.record, level: body.record };
  }
  if ('agentCalls' in body) {
    if (typeof body.agentCalls !== 'boolean') errors.push('agentCalls must be true or false');
    else next.record = { ...next.record, agent: body.agentCalls };
  }
  for (const k of ['pictures', 'suggestFolders'] as const) {
    if (!(k in body)) continue;
    if (typeof body[k] !== 'boolean') errors.push(`${k} must be true or false`);
    else next[k] = body[k] as boolean;
  }
  let cap: number | null = null;
  if ('cap' in body) {
    const have = readActive(paths).length;
    const n = body.cap;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_CAP) errors.push(`Design rules must be a whole number from 1 to ${MAX_CAP}`);
    else if (n < have) errors.push(`DECISIONS.md has ${have} rules, so it can't hold fewer. Remove some first.`);
    else cap = next.activeCap = n;
  }
  if ('app' in body) {
    const text = typeof body.app === 'string' ? body.app.trim() : null;
    if (text === null) errors.push('app must be an address, or empty');
    else if (!text) delete next.app;
    else {
      const url = appUrl(text);
      if (url === 'credentials') errors.push('Leave the username and password out: arbiter.json is committed');
      else if (!url) errors.push('Give the address the app runs at, like http://localhost:3000');
      else next.app = { url };
    }
  }
  if (errors.length) return { ok: false, errors };

  writeConfig(paths, next);
  if (cap !== null) writeActive(paths, readActive(paths), cap);
  return { ok: true, settings: settingsOf(paths, next) };
}
