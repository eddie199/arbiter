/**
 * Folders in the local board's side nav: made, named and filled on the board, saved beside the record
 * so the project carries them, and shown read-only in an exported copy.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { queue } from '../commands/record';
import { review } from '../commands/review';
import { exportBoard } from '../commands/export';
import { resolvePaths } from '../store';
import { areasPath, cleanArrangement, readArrangement, writeArrangement } from '../areas';
import { readHandoff } from '../handoff';
import { areasCommand, structureOf } from '../commands/areas';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'arbiter-areas-'));
const port = () => 44900 + Math.floor(Math.random() * 900); // below 49152, where Windows hands out its own ports
const wait = (ms = 200) => new Promise((r) => setTimeout(r, ms));
const input = (over: Record<string, unknown> = {}) =>
  JSON.stringify({ decision: 'Save sits bottom-right', change: 'Save moved to the bottom right', rationale: 'r', trigger: 'Settings build', scope: 'pattern:save', dimension: 'structure', class: 'judgment', ...over });

test('a folder is tidied as it is saved: names trimmed, an area in one folder only, the order kept to what exists', () => {
  const r = cleanArrangement({
    folders: [
      { id: 'a1', name: '  Local   board ', areas: ['Share board', 'Board guide', 'share board'] },
      { id: 'b2', name: 'Check-ins', areas: ['Board guide', 'Review nudge'] },
    ],
    order: ['folder:b2', 'Share board', 'folder:zz', 'Foundations', 'foundations', 'folder:a1'],
  });
  assert.ok(r.ok);
  assert.deepEqual(r.value.folders, [
    { id: 'a1', name: 'Local board', areas: ['Share board', 'Board guide'] },
    { id: 'b2', name: 'Check-ins', areas: ['Review nudge'] },
  ], 'Board guide stays in the first folder that has it');
  assert.deepEqual(r.value.order, ['folder:b2', 'Foundations', 'folder:a1'], 'no area that sits in a folder, no folder that is not there, nothing twice');
});

test('a folder with no name, a name taken, or an id that is not letters and digits is refused', () => {
  for (const [folders, why] of [
    [[{ id: 'a1', name: '  ', areas: [] }], /needs a name/],
    [[{ id: 'a1', name: 'One', areas: [] }, { id: 'b2', name: 'one', areas: [] }], /already a folder called/],
    [[{ id: '../x', name: 'One', areas: [] }], /letters and digits/],
    [[{ id: 'a1', name: 'x'.repeat(61), areas: [] }], /60 characters/],
  ] as const) {
    const r = cleanArrangement({ folders, order: [] });
    assert.equal(r.ok, false);
    assert.match((r as { errors: string[] }).errors.join(' '), why);
  }
  assert.equal(cleanArrangement({ order: [] }).ok, false, 'folders must be there');
});

test('saved beside the record and read back; with nothing left the file goes; a broken file is no folders', () => {
  const paths = resolvePaths(tmp());
  assert.equal(readArrangement(paths), null);
  writeArrangement(paths, { folders: [{ id: 'a1', name: 'Settings', areas: ['Billing'] }], order: ['folder:a1'] });
  assert.ok(fs.existsSync(path.join(paths.root, '.arbiter', 'areas.json')));
  assert.deepEqual(readArrangement(paths)?.folders[0].areas, ['Billing']);
  writeArrangement(paths, { folders: [], order: [] });
  assert.equal(fs.existsSync(areasPath(paths)), false);
  fs.writeFileSync(areasPath(paths), '{ not json');
  assert.equal(readArrangement(paths), null);
});

test('the board saves folders, every tab redraws, and the agent is not told', async () => {
  const cwd = tmp();
  const paths = resolvePaths(cwd);
  queue(input(), { cwd, author: 'test' });
  const p = port();
  const done = review({ cwd, port: p, open: false, grace: 0 });
  await wait();
  assert.equal((await get(p, '/api/board')).arrangement, null, 'no folders yet');
  const before = (await get(p, '/api/stamp?page=a')).stamp;
  await wait(20);

  const saved = await post(p, '/api/areas', { folders: [{ id: 'a1', name: 'Settings', areas: ['Settings build'] }], order: ['folder:a1'] });
  assert.equal(saved.exitCode, 0);
  assert.deepEqual((await get(p, '/api/board')).arrangement.folders[0], { id: 'a1', name: 'Settings', areas: ['Settings build'] });
  assert.notEqual((await get(p, '/api/stamp?page=a')).stamp, before, 'open tabs pick it up');
  assert.equal(readHandoff(paths), null, 'arranging the board is nothing for the agent to do');

  const refused = await post(p, '/api/areas', { folders: [{ id: 'a1', name: '', areas: [] }], order: [] });
  assert.equal(refused.exitCode, 1);
  assert.equal(readArrangement(paths)?.folders[0].name, 'Settings', 'a refused save leaves the folders as they were');

  await post(p, '/api/bye', { page: 'a' });
  await done;
});

test('an exported copy carries the folders, to show, not to change', () => {
  const cwd = tmp();
  queue(input(), { cwd, author: 'test' });
  const paths = resolvePaths(cwd);
  writeArrangement(paths,{ folders: [{ id: 'a1', name: 'Settings', areas: ['Settings build'] }], order: ['folder:a1'] });
  const out = path.join(cwd, 'copy');
  exportBoard({ cwd, out });
  const html = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  assert.match(html, /"arrangement":\{"folders":\[\{"id":"a1","name":"Settings","areas":\["Settings build"\]\}\]/);
  assert.match(html, /"live":false/);
});

test('arbiter areas groups changes by the first part of their names, and saves the folders the person agreed to', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  queue(input({ trigger: 'Settings — billing' }), o);
  queue(input({ trigger: 'Settings — profile', decision: 'Profile has tabs', change: 'Profile has tabs', scope: 'pattern:tabs' }), o);
  queue(input({ trigger: 'Reports', decision: 'Reports has filters', change: 'Reports has filters', scope: 'pattern:filters' }), o);
  const paths = resolvePaths(cwd);
  assert.deepEqual(structureOf(paths).loose.map((a) => [a.name, a.changes.length]), [['Settings', 2], ['Reports', 1]]);

  const saved = areasCommand({ cwd, save: JSON.stringify({ folders: [{ name: 'Product', areas: ['settings'] }] }) });
  assert.equal(saved.exitCode, 0);
  const after = structureOf(paths);
  assert.deepEqual(after.folders.map((f) => [f.name, f.areas.map((a) => a.name)]), [['Product', ['Settings']]], 'matched whatever the case');
  assert.deepEqual(after.loose.map((a) => a.name), ['Reports'], 'an area left out stays where it was');
  assert.match(String(saved.text), /^Product\n {2}Settings · 2\n {4}Settings — billing/m);

  const typo = areasCommand({ cwd, save: JSON.stringify({ folders: [{ name: 'Product', areas: ['Setings'] }] }) });
  assert.equal(typo.exitCode, 1);
  assert.match((typo.output.errors as string[]).join(' '), /not an area on the board: Setings/);
  assert.equal(structureOf(paths).folders[0].areas[0].name, 'Settings', 'a refused save changes nothing');

  const next = queue(input({ trigger: 'Settings — team', decision: 'Team list is a table', change: 'The team list is now a table', scope: 'pattern:team' }), o);
  assert.equal(next.output.area, 'Settings');
  assert.equal(next.output.folder, 'Product', 'the reply says which folder it landed in');
});

test('the reply to record says where the work landed, and when new work starts an area of its own', () => {
  const cwd = tmp();
  const o = { cwd, author: 'test' };
  const first = queue(input({ trigger: 'Settings — billing' }), o);
  assert.equal(first.output.area, 'Settings');
  assert.equal(first.output.newArea, undefined, 'the first area on a board is nothing to tidy');

  const loose = queue(input({ trigger: 'Billing tweaks', decision: 'Plans sit in a table', change: 'Plans now sit in a table', scope: 'pattern:plans' }), o);
  assert.equal(loose.output.area, 'Billing tweaks');
  assert.equal(loose.output.newArea, true);
  assert.deepEqual(loose.output.areas, ['Settings']);
  assert.match(String(loose.output.hint), /npx arbiter rename "Billing tweaks" "<Area> — <what changed>"/);

  const again = queue(input({ trigger: 'Billing tweaks', decision: 'Plan names are bold', change: 'Plan names are now bold', scope: 'pattern:plan-names' }), o);
  assert.equal(again.output.newArea, undefined, 'only the first decision of new work says so');

  const joined = queue(input({ trigger: 'Settings — profile', decision: 'Profile has tabs', change: 'Profile has tabs', scope: 'pattern:tabs' }), o);
  assert.equal(joined.output.area, 'Settings');
  assert.equal(joined.output.newArea, undefined, 'work named into an area that is there');
});

function get(p: number, route: string): Promise<any> {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: p, path: route }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    }).on('error', reject);
  });
}
function post(p: number, route: string, body: unknown): Promise<any> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: p, path: route, method: 'POST', headers: { 'content-type': 'application/json' } }, (res) => {
      let d = '';
      res.on('data', (c) => (d += c));
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.end(JSON.stringify(body));
  });
}
