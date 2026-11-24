/**
 * docs/design/103: a data question's result made into the chat's answer — the figures and sentences the AI model wrote
 * with blanks ({total:amount}, {top:class:amount} …) filled from the rows by EduPro (so the words always match the
 * numbers and the model never sees a record), the chart it asked for when it fits the result, and the table.
 */
import type { CardColumn, Row } from '../catalogue-meta';
import type { ColumnKind } from './nlq-catalogue';

export type ChartType = 'bar' | 'stacked_bar' | 'line' | 'donut';
export interface NlqChart {
  type: ChartType;
  /** the column along the axis (or the slices of a donut) */
  x: string;
  /** the number columns drawn */
  y: string[];
}

export interface DataCard {
  kind: 'data';
  title: string;
  /** how it was worked out, in words */
  explain: string;
  figures: Array<{ label: string; labelHi: string; value: string }>;
  text: string[];
  chart: NlqChart | null;
  columns: CardColumn[];
  rows: Row[];
  /** rows not shown in the chat */
  more: number;
  /** answered from a checked question (no model) */
  checked: boolean;
}

const NUMERIC: ColumnKind[] = ['money', 'number', 'count', 'percent'];
const inr = (n: number, digits: number) =>
  new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);

const num = (v: unknown): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v);
  return null;
};

/** One value as a person reads it. */
export function formatValue(v: unknown, kind: ColumnKind): string {
  if (v === null || v === undefined || v === '') return '—';
  const n = num(v);
  switch (kind) {
    case 'money':
      return n === null ? String(v) : `₹${inr(n, Number.isInteger(n) ? 0 : 2)}`;
    case 'percent':
      return n === null ? String(v) : `${inr(n, 1)}%`;
    case 'number':
    case 'count':
      return n === null ? String(v) : inr(n, Number.isInteger(n) ? 0 : 2);
    case 'flag':
      return v === true || v === 't' || v === 'true' ? 'Yes' : 'No';
    case 'date':
    case 'month': {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
      if (!m) return String(v);
      const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
      return d.toLocaleDateString('en-IN', {
        ...(kind === 'date' ? { day: 'numeric' } : {}),
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      });
    }
    default:
      return String(v);
  }
}

/**
 * Fills a sentence's blanks from the rows; null when one cannot be filled (the sentence is then left out).
 * {count} · {total:col} · {average:col} · {max:col} · {min:col} · {first:col} · {top:label:value} · {bottom:label:value}
 */
export function fillBlanks(
  template: string,
  rows: Row[],
  kinds: Record<string, ColumnKind>,
): string | null {
  let failed = false;
  const out = template.replace(
    /\{([a-z_]+)(?::([A-Za-z0-9_]+))?(?::([A-Za-z0-9_]+))?\}/g,
    (_m, fn: string, a?: string, b?: string) => {
      const values = (col: string) =>
        rows.map((r) => num(r[col])).filter((x): x is number => x !== null);
      const has = (col?: string) => !!col && rows.length > 0 && col in rows[0]!;
      switch (fn) {
        case 'count':
          return inr(rows.length, 0);
        case 'total':
        case 'average':
        case 'max':
        case 'min': {
          if (!has(a)) break;
          const xs = values(a!);
          if (!xs.length) break;
          const v =
            fn === 'total'
              ? xs.reduce((s, x) => s + x, 0)
              : fn === 'average'
                ? xs.reduce((s, x) => s + x, 0) / xs.length
                : fn === 'max'
                  ? Math.max(...xs)
                  : Math.min(...xs);
          const kind =
            kinds[a!] === 'count' && fn === 'average' ? 'number' : (kinds[a!] ?? 'number');
          return formatValue(Math.round(v * 100) / 100, kind);
        }
        case 'first':
          if (!has(a)) break;
          return formatValue(rows[0]![a!], kinds[a!] ?? 'label');
        case 'top':
        case 'bottom': {
          if (!has(a) || !has(b)) break;
          let pick: Row | null = null;
          let best: number | null = null;
          for (const r of rows) {
            const v = num(r[b!]);
            if (v === null) continue;
            if (best === null || (fn === 'top' ? v > best : v < best)) {
              best = v;
              pick = r;
            }
          }
          if (!pick) break;
          return formatValue(pick[a!], kinds[a!] ?? 'label');
        }
      }
      failed = true;
      return '';
    },
  );
  return failed ? null : out.trim();
}

/** The chart the model asked for, when it fits the result; else null. */
export function fitChart(
  asked: unknown,
  rows: Row[],
  kinds: Record<string, ColumnKind>,
): NlqChart | null {
  if (!asked || typeof asked !== 'object') return null;
  const c = asked as { type?: unknown; x?: unknown; y?: unknown };
  const type = c.type === 'pie' ? 'donut' : c.type;
  if (type !== 'bar' && type !== 'stacked_bar' && type !== 'line' && type !== 'donut') return null;
  const cols = rows.length ? Object.keys(rows[0]!) : [];
  const x = typeof c.x === 'string' && cols.includes(c.x) ? c.x : null;
  const y = (Array.isArray(c.y) ? c.y : [c.y]).filter(
    (k): k is string =>
      typeof k === 'string' && cols.includes(k) && NUMERIC.includes(kinds[k] ?? 'label'),
  );
  if (!x || !y.length || rows.length < 2) return null;
  if (type === 'donut' && (rows.length > 8 || y.length !== 1)) return null;
  if (type === 'stacked_bar' && y.length < 2) return null;
  if (rows.length > 60) return null;
  return { type, x, y: y.slice(0, 4) };
}

/** When nothing better is asked: a bar chart for one label column and one to three number columns. */
export function autoChart(rows: Row[], kinds: Record<string, ColumnKind>): NlqChart | null {
  if (rows.length < 2 || rows.length > 30) return null;
  const cols = Object.keys(rows[0]!);
  const labels = cols.filter((k) => ['label', 'date', 'month'].includes(kinds[k] ?? 'label'));
  const numbers = cols.filter((k) => NUMERIC.includes(kinds[k] ?? 'label'));
  if (labels.length !== 1 || numbers.length < 1 || numbers.length > 3) return null;
  return {
    type: kinds[labels[0]!] === 'month' || kinds[labels[0]!] === 'date' ? 'line' : 'bar',
    x: labels[0]!,
    y: numbers,
  };
}

const human = (key: string) => {
  const s = key.replace(/_/g, ' ').trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** The table's columns, in the result's order. */
export function tableColumns(rows: Row[], kinds: Record<string, ColumnKind>): CardColumn[] {
  if (!rows.length) return [];
  return Object.keys(rows[0]!).map((key) => {
    const kind = kinds[key] ?? 'label';
    return {
      key,
      label: human(key),
      labelHi: human(key),
      type:
        kind === 'money'
          ? 'money'
          : kind === 'date' || kind === 'month'
            ? 'date'
            : kind === 'number' || kind === 'count' || kind === 'percent'
              ? 'number'
              : 'text',
    };
  });
}
