import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { record } from '../commands/record';
import { formatEntry, parseEntries } from '../format';
import { Decision } from '../schema';
import { readActive, readArchive, resolvePaths } from '../store';

const rule = (over: Partial<Decision> = {}) =>
  JSON.stringify({
    decision: 'Destructive actions confirm in a modal, never inline',
    rationale: 'Inline confirms get clicked through.',
    trigger: 'Delete flow used an inline link',
    scope: 'pattern:destructive-confirm',
    class: 'judgment',
    dimension: 'interaction',
    verdict: 'rule',
    ...over,
  });

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-'));
const opts = (cwd: string, extra = {}) => ({ cwd, author: 'test', ...extra });

test('format round-trips losslessly', () => {
  const d: Decision = {
    id: 'D-0001', date: '2026-09-15T10:00:00Z', author: 'Edmond Hua', class: 'judgment', dimension: 'interaction',
    rejected: ['Inline confirm — clicked through', 'Toast with undo — too easy to miss · and this has a dot'],
    decision: 'Use · dots · freely in the statement', trigger: 'A "quoted" trigger: with colons',
    change: 'The confirm · link became a modal', level: 'feature',
    verdict: 'rule', scope: 'file:src/a b/c.tsx', rationale: 'Because **bold** and `code` should survive.',
    supersedes: null, ref: 'https://linear.app/acme/issue/ENG-123', commit: null,
    files: ['src/a b/c.tsx', 'src/d.tsx'], paths: ['src/components', 'src/marketing/Hero.tsx'], expect: { present: ['brand.500'], absent: ['#3B7BE0', 'weird · dot'] }, verified: true, candidate: 'C-0002',
  };
  assert.deepEqual(parseEntries(formatEntry(d)), [d]);
  const d2: Decision = { ...d, id: 'D-0002', supersedes: 'D-0001', commit: 'abc1234', rejected: [], dimension: 'states', ref: null, files: [], paths: [], expect: null, verified: null, candidate: null };
  assert.deepEqual(parseEntries(formatEntry(d) + '\n' + formatEntry(d2)), [d, d2]);
});

test('rule goes to both files; accept and fix go to archive only', () => {
  const cwd = tmp();
  assert.equal(record(rule(), opts(cwd)).exitCode, 0);
  assert.equal(record(rule({ verdict: 'accept', scope: 'file:x.tsx' }), opts(cwd)).exitCode, 0);
  assert.equal(record(rule({ verdict: 'fix', scope: 'file:y.tsx' }), opts(cwd)).exitCode, 0);
  const p = resolvePaths(cwd);
  assert.equal(readActive(p).length, 1);
  assert.equal(readArchive(p).length, 3);
  assert.deepEqual(readArchive(p).map((d) => d.id), ['D-0001', 'D-0002', 'D-0003']);
});

test('overlap blocks the write and offers supersedes', () => {
  const cwd = tmp();
  record(rule(), opts(cwd));
  const r = record(rule({ decision: 'Destructive confirms name the thing being deleted' }), opts(cwd));
  assert.equal(r.exitCode, 2);
  const overlaps = r.output.overlaps as { id: string; confidence: string }[];
  assert.deepEqual(overlaps.map((o) => [o.id, o.confidence]), [['D-0001', 'exact']]);
  assert.equal(readArchive(resolvePaths(cwd)).length, 1, 'nothing written');

  const r2 = record(rule({ decision: 'Destructive confirms name the thing being deleted' }), opts(cwd, { supersedes: 'D-0001' }));
  assert.equal(r2.exitCode, 0);
  const active = readActive(resolvePaths(cwd));
  assert.deepEqual(active.map((d) => [d.id, d.supersedes]), [['D-0002', 'D-0001']]);
  assert.equal(readArchive(resolvePaths(cwd)).length, 2, 'old rule stays in archive');
});

test('fuzzy overlap is marked possible; --keep-both bypasses', () => {
  const cwd = tmp();
  record(rule({ decision: 'Interactive elements use brand tokens, never raw hex', scope: 'global' }), opts(cwd));
  const r = record(rule({ decision: 'Text colours come from tokens, not raw hex', scope: 'global' }), opts(cwd));
  assert.equal(r.exitCode, 2);
  assert.equal((r.output.overlaps as { confidence: string }[])[0].confidence, 'possible');
  assert.equal(record(rule({ decision: 'Text colours come from tokens, not raw hex', scope: 'global' }), opts(cwd, { keepBoth: true })).exitCode, 0);
  assert.equal(readActive(resolvePaths(cwd)).length, 2);
});

test('cap refuses the 41st rule', () => {
  const cwd = tmp();
  for (let i = 0; i < 40; i++) {
    assert.equal(record(rule({ decision: `Rule number ${i} about widget${i}`, scope: `pattern:p${i}` }), opts(cwd, { keepBoth: true })).exitCode, 0, `rule ${i}`);
  }
  const r = record(rule({ decision: 'One too many', scope: 'pattern:extra' }), opts(cwd));
  assert.equal(r.exitCode, 3);
  assert.equal(readActive(resolvePaths(cwd)).length, 40);
});

test('invalid input is rejected with field-level errors', () => {
  const r = record('{"decision":"x","verdict":"maybe"}', opts(tmp()));
  assert.equal(r.exitCode, 1);
  assert.ok((r.output.errors as string[]).some((e) => e.includes('verdict')));
  assert.equal(record('not json', opts(tmp())).exitCode, 1);
});

test('DECISIONS.md groups by dimension and still round-trips', () => {
  const cwd = tmp();
  record(rule({ decision: 'Modal for destructive confirms', dimension: 'interaction', scope: 'pattern:destructive-confirm', rejected: ['Inline confirm — clicked through'] }), opts(cwd));
  record(rule({ decision: 'Empty states are one line and one action', dimension: 'states', scope: 'pattern:empty-state' }), opts(cwd));
  record(rule({ decision: 'Page titles are sentence case', dimension: 'content', scope: 'global' }), opts(cwd));
  record(rule({ decision: 'Sheets put primary action bottom-right', dimension: 'interaction', scope: 'pattern:sheet-actions' }), opts(cwd));
  const p = resolvePaths(cwd);
  const md = fs.readFileSync(p.decisions, 'utf8');
  const headings = md.split('\n').filter((l) => /^## /.test(l));
  assert.deepEqual(headings, ['## Interaction', '## States', '## Content']);
  const active = readActive(p);
  assert.deepEqual(active.map((d) => d.id), ['D-0001', 'D-0004', 'D-0002', 'D-0003']);
  assert.deepEqual(active[0].rejected, ['Inline confirm — clicked through']);
  assert.deepEqual(readArchive(p).map((d) => d.id), ['D-0001', 'D-0002', 'D-0003', 'D-0004']);
});
