import { Card, SelectField } from '@edupro/ui';
import { FilterInput, FilterRow } from '@/components/RegisterTools';
import { ApiError, apiFetch } from '@/lib/api';
import type { Page } from '@/lib/types';
import type { ReportKey } from './ReportTabs';

interface MisColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  group?: string;
}
interface MisRow {
  kind: 'row' | 'group' | 'subtotal' | 'total';
  level?: 1 | 2;
  label?: string;
  cells: Record<string, string | number | null>;
}
interface MisBlock {
  title: string;
  columns: MisColumn[];
  rows: MisRow[];
}
interface MisReport {
  title: string;
  filters: string[];
  note: string;
  columns: MisColumn[];
  rows: MisRow[];
  blocks?: MisBlock[];
}

/** What each report is filtered by. */
const FILTERS: Partial<
  Record<ReportKey, Array<'dates' | 'ledger' | 'mode' | 'class' | 'months' | 'view'>>
> = {
  day_book: ['dates', 'ledger', 'mode'],
  daybook_grouped: ['dates', 'ledger', 'class'],
  mode_daywise: ['dates', 'ledger'],
  head_receipts: ['dates', 'ledger', 'class'],
  cheque_bounce: ['dates', 'ledger'],
  period_headwise: ['months', 'class'],
  yearly_projection: ['months', 'class'],
  forecast: ['view', 'ledger', 'class'],
  check: ['dates', 'ledger'],
};
const SHOWN = 300;
const money = (v: number) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const BAND: Record<string, string> = {
  heading: 'var(--surface-subtle)',
  subtotal: 'var(--surface-subtle)',
  total: 'var(--mob-navy-800)',
};

