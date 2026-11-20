import type { Agent, LocalBoard, ReviewState } from './types';

/**
 * The CLI's review server: the same calls the old review page made. Every write is JSON, which
 * another site in the same browser can't send without asking first, and nothing here answers it.
 */
export type Reply = Record<string, any> & { exitCode: number };

export async function post(path: string, body: unknown): Promise<Reply> {
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return (await res.json()) as Reply;
}

export const getBoard = async (): Promise<LocalBoard> => {
  const res = await fetch('/api/board');
  if (!res.ok) throw new Error(`the board didn't load (${res.status})`);
  return (await res.json()) as LocalBoard;
};

export const getState = async (): Promise<ReviewState> => {
  const res = await fetch('/api/state');
  if (!res.ok) throw new Error(`the review queue didn't load (${res.status})`);
  return (await res.json()) as ReviewState;
};

/** This tab, to the server: it checks for changes as this tab, and says goodbye as it closes. */
const PAGE = Math.random().toString(36).slice(2);

/** What the board is drawn from, as one value that changes when the files do, whoever changed them. Null: the board has stopped. */
export const getStamp = async (): Promise<string | null> => {
  try {
    const res = await fetch(`/api/stamp?page=${PAGE}`);
    return res.ok ? ((await res.json()) as { stamp: string }).stamp : null;
  } catch {
    return null;
  }
};

/** As the tab closes: the board stops once its last tab has gone. Kept alive, so it goes out as the page unloads. */
export const sayBye = () => {
  void fetch('/api/bye', { method: 'POST', keepalive: true, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ page: PAGE }) }).catch(() => {});
};

/** When the agent makes a code change you ask for here. */
export const whenAgent = (agent: Agent) => (agent === 'waiting' ? 'when you close the board' : agent === 'next-message' ? 'with your next message' : 'at the next /arbiter');

/** The server's errors, in one line, starting with a capital as every line on the board does. */
export const errorsOf = (r: Reply) => {
  const text = (r.errors as string[] | undefined)?.join(' · ') ?? (r.message as string | undefined) ?? 'Something went wrong';
  return text.charAt(0).toUpperCase() + text.slice(1);
};
