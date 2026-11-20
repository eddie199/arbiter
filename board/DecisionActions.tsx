import { useState } from 'react';
import { sentence } from '@/lib/board';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { errorsOf, post } from './api';
import { RemoveDialog } from './RemoveDialog';
import { FullDialog, OverlapDialog, type Overlap, type RuleLine } from './RuleDialogs';
import { go, href } from './route';
import { saveKeys } from './keys';

/** A decision as the change page has it. `active` is false for a rule since retired or replaced. */
export interface ActionDecision { id: string; change: string | null; decision: string; verdict: string; active?: boolean; against?: { id: string } | null }
/** What a removal on this page did: a rule retired, with why, or a decision taken out of the record. */
export interface Removal { d: ActionDecision; kind: 'rule' | 'decision'; why?: string }

const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim();
/** A rule still in force. */
export const inForce = (d: ActionDecision) => d.verdict === 'rule' && d.active !== false;

/**
 * Copy, Edit, Make it a rule and Remove for one decision on its change's page, as Design rules has for a
 * rule, showing on hover or focus under the decision, in line with its values. On a rule, Edit and
 * Remove are Design rules' own (new words for the rule; retired, with why). On any other decision, Edit
 * changes its Change line and Remove takes it out of the record. The old words stay on the record either
 * way, and a removal can be undone while the page is open.
 */
