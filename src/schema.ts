/**
 * The decision record. Mirrors the PRD schema, plus `decision` — the one-line
 * statement of what was decided. The PRD has `trigger` (what prompted it) and
 * `rationale` (why), but the statement the agent actually needs to read had
 * nowhere to live.
 */

export const CLASSES = ['mechanical', 'judgment'] as const;
/**
 * How big a call this was. Drives what the review shows:
 *   feature  a new surface, flow or structure — always surfaced
 *   pattern  a reusable call that could apply elsewhere — surfaced, "make it a rule" is the likely answer
 *   polish   a one-off fix to one screen — collapsed to one line, confirmed in bulk
 */
export const LEVELS = ['feature', 'pattern', 'polish'] as const;
export const VERDICTS = ['fix', 'accept', 'rule', 'retire'] as const;
export const SCOPE_KINDS = ['global', 'file', 'pattern'] as const;
/** What the decision is about. Fixed order — DECISIONS.md groups by it in this order. */
export const DIMENSIONS = ['structure', 'interaction', 'states', 'content', 'visual', 'motion', 'access'] as const;

export type DecisionClass = (typeof CLASSES)[number];
export type Level = (typeof LEVELS)[number];
export type Verdict = (typeof VERDICTS)[number];
/** A queued decision awaiting judgment lives in .arbiter/pending.md with this verdict and a P- id. */
export type StoredVerdict = Verdict | 'pending';
export type Dimension = (typeof DIMENSIONS)[number];

/** Literal strings that must appear in / be absent from `files`. Checkable, so only meaningful for mechanical decisions. */
export interface Evidence {
  present?: string[];
  absent?: string[];
}

export interface Decision {
  /** D-0001, D-0002, … — sequential across the archive. P-0001… while pending. */
  id: string;
  /** ISO 8601 timestamp. */
  date: string;
  /** Who decided. */
  author: string;
  class: DecisionClass;
  /** Which design concern this is about. */
  dimension: Dimension;
  /** The statement, as a rule someone could follow. One line. This is what the agent reads. */
  decision: string;
  /** What actually changed, in plain words — what a PM would say happened. One line. This is what the person judging reads. */
  change: string | null;
  level: Level;
  /** Alternatives tried or considered and dropped: "<option> — <why it lost>". One line each. */
  rejected: string[];
  /** What prompted the call. One line. */
  trigger: string;
  verdict: StoredVerdict;
  /** `global`, `file:<path>`, or `pattern:<name>`. */
  scope: string;
  /** Why. One line, required. */
  rationale: string;
  /** Id of the rule this replaces, or null. Only meaningful when verdict is `rule`. */
  supersedes: string | null;
  /** The ticket this was for: a URL or an issue key like ENG-123. Null when none was mentioned. */
  ref: string | null;
  /** Short git SHA at time of decision, or null outside a repo. */
  commit: string | null;
  /** Files the agent touched — evidence for verification. Relative to the project root. */
  files: string[];
  /** Where the rule applies: directories or files. Sweep scans these. Empty = the scope decides (file: scope → that path; otherwise the whole project). */
  paths: string[];
  /** What those files should contain / not contain. */
  expect: Evidence | null;
  /** Result of the last check against `files`. null = never checked or not checkable. */
  verified: boolean | null;
  /** Candidate this decision was made for (C-0001), if any. */
  candidate: string | null;
}

/** What the caller supplies. Everything else is filled in by `record`. */
export type DecisionInput = Pick<
  Decision,
  'class' | 'dimension' | 'decision' | 'trigger' | 'verdict' | 'scope' | 'rationale'
> &
  Partial<Pick<Decision, 'rejected' | 'author' | 'supersedes' | 'ref' | 'commit' | 'date' | 'files' | 'paths' | 'expect' | 'candidate' | 'change' | 'level'>>;

/** Fields in file order. Also the order they're serialized in. */
export const FIELDS: (keyof Decision)[] = [
  'id',
  'decision',
  'change',
  'level',
  'rationale',
  'rejected',
  'trigger',
  'scope',
  'dimension',
  'class',
  'verdict',
  'author',
  'date',
  'commit',
  'supersedes',
  'ref',
  'files',
  'paths',
  'expect',
  'verified',
  'candidate',
];

