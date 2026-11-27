// The two onboarding messages: what install says (one question, what it added, what needs you, what's
// next), and the intro at the first /arbiter, said once to everyone, whether or not install asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { checkinHandoff, init, installReport } from '../commands/init';
import { rules } from '../commands/rules';
import { setup } from '../commands/setup';
import { readConfig, resolvePaths, rulesMovedLine, writeConfig } from '../store';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-onboard-'));

/** What init printed to the terminal itself (the question, when it asks one). */
async function printedBy<T>(fn: () => Promise<T>): Promise<{ result: T; printed: string }> {
  const write = process.stdout.write.bind(process.stdout);
  let printed = '';
  (process.stdout as unknown as { write: (s: string) => boolean }).write = (s: string) => { printed += s; return true; };
  try {
    return { result: await fn(), printed };
  } finally {
    (process.stdout as unknown as { write: typeof write }).write = write;
  }
}

test('a fresh install says what it added in a sentence, then what to do next; no file-by-file list', async () => {
  const cwd = tmp();
  const steps = await init({ cwd, yes: true, skipInstall: true, author: 'test', client: 'claude-code' });
  const out = installReport(cwd, steps);
  assert.match(out, /^Added DECISIONS\.md for your design rules and \.arbiter\/ for the record\./);
  assert.ok(out.split('\n').every((l) => l.length <= 84), 'wrapped for a terminal');
  assert.match(out.replace(/\n/g, ' '), /Your agent's instructions \(CLAUDE\.md and AGENTS\.md\) got one line telling it to read your rules before UI work, and Arbiter's skill and hook are in \.claude\/\./);
  assert.match(out, /You're set\. Start a new agent session and build as usual\.\nWhen you're ready to review what you've built, type \/arbiter\.\n$/);
  assert.doesNotMatch(out, /created|unchanged|Needs you/);
  // --verbose has the list too.
  assert.match(installReport(cwd, steps, { verbose: true }), /arbiter\.json\s+created/);
});

test('Cursor: the sentence names what Cursor got', async () => {
  const cwd = tmp();
  const steps = await init({ cwd, yes: true, skipInstall: true, author: 'test', client: 'cursor' });
  assert.match(installReport(cwd, steps).replace(/\n/g, ' '), /Your agent's instructions \(AGENTS\.md\) got one line telling it to read your rules before UI work, and Arbiter's rule and \/arbiter command are in \.cursor\/\./);
});

test("the project's own DECISIONS.md: install says so first, and names the file the rules went to", async () => {
  const cwd = tmp();
  fs.writeFileSync(path.join(cwd, 'DECISIONS.md'), '# Architecture decisions\n\nPostgres, not Mongo.\n');
  const steps = await init({ cwd, yes: true, skipInstall: true, author: 'test', client: 'claude-code' });
  const out = installReport(cwd, steps).replace(/\n/g, ' ');
  assert.match(out, /^You already have a DECISIONS\.md, so Arbiter keeps your design rules in their own file, DESIGN-DECISIONS\.md\. Yours stays exactly as it is: Arbiter never writes to it\.  Added DESIGN-DECISIONS\.md for your design rules/);
  // The agent's version says the same, in chat, before the question.
  const said = checkinHandoff(rulesMovedLine('DESIGN-DECISIONS.md'));
  assert.match(said, /"Arbiter is installed\. You already have a DECISIONS\.md, so Arbiter keeps your design rules in their own file, DESIGN-DECISIONS\.md\. Yours stays exactly as it is: Arbiter never writes to it\. One question before you start: how should Arbiter check in while you work\?"/);
  // Question answered already: the agent still says the line, and asks nothing.
  const noQuestion = checkinHandoff(rulesMovedLine('DESIGN-DECISIONS.md'), false);
  assert.doesNotMatch(noQuestion, /One question|setup --checkin/);
});

test('a re-run says what changed, or that nothing did', async () => {
  const cwd = tmp();
  await init({ cwd, yes: true, skipInstall: true, author: 'test', client: 'claude-code' });
  const again = await init({ cwd, yes: true, skipInstall: true });
  assert.equal(installReport(cwd, again), 'Already set up. Nothing changed.\n');
  fs.writeFileSync(path.join(cwd, '.claude', 'skills', 'arbiter', 'SKILL.md'), 'old');
  const refreshed = await init({ cwd, yes: true, skipInstall: true });
  assert.equal(installReport(cwd, refreshed), 'Updated: .claude/skills/arbiter/SKILL.md.\n\nStart a new agent session so your agent picks this up.\n');
});

test('only what needs the person is listed, under Needs you', async () => {
  const cwd = tmp(); // no package.json here
  const steps = await init({ cwd, yes: true, author: 'test', client: 'claude-code' });
  const out = installReport(cwd, steps);
  assert.match(out, /Needs you:\n {2}package\.json {2}no package\.json here\. Add arbiterdesign as a dev dependency yourself, or type npx arbiterdesign where you'd type npx arbiter\./);
  assert.ok(out.indexOf('Needs you') < out.indexOf("You're set"));
});

test('nobody at the terminal (an agent ran it): nothing is asked or even printed as a question', async () => {
  const cwd = tmp();
  const { printed } = await printedBy(() => init({ cwd, skipInstall: true, author: 'test', interactive: false }));
  assert.equal(printed, '');
  assert.equal(readConfig(resolvePaths(cwd))?.onboarded, undefined, 'the question goes to the agent instead');
});

test('the first /arbiter intro is handed out once, to everyone: asked at install or not', () => {
  // Answered at install: the intro still comes, once, and the question doesn't.
  const answered = tmp();
  writeConfig(resolvePaths(answered), { version: 1, destination: 'local', author: 'test', checkin: 'quiet', onboarded: '2026-11-27T00:00:00Z' });
  const first = JSON.parse(rules(undefined, { cwd: answered, pending: true, json: true }));
  assert.equal(first.firstRun, true);
  assert.equal(first.askCheckin, false);
  assert.equal(first.checkin, 'quiet', 'step 1 of the intro follows the setting');
  assert.ok(readConfig(resolvePaths(answered))?.introduced);
  assert.equal(JSON.parse(rules(undefined, { cwd: answered, pending: true, json: true })).firstRun, false, 'once');

  // Never asked (an agent ran install and didn't relay it): the intro, then the question, until answered.
  const unasked = tmp();
  writeConfig(resolvePaths(unasked), { version: 1, destination: 'local', author: 'test' });
  const intro = JSON.parse(rules(undefined, { cwd: unasked, pending: true, json: true }));
  assert.equal(intro.firstRun, true);
  assert.equal(intro.askCheckin, true);
  const later = JSON.parse(rules(undefined, { cwd: unasked, pending: true, json: true }));
  assert.equal(later.firstRun, false);
  assert.equal(later.askCheckin, true, 'still unanswered, so still asked');
  assert.equal(setup({ cwd: unasked, checkin: 'every' }).exitCode, 0);
  assert.equal(JSON.parse(rules(undefined, { cwd: unasked, pending: true, json: true })).askCheckin, false);
});
