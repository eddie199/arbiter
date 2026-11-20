/**
 * Rename on a change's page: the agent hears the new name through the handoff, so its next decisions
 * use it as the trigger instead of starting a second card under the old one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decidedAnything, handoffLine, mergeHandoffs, summarize } from '../handoff';

test('a rename is handed to the agent, with what to do about it', () => {
  const h = summarize([{ kind: 'rename', from: 'To review', to: 'Review inbox — Sorting' }], 'closed');
  assert.deepEqual(h.renamed, [{ from: 'To review', to: 'Review inbox — Sorting' }]);
  assert.ok(decidedAnything(h));
  assert.match(h.next, /use each new name as the trigger/);
  assert.match(String(handoffLine(h)), /1 renamed/);
});

test('renamed twice is one rename; renamed back is none', () => {
  const first = summarize([{ kind: 'rename', from: 'A', to: 'B' }], 'closed');
  const twice = mergeHandoffs(first, summarize([{ kind: 'rename', from: 'B', to: 'C' }], 'closed'));
  assert.deepEqual(twice.renamed, [{ from: 'A', to: 'C' }]);
  const back = mergeHandoffs(first, summarize([{ kind: 'rename', from: 'B', to: 'A' }], 'closed'));
  assert.deepEqual(back.renamed, []);
  assert.equal(decidedAnything(back), false, 'nothing left to tell the agent');
});
