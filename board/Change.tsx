import { useEffect, useState } from 'react';
import { conversation, DIMENSION_LABEL, kindOptions, nameIn, scopeWords, sentence, STATE_LABEL, STATE_ORDER, type BoardCandidate } from '@/lib/board';
import { When } from '@/components/When';
import { Badge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { errorsOf, post } from './api';
import { Screenshot } from '@/components/Screenshot';
import { MultiSelect } from '@/components/ui/multi-select';
import { Faint, Id, KeyValues, Label, Lede, Meta, PageTitle, Property, PropertyRow, SectionTitle } from '@/components/ui/type';
import type { LocalBoard } from './types';
import { go, href } from './route';
import { areasOf, cap, StateBadge, undecided, WaitingBadge } from './bits';
import { CommentLine, DecisionThread } from './Comments';

/**
 * One change, as the team board shows it (components/ScreenView.tsx): what it is, the picture,
 * the other options, what was decided on it, and what people said. Local: whether anything on it
 * is waiting for your review, which you judge in the Review inbox, and comments read, not written.
 * The Kind filter rides in the hash, like the Overview's: `#/c/W-review-page?kind=visual`.
 */
export function Change({ data, c, at, kinds, refresh }: { data: LocalBoard; c: BoardCandidate; at: string | null; kinds: string[]; refresh: () => Promise<void> }) {
  const cands = data.board.candidates;
  const requests = data.board.requests ?? [];
  const comments = data.comments.filter((x) => x.candidate_id === c.id);
  const version = data.version;
  const current = (x: { board_version?: string | null }) => !version || !x.board_version || x.board_version === version;
  const approvals = comments.filter((x) => x.kind === 'approve');
  const liveApprovals = approvals.filter(current);
  const staleApprovals = approvals.filter((x) => !current(x));
  const talk = (x: { kind: string }) => x.kind === 'comment' || x.kind === 'request';
  const notes = comments.filter((x) => talk(x) && !x.decision_id);
  const said = conversation(notes, requests).length;
  const onDecisions = conversation(comments.filter((x) => talk(x) && x.decision_id), requests).length;
  const by = c.supersededBy ? cands.find((x) => x.id === c.supersededBy) : null;
  const label = c.state === 'superseded' && by ? `Replaced by ${by.name}` : STATE_LABEL[c.state];
  const areaOf = areasOf(data);
  const area = areaOf(c);
  const short = nameIn(area, c.name);
  const siblings = c.work ? [] : cands.filter((x) => x.id !== c.id && !x.work && areaOf(x) === area).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  const approvedBy = liveApprovals.map((a) => a.author_name).join(', ');
  const earlierBy = staleApprovals.map((a) => a.author_name).join(', ');
  const ids = cands.map((x) => x.id);
  const waiting = data.waiting[c.id] ?? 0;
  const kindOpts = kindOptions(c.decisions);
  const picked = kinds.filter((k) => kindOpts.some((o) => o.value === k));
  const listed = picked.length ? c.decisions.filter((d) => picked.includes(d.dimension ?? '')) : c.decisions;
  const fresh = undecided(c);
  // Applies to names a screen, never a file: a decision about one file is about this change.
  const applies = (scope?: string) => (scope?.startsWith('file:') ? short : scopeWords(scope));

  // A link to a decision lands on it, the way the team board's #D-0014 does.
  useEffect(() => {
    if (at) document.getElementById(at)?.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, [c.id, at]);

  return (
    <main className="max-w-4xl">
      <p className="mb-3 text-[13px] text-muted"><a href={href('overview', { section: area })} className="hover:text-fg">{area}</a>{short === area ? null : <> <span className="text-faint">/</span> {short}</>}</p>

      <header>
        <PageTitle>{short}</PageTitle>
        {c.reason && <Lede className="max-w-3xl">“{sentence(c.reason)}”</Lede>}
        {c.notes && <p className="mt-2 max-w-3xl">{c.notes}</p>}
        <PropertyRow>
          {/* Work with nothing judged has no state of its own: Waiting, or, once everything on it is skipped, none.
              Work with something waiting is only Waiting, as on its card; an option keeps its state beside it.
              What's waiting is judged in the Review inbox, which opens at this change. */}
          {fresh && !waiting ? null : <Property label="Status">{waiting ? <WaitingBadge /> : null}{fresh || (waiting && c.work) ? null : <StateBadge state={c.state} label={label} />}{approvedBy && c.state === 'approved' ? <span className="text-muted">by {cap(approvedBy)}</span> : null}{waiting && data.live ? <a href={href('review', { at: c.id })} className="text-muted underline hover:text-fg">{waiting} to review</a> : null}</Property>}
          <Property label="Area"><a href={href('overview', { section: area })} className="hover:underline">{area}</a></Property>
          {fresh ? null : <Property label="Decided by">{cap(c.author)}</Property>}
          <Property label="Date"><When iso={c.date} /></Property>
          {c.url ? <Property label="Live"><a href={c.url} target="_blank" rel="noreferrer" className="underline hover:text-fg">Open →</a></Property> : null}
        </PropertyRow>
        {data.live && !c.work && (c.state === 'generated' || c.state === 'in_review') ? <OptionActions c={c} refresh={refresh} /> : null}
      </header>

      <div className="mt-6 min-w-0">
        {!c.snapshot ? null : <Screenshot src={c.snapshot} alt={c.name} height={440} />}

        {siblings.length ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px]">
            <Meta className="mr-1">Other options</Meta>
            {siblings.map((s) => (
              <a key={s.id} href={href(s.id)} className="group flex items-center gap-2 rounded-ui border border-border bg-surface py-1 pl-1 pr-2.5 hover:border-border-strong">
                <span className="block aspect-[3/2] w-9 overflow-hidden rounded-[3px] bg-surface-2">{s.snapshot ? <img src={s.snapshot} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover object-top" /> : null}</span>
                <span className="group-hover:underline">{nameIn(area, s.name)}</span>
                <StateBadge state={s.state} label={STATE_LABEL[s.state]} />
              </a>
            ))}
          </div>
        ) : null}

        <section className={!c.snapshot && !siblings.length ? 'mt-2' : 'mt-10'}>
          <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <SectionTitle className="mb-0" count={picked.length ? `${listed.length} of ${c.decisions.length}` : c.decisions.length || null}>Decided here</SectionTitle>
            {kindOpts.length ? <MultiSelect label="Kind" values={picked} options={kindOpts} onChange={(v) => go(href(c.id, { kind: v }))} /> : null}
          </div>
          {!c.decisions.length ? <p className="text-[13px] text-muted">{fresh && waiting ? 'Nothing decided yet. What the agent decided here is waiting for your review.' : 'No decisions recorded here yet.'}</p> : (
            <ol className="divide-y divide-border border-t border-border">
              {listed.map((d, i) => {
                const dim = d.dimension ? DIMENSION_LABEL[d.dimension] ?? d.dimension : null;
                const where = applies(d.scope);
                return (
                  <li key={d.id} id={d.id} className="scroll-mt-20 py-5">
                    <div className="mb-3 flex items-center gap-2">
                      <Id className={at === d.id ? 'text-fg' : undefined}>{d.id}</Id>
                      {dim ? <Badge>{dim}</Badge> : null}
                      {d.verdict === 'rule' ? <a href={href('rules', { at: d.id })} title="See it under Design rules" className="rounded-full hover:opacity-75"><Badge tone="ok">Rule</Badge></a> : d.verdict === 'fix' ? <Badge tone="warn">Corrected</Badge> : null}
                      <Faint className="ml-auto">{i + 1} of {listed.length}</Faint>
                    </div>
                    <KeyValues>
                      <Label>Change</Label>
                      <dd className="font-medium">{sentence(d.change ?? d.decision)}</dd>
                      {d.change && d.change !== d.decision ? <><Label>{d.verdict === 'rule' ? 'Rule' : 'Pattern'}</Label><dd className="text-muted">{sentence(d.decision)}</dd></> : null}
                      {d.rejected.length ? <><Label>Rejected</Label><dd className="text-muted">{d.rejected.map((r) => <div key={r}>{sentence(r)}</div>)}</dd></> : null}
                      {where ? <><Label>Applies to</Label><dd className="text-muted">{where}</dd></> : null}
                    </KeyValues>
                    <div className="pl-[calc(6rem+0.75rem)]"><DecisionThread decision={d.id} comments={comments} requests={requests} cards={ids} candidate={c.id} version={version} /></div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* An exported copy carries no comments, so it has no section for them. */}
        {data.live || comments.length ? <section className="mt-10 border-t border-border pt-6">
          <SectionTitle count={said || null} aside={onDecisions ? `${onDecisions} on decisions above` : null}>Comments</SectionTitle>
          {liveApprovals.length ? <p className="mb-1 text-[13px] text-ok">✓ Looks good to {cap(approvedBy)}</p> : null}
          {staleApprovals.length ? <p className="mb-3 text-[13px] text-faint">Looked good to {cap(earlierBy)} on an earlier version</p> : null}
          {notes.length ? (
            <ul className="max-w-2xl space-y-3">
              {notes.map((n) => <CommentLine key={n.id} n={n} stale={!current(n)} requests={requests} cards={ids} candidate={c.id} />)}
            </ul>
          ) : <p className="text-[13px] text-muted">No comments yet.</p>}
          {data.live ? <p className="mt-4 max-w-2xl text-[13px] text-faint">{data.hosted
            ? <>Your team comments on the team board. <code className="font-mono text-[12px]">npx arbiter pull</code> brings what they said here.</>
            : 'Share a team board, and your team can comment, ask for a change, or say it looks good.'}</p> : null}
        </section> : null}
      </div>
    </main>
  );
}

/**
 * An option still open: pick it, turn it down, or mark it in review. Picking one replaces the
 * other options in its area, and the reason is kept on both, so it asks why first.
 */
function OptionActions({ c, refresh }: { c: BoardCandidate; refresh: () => Promise<void> }) {
  const [asking, setAsking] = useState<'approved' | 'rejected' | null>(null);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async (state: string, reason?: string) => {
    setBusy(true);
    const res = await post('/api/candidate', { id: c.id, state, why: reason || undefined });
    setBusy(false);
    if (res.exitCode !== 0) return setError(errorsOf(res));
    setAsking(null);
    await refresh();
  };
  return (
    <div className="mt-4">
      {asking ? (
        <form className="max-w-xl" onSubmit={(e) => { e.preventDefault(); void send(asking, why.trim()); }}>
          <p className="mb-2 text-[13px] text-muted">{asking === 'approved' ? 'Why this one? It’s kept on the options it replaces too.' : 'Why not?'}</p>
          <Textarea autoFocus value={why} onChange={(e) => setWhy(e.target.value)} placeholder="One line" rows={2} />
          <div className="mt-2 flex items-center gap-1.5">
            <Button size="sm" variant="primary" disabled={busy}>{asking === 'approved' ? 'Approve' : 'Reject'}</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAsking(null)}>Cancel</Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" variant="primary" onClick={() => { setWhy(''); setAsking('approved'); }}>Approve</Button>
          <Button size="sm" onClick={() => { setWhy(''); setAsking('rejected'); }}>Reject</Button>
          {c.state === 'generated' ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => send('in_review')}>Mark in review</Button> : null}
        </div>
      )}
      {error ? <p className="mt-2 text-[13px] text-bad">{error}</p> : null}
    </div>
  );
}
