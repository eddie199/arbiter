import { Fragment } from 'react';
import { scopeWords, sentence } from '@/lib/board';
import { Button, buttonClass } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Tooltip } from '@/components/ui/tooltip';
import { href } from './route';
import { CHIP } from './bits';
import type { CodeCheck } from './types';

/**
 * The questions Make it a rule can stop to ask, the same on a change's page and in the Review inbox: it
 * overlaps rules you have, DECISIONS.md is full, or the code no longer matches what it says. Each shows
 * this one first, then what it's asking about, in plain words, with a way through it right there.
 */

/**
 * A rule this decision overlaps: sure when it's about the same thing, a guess when only words are shared.
 * A sure one on a file carries its change's name, the screen both apply to.
 */
export interface Overlap { id: string; decision: string; sure: boolean; scope?: string; change?: string; words: string[] }
/** A rule in DECISIONS.md, as the full dialog lists it. */
export interface RuleLine { id: string; decision: string }
/** A check of the code that failed, as the CLI sends it. */
export type FailedCheck = CodeCheck;
/** What a dialog is asking, when it's asking. */
export type Ask =
  | { kind: 'overlap'; overlaps: Overlap[] }
  | { kind: 'full'; rules: RuleLine[]; cap: number }
  | { kind: 'mismatch'; failed: FailedCheck[] };

/** Why a rule overlaps, in words: what both apply to ("Both apply to plan cards"), or the words a guess rests on. */
export function whyOverlaps(o: Overlap): string {
  if (!o.sure) return `Similar words: ${o.words.join(', ')}`;
  // A file by its change's own name, without the area before it: "Review inbox — Old review page" is "Old review page".
  if (o.change) return `Both apply to ${sentence(o.change.split(/\s+[—–]\s+/).pop()!.trim())}`;
  const words = scopeWords(o.scope);
  if (!words) return 'Both apply to the same thing';
  // A pattern's name reads as words mid-sentence ("plan cards"); a file keeps its own name.
  return `Both apply to ${o.scope?.startsWith('file:') ? words : words.replace(/, anywhere$/, '').replace(/^\w/, (c) => c.toLowerCase())}`;
}

interface Shared { mine: { id: string; decision: string }; busy: boolean; error?: string | null; onClose: () => void }