export const ID_PATTERN = /^[DP]-\d{4,}$/;
export const DECISION_ID = /^D-\d{4,}$/;
export const PENDING_ID = /^P-\d{4,}$/;
export const CANDIDATE_ID = /^C-\d{4,}$/;
const SCOPE_PATTERN = /^(global|file:\S.*|pattern:[A-Za-z0-9][A-Za-z0-9._\/-]*)$/;
const SHORT_SHA = /^[0-9a-f]{7,40}$/;

export type Validation<T> =
  | { ok: true; value: T }
  | { ok: false; errors: string[] };

/**
 * Validate an untrusted object as a DecisionInput. Strict on shape, lenient on
 * whitespace: string fields are trimmed and must be single-line.
 */
export interface ValidateOptions {
  /** Queueing for later judgment: `verdict` is not required (it becomes `pending`). */
  pending?: boolean;
}

export function validateInput(raw: unknown, options: ValidateOptions = {}): Validation<DecisionInput> {
  const errors: string[] = [];
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, errors: ['decision must be a JSON object'] };
  }
  const obj = raw as Record<string, unknown>;

  const line = (key: string, required: boolean): string | undefined => {
    const v = obj[key];
    if (v === undefined || v === null || v === '') {
      if (required) errors.push(`${key} is required`);
      return undefined;
    }
    if (typeof v !== 'string') {
      errors.push(`${key} must be a string`);
      return undefined;
    }
    const s = v.trim();
    if (s.includes('\n')) errors.push(`${key} must be a single line`);
    return s;
  };

  const decision = line('decision', true);
  const trigger = line('trigger', true);
  const rationale = line('rationale', true);
  const scope = line('scope', true);
  const cls = line('class', true);
  const dimension = line('dimension', true);
  const verdict = line('verdict', !options.pending);
  const change = line('change', false);
  const level = line('level', false);
  const author = line('author', false);
  const commit = line('commit', false);
  const date = line('date', false);
  const ref = line('ref', false);
  const supersedesRaw = obj.supersedes;

  if (cls !== undefined && !(CLASSES as readonly string[]).includes(cls)) {
    errors.push(`class must be one of ${CLASSES.join(' | ')}`);
  }
  if (dimension !== undefined && !(DIMENSIONS as readonly string[]).includes(dimension)) {
    errors.push(`dimension must be one of ${DIMENSIONS.join(' | ')}`);
  }
  if (verdict !== undefined && !(VERDICTS as readonly string[]).includes(verdict)) {
    errors.push(`verdict must be one of ${VERDICTS.join(' | ')}`);
  }
  if (level !== undefined && !(LEVELS as readonly string[]).includes(level)) {
    errors.push(`level must be one of ${LEVELS.join(' | ')}`);
  }
  if (scope !== undefined && !SCOPE_PATTERN.test(scope)) {
    errors.push('scope must be `global`, `file:<path>`, or `pattern:<name>`');
  }
  if (commit !== undefined && !SHORT_SHA.test(commit)) {
    errors.push('commit must be a git SHA (7–40 hex characters)');
  }
  if (date !== undefined && Number.isNaN(Date.parse(date))) {
    errors.push('date must be ISO 8601');
  }

  let rejected: string[] | undefined;
  if (obj.rejected !== undefined && obj.rejected !== null) {
    if (!Array.isArray(obj.rejected) || obj.rejected.some((r) => typeof r !== 'string')) {
      errors.push('rejected must be an array of strings');
    } else {
      rejected = (obj.rejected as string[]).map((r) => r.trim()).filter(Boolean);
      if (rejected.some((r) => r.includes('\n'))) errors.push('each rejected item must be a single line');
    }
  }

  let files: string[] | undefined;
  if (obj.files !== undefined && obj.files !== null) {
    if (!Array.isArray(obj.files) || obj.files.some((f) => typeof f !== 'string')) {
      errors.push('files must be an array of paths');
    } else {
      files = (obj.files as string[]).map((f) => f.trim()).filter(Boolean);
      if (files.some((f) => /[\n·]/.test(f))) errors.push('file paths must be single-line and not contain ·');
    }
  }

  let paths: string[] | undefined;
  if (obj.paths !== undefined && obj.paths !== null) {
    if (!Array.isArray(obj.paths) || obj.paths.some((f) => typeof f !== 'string')) {
      errors.push('paths must be an array of files or directories');
    } else {
      paths = (obj.paths as string[]).map((f) => f.trim()).filter(Boolean);
      if (paths.some((f) => /[\n·]/.test(f))) errors.push('paths must be single-line and not contain ·');
    }
  }

  let expect: Evidence | null | undefined;
  if (obj.expect !== undefined) {
    const e = obj.expect;
    if (e === null) expect = null;
    else if (typeof e !== 'object' || Array.isArray(e)) errors.push('expect must be an object with present and/or absent arrays');
    else {
      const eo = e as Record<string, unknown>;
      const list = (k: string): string[] | undefined => {
        if (eo[k] === undefined) return undefined;
        if (!Array.isArray(eo[k]) || (eo[k] as unknown[]).some((x) => typeof x !== 'string' || !x || /\n/.test(x))) {
          errors.push(`expect.${k} must be an array of non-empty single-line strings`);
          return undefined;
        }
        return eo[k] as string[];
      };
      const present = list('present');
      const absent = list('absent');
      for (const k of Object.keys(eo)) if (k !== 'present' && k !== 'absent') errors.push(`unknown expect field: ${k}`);
      expect = { ...(present && { present }), ...(absent && { absent }) };
      if (!present?.length && !absent?.length) expect = null;
    }
  }

  let candidate: string | null | undefined;
  if (obj.candidate !== undefined) {
    if (obj.candidate === null || obj.candidate === '') candidate = null;
    else if (typeof obj.candidate !== 'string' || !CANDIDATE_ID.test(obj.candidate.trim())) errors.push('candidate must be an id like C-0001, or null');
    else candidate = obj.candidate.trim();
  }

  let supersedes: string | null | undefined;
  if (supersedesRaw === undefined || supersedesRaw === null || supersedesRaw === '') {
    supersedes = supersedesRaw === undefined ? undefined : null;
  } else if (typeof supersedesRaw !== 'string' || !DECISION_ID.test(supersedesRaw.trim())) {
    errors.push('supersedes must be a decision id like D-0003, or null');
  } else {
    supersedes = supersedesRaw.trim();
  }
  if (supersedes && verdict !== undefined && verdict !== 'rule' && verdict !== 'retire') {
    errors.push('supersedes only applies when verdict is `rule` or `retire`');
  }
  if (verdict === 'retire' && !supersedes) errors.push('retire needs supersedes: the rule being retired');

  for (const key of Object.keys(obj)) {
    if (!(FIELDS as string[]).includes(key) || key === 'verified' || key === 'id') errors.push(`unknown field: ${key}`);
  }

  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      decision: decision!,
      trigger: trigger!,
      rationale: rationale!,
      scope: scope!,
      class: cls as DecisionClass,
      dimension: dimension as Dimension,
      verdict: verdict as Verdict,
      ...(change !== undefined && { change }),
      ...(level !== undefined && { level: level as Level }),
      ...(rejected !== undefined && { rejected }),
      ...(files !== undefined && { files }),
      ...(paths !== undefined && { paths }),
      ...(expect !== undefined && { expect }),
      ...(candidate !== undefined && { candidate }),
      ...(author !== undefined && { author }),
      ...(commit !== undefined && { commit }),
      ...(date !== undefined && { date }),
      ...(supersedes !== undefined && { supersedes }),
      ...(ref !== undefined && { ref }),
    },
  };
}

/** Split a scope into kind + target. `global` has no target. */
export function parseScope(scope: string): { kind: (typeof SCOPE_KINDS)[number]; target: string | null } {
  if (scope === 'global') return { kind: 'global', target: null };
  const i = scope.indexOf(':');
  return { kind: scope.slice(0, i) as 'file' | 'pattern', target: scope.slice(i + 1) };
}
