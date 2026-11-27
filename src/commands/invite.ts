/**
 * `arbiter invite` — the admin's invites to Arbiter Team, which is in early access, by invitation.
 *
 *   arbiter invite "Sam at Acme"          a code good for 1 board, shown once (--boards 3 for more)
 *   arbiter invite --list                 every invite: who it's for, boards made and left
 *   arbiter invite --off <id>             it makes no more boards; the boards it made stay up
 *
 * Needs the server's admin token in ARBITER_ADMIN_TOKEN, as a takedown does. Needs no project, and
 * changes nothing in one. Left out of --help: it's only for whoever runs the server.
 */

import { ADMIN_ENV, listInvites, makeInvite, switchOffInvite, type Invite } from '../hosted';
import { DEFAULT_HOST } from './publish';

export interface InviteOptions { boards?: string | number; list?: boolean; off?: string; to?: string; json?: boolean }

const day = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

export async function invite(note: string | undefined, opts: InviteOptions = {}): Promise<{ ok: boolean; out: string }> {
  const base = (opts.to ?? DEFAULT_HOST).replace(/\/$/, '');
  const admin = process.env[ADMIN_ENV]?.trim();
  if (!admin) return { ok: false, out: `Set ${ADMIN_ENV} to the admin token of ${base} first.` };
  try {
    if (opts.off) {
      const r = await switchOffInvite(base, admin, opts.off);
      if (opts.json) return { ok: true, out: JSON.stringify({ id: opts.off, ...r }, null, 2) };
      return { ok: true, out: r.already ? 'That invite was already off.' : `Switched off${r.note ? `: ${r.note}` : ''}. It makes no more boards; the boards it made stay up.` };
    }
    if (opts.list) {
      const all = await listInvites(base, admin);
      if (opts.json) return { ok: true, out: JSON.stringify({ invites: all }, null, 2) };
      return { ok: true, out: listed(base, all) };
    }
    const boards = opts.boards === undefined ? undefined : Number(opts.boards);
    if (boards !== undefined && (!Number.isInteger(boards) || boards < 1)) return { ok: false, out: '--boards: a whole number, 1 or more.' };
    const made = await makeInvite(base, admin, { note: note?.trim(), boards });
    if (opts.json) return { ok: true, out: JSON.stringify(made, null, 2) };
    // @latest, so an older Arbiter in their project, which doesn't know --invite, isn't the one that runs.
    return {
      ok: true,
      out: [
        `Invite${made.note ? ` for ${made.note}` : ''}, good for ${made.boards} board${made.boards === 1 ? '' : 's'}. This is the only time the code is shown:`,
        '',
        `  ${made.code}`,
        '',
        'Send them this line, to run in their project:',
        '',
        `  npx arbiterdesign@latest publish --invite ${made.code}`,
      ].join('\n'),
    };
  } catch (e) {
    return { ok: false, out: (e as Error).message };
  }
}

function listed(base: string, all: Invite[]): string {
  if (!all.length) return `No invites on ${base} yet. Make one: npx arbiter invite "who it's for"`;
  const lines = all.map((i) => {
    const use = `${i.made} board${i.made === 1 ? '' : 's'} made, ${i.off ? `off since ${day(i.off)}` : `${i.boardsLeft} left`}`;
    return `  ${(i.note || '(no note)').padEnd(24)}  ${use.padEnd(28)}  ${day(i.created).padEnd(6)}  ${i.id}`;
  });
  return [`${all.length} invite${all.length === 1 ? '' : 's'} on ${base}`, '', ...lines].join('\n');
}
