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
  /** When it was recorded: what places it among a card's pictures. */
  date?: string;
  /** A rule still in DECISIONS.md. A rule since retired or replaced has verdict "rule" and this false. */
  active?: boolean;
  /** The rule it's an exception to: what it goes against, kept here only. Its reason shows on hover. */
  against?: { id: string; decision: string; rationale?: string } | null;
  /** A rule no longer in DECISIONS.md: how it left. */
  ended?: RuleEnd | null;
}

/** How a rule left DECISIONS.md, and when: retired, with why, or replaced by a newer rule. */
export interface RuleEnd { kind: 'retired' | 'replaced'; date: string; why?: string; by?: { id: string; decision: string } }

/** One picture of a card, when it was taken. A card's versions run oldest first, the current picture last. */
export interface BoardVersion { src: string; date: string }

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
  /** Every picture it has had, oldest first, the current one last: only when it has had more than one. */
  versions?: BoardVersion[];
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
  /** Where it doesn't hold: the decisions kept as exceptions to it. */
  exceptions?: RuleLink[];
  /** Decisions that go against it, waiting in the Review inbox. Never in an export, which carries no queue. */
  waiting?: RuleLink[];
  /** For a rule no longer in DECISIONS.md: how it left. */
  ended?: RuleEnd | null;
}

/** A decision a rule's row points at: its id, the card it's on and that card's name, and its Change line. */
export interface RuleLink { id: string; card: string; name: string; change: string }

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
  /** Rules taken out of DECISIONS.md, the latest to go first, each with how it left. Sent with the rules. */
  retired?: BoardRule[] | null;
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
  /** Everything waiting for you in the queue (old one-off fixes left in a queue aren't counted). */
  pending: number;
  /** The team board's link, once the project has published one. */
  hosted: string | null;
  /** The team board's version as of the last pull: a comment written on another one is marked "earlier version". */
  version: string | null;
  /** Served by `arbiter review`, so the queue can be judged. An exported copy is read-only. */
  live: boolean;
  /** Folders made in the side nav's Areas, from `.arbiter/areas.json`. Null: none, the Areas list as the board orders it. */
  arrangement: Arrangement | null;
  /** Settings, from arbiter.json. Null on an exported copy, which has none. */
  settings: BoardSettings | null;
  /** The rules file's name: DECISIONS.md, unless the project's own DECISIONS.md was there first. Missing on older copies. */
  rulesFile?: string;
}

/** What the Preferences page shows and saves. Saved in arbiter.json. */
export interface BoardSettings {
  /** What the agent says in chat when a piece of work settles: nothing, a line after big work, a line after everything. */
  checkin: 'feature' | 'quiet' | 'every';
  /** The smallest call queued for review: features and patterns, or features only. */
  record: 'pattern' | 'feature';
  /** Whether choices the agent made between real options are queued, or only what you asked for or corrected. */
  agentCalls: boolean;
  /** Whether the agent takes a picture when a screen changes. */
  pictures: boolean;
  /** Where the app runs, for those pictures. */
  app: string | null;
  /** Whether the agent offers to group areas into folders once they pile up. */
  suggestFolders: boolean;
  /** The most rules DECISIONS.md holds, and how many it has now. */
  cap: number;
  rules: number;
}

/** A folder in the side nav's Areas: a name of your own, holding areas by name, in your order. */
export interface AreaFolder { id: string; name: string; areas: string[] }

export interface Arrangement {
  folders: AreaFolder[];
  /** The Areas list from the top, as you left it: a folder as `folder:<id>`, an area by its name. Anything not in it follows, in the board's own order. */
  order: string[];
}

export interface QueuedLine { id: string; change: string | null; decision: string; dimension: string; scope: string; date: string }

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

/**
 * One check of a file a decision names that failed: the file isn't there or is outside the project
 * (`exists`), doesn't have what it should (`present`), or still has what it shouldn't (`absent`, with the
 * text a pattern matched as `found`).
 */
export interface CodeCheck { kind: 'exists' | 'present' | 'absent'; file: string; needle?: string; detail?: string; found?: string }

/** A decision waiting for review, as `/api/state` sends it. */
export interface PendingDecision {
  id: string;
  level: 'feature' | 'pattern' | 'polish';
  dimension: string;
  /** What the files it names say now, read again each time the inbox loads: each check that fails, for its Code Clash. Null when they match, or it names none. */
  codeClash: CodeCheck[] | null;
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
  /** The rule it goes against, while that rule is in force: Keep as exception, Follow it, or Make this the rule. */
  againstRule: { id: string; decision: string; rationale?: string } | null;
  candidateName: string | null;
  snapshotUrl: string | null;
  /** The picture from before this decision, when the card's picture was retaken after it: Before beside Now. */
  before: BoardVersion | null;
  /** The screen this changed has no picture yet: the command that takes one. */
  picture: { command: string } | null;
}

/** How the agent hears of what you judge on the board: an agent waiting on the page, the Claude Code hook with your next message, or the next /arbiter. */
export type Agent = 'waiting' | 'next-message' | 'arbiter';

/** The review queue, as `/api/state` sends it. */
export interface ReviewState {
  project: string;
  pending: PendingDecision[];
  active: number;
  cap: number;
  agent: Agent;
}
