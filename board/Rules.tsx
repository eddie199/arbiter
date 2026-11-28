import { useEffect, useState } from 'react';
import { decisionText, DIMENSION_LABEL, nameIn, scopeWords, sentence, type BoardRule } from '@/lib/board';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip } from '@/components/ui/tooltip';
import { Textarea } from '@/components/ui/input';
import { SearchButton } from '@/components/ui/search-button';
import { MultiSelect } from '@/components/ui/multi-select';
import { ActionItem, ActionMenu, barDots, DOTS } from '@/components/ui/menu';
import { Icon } from '@/components/ui/icons';
import { Id, Meta, PageTitle, SectionTitle } from '@/components/ui/type';
import { When } from '@/components/When';
import type { LocalBoard } from './types';
import { errorsOf, post } from './api';
import { areasOf, CHIP, rulesFile, TRAY } from './bits';
import { RemoveDialog } from './RemoveDialog';
import { saveKeys } from './keys';
import { go, href } from './route';

/**
 * Design rules, as the team board shows them (app/p/[slug]/rules/page.tsx), with how full the list is.
 * Download gives you the file. Served live, each rule can be copied, edited or removed in place. A
 * removed one keeps its row, faded, with Undo while the page is open.
 */
export function Rules({ data, at, cap, refresh, query }: { data: LocalBoard; at: string | null; cap?: number; refresh: () => Promise<void>; query: URLSearchParams }) {
  const rules: BoardRule[] = data.board.rules ?? [];
  // Filters ride in the hash, like the Overview's: `#/rules?type=visual&q=pill`. An older `kind=` link still works.
  const kinds = [...query.getAll('type'), ...query.getAll('kind')].filter((k) => k in DIMENSION_LABEL);
  const q = query.get('q') ?? '';
  const needle = q.trim().toLowerCase();
  const fits = (r: BoardRule) => (!kinds.length || kinds.includes(r.dimension)) && (!needle || `${r.id} ${r.decision} ${r.rationale}`.toLowerCase().includes(needle));
  const filtered = kinds.length > 0 || !!needle;
  const screens = new Map(data.board.candidates.map((c) => [c.id, c]));
  const areaOf = areasOf(data);
  // Copy for a rule reads as it does on its change's page: the decision there, a file named by that change.
  const copyOf = (r: BoardRule) => {
    for (const c of data.board.candidates) {
      const d = c.decisions.find((x) => x.id === r.id);
      if (d) return decisionText(d, d.scope?.startsWith('file:') ? nameIn(areaOf(c), c.name) : scopeWords(d.scope));
    }
    return decisionText({ id: r.id, dimension: r.dimension, verdict: 'rule', decision: r.decision, change: null, rejected: [] }, null);
  };
  // Removed here, kept as they were so each stays in its place until the page closes.
  const [removed, setRemoved] = useState<Record<string, { rule: BoardRule; why: string }>>({});
  const gone = (id: string) => !!removed[id] && !rules.some((r) => r.id === id);
  const all = [...rules, ...Object.values(removed).map((x) => x.rule).filter((r) => gone(r.id))];
  const shown = all.filter(fits);
  // Rules taken out of DECISIONS.md, under Retired at the bottom: closed until you open it, a filter finds
  // one there, or a link lands on one.
  const retired = data.board.retired ?? [];
  const retiredShown = retired.filter(fits);
  const [retiredOpen, setRetiredOpen] = useState(false);
  const showRetired = retiredOpen || (filtered && retiredShown.length > 0) || (!!at && retired.some((r) => r.id === at));
  useEffect(() => {
    if (at) document.getElementById(at)?.scrollIntoView({ block: 'start' });
    else window.scrollTo(0, 0);
  }, [at]);

  // Back in DECISIONS.md first, then its row is a rule again.
  const restore = async (id: string): Promise<string | null> => {
    const err = await restoreRule(id, refresh);
    if (!err) setRemoved(({ [id]: _, ...x }) => x);
    return err;
  };

  return (
    <main>
      <div className="mb-2 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <PageTitle>Design rules</PageTitle>
          {/* Muted like every page's subline, however near the limit: amber is for pills only. */}
          <Meta className="mt-0.5 block">
            {/* A read-only copy speaks to whoever it was sent to, as its guide does: the rules aren't theirs. */}
            {!data.live ? `${rules.length} rule${rules.length === 1 ? '' : 's'} this project’s designs follow.`
              : rules.length ? `${rules.length} rule${rules.length === 1 ? '' : 's'} you’ve saved in ${rulesFile()}. Everything new follows ${rules.length === 1 ? 'it' : 'them'}.` : `The rules you save in ${rulesFile()}. Everything new follows them.`}
            {cap && rules.length >= cap ? ' Full: a new rule has to replace one.' : null}
          </Meta>
        </div>
      </div>
      {rules.length ? <RulesFilter data={data} rules={rules} kinds={kinds} q={q} /> : null}
      {filtered && all.length && !shown.length && !retiredShown.length ? (
        <div className="px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">No rules match</p>
          <p className="mt-1 text-[13px] text-muted">{needle ? `Nothing mentions “${q.trim()}”` : 'No rules of that type'}. <a href={href('rules')} className="underline hover:text-fg">Clear filters</a></p>
        </div>
      ) : null}
      {!all.length ? (
        <div className="mt-6 rounded-lg border border-dashed border-border-strong px-6 py-16 text-center">
          <p className="font-semibold tracking-tight">No design rules yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">A design rule is a decision you saved as “always”. Make one in your Review inbox and it shows up here.</p>
        </div>
      ) : null}
      {Object.entries(DIMENSION_LABEL).map(([dim, label]) => {
        // In id order, as DECISIONS.md has them, so a removed rule keeps its place.
        const rs = shown.filter((r) => r.dimension === dim).sort((a, b) => a.id.localeCompare(b.id));
        if (!rs.length) return null;
        return (
          <section key={dim} className="mt-8">
            <SectionTitle count={rs.filter((r) => !gone(r.id)).length || null}>{label}</SectionTitle>
            <ul className="divide-y divide-border border-t border-border">
              {rs.map((r) => gone(r.id)
                ? <RemovedRow key={r.id} r={r} why={removed[r.id].why} onUndo={restore} />
                : <RuleRow key={r.id} r={r} at={at} from={r.candidate ? screens.get(r.candidate) ?? null : null} live={data.live} copyText={copyOf(r)} onRemoved={(why) => setRemoved((x) => ({ ...x, [r.id]: { rule: r, why } }))} refresh={refresh} />)}
            </ul>
          </section>
        );
      })}
      {retiredShown.length ? (
        <section className="mt-10">
          <SectionTitle count={retiredShown.length}>
            <button type="button" aria-expanded={showRetired} onClick={() => setRetiredOpen(!showRetired)} className="inline-flex items-center gap-1.5 rounded-ui outline-none hover:text-muted focus-visible:ring-1 focus-visible:ring-border-strong">
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`shrink-0 text-faint transition-transform ${showRetired ? 'rotate-90' : ''}`}><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
              Retired
            </button>
          </SectionTitle>
          {showRetired ? (
            <>
              {/* A read-only copy speaks to whoever it was sent to: the agent and the limit aren't theirs. */}
              <Meta className="-mt-1 mb-3 block">{data.live ? `Out of ${rulesFile()}, so your agent no longer follows them.` : `Out of ${rulesFile()}: new work no longer follows them.`}</Meta>
              <ul className="divide-y divide-border border-t border-border">
                {retiredShown.map((r) => <RetiredRow key={r.id} r={r} at={at} />)}
              </ul>
            </>
          ) : null}
        </section>
      ) : null}
    </main>
  );
}

