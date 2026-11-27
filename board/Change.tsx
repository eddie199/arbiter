import { useEffect, useState } from 'react';
import { conversation, decisionText, DIMENSION_LABEL, kindOptions, nameIn, sameHead, scopeWords, sentence, statusOf, statusRank, verdictLabel, type BoardCandidate } from '@/lib/board';
import { When } from '@/components/When';
import { Badge } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import { Screenshot } from '@/components/Screenshot';
import { MultiSelect } from '@/components/ui/multi-select';
import { Faint, Id, KeyValues, Label, Lede, Meta, PageTitle, Property, PropertyRow, SectionTitle } from '@/components/ui/type';
import type { LocalBoard } from './types';
import { go, href } from './route';
import { arbiter, areasOf, cap, CHIP, endedWords, PLANS, StatusBadge, undecided, WaitingBadge } from './bits';
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
  const status = statusOf(c);
  // The option approved over it, by the name its own card shows: without the area when that's the area it's in.
  const instead = c.state === 'superseded' && by ? nameIn(areaOf(by), by.name) : null;
  // The other options in its set: same area, names that start the same.
  const siblings = c.work ? [] : cands.filter((x) => x.id !== c.id && !x.work && areaOf(x) === area && sameHead(x, c)).sort((a, b) => statusRank(a) - statusRank(b));
  // An option approved in its set while this one is still proposed: this one came after the choice.
  const keptOption = siblings.find((x) => x.state === 'approved');
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
    // About 54px apart, the same in a divided list and a version section: 20px above, and below it the faint
    // Copy and Edit row and 8px (32px in an exported copy, which has no such row).
    return (
      <li key={d.id} id={d.id} className={`group/decision scroll-mt-20 pt-5 ${data.live ? 'pb-2' : 'pb-8'}`}>
        <div className="mb-3 flex items-center gap-2">
          <Id className={at === d.id ? 'text-fg' : undefined}>{d.id}</Id>
          {dim ? <Badge>{dim}</Badge> : null}
          {/* Out of DECISIONS.md: how it left, on hover, and a link to where Design rules keeps it (or the rule that replaced it). */}
          {(status === 'Retired' || status === 'Replaced') ? <Tooltip label={`${d.ended ? `${endedWords(d.ended)}. ` : ''}See it under Design rules.`}><a href={href('rules', { at: d.ended?.kind === 'replaced' && d.ended.by ? d.ended.by.id : d.id })} className="inline-flex rounded-full hover:opacity-75"><Badge>{status}</Badge></a></Tooltip> : status === 'Rule' ? <Tooltip label="See it under Design rules"><a href={href('rules', { at: d.id })} className="inline-flex rounded-full hover:opacity-75"><Badge tone="ok">Rule</Badge></a></Tooltip> : null}
          {/* An exception says so on its top line, as a clash does in the Review inbox; the Exception to row names the rule. */}
          {d.against ? <Badge tone="warn">Exception</Badge> : null}
          <Faint className="ml-auto">{i + 1} of {ordered.length}</Faint>
        </div>
        <KeyValues>
          <Label>Change</Label>
          <dd className="font-medium">{sentence(d.change ?? d.decision)}</dd>
          {d.change && d.change !== d.decision ? <><Label>{d.verdict === 'rule' ? 'Rule' : 'Pattern'}</Label><dd className="text-muted">{sentence(d.decision)}</dd></> : null}
          {d.rejected.length ? <><Label>Rejected</Label><dd className="text-muted">{d.rejected.map((r) => <div key={r}>{sentence(r)}</div>)}</dd></> : null}
          {where ? <><Label>Applies to</Label><dd className="text-muted">{where}</dd></> : null}
          {/* Last, like the inbox's Clashes row: the rule's id in the same chip, linking to it, its words muted. Grey,
              not red: the call is made, nothing waits on you. */}
          {d.against ? <><Label>Exception to</Label><dd className="text-muted"><Tooltip label={`${d.against.rationale ? `${sentence(d.against.rationale).replace(/\.$/, '')}. ` : ''}See it under Design rules.`}><a href={href('rules', { at: d.against.id })} className={`${CHIP} hover:border-border-strong`}>{d.against.id}</a></Tooltip> {sentence(d.against.decision)}</dd></> : null}
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
        {/* One line: the reason in quotes (why it won or lost), then the agent's few words on what it is. */}
        {c.reason || c.notes ? <Lede className="max-w-3xl">{c.reason ? `“${sentence(c.reason)}”` : null}{c.reason && c.notes ? <span className="text-faint"> · </span> : null}{c.notes}</Lede> : null}
        <PropertyRow>
          {/* Work with nothing judged has no status of its own: Waiting, or, once everything on it is skipped, none.
              Work with something waiting is only Waiting, as on its card; an option keeps Proposed, Approved or
              Rejected beside it. Proposed says on hover how to choose: by telling your agent, not here.
              Rejected because another was approved says which. Its own status comes first, then Waiting beside
              its count, which opens the Review inbox at this change. */}
          {fresh && !waiting ? null : <Property label="Status">{fresh || (waiting && c.work) ? null : <StatusBadge status={status} tip={status === 'proposed' ? (data.live ? 'Not chosen yet. Tell your agent which one to keep.' : 'Not chosen yet.') : undefined} />}{instead ? <span className="text-muted">{instead} was approved instead</span> : null}{approvedBy && c.state === 'approved' ? <span className="text-muted">by {cap(approvedBy)}</span> : null}{waiting ? <WaitingBadge /> : null}{waiting && data.live ? <a href={href('review', { at: c.id })} className="text-muted underline hover:text-fg">{waiting} to review</a> : null}</Property>}
          <Property label="Area"><a href={href('overview', { section: area })} className="hover:underline">{area}</a></Property>
          {/* Nothing is decided on an option until you approve or reject it, so it names no one till then. */}
          {fresh || status === 'proposed' ? null : <Property label="Decided by">{cap(c.author)}</Property>}
          <Property label="Date"><When iso={c.date} time /></Property>
          {c.url ? <Property label="Live"><a href={c.url} target="_blank" rel="noreferrer" className="underline hover:text-fg">Open →</a></Property> : null}
        </PropertyRow>
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
                <StatusBadge status={statusOf(s)} />
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
          ) : !c.decisions.length && status === 'proposed' && data.live ? (
            // Proposed: the same shape, about the choice. No button: you choose by telling your agent, which keeps your reason.
            <div className="rounded-lg border border-border bg-surface px-4 py-3">
              <div className="font-semibold tracking-tight">{keptOption ? `${nameIn(area, keptOption.name)} is approved` : siblings.length ? `${siblings.length + 1} options, none chosen yet` : 'Not chosen yet'}</div>
              <div className="mt-0.5 text-[13px] text-muted">{keptOption ? 'This one came later. Tell your agent if you’d rather keep it, and why.' : siblings.length ? 'Tell your agent which one to keep, and why. The other options become Rejected, with your reason.' : 'Tell your agent whether to keep it, and why.'}</div>
            </div>
          ) : !c.decisions.length ? <p className="text-[13px] text-muted">{fresh && waiting ? 'Nothing decided yet. What the agent decided here is waiting for your review.' : 'No decisions recorded here yet.'}</p> : (
            versions.length > 1 ? <VersionGroups groups={byVersion(ordered, versions)} versions={versions} onShow={(i) => { pick(i); document.getElementById('picture')?.scrollIntoView({ block: 'start', behavior: 'smooth' }); }} item={item} />
              : <ol className="divide-y divide-border border-t border-border">{withRemoved.map(item)}</ol>
          )}
        </section>

        {/* An exported copy carries no comments, so it has no section for them. Comments come from a
            team board; without one, the title says so in a few faint words, and nothing more. */}
        {/* After a list of decisions on the live board, closer: each decision already ends in its faint Copy and Edit
            row, so 22px here puts Comments as far from the last one as decisions are from each other (about 56px). */}
        {data.live || comments.length ? <section className={`${data.live && withRemoved.length ? 'mt-[22px]' : 'mt-10'} border-t border-border pt-6`}>
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
          {data.live && data.hosted ? <p className="mt-4 max-w-2xl text-[13px] text-faint">Your team comments on the team board. <code className="font-mono text-[12px]">{arbiter('pull')}</code> brings what they said here.</p> : null}
        </section> : null}
      </div>
    </main>
  );
}
