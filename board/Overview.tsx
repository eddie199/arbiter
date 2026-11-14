import { useState } from 'react';
import { BoardCandidate, nameIn, STATE_LABEL, STATE_ORDER, sentence } from '@/lib/board';
import { dayWords, fullDate, When } from '@/components/When';
import { Thumb } from '@/components/Thumb';
import { KindCover, KindThumb } from '@/components/KindCover';
import { Meta, PageTitle, SectionTitle } from '@/components/ui/type';
import { stateTone } from '@/components/ui/badge';
import { buttonClass } from '@/components/ui/button';
import type { LocalBoard, QueuedLine } from './types';
import { href } from './route';
import { areasOf, Counts, ReviewCount, StateBadge, undecided } from './bits';
import { Toolbar } from './Toolbar';
import { Tooltip } from '@/components/ui/tooltip';
import { Kind } from '@/components/ui/icons';

/**
 * How the Overview orders its changes: by area (each area under its heading, what's waiting first), or
 * newest or oldest first as one list across areas. Kept in this browser, like the Review inbox's sort.
 */
const SORT_KEY = 'arbiter-overview-sort';
/** By area, Newest, Oldest, or only what changed Today or Yesterday, newest first. */
type Sort = 'area' | 'new' | 'old' | 'today' | 'yesterday';
const SORT_VALUES: Sort[] = ['area', 'new', 'old', 'today', 'yesterday'];
const DAY: Partial<Record<Sort, string>> = { today: 'Today', yesterday: 'Yesterday' };
const readSort = (): Sort => { try { const s = localStorage.getItem(SORT_KEY) as Sort; return SORT_VALUES.includes(s) ? s : 'area'; } catch { return 'area'; } };

/**
 * The team board's Overview (app/p/[slug]/page.tsx), drawn from the repo: every change as a card,
 * by area, with Status and Area filters and search. What's only local: work still waiting for your
 * review has a card too, marked Waiting and shown first, before anything on it is judged.
 */