function Table({
  columns,
  rows,
  caption,
}: {
  columns: MisColumn[];
  rows: MisRow[];
  caption: string;
}) {
  const grouped = columns.some((c) => c.group);
  // the heading row over grouped columns (Payable, Paid, a month, a quarter)
  const spans: Array<{ label: string; span: number }> = [];
  for (const c of columns) {
    const last = spans[spans.length - 1];
    if (last && last.label === (c.group ?? '')) last.span += 1;
    else spans.push({ label: c.group ?? '', span: 1 });
  }
  const firstNumber = columns.findIndex((c) => c.type === 'number' && c.key !== 'sr');
  const labelSpan = firstNumber > 0 ? firstNumber : 1;
  return (
    <div className="ep-table-wrap">
      <table className="ep-table ep-table--dense">
        <caption className="ep-sr-only">{caption}</caption>
        <thead>
          {grouped ? (
            <tr>
              {spans.map((s, i) =>
                s.label ? (
                  <th key={i} scope="colgroup" colSpan={s.span} style={{ textAlign: 'center' }}>
                    {s.label}
                  </th>
                ) : (
                  <td key={i} colSpan={s.span} />
                ),
              )}
            </tr>
          ) : null}
          <tr>
            {columns.map((c) => (
              <th
                key={c.key}
                scope="col"
                style={{ textAlign: c.type === 'number' ? 'right' : 'left', whiteSpace: 'nowrap' }}
              >
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            if (r.kind === 'group')
              return (
                <tr key={i}>
                  <th
                    scope="colgroup"
                    colSpan={columns.length}
                    style={{
                      textAlign: 'left',
                      background: BAND.heading,
                      paddingLeft: r.level === 2 ? 'var(--sp-5)' : undefined,
                    }}
                  >
                    {r.label}
                  </th>
                </tr>
              );
            const strong = r.kind !== 'row';
            const grand = r.kind === 'total';
            const style = {
              fontWeight: strong ? ('var(--fw-semibold)' as const) : undefined,
              background: grand ? BAND.total : strong ? BAND.subtotal : undefined,
              color: grand ? 'var(--text-inverse)' : undefined,
            };
            const cells = strong && r.label ? columns.slice(labelSpan) : columns;
            return (
              <tr key={i}>
                {strong && r.label ? (
                  <td colSpan={labelSpan} style={style}>
                    {r.label}
                  </td>
                ) : null}
                {cells.map((c) => {
                  const v = r.cells[c.key];
                  const out =
                    v === null || v === undefined
                      ? ''
                      : c.type === 'number' &&
                          typeof v === 'number' &&
                          c.key !== 'sr' &&
                          c.key !== 'count'
                        ? money(v)
                        : String(v);
                  const bad = c.key === 'result' && out !== 'Agrees' && out !== '';
                  return (
                    <td
                      key={c.key}
                      style={{
                        ...style,
                        textAlign: c.type === 'number' ? 'right' : 'left',
                        whiteSpace: ['repay_by', 'reason', 'what'].includes(c.key)
                          ? 'normal'
                          : 'nowrap',
                        color: bad ? 'var(--status-danger-text)' : style.color,
                        fontWeight: bad ? 'var(--fw-semibold)' : style.fontWeight,
                      }}
                    >
                      {out}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * One fee report with a column for every head, payment mode, month or quarter: its filters, the table as
 * the Excel and PDF files carry it, the summary tables, and the rule the figures follow.
 */
export async function MisReportView({
  report,
  sp,
}: {
  report: ReportKey;
  sp: Record<string, string | undefined>;
}) {
  const has = (f: string) => (FILTERS[report] ?? []).includes(f as never);
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const id = (v?: string) => (v && /^\d{1,18}$/.test(v) ? v : '');
  // the day book opens on today, the other dated reports on the month so far; the cheque bounce
  // report looks back thirty days and the check takes the whole session, each by itself
  const auto = report === 'cheque_bounce' || report === 'check';
  const from =
    day(sp.from) || (auto ? '' : report === 'day_book' ? today : `${today.slice(0, 8)}01`);
  const to = day(sp.to) || (auto ? '' : today);
  const view = sp.view === 'quarter' ? 'quarter' : 'month';
  const by = sp.by === 'head' ? 'head' : 'class';
  const q = new URLSearchParams();
  if (has('dates')) {
    if (from) q.set('from', from);
    if (to) q.set('to', to);
  }
  if (has('ledger') && (sp.ledger === 'school' || sp.ledger === 'hostel'))
    q.set('ledger', sp.ledger);
  if (has('mode') && sp.mode) q.set('mode', sp.mode.slice(0, 60));
  if (has('class') && id(sp.classId)) q.set('classId', id(sp.classId));
  if (has('months')) {
    if (id(sp.fromSeq)) q.set('fromSeq', id(sp.fromSeq));
    if (id(sp.toSeq)) q.set('toSeq', id(sp.toSeq));
  }
  if (has('view')) {
    q.set('view', view);
    q.set('by', by);
  }
  let data: MisReport | null = null;
  let problem = '';
  try {
    data = await apiFetch<MisReport>(`/fees/mis/${report}?${q.toString()}`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    problem = error.problem.detail ?? error.problem.type;
  }
  const [classes, periods, modes] = await Promise.all([
    has('class')
      ? apiFetch<Page<{ id: string; code: string; name: string }>>('/academics/classes?size=200')
          .then((x) => x.data)
          .catch(() => [])
      : Promise.resolve([]),
    has('months')
      ? apiFetch<{ data: Array<{ sequence: number; name: string }> }>('/fees/periods')
          .then((x) => x.data)
          .catch(() => [])
      : Promise.resolve([]),
    has('mode')
      ? apiFetch<{ data: Array<{ code: string; label: string }> }>('/fees/payment-modes')
          .then((x) => x.data)
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const file = `/api/fees/mis-file?report=${report}&${q.toString()}`;
  const body = data?.rows ?? [];
  const lines = body.filter((r) => r.kind === 'row').length;
  // a long report shows its first rows and the grand total; the files carry all of it
  let seen = 0;
  const shown = body.filter((r) => {
    if (r.kind === 'row') seen += 1;
    return r.kind === 'total' || seen <= SHOWN;
  });
  return (
    <Card title={data?.title ?? ''}>
      <FilterRow clearHref={`/fees/reports?report=${report}`} hidden={{ report }}>
        {has('view') ? (
          <>
            <SelectField
              id="view"
              name="view"
              label="Show"
              defaultValue={view}
              options={[
                { value: 'month', label: 'Month-wise' },
                { value: 'quarter', label: 'Quarter-wise' },
              ]}
            />
            <SelectField
              id="by"
              name="by"
              label="Rows"
              defaultValue={by}
              options={[
                { value: 'class', label: 'By class' },
                { value: 'head', label: 'By fee head' },
              ]}
            />
          </>
        ) : null}
        {has('months') ? (
          <>
            <SelectField
              id="fromSeq"
              name="fromSeq"
              label="From month"
              defaultValue={id(sp.fromSeq)}
              options={[
                { value: '', label: 'Start of session' },
                ...periods.map((p) => ({ value: String(p.sequence), label: p.name })),
              ]}
            />
            <SelectField
              id="toSeq"
              name="toSeq"
              label="To month"
              defaultValue={id(sp.toSeq)}
              options={[
                { value: '', label: 'End of session' },
                ...periods.map((p) => ({ value: String(p.sequence), label: p.name })),
              ]}
            />
          </>
        ) : null}
        {has('dates') ? (
          <>
            <FilterInput id="from" label="From" type="date" value={from} />
            <FilterInput id="to" label="To" type="date" value={to} />
          </>
        ) : null}
        {has('ledger') ? (
          <SelectField
            id="ledger"
            name="ledger"
            label="Ledger"
            defaultValue={sp.ledger ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'school', label: 'School' },
              { value: 'hostel', label: 'Hostel' },
            ]}
          />
        ) : null}
        {has('mode') ? (
          <SelectField
            id="mode"
            name="mode"
            label="Mode"
            defaultValue={sp.mode ?? ''}
            options={[
              { value: '', label: 'Any mode' },
              // a mode the school added is kept on the receipt by its name
              ...modes.map((m) => ({
                value: m.code.startsWith('x_') ? m.label : m.code,
                label: m.label,
              })),
            ]}
          />
        ) : null}
        {has('class') ? (
          <SelectField
            id="classId"
            name="classId"
            label="Class"
            defaultValue={id(sp.classId)}
            options={[
              { value: '', label: 'All classes' },
              ...classes.map((k) => ({ value: k.id, label: k.name || k.code })),
            ]}
          />
        ) : null}
      </FilterRow>
      {problem ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {problem}
        </p>
      ) : null}
      {data ? (
        <>
          <div
            style={{
              display: 'flex',
              gap: 'var(--sp-2)',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexWrap: 'wrap',
              marginBottom: 'var(--sp-3)',
            }}
          >
            <span className="ep-field__help" aria-live="polite">
              {data.filters.join(' · ')} · {lines} row{lines === 1 ? '' : 's'}
              {lines > SHOWN
                ? ` · the first ${String(SHOWN)} are shown here; Excel and PDF carry all`
                : ''}
            </span>
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${file}&format=xlsx`}>
                Excel
              </a>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={`${file}&format=pdf`}>
                PDF
              </a>
            </span>
          </div>
          <Table columns={data.columns} rows={shown} caption={data.title} />
          {lines === 0 ? <p>Nothing to show for what is chosen.</p> : null}
          {(data.blocks ?? []).length > 0 ? (
            <div
              style={{
                display: 'grid',
                gap: 'var(--sp-4)',
                gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 24rem), 1fr))',
                marginTop: 'var(--sp-5)',
                alignItems: 'start',
              }}
            >
              {(data.blocks ?? []).map((b) => (
                <section key={b.title} aria-label={b.title}>
                  <h3 className="ep-h4">{b.title}</h3>
                  <Table columns={b.columns} rows={b.rows} caption={b.title} />
                </section>
              ))}
            </div>
          ) : null}
          <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
            {data.note}
          </p>
        </>
      ) : null}
    </Card>
  );
}
