import {
  Badge,
  Button,
  Card,
  DataTable,
  FormRow,
  InputField,
  PageHeader,
  SelectField,
} from '@edupro/ui';
import type { ReactNode } from 'react';
import { getTranslations } from 'next-intl/server';
import { Notice } from '@/components/Notice';
import { notifyDefaulters, requestFeeReportExport } from '@/lib/actions';
import { apiFetch, getMe } from '@/lib/api';
import type { ClassRow, DatasetRows } from '@/lib/types';

type Report = 'day_book' | 'head_tally' | 'defaulters' | 'forecast' | 'tally';
type Row = Record<string, unknown>;
const DATASET: Record<Report, string> = {
  day_book: 'fee_day_book',
  head_tally: 'fee_head_tally',
  defaulters: 'fee_defaulters',
  forecast: 'fee_forecast',
  tally: 'fee_tally_vouchers',
};

const ist = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);
const money = (v: unknown) =>
  `₹${(Number(v ?? 0) || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const sum = (rows: Row[], key: string, pred: (r: Row) => boolean = () => true) =>
  rows.filter(pred).reduce((a, r) => a + Number(r[key] ?? 0), 0);

/**
 * Sprint 15: the fee reports centre. Every tab runs a dataset live (`/reports/datasets/:id/rows`) and
 * exports the same definition through the export service (CSV, Excel, PDF; Tally XML for the vouchers).
 */
export default async function FeeReportsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const report: Report = (Object.keys(DATASET) as Report[]).includes(sp.report as Report)
    ? (sp.report as Report)
    : 'day_book';
  const today = ist();
  const month = sp.month && /^\d{4}-\d{2}$/.test(sp.month) ? sp.month : today.slice(0, 7);
  const monthEnd = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)
    .toISOString()
    .slice(0, 10);
  const from = sp.from || (report === 'head_tally' ? `${month}-01` : today);
  const to = sp.to || (report === 'head_tally' ? monthEnd : today);
  const params = new URLSearchParams();
  if (report === 'day_book' || report === 'tally' || report === 'head_tally') {
    params.set('from', from);
    params.set('to', to);
    if (sp.ledger) params.set('ledger', sp.ledger);
    if (sp.mode && report === 'day_book') params.set('mode', sp.mode);
  }
  if (report === 'defaulters') {
    params.set('asOf', sp.asOf || today);
    if (sp.classId) params.set('classId', sp.classId);
    if (sp.minBalance) params.set('minBalance', sp.minBalance);
  }
  if (report === 'forecast' && sp.ledger) params.set('ledger', sp.ledger);
  const [t, r, me, data, classes] = await Promise.all([
    getTranslations('pages.fees_reports'),
    getTranslations('feeReports'),
    getMe(),
    apiFetch<DatasetRows>(`/reports/datasets/${DATASET[report]}/rows?${params.toString()}`),
    apiFetch<{ data: ClassRow[] }>('/academics/classes')
      .then((x) => x.data)
      .catch(() => [] as ClassRow[]),
  ]);
  const canExport = me.permissions.includes('reports.export.create');
  const canNotify = me.permissions.includes('fees.defaulter.notify');
  const rows = data.rows;
  const hidden = (
    <>
      <input type="hidden" name="report" value={report} />
      <input type="hidden" name="dataset" value={DATASET[report]} />
      {[...params.entries()].map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      {report === 'head_tally' ? <input type="hidden" name="month" value={month} /> : null}
    </>
  );
  const exportButtons = canExport ? (
    <form
      action={requestFeeReportExport}
      style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}
    >
      {hidden}
      {report === 'tally' ? (
        <Button type="submit" name="format" value="xml" size="sm">
          {r('exportTally')}
        </Button>
      ) : null}
      <Button type="submit" name="format" value="csv" variant="secondary" size="sm">
        {r('exportCsv')}
      </Button>
      <Button type="submit" name="format" value="xlsx" variant="secondary" size="sm">
        {r('exportXlsx')}
      </Button>
      <Button type="submit" name="format" value="pdf" variant="secondary" size="sm">
        {r('exportPdf')}
      </Button>
    </form>
  ) : null;
  const tabs: Report[] = ['day_book', 'head_tally', 'defaulters', 'forecast', 'tally'];
  const tabLabel: Record<Report, string> = {
    day_book: r('dayBook'),
    head_tally: r('headTally'),
    defaulters: r('defaulters'),
    forecast: r('forecast'),
    tally: r('tally'),
  };

  return (
    <>
      <PageHeader kicker={t('kicker')} title={t('title')} description={t('description')} />
      {sp.ok && sp.sent !== undefined ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {r('notified', {
            sent: sp.sent,
            skipped: sp.skipped ?? '0',
            noMobile: sp.noMobile ?? '0',
            failed: sp.failed ?? '0',
          })}
        </div>
      ) : sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {r('exportQueued')}
        </div>
      ) : null}
      <Notice params={{ error: sp.error, detail: sp.detail }} />
      <nav
        aria-label={t('title')}
        style={{
          display: 'flex',
          gap: 'var(--sp-2)',
          flexWrap: 'wrap',
          marginBottom: 'var(--sp-4)',
        }}
      >
        {tabs.map((k) => (
          <a
            key={k}
            className={`ep-btn ep-btn--sm ${k === report ? '' : 'ep-btn--ghost'}`}
            href={`/fees/reports?report=${k}`}
            aria-current={k === report ? 'page' : undefined}
          >
            {tabLabel[k]}
          </a>
        ))}
      </nav>

      <Card
        title={tabLabel[report]}
        actions={exportButtons}
        style={{ marginBottom: 'var(--sp-4)' }}
      >
        <form method="get" style={{ marginBottom: 'var(--sp-3)' }}>
          <input type="hidden" name="report" value={report} />
          <FormRow columns={4}>
            {report === 'head_tally' ? (
              <InputField
                id="month"
                name="month"
                label={r('month')}
                type="month"
                defaultValue={month}
              />
            ) : report === 'defaulters' ? (
              <InputField
                id="asOf"
                name="asOf"
                label={r('asOf')}
                type="date"
                defaultValue={sp.asOf || today}
              />
            ) : report !== 'forecast' ? (
              <>
                <InputField
                  id="from"
                  name="from"
                  label={r('from')}
                  type="date"
                  defaultValue={from}
                />
                <InputField id="to" name="to" label={r('to')} type="date" defaultValue={to} />
              </>
            ) : null}
            {report === 'defaulters' ? (
              <>
                <SelectField
                  id="classId"
                  name="classId"
                  label={r('class')}
                  defaultValue={sp.classId ?? ''}
                  options={[
                    { value: '', label: r('any') },
                    ...classes.map((c) => ({ value: c.id, label: c.code })),
                  ]}
                />
                <InputField
                  id="minBalance"
                  name="minBalance"
                  label={r('minBalance')}
                  type="number"
                  min={0}
                  step="1"
                  defaultValue={sp.minBalance ?? ''}
                />
              </>
            ) : (
              <SelectField
                id="ledger"
                name="ledger"
                label={r('ledger')}
                defaultValue={sp.ledger ?? ''}
                options={[
                  { value: '', label: r('any') },
                  { value: 'school', label: 'school' },
                  { value: 'hostel', label: 'hostel' },
                  { value: 'misc', label: 'misc' },
                ]}
              />
            )}
            {report === 'day_book' ? (
              <SelectField
                id="mode"
                name="mode"
                label={r('mode')}
                defaultValue={sp.mode ?? ''}
                options={[
                  { value: '', label: r('any') },
                  ...['cash', 'cheque', 'dd', 'upi', 'bank', 'card', 'online'].map((m) => ({
                    value: m,
                    label: m,
                  })),
                ]}
              />
            ) : null}
            <div style={{ display: 'flex', alignItems: 'flex-end' }}>
              <Button type="submit" variant="secondary">
                {r('show')}
              </Button>
            </div>
          </FormRow>
        </form>

        {report === 'day_book' ? <DayBook rows={rows} r={r} /> : null}
        {report === 'head_tally' ? <HeadTally rows={rows} r={r} /> : null}
        {report === 'defaulters' ? (
          <Defaulters rows={rows} r={r} canNotify={canNotify} hidden={hidden} />
        ) : null}
        {report === 'forecast' ? <Forecast rows={rows} r={r} /> : null}
        {report === 'tally' ? <TallyPreview rows={rows} r={r} /> : null}
        {data.truncated ? <p className="ep-field__help">{r('truncated')}</p> : null}
      </Card>
    </>
  );
}

type Tr = (key: string, values?: Record<string, string | number>) => string;

function DayBook({ rows, r }: { rows: Row[]; r: Tr }) {
  const counted = (x: Row) => x.status !== 'bounced';
  const modes = [...new Set(rows.filter(counted).map((x) => String(x.mode)))];
  const ledgers = [...new Set(rows.filter(counted).map((x) => String(x.ledger)))];
  const ranges = ledgers.map((l) => {
    const nos = rows
      .filter((x) => x.ledger === l && x.kind !== 'refund')
      .map((x) => String(x.receipt_no))
      .sort();
    return `${l}: ${nos[0] ?? '—'} → ${nos[nos.length - 1] ?? '—'} (${nos.length} ${r('receipts')})`;
  });
  return (
    <>
      <DataTable<Row>
        caption={`${r('dayBook')} · ${rows.length}`}
        density="dense"
        columns={[
          { key: 'd', header: r('date'), render: (x) => String(x.received_on) },
          { key: 'k', header: r('kind'), render: (x) => `${x.kind} · ${x.ledger}` },
          {
            key: 'n',
            header: r('receiptNo'),
            render: (x) => <strong>{String(x.receipt_no)}</strong>,
          },
          {
            key: 'p',
            header: r('payer'),
            render: (x) =>
              `${x.payer ?? ''}${x.admission_no ? ` · ${x.admission_no}` : ''}${x.section ? ` · ${x.section}` : ''}`,
          },
          {
            key: 'm',
            header: r('mode'),
            render: (x) =>
              `${x.mode}${x.instrument_no ? ` · ${x.instrument_no}` : ''}${x.bank_name ? ` · ${x.bank_name}` : ''}${x.reference ? ` · ${x.reference}` : ''}`,
          },
          { key: 'f', header: r('fee'), numeric: true, render: (x) => money(x.principal) },
          { key: 'l', header: r('lateFee'), numeric: true, render: (x) => money(x.late_fee) },
          {
            key: 'a',
            header: r('amount'),
            numeric: true,
            render: (x) => <strong>{money(x.amount)}</strong>,
          },
          {
            key: 's',
            header: r('status'),
            render: (x) => (
              <Badge
                tone={
                  x.status === 'bounced' ? 'danger' : x.status === 'refund' ? 'warning' : 'success'
                }
              >
                {String(x.status)}
              </Badge>
            ),
          },
          { key: 'b', header: r('receivedBy'), render: (x) => String(x.received_by ?? '') },
          { key: 'c', header: r('cleared'), render: (x) => String(x.cleared_on ?? '') },
        ]}
        rows={rows}
        rowKey={(x) => `${x.kind}-${x.receipt_no}-${x.received_on}`}
        emptyTitle={r('noRows')}
      />
      {rows.length ? (
        <div
          style={{
            display: 'grid',
            gap: 'var(--sp-4)',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            marginTop: 'var(--sp-4)',
          }}
        >
          <Card elevated title={r('totalsByMode')}>
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <tbody>
                {modes.map((m) => (
                  <tr key={m}>
                    <td>{m}</td>
                    <td style={{ textAlign: 'right' }}>
                      {money(sum(rows, 'amount', (x) => x.mode === m && counted(x)))}
                    </td>
                  </tr>
                ))}
                <tr>
                  <th>{r('grandTotal')}</th>
                  <th style={{ textAlign: 'right' }}>{money(sum(rows, 'amount', counted))}</th>
                </tr>
                <tr>
                  <td>{r('lateFee')}</td>
                  <td style={{ textAlign: 'right' }}>{money(sum(rows, 'late_fee', counted))}</td>
                </tr>
                <tr>
                  <td>{r('refunds')}</td>
                  <td style={{ textAlign: 'right' }}>
                    {money(-sum(rows, 'amount', (x) => x.kind === 'refund'))}
                  </td>
                </tr>
                <tr>
                  <td>{r('bounced')}</td>
                  <td style={{ textAlign: 'right' }}>
                    {money(sum(rows, 'amount', (x) => x.status === 'bounced'))}
                  </td>
                </tr>
              </tbody>
            </table>
          </Card>
          <Card elevated title={r('totalsByLedger')}>
            <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
              <tbody>
                {ledgers.map((l) => (
                  <tr key={l}>
                    <td>{l}</td>
                    <td style={{ textAlign: 'right' }}>
                      {money(sum(rows, 'amount', (x) => x.ledger === l && counted(x)))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="ep-kicker" style={{ marginTop: 'var(--sp-2)' }}>
              {r('range')}
            </div>
            {ranges.map((x) => (
              <div key={x} className="ep-field__help">
                {x}
              </div>
            ))}
          </Card>
        </div>
      ) : null}
    </>
  );
}

function HeadTally({ rows, r }: { rows: Row[]; r: Tr }) {
  const heads = [...new Map(rows.map((x) => [String(x.head_code), String(x.head_name)])).entries()];
  const days = [...new Set(rows.map((x) => String(x.on_date)))].sort();
  const cell = (d: string, h: string) =>
    sum(rows, 'amount', (x) => x.on_date === d && x.head_code === h);
  if (!rows.length) return <p className="ep-field__help">{r('noRows')}</p>;
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ep-table ep-table--dense" style={{ minWidth: 600 }}>
        <caption className="ep-kicker">{r('headTally')}</caption>
        <thead>
          <tr>
            <th>{r('date')}</th>
            {heads.map(([code, name]) => (
              <th key={code} style={{ textAlign: 'right' }} title={name}>
                {code}
              </th>
            ))}
            <th style={{ textAlign: 'right' }}>{r('total')}</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d}>
              <td>{d}</td>
              {heads.map(([code]) => (
                <td key={code} style={{ textAlign: 'right' }}>
                  {cell(d, code) ? money(cell(d, code)) : ''}
                </td>
              ))}
              <td style={{ textAlign: 'right' }}>
                <strong>{money(sum(rows, 'amount', (x) => x.on_date === d))}</strong>
              </td>
            </tr>
          ))}
          <tr>
            <th>{r('total')}</th>
            {heads.map(([code]) => (
              <th key={code} style={{ textAlign: 'right' }}>
                {money(sum(rows, 'amount', (x) => x.head_code === code))}
              </th>
            ))}
            <th style={{ textAlign: 'right' }}>{money(sum(rows, 'amount'))}</th>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function Defaulters({
  rows,
  r,
  canNotify,
  hidden,
}: {
  rows: Row[];
  r: Tr;
  canNotify: boolean;
  hidden: ReactNode;
}) {
  if (!rows.length) return <p className="ep-field__help">{r('noRows')}</p>;
  return (
    <form action={notifyDefaulters}>
      {hidden}
      <table className="ep-table ep-table--dense" style={{ width: '100%' }}>
        <caption className="ep-kicker">
          {r('defaulters')} · {rows.length} · {money(sum(rows, 'balance'))}
        </caption>
        <thead>
          <tr>
            {canNotify ? <th /> : null}
            <th>{r('student')}</th>
            <th>{r('section')}</th>
            <th>{r('oldestDue')}</th>
            <th style={{ textAlign: 'right' }}>{r('daysOverdue')}</th>
            <th style={{ textAlign: 'right' }}>{r('balance')}</th>
            <th>{r('guardianMobile')}</th>
            <th>{r('lastReminded')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={String(x.student_id)}>
              {canNotify ? (
                <td>
                  <input
                    type="checkbox"
                    name="studentId"
                    value={String(x.student_id)}
                    aria-label={`${r('notify')} · ${x.student}`}
                    defaultChecked={!!x.guardian_mobile && !x.last_reminded_on}
                  />
                </td>
              ) : null}
              <td>
                <a href={`/fees/ledger/${x.student_id}`}>{String(x.student)}</a>
                <div className="ep-kicker">{String(x.admission_no)}</div>
              </td>
              <td>{String(x.section ?? '')}</td>
              <td>{String(x.oldest_due)}</td>
              <td style={{ textAlign: 'right' }}>{String(x.days_overdue)}</td>
              <td style={{ textAlign: 'right' }}>
                <strong>{money(x.balance)}</strong>
              </td>
              <td>{String(x.guardian_mobile ?? '—')}</td>
              <td>{x.last_reminded_on ? String(x.last_reminded_on) : r('never')}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {canNotify ? (
        <div
          style={{
            display: 'flex',
            gap: 'var(--sp-3)',
            alignItems: 'flex-end',
            marginTop: 'var(--sp-3)',
            flexWrap: 'wrap',
          }}
        >
          <SelectField
            id="channel"
            name="channel"
            label={r('channel')}
            options={[
              { value: 'whatsapp', label: r('whatsapp') },
              { value: 'sms', label: r('sms') },
            ]}
          />
          <Button type="submit">{r('notify')}</Button>
        </div>
      ) : null}
    </form>
  );
}

function Forecast({ rows, r }: { rows: Row[]; r: Tr }) {
  if (!rows.length) return <p className="ep-field__help">{r('noRows')}</p>;
  const months = [...new Set(rows.map((x) => String(x.month)))].sort();
  const classes = [...new Set(rows.map((x) => String(x.class_code ?? '—')))];
  const at = (m: string, k: string, key: string) =>
    sum(rows, key, (x) => x.month === m && String(x.class_code ?? '—') === k);
  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="ep-table ep-table--dense" style={{ minWidth: 640 }}>
        <caption className="ep-kicker">
          {r('forecast')} · {r('expected')} {money(sum(rows, 'expected'))} · {r('collected')}{' '}
          {money(sum(rows, 'collected'))}
        </caption>
        <thead>
          <tr>
            <th>{r('month')}</th>
            {classes.map((k) => (
              <th key={k} style={{ textAlign: 'right' }}>
                {k}
              </th>
            ))}
            <th style={{ textAlign: 'right' }}>{r('monthTotal')}</th>
          </tr>
        </thead>
        <tbody>
          {months.map((m) => (
            <tr key={m}>
              <td>{m}</td>
              {classes.map((k) => (
                <td key={k} style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  {at(m, k, 'expected') ? (
                    <>
                      {money(at(m, k, 'collected'))}
                      <div className="ep-kicker">/ {money(at(m, k, 'expected'))}</div>
                    </>
                  ) : (
                    ''
                  )}
                </td>
              ))}
              <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                <strong>{money(sum(rows, 'collected', (x) => x.month === m))}</strong>
                <div className="ep-kicker">
                  / {money(sum(rows, 'expected', (x) => x.month === m))}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="ep-field__help">
        {r('collected')} / {r('expected')}; {r('balance')}: {money(sum(rows, 'balance'))}
      </p>
    </div>
  );
}

function TallyPreview({ rows, r }: { rows: Row[]; r: Tr }) {
  return (
    <>
      <p className="ep-field__help">{r('tallyHelp')}</p>
      <DataTable<Row>
        caption={`${r('tally')} · ${rows.length}`}
        density="dense"
        columns={[
          { key: 'd', header: r('date'), render: (x) => String(x.date) },
          { key: 'v', header: r('receiptNo'), render: (x) => String(x.voucher_no) },
          { key: 'p', header: r('payer'), render: (x) => String(x.party) },
          { key: 'l', header: r('head'), render: (x) => String(x.ledger_name) },
          { key: 'a', header: r('amount'), numeric: true, render: (x) => money(x.amount) },
          {
            key: 'm',
            header: r('mode'),
            render: (x) => `${x.mode}${x.instrument_no ? ` · ${x.instrument_no}` : ''}`,
          },
        ]}
        rows={rows}
        rowKey={(x) => `${x.voucher_no}-${x.ledger_name}`}
        emptyTitle={r('noRows')}
      />
    </>
  );
}
