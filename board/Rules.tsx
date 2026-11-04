import { useEffect, useState } from 'react';
import { DIMENSION_LABEL, sentence, type BoardRule } from '@/lib/board';
import { Button, buttonClass } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { Id, Meta, PageTitle, SectionTitle } from '@/components/ui/type';
import { When } from '@/components/When';
import type { LocalBoard } from './types';
import { errorsOf, post } from './api';
import { href } from './route';

/**
 * Design rules, as the team board shows them (app/p/[slug]/rules/page.tsx), with how full the list is.
 * Download gives you the file. Served live, each rule can be copied, edited or removed in place. A
 * removed one keeps its row, faded, with Undo while the page is open.
 */
export function Rules({ data, at, cap, refresh }: { data: LocalBoard; at: string | null; cap?: number; refresh: () => Promise<void> }) {
  const rules: BoardRule[] = data.board.rules ?? [];
  const screens = new Map(data.board.candidates.map((c) => [c.id, c]));
  // Removed here, kept as they were so each stays in its place until the page closes.
  const [removed, setRemoved] = useState<Record<string, { rule: BoardRule; why: string }>>({});
  const gone = (id: string) => !!removed[id] && !rules.some((r) => r.id === id);
  const shown = [...rules, ...Object.values(removed).map((x) => x.rule).filter((r) => gone(r.id))];
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
          <Meta className={`mt-0.5 block ${cap && cap - rules.length <= 5 ? 'text-warn' : ''}`}>
            {rules.length ? `${rules.length} rule${rules.length === 1 ? '' : 's'} you’ve saved in DECISIONS.md. Everything new follows ${rules.length === 1 ? 'it' : 'them'}.` : 'The rules you save in DECISIONS.md. Everything new follows them.'}
            {cap ? (rules.length >= cap ? ' Full: a new rule has to replace one.' : ` It holds ${cap} at most.`) : null}
          </Meta>
        </div>
        {rules.length ? <Download data={data} rules={rules} /> : null}
      </div>
      {!shown.length ? (
        <div className="mt-6 rounded-lg border border-dashed border-border-strong px-6 py-12 text-center">
          <p className="font-semibold tracking-tight">No design rules yet</p>
          <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">A design rule is a decision you saved as “always”. Make one from your review queue and it shows up here.</p>
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
                : <RuleRow key={r.id} r={r} at={at} from={r.candidate ? screens.get(r.candidate) ?? null : null} live={data.live} hosted={data.hosted} onRemoved={(why) => setRemoved((x) => ({ ...x, [r.id]: { rule: r, why } }))} refresh={refresh} />)}
            </ul>
          </section>
        );
      })}
    </main>
  );
}

const DownloadIcon = <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M7 1.5v7.5M3.75 5.75 7 9l3.25-3.25M2 12.5h10" /></svg>;

/**
 * Download, top right: DECISIONS.md itself when the board is served, the file the agent reads. A
 * copy someone was sent has no server to ask, so it writes the rules it shows into a file of its own.
 */
