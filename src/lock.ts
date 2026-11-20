/**
 * One write at a time. The agent runs `arbiter record` in a terminal while you click on the board, and
 * Claude Code may run several commands at once; each reads a file, changes it and writes it back, so
 * two at the same moment would each write over the other (both say "queued P-0009", one is lost).
 * Every write takes .arbiter/.lock first and lets it go when done; the next one waits its turn.
 *
 * And no half-written file: each is written beside itself and renamed into place, so a reader never
 * sees one cut short, and a crash mid-write leaves the old one whole.
 */

import fs from 'node:fs';
import path from 'node:path';
import type { Paths } from './store';

export const LOCK = '.lock';
/** Older than any write takes: left by a process that died holding it. */
const STALE = 30_000;
/** How long a write waits its turn before it gives up and says why. */
const WAIT = 20_000;

/** Held by this process: a write inside another one (judging that records) doesn't wait on itself. */
let held = 0;

const pause = (ms: number) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    // EPERM: it's there, run by someone else.
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

/** The lock, taken: waits while another process holds it, and clears one left by a process that died. */
function acquire(paths: Paths): void {
  fs.mkdirSync(paths.archiveDir, { recursive: true });
  const file = path.join(paths.archiveDir, LOCK);
  const start = Date.now();
  for (;;) {
    try {
      const fd = fs.openSync(file, 'wx');
      fs.writeSync(fd, `${process.pid}\n`);
      fs.closeSync(fd);
      return;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    try {
      const pid = Number(fs.readFileSync(file, 'utf8').trim());
      const old = Date.now() - fs.statSync(file).mtimeMs > STALE;
      if (old || (pid > 0 && pid !== process.pid && !alive(pid))) { fs.rmSync(file, { force: true }); continue; }
    } catch {
      continue; // gone between the two looks: try again at once
    }
    if (Date.now() - start > WAIT) {
      throw new Error(`another arbiter command has held .arbiter/${LOCK} for ${Math.round(WAIT / 1000)}s. If none is running, delete that file and try again.`);
    }
    pause(15 + Math.random() * 20);
  }
}

function release(paths: Paths): void {
  fs.rmSync(path.join(paths.archiveDir, LOCK), { force: true });
}

/** `fn` as the only write to this project's record, start to finish. */
export function withLock<T>(paths: Paths, fn: () => T): T {
  if (held) {
    held++;
    try { return fn(); } finally { held--; }
  }
  acquire(paths);
  held = 1;
  try {
    return fn();
  } finally {
    held = 0;
    release(paths);
  }
}

/** The same for a write that awaits, like the board's: nothing else in this process writes meanwhile, as the caller sees to. */
export async function withLockAsync<T>(paths: Paths, fn: () => Promise<T>): Promise<T> {
  if (held) {
    held++;
    try { return await fn(); } finally { held--; }
  }
  acquire(paths);
  held = 1;
  try {
    return await fn();
  } finally {
    held = 0;
    release(paths);
  }
}

/**
 * A whole file, written beside itself and renamed into place. Windows can refuse the rename for a moment
 * while something else has the file open (an editor, a virus scan): it tries again, then writes in place.
 */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i < 5 && (code === 'EPERM' || code === 'EACCES' || code === 'EBUSY')) { pause(20 * (i + 1)); continue; }
      fs.rmSync(tmp, { force: true });
      fs.writeFileSync(file, text);
      return;
    }
  }
}