/**
 * A rule taken out of DECISIONS.md, under Retired: its words and reason, quieter than a rule in force, then
 * how it left under a label in the Review inbox's Clashes red: Reason and why it was retired, or Replaced by
 * and the rule that took its place, its id a chip linking to it. The day it left where a rule in force has
 * its date.
 */
function RetiredRow({ r, at }: { r: BoardRule; at: string | null }) {
  const by = r.ended?.kind === 'replaced' ? r.ended.by : undefined;
  const why = r.ended?.kind === 'retired' ? r.ended.why : undefined;
  return (
    <li id={r.id} className={ROW}>
      <Id className={`pt-0.5 ${at === r.id ? 'text-fg' : ''}`}>{r.id}</Id>
      <div className="min-w-0 max-w-[40rem]">
        <div className="text-muted">{sentence(r.decision)}</div>
        {r.rationale ? <div className="mt-0.5 text-[13px] text-muted">{sentence(r.rationale)}</div> : null}
        {by || why ? (
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px]">
            <span className="text-bad">{by ? 'Replaced by' : 'Reason'}</span>
            <span className="text-muted">
              {by ? <><a href={href('rules', { at: by.id })} className={`${CHIP} hover:border-border-strong`}>{by.id}</a> {sentence(by.decision)}</> : sentence(why!)}
            </span>
          </div>
        ) : null}
      </div>
      {r.ended?.date ? <When iso={r.ended.date} className="pt-0.5 text-right text-xs tabular-nums text-faint" /> : <span />}
    </li>
  );
}

