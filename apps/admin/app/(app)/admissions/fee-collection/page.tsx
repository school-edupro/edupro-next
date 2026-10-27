import { Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { Notice } from '@/components/Notice';
import { dmy, rupees } from '@/lib/admission-desk';
import { apiFetch, getMe } from '@/lib/api';
import type { AdmissionCycle } from '@/lib/types';

interface Row {
  on_date: string;
  kind: string;
  receipt_no: string;
  registration_no: string | null;
  admission_no: string | null;
  candidate: string | null;
  class_name: string;
  category: string | null;
  session: string;
  mode: string | null;
  reference: string | null;
  amount: number | string;
  status: string;
  received_by: string | null;
}

const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * Admission fee collection (docs/design/39, part 7): registration and admission fees received, with the
 * refunds paid, by date, session, class, fee and mode; totals by fee, mode and class; Excel or PDF. The
 * same receipts show in Fees → Day book (ledger "admission"), head-wise tally, mode summary and Tally.
 */
export default async function AdmissionFeeCollectionPage({
  searchParams,
}: {
  searchParams: Promise<{
    from?: string;
    to?: string;
    cycleId?: string;
    kind?: string;
    mode?: string;
    ok?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  // the admission office, and Accounts who take these fees at the counter (docs/design/52)
  if (
    !me.permissions.includes('admissions.application.view') &&
    !me.permissions.includes('fees.ledger.view')
  )
    notFound();
  const from = /^\d{4}-\d{2}-\d{2}$/.test(sp.from ?? '') ? sp.from! : `${today().slice(0, 8)}01`;
  const to = /^\d{4}-\d{2}-\d{2}$/.test(sp.to ?? '') ? sp.to! : today();
  const params = new URLSearchParams({ from, to });
  if (sp.cycleId && /^\d{1,18}$/.test(sp.cycleId)) params.set('cycleId', sp.cycleId);
  if (sp.kind && ['Registration fee', 'Admission fee', 'Refund'].includes(sp.kind))
    params.set('kind', sp.kind);
  if (sp.mode && /^[a-z_]{2,20}$/.test(sp.mode)) params.set('mode', sp.mode);
  const [cycles, data] = await Promise.all([
    apiFetch<{ data: AdmissionCycle[] }>('/admissions/cycles')
      .then((r) => r.data)
      .catch(() => [] as AdmissionCycle[]),
    apiFetch<{ rows: Row[]; truncated: boolean }>(
      `/reports/datasets/admission_fee_collection/rows?${params.toString()}&limit=5000`,
    ),
  ]);
  const rows = data.rows.map((r) => ({ ...r, amount: Number(r.amount) }));
  const sum = (list: typeof rows) => list.reduce((t, r) => t + r.amount, 0);
  const groups = (key: 'kind' | 'mode' | 'class_name') =>
    [...new Set(rows.map((r) => String(r[key] ?? '-')))]
      .sort()
      .map((v) => [v, sum(rows.filter((r) => String(r[key] ?? '-') === v))] as const);
  const reg = sum(rows.filter((r) => r.kind === 'Registration fee'));
  const adm = sum(rows.filter((r) => r.kind === 'Admission fee'));
  const ref = sum(rows.filter((r) => r.kind === 'Refund'));
  const canExport = me.permissions.includes('reports.export.create');
  const file = (format: 'xlsx' | 'pdf') =>
    `/api/reports/instant?dataset=admission_fee_collection&format=${format}&${params.toString()}`;
  return (
    <>
      <PageHeader
        kicker="Admissions"
        title="Admission fee collection"
        description="Registration and admission fees received, and admission fee refunds paid. The same receipts are in Fees → Day book under the admission ledger, the head-wise tally, the mode summary and the Tally export."
        actions={
          canExport ? (
            <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('xlsx')}>
                Excel
              </a>
              <a className="ep-btn ep-btn--secondary ep-btn--sm" href={file('pdf')}>
                PDF
              </a>
            </span>
          ) : undefined
        }
      />
      <Notice params={sp} />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form
          method="get"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 170px), 1fr))',
            gap: 'var(--sp-3)',
            alignItems: 'end',
          }}
        >
          <label className="ep-field">
            <span className="ep-field__label">From</span>
            <input className="ep-input" type="date" name="from" defaultValue={from} />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">To</span>
            <input className="ep-input" type="date" name="to" defaultValue={to} />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Session</span>
            <select className="ep-select" name="cycleId" defaultValue={sp.cycleId ?? ''}>
              <option value="">All sessions</option>
              {cycles.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Fee</span>
            <select className="ep-select" name="kind" defaultValue={sp.kind ?? ''}>
              <option value="">Both fees and refunds</option>
              <option value="Registration fee">Registration fee</option>
              <option value="Admission fee">Admission fee</option>
              <option value="Refund">Refunds</option>
            </select>
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Mode</span>
            <select className="ep-select" name="mode" defaultValue={sp.mode ?? ''}>
              <option value="">Every mode</option>
              {['cash', 'upi', 'card', 'cheque', 'dd', 'bank', 'online'].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <div>
            <button className="ep-btn ep-btn--primary" type="submit">
              Show
            </button>
          </div>
        </form>
      </Card>
      <div className="ep-dash-kpis ep-dash-kpis--4" style={{ marginBottom: 'var(--sp-4)' }}>
        <Card title="Registration fees">
          <div className="ep-cdash__big">{rupees(reg)}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {rows.filter((r) => r.kind === 'Registration fee').length} receipts
          </p>
        </Card>
        <Card title="Admission fees">
          <div className="ep-cdash__big">{rupees(adm)}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {rows.filter((r) => r.kind === 'Admission fee').length} receipts
          </p>
        </Card>
        <Card title="Refunds paid">
          <div className="ep-cdash__big">{rupees(-ref)}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {rows.filter((r) => r.kind === 'Refund').length} refunds
          </p>
        </Card>
        <Card title="Net">
          <div className="ep-cdash__big">{rupees(reg + adm + ref)}</div>
          <p className="ep-field__help" style={{ margin: 0 }}>
            {dmy(from)} to {dmy(to)}
          </p>
        </Card>
      </div>
      <Card elevated title="Receipts and refunds" style={{ marginBottom: 'var(--sp-4)' }}>
        {rows.length === 0 ? (
          <p style={{ margin: 0 }}>Nothing in these dates.</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">Admission fee receipts and refunds</caption>
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Fee</th>
                  <th scope="col">Receipt no.</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Class</th>
                  <th scope="col">Category</th>
                  <th scope="col">Mode</th>
                  <th scope="col">Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={`${r.receipt_no}-${String(i)}`}>
                    <td>{dmy(r.on_date)}</td>
                    <td>{r.kind}</td>
                    <td>
                      {r.receipt_no}
                      {r.status !== 'posted' && r.status !== 'refund' ? (
                        <div className="ep-kicker">{r.status}</div>
                      ) : null}
                    </td>
                    <td>
                      {r.candidate ?? '-'}
                      <div className="ep-kicker">{r.admission_no ?? r.registration_no ?? ''}</div>
                    </td>
                    <td>{r.class_name}</td>
                    <td>{r.category ?? '-'}</td>
                    <td>
                      {r.mode ?? '-'}
                      {r.reference ? <div className="ep-kicker">{r.reference}</div> : null}
                    </td>
                    <td>{rupees(r.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data.truncated ? (
          <p className="ep-field__help">Only the first 5,000 lines show: download Excel for all.</p>
        ) : null}
      </Card>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 280px), 1fr))',
          gap: 'var(--sp-4)',
        }}
      >
        {(
          [
            ['By mode', groups('mode')],
            ['By class', groups('class_name')],
          ] as const
        ).map(([title, list]) => (
          <Card key={title} title={title}>
            <div className="ep-table-wrap">
              <table className="ep-table ep-table--dense">
                <caption className="ep-sr-only">{title}</caption>
                <tbody>
                  {list.map(([k, v]) => (
                    <tr key={k}>
                      <th scope="row">{k}</th>
                      <td>{rupees(v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
