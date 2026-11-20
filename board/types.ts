import type { LocalBoard } from '../src/board-types';

/**
 * What the CLI sends the board. The shapes live with the CLI that builds them (src/board-types.ts),
 * so the page and the server can't disagree about them.
 */
export type { Agent, Arrangement, AreaFolder, BoardSettings, CodeCheck, LocalBoard, LocalComment, PendingDecision, QueuedLine, ReviewState } from '../src/board-types';

declare global {
  interface Window {
    /** Set by an exported copy, which has no server to ask. */
    __ARBITER_BOARD__?: LocalBoard;
  }
}
