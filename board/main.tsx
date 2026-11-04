import { createRoot } from 'react-dom/client';
import { App } from './App';
import { getBoard } from './api';
import type { LocalBoard } from './types';

/**
 * The local board's entry. Served by `npx arbiter review`, it asks the CLI for the board; an exported
 * copy, with no server behind it, carries the board in `window.__ARBITER_BOARD__` instead.
 */
const load = async (): Promise<LocalBoard> => window.__ARBITER_BOARD__ ?? getBoard();

const root = createRoot(document.getElementById('root')!);
load().then(
  (data) => root.render(<App initial={data} />),
  (e: Error) => root.render(
    <main className="mx-auto max-w-md px-5 py-24 text-center">
      <p className="font-semibold tracking-tight">This board didn’t load</p>
      <p className="mt-1 text-[13px] text-muted">{e.message}. Is <code className="font-mono text-[12px]">npx arbiter review</code> still running?</p>
    </main>,
  ),
);
