#!/usr/bin/env node
import { Command } from 'commander';
import { record, queue, queueFindings, judge, judgeAll, retire, interactiveInput, JudgeAction } from './commands/record';
import { judgeRequest, RequestAction } from './commands/request';
import { verifyCommand } from './commands/verify';
import { sweepCommand } from './commands/sweep';
import { addCandidate, updateCandidate } from './commands/candidate';
import { board } from './commands/board';
import { drift } from './commands/drift';
import { exportBoard } from './commands/export';
import { publish } from './commands/publish';
import { pull } from './commands/pull';
import { snapshotWork } from './commands/snapshot';
import { setup } from './commands/setup';
import { rules } from './commands/rules';
import { init } from './commands/init';
import { review } from './commands/review';
import { update } from './commands/update';
import { remove, removeSnapshot, unlink } from './commands/remove';
import { autoPublish } from './autopublish';

const program = new Command();

program
  .name('arbiter')
  .description('Records design decisions made during agent-assisted UI work and feeds them back into the agent.')
  .version(require('../package.json').version);

program
  .command('record [json-or-pending-id]')
  .description('Append a decision (JSON), queue it (--pending), judge a queued one (P-0003 --as rule), or answer a request from the board (R-0001 --as apply). No input at a terminal: asks step by step.')
  .option('--pending', 'queue in .arbiter/pending.md for later review instead of recording now')
  .option('--findings <file>', "queue one pending decision per finding in a scanner's JSON output")
  .option('--tool <name>', 'with --findings: the scanner name for the record')
  .option('--candidate <id>', 'the candidate (C-0001) this decision was made for')
  .option('--retire <rule-id>', 'drop an active rule with no replacement (needs --why)')
  .option('--why <reason>', 'with --retire: why the rule is dead; with a request and --as decline: why not')
  .option('--unverified', 'record even if the named files contradict the claim')
  .option('--as <action>', 'judge a pending id: accept | rule | skip | fix; answer a request id: apply | decline')
  .option('--request <id>', 'the approved request (R-0001) this change was made for — recording it applies the request')
  .option('--all', 'with --as: judge every pending item the same way')
  .option('--level <level>', 'with --all: only this level (feature | pattern | polish)')
  .option('--trigger <text>', 'with --all: only items queued for this piece of work')
  .option('--to <decision>', 'with --as fix: what it should be instead; with a request and --as apply: what to do instead of what was asked')
  .option('--supersedes <id>', 'the active rule this one replaces')
  .option('--ref <url|key>', 'the ticket this was for: a URL or an issue key like ENG-123')
  .option('--keep-both', 'record alongside overlapping rules instead of replacing one')
  .option('--author <name>', 'override the author')
  .option('--dry-run', 'validate and check overlap without writing')
  .action(async (arg: string | undefined, opts) => {
    let result;
    if (opts.retire) {
      result = retire(opts.retire, opts.why, opts);
    } else if (opts.findings) {
      result = queueFindings(opts.findings, opts);
    } else if (opts.all) {
      const as = opts.as as JudgeAction | undefined;
      if (!as || !['accept', 'rule', 'skip'].includes(as)) {
        result = { exitCode: 1 as const, output: { status: 'invalid', errors: ['--all needs --as accept | rule | skip'] } };
      } else {
        result = judgeAll({ ...opts, as });
      }
    } else if (arg && /^P-\d{4,}$/.test(arg)) {
      const as = opts.as as JudgeAction | undefined;
      if (!as || !['accept', 'rule', 'skip', 'fix'].includes(as)) {
        result = { exitCode: 1 as const, output: { status: 'invalid', errors: ['judging a pending id needs --as accept | rule | skip | fix'] } };
      } else {
        result = judge(arg, { ...opts, as });
      }
    } else if (arg && /^R-\d{4,}$/.test(arg)) {
      const as = opts.as as RequestAction | undefined;
      if (!as || !['apply', 'decline'].includes(as)) {
        result = { exitCode: 1 as const, output: { status: 'invalid', errors: ['answering a request needs --as apply (Apply, but…: add --to "<instead>") | decline --why "<reason>"'] } };
      } else {
        result = judgeRequest(arg, { ...opts, as });
      }
    } else {
      let input = arg ?? (await readStdin());
      if (!input.trim() && process.stdin.isTTY) input = await interactiveInput();
      if (!input.trim()) {
        process.stdout.write(JSON.stringify({ status: 'invalid', errors: ['no input — pass JSON as an argument or on stdin'] }, null, 2) + '\n');
        process.exit(1);
      }
      result = opts.pending ? queue(input, opts) : record(input, opts);
    }
    process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
    // Queueing never reaches the board — work cards are built from judged decisions.
    if (result.exitCode === 0 && !opts.pending) await boardUpdated(opts.cwd);
    process.exit(result.exitCode);
  });

