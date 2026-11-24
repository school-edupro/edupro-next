import { Injectable } from '@nestjs/common';
import type { PoolClient } from '@edupro/db';
import type { Row } from '../catalogue-meta';
import {
  autoChart,
  fillBlanks,
  fitChart,
  formatValue,
  tableColumns,
  type DataCard,
} from './nlq-answer';
import { NLQ_VIEWS, kindOf, type ColumnKind, type NlqView } from './nlq-catalogue';
import { checkNlqSql } from './nlq-sql';

const ALL_VIEWS: ReadonlySet<string> = new Set(NLQ_VIEWS.map((v) => v.view));

/** Rows a question may return (one more tells there are more); rows shown in the chat. */
export const RUN_LIMIT = 5000;
export const SHOWN = 50;

/** What the model replies for a data question (its first prompt's `sql` answer). */
export interface NlqReply {
  sql: string;
  title?: unknown;
  explain?: unknown;
  figures?: unknown;
  text?: unknown;
  chart?: unknown;
  columns?: unknown;
}

export type NlqRun =
  | { ok: true; rows: Row[]; ms: number }
  | { ok: false; error: string; ms: number; refused: boolean };

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

/**
 * docs/design/103: data questions in the chatbot. The AI model writes one SELECT over the nlq views the person's
 * rights cover; EduPro checks it, runs it through app.nlq_run for the question's school only (read-only, 15 s,
 * rolled back), and makes the answer — figures and sentences with their blanks filled from the rows, a chart, the
 * table. The model is told the views' and columns' descriptions only; it never sees a record.
 */
@Injectable()
export class NlqService {
  private described: Map<
    string,
    { comment: string; columns: Array<{ name: string; type: string; comment: string }> }
  > | null = null;

  /** The views' and columns' descriptions (COMMENTs), read once. */
  private async describe(c: PoolClient) {
    if (this.described) return this.described;
    const r = await c.query<{
      view: string;
      vc: string | null;
      col: string;
      type: string;
      cc: string | null;
    }>(
      `SELECT cl.relname AS view, obj_description(cl.oid, 'pg_class') AS vc, a.attname AS col,
              format_type(a.atttypid, a.atttypmod) AS type, col_description(cl.oid, a.attnum) AS cc
         FROM pg_class cl JOIN pg_namespace n ON n.oid = cl.relnamespace
         JOIN pg_attribute a ON a.attrelid = cl.oid AND a.attnum > 0 AND NOT a.attisdropped
        WHERE n.nspname = 'nlq' AND cl.relkind = 'v'
        ORDER BY cl.relname, a.attnum`,
    );
    const map = new Map<
      string,
      { comment: string; columns: Array<{ name: string; type: string; comment: string }> }
    >();
    for (const x of r.rows) {
      if (!map.has(x.view)) map.set(x.view, { comment: x.vc ?? '', columns: [] });
      map.get(x.view)!.columns.push({ name: x.col, type: x.type, comment: x.cc ?? '' });
    }
    this.described = map;
    return map;
  }