function Download({ data, rules }: { data: LocalBoard; rules: BoardRule[] }) {
  const cls = `${buttonClass('secondary', 'sm')} shrink-0`;
  if (data.live) return <a href="/api/decisions" download="DECISIONS.md" className={cls}>{DownloadIcon}Download</a>;
  const save = () => {
    const text = ['# Design rules', '', ...rules.flatMap((r) => [`- **${r.id}** ${sentence(r.decision)}`, ...(r.rationale ? [`  ${sentence(r.rationale)}`] : [])]), ''].join('\n');
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown' }));
    const a = Object.assign(document.createElement('a'), { href: url, download: 'design-rules.md' });
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <button type="button" onClick={save} className={cls}>{DownloadIcon}Download</button>;
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
  // One line each: Enter saves, Escape puts it back as it was.
  const keys = (go: () => Promise<void>) => (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') { e.preventDefault(); void go(); }
  };
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

/** Why it's going, then Remove. */
function RemoveForm({ a }: { a: RuleActions }) {
  return (
    <form className="mt-3 max-w-xl" onSubmit={(e) => { e.preventDefault(); void a.remove(); }}>
      <p className="mb-2 text-[13px] text-muted">Why isn’t it a rule any more? Your agent stops following it, and the history keeps it with your reason.</p>
      <Textarea autoFocus aria-label={`Why ${a.id} is removed`} value={a.text} onChange={(e) => a.setText(e.target.value)} onKeyDown={a.keys(a.remove)} placeholder="One line" rows={2} className="min-h-14" />
      <div className="mt-2 flex items-center gap-1.5">
        <Button size="sm" variant="danger" disabled={a.busy || !oneLine(a.text)}>Remove</Button>
        <Button size="sm" variant="ghost" type="button" onClick={a.close}>Cancel</Button>
      </div>
    </form>
  );
}

/**
 * A rule: its words, its reason, where it was decided. Served live, Copy, Edit
 * and Remove show on hover or focus, as a decision's own actions do.
 */
function RuleRow({ r, at, from, live, hosted, onRemoved, refresh }: { r: BoardRule; at: string | null; from: { id: string; name: string } | null; live: boolean; hosted: string | null; onRemoved: (why: string) => void; refresh: () => Promise<void> }) {
  const a = useRuleActions(r, refresh, onRemoved);
  return (
    <li id={r.id} className={`group/rule ${ROW}`}>
      <Id className={`pt-0.5 ${at === r.id ? 'text-fg' : ''}`}>{r.id}</Id>
      <div className="min-w-0 max-w-[40rem]">
        {a.mode === 'edit' ? <EditBox a={a} /> : <div>{sentence(r.decision)}</div>}
        {r.rationale ? <div className="mt-0.5 text-[13px] text-muted">{sentence(r.rationale)}</div> : null}
        {from ? <Meta className="mt-1 block">Decided on <a href={href(from.id)} className="text-fg hover:underline">{from.name}</a></Meta> : null}
        {a.mode === 'edit' ? <EditButtons a={a} /> : a.mode === 'remove' ? <RemoveForm a={a} /> : live ? (
          <div className="mt-1 flex items-center gap-3 text-[12px] text-faint opacity-0 transition-opacity focus-within:opacity-100 group-hover/rule:opacity-100 group-focus-within/rule:opacity-100">
            <RuleCopy r={r} hosted={hosted} />
            <button type="button" onClick={() => a.open('edit')} className="hover:text-fg">Edit</button>
            <button type="button" onClick={() => a.open('remove')} className="hover:text-bad">Remove</button>
          </div>
        ) : null}
        {a.error ? <p className="mt-2 text-[13px] text-bad">{a.error}</p> : null}
      </div>
      {r.date ? <When iso={r.date} className="pt-0.5 text-right text-xs tabular-nums text-faint" /> : <span />}
    </li>
  );
}

/**
 * Copy, for one rule: its words and its reason as text, to paste anywhere, and its link on the team
 * board when there is one. A link to this board would open nowhere but here.
 */
function RuleCopy({ r, hosted, className = 'hover:text-fg' }: { r: { id: string; decision: string; rationale: string }; hosted: string | null; className?: string }) {
  const [copied, setCopied] = useState(false);
  const link = hosted ? `${hosted.replace(/\/+$/, '')}/rules#${r.id}` : null;
  const text = [`${r.id}: ${sentence(r.decision)}`, r.rationale ? `Why: ${sentence(r.rationale)}` : null, link].filter(Boolean).join('\n');
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
        <div className="mt-0.5 text-[13px] text-muted opacity-60">Removed · {sentence(why)}</div>
        {error ? <p className="mt-1 text-[13px] text-bad">{error}</p> : null}
      </div>
      <button type="button" disabled={busy} onClick={() => void undo()} className="self-start pt-0.5 text-[13px] font-medium text-fg hover:underline disabled:opacity-40">Undo</button>
    </li>
  );
}