program
  .command('init')
  .description('Install Arbiter into this project: skill, DECISIONS.md, .arbiter/, arbiter.json, one line in AGENTS.md.')
  .option('--client <name>', 'claude-code or cursor (default: detected)')
  .option('--author <name>', 'who decides rules (default: git user.name)')
  .option('--destination <name>', 'local (default) or git — git also commits candidate pages and prints GitHub links')
  .option('-y, --yes', 'no questions — use detected values')
  .option('--skip-install', 'do not add the package to devDependencies')
  .action(async (opts) => {
    const steps = await init(opts);
    const w = Math.max(...steps.map((s) => s.file.length));
    for (const s of steps) {
      process.stdout.write(`  ${s.file.padEnd(w)}  ${s.outcome}${s.note ? `  — ${s.note}` : ''}\n`);
    }
    process.stdout.write('\nDone. Start a new agent session — it will read DECISIONS.md before UI work.\n');
    if (opts.destination === 'git') {
      process.stdout.write([
        '',
        'Git destination: every candidate change commits its page, CANDIDATES.md, and the board page in docs/arbiter/.',
        'To serve the board page publicly, once: GitHub → your repo → Settings → Pages → Source: "Deploy from a branch",',
        'Branch: main, Folder: /docs → Save. Then push. `npx arbiter board` prints the URL.',
        '',
      ].join('\n'));
    }
  });

program
  .command('verify [id]')
  .description("Re-check a decision's claim against its files. No id: every active rule with evidence.")
  .option('--json', 'machine-readable output')
  .action((id: string | undefined, opts) => {
    const r = verifyCommand(id, opts);
    process.stdout.write(r.text + '\n');
    process.exit(r.ok ? 0 : 4);
  });

program
  .command('sweep <rule-id>')
  .description('Find existing violations of a mechanical rule. Read-only.')
  .option('--queue', 'queue one pending decision per affected file for review')
  .option('--author <name>', 'author for queued items')
  .option('--json', 'machine-readable output')
  .action((id: string, opts) => {
    const r = sweepCommand(id, opts);
    process.stdout.write(r.text + '\n');
  });

program
  .command('setup')
  .description('Save how Arbiter checks in while you work: --checkin feature (one line after big work) | quiet | every. Marks the project as onboarded.')
  .option('--checkin <mode>', 'feature | quiet | every')
  .action((opts) => {
    const result = setup(opts);
    process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
    process.exit(result.exitCode);
  });

program
  .command('snapshot <work>')
  .description('Attach a picture to a piece of work, named as its decisions named it: snapshot "Settings build" --file shot.png')
  .option('--file <image>', 'screenshot to keep beside the work')
  .option('--capture', 'macOS: drag-select a region of the screen')
  .action(async (work: string, opts) => {
    const result = snapshotWork(work, opts);
    process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
    if (result.exitCode === 0) await boardUpdated(opts.cwd);
    process.exit(result.exitCode);
  });

