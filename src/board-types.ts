/**
 * What the local board draws, as the CLI sends it: one definition for both sides. The CLI builds it
 * (src/localboard.ts) and the page reads it (board/types.ts, board/lib/board.ts), so a change to one
 * that the other doesn't follow fails the build instead of breaking the page.
 *
 * Types only, with no imports: the page's build reads this file too.
 */

/** `recorded`: a piece of work with no competing directions, nothing to approve, just what was decided. */
export type CandidateState = 'generated' | 'in_review' | 'approved' | 'rejected' | 'superseded' | 'recorded';

export interface BoardDecision {
  id: string;
  change: string | null;
  decision: string;
  rejected: string[];
  verdict: string;
  dimension?: string;
  scope?: string;
  ref?: string | null;
}

/** A card: a screen (C-0001) with its options, or a piece of work (W-…) whose decisions had no screen. */
export interface BoardCandidate {
  id: string;
  name: string;
  feature: string | null;
  state: CandidateState;
  author: string;
  date: string;
  reason: string | null;
  notes: string;
  supersededBy: string | null;
  url: string | null;
  /** Where the page loads its picture from: the review server's /snapshots/, or an export's snapshots/ folder. */
  snapshot: string | null;
  decisions: BoardDecision[];
  /** A card made from a piece of work, not a registered direction. Id `W-…`. */
  work?: boolean;
}

export interface BoardRule {
  id: string;
  dimension: string;
  decision: string;
  rationale: string;
  /** The screen it was decided on, when it's one on this board. */
  candidate?: string | null;
  /** The day it was made a rule, `yyyy-mm-dd`. */
  date?: string | null;
}

/** The owner's answer to a change request from the team board, matched to the request by its comment id. */
export interface BoardRequest {
  comment: string;
  /** R-0001, the id the owner sees in their queue. */
  id: string;
  status: 'approved' | 'applied' | 'declined';
  /** Apply, but…: what the owner chose to do instead. */
  instead: string | null;
  /** Why it was declined. */
  reason: string | null;
  by: string | null;
  at: string | null;
  /** What was actually done, and the card each change shows on. */
  decisions: { id: string; change: string; card: string }[];
}

export interface Board {
  project: string;
  /** The day this was read, `yyyy-mm-dd`. */
  exported: string;
  candidates: BoardCandidate[];
  rules: BoardRule[] | null;
  requests?: BoardRequest[];
}

/** What `/api/board` sends, and what an exported copy carries inside its page. */
export interface LocalBoard {
  board: Board;
  /** Comments from the team board, as `arbiter pull` last brought them. Read here, written there. */
  comments: LocalComment[];
  /** Decisions waiting for review, per card id (C-0001 or W-…). Polish isn't counted. */
  waiting: Record<string, number>;
  /** The same decisions, enough of each to draw and place a card before anything on it is judged. */
  queued: Record<string, QueuedLine[]>;
  /** Everything waiting in the queue, polish included. */
  pending: number;
  /** The team board's link, once the project has published one. */
  hosted: string | null;
  /** The team board's version as of the last pull: a comment written on another one is marked "earlier version". */
  version: string | null;
  /** Served by `arbiter review`, so the queue can be judged. An exported copy is read-only. */
  live: boolean;
}

export interface QueuedLine { id: string; change: string | null; decision: string; dimension: string; scope: string }

export interface LocalComment {
  id: string;
  candidate_id: string;
  decision_id: string | null;
  kind: 'comment' | 'approve' | 'request';
  author_name: string;
  body: string;
  created_at: string;
  board_version?: string | null;
}

/** A decision waiting for review, as `/api/state` sends it. */
export interface PendingDecision {
  id: string;
  level: 'feature' | 'pattern' | 'polish';
  dimension: string;
  verified?: boolean | null;
  author: string;
  date: string;
  change: string | null;
  decision: string;
  rejected: string[];
  rationale: string;
  scope: string;
  ref?: string | null;
  trigger: string;
  candidate?: string | null;
  /** The card it waits on: its screen, or its piece of work. */
  card: string;
  /** The rule it goes against, while that rule is in force: Follow, Replace or Keep as exception. */
  againstRule: { id: string; decision: string } | null;
  candidateName: string | null;
  snapshotUrl: string | null;
  /** The screen this changed has no picture yet: the command that takes one. */
  picture: { command: string } | null;
}

/** A change someone asked for on the team board, as the Requests page shows it. */
export interface ChangeRequest {
  id: string;
  author: string;
  body: string;
  screen: string;
  screenName: string | null;
  decision: string | null;
  decisionText: string | null;
  date: string;
  earlierVersion: boolean;
  status: 'open' | 'approved' | 'declined' | 'applied';
  instead: string | null;
  snapshotUrl: string | null;
}

/** How the agent hears of what you judge on the board: an agent waiting on the page, the Claude Code hook with your next message, or the next /arbiter. */
export type Agent = 'waiting' | 'next-message' | 'arbiter';

/** The review queue, as `/api/state` sends it. */
export interface ReviewState {
  project: string;
  pending: PendingDecision[];
  requests: ChangeRequest[];
  active: number;
  cap: number;
  agent: Agent;
}
