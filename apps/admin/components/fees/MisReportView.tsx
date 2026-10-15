import { Card, SelectField } from '@edupro/ui';
import { FilterInput, FilterRow } from '@/components/RegisterTools';
import { ApiError, apiFetch, getMe } from '@/lib/api';
import type { Page } from '@/lib/types';
import {
  openMiscReminderForAll,
  openMiscReminderForTicked,
  openReminderForAll,
  openReminderForTicked,
  resetReportColumns,
  saveReportColumnsMine,
  saveReportColumnsSchool,
} from '@/lib/fee-request-actions';
import { ReportColumns, type ChoiceColumn } from './ReportColumns';
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
  choice?: { columns: ChoiceColumn[]; source: 'user' | 'school' | 'all' };
  hidden?: string[];
}

/** What each report is filtered by. */
const FILTERS: Partial<
  Record<
    ReportKey,
    Array<
      | 'dates'
      | 'ledger'
      | 'mode'
      | 'class'
      | 'months'
      | 'view'
      | 'asof'
      | 'discount'
      | 'least'
      | 'miscfee'
    >
  >
> = {
  defaulters: ['asof', 'class', 'discount', 'least', 'ledger'],
  day_book: ['dates', 'ledger', 'mode'],
  daybook_grouped: ['dates', 'ledger', 'class'],
  mode_daywise: ['dates', 'ledger'],
  head_receipts: ['dates', 'ledger', 'class'],
  cheque_bounce: ['dates', 'ledger'],
  period_headwise: ['months', 'ledger', 'class'],
  yearly_projection: ['months', 'ledger', 'class'],
  forecast: ['view', 'ledger', 'class'],
  check: ['dates', 'ledger'],
  misc_dues: ['miscfee', 'class'],
};
/** Heavy reports: shown after the filters are chosen. */
const WAITS: ReportKey[] = ['period_headwise', 'yearly_projection', 'forecast'];
const TITLE: Partial<Record<ReportKey, string>> = {
  period_headwise: 'Period fee, head-wise (pupil-wise)',
  yearly_projection: 'Yearly fee projection (month-wise)',
  forecast: 'Fee forecast',
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
  tick,
}: {
  columns: MisColumn[];
  rows: MisRow[];
  caption: string;
  /** A tick box in front of each line: the name of the form field and the cell that holds its value. */
  tick?: { name: string; cell: string; label: string };
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
    // a wide report scrolls sideways inside its box; the keyboard can reach it
    <div className="ep-table-wrap" tabIndex={0} role="region" aria-label={caption}>
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
            {tick ? (
              <th scope="col">
                <span className="ep-sr-only">Tick</span>
              </th>
            ) : null}
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
                    colSpan={columns.length + (tick ? 1 : 0)}
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
                {tick ? (
                  <td style={style}>
                    {r.kind === 'row' ? (
                      <input
                        type="checkbox"
                        name={tick.name}
                        value={String(r.cells[tick.cell] ?? '')}
                        aria-label={`${tick.label} ${String(r.cells.student ?? '')}`}
                      />
                    ) : null}
                  </td>
                ) : null}
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
  const asOf = day(sp.asOf) || today;
  const discountId = sp.discountId === 'none' ? 'none' : id(sp.discountId);
  const least = /^\d{1,9}$/.test(sp.minBalance ?? '') ? sp.minBalance! : '';
  if (has('asof')) q.set('asOf', asOf);
  if (has('discount') && discountId) q.set('discountId', discountId);
  if (has('least') && least) q.set('minBalance', least);
  const pay = ['due', 'unpaid', 'part', 'paid'].includes(sp.pay ?? '') ? sp.pay! : '';
  if (has('miscfee')) {
    if (id(sp.miscFeeId)) q.set('miscFeeId', id(sp.miscFeeId));
    if (pay) q.set('pay', pay);
  }
  // the pupil-wise reports and the forecast read every bill of the session: they are worked out only
  // when the filters have been chosen and Apply is pressed, not on opening the tab
  const waits = WAITS.includes(report) && sp.show !== '1';
  let data: MisReport | null = null;
  let problem = '';
  if (!waits)
    try {
      data = await apiFetch<MisReport>(`/fees/mis/${report}?${q.toString()}`);
    } catch (error) {
      if (!(error instanceof ApiError)) throw error;
      problem = error.problem.detail ?? error.problem.type;
    }
  const discounts = has('discount')
    ? await apiFetch<{ data: Array<{ id: string; name: string }> }>('/fees/discounts')
        .then((x) => x.data)
        .catch(() => [])
    : [];
  const miscFees = has('miscfee')
    ? await apiFetch<{ rows: Array<{ id: string; title: string; status: string }> }>(
        '/fees/misc-fees?size=200',
      )
        .then((x) => x.rows.filter((f) => f.status === 'announced' || f.status === 'closed'))
        .catch(() => [])
    : [];
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
  // where the column chooser comes back to: this report with what is chosen
  const here = new URLSearchParams(q);
  here.set('report', report);
  if (WAITS.includes(report)) here.set('show', '1');
  const me = data?.choice ? await getMe() : null;
  const body = data?.rows ?? [];
  const lines = body.filter((r) => r.kind === 'row').length;
  // a plain list is shown a page at a time with its total; a grouped one (headings and subtotals) shows
  // its first rows. The files always carry all of it.
  const plain = !body.some((r) => r.kind === 'group' || r.kind === 'subtotal');
  const size = ['50', '100', '200', '500'].includes(sp.size ?? '') ? Number(sp.size) : 100;
  const pages = plain ? Math.max(1, Math.ceil(lines / size)) : 1;
  const page = Math.min(Math.max(1, Number(sp.page) || 1), pages);
  let seen = 0;
  const shown = body.filter((r) => {
    if (r.kind === 'row') {
      seen += 1;
      return plain ? seen > (page - 1) * size && seen <= page * size : seen <= SHOWN;
    }
    // the grand total always shows; the headings and subtotals of a grouped list go with their rows
    return r.kind === 'total' || seen <= SHOWN;
  });
  const pageHref = (n: number) => {
    const u = new URLSearchParams(here);
    u.set('page', String(n));
    u.set('size', String(size));
    return `/fees/reports?${u.toString()}`;
  };
  const misc = report === 'misc_dues';
  const canRemind =
    (report === 'defaulters' || misc) &&
    (me?.permissions.includes('fees.defaulter.notify') ?? false);
  return (
    <Card title={data?.title ?? TITLE[report] ?? ''}>
      <FilterRow
        clearHref={`/fees/reports?report=${report}`}
        hidden={WAITS.includes(report) ? { report, show: '1' } : { report }}
      >
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
            label="Fee type"
            defaultValue={sp.ledger ?? ''}
            options={[
              { value: '', label: 'All' },
              { value: 'school', label: 'Regular (school fee)' },
              { value: 'hostel', label: 'Hosteller (hostel fee)' },
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
        {has('asof') ? (
          <FilterInput id="asOf" label="Overdue as on" type="date" value={asOf} />
        ) : null}
        {has('discount') ? (
          <SelectField
            id="discountId"
            name="discountId"
            label="Discount type"
            defaultValue={discountId}
            options={[
              { value: '', label: 'All' },
              { value: 'none', label: 'No discount' },
              ...discounts.map((d) => ({ value: d.id, label: d.name })),
            ]}
          />
        ) : null}
        {has('least') ? (
          <FilterInput id="minBalance" label="Balance of at least (₹)" value={least} />
        ) : null}
        {has('miscfee') ? (
          <>
            <SelectField
              id="miscFeeId"
              name="miscFeeId"
              label="Misc fee"
              defaultValue={id(sp.miscFeeId)}
              options={[
                { value: '', label: 'All misc fees' },
                ...miscFees.map((f) => ({ value: f.id, label: f.title })),
              ]}
            />
            <SelectField
              id="pay"
              name="pay"
              label="Payment"
              defaultValue={pay}
              options={[
                { value: '', label: 'Paid and unpaid' },
                { value: 'due', label: 'Not paid in full' },
                { value: 'unpaid', label: 'Unpaid' },
                { value: 'part', label: 'Part paid' },
                { value: 'paid', label: 'Paid' },
              ]}
            />
          </>
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
        <SelectField
          id="size"
          name="size"
          label="Rows on a page"
          defaultValue={String(size)}
          options={['50', '100', '200', '500'].map((n) => ({ value: n, label: n }))}
        />
      </FilterRow>
      {problem ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {problem}
        </p>
      ) : null}
      {waits ? (
        <p className="ep-alert ep-alert--info" role="status">
          Choose the filters above and press Apply to see the report.
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
              {!plain && lines > SHOWN
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
          {data.choice ? (
            <div style={{ marginBottom: 'var(--sp-3)' }}>
              <ReportColumns
                key={data.choice.columns.map((c) => `${c.key}${c.hidden ? '-' : '+'}`).join('')}
                report={report}
                back={`/fees/reports?${here.toString()}`}
                columns={data.choice.columns}
                source={data.choice.source}
                canSetSchool={me?.permissions.includes('fees.master.manage') ?? false}
                saveMine={saveReportColumnsMine}
                saveSchool={saveReportColumnsSchool}
                reset={resetReportColumns}
              />
            </div>
          ) : null}
          {canRemind && lines > 0 ? (
            <form action={misc ? openMiscReminderForTicked : openReminderForTicked}>
              {[...q.entries()].map(([k, v]) => (
                <input key={k} type="hidden" name={k} value={v} />
              ))}
              <Table
                columns={data.columns}
                rows={shown}
                caption={data.title}
                tick={
                  misc
                    ? { name: 'lineId', cell: 'line_id', label: 'Remind the parents of' }
                    : { name: 'studentId', cell: 'student_id', label: 'Remind the parents of' }
                }
              />
              <div
                style={{
                  display: 'flex',
                  gap: 'var(--sp-2)',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  marginTop: 'var(--sp-3)',
                }}
              >
                <button type="submit" className="ep-btn ep-btn--primary">
                  Send a reminder to the ticked
                </button>
                <button
                  type="submit"
                  className="ep-btn ep-btn--secondary"
                  formAction={misc ? openMiscReminderForAll : openReminderForAll}
                >
                  {misc
                    ? 'Send a reminder to all unpaid in this list'
                    : `Send a reminder to all ${String(lines)} in this list`}
                </button>
                <span className="ep-field__help">
                  The next screen chooses the template, shows the message and the cost, and sends a
                  test first. Nothing is sent from here.
                </span>
              </div>
            </form>
          ) : (
            <Table columns={data.columns} rows={shown} caption={data.title} />
          )}
          {plain && pages > 1 ? (
            <nav
              aria-label="Pages"
              style={{
                display: 'flex',
                gap: 'var(--sp-3)',
                alignItems: 'center',
                marginTop: 'var(--sp-3)',
              }}
            >
              {page > 1 ? (
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={pageHref(page - 1)}>
                  ← Previous
                </a>
              ) : null}
              <span className="ep-field__help">
                Page {page} of {pages} · {size} on a page
              </span>
              {page < pages ? (
                <a className="ep-btn ep-btn--secondary ep-btn--sm" href={pageHref(page + 1)}>
                  Next →
                </a>
              ) : null}
            </nav>
          ) : null}
          {data.hidden && data.hidden.length > 0 ? (
            <p className="ep-field__help" role="note">
              {data.hidden.length} column{data.hidden.length === 1 ? '' : 's'} left out:{' '}
              {data.hidden.slice(0, 12).join(', ')}
              {data.hidden.length > 12 ? ` and ${String(data.hidden.length - 12)} more` : ''}. The
              totals still include them.
            </p>
          ) : null}
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