/** The frame all three share: title, a line under it, this one, what it's asking about, then the buttons. */
function AskDialog({ open, title, description, mine, busy, error, onClose, children, footer }: Shared & { open: boolean; title: string; description: React.ReactNode; children: React.ReactNode; footer: React.ReactNode }) {
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent>
        <DialogTitle className="font-semibold tracking-tight">{title}</DialogTitle>
        <DialogDescription className="mt-1.5 text-[13px] text-muted">{description}</DialogDescription>
        <div className="mt-4 text-[14px]">
          <p className="text-[12px] text-muted">This one · <span className="font-mono">{mine.id}</span></p>
          <p className="mt-1 font-medium">{sentence(mine.decision)}</p>
        </div>
        {children}
        {error ? <p role="alert" className="mt-3 text-[13px] text-bad">{error}</p> : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button size="md" variant="ghost" type="button" onClick={onClose} disabled={busy}>Cancel</Button>
          {footer}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Rules to pick from, in one box under a label, each with its own Replace on its id line so its words run the full width. */
function RulePicker({ label, rules, why, mine, busy, onReplace, long }: { label: string; rules: RuleLine[]; why?: (r: RuleLine) => string; mine: { id: string }; busy: boolean; onReplace: (id: string) => void; long?: boolean }) {
  return (
    <>
      <p className="mt-5 text-[12px] text-muted">{label}</p>
      {/* A full DECISIONS.md can be a long list: it scrolls inside the box, the buttons stay in view. */}
      <ul className={`mt-2 divide-y divide-border rounded-lg border border-border bg-surface ${long ? 'max-h-[40vh] overflow-y-auto' : ''}`}>
        {rules.map((r) => (
          <li key={r.id} className="px-4 py-3 text-[14px]">
            <div className="flex items-center justify-between gap-3">
              <p className="font-mono text-[12px] text-muted">{r.id}</p>
              <Button size="sm" variant="secondary" type="button" aria-label={`Replace ${r.id} with ${mine.id}`} onClick={() => onReplace(r.id)} disabled={busy} className="-my-1 shrink-0">Replace</Button>
            </div>
            <p className="mt-1">{sentence(r.decision)}</p>
            {why ? <p className="mt-1 text-[12px] text-faint">{why(r)}</p> : null}
          </li>
        ))}
      </ul>
    </>
  );
}

/** It overlaps rules you have: each with why it matched and its own Replace, or Keep both to have this beside them. */
export function OverlapDialog({ overlaps, onKeepBoth, onReplace, ...shared }: Shared & { overlaps: Overlap[] | null; onKeepBoth: () => void; onReplace: (id: string) => void }) {
  const list = overlaps ?? [];
  const one = list.length === 1;
  return (
    <AskDialog
      {...shared} open={overlaps !== null}
      title={`This overlaps ${one ? 'a rule' : `${list.length} rules`} you have`}
      description={one ? 'Keep both rules, or let this one replace it.' : 'Keep both rules, or pick one for this to replace.'}
      footer={<Button size="md" variant="secondary" type="button" onClick={onKeepBoth} disabled={shared.busy}>Keep both</Button>}
    >
      <RulePicker label={one ? 'Your rule' : 'Your rules'} rules={list} why={(r) => whyOverlaps(r as Overlap)} mine={shared.mine} busy={shared.busy} onReplace={onReplace} />
    </AskDialog>
  );
}

/**
 * DECISIONS.md is full: every rule there, to pick one for this to replace, or Preferences to raise the limit.
 * Nothing is lost by leaving: the decision waits where it was.
 */
export function FullDialog({ full, onReplace, ...shared }: Shared & { full: { rules: RuleLine[]; cap: number } | null; onReplace: (id: string) => void }) {
  return (
    <AskDialog
      {...shared} open={full !== null}
      title="DECISIONS.md is full"
      description={`It holds ${full?.cap ?? 0} rules, the most it can. Pick one for this to replace, or raise the limit in Preferences.`}
      footer={<a href={href('preferences')} className={buttonClass('secondary', 'md')}>Raise the limit</a>}
    >
      <RulePicker label="Your rules" rules={full?.rules ?? []} mine={shared.mine} busy={shared.busy} onReplace={onReplace} long />
    </AskDialog>
  );
}

/**
 * A failed check as a plain sentence, the fact first: the file by its name, in a chip (the whole path on
 * hover, when it has one), then what's in it now ("billing.css is missing var(--brand)", "billing.css still has
 * #3B7BE0"), so what's wrong is the second word you read. No "The agent said": the Clashes label and the
 * Code Clash pill already say the files disagree with the agent. The same words on a Code Clash card and in
 * this dialog.
 */
export function clashWords(f: FailedCheck): React.ReactNode {
  const one = (p: string) => {
    const name = p.split(/[\\/]/).pop() || p;
    // In the chip the code has: the file and what's in it read as the two things, the words between stay muted.
    return name === p ? <span className={CHIP}>{name}</span> : <Tooltip label={p}><span className={CHIP}>{name}</span></Tooltip>;
  };
  // A `present` check that failed names every file it looked in, and none of them has it.
  const paths = f.file.split(', ');
  const list = (join: string) => paths.map((p, k) => <Fragment key={p}>{k ? (k === paths.length - 1 ? join : ', ') : null}{one(p)}</Fragment>);
  const pattern = f.needle?.startsWith('regex:');
  if (f.kind === 'exists') {
    return f.detail === 'outside the project'
      ? <>{list(' and ')} {paths.length > 1 ? 'are' : 'is'} outside this project, so Arbiter can’t check it</>
      : <>{list(' and ')} {paths.length > 1 ? 'aren’t' : 'isn’t'} in the project any more</>;
  }
  if (f.kind === 'present') {
    const what = pattern ? 'what the agent named' : <Code text={f.needle ?? ''} />;
    if (paths.length === 1) return pattern ? <>{list('')} doesn’t have {what}</> : <>{list('')} is missing {what}</>;
    return paths.length === 2 ? <>Neither {one(paths[0])} nor {one(paths[1])} has {what}</> : <>None of {list(' or ')} has {what}</>;
  }
  const text = pattern ? f.found : f.needle;
  return <>{list(' and ')} still {paths.length > 1 ? 'have' : 'has'} {text ? <Code text={text} /> : 'what the agent named'}</>;
}

/**
 * Code in a clash line, as a small chip in the board's mono, so it reads apart from the words. A hex
 * colour gets a swatch of itself in front: "#3B7BE0" means little until you see the blue.
 */
function Code({ text }: { text: string }) {
  const colour = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(text) ? text : null;
  return (
    <span className={CHIP}>
      {colour ? <span aria-hidden="true" className="mr-[5px] inline-block size-[9px] rounded-[2px] shadow-[inset_0_0_0_1px_rgb(0_0_0/0.12)]" style={{ background: colour }} /> : null}
      {text}
    </span>
  );
}

/**
 * A Code Clash: Arbiter checked the files it names and they say otherwise. Record it anyway, or leave it
 * waiting while your agent fixes the code.
 */
export function MismatchDialog({ failed, anyway, onAnyway, ...shared }: Shared & { failed: FailedCheck[] | null; anyway: string; onAnyway: () => void }) {
  return (
    <AskDialog
      {...shared} open={failed !== null}
      title="This clashes with the code"
      description="Arbiter checked the files it names, and they say otherwise. You can record it anyway, or leave it waiting and ask your agent to fix the code first."
      footer={<Button size="md" variant="secondary" type="button" onClick={onAnyway} disabled={shared.busy}>{anyway}</Button>}
    >
      <p className="mt-5 text-[12px] text-muted">What the files say</p>
      <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-surface text-[14px]">
        {(failed ?? []).map((f, k) => <li key={k} className="px-4 py-2.5">{clashWords(f)}</li>)}
      </ul>
    </AskDialog>
  );
}
