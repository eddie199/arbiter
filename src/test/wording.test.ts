import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { queue, record } from '../commands/record';
import { PKG_ROOT } from '../commands/init';
import { readPending, resolvePaths, writeConfig } from '../store';
import { codeWords, unclearLines } from '../wording';

const tmp = () => {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-wording-'));
  writeConfig(resolvePaths(cwd), { version: 1, destination: 'local', author: 'test' });
  return cwd;
};

const item = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    change: 'Clicking a Rule badge jumps to that rule, with its number highlighted',
    decision: 'A Rule badge on a screen links to its rule on the Design rules page',
    rationale: 'People wanted to see the whole rule',
    rejected: ['Tinting the whole row: the tint ran past the edge of the list'],
    trigger: 'Rule badges',
    scope: 'pattern:rule-badge',
    dimension: 'interaction',
    class: 'judgment',
    level: 'pattern',
    ...over,
  });

test('code words: files, classes, stuck-together names and backticks are caught', () => {
  assert.deepEqual(codeWords('Applies to lib/writing.ts'), ['lib/writing.ts']);
  assert.deepEqual(codeWords('The source line uses text-xs under an ArrowUpRight'), ['ArrowUpRight', 'text-xs']);
  assert.deepEqual(codeWords('Too cramped at the w-24 mobile column'), ['w-24']);
  assert.deepEqual(codeWords('The row turns fg when it is the target'), ['fg']);
  assert.deepEqual(codeWords('Wired to onClick in ScreenView.tsx'), ['ScreenView.tsx', 'onClick']);
  assert.deepEqual(codeWords('Rows on a 1fr / 1.75fr split'), ['1fr', '1.75fr']);
  assert.deepEqual(codeWords('Icon buttons get an aria-label'), ['aria-label']);
  assert.deepEqual(codeWords('The heading is `Settings`'), ['`Settings`']);
  assert.deepEqual(codeWords('Three columns from md:grid-cols-3 up'), ['md:grid-cols-3']);
});

test('code words: product names and the way designers talk pass', () => {
  for (const line of [
    'The marketing site moved to Next.js',
    'On iPhone and macOS the sheet opens from the bottom',
    'Links to the GitHub repo and the FigJam board',
    'Cards have 16px padding and a 2px border',
    'The badge sits in the top-left corner',
    'Text-only rows in the Writing row style',
    'A data-driven chart replaces the table',
    'Delete asks first, in a dialog',
  ]) {
    assert.deepEqual(codeWords(line), [], line);
  }
});

test('a line over 25 words is refused; a mechanical rule may name its token', () => {
  const long = 'The Projects page now has an Other projects section with three cards in a row under the main cards, each with a title, an impact line, pills and a screen';
  assert.match(unclearLines(JSON.parse(item({ change: long })))[0], /change is 30 words, over 25/);
  const mechanical = JSON.parse(item({ class: 'mechanical', decision: 'Body text uses text-base', change: 'Body text is one size bigger' }));
  assert.deepEqual(unclearLines(mechanical), []);
  assert.equal(unclearLines({ ...mechanical, change: 'Body text is text-base now' }).length, 1, 'its change still says it in words');
});

test('record --pending refuses an unclear line and writes nothing; the plain version is queued', () => {
  const cwd = tmp();
  const r = queue(item({ change: 'The rule badge links to the row; the row is an anchor and its id turns fg when it is the target' }), { cwd, author: 'test' });
  assert.equal(r.exitCode, 1);
  assert.equal(r.output.status, 'unclear');
  assert.match((r.output.errors as string[])[0], /change reads like code \("fg"\)/);
  assert.match(String(r.output.hint), /Nothing was written/);
  assert.equal(readPending(resolvePaths(cwd)).length, 0);

  assert.equal(queue(item(), { cwd, author: 'test' }).exitCode, 0);
  assert.equal(readPending(resolvePaths(cwd)).length, 1);

  const direct = record(item({ verdict: 'accept', rejected: ['Source in the date column: too cramped at the w-24 column'] }), { cwd, author: 'test' });
  assert.equal(direct.output.status, 'unclear', 'recording directly is checked too');
  assert.match((direct.output.errors as string[])[0], /^rejected\[0\]/);
});

test("the skill's not-this/this examples agree with the check", () => {
  const skill = fs.readFileSync(path.join(PKG_ROOT, 'templates', 'SKILL.md'), 'utf8').replace(/\r\n/g, '\n');
  const lines = skill.slice(skill.indexOf('| Not this | This |')).split('\n');
  const table = lines.slice(0, lines.findIndex((l) => !l.startsWith('|')));
  const rows = table.slice(2).map((l) => l.split('|').slice(1, 3).map((c) => c.trim().replace(/^(Rejected|Applies to): /, '')));
  assert.ok(rows.length >= 4);
  for (const [bad, good] of rows) {
    assert.ok(codeWords(bad).length || bad.split(/\s+/).length > 25, `the check lets through: ${bad}`);
    assert.deepEqual(codeWords(good), [], good);
    assert.ok(good.split(/\s+/).length <= 20, good);
  }
});
