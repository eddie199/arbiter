import { BoardCandidate, STATE_LABEL, STATE_ORDER, sentence } from '@/lib/board';
import { When } from '@/components/When';
import { Thumb } from '@/components/Thumb';
import { KindCover, KindThumb } from '@/components/KindCover';
import { Meta, PageTitle, SectionTitle } from '@/components/ui/type';
import { stateTone } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import type { LocalBoard, QueuedLine } from './types';
import { href } from './route';
import { areasOf, StateBadge, undecided, WaitingBadge } from './bits';
import { Toolbar } from './Toolbar';

/**
 * The team board's Overview (app/p/[slug]/page.tsx), drawn from the repo: every change as a card,
 * by area, with Status and Area filters and search. What's only local: work still waiting for your
 * review has a card too, marked Waiting and shown first, before anything on it is judged.
 */
export function Overview({ data, query }: { data: LocalBoard; query: URLSearchParams }) {
  const q = query.get('q') ?? '';
  const section = query.getAll('section').filter(Boolean);
  const status = query.getAll('status').filter(Boolean);
  const view: 'cards' | 'list' = query.get('view') === 'list' ? 'list' : 'cards';
  const { board, comments } = data;
  const all = board.candidates;
  const areaOf = areasOf(data);
  const allFeatures = [...new Set(all.map(areaOf))];
  const wait = (c: BoardCandidate) => data.waiting[c.id] ?? 0;
  // Work with nothing judged yet is only Waiting: it isn't Decided until you've said so.
  const counts = STATE_ORDER.map((s) => [s, all.filter((c) => c.state === s && !undecided(c)).length] as const).filter(([, n]) => n);
  const waitingCards = all.filter((c) => wait(c)).length;
  const answered = new Set((board.requests ?? []).map((r) => r.comment));
  const asks = (id: string) => comments.filter((x) => x.candidate_id === id && x.kind === 'request' && !answered.has(x.id)).length;
  const queuedOn = (c: BoardCandidate) => data.queued?.[c.id] ?? [];

  const needle = q.trim().toLowerCase();
  const matches = (c: BoardCandidate) => !needle || [c.name, c.reason ?? '', c.notes, ...c.decisions.map((d) => `${d.change ?? ''} ${d.decision}`), ...queuedOn(c).map((d) => `${d.change ?? ''} ${d.decision}`)].join(' ').toLowerCase().includes(needle);
  const hasStatus = (c: BoardCandidate) => status.some((s) => (s === 'waiting' ? wait(c) > 0 : s === c.state && !undecided(c)));
  const cands = all.filter((c) => (!section.length || section.includes(areaOf(c))) && (!status.length || hasStatus(c)) && matches(c));
  const features = allFeatures.filter((f) => cands.some((c) => areaOf(c) === f));
  const filtered = status.length > 0 || section.length > 1 || !!needle;
  // What's waiting for you comes first.
  const byState = (a: BoardCandidate, b: BoardCandidate) => Number(wait(b) > 0) - Number(wait(a) > 0) || STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || allFeatures.indexOf(areaOf(a)) - allFeatures.indexOf(areaOf(b)) || a.id.localeCompare(b.id);
  const flat = [...cands].sort(byState);
  const groups = features.map((f) => ({ f, group: cands.filter((c) => areaOf(c) === f).sort(byState) }));
  const loose = groups.filter((g) => g.group.length === 1);
  const singles = loose.length > 1 ? loose.map((g) => g.group[0]).sort(byState) : [];
  const sections = singles.length ? groups.filter((g) => g.group.length > 1) : groups;
  const areaLabel = (c: BoardCandidate) => (areaOf(c).toLowerCase() === c.name.toLowerCase() ? undefined : areaOf(c));
  const talk = (c: BoardCandidate) => ({ n: comments.filter((x) => x.candidate_id === c.id && x.kind === 'comment').length, asks: asks(c.id), waiting: wait(c), queued: queuedOn(c) });
  const layout = (list: BoardCandidate[], showArea: boolean) => view === 'list' ? (
    <div className="overflow-hidden rounded-lg border border-border">
      {list.map((c, i) => <Row key={c.id} c={c} first={i === 0} area={showArea ? areaLabel(c) : undefined} {...talk(c)} />)}
    </div>
  ) : (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {list.map((c) => <Card key={c.id} c={c} area={showArea ? areaLabel(c) : undefined} {...talk(c)} />)}
    </div>
  );

  return (
    <main>
      {data.pending && data.live ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <div>
            <div className="font-semibold tracking-tight">{data.pending} waiting for your review</div>
            <div className="mt-0.5 text-[13px] text-muted">Decisions the agent made that you haven’t judged yet. Each one joins the board once you have.</div>
          </div>
          <a href={href('review')} className={buttonClass('secondary', 'md')}>Review them</a>
        </div>
      ) : null}
      <div className="mb-4">
        <PageTitle>{section.length === 1 ? section[0] : 'Overview'}</PageTitle>
        <Meta className="mt-0.5 block">{all.length} change{all.length === 1 ? '' : 's'}{board.exported ? <> · as of <When iso={board.exported} /></> : null}</Meta>
      </div>
      {all.length ? (
        <Toolbar
          q={q} section={section} status={status} view={view} total={all.length}
          sections={allFeatures.map((f) => ({ value: f, label: f, hint: String(all.filter((c) => areaOf(c) === f).length) }))}
          statuses={[
            ...(waitingCards ? [{ value: 'waiting', label: 'Waiting', hint: String(waitingCards), tone: 'info' as const }] : []),
            ...counts.map(([s, n]) => ({ value: s, label: STATE_LABEL[s], hint: String(n), tone: stateTone(s) })),
          ]}
        />
      ) : null}
      {!all.length ? (
        <div className="rounded-lg border border-dashed border-border-strong px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">Nothing decided yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">Changes appear here as the agent records what it decided.</p>
        </div>
      ) : null}
      {all.length && !cands.length ? (
        <div className="px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">Nothing matches</p>
          <p className="mt-1 text-[13px] text-muted">{needle ? `Nothing mentions “${q.trim()}”` : 'Nothing in that area with that status'}. <a href={href('overview')} className="underline hover:text-fg">Clear filters</a></p>
        </div>
      ) : null}
      {filtered ? (
        cands.length ? (
          <section className="mt-6">
            <Meta className="mb-3 block">{cands.length} of {all.length} change{all.length === 1 ? '' : 's'}</Meta>
            {layout(flat, section.length !== 1)}
          </section>
        ) : null
      ) : <>
        {singles.length ? <section className="mt-8">{layout(singles, true)}</section> : null}
        {sections.map(({ f, group }) => {
          const options = group.filter((c) => !c.work).length;
          return (
            <section key={f} className="mt-8">
              {sections.length === 1 && !singles.length && group.every((c) => c.work) ? null : <SectionTitle count={options ? `${options} option${options === 1 ? '' : 's'}` : null}>{f}</SectionTitle>}
              {layout(group, false)}
            </section>
          );
        })}
      </>}
    </main>
  );
}

