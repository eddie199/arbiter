/**
 * The people judging are PMs and designers. They read a decision in the review, on the board and
 * in DECISIONS.md, never next to the code, so a line written in code words gets misread or
 * skipped. `record` refuses one, and the agent says it again in plain words before anyone sees it.
 *
 * Only what is surely code is caught: a file name, a class name, a name stuck together like
 * onClick or ArrowUpRight, backticks. A product name (Next.js, iPhone, GitHub) or a size a
 * designer would say (16px) passes. Two-part names like TagPill do too, since they can't be told
 * apart from brands like FigJam; the skill's examples cover those.
 */

import type { DecisionInput } from './schema';

/** Words in one line. The skill asks for 20 or fewer; this is where it stops being one thing. */
export const MAX_WORDS = 25;

const SIZE = String.raw`(?:\d+(?:\.\d+)?|px|xs|sm|base|md|lg|xl|[2-9]xl|full|screen|auto|none)`;
const UTILITY = String.raw`(?:text|bg|border|rounded|shadow|font|leading|tracking|gap|space|ring|opacity|grid-cols|col-span|row-span|basis|w|h|size|min-w|max-w|min-h|max-h|p|px|py|pt|pb|pl|pr|m|mx|my|mt|mb|ml|mr|z|inset)`;

const CODE: RegExp[] = [
  /`[^`]*`?/g,
  // A path, a source file, or a lowercase .js/.md file (Next.js is a product; next.config.js is a file).
  /\b[\w.-]*\/[\w./-]*\.[a-z]{2,5}\b|\b[\w-]+\.(?:tsx|jsx|ts|css|scss|vue|svelte|json|html|py|rb|swift|kt)\b|\b[a-z][\w-]*\.(?:js|mjs|md)\b/g,
  // onClick, useState: lowercase then humps. iPhone and macOS aren't.
  /\b[a-z]{2,}(?:[A-Z][a-z0-9]+)+\b/g,
  // ArrowUpRight: three humps or more.
  /\b[A-Z][a-z]+(?:[A-Z][a-z]+){2,}\b/g,
  // Utility classes with a size or a shade: text-xs, w-24, gap-x-2, md:grid-cols-3, bg-ink-500.
  new RegExp(String.raw`\b(?:(?:sm|md|lg|xl|2xl):)?${UTILITY}(?:-[xy])?-(?:${SIZE}|[a-z]+-\d{2,3})\b|\b(?:sm|md|lg|xl|2xl):[a-z][\w-]*|\bfont-(?:light|normal|medium|semibold|bold|sans|serif|mono)\b`, 'g'),
  /\baria-[a-z]+/g,
  /<\/?[a-z][a-z0-9-]*[\s/>]|=>|[{}]|\b\w+\(\)/g,
  /\b(?:fg|bg|div|props|href|z-index|boolean|enum|regex)\b|\b\d+(?:\.\d+)?fr\b/g,
];

/** What reads like code in a line, as written, at most three. */
export function codeWords(text: string): string[] {
  const found = new Set<string>();
  for (const re of CODE) for (const m of text.matchAll(re)) found.add(m[0].trim());
  return [...found].filter(Boolean).slice(0, 3);
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/**
 * Problems with the lines a person reads: Change, Pattern and each Rejected. A mechanical rule's
 * `decision` may name a token, since that's what its check looks for; its `change` still can't.
 */
export function unclearLines(input: DecisionInput): string[] {
  const lines: [string, string][] = [
    ...(input.change ? [['change', input.change] as [string, string]] : []),
    ['decision', input.decision],
    ...(input.rejected ?? []).map((r, i) => [`rejected[${i}]`, r] as [string, string]),
  ];
  const problems: string[] = [];
  for (const [field, text] of lines) {
    const n = words(text);
    if (n > MAX_WORDS) problems.push(`${field} is ${n} words, over ${MAX_WORDS}: say one thing, what a person sees or does`);
    if (field === 'decision' && input.class === 'mechanical') continue;
    const code = codeWords(text);
    if (code.length) problems.push(`${field} reads like code (${code.map((c) => `"${c}"`).join(', ')}): say it the way it looks on screen`);
  }
  return problems;
}
