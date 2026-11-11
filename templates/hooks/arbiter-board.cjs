// Written by Arbiter (npx arbiter init). Claude Code runs it before each message you send
// (.claude/settings.json, UserPromptSubmit). When you've judged something on the local board that
// needs the code changed, or changed a design rule there, it tells the agent, once, so it acts on it
// now rather than at the next /arbiter. The rest of the time it says nothing.
'use strict';
const fs = require('fs');
const path = require('path');

let root = process.env.CLAUDE_PROJECT_DIR;
if (!root) {
  try { root = JSON.parse(fs.readFileSync(0, 'utf8')).cwd; } catch { /* no input: the current folder */ }
}
const file = path.join(root || process.cwd(), '.arbiter', 'last-review.json');

let h;
try { h = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { process.exit(0); }
const todo = Array.isArray(h.todo) ? h.todo : [];
const rules = Array.isArray(h.rules) ? h.rules : [];
const reworded = Array.isArray(h.reworded) ? h.reworded : [];
const removed = Array.isArray(h.removed) ? h.removed : [];
const renamed = Array.isArray(h.renamed) ? h.renamed : [];
// Told already, and nothing new since: the board rewrites the file without `told` on every answer.
if (h.told || (!todo.length && !rules.length && !reworded.length && !removed.length && !renamed.length)) process.exit(0);

const line = (t) =>
  t.kind === 'fix' ? `- ${t.id}: they corrected it. The code still does "${t.change}"; make it do "${t.to}".`
  : t.kind === 'follow' ? `- ${t.id}: they chose the rule ${t.rule}. Change the code back so it does "${t.to}".`
  : `- ${t.id}: an approved request from ${t.author}${t.screen ? ` on ${t.screen}` : ''}: ${t.do}. Make it, then record it with --request ${t.id}.`;

const said = ['Arbiter: since your last turn, the user judged decisions on the local board.'];
if (todo.length) {
  said.push(`${todo.length === 1 ? 'One change waits' : `${todo.length} changes wait`} for you. Before you answer their message, make ${todo.length === 1 ? 'it' : 'them'} as the arbiter skill's "Reviewing in the browser" says. ${todo.length === 1 ? "It's" : "They're"} recorded already, so don't judge or record ${todo.length === 1 ? 'it' : 'them'} again.`);
  said.push(...todo.map(line));
}
if (rules.length) said.push(`New rules in DECISIONS.md, in force from now: ${rules.join(', ')}. Read them before your next UI change.`);
if (reworded.length) said.push('Rules they edited in DECISIONS.md. Follow them as they read now, not as you last read them:', ...reworded.map((r) => `- ${r.id} now says "${r.to}"`));
if (renamed.length) said.push('Work they renamed on the board. Use the new name as the trigger from now on:', ...renamed.map((r) => `- "${r.from}" is now "${r.to}"`));
if (removed.length) said.push('Rules they removed from DECISIONS.md. Stop following them; the code needs no change unless they ask:', ...removed.map((r) => `- ${r.id} ("${r.rule}"): ${r.why}`));
said.push(todo.length
  ? 'Then delete .arbiter/last-review.json, say in one line what you changed, and answer their message.'
  : 'Then delete .arbiter/last-review.json and answer their message.');

h.told = true;
try { fs.writeFileSync(file, JSON.stringify(h, null, 2) + '\n'); } catch { /* it says it again next time */ }
process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'UserPromptSubmit', additionalContext: said.join('\n') } }));
