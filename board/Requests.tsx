import { useState } from 'react';
import { sentence } from '@/lib/board';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Thumb } from '@/components/Thumb';
import { Id, Meta, PageTitle, SectionTitle } from '@/components/ui/type';
import { When } from '@/components/When';
import type { Agent, ChangeRequest, ReviewState } from './types';
import { errorsOf, post, whenAgent } from './api';

/** A request declined in this sitting: it leaves the queue, and stays here as a line until the next visit. */
export type Declined = Record<string, { item: ChangeRequest; reason: string }>;

/**
 * Requests: changes someone asked for with Request change on the team board, brought here by
 * `arbiter pull`. Apply (as asked, or "Apply, but…" something else) or Decline with a reason the
 * requester reads. Approving changes no code; the agent makes it.
 */
export function RequestsPage({ state, declined, onDeclined, refresh }: { state: ReviewState; declined: Declined; onDeclined: (d: Declined) => void; refresh: () => Promise<void> }) {
  const open = state.requests.filter((r) => r.status === 'open');
  const approved = state.requests.filter((r) => r.status === 'approved');
  const gone = Object.values(declined).filter((d) => !open.some((r) => r.id === d.item.id));
  return (
    <main className="max-w-4xl">
      <div className="mb-4">
        <PageTitle>Requests</PageTitle>
        <Meta className="mt-0.5 block">Changes your team asked for on the team board. Nothing is made until you say yes.</Meta>
      </div>
      {!open.length && !approved.length && !gone.length ? (
        <div className="mt-6 rounded-lg border border-dashed border-border-strong px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">No requests</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">When someone presses Request change on the team board, it lands here after <code className="font-mono text-[12px]">npx arbiter pull</code>.</p>
        </div>
      ) : null}
      {open.length || gone.length ? (
        <section className="mt-6">
          <SectionTitle count={open.length || null}>To answer</SectionTitle>
          <div className="grid gap-3">
            {open.map((r) => <RequestCard key={r.id} r={r} agent={state.agent} onDeclined={(reason) => { onDeclined({ [r.id]: { item: r, reason } }); void refresh(); }} refresh={refresh} />)}
            {gone.map((d) => (
              <div key={d.item.id} className="flex flex-wrap items-baseline justify-between gap-x-4 rounded-lg border border-border bg-surface px-4 py-2.5 text-[13px] opacity-60">
                <span className="min-w-0"><span className="text-muted">—</span> <span className="font-medium">{d.item.body}</span></span>
                <span className="text-muted">Declined: {d.reason}</span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
      {approved.length ? (
        <section className="mt-8">
          <SectionTitle count={approved.length} aside={`your agent makes these ${whenAgent(state.agent)}`}>Approved</SectionTitle>
          <div className="grid gap-3">{approved.map((r) => <RequestCard key={r.id} r={r} agent={state.agent} refresh={refresh} />)}</div>
        </section>
      ) : null}
    </main>
  );
}

function RequestCard({ r, agent, onDeclined, refresh }: { r: ChangeRequest; agent: Agent; onDeclined?: (reason: string) => void; refresh: () => Promise<void> }) {
  const [panel, setPanel] = useState<'instead' | 'decline' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const answer = async (body: Record<string, unknown>) => {
    setBusy(true);
    const res = await post('/api/request', { id: r.id, ...body });
    setBusy(false);
    if (res.exitCode !== 0) return setError(errorsOf(res));
    if (res.status === 'declined') onDeclined?.(String(res.reason));
    else await refresh();
  };
  return (
    <div className={`rounded-lg border bg-surface p-4 ${r.status === 'approved' ? 'border-dashed border-border-strong' : 'border-border'}`}>
      <div className="flex gap-4">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] text-muted">{sentence(r.author)} asks</p>
          <p className={`mt-0.5 whitespace-pre-line text-[15px] font-medium tracking-tight ${r.status === 'approved' ? 'text-muted' : ''}`}>{r.body}</p>
          <p className="mt-2 text-[13px] text-muted">
            on {r.screenName ?? r.screen}{r.decision ? <> · about <Id>{r.decision}</Id></> : null} · <When iso={r.date} />
            {r.earlierVersion ? <span title="Asked about a version of the team board that has since been republished"> · earlier version</span> : null} · <Id>{r.id}</Id>
          </p>
          {r.status === 'approved' ? <p className="mt-2 text-[14px]"><span className="text-muted">Doing:</span> {r.instead ? sentence(r.instead) : 'As asked'}</p> : null}
        </div>
        {r.snapshotUrl ? <Thumb src={r.snapshotUrl} alt={r.screenName ?? r.screen} className="hidden aspect-[3/2] w-40 shrink-0 overflow-hidden rounded-[4px] border border-border bg-surface-2 sm:block" /> : null}
      </div>
      {r.status === 'open' && !panel ? (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" disabled={busy} onClick={() => answer({ as: 'apply' })}>Apply</Button>
          <Button size="sm" disabled={busy} onClick={() => { setText(''); setPanel('instead'); }}>Apply, but…</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setText(''); setPanel('decline'); }}>Decline</Button>
        </div>
      ) : null}
      {panel ? (
        <form className="mt-3 border-t border-border pt-3" onSubmit={(e) => { e.preventDefault(); if (text.trim()) void answer(panel === 'instead' ? { as: 'apply', to: text.trim() } : { as: 'decline', why: text.trim() }); }}>
          <p className="mb-2 text-[13px] text-muted">{panel === 'instead' ? `What should happen instead? ${sentence(r.author)} sees what was actually done.` : `Why not? ${sentence(r.author)} reads this on the team board.`}</p>
          <Textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} placeholder={panel === 'instead' ? 'e.g. keep it where it is, make the button red' : 'One line'} rows={2} />
          <div className="mt-2 flex items-center gap-1.5">
            <Button size="sm" variant="primary" disabled={busy || !text.trim()}>{panel === 'instead' ? 'Apply this instead' : 'Decline'}</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setPanel(null)}>Cancel</Button>
          </div>
        </form>
      ) : null}
      {error ? <p className="mt-2 text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}
