/**
 * docs/design/103: the checks a query written by the AI model must pass before EduPro runs it. The database refuses
 * anything outside the nlq views too (app.nlq_run as edupro_nlq); these checks stop the rest early and say why:
 * one statement, SELECT or WITH only, no write or control words, no schema but nlq, only plain functions.
 */

export type SqlCheck = { ok: true; sql: string } | { ok: false; problem: string };

/** Functions a data question may use: aggregates, window functions, numbers, text and dates. Nothing else. */
const FUNCTIONS = new Set(
  [
    // aggregates
    'count',
    'sum',
    'avg',
    'min',
    'max',
    'string_agg',
    'array_agg',
    'bool_and',
    'bool_or',
    'every',
    'stddev',
    'stddev_pop',
    'stddev_samp',
    'variance',
    'var_pop',
    'var_samp',
    'percentile_cont',
    'percentile_disc',
    'mode',
    'corr',
    // window
    'rank',
    'dense_rank',
    'row_number',
    'ntile',
    'lag',
    'lead',
    'first_value',
    'last_value',
    'nth_value',
    'percent_rank',
    'cume_dist',
    // numbers
    'round',
    'trunc',
    'floor',
    'ceil',
    'ceiling',
    'abs',
    'sign',
    'mod',
    'power',
    'sqrt',
    'exp',
    'ln',
    'log',
    'width_bucket',
    'greatest',
    'least',
    'coalesce',
    'nullif',
    'num_nonnulls',
    'num_nulls',
    // text
    'lower',
    'upper',
    'initcap',
    'trim',
    'btrim',
    'ltrim',
    'rtrim',
    'length',
    'char_length',
    'substring',
    'substr',
    'left',
    'right',
    'replace',
    'concat',
    'concat_ws',
    'split_part',
    'position',
    'strpos',
    'starts_with',
    'lpad',
    'rpad',
    'to_char',
    'to_number',
    'format',
    // dates
    'date_trunc',
    'date_part',
    'extract',
    'age',
    'make_date',
    'make_interval',
    'now',
    'to_date',
    'to_timestamp',
    'date',
    'justify_days',
    'isfinite',
    'generate_series',
    // conversions
    'cast',
  ].map((f) => f.toLowerCase()),
);

/** SQL words that may stand before "(" without being a function call. */
const NOT_CALLS = new Set([
  'select',
  'from',
  'where',
  'and',
  'or',
  'not',
  'in',
  'exists',
  'any',
  'all',
  'some',
  'on',
  'using',
  'as',
  'when',
  'then',
  'else',
  'case',
  'end',
  'over',
  'filter',
  'within',
  'group',
  'by',
  'values',
  'lateral',
  'join',
  'between',
  'like',
  'ilike',
  'is',
  'distinct',
  'union',
  'intersect',
  'except',
  'with',
  'recursive',
  'row',
  'array',
  'partition',
  'order',
  'having',
  'limit',
  'offset',
  'materialized',
  'interval',
  'nulls',
  'asc',
  'desc',
  'cross',
  'inner',
  'left',
  'right',
  'full',
  'outer',
  'natural',
  'similar',
  'escape',
  'rows',
  'range',
  'preceding',
  'following',
  'unbounded',
  'current',
  'only',
  'tablesample',
]);

/** Words that would write, lock, run other statements or change settings. */
const FORBIDDEN = new Set([
  'insert',
  'update',
  'delete',
  'merge',
  'truncate',
  'drop',
  'alter',
  'create',
  'grant',
  'revoke',
  'copy',
  'call',
  'do',
  'execute',
  'prepare',
  'deallocate',
  'listen',
  'notify',
  'unlisten',
  'lock',
  'vacuum',
  'analyze',
  'cluster',
  'reindex',
  'refresh',
  'comment',
  'security',
  'set',
  'reset',
  'show',
  'begin',
  'commit',
  'rollback',
  'savepoint',
  'release',
  'into',
  'share',
  'import',
  'load',
  'discard',
  'checkpoint',
  'declare',
  'fetch',
  'move',
  'close',
  'explain',
  'returning',
  'session_user',
  'current_user',
  'user',
]);

/** Schemas a query may not name (anything but nlq). */
const BLOCKED_SCHEMAS = /^(public|app|mart|etl|archive|information_schema|pg_.*)$/;

type Token = { kind: 'word' | 'quoted' | 'string' | 'number' | 'punct'; text: string };

