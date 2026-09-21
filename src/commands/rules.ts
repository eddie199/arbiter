/**
 * `arbiter rules` — the read verb.
 *
 *   arbiter rules                  active rules, grouped by dimension
 *   arbiter rules --dimension x    one dimension
 *   arbiter rules --archive        everything ever: accepts, fixes, superseded, in order
 *   arbiter rules --pending        queued, not yet judged
 *   arbiter rules D-0003           one decision in full, wherever it lives
 *   arbiter rules --json           any of the above as JSON
 */

import { Decision, DIMENSIONS, Dimension, ID_PATTERN } from '../schema';
import { DIMENSION_LABELS, formatEntry } from '../format';
import { findRoot, readActive, readArchive, readConfig, readPending, resolvePaths, ACTIVE_CAP } from '../store';

export interface RulesOptions {
  json?: boolean;
  dimension?: string;
  archive?: boolean;
  pending?: boolean;
  cwd?: string;
}

export function rules(id: string | undefined, opts: RulesOptions = {}): string {
  const paths = resolvePaths(findRoot(opts.cwd));
  const cap = readConfig(paths)?.activeCap ?? ACTIVE_CAP;

  if (id) return one(id, paths, opts.json);
  if (opts.archive) return archive(readArchive(paths), readActive(paths), opts);
  if (opts.pending) return pendingList(readPending(paths), opts);

  let active = readActive(paths);
  if (opts.dimension) {
    if (!(DIMENSIONS as readonly string[]).includes(opts.dimension)) {
      throw new Error(`unknown dimension: ${opts.dimension} (one of ${DIMENSIONS.join(', ')})`);
    }
    active = active.filter((d) => d.dimension === opts.dimension);
  }

  if (opts.json) return JSON.stringify({ count: active.length, cap, rules: active }, null, 2);
  if (!active.length) return `No active rules${opts.dimension ? ` in ${opts.dimension}` : ''} (0 of ${cap}).`;

  const lines = [`${active.length} of ${cap} active rules`];
  for (const dim of DIMENSIONS) {
    const group = active.filter((d) => d.dimension === dim);
    if (!group.length) continue;
    lines.push('', DIMENSION_LABELS[dim as Dimension]);
    for (const d of group) lines.push(...entryLines(d));
  }
  return lines.join('\n');
}

/**
 * The queue, as the person judging needs to see it: grouped by the piece
 * of work (trigger), feature and pattern items in full, polish items
 * collapsed to one line each under the group. Each full item reads
 *
 *   P-0002  Change   The Rescan button on the small Health check card is now just an icon
 *           Pattern  Half-width cards use icon-only action buttons
 *           Rejected A labelled button — wrapped under the text on mobile
 */
function pendingList(pending: Decision[], opts: RulesOptions): string {
  const groups = groupByTrigger(pending);
  if (opts.json) {
    return JSON.stringify(
      {
        count: pending.length,
        polish: pending.filter((d) => d.level === 'polish').length,
        groups: groups.map((g) => ({ trigger: g.trigger, items: g.items, polish: g.polish })),
        pending,
      },
      null,
      2,
    );
  }
  if (!pending.length) return 'Nothing pending. All caught up.';
  const polish = pending.filter((d) => d.level === 'polish').length;
  const lines = [
    `${pending.length} pending${polish ? ` (${polish} polish)` : ''} — review with \`npx arbiter review\` or /arbiter in chat`,
  ];
  for (const g of groups) {
    lines.push('', g.trigger);
    for (const d of g.items) lines.push(...reviewLines(d));
    if (g.polish.length) {
      lines.push(`  polish · confirm all with \`npx arbiter record --all --level polish --as accept\``);
      for (const d of g.polish) lines.push(`    ${d.id}  ${d.change ?? d.decision}`);
    }
  }
  return lines.join('\n');
}

export interface TriggerGroup {
  trigger: string;
  /** feature + pattern, in queue order */
  items: Decision[];
  polish: Decision[];
}

/** Queue order of first appearance; each trigger once. */
export function groupByTrigger(pending: Decision[]): TriggerGroup[] {
  const out: TriggerGroup[] = [];
  for (const d of pending) {
    let g = out.find((x) => x.trigger === d.trigger);
    if (!g) {
      g = { trigger: d.trigger, items: [], polish: [] };
      out.push(g);
    }
    (d.level === 'polish' ? g.polish : g.items).push(d);
  }
  return out;
}

function reviewLines(d: Decision): string[] {
  const pad = '          ';
  const lines = [`  ${d.id}  Change   ${d.change ?? d.decision}`];
  if (d.change) lines.push(`${pad}Pattern  ${d.decision}`);
  for (const r of d.rejected) lines.push(`${pad}Rejected ${r}`);
  lines.push(`${pad}${d.level} · ${d.dimension} · ${d.scope}`);
  return lines;
}

function one(id: string, paths: ReturnType<typeof resolvePaths>, json?: boolean): string {
  if (!ID_PATTERN.test(id)) throw new Error(`not a decision id: ${id} (looks like D-0003 or P-0003)`);
  const all = id.startsWith('P-') ? readPending(paths) : readArchive(paths);
  const d = all.find((x) => x.id === id);
  if (!d) throw new Error(`${id} not found`);
  const activeIds = new Set(readActive(paths).map((x) => x.id));
  const later = all.find((x) => x.supersedes === id);
  const supersededBy = later?.id ?? null;
  const status = d.verdict !== 'rule' ? d.verdict : activeIds.has(id) ? 'active' : later ? `${later.verdict === 'retire' ? 'retired' : 'superseded'} by ${later.id}` : 'inactive';
  if (json) return JSON.stringify({ ...d, status, supersededBy }, null, 2);
  return `${formatEntry(d).trimEnd()}\n- **Status:** ${status}`;
}

function archive(all: Decision[], active: Decision[], opts: RulesOptions): string {
  const activeIds = new Set(active.map((d) => d.id));
  const later = new Map(all.filter((d) => d.supersedes).map((d) => [d.supersedes!, d]));
  const status = (d: Decision) => {
    if (d.verdict !== 'rule') return d.verdict;
    if (activeIds.has(d.id)) return 'rule · active';
    const l = later.get(d.id);
    return l ? `rule · ${l.verdict === 'retire' ? 'retired' : 'superseded'} by ${l.id}` : 'rule · inactive';
  };

  if (opts.json) return JSON.stringify({ count: all.length, decisions: all.map((d) => ({ ...d, status: status(d) })) }, null, 2);
  if (!all.length) return 'No decisions recorded yet.';

  const lines = [`${all.length} decisions, oldest first`];
  for (const d of all) {
    lines.push('', `${d.id}  ${d.decision}`, `        ${status(d)} · ${d.dimension} · ${d.scope} · ${d.author} · ${d.date.slice(0, 10)}`);
  }
  return lines.join('\n');
}

function entryLines(d: Decision): string[] {
  return [
    `  ${d.id}  ${d.decision}`,
    `          ${d.rationale}`,
    ...d.rejected.map((r) => `          ✗ ${r}`),
    `          ${d.scope} · ${d.class} · ${d.author} · ${d.date.slice(0, 10)}`,
  ];
}