program
  .command('candidate <id-or-add> [name]')
  .description('Track a generated screen. `candidate add "<name>"` creates one; `candidate C-0002 --state approved` updates one.')
  .option('--feature <name>', 'group directions for one feature together')
  .option('--snapshot <image>', 'screenshot to keep beside the candidate')
  .option('--capture', 'macOS: drag-select a region of the screen as the snapshot')
  .option('--notes <text>', 'free text')
  .option('--state <state>', 'generated | in_review | approved | rejected | superseded')
  .option('--why <reason>', 'why it was rejected or superseded (kept forever)')
  .option('--by <id>', 'with --state superseded: the candidate that replaced it')
  .option('--keep-others', "approving doesn't supersede sibling directions")
  .option('--author <name>', 'override the author')
  .action(async (idOrAdd: string, name: string | undefined, opts) => {
    const result = idOrAdd === 'add' ? addCandidate(name ?? '', opts) : updateCandidate(idOrAdd, opts);
    process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
    if (result.exitCode === 0) await boardUpdated(opts.cwd);
    process.exit(result.exitCode);
  });

program
  .command('board')
  .description('Candidates and their states.')
  .option('--feature <name>', 'one feature only')
  .option('--json', 'machine-readable output')
  .action((opts) => {
    process.stdout.write(board(opts) + '\n');
  });

program
  .command('drift')
  .description('Deviations per screen: accepted exceptions, unverified claims, rules currently broken.')
  .option('--feature <name>', 'one feature only')
  .option('--json', 'machine-readable output')
  .action((opts) => {
    process.stdout.write(drift(opts) + '\n');
  });

program
  .command('export')
  .description('Write a static, self-contained folder of the board for people without the repo. Opens anywhere.')
  .option('--out <dir>', 'output folder (default: arbiter-export)')
  .option('--feature <name>', 'one feature only')
  .option('--include-rules', 'append the standing rules')
  .option('--open', 'open it in the browser')
  .action((opts) => {
    const r = exportBoard(opts);
    process.stdout.write(`Exported ${r.candidates} screen${r.candidates === 1 ? '' : 's'}, ${r.snapshots} snapshot${r.snapshots === 1 ? '' : 's'} → ${r.dir}\nOpen ${r.index}, or put the folder on any static host.\n`);
  });

program
  .command('publish')
  .description('Put the board online at arbiter.design and print the link. --to <url> for your own hosted Arbiter; --to pages for GitHub Pages (git destination, export, commit, push). Nothing to set up first.')
  .option('--to <url|pages>', 'where to publish: a hosted Arbiter (default arbiter.design), or `pages` for GitHub Pages')
  .option('--admin-token <token>', 'only for a self-hosted Arbiter that gates board creation')
  .option('--no-push', 'GitHub Pages mode: do everything except push')
  .option('--on-push', 'also write a GitHub Actions workflow that republishes on every push, and set its secret')
  .option('--auto', 'republish whenever the record changes — no GitHub, no CI, no repository needed')
  .option('--no-auto', 'stop republishing automatically')
  .action(async (opts) => {
    const r = await publish({ noPush: opts.push === false, to: opts.to, admin: opts.adminToken, onPush: opts.onPush, auto: opts.auto === undefined ? undefined : !!opts.auto });
    const w = Math.max(...r.steps.map((s) => s.step.length));
    for (const s of r.steps) process.stdout.write(`  ${s.step.padEnd(w)}  ${s.outcome}${s.note ? `  — ${s.note}` : ''}\n`);
    if (r.url) process.stdout.write(`\n${r.ok ? 'Live in about a minute' : 'Once the failed step is fixed'}: ${r.url}\n`);
    process.exit(r.ok ? 0 : 1);
  });

program
  .command('pull')
  .description('Fetch comments and "looks good" reactions from the hosted board into .arbiter/comments.json. "Request change" becomes a request (R-0001) to answer.')
  .action(async () => {
    process.stdout.write((await pull()) + '\n');
  });

