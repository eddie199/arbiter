import { useEffect, useState } from 'react';
import { conversation, decisionText, DIMENSION_LABEL, kindOptions, nameIn, scopeWords, sentence, STATE_LABEL, STATE_ORDER, verdictLabel, type BoardCandidate } from '@/lib/board';
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
import { areasOf, cap, PLANS, StateBadge, undecided, WaitingBadge } from './bits';
import { CommentLine, DecisionThread } from './Comments';
import { ChangeMenu } from './ChangeMenu';
import { byVersion, VersionGroups, VersionRow } from './Versions';
import { DecisionActions, RemovedDecision, type Removal } from './DecisionActions';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * One change, as the team board shows it (components/ScreenView.tsx): what it is, the picture,
 * the other options, what was decided on it, and what people said. Local: whether anything on it
 * is waiting for your review, which you judge in the Review inbox, and comments read, not written.
 * The Type filter rides in the hash, like the Overview's: `#/c/W-review-page?type=visual`.
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
  const areaOf = areasOf(data);
  const area = areaOf(c);
  const short = nameIn(area, c.name);
  // What replaced it, by the name its own card shows: without the area when that's the area it's in.
  const label = c.state === 'superseded' && by ? `Replaced by ${nameIn(areaOf(by), by.name)}` : STATE_LABEL[c.state];
  const siblings = c.work ? [] : cands.filter((x) => x.id !== c.id && !x.work && areaOf(x) === area).sort((a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state));
  const approvedBy = liveApprovals.map((a) => a.author_name).join(', ');
  const earlierBy = staleApprovals.map((a) => a.author_name).join(', ');
  const ids = cands.map((x) => x.id);
  const waiting = data.waiting[c.id] ?? 0;
  const kindOpts = kindOptions(c.decisions);
  const picked = kinds.filter((k) => kindOpts.some((o) => o.value === k));
  const listed = picked.length ? c.decisions.filter((d) => picked.includes(d.dimension ?? '')) : c.decisions;
  const fresh = undecided(c);
  // Its pictures, oldest first, when it has had more than one. The picture shows the latest unless you pick another.
  const versions = c.versions ?? [];
  const [chosen, setChosen] = useState<number | null>(null);
  const showing = chosen !== null && chosen < versions.length ? chosen : versions.length - 1;
  const pick = (i: number) => setChosen(i === versions.length - 1 ? null : i);
  // With versions, decisions count in the order they were made, so the numbers follow the timeline.
  // Decisions removed on this page stay in their place, faded, with Undo, while it's open.
  const [removed, setRemoved] = useState<Record<string, Removal>>({});
  const gone = Object.values(removed).filter((r) => r.kind === 'decision' && !listed.some((x) => x.id === r.d.id)).map((r) => r.d as (typeof listed)[number]);
  const withRemoved = gone.length ? [...listed, ...gone].sort((a, b) => a.id.localeCompare(b.id)) : listed;
  const ordered = versions.length > 1 ? [...withRemoved].sort((a, b) => Date.parse(a.date ?? '') - Date.parse(b.date ?? '')) : listed;
  // Applies to names a screen, never a file: a decision about one file is about this change.
  const applies = (scope?: string) => (scope?.startsWith('file:') ? short : scopeWords(scope));

  // One decision in Decided here: its id and kind, then Change, Rule or Pattern, Rejected, Applies to.
  const item = (d: (typeof listed)[number]) => {
    if (removed[d.id]) return <RemovedDecision key={d.id} r={removed[d.id]} refresh={refresh} onUndone={() => setRemoved(({ [d.id]: _, ...x }) => x)} />;
    const i = ordered.indexOf(d);
    const dim = d.dimension ? DIMENSION_LABEL[d.dimension] ?? d.dimension : null;
    const where = applies(d.scope);
    const status = verdictLabel(d);
    // Copy takes the decision as it reads here, id first, to paste into a doc or a chat.
    const text = decisionText(d, where);
    return (
      <li key={d.id} id={d.id} className="group/decision scroll-mt-20 py-5">
        <div className="mb-3 flex items-center gap-2">
          <Id className={at === d.id ? 'text-fg' : undefined}>{d.id}</Id>
          {dim ? <Badge>{dim}</Badge> : null}
          {status === 'Retired' ? <Badge>Retired</Badge> : status === 'Rule' ? <Tooltip label="See it under Design rules"><a href={href('rules', { at: d.id })} className="inline-flex rounded-full hover:opacity-75"><Badge tone="ok">Rule</Badge></a></Tooltip> : status === 'Corrected' ? <Badge tone="warn">Corrected</Badge> : null}
          <Faint className="ml-auto">{i + 1} of {ordered.length}</Faint>
        </div>
        <KeyValues>
          <Label>Change</Label>
          <dd className="font-medium">{sentence(d.change ?? d.decision)}</dd>
          {d.change && d.change !== d.decision ? <><Label>{d.verdict === 'rule' ? 'Rule' : 'Pattern'}</Label><dd className="text-muted">{sentence(d.decision)}</dd></> : null}
          {d.rejected.length ? <><Label>Rejected</Label><dd className="text-muted">{d.rejected.map((r) => <div key={r}>{sentence(r)}</div>)}</dd></> : null}
          {where ? <><Label>Applies to</Label><dd className="text-muted">{where}</dd></> : null}
        </KeyValues>
        {data.live ? <DecisionActions d={d} copyText={text} last={!!c.work && c.decisions.length === 1} refresh={refresh} onRemoved={(r) => setRemoved((x) => ({ ...x, [d.id]: r }))} /> : null}
        <div className="pl-[calc(6rem+0.75rem)]"><DecisionThread decision={d.id} comments={comments} requests={requests} cards={ids} candidate={c.id} version={version} /></div>
      </li>
    );
  };

  // A link to a decision lands on it, the way the team board's #D-0014 does.
  useEffect(() => {
    if (at) document.getElementById(at)?.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, [c.id, at]);

  return (
    <main className="max-w-4xl">
      <p className="mb-3 text-[13px] text-muted"><a href={href('overview', { section: area })} className="hover:text-fg">{area}</a>{short === area ? null : <> <span className="text-faint">/</span> {short}</>}</p>

      <header>
        <div className="flex items-start justify-between gap-4">
          <PageTitle className="min-w-0">{short}</PageTitle>
          {data.live ? <ChangeMenu c={c} area={area} short={short} areas={[...new Set(cands.map(areaOf))].sort((x, y) => x.localeCompare(y))} others={cands.filter((x) => x.work && x.id !== c.id).map((x) => ({ name: x.name, area: areaOf(x) }))} waiting={waiting} refresh={refresh} /> : null}
        </div>
        {c.reason && <Lede className="max-w-3xl">“{sentence(c.reason)}”</Lede>}
        {c.notes && <p className="mt-2 max-w-3xl">{c.notes}</p>}
        <PropertyRow>
          {/* Work with nothing judged has no state of its own: Waiting, or, once everything on it is skipped, none.
              Work with something waiting is only Waiting, as on its card; an option keeps its state beside it.
              What's waiting is judged in the Review inbox, which opens at this change. */}
          {fresh && !waiting ? null : <Property label="Status">{waiting ? <WaitingBadge /> : null}{fresh || (waiting && c.work) ? null : <StateBadge state={c.state} label={label} />}{approvedBy && c.state === 'approved' ? <span className="text-muted">by {cap(approvedBy)}</span> : null}{waiting && data.live ? <a href={href('review', { at: c.id })} className="text-muted underline hover:text-fg">{waiting} to review</a> : null}</Property>}
          <Property label="Area"><a href={href('overview', { section: area })} className="hover:underline">{area}</a></Property>
          {fresh ? null : <Property label="Decided by">{cap(c.author)}</Property>}
          <Property label="Date"><When iso={c.date} time /></Property>
          {c.url ? <Property label="Live"><a href={c.url} target="_blank" rel="noreferrer" className="underline hover:text-fg">Open →</a></Property> : null}
        </PropertyRow>
        {data.live && !c.work && (c.state === 'generated' || c.state === 'in_review') ? <OptionActions c={c} refresh={refresh} /> : null}
      </header>

      <div className="mt-6 min-w-0">
        {!c.snapshot ? null : <div id="picture" className="scroll-mt-20"><Screenshot src={versions.length > 1 ? versions[showing].src : c.snapshot} alt={c.name} height={440} tag={versions.length > 1 ? `Version ${showing + 1}` : undefined} /></div>}
        {versions.length > 1 ? <VersionRow versions={versions} shown={showing} onShow={pick} /> : null}

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
            <SectionTitle className="mb-0!" count={picked.length ? `${listed.length} of ${c.decisions.length}` : c.decisions.length || null}>Decided here</SectionTitle>
            {kindOpts.length ? <MultiSelect label="Type" values={picked} options={kindOpts} onChange={(v) => go(href(c.id, { type: v }))} /> : null}
          </div>
          {/* Nothing judged yet, everything waiting: the way on is the Review inbox, opened at this change. The
              same shape as the Overview's banner, so it reads as the same call to act. */}
          {!c.decisions.length && fresh && waiting && data.live ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
              <div>
                <div className="font-semibold tracking-tight">{waiting} waiting for your review</div>
                <div className="mt-0.5 text-[13px] text-muted">Nothing is decided here yet. Each decision shows here once you’ve judged it.</div>
              </div>
              <a href={href('review', { at: c.id })} className={buttonClass('secondary', 'md')}>Review {waiting === 1 ? 'it' : 'them'}</a>
            </div>
          ) : !c.decisions.length ? <p className="text-[13px] text-muted">{fresh && waiting ? 'Nothing decided yet. What the agent decided here is waiting for your review.' : 'No decisions recorded here yet.'}</p> : (
            versions.length > 1 ? <VersionGroups groups={byVersion(ordered, versions)} versions={versions} onShow={(i) => { pick(i); document.getElementById('picture')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }} item={item} />
              : <ol className="divide-y divide-border border-t border-border">{withRemoved.map(item)}</ol>
          )}
        </section>

        {/* An exported copy carries no comments, so it has no section for them. Comments come from a
            team board; without one, the title says so in a few faint words, and nothing more. */}
        {data.live || comments.length ? <section className="mt-10 border-t border-border pt-6">
          <SectionTitle count={said || null} aside={onDecisions ? `${onDecisions} on decisions above` : null}>
            Comments
            {/* Smaller than the title, so it reads as a note, not part of the heading. */}
            {!onDecisions && data.live && !data.hosted ? <>{' '}<a href={PLANS} target="_blank" rel="noreferrer" className="ml-1 text-[13px] font-normal text-faint hover:underline">Available with Arbiter Team</a></> : null}
          </SectionTitle>
          {liveApprovals.length ? <p className="mb-1 text-[13px] text-ok">✓ Looks good to {cap(approvedBy)}</p> : null}
          {staleApprovals.length ? <p className="mb-3 text-[13px] text-faint">Looked good to {cap(earlierBy)} on an earlier version</p> : null}
          {notes.length ? (
            <ul className="max-w-2xl space-y-3">
              {notes.map((n) => <CommentLine key={n.id} n={n} stale={!current(n)} requests={requests} cards={ids} candidate={c.id} />)}
            </ul>
          ) : <p className="text-[13px] text-muted">No comments yet.</p>}
          {data.live && data.hosted ? <p className="mt-4 max-w-2xl text-[13px] text-faint">Your team comments on the team board. <code className="font-mono text-[12px]">npx arbiter pull</code> brings what they said here.</p> : null}
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