  /** The prompt's data part: the offered views, their columns and the closest checked examples. */
  async section(
    c: PoolClient,
    views: NlqView[],
    examples: Array<{ question: string; sql: string }>,
  ) {
    const d = await this.describe(c);
    const parts = views.map((v) => {
      const info = d.get(v.view);
      const cols = (info?.columns ?? [])
        .map((col) => `  - ${col.name} (${col.type}): ${col.comment}`)
        .join('\n');
      return `nlq.${v.view} — ${info?.comment ?? v.oneRowIs}\n${cols}`;
    });
    return [
      // eslint-disable-next-line no-restricted-syntax -- prompt text for the AI model, not SQL that is run
      `The data views you may query (PostgreSQL; read only; one SELECT or WITH over these views only, named nlq.<view>):\n\n${parts.join('\n\n')}`,
      examples.length
        ? `Checked examples:\n${examples.map((e) => `Question: ${e.question}\nSQL: ${e.sql}`).join('\n\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n\n');
  }

  /** The reply format and the rules for a data answer (added to the model's rules). */
  static readonly RULES = [
    'For a question about the school\'s data that the views can answer, reply {"sql": "<one SELECT over the nlq views>", "title": "<a short title>", "explain": "<one line: from which records, which filters, how counted>", "figures": [{"label": "<2-4 words>", "value": "<a blank>"}], "text": ["<1-4 short sentences with blanks>"], "chart": {"type": "bar|stacked_bar|line|donut", "x": "<a result column>", "y": ["<number columns>"]} or null, "columns": {"<result column>": "money|number|count|percent|date|month|label"}}.',
    'Never write a number, name or date yourself in figures or text: use blanks that EduPro fills from the result rows — {count} (rows), {total:col}, {average:col}, {max:col}, {min:col}, {first:col}, {top:label_col:value_col} (the label of the row with the highest value), {bottom:label_col:value_col}.',
    "SQL rules: only the nlq views listed; follow each view's description for what it already leaves out; dates are India dates (current_date is today in India); this academic year is the row of nlq.academic_years with is_current; give columns plain names (AS total_collected); order the rows sensibly; add LIMIT 200 unless the person asks for a full list.",
  ].join('\n');

  /** Runs a checked query for the question's school (app.nlq_begin) inside a savepoint that is rolled back. */
  async run(c: PoolClient, rawSql: string, allowed: NlqView[]): Promise<NlqRun> {
    const started = Date.now();
    const check = checkNlqSql(rawSql, {
      views: ALL_VIEWS,
      allowed: new Set(allowed.map((v) => v.view)),
    });
    if (!check.ok) return { ok: false, error: check.problem, ms: 0, refused: true };
    await c.query('SAVEPOINT nlq_question');
    try {
      await c.query('SELECT app.nlq_begin()');
      // the library limit's row rule reads tables by name: cache the person's libraries before switching role
      await c.query('SELECT app.my_libraries()');
      await c.query('SET LOCAL transaction_read_only = on');
      await c.query(`SET LOCAL statement_timeout = '15s'`);
      await c.query(`SET LOCAL TimeZone = 'Asia/Kolkata'`);
      const r = await c.query<{ row: Row }>('SELECT app.nlq_run($1, $2) AS row', [
        check.sql,
        RUN_LIMIT + 1,
      ]);
      return { ok: true, rows: r.rows.map((x) => x.row), ms: Date.now() - started };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, error: message.slice(0, 300), ms: Date.now() - started, refused: false };
    } finally {
      await c.query('ROLLBACK TO SAVEPOINT nlq_question');
      await c.query('RELEASE SAVEPOINT nlq_question');
    }
  }

  /** The chat answer: the card and its main sentence. */
  build(
    reply: Partial<NlqReply>,
    rows: Row[],
    views: NlqView[],
    checked: boolean,
    fallbackTitle: string,
  ): { card: DataCard; answer: string } {
    const cols = rows.length ? Object.keys(rows[0]!) : [];
    const modelKinds =
      reply.columns && typeof reply.columns === 'object'
        ? (reply.columns as Record<string, string>)
        : undefined;
    const kinds: Record<string, ColumnKind> = Object.fromEntries(
      cols.map((k) => [
        k,
        kindOf(
          k,
          rows.slice(0, 50).map((r) => r[k]),
          views,
          modelKinds,
        ),
      ]),
    );
    const shown = rows.slice(0, Math.min(rows.length, RUN_LIMIT));
    const figures = (Array.isArray(reply.figures) ? reply.figures : [])
      .slice(0, 4)
      .map((f) => {
        const label = str((f as { label?: unknown })?.label, 40);
        const value = fillBlanks(str((f as { value?: unknown })?.value, 80), shown, kinds);
        return label && value ? { label, labelHi: label, value } : null;
      })
      .filter((x): x is { label: string; labelHi: string; value: string } => !!x);
    const text = (
      Array.isArray(reply.text) ? reply.text : typeof reply.text === 'string' ? [reply.text] : []
    )
      .slice(0, 4)
      .map((t) => fillBlanks(str(t, 300), shown, kinds))
      .filter((x): x is string => !!x);
    const chart =
      fitChart(reply.chart, shown, kinds) ??
      (reply.chart === undefined ? autoChart(shown, kinds) : null);
    const title = str(reply.title, 120) || fallbackTitle;
    const more = rows.length > SHOWN ? rows.length - SHOWN : 0;
    const card: DataCard = {
      kind: 'data',
      title,
      explain: str(reply.explain, 300),
      figures,
      text,
      chart,
      columns: tableColumns(shown, kinds),
      rows: shown.slice(0, SHOWN),
      more,
      checked,
    };
    // the chat message is the title; the sentences, figures, chart and table are in the card (said once)
    const answer = rows.length ? title : 'No records match this question.';
    return { card, answer };
  }

  /** A value formatted for words (used by checked answers' one line). */
  static format(v: unknown, kind: ColumnKind) {
    return formatValue(v, kind);
  }
}