export function Overview({ data, query, folder }: { data: LocalBoard; query: URLSearchParams; folder?: { id: string; name: string; areas: string[] } | null }) {
  const q = query.get('q') ?? '';
  const [sort, setSort] = useState<Sort>(readSort);
  const pickSort = (s: string) => { const v = SORT_VALUES.includes(s as Sort) ? (s as Sort) : 'area'; setSort(v); try { localStorage.setItem(SORT_KEY, v); } catch {} };
  // A folder from the side nav shows its areas, each under its own heading, in the folder's order.
  const section = folder ? folder.areas : query.getAll('section').filter(Boolean);
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
  // A card's last change: its latest decision, judged or still waiting.
  const lastOf = (c: BoardCandidate) => queuedOn(c).reduce((a, d) => (d.date > a ? d.date : a), c.date);
  // Today or Yesterday: only what last changed that day, said the way dates are said everywhere.
  const onDay = (c: BoardCandidate, day: string) => dayWords(lastOf(c)) === day;
  const day = DAY[sort];
  const cands = all.filter((c) => (!section.length || section.includes(areaOf(c))) && (!status.length || hasStatus(c)) && matches(c) && (!day || onDay(c, day)));
  const SORTS: { value: Sort; label: string; hint?: string }[] = [
    { value: 'area', label: 'By area', hint: 'Waiting first' },
    { value: 'new', label: 'Newest' },
    { value: 'old', label: 'Oldest' },
    { value: 'today', label: 'Today', hint: String(all.filter((c) => onDay(c, 'Today')).length) },
    { value: 'yesterday', label: 'Yesterday', hint: String(all.filter((c) => onDay(c, 'Yesterday')).length) },
  ];
  const features = (folder ? folder.areas : allFeatures).filter((f) => cands.some((c) => areaOf(c) === f));
  const filtered = status.length > 0 || (!folder && section.length > 1) || !!needle;
  // Newest or Oldest is one list in that order, across areas, each card saying its area.
  const flatOut = filtered || sort !== 'area';
  const byDate = (a: BoardCandidate, b: BoardCandidate) => (sort === 'old' ? lastOf(a).localeCompare(lastOf(b)) : lastOf(b).localeCompare(lastOf(a))) || a.id.localeCompare(b.id);
  // What's waiting for you comes first.
  const byState = (a: BoardCandidate, b: BoardCandidate) => Number(wait(b) > 0) - Number(wait(a) > 0) || STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || allFeatures.indexOf(areaOf(a)) - allFeatures.indexOf(areaOf(b)) || a.id.localeCompare(b.id);
  const flat = [...cands].sort(sort === 'area' ? byState : byDate);
  const groups = features.map((f) => ({ f, group: cands.filter((c) => areaOf(c) === f).sort(byState) }));
  const loose = groups.filter((g) => g.group.length === 1);
  const singles = loose.length > 1 ? loose.map((g) => g.group[0]).sort(byState) : [];
  const sections = singles.length ? groups.filter((g) => g.group.length > 1) : groups;
  const areaLabel = (c: BoardCandidate) => (areaOf(c).toLowerCase() === c.name.toLowerCase() ? undefined : areaOf(c));
  // A card under its area's heading, or with its area in its meta line, needn't say the area again:
  // "Change page — Comments" reads as Comments. The full name stays in its tooltip and on its page.
  const talk = (c: BoardCandidate) => ({ n: comments.filter((x) => x.candidate_id === c.id && x.kind === 'comment').length, asks: asks(c.id), waiting: wait(c), queued: queuedOn(c), label: nameIn(areaOf(c), c.name), last: lastOf(c) });
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
      {/* Only on the Overview itself (Overview picked in the side nav), not inside an area or a folder. */}
      {data.pending && data.live && !folder && !query.getAll('section').length ? (
        <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3">
          <div>
            {/* The inbox's tray beside the count, in the Waiting colour, as on the cards' pills. */}
            <div className="flex items-center gap-2 font-semibold tracking-tight"><span className="text-info">{Kind.waiting()}</span>{data.pending} waiting for your review</div>
            <div className="mt-0.5 pl-6 text-[13px] text-muted">Decisions the agent made that you haven’t judged yet. Each one joins the board once you have.</div>
          </div>
          <a href={href('review')} className={buttonClass('secondary', 'md')}>Review them</a>
        </div>
      ) : null}
      <div className="mb-4">
        <PageTitle>{folder ? folder.name : section.length === 1 ? section[0] : 'Overview'}</PageTitle>
        {/* What's on screen: this area or folder, narrowed by Status, search and Today or Yesterday. */}
        <Meta className="mt-0.5 block">{cands.length} change{cands.length === 1 ? '' : 's'}{!data.live && board.exported ? <> · as of {fullDate(board.exported)}</> : null}</Meta>
      </div>
      {all.length ? (
        <Toolbar
          q={q} section={folder ? [] : section} folder={folder?.id} status={status} view={view} total={all.length}
          sort={{ value: sort, options: SORTS, onChange: pickSort }}
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
      {folder && !folder.areas.length ? (
        <div className="px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">This folder is empty</p>
          <p className="mt-1 text-[13px] text-muted">{data.live ? 'Drag areas into it in the side nav, or use Move to in an area’s menu.' : 'Nothing has been put in it yet.'}</p>
        </div>
      ) : all.length && !cands.length && day && !filtered ? (
        <div className="px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">Nothing changed {day.toLowerCase()}</p>
          <p className="mt-1 text-[13px] text-muted">The agent hasn’t recorded anything {day.toLowerCase()}. <button type="button" onClick={() => pickSort('new')} className="underline hover:text-fg">Show newest</button></p>
        </div>
      ) : all.length && !cands.length ? (
        <div className="px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">Nothing matches</p>
          <p className="mt-1 text-[13px] text-muted">{needle ? `Nothing mentions “${q.trim()}”` : 'Nothing in that area with that status'}. <a href={href('overview')} className="underline hover:text-fg">Clear filters</a></p>
        </div>
      ) : null}
      {flatOut ? (
        cands.length ? (
          <section className="mt-6">
            {filtered ? <Meta className="mb-3 block">{cands.length} of {all.length} change{all.length === 1 ? '' : 's'}</Meta> : null}
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

interface Talk { n: number; asks: number; waiting: number; queued: QueuedLine[]; label: string; last: string }

/**
 * A pill only when it tells you something: what's waiting for you, as the inbox's tray and a count, and
 * an option's state (Approved, Draft, Replaced). A piece of work is Decided once judged, the usual case
 * on a board, so it has no pill: a board of Decided pills hides the few that matter.
 */
function Badges({ c, waiting }: { c: BoardCandidate; waiting: number }) {
  if (!waiting && c.work) return null;
  return (
    <span className="flex shrink-0 items-center gap-1">
      {waiting ? <ReviewCount n={waiting} /> : null}
      {c.work ? null : <StateBadge state={c.state} label={STATE_LABEL[c.state]} />}
    </span>
  );
}

function Card({ c, area, n, asks, waiting, queued, label, last }: { c: BoardCandidate; area?: string } & Talk) {
  const lesser = c.state === 'rejected' || c.state === 'superseded';
  // Work with nothing judged yet reads from what's waiting on it.
  const lines = c.decisions.length ? c.decisions : queued;
  return (
    <a href={href(c.id)} className={`group flex h-full flex-col overflow-hidden rounded-lg border bg-surface transition hover:border-border-strong ${c.state === 'approved' ? 'border-ok/50' : 'border-border'} ${lesser ? 'opacity-60 hover:opacity-100' : ''}`}>
      <div className={`aspect-[3/2] w-full overflow-hidden border-b border-border ${c.snapshot ? 'bg-surface-2' : 'bg-bg'}`}>
        {c.snapshot ? <img src={c.snapshot} alt={c.name} loading="lazy" decoding="async" className="h-full w-full object-cover object-top" />
          : <KindCover decisions={lines} option={!c.work} />}
      </div>
      {/* The title gets the card's width and up to two lines. Under the description, one line: the pill
          (what's waiting for you, or an option's state), then the counts as icons and numbers. */}
      <div className="flex flex-1 flex-col p-4">
        {area ? <p className="mb-0.5 truncate text-[12px] text-faint">{area}</p> : null}
        <Tooltip label={c.name}><h3 className="line-clamp-2 break-words font-semibold leading-snug tracking-tight group-hover:underline">{label}</h3></Tooltip>
        {/* One description under the title, up to two lines, the same one a row shows: the reason, else what changed first, else the notes.
            The first line runs the card's width; the last stops about two words short of the edge. Two floats do it: an
            empty one a line tall, then a 64px one cleared under it, on the second line. They sit in a block inside the
            clamped box, so the clamp still cuts the text at two lines with its "…". */}
        <div className="mt-1.5 h-10 line-clamp-2 text-sm text-muted">
          <p>
            <span aria-hidden="true" className="float-right h-5 w-0" />
            <span aria-hidden="true" className="clear-right float-right h-5 w-16" />
            {c.reason ? `“${sentence(c.reason)}”` : lines.length ? sentence(lines[0].change ?? lines[0].decision) : c.notes ? sentence(c.notes) : null}
          </p>
        </div>
        {/* When it last changed sits at the far right, in the same corner on every card, so a column scans by date. */}
        <div className="mt-auto flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 pt-3">
          <Badges c={c} waiting={waiting} />
          <Counts decisions={c.decisions.length} comments={n} requests={asks} />
          <When iso={last} className="ml-auto text-[12px] text-faint" />
        </div>
      </div>
    </a>
  );
}

/**
 * A row in list view, the card's facts in one line: the name with a line of what changed under it; on
 * the right, in one line, where it sits and when it last changed, then what's waiting and the counts. No author or time of day: on the local board it's always you, and the day is what tells.
 * On a phone the right-hand side moves under the description.
 */
function Row({ c, first, area, n, asks, waiting, queued, label, last }: { c: BoardCandidate; first: boolean; area?: string } & Talk) {
  const lesser = c.state === 'rejected' || c.state === 'superseded';
  const lines = c.decisions.length ? c.decisions : queued;
  const what = c.reason ? `“${sentence(c.reason)}”` : lines.length ? sentence(lines[0].change ?? lines[0].decision) : c.notes ? sentence(c.notes) : '';
  const when = <When iso={last} />;
  const facts = <><Badges c={c} waiting={waiting} /><Counts decisions={c.decisions.length} comments={n} requests={asks} /></>;
  return (
    <a href={href(c.id)} className={`group grid grid-cols-[64px_minmax(0,1fr)_auto] items-center gap-4 bg-surface px-3 py-2.5 hover:bg-surface-2 ${first ? '' : 'border-t border-border'} ${lesser ? 'opacity-60 hover:opacity-100' : ''}`}>
      {!c.snapshot
        ? <KindThumb decisions={lines} className="aspect-[3/2] w-16 overflow-hidden rounded-[4px] border border-border bg-bg" />
        : <Thumb src={c.snapshot} alt={c.name} className="aspect-[3/2] w-16 overflow-hidden rounded-[4px] border border-border bg-surface-2" />}
      <div className="min-w-0">
        {/* The area, when it isn't the heading above, sits just after the name, quieter. */}
        <div className="flex min-w-0 items-baseline gap-2">
          <Tooltip label={c.name}><span className="truncate font-semibold tracking-tight group-hover:underline">{label}</span></Tooltip>
          {area ? <span className="shrink-0 text-[12px] text-faint">{area}</span> : null}
        </div>
        {/* Cut off well before the right-hand side, so a row reads as a name and a glance, not a paragraph. */}
        {what ? <Tooltip label={what}><div className="mt-0.5 max-w-md truncate text-[13px] text-muted">{what}</div></Tooltip> : null}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-faint sm:hidden">{facts}<span>{when}</span></div>
      </div>
      {/* Area and date first, then what's waiting and the counts, side by side. Whatever a row hasn't got
          takes no room: the rest closes up to the right edge, with no empty slot left for it. */}
      <div className="hidden items-center gap-3 sm:flex">
        <span className="whitespace-nowrap text-[12px] text-faint">{when}</span>
        {facts}
      </div>
    </a>
  );
}