program
  .command('review')
  .description('Open a local page to judge pending decisions.')
  .option('--port <n>', 'port (default: any free port)', (v) => Number(v))
  .option('--no-open', "print the URL, don't open a browser")
  .action(async (opts) => {
    await review(opts);
  });

program
  .command('remove [id]')
  .description('Take a record out that was never real: a decision (D-0004), a screen (C-0001), or a picture (--snapshot "<work>"). A rule that is simply over is `record --retire` instead.')
  .option('--snapshot <work>', 'remove the picture attached to a piece of work or a screen, keeping the record')
  .option('--force', 'with a screen: unlink the decisions on it rather than refusing')
  .action(async (id: string | undefined, opts) => {
    const result = opts.snapshot ? removeSnapshot(opts.snapshot, opts) : remove(id ?? '', opts);
    process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
    if (result.exitCode === 0) await boardUpdated(opts.cwd);
    process.exit(result.exitCode);
  });

program
  .command('unlink <ids...>')
  .description('Detach decisions from the screen they were recorded against. The decisions stay exactly as they are.')
  .action(async (ids: string[], opts) => {
    const result = unlink(ids, opts);
    process.stdout.write(JSON.stringify(result.output, null, 2) + '\n');
    if (result.exitCode === 0) await boardUpdated(opts.cwd);
    process.exit(result.exitCode);
  });

program
  .command('update')
  .description('Bring this project up to the newest Arbiter: install it, refresh the skill file, re-pin the publish workflow. Settings and decisions untouched.')
  .option('--check', 'report whether the skill file is behind the CLI; change nothing')
  .option('--skip-install', 'refresh the skill from this copy without touching package.json')
  .action(async (opts) => {
    const r = await update(opts);
    const ver = (v: string | null) => v ?? 'before 0.1.3';
    if (opts.check) {
      const s = r.before;
      const line = s.file
        ? `${s.file}: ${ver(s.skill)} · cli: ${s.cli} · ${s.stale ? 'behind — run: npx arbiter update' : 'current'}`
        : 'no skill file — run: npx arbiter init';
      process.stdout.write(line + '\n');
      process.exit(s.stale ? 1 : 0);
    }
    const w = Math.max(...r.steps.map((s) => s.step.length));
    for (const s of r.steps) process.stdout.write(`  ${s.step.padEnd(w)}  ${s.outcome}${s.note ? `  — ${s.note}` : ''}\n`);
    process.stdout.write(`\n${r.after.file ?? 'skill'}: ${ver(r.before.skill)} → ${ver(r.after.skill)}${r.ok ? '. Start a new agent session to pick it up.' : ''}\n`);
    process.exit(r.ok ? 0 : 1);
  });

program
  .command('rules [id]')
  .description('Read decisions. No args: active rules. An id (D-0003, or a request R-0001): that one in full.')
  .option('--dimension <name>', 'only one dimension (structure, interaction, states, content, visual, motion, access)')
  .option('--archive', 'everything ever recorded — accepts, fixes, superseded — oldest first')
  .option('--pending', 'queued decisions not yet judged, and requests from the board not yet answered or made')
  .option('--json', 'machine-readable output')
  .action((id: string | undefined, opts) => {
    process.stdout.write(rules(id, opts) + '\n');
  });

program.parseAsync(process.argv).catch((e: Error) => {
  process.stderr.write(`arbiter: ${e.message}\n`);
  process.exit(1);
});

/** With `hosted.auto`, the board follows the record. Prints a line when it does, or why it didn't. */
async function boardUpdated(cwd?: string): Promise<void> {
  const line = await autoPublish(cwd);
  if (line) process.stdout.write(line + '\n');
}

function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return Promise.resolve('');
  return new Promise((resolve) => {
    let data = '';
    process.stdin.setEncoding('utf8');
    process.stdin.on('data', (c) => (data += c));
    process.stdin.on('end', () => resolve(data));
  });
}