/**
 * Type and search, as on the Overview's toolbar: all seven types, each with how many rules it has (none
 * is 0, so the whole set is always in view), and words to look for in a rule, its reason or its id.
 * Enter searches; Clear puts it all back.
 */
function RulesFilter({ data, rules, kinds, q }: { data: LocalBoard; rules: BoardRule[]; kinds: string[]; q: string }) {
  const counts = new Map<string, number>();
  for (const r of rules) counts.set(r.dimension, (counts.get(r.dimension) ?? 0) + 1);
  const options = Object.entries(DIMENSION_LABEL).map(([k, label]) => ({ value: k, label, hint: String(counts.get(k) ?? 0) }));
  const to = (next: { kind?: string[]; q?: string }) => {
    const v = { kind: kinds, q, ...next };
    go(href('rules', { type: v.kind, q: v.q.trim() || undefined }));
  };
  return (
    <div className="mt-4 flex flex-wrap items-center gap-2 border-b border-border pb-3">
      <MultiSelect icon label="Type" values={kinds} options={options} onChange={(v) => to({ kind: v })} />
      {kinds.length || q ? <Button variant="ghost" size="sm" onClick={() => to({ kind: [], q: '' })}>Clear filters</Button> : null}
      {/* Search, as an icon at the bar's right end, opening into a field; then "⋯" for the file itself. */}
      <div className="ml-auto flex items-center gap-2">
        <SearchButton value={q} label="Search rules" placeholder={`Search ${rules.length} rule${rules.length === 1 ? '' : 's'}…`} onSearch={(text) => to({ q: text })} />
        <RulesMenu data={data} rules={rules} />
      </div>
    </div>
  );
}


/** The rules as text: the same lines DECISIONS.md has, ids, rules and their reasons. */
const asText = (rules: BoardRule[]) => ['# Design rules', '', ...rules.flatMap((r) => [`- **${r.id}** ${sentence(r.decision)}`, ...(r.rationale ? [`  ${sentence(r.rationale)}`] : [])]), ''].join('\n');

/**
 * "⋯" at the end of the filter bar, the toolbar's height. Download gives you the file: DECISIONS.md
 * itself when the board is served, the file the agent reads; a copy someone was sent has no server to
 * ask, so it writes the rules it shows into a file of its own. Copy all rules puts the same text on the
 * clipboard, to paste into a doc or a message.
 */
