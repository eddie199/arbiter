/**
 * The missing-picture nudge. The board covers a card without a picture in an icon of its kind,
 * so nothing there says one is missing. record, publish and the review page say it instead, and
 * only for changes a picture of one screen would show.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { queue, record } from '../commands/record';
import { addCandidate, updateCandidate } from '../commands/candidate';
import { review } from '../commands/review';
import { snapshotWork } from '../commands/snapshot';
import { missingPictures, needsPicture } from '../pictures';
import { readArchive, resolvePaths } from '../store';
import type { Decision } from '../schema';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-pic-'));
const o = (cwd: string) => ({ cwd, author: 'test' });
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const decision = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Plan cards sit above the invoice table', rationale: 'r', trigger: 'Billing page', scope: 'file:app/billing/page.tsx', class: 'judgment', dimension: 'structure', verdict: 'accept', ...over });

test('a picture is asked for only when one screen would show the change', () => {
  const on = (dimension: string, over: Partial<Decision> = {}) =>
    needsPicture({ scope: 'file:app/billing/page.tsx', level: 'pattern', verdict: 'accept', dimension, ...over } as Decision);

  // Layout, words, looks: a still of the screen shows them.
  assert.ok(on('structure'));
  assert.ok(on('content'));
  assert.ok(on('visual'));
  assert.ok(on('visual', { scope: 'pattern:plan-card' } as Partial<Decision>), 'a pattern still lives on screens you can point at');

  // Behaviour doesn't show in a still, and a state is only pictured if you were already there.
  assert.ok(!on('interaction'));
  assert.ok(!on('states'));
  assert.ok(!on('motion'));
  assert.ok(!on('access'));

  // No one screen, or no card on the board.
  assert.ok(!on('visual', { scope: 'global' }), 'a font swap has no screen to point at');
  assert.ok(!on('visual', { level: 'polish' }), 'polish never reaches the board');
  assert.ok(!on('structure', { verdict: 'retire' }), 'a retired rule is not a change to a screen');
});

test('record says when the screen it changed has no picture, and stops once it has one', () => {
  const cwd = tmp();
  const first = record(decision(), o(cwd));
  assert.equal(first.exitCode, 0);
  assert.match(String(first.output.picture), /No picture of "Billing page" yet/);
  assert.match(String(first.output.picture), /npx arbiter snapshot "Billing page" --file shot\.png/, 'with the command to fix it');

  fs.writeFileSync(path.join(cwd, 'shot.png'), PNG);
  snapshotWork('Billing page', { cwd, file: 'shot.png' });
  const after = record(decision({ decision: 'Pay now is the primary button', dimension: 'content' }), o(cwd));
  assert.equal(after.output.picture, undefined, 'the card has its picture now');
});

test('record stays quiet for changes that are right as an icon', () => {
  const cwd = tmp();
  for (const over of [
    { dimension: 'motion', decision: 'The drawer slides in at 150ms' },
    { dimension: 'access', decision: 'Tab order follows the reading order' },
    { dimension: 'interaction', decision: 'Cancelling asks in a dialog' },
    { dimension: 'states', decision: 'No invoices shows a short empty state' },
    { dimension: 'visual', scope: 'global', decision: 'Body text is Inter' },
  ]) {
    const r = record(decision(over), o(cwd));
    assert.equal(r.exitCode, 0);
    assert.equal(r.output.picture, undefined, over.decision);
  }
});

test('a queued decision nudges too, and the queue counts toward the card', () => {
  const cwd = tmp();
  const r = queue(decision({ verdict: undefined }), o(cwd));
  assert.equal(r.output.status, 'queued');
  assert.match(String(r.output.picture), /snapshot "Billing page"/);
});

test('a decision on a candidate asks for the candidate\'s picture, unless that direction is gone', () => {
  const cwd = tmp();
  addCandidate('Billing — cards', { ...o(cwd), feature: 'billing' });
  addCandidate('Billing — table', { ...o(cwd), feature: 'billing' });

  const r = record(decision(), { ...o(cwd), candidate: 'C-0001' });
  assert.match(String(r.output.picture), /No picture of "Billing — cards"/);
  assert.match(String(r.output.picture), /npx arbiter candidate C-0001 --snapshot shot\.png/);

  // C-0002 wins; C-0001 is superseded and no longer in the app to photograph.
  updateCandidate('C-0002', { ...o(cwd), state: 'approved', why: 'cards read faster' });
  const gone = record(decision({ decision: 'A later note on the losing direction' }), { ...o(cwd), candidate: 'C-0001' });
  assert.equal(gone.output.picture, undefined);
});

test('one entry per card, however many decisions point at it', () => {
  const cwd = tmp();
  record(decision(), o(cwd));
  record(decision({ decision: 'Pay now is green', dimension: 'visual' }), o(cwd));
  record(decision({ decision: 'Settings rows are full width', trigger: 'Settings page', scope: 'file:app/settings/page.tsx' }), o(cwd));
  const paths = resolvePaths(cwd);
  const missing = missingPictures(paths, readArchive(paths));
  assert.deepEqual(missing.map((m) => m.name), ['Billing page', 'Settings page']);
});

test('the review page marks waiting work that needs a picture', async () => {
  const cwd = tmp();
  queue(decision({ verdict: undefined }), o(cwd));
  queue(decision({ verdict: undefined, trigger: 'Drawer', dimension: 'motion', decision: 'The drawer slides in' }), o(cwd));
  const port = 48000 + Math.floor(Math.random() * 1000);
  const done = review({ cwd, port, open: false });
  await new Promise((r) => setTimeout(r, 200));

  const state = await call(port, 'GET', '/api/state');
  const byTrigger = Object.fromEntries(state.pending.map((d: { trigger: string; picture: unknown }) => [d.trigger, d.picture]));
  assert.match(byTrigger['Billing page'].command, /snapshot "Billing page"/);
  assert.equal(byTrigger.Drawer, null, 'motion is right as an icon');

  await call(port, 'POST', '/api/done', {});
  await done;
});

function call(port: number, method: string, p: string, body?: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'content-type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(d ? JSON.parse(d) : null));
    });
    req.on('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
