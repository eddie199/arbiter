/**
 * Minimal line prompter for interactive commands. Buffers input lines so
 * answers that arrive together (piped stdin, fast typists) aren't dropped
 * between questions. Resolves '' once input closes, so a short pipe falls
 * through to defaults.
 */

import readline from 'node:readline';

export class Prompter {
  private rl = readline.createInterface({ input: process.stdin, terminal: false });
  private lines: string[] = [];
  private waiting: ((s: string) => void)[] = [];
  private closed = false;

  constructor() {
    this.rl.on('line', (l) => {
      const w = this.waiting.shift();
      if (w) w(l);
      else this.lines.push(l);
    });
    this.rl.on('close', () => {
      this.closed = true;
      for (const w of this.waiting.splice(0)) w('');
    });
  }

  question(q: string): Promise<string> {
    process.stdout.write(q);
    const l = this.lines.shift();
    if (l !== undefined) return Promise.resolve(l);
    if (this.closed) return Promise.resolve('');
    return new Promise((res) => this.waiting.push(res));
  }

  /** Ask until non-empty, or return the default. */
  async required(q: string, dflt?: string): Promise<string> {
    for (;;) {
      const a = (await this.question(dflt ? `${q} (${dflt}): ` : `${q}: `)).trim();
      if (a) return a;
      if (dflt) return dflt;
      if (this.closed) return '';
    }
  }

  /** Numbered pick. Returns the chosen value. */
  async pick<T extends string>(q: string, options: readonly T[], dflt: T): Promise<T> {
    const menu = options.map((o, i) => `  ${i + 1}. ${o}`).join('\n');
    const a = (await this.question(`${q}\n${menu}\n(${options.indexOf(dflt) + 1}): `)).trim();
    const n = Number(a);
    if (n >= 1 && n <= options.length) return options[n - 1];
    if ((options as readonly string[]).includes(a)) return a as T;
    return dflt;
  }

  close(): void {
    this.rl.close();
  }
}