export function DecisionActions({ d, copyText, last, onRemoved, refresh }: { d: ActionDecision; copyText: string; last: boolean; onRemoved: (r: Removal) => void; refresh: () => Promise<void> }) {
  const rule = inForce(d);
  const [mode, setMode] = useState<'edit' | 'remove' | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Make it a rule stopped to ask: it overlaps rules you have, or DECISIONS.md is full.
  const [overlap, setOverlap] = useState<Overlap[] | null>(null);
  const [full, setFull] = useState<{ rules: RuleLine[]; cap: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const current = rule ? d.decision : d.change ?? d.decision;
  const open = (m: 'edit' | 'remove') => { setText(m === 'edit' ? current : ''); setError(null); setOverlap(null); setMode(m); };
  const close = () => { setMode(null); setError(null); };
  const call = async (path: string, body: Record<string, unknown>) => {
    setBusy(true);
    const r = await post(path, body);
    setBusy(false);
    return r;
  };

  const save = async () => {
    const to = oneLine(text);
    if (!to) return;
    if (to === current) return close();
    const r = await call(rule ? '/api/reword' : '/api/edit-change', { id: d.id, to });
    if (r.exitCode) return setError(errorsOf(r));
    await refresh();
    close();
  };
  const remove = async () => {
    if (rule) {
      const why = oneLine(text);
      if (!why) return;
      const r = await call('/api/retire', { id: d.id, why });
      if (r.exitCode) return setError(errorsOf(r));
      onRemoved({ d, kind: 'rule', why });
    } else {
      const r = await call('/api/remove-decision', { id: d.id });
      if (r.exitCode) return setError(errorsOf(r));
      // Its only decision gone, the change is gone from the board: back to the Overview.
      if (last) { await refresh(); go(href('overview')); return; }
      onRemoved({ d, kind: 'decision' });
    }
    await refresh();
    close();
  };
  const promote = async (extra: Record<string, unknown> = {}) => {
    const r = await call('/api/promote', { id: d.id, ...extra });
    if (r.exitCode === 2) return setOverlap((r.overlaps as Overlap[]) ?? []);
    // Full, maybe after Keep both: the overlap question is answered, the full one takes its place.
    if (r.exitCode === 3) { setOverlap(null); setError(null); return setFull({ rules: (r.active as RuleLine[]) ?? [], cap: Number(r.cap) }); }
    if (r.exitCode) return setError(errorsOf(r));
    setOverlap(null);
    setFull(null);
    await refresh();
  };
  // The whole decision as the page shows it, id first: the page builds the text, so the two read the same.
  const copy = async () => {
    try { await navigator.clipboard.writeText(copyText); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch {}
  };
  // Enter saves, Shift+Enter adds a line, Escape puts it back as it was.
  const keys = (go: () => Promise<void>) => saveKeys(() => void go(), close);

  return (
    <div className="pl-[calc(6rem+0.75rem)]">
      {mode === 'edit' ? (
        <div className="mt-3 max-w-2xl">
          <p className="mb-2 text-[13px] text-muted">{rule ? 'Edit rule' : 'Edit change'}</p>
          <Textarea autoFocus aria-label={rule ? `What ${d.id} says` : `What changed in ${d.id}`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={keys(save)} rows={2} className="min-h-14 field-sizing-content" />
          <div className="mt-2 flex items-center gap-1.5">
            <Button size="sm" variant="primary" disabled={busy || !oneLine(text)} onClick={() => void save()}>Save</Button>
            <Button size="sm" variant="ghost" type="button" onClick={close}>Cancel</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-center gap-3 text-[12px] text-faint opacity-0 transition-opacity focus-within:opacity-100 group-hover/decision:opacity-100 group-focus-within/decision:opacity-100">
          <button type="button" onClick={() => void copy()} className="hover:text-fg">{copied ? 'Copied' : 'Copy'}</button>
          <button type="button" onClick={() => open('edit')} className="hover:text-fg">Edit</button>
          {/* Not on an exception: as a rule it would say the opposite of the rule it's an exception to. */}
          {!rule && d.verdict !== 'rule' && !d.against ? <button type="button" disabled={busy} onClick={() => void promote()} className="hover:text-ok">Make it a rule</button> : null}
          {/* A retired rule stays on the record: its retirement points at it. */}
          {d.verdict === 'rule' && d.active === false ? null : <button type="button" onClick={() => open('remove')} className="hover:text-bad">Remove</button>}
        </div>
      )}
      {error && mode !== 'remove' && !overlap && !full ? <p role="alert" className="mt-2 text-[13px] text-bad">{error}</p> : null}
      <OverlapDialog mine={{ id: d.id, decision: d.decision }} overlaps={overlap} busy={busy} error={error} onClose={() => { setOverlap(null); setError(null); }} onKeepBoth={() => void promote({ keepBoth: true })} onReplace={(id) => void promote({ supersedes: id })} />
      <FullDialog mine={{ id: d.id, decision: d.decision }} full={full} busy={busy} error={error} onClose={() => { setFull(null); setError(null); }} onReplace={(id) => void promote({ supersedes: id })} />
      <RemoveDialog
        open={mode === 'remove'} onOpenChange={(o) => { if (!o) close(); }} busy={busy} error={error} onRemove={() => void remove()}
        title={`Remove ${d.id}?`}
        body={rule
          ? 'Why remove this rule? Your agent will stop following it.'
          : last ? 'This deletes the decision and, since it’s the only one, the change too. You can’t undo this.' : 'This deletes the decision. You can undo it until you leave this page.'}
        {...(rule ? { why: text, onWhy: setText } : {})}
      />
    </div>
  );
}

/**
 * A decision removed on this page, in its place: faded, what happened, and Undo at full strength.
 * A rule comes back into DECISIONS.md; any other decision back into the record where it was.
 */
export function RemovedDecision({ r, onUndone, refresh }: { r: Removal; onUndone: () => void; refresh: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const undo = async () => {
    setBusy(true);
    const res = await post(r.kind === 'rule' ? '/api/unretire' : '/api/restore-decision', { id: r.d.id });
    setBusy(false);
    if (res.exitCode) return setError(errorsOf(res));
    onUndone();
    await refresh();
  };
  return (
    <li id={r.d.id} className="flex items-start gap-4 py-5">
      <div className="min-w-0 flex-1 opacity-60">
        <span className="font-mono text-xs text-muted">{r.d.id}</span>
        <p className="mt-1 text-[14px]">{sentence(r.d.change ?? r.d.decision)}</p>
        <p className="mt-0.5 text-[13px] text-muted">{r.kind === 'rule' ? `Retired · ${sentence(r.why ?? '')}` : 'Removed from the record'}</p>
        {error ? <p role="alert" className="mt-1 text-[13px] text-bad">{error}</p> : null}
      </div>
      <button type="button" disabled={busy} onClick={() => void undo()} className="pt-0.5 text-[13px] font-medium text-fg hover:underline disabled:opacity-40">Undo</button>
    </li>
  );
}