function tokens(sql: string): Token[] | string {
  const out: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i]!;
    const next = sql[i + 1];
    if (/\s/.test(ch)) {
      i += 1;
    } else if (ch === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i += 1;
    } else if (ch === '/' && next === '*') {
      let depth = 1;
      i += 2;
      while (i < sql.length && depth > 0) {
        if (sql[i] === '/' && sql[i + 1] === '*') {
          depth += 1;
          i += 2;
        } else if (sql[i] === '*' && sql[i + 1] === '/') {
          depth -= 1;
          i += 2;
        } else i += 1;
      }
      if (depth > 0) return 'a comment is not closed';
    } else if (ch === '$' && /[A-Za-z_$]/.test(next ?? '')) {
      return 'dollar-quoted text is not allowed';
    } else if (ch === "'" || ((ch === 'e' || ch === 'E') && next === "'")) {
      const escapes = ch !== "'";
      i += escapes ? 2 : 1;
      let text = '';
      for (;;) {
        if (i >= sql.length) return 'a quoted text is not closed';
        const c = sql[i]!;
        if (escapes && c === '\\') {
          text += sql[i + 1] ?? '';
          i += 2;
        } else if (c === "'" && sql[i + 1] === "'") {
          text += "'";
          i += 2;
        } else if (c === "'") {
          i += 1;
          break;
        } else {
          text += c;
          i += 1;
        }
      }
      out.push({ kind: 'string', text });
    } else if (ch === '"') {
      i += 1;
      let text = '';
      for (;;) {
        if (i >= sql.length) return 'a quoted name is not closed';
        if (sql[i] === '"' && sql[i + 1] === '"') {
          text += '"';
          i += 2;
        } else if (sql[i] === '"') {
          i += 1;
          break;
        } else {
          text += sql[i];
          i += 1;
        }
      }
      out.push({ kind: 'quoted', text: text.toLowerCase() });
    } else if (/[A-Za-z_]/.test(ch)) {
      let j = i + 1;
      while (j < sql.length && /[A-Za-z0-9_$]/.test(sql[j]!)) j += 1;
      out.push({ kind: 'word', text: sql.slice(i, j).toLowerCase() });
      i = j;
    } else if (/[0-9]/.test(ch) || (ch === '.' && /[0-9]/.test(next ?? ''))) {
      let j = i + 1;
      while (j < sql.length && /[0-9.eE]/.test(sql[j]!)) j += 1;
      out.push({ kind: 'number', text: sql.slice(i, j) });
      i = j;
    } else {
      out.push({ kind: 'punct', text: ch });
      i += 1;
    }
  }
  return out;
}

/**
 * Checks a generated query; returns it without a trailing semicolon, or why it may not run. `views`: every nlq view
 * name, and `allowed` the ones this person's rights cover — naming any other view (bare or nlq.<view>) is refused,
 * because the database lets edupro_nlq read every nlq view and the person's rights are kept here.
 */
export function checkNlqSql(
  raw: string,
  access?: { views: ReadonlySet<string>; allowed: ReadonlySet<string> },
): SqlCheck {
  const sql = raw.trim().replace(/;\s*$/, '').trim();
  if (!sql) return { ok: false, problem: 'the query is empty' };
  if (sql.length > 8000) return { ok: false, problem: 'the query is too long' };
  const toks = tokens(sql);
  if (typeof toks === 'string') return { ok: false, problem: toks };
  const first = toks.find((t) => t.kind === 'word');
  if (!first || (first.text !== 'select' && first.text !== 'with') || toks[0]!.kind !== 'word')
    return { ok: false, problem: 'only a SELECT (or WITH … SELECT) may run' };
  for (let k = 0; k < toks.length; k += 1) {
    const t = toks[k]!;
    const after = toks[k + 1];
    const before = toks[k - 1];
    if (t.kind === 'punct' && t.text === ';')
      return { ok: false, problem: 'only one statement may run' };
    if (t.kind === 'punct' && t.text === '\\')
      return { ok: false, problem: 'a backslash is not allowed' };
    if (t.kind !== 'word' && t.kind !== 'quoted') continue;
    const name = t.text;
    if (t.kind === 'word' && FORBIDDEN.has(name))
      return { ok: false, problem: `"${name}" is not allowed in a data question` };
    if (/^pg_/.test(name)) return { ok: false, problem: `"${name}" is not allowed` };
    // a view the person's rights do not cover (bare, or after nlq.)
    if (access && access.views.has(name) && !access.allowed.has(name))
      return { ok: false, problem: `the view ${name} is not open to this person` };
    // schema.name: only nlq
    if (after?.kind === 'punct' && after.text === '.' && BLOCKED_SCHEMAS.test(name))
      return { ok: false, problem: `only the nlq views may be read, not ${name}.*` };
    // a call: name( or schema.name(
    if (after?.kind === 'punct' && after.text === '(') {
      const qualified = before?.kind === 'punct' && before.text === '.';
      if (qualified) return { ok: false, problem: `the function ${name} is not allowed` };
      if (t.kind === 'word' && NOT_CALLS.has(name)) continue;
      if (!FUNCTIONS.has(name))
        return { ok: false, problem: `the function ${name} is not allowed` };
    }
  }
  return { ok: true, sql };
}
