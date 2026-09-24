/**
 * Answering a request from the board.
 *
 *   record R-0001 --as apply                Apply — the agent makes the change as asked
 *   record R-0001 --as apply --to "…"       Apply, but… — the agent does this instead
 *   record R-0001 --as decline --why "…"    Decline — the requester reads the reason on the board
 *
 * Approving changes no code; only the agent can do that. It marks the request so the agent makes
 * the change — right away in chat, or at the next /arbiter when it was approved from the review
 * page. Recording that change with `record '<json>' --request R-0001` is what applies it, and
 * only an approved request can be applied.
 */

import { DecisionInput } from '../schema';
import { currentAuthor, findRoot, now, resolvePaths, type Paths } from '../store';
import { ChangeRequest, oneLine, readRequests, replaceRequest, REQUEST_ID, screenName } from '../requests';
import { readCandidates } from '../candidates';
import type { RecordResult } from './record';

export type RequestAction = 'apply' | 'decline';

export interface RequestOptions {
  as: RequestAction;
  /** Apply, but… — what to do instead of what was asked. */
  to?: string;
  /** Decline — why not. */
  why?: string;
  author?: string;
  dryRun?: boolean;
  cwd?: string;
}

const fail = (errors: string[]): RecordResult => ({ exitCode: 1, output: { status: 'invalid', errors } });

export function judgeRequest(id: string, opts: RequestOptions): RecordResult {
  if (!REQUEST_ID.test(id)) return fail([`not a request id: ${id} (looks like R-0001)`]);
  const root = findRoot(opts.cwd);
  const paths = resolvePaths(root);
  const all = readRequests(paths);
  const r = all.find((x) => x.id === id);
  if (!r) return fail([`${id} is not a request here — npx arbiter rules --pending lists them`]);
  if (r.status === 'applied') return fail([`${id} was already applied (${r.decisions.join(', ')}). To undo that, it's a new change — and a new decision.`]);

  const by = opts.author ?? currentAuthor(root);
  let next: ChangeRequest;
  if (opts.as === 'decline') {
    if (opts.to) return fail(['--to is for Apply, but…; a decline takes --why "<reason>"']);
    const why = opts.why?.trim();
    if (!why) return fail([`decline needs --why "<reason>" — ${r.author} reads it on the board`]);
    next = { ...r, status: 'declined', reason: oneLine(why), instead: null, judgedBy: by, judgedAt: now() };
  } else if (opts.as === 'apply') {
    if (opts.why) return fail(['--why is for decline; Apply, but… is --to "<what to do instead>"']);
    const instead = opts.to?.trim() ? oneLine(opts.to) : null;
    // A decline can be taken back: the owner changed their mind, and the board says so.
    next = { ...r, status: 'approved', instead, reason: null, judgedBy: by, judgedAt: now() };
  } else {
    return fail(['a request is answered with --as apply | decline']);
  }

  if (!opts.dryRun) replaceRequest(paths, all, next);
  const name = screenName(paths, r.screen);
  return {
    exitCode: 0,
    output: {
      status: next.status,
      id,
      author: r.author,
      asked: r.body,
      screen: r.screen,
      screenName: name,
      ...(next.status === 'approved'
        ? {
            ...(next.instead && { instead: next.instead }),
            // What the agent is to do, whichever way it was approved.
            do: next.instead ?? r.body,
            next: `Make the change, then record it: npx arbiter record '<json>' --request ${id}${name ? ` — trigger "${name}"` : ''}`,
          }
        : { reason: next.reason, next: `${r.author} sees this on the board once it's published` }),
    },
  };
}

/**
 * Before a change is recorded against a request: the request exists, and the owner said yes.
 * Returns what the record should carry, or why it can't.
 */
export function requestGate(paths: Paths, id: string): { ok: true; request: ChangeRequest } | { ok: false; errors: string[] } {
  if (!REQUEST_ID.test(id)) return { ok: false, errors: [`--request takes a request id like R-0001, not ${id}`] };
  const r = readRequests(paths).find((x) => x.id === id);
  if (!r) return { ok: false, errors: [`${id} is not a request here`] };
  if (r.status === 'open') return { ok: false, errors: [`${id} hasn't been answered — the owner approves it first: npx arbiter record ${id} --as apply`] };
  if (r.status === 'declined') return { ok: false, errors: [`${id} was declined (${r.reason}). If that's changed, approve it first: npx arbiter record ${id} --as apply`] };
  return { ok: true, request: r };
}

/**
 * What a change made for a request carries without being told: the screen it was asked on, and —
 * when the owner applied it differently — the ask itself, as the alternative that lost.
 */
export function withRequest(paths: Paths, input: DecisionInput, r: ChangeRequest): DecisionInput {
  const out = { ...input };
  // Not given, or given as none (a queued item carries `candidate: null`): the screen it was asked on.
  if (!out.candidate && r.screen.startsWith('C-') && readCandidates(paths).some((c) => c.id === r.screen)) out.candidate = r.screen;
  if (r.instead) {
    const asked = oneLine(r.body);
    const rejected = out.rejected ?? [];
    if (!rejected.some((x) => x.includes(asked))) out.rejected = [`${asked} — ${r.author}'s request, applied differently`, ...rejected];
  }
  return out;
}

/** After the change is recorded: link it, and the request is applied. */
export function markApplied(paths: Paths, request: ChangeRequest, decisionId: string): void {
  const all = readRequests(paths);
  const r = all.find((x) => x.comment === request.comment) ?? request;
  replaceRequest(paths, all, { ...r, status: 'applied', decisions: [...new Set([...r.decisions, decisionId])], appliedAt: r.appliedAt ?? now() });
}
