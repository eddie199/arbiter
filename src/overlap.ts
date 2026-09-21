/**
 * Scope-overlap detection for new rules against the active set.
 *
 * Two confidence levels, per the PRD's "confidence markers" principle:
 *   exact    — same scope, or one file scope contains the other. Safe to act on.
 *   possible — different scope but the wording shares enough significant words
 *              that a human should look. A guess, marked as one.
 */

import { Decision, DecisionInput, parseScope } from './schema';

export type Confidence = 'exact' | 'possible';

export interface Overlap {
  id: string;
  decision: string;
  scope: string;
  confidence: Confidence;
  reason: string;
}

const STOPWORDS = new Set(
  (
    'a an the and or not never always no yes of in on at to for with by from as is are be use uses using than rather instead only its it this that these those all any one ' +
    // Generic UI nouns: shared by half of all decisions, so they say nothing about overlap.
    'button buttons page pages card cards link links icon icons text label labels row rows list lists screen screens view views item items section sections header footer form forms field fields input inputs show shows open opens click clicks user users add new first run action actions'
  ).split(' '),
);
const MIN_SHARED_WORDS = 3;

export interface OverlapOptions {
  /** Project-specific common words to ignore in the wording check (arbiter.json → overlap.ignore). */
  ignore?: string[];
}

export function findOverlaps(candidate: DecisionInput, active: Decision[], opts: OverlapOptions = {}): Overlap[] {
  const out: Overlap[] = [];
  const cScope = parseScope(candidate.scope);
  const ignore = new Set((opts.ignore ?? []).map((w) => stem(w.toLowerCase())));
  const cWords = significantWords(candidate, ignore);

  for (const rule of active) {
    if (rule.verdict !== 'rule') continue;
    const rScope = parseScope(rule.scope);

    if (rule.scope === candidate.scope && cScope.kind !== 'global') {
      out.push(mark(rule, 'exact', `same scope ${rule.scope}`));
      continue;
    }
    if (cScope.kind === 'file' && rScope.kind === 'file' && fileContains(cScope.target!, rScope.target!)) {
      out.push(mark(rule, 'exact', `file scope ${narrower(cScope.target!, rScope.target!)} is inside ${wider(cScope.target!, rScope.target!)}`));
      continue;
    }

    // Wording alone is a guess; only guess within the same dimension.
    if (rule.dimension !== candidate.dimension) continue;
    const shared = [...cWords].filter((w) => significantWords(rule, ignore).has(w));
    if (shared.length >= MIN_SHARED_WORDS) {
      out.push(mark(rule, 'possible', `same dimension, wording shares: ${shared.join(', ')}`));
    }
  }

  // Exact matches first, then possible.
  return out.sort((a, b) => (a.confidence === b.confidence ? 0 : a.confidence === 'exact' ? -1 : 1));
}

function mark(rule: Decision, confidence: Confidence, reason: string): Overlap {
  return { id: rule.id, decision: rule.decision, scope: rule.scope, confidence, reason };
}

/** Words from the decision statement and the scope target, minus stopwords and short tokens. */
function significantWords(d: Pick<Decision, 'decision' | 'scope'>, ignore: Set<string> = new Set()): Set<string> {
  const target = parseScope(d.scope).target ?? '';
  const text = `${d.decision} ${target.replace(/[\/._-]+/g, ' ')}`;
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .map(stem)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w) && !ignore.has(w));
  return new Set(words);
}

/** Crude suffix stripping so "modals" ~ "modal", "confirms" ~ "confirm". */
function stem(w: string): string {
  return w.replace(/(ing|ed|es|s)$/, '');
}

function fileContains(a: string, b: string): boolean {
  const na = norm(a);
  const nb = norm(b);
  return na === nb || na.startsWith(nb + '/') || nb.startsWith(na + '/');
}
const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const narrower = (a: string, b: string) => (norm(a).length >= norm(b).length ? a : b);
const wider = (a: string, b: string) => (norm(a).length >= norm(b).length ? b : a);
