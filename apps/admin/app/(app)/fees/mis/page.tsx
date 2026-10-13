import { Card, PageHeader, SelectField } from '@edupro/ui';
import { Notice } from '@/components/Notice';
import { FilterInput, FilterRow } from '@/components/RegisterTools';
import { ApiError, apiFetch } from '@/lib/api';
import type { Page } from '@/lib/types';

interface MisColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date';
  group?: string;
}
interface MisRow {
  kind: 'row' | 'group' | 'subtotal' | 'total';
  label?: string;
  cells: Record<string, string | number | null>;
}
interface MisReport {
  title: string;
  filters: string[];
  note: string;
  columns: MisColumn[];
  rows: MisRow[];
}

const REPORTS = [
  ['mode_daywise', 'Mode-wise collection', 'dates'],
  ['head_receipts', 'Head-wise tally', 'dates'],
  ['cheque_bounce', 'Cheque bounce', 'dates'],
  ['daybook_grouped', 'Day book (grouped)', 'dates'],
  ['period_headwise', 'Period fee, head-wise', 'months'],
  ['yearly_projection', 'Yearly projection', 'months'],
] as const;
type ReportId = (typeof REPORTS)[number][0];
const SHOWN = 300;
const money = (v: number) =>
  v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * The fee MIS reports with a column for every fee head, payment mode or month. The screen shows the
 * table as the Excel and PDF files carry it: the same columns, subtotals and totals.
 */
export default async function FeeMisPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const found = REPORTS.find((r) => r[0] === sp.report) ?? REPORTS[0];
  const report: ReportId = found[0];
  const byMonths = found[2] === 'months';
  const today = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
  const day = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '');
  const id = (v?: string) => (v && /^\d{1,18}$/.test(v) ? v : '');
  // a month to date by default; the cheque bounce report looks back thirty days by itself
  const from = day(sp.from) || (report === 'cheque_bounce' ? '' : `${today.slice(0, 8)}01`);
  const to = day(sp.to) || (report === 'cheque_bounce' ? '' : today);
  const q = new URLSearchParams();
  if (!byMonths) {
    if (from) q.set('from', from);
    if (to) q.set('to', to);
    if (sp.ledger === 'school' || sp.ledger === 'hostel') q.set('ledger', sp.ledger);
  } else {
    if (id(sp.fromSeq)) q.set('fromSeq', id(sp.fromSeq));
    if (id(sp.toSeq)) q.set('toSeq', id(sp.toSeq));
  }
  if (id(sp.classId) && report !== 'mode_daywise' && report !== 'cheque_bounce')
    q.set('classId', id(sp.classId));
  let data: MisReport | null = null;
  let problem = '';
  try {
    data = await apiFetch<MisReport>(`/fees/mis/${report}?${q.toString()}`);
  } catch (error) {
    if (!(error instanceof ApiError)) throw error;
    problem = error.problem.detail ?? error.problem.type;
  }
  const [classes, periods] = await Promise.all([
    apiFetch<Page<{ id: string; code: string; name: string }>>('/academics/classes?size=200')
      .then((x) => x.data)
      .catch(() => []),
    byMonths
      ? apiFetch<{ data: Array<{ sequence: number; name: string }> }>('/fees/periods')
          .then((x) => x.data)
          .catch(() => [])
      : Promise.resolve([]),
  ]);
  const file = `/api/fees/mis-file?report=${report}&${q.toString()}`;
  const cols = data?.columns ?? [];
  const grouped = cols.some((c) => c.group);
  // the heading row over grouped columns (Payable, Paid, Paid again)
  const spans: Array<{ label: string; span: number }> = [];
  for (const c of cols) {
    const last = spans[spans.length - 1];
    if (last && last.label === (c.group ?? '')) last.span += 1;
    else spans.push({ label: c.group ?? '', span: 1 });
  }
  const words = cols.find((c) => c.type === 'text')?.key ?? cols[0]?.key ?? '';
  const body = data?.rows ?? [];
  const lines = body.filter((r) => r.kind === 'row').length;
  // a long report shows its first rows and every total; the files carry all of it
  let seen = 0;
  const shown = body.filter((r) => {
    if (r.kind === 'row') seen += 1;
    return r.kind === 'total' || (r.kind !== 'row' ? seen <= SHOWN : seen <= SHOWN);
  });
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="MIS reports"
        description="Collection by day and payment mode, by fee head, cheque bounces with what was paid again, and the pupil-wise payable and paid by head and by month. Excel and PDF carry the table as shown."
      />
      <Notice params={sp} />
      <nav
        aria-label="MIS reports"
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-3)',
        }}
      >
        {REPORTS.map(([key, label]) => (
          <a
            key={key}
            className={`ep-btn ep-btn--sm ${key === report ? '' : 'ep-btn--ghost'}`}
            href={`/fees/mis?report=${key}`}
            aria-current={key === report ? 'page' : undefined}
          >
            {label}
          </a>
        ))}
        <a className="ep-btn ep-btn--sm ep-btn--ghost" href="/fees/reports">
          Day book and other reports
        </a>
      </nav>
      <Card title={data?.title ?? found[1]}>
        <FilterRow clearHref={`/fees/mis?report=${report}`} hidden={{ report }}>
          {byMonths ? (
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
          ) : (
            <>
              <FilterInput id="from" label="From" type="date" value={from} />
              <FilterInput id="to" label="To" type="date" value={to} />
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
            </>
          )}
          {report !== 'mode_daywise' && report !== 'cheque_bounce' ? (
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
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{data.title}</caption>
                <thead>
                  {grouped ? (
                    <tr>
                      {spans.map((s, i) =>
                        s.label ? (
                          <th
                            key={i}
                            scope="colgroup"
                            colSpan={s.span}
                            style={{ textAlign: 'center' }}
                          >
                            {s.label}
                          </th>
                        ) : (
                          <td key={i} colSpan={s.span} />
                        ),
                      )}
                    </tr>
                  ) : null}
                  <tr>
                    {cols.map((c) => (
                      <th
                        key={c.key}
                        scope="col"
                        style={{
                          textAlign: c.type === 'number' ? 'right' : 'left',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {c.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) =>
                    r.kind === 'group' ? (
                      <tr key={i}>
                        <th scope="colgroup" colSpan={cols.length} style={{ textAlign: 'left' }}>
                          {r.label}
                        </th>
                      </tr>
                    ) : (
                      <tr key={i}>
                        {cols.map((c) => {
                          const strong = r.kind !== 'row';
                          const v = strong && c.key === words && r.label ? r.label : r.cells[c.key];
                          const out =
                            v === null || v === undefined
                              ? ''
                              : c.type === 'number' && typeof v === 'number' && c.key !== 'sr'
                                ? money(v)
                                : String(v);
                          return (
                            <td
                              key={c.key}
                              style={{
                                textAlign: c.type === 'number' ? 'right' : 'left',
                                whiteSpace:
                                  c.key === 'repay_by' || c.key === 'reason' ? 'normal' : 'nowrap',
                                fontWeight: strong ? 'var(--fw-semibold)' : undefined,
                              }}
                            >
                              {out}
                            </td>
                          );
                        })}
                      </tr>
                    ),
                  )}
                </tbody>
              </table>
            </div>
            {lines === 0 ? <p>Nothing to show for what is chosen.</p> : null}
            <p className="ep-field__help" style={{ marginTop: 'var(--sp-3)' }}>
              {data.note}
            </p>
          </>
        ) : null}
      </Card>
    </>
  );
}
