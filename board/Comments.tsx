import { useState } from 'react';
import { type BoardRequest, conversation, sentence } from '@/lib/board';
import { Id } from '@/components/ui/type';
import { When } from '@/components/When';
import type { LocalComment } from './types';
import { href } from './route';
import { cap } from './bits';
import { Tooltip } from '@/components/ui/tooltip';

/**
 * The team board's threads (components/CommentThread.tsx), read-only: comments arrive with
 * `arbiter pull` and are answered from the review queue, so there's nothing to post here yet.
 * One message sits inline; two or more fold to a row until opened.
 */
export function DecisionThread({ decision, comments, requests, cards, candidate, version }: { decision: string; comments: LocalComment[]; requests: BoardRequest[]; cards: string[]; candidate: string; version: string | null }) {
  const [shown, setShown] = useState(false);
  const notes = comments.filter((c) => c.decision_id === decision && (c.kind === 'comment' || c.kind === 'request'));
  if (!notes.length) return null;
  const said = conversation(notes, requests);
  const foldable = said.length >= 2;
  const folded = foldable && !shown;
  const last = said[said.length - 1];
  return (
    <div className="mt-3 border-l-2 border-border pl-3">
      {foldable ? (
        <button type="button" onClick={() => setShown((v) => !v)} aria-expanded={!folded} className={`flex items-center gap-1.5 text-[12px] text-muted hover:text-fg ${folded ? '' : 'mb-2'}`}>
          <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true" className={`transition-transform ${folded ? '' : 'rotate-90'}`}><path d="M4.5 2.5 8 6l-3.5 3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>{said.length} comments</span>
          {folded ? <span className="text-faint">· {cap(last.who)} · <When iso={last.at} /></span> : null}
        </button>
      ) : null}
      {folded ? null : (
        <ul className="space-y-2">
          {notes.map((n) => <CommentLine key={n.id} n={n} small stale={!!version && !!n.board_version && n.board_version !== version} requests={requests} cards={cards} candidate={candidate} />)}
        </ul>
      )}
    </div>
  );
}

const COMMENT = 'M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z';
const REQUEST = 'M10.5 2.5l3 3-7.5 7.5H3v-3z';
function Glyph({ d, className = '' }: { d: string; className?: string }) {
  return <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`inline-block shrink-0 ${className}`}><path d={d} /></svg>;
}

export function CommentLine({ n, small, stale, requests, cards, candidate }: { n: LocalComment; small?: boolean; stale?: boolean; requests: BoardRequest[]; cards: string[]; candidate: string }) {
  const request = n.kind === 'request';
  const answer = request ? requests.find((r) => r.comment === n.id) ?? null : null;
  const old = stale && !answer;
  return (
    <li className={small ? 'text-[13px]' : undefined}>
      {small ? <Glyph d={request ? REQUEST : COMMENT} className="mr-1.5 align-[-1px] text-faint" /> : null}
      <span className="font-semibold">{cap(n.author_name)}</span> <span className={`${small ? 'text-[12px]' : 'text-[13px]'} text-muted`}>{request ? 'requested a change ' : ''}· <When iso={n.created_at} />{old ? <Tooltip label="Written about an earlier version"><span className="text-faint"> · earlier version</span></Tooltip> : null}</span>
      <br />{n.body}
      {answer ? <Answer a={answer} small={small} cards={cards} candidate={candidate} /> : null}
    </li>
  );
}

/** The owner's answer to a request, as a plain reply: why not, what they'll do, or what was done. */
function Answer({ a, small, cards, candidate }: { a: BoardRequest; small?: boolean; cards: string[]; candidate: string }) {
  return (
    <div className="mt-1.5">
      <span className="font-semibold">{a.by ? cap(a.by) : 'The owner'}</span>{a.at ? <span className={`${small ? 'text-[12px]' : 'text-[13px]'} text-muted`}> · <When iso={a.at} /></span> : null}
      {a.status === 'declined' && a.reason ? <div>{sentence(a.reason)}</div> : null}
      {a.status === 'approved' ? <div>{a.instead ? sentence(a.instead) : 'On its way.'}</div> : null}
      {a.status === 'applied' && a.decisions.length ? (
        <ul className="space-y-0.5">
          {a.decisions.map((d) => (
            <li key={d.id}>
              {sentence(d.change)}{' '}
              {d.card !== candidate && cards.includes(d.card) ? <a href={href(d.card, { at: d.id })} className="hover:underline"><Id>{d.id} →</Id></a> : <Id>{d.id}</Id>}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