const talkMeta = (n: number, asks: number, waiting: number) => [
  n ? `${n} comment${n === 1 ? '' : 's'}` : '',
  asks ? `${asks} open request${asks === 1 ? '' : 's'}` : '',
  waiting ? `${waiting} waiting for you` : '',
].filter(Boolean);

interface Talk { n: number; asks: number; waiting: number; queued: QueuedLine[] }

const decisionCount = (c: BoardCandidate) => (c.decisions.length ? `${c.decisions.length} decision${c.decisions.length === 1 ? '' : 's'}` : '');

/**
 * Waiting, when there's something to judge. An option keeps its state beside it (Approved, Draft say
 * something); a piece of work's Decided doesn't, and would only crowd the name out of a card.
 */
function Badges({ c, waiting }: { c: BoardCandidate; waiting: number }) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      {waiting ? <WaitingBadge /> : null}
      {waiting && c.work ? null : <StateBadge state={c.state} label={STATE_LABEL[c.state]} />}
    </span>
  );
}

function Card({ c, area, n, asks, waiting, queued }: { c: BoardCandidate; area?: string } & Talk) {
  const lesser = c.state === 'rejected' || c.state === 'superseded';
  const meta = [area, decisionCount(c), ...talkMeta(n, asks, waiting)].filter(Boolean).join(' · ');
  // Work with nothing judged yet reads from what's waiting on it.
  const lines = c.decisions.length ? c.decisions : queued;
  return (
    <a href={href(c.id)} className={`group flex h-full flex-col overflow-hidden rounded-lg border bg-surface transition hover:border-border-strong ${c.state === 'approved' ? 'border-ok/50' : 'border-border'} ${lesser ? 'opacity-60 hover:opacity-100' : ''}`}>
      <div className={`aspect-[3/2] w-full overflow-hidden border-b border-border ${c.snapshot ? 'bg-surface-2' : 'bg-bg'}`}>
        {c.snapshot ? <img src={c.snapshot} alt={c.name} loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
          : <KindCover decisions={lines} option={!c.work} />}
      </div>
      <div className="flex flex-1 flex-col p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="min-w-0 truncate font-semibold leading-snug tracking-tight group-hover:underline" title={c.name}>{c.name}</h3>
          <Badges c={c} waiting={waiting} />
        </div>
        <div className="mt-1.5 h-10 text-sm text-muted">
          {c.reason ? <p className="line-clamp-2">“{sentence(c.reason)}”</p>
            : lines.length ? <ul>{lines.slice(0, 2).map((d) => <li key={d.id} className="line-clamp-1">{sentence(d.change ?? d.decision)}</li>)}</ul>
            : c.notes ? <p className="line-clamp-2">{sentence(c.notes)}</p>
            : null}
        </div>
        <p className="mt-auto pt-2 text-[13px] text-muted">{meta}</p>
      </div>
    </a>
  );
}

function Row({ c, first, area, n, asks, waiting, queued }: { c: BoardCandidate; first: boolean; area?: string } & Talk) {
  const lesser = c.state === 'rejected' || c.state === 'superseded';
  return (
    <a href={href(c.id)} className={`group grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 bg-surface px-3 py-2.5 hover:bg-surface-2 ${first ? '' : 'border-t border-border'} ${lesser ? 'opacity-60 hover:opacity-100' : ''}`}>
      {!c.snapshot
        ? <KindThumb decisions={c.decisions.length ? c.decisions : queued} className="aspect-[3/2] w-16 overflow-hidden rounded-[4px] border border-border bg-bg" />
        : <Thumb src={c.snapshot} alt={c.name} className="aspect-[3/2] w-16 overflow-hidden rounded-[4px] border border-border bg-surface-2" />}
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="min-w-0 font-semibold tracking-tight group-hover:underline sm:truncate">{c.name}</span>
          <Badges c={c} waiting={waiting} />
        </div>
        {c.reason ? <div className="mt-0.5 truncate text-[13px] text-muted">“{sentence(c.reason)}”</div> : null}
      </div>
      <div className="hidden text-right text-[13px] text-muted sm:block">
        <div>{[area, decisionCount(c), ...talkMeta(n, asks, waiting)].filter(Boolean).join(' · ')}</div>
        <div className="text-faint">{sentence(c.author)} · <When iso={c.date} /></div>
      </div>
    </a>
  );
}