function RulesMenu({ data, rules }: { data: LocalBoard; rules: BoardRule[] }) {
  const [copied, setCopied] = useState(false);
  const download = () => {
    if (data.live) {
      Object.assign(document.createElement('a'), { href: '/api/decisions', download: rulesFile() }).click();
      return;
    }
    const url = URL.createObjectURL(new Blob([asText(rules)], { type: 'text/markdown' }));
    Object.assign(document.createElement('a'), { href: url, download: 'design-rules.md' }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(asText(rules)); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return (
    <>
      {copied ? <span className="text-[12px] text-faint" aria-live="polite">Copied</span> : null}
      <ActionMenu label="Download or copy the rules" tip="Download or copy" className={barDots} trigger={DOTS}>
        <ActionItem onClick={download} icon={Icon.download} hint={data.live ? rulesFile() : '.md'}>Download</ActionItem>
        <ActionItem onClick={() => void copy()} icon={Icon.copy} hint={String(rules.length)}>Copy all rules</ActionItem>
      </ActionMenu>
    </>
  );
}

// The rule's words stop at 40rem, a comfortable line; the date stays on the right edge.
const ROW = 'grid scroll-mt-20 grid-cols-[4.5rem_minmax(0,1fr)_auto] gap-x-3 py-3 text-[14px]';
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();

/** A removed rule back in DECISIONS.md, then the board drawn again. The error, if it can't be. */
async function restoreRule(id: string, refresh: () => Promise<void>): Promise<string | null> {
  const res = await post('/api/unretire', { id });
  if (res.exitCode !== 0) return errorsOf(res);
  await refresh();
  return null;
}

/**
 * Edit and Remove for one rule, in its row.
 * Edit changes the words and keeps the id, so everything that names the rule still points at it.
 * Remove asks why first: the reason is what the history keeps.
 */
function useRuleActions(r: { id: string; decision: string }, refresh: () => Promise<void>, onRemoved: (why: string) => void) {
  const [mode, setMode] = useState<'edit' | 'remove' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const open = (m: 'edit' | 'remove') => { setText(m === 'edit' ? r.decision : ''); setError(null); setMode(m); };
  const close = () => { setMode(null); setError(null); };

  const save = async () => {
    const to = oneLine(text);
    if (!to) return;
    if (to === r.decision) return close();
    setBusy(true);
    const res = await post('/api/reword', { id: r.id, to });
    if (res.exitCode !== 0) { setBusy(false); return setError(errorsOf(res)); }
    await refresh();
    setBusy(false);
    close();
  };
  const remove = async () => {
    const why = oneLine(text);
    if (!why) return;
    setBusy(true);
    const res = await post('/api/retire', { id: r.id, why });
    if (res.exitCode !== 0) { setBusy(false); return setError(errorsOf(res)); }
    onRemoved(why);
    await refresh();
    setBusy(false);
    close();
  };
  // Enter saves, Shift+Enter adds a line, Escape puts it back as it was.
  const keys = (go: () => Promise<void>) => saveKeys(() => void go(), close);
  return { id: r.id, mode, text, setText, busy, error, open, close, save, remove, keys };
}
type RuleActions = ReturnType<typeof useRuleActions>;

/** The rule's words as a box to change, in place of them. */
function EditBox({ a, className }: { a: RuleActions; className?: string }) {
  return <Textarea autoFocus aria-label={`What ${a.id} says`} value={a.text} onChange={(e) => a.setText(e.target.value)} onKeyDown={a.keys(a.save)} rows={2} className={`min-h-14 field-sizing-content ${className ?? ''}`} />;
}

/** Under the box: Save, or Cancel to leave it as it was. */
function EditButtons({ a }: { a: RuleActions }) {
  return (
    <div className="mt-2 flex items-center gap-1.5">
      <Button size="sm" variant="primary" disabled={a.busy || !oneLine(a.text)} onClick={() => void a.save()}>Save</Button>
      <Button size="sm" variant="ghost" type="button" onClick={a.close}>Cancel</Button>
    </div>
  );
}


/**
 * A rule: its words, its reason, where it was decided. Served live, Copy, Edit
 * and Remove show on hover or focus, as a decision's own actions do.
 */
function RuleRow({ r, at, from, live, copyText, onRemoved, refresh }: { r: BoardRule; at: string | null; from: { id: string; name: string } | null; live: boolean; copyText: string; onRemoved: (why: string) => void; refresh: () => Promise<void> }) {
  const a = useRuleActions(r, refresh, onRemoved);
  return (
    <li id={r.id} className={`group/rule ${ROW}`}>
      <Id className={`pt-0.5 ${at === r.id ? 'text-fg' : ''}`}>{r.id}</Id>
      <div className="min-w-0 max-w-[40rem]">
        {a.mode === 'edit' ? <EditBox a={a} /> : <div>{sentence(r.decision)}</div>}
        {r.rationale ? <div className="mt-0.5 text-[13px] text-muted">{sentence(r.rationale)}</div> : null}
        {from ? <Meta className="mt-1 block">Decided on <a href={href(from.id)} className="text-fg hover:underline">{from.name}</a></Meta> : null}
        <Standing r={r} />
        {a.mode === 'edit' ? <EditButtons a={a} /> : live ? (
          <div className="mt-1 flex items-center gap-3 text-[12px] text-faint opacity-0 transition-opacity focus-within:opacity-100 group-hover/rule:opacity-100 group-focus-within/rule:opacity-100">
            <RuleCopy text={copyText} />
            <button type="button" onClick={() => a.open('edit')} className="hover:text-fg">Edit</button>
            <button type="button" onClick={() => a.open('remove')} className="hover:text-bad">Remove</button>
          </div>
        ) : null}
        {a.error && a.mode !== 'remove' ? <p role="alert" className="mt-2 text-[13px] text-bad">{a.error}</p> : null}
        <RemoveDialog
          open={a.mode === 'remove'} onOpenChange={(o) => { if (!o) a.close(); }} busy={a.busy} error={a.error} onRemove={() => void a.remove()}
          title={`Remove ${r.id}?`} body="Why remove this rule? Your agent will stop following it."
          why={a.text} onWhy={a.setText}
        />
      </div>
      {r.date ? <When iso={r.date} className="pt-0.5 text-right text-xs tabular-nums text-faint" /> : <span />}
    </li>
  );
}

/** An exception, as a footnote to its rule: an asterisk at the tray's size and stroke. */
const ASTERISK = <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" aria-hidden="true" className="shrink-0"><path d="M7 2.5v9" /><path d="M3.1 4.75l7.8 4.5" /><path d="M3.1 9.25l7.8-4.5" /></svg>;

/**
 * Where a rule doesn't hold, and what waits against it, as pills under its reason: an asterisk with how
 * many exceptions, in amber on the grey the decided and waiting counts use, and the Review inbox's tray
 * with how many clashes wait there. The words are on hover and for a screen reader. Each opens in place to list its own, the pill again, the change's name and its
 * Change line: an exception links to its decision on its change's page, a clash to its work in the inbox.
 */
function Standing({ r }: { r: BoardRule }) {
  const [open, setOpen] = useState<'exceptions' | 'waiting' | null>(null);
  const exceptions = r.exceptions ?? [], waiting = r.waiting ?? [];
  if (!exceptions.length && !waiting.length) return null;
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
  const pill = (kind: 'exceptions' | 'waiting', words: string, badge: React.ReactNode) => (
    <Tooltip label={`${words}. ${open === kind ? 'Hide' : 'Show'} ${words.startsWith('1 ') ? 'it' : 'them'}.`}>
      <button type="button" aria-expanded={open === kind} onClick={() => setOpen((o) => (o === kind ? null : kind))}
        className={`inline-flex rounded-full outline-none focus-visible:ring-1 focus-visible:ring-border-strong ${open === kind ? 'ring-1 ring-border-strong' : 'hover:opacity-75'}`}>
        {badge}
      </button>
    </Tooltip>
  );
  const list = open === 'exceptions' ? exceptions : open === 'waiting' ? waiting : [];
  // A change's name without its area, as a card under its area's heading says it: "Settings — Billing" is Billing.
  const short = (name: string) => name.split(' — ').pop() || name;
  return (
    <div className="mt-2">
      <div className="flex flex-wrap items-center gap-2">
        {exceptions.length ? pill('exceptions', plural(exceptions.length, 'exception'), <Badge tone="excepted" className="cursor-pointer gap-1 tabular-nums">{ASTERISK}<span aria-hidden="true">{exceptions.length}</span><span className="sr-only">{plural(exceptions.length, 'exception')}</span></Badge>) : null}
        {waiting.length ? pill('waiting', `${plural(waiting.length, 'clash')} waiting in the Review inbox`, <Badge tone="info" className="cursor-pointer gap-1 tabular-nums">{TRAY}<span>{waiting.length}</span></Badge>) : null}
      </div>
      {list.length ? (
        <ul className="mt-2 space-y-1.5 text-[13px] text-muted">
          {list.map((x) => (
            <li key={x.id} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              {open === 'exceptions' ? <Badge tone="warn">Exception</Badge> : <Badge tone="info">Waiting</Badge>}
              <a href={open === 'exceptions' ? href(x.card, { at: x.id }) : href('review', { at: x.card })} className="font-medium text-fg hover:underline">{short(x.name)}</a>
              <span>{sentence(x.change)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/** Copy, for one rule: the whole decision as text, as Copy on its change's page gives it, to paste anywhere. */
function RuleCopy({ text, className = 'hover:text-fg' }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  return <button type="button" onClick={() => void copy()} className={className}>{copied ? 'Copied' : 'Copy'}</button>;
}

/** A rule removed here: faded in its place with why, and Undo at full strength, the one thing left to do. */
function RemovedRow({ r, why, onUndo }: { r: BoardRule; why: string; onUndo: (id: string) => Promise<string | null> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = async () => {
    setBusy(true);
    setError(await onUndo(r.id));
    setBusy(false);
  };
  return (
    <li id={r.id} className={ROW}>
      <Id className="pt-0.5 opacity-60">{r.id}</Id>
      <div className="min-w-0 max-w-[40rem]">
        <div className="opacity-60">{sentence(r.decision)}</div>
        <div className="mt-0.5 text-[13px] text-muted opacity-60">Retired · {sentence(why)}</div>
        {error ? <p role="alert" className="mt-1 text-[13px] text-bad">{error}</p> : null}
      </div>
      <button type="button" disabled={busy} onClick={() => void undo()} className="self-start pt-0.5 text-[13px] font-medium text-fg hover:underline disabled:opacity-40">Undo</button>
    </li>
  );
}
