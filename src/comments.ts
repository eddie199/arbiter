/**
 * The team board's comments, as `arbiter pull` keeps them: .arbiter/comments.json, committed. Pull
 * writes the file (src/hosted.ts); requests and the local board read it. Kept here, apart from the
 * publish code, so reading them doesn't mean depending on it.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './store';

const COMMENTS_FILE = 'comments.json';

export interface PulledComment {
  id: string;
  candidate_id: string;
  decision_id: string | null;
  /** `request` — "Request change" on the board: it becomes a request (R-0001) the owner answers. */
  kind: 'comment' | 'approve' | 'request';
  author_name: string;
  /** The board sends it; it's never kept. comments.json is committed, and a public repo would publish it. */
  author_email?: string;
  body: string;
  created_at: string;
  /** The board's published_at when this was written. Differs from the current one after a republish. */
  board_version?: string | null;
}

export function readComments(paths: Paths): PulledComment[] {
  const f = path.join(paths.archiveDir, COMMENTS_FILE);
  return fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')) as PulledComment[]) : [];
}

/** Every comment on file, minus email addresses: nothing here needs them, and the file is committed. */
export function writeComments(paths: Paths, comments: PulledComment[]): void {
  const kept = comments.map(({ author_email: _email, ...c }) => c);
  fs.writeFileSync(path.join(paths.archiveDir, COMMENTS_FILE), JSON.stringify(kept, null, 2) + '\n');
}
