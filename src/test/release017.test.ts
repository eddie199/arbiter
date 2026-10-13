/**
 * 0.1.7, the clash replies: a decision can go against a rule (a one-off exception, or a clash
 * waiting at review), records who made the call, and a rule can be reworded without losing its
 * id. The line in CLAUDE.md says to ask before building against a decision, and init refreshes an older line.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { init } from '../commands/init';
import { judge, queue, record, retire, reword } from '../commands/record';
import { rules } from '../commands/rules';
import { readActive, readArchive, readPending, resolvePaths } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-017-'));
const o = (cwd: string) => ({ cwd, author: 'test' });
const json = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Remove is a word button, never an icon', rationale: 'Icons were missed', trigger: 'Guests', scope: 'pattern:remove-action', class: 'judgment', dimension: 'interaction', verdict: 'rule', level: 'pattern', ...over });

/** A project with D-0001 as an active rule. */
const withRule = () => {
  const cwd = tmp();
  assert.equal(record(json(), o(cwd)).exitCode, 0);
  return cwd;
};

test('"just this once": an accept against a rule is the logged exception, and the rule stays', () => {
  const cwd = withRule();
  const r = record(json({ decision: 'Events removes with a trash icon', verdict: 'accept', against: 'D-0001', call: 'asked', scope: 'file:app/events/page.tsx', trigger: 'Events' }), o(cwd));
  assert.equal(r.exitCode, 0, JSON.stringify(r.output));
  assert.equal(r.output.against, 'D-0001');
  const p = resolvePaths(cwd);
  assert.deepEqual(readActive(p).map((d) => d.id), ['D-0001'], 'the rule stays');
  const logged = readArchive(p).find((d) => d.id === 'D-0002')!;
  assert.equal(logged.against, 'D-0001');
  assert.equal(logged.call, 'asked');

  const one = JSON.parse(rules('D-0001', { cwd, json: true }));
  assert.deepEqual(one.exceptions.map((x: { id: string }) => x.id), ['D-0002']);
  assert.match(rules('D-0001', { cwd }), /\*\*Exceptions:\*\* D-0002 \(Events\)/);
});

test('against has to name a rule in force, and never goes on a retire', () => {
  const cwd = withRule();
  const missing = record(json({ verdict: 'accept', against: 'D-0042' }), o(cwd));
  assert.equal(missing.exitCode, 1);
  assert.match(String((missing.output.errors as string[])[0]), /D-0042 is not an active rule/);
  assert.equal(queue(json({ against: 'D-0042' }), o(cwd)).exitCode, 1, 'queueing checks it too');
  assert.equal(record(json({ verdict: 'accept', against: 'P-0001' }), o(cwd)).exitCode, 1, 'a pending id is not a rule');
  assert.equal(record(json({ verdict: 'accept', call: 'habit' }), o(cwd)).exitCode, 1, 'call is asked | corrected | agent');
});

test('"Not now" queues a clash once; the second one for the same screen and rule is refused', () => {
  const cwd = withRule();
  const notNow = json({ change: 'Events uses a trash icon', decision: 'Events removes with a trash icon', against: 'D-0001', trigger: 'Events' });
  const first = queue(notNow, o(cwd));
  assert.equal(first.output.status, 'queued');
  const again = queue(notNow, o(cwd));
  assert.equal(again.exitCode, 0);
  assert.equal(again.output.status, 'already-queued');
  assert.equal(again.output.id, first.output.id);
  assert.equal(readPending(resolvePaths(cwd)).length, 1);
  assert.equal(queue(json({ against: 'D-0001', trigger: 'Settings' }), o(cwd)).output.status, 'queued', 'another screen is another item');

  const one = JSON.parse(rules('D-0001', { cwd, json: true }));
  assert.deepEqual(one.waiting.map((x: { trigger: string }) => x.trigger), ['Events', 'Settings']);
  assert.match(rules(undefined, { cwd, pending: true }), /Against  D-0001/);
});

test('at review, Keep as exception links to the rule; a correction records who made the call', () => {
  const cwd = withRule();
  queue(json({ decision: 'Settings removes with a trash icon', trigger: 'Settings', verdict: undefined, call: 'agent' }), o(cwd));
  queue(json({ decision: 'Billing removes with a trash icon', trigger: 'Billing', verdict: undefined, call: 'agent' }), o(cwd));
  const kept = judge('P-0001', { ...o(cwd), as: 'accept', against: 'D-0001' });
  assert.equal(kept.exitCode, 0, JSON.stringify(kept.output));
  assert.equal(kept.output.against, 'D-0001');
  assert.equal(judge('P-0002', { ...o(cwd), as: 'accept', against: 'D-0099' }).exitCode, 1, 'only a rule in force');

  const fixed = judge('P-0002', { ...o(cwd), as: 'fix', to: 'Billing removes with a word button' });
  assert.equal(fixed.exitCode, 0);
  const p = resolvePaths(cwd);
  assert.equal(readArchive(p).find((d) => d.id === fixed.output.id)!.call, 'corrected');
});

test('a queued clash keeps its against even if the rule is replaced before review', () => {
  const cwd = withRule();
  queue(json({ against: 'D-0001', trigger: 'Events', decision: 'Events removes with a trash icon' }), o(cwd));
  assert.equal(retire('D-0001', 'DESIGN.md covers this', o(cwd)).exitCode, 0);
  const r = judge('P-0001', { ...o(cwd), as: 'accept' });
  assert.equal(r.exitCode, 0, 'the clash is history now, not an error');
  assert.equal(readArchive(resolvePaths(cwd)).find((d) => d.id === r.output.id)!.against, 'D-0001');
});

test('reword keeps the id and the reason, in both files, and keeps the old wording', () => {
  const cwd = withRule();
  record(json({ decision: 'Rule two', scope: 'pattern:other', dimension: 'content' }), o(cwd));
  const r = reword('D-0001', 'Exception to the design system: Remove is a word button, never an icon', o(cwd));
  assert.equal(r.exitCode, 0, JSON.stringify(r.output));
  assert.equal(r.output.was, 'Remove is a word button, never an icon');

  const p = resolvePaths(cwd);
  for (const d of [readActive(p).find((x) => x.id === 'D-0001')!, readArchive(p).find((x) => x.id === 'D-0001')!]) {
    assert.equal(d.decision, 'Exception to the design system: Remove is a word button, never an icon');
    assert.equal(d.rationale, 'Icons were missed', 'the reason stays');
    assert.equal(d.reworded.length, 1);
    assert.match(d.reworded[0], /^Remove is a word button, never an icon \(until \d{4}-\d{2}-\d{2}\)$/);
  }
  assert.deepEqual(readActive(p).map((d) => d.id).sort(), ['D-0001', 'D-0002'], 'nothing else moved');
  assert.equal(readArchive(p).length, 2, 'no new entry');
  assert.match(fs.readFileSync(p.decisions, 'utf8'), /- \*\*Reworded:\*\*\n {2}- Remove is a word button/);

  assert.equal(reword('D-0001', 'Exception to the design system: Remove is a word button, never an icon', o(cwd)).exitCode, 1, 'already says that');
  assert.equal(reword('D-0009', 'x', o(cwd)).exitCode, 1, 'not an active rule');
  assert.equal(reword('D-0001', '', o(cwd)).exitCode, 1, 'needs --to');
  assert.equal(reword('D-0001', 'two\nlines', o(cwd)).exitCode, 1, 'one line');
});

test('the CLAUDE.md line says to ask before building against a decision, and init refreshes an older line in place', async () => {
  const cwd = tmp();
  fs.mkdirSync(path.join(cwd, '.claude'));
  const old = "Before any UI work, read `DECISIONS.md` — the design decisions this project has already made. Follow them; don't re-decide them. Record new ones with the `arbiter` skill. <!-- arbiter -->";
  fs.writeFileSync(path.join(cwd, 'CLAUDE.md'), `# Agent instructions\n\n${old}\n\nUse pnpm.\n`);

  const steps = await init({ cwd, yes: true, skipInstall: true, author: 'test' });
  assert.deepEqual(steps.find((s) => s.file === 'CLAUDE.md'), { file: 'CLAUDE.md', outcome: 'updated', note: 'Arbiter line refreshed' });
  const claude = fs.readFileSync(path.join(cwd, 'CLAUDE.md'), 'utf8');
  assert.equal((claude.match(/<!-- arbiter -->/g) ?? []).length, 1);
  assert.ok(claude.includes("goes against a decision, don't build yet: ask first, the way the `arbiter` skill shows. A decision written as an exception (\"Exception to the design system: …\") beats the design system without asking: follow it and say so. <!-- arbiter -->"));
  assert.ok(claude.startsWith('# Agent instructions\n\n'), 'the line stays where it was');
  assert.ok(claude.endsWith('\n\nUse pnpm.\n'), 'the rest of the file is left alone');

  const again = await init({ cwd, yes: true, skipInstall: true });
  assert.equal(again.find((s) => s.file === 'CLAUDE.md')!.outcome, 'unchanged');
});
