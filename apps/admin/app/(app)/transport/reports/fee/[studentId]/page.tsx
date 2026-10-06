import { Badge, Card, PageHeader } from '@edupro/ui';
import { TransportNav } from '@/components/transport/TransportNav';
import { apiFetch, getMe } from '@/lib/api';

interface StudentFee {
  student: {
    id: string;
    admissionNo: string | null;
    name: string;
    section: string | null;
    route: string | null;
    stop: string | null;
    service: string | null;
    mobile: string | null;
  };
  months: Array<{
    month: string;
    route: string | null;
    dueOn: string | null;
    amount: number;
    paid: number;
    balance: number;
    status: string;
    receipts: Array<{
      receiptNo: string | null;
      date: string;
      amount: number;
      mode: string | null;
    }>;
  }>;
  totals: { amount: number; paid: number; balance: number };
}
const money = (n: number) => `₹${n.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
const day = (d: string | null) =>
  d
    ? new Date(`${d}T00:00:00Z`).toLocaleDateString('en-IN', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        timeZone: 'UTC',
      })
    : '–';
const monthLabel = (m: string) =>
  new Date(`${m}-01T00:00:00Z`).toLocaleDateString('en-IN', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

/**
 * One pupil's transport fee, month by month, with the receipts. The transport in-charge sees this and
 * nothing of the other fee heads; it cannot be changed here (the fee desk collects and adjusts).
 */
export default async function TransportStudentFeePage({
  params,
}: {
  params: Promise<{ studentId: string }>;
}) {
  const { studentId } = await params;
  const [me, f] = await Promise.all([
    getMe(),
    apiFetch<StudentFee>(`/transport/reports/fee/student/${encodeURIComponent(studentId)}`),
  ]);
  const s = f.student;
  return (
    <>
      <PageHeader
        kicker="Transport fee"
        title={s.name}
        description={[s.admissionNo, s.section, s.route, s.stop, s.service]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <a
            className="ep-btn ep-btn--secondary ep-btn--sm"
            href="/transport/reports?r=fee-students"
          >
            Back to the list
          </a>
        }
      />
      <TransportNav current="/transport/reports" permissions={me.permissions} />
      <div className="ep-cdash__kpis" style={{ marginBottom: 'var(--sp-4)' }}>
        {(
          [
            ['Transport fee of the session', f.totals.amount],
            ['Paid', f.totals.paid],
            ['Balance', f.totals.balance],
          ] as Array<[string, number]>
        ).map(([label, n]) => (
          <Card key={label} title={label}>
            <div className="ep-cdash__big">
              <span className="ep-cdash__num">{money(n)}</span>
            </div>
          </Card>
        ))}
      </div>
      <Card title="Month by month">
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          Only the transport fee shows here. Collection, discounts and refunds are with the fee
          desk.
          {s.mobile ? ` Parent’s mobile: ${s.mobile}.` : ''}
        </p>
        {f.months.length === 0 ? (
          <p className="ep-field__help" style={{ margin: 0 }}>
            No transport fee is billed to this student in this session.
          </p>
        ) : (
          <div className="ep-table-wrap" tabIndex={0} role="region" aria-label="Transport fee">
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Transport fee month by month</caption>
              <thead>
                <tr>
                  <th scope="col">Month</th>
                  <th scope="col">Route</th>
                  <th scope="col">Due on</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Fee
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Paid
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Balance
                  </th>
                  <th scope="col">Status</th>
                  <th scope="col">Receipts</th>
                </tr>
              </thead>
              <tbody>
                {f.months.map((m) => (
                  <tr key={m.month}>
                    <th scope="row">{monthLabel(m.month)}</th>
                    <td>{m.route ?? '–'}</td>
                    <td>{day(m.dueOn)}</td>
                    <td style={{ textAlign: 'right' }}>{money(m.amount)}</td>
                    <td style={{ textAlign: 'right' }}>{money(m.paid)}</td>
                    <td style={{ textAlign: 'right' }}>{money(m.balance)}</td>
                    <td>
                      <Badge tone={m.balance <= 0 ? 'success' : m.paid > 0 ? 'warning' : 'neutral'}>
                        {m.balance <= 0 ? 'Paid' : m.paid > 0 ? 'Part paid' : 'Due'}
                      </Badge>
                    </td>
                    <td>
                      {m.receipts.length
                        ? m.receipts.map((r, i) => (
                            <div key={i}>
                              {r.receiptNo ?? 'Receipt'} · {day(r.date)} · {money(r.amount)}
                              {r.mode ? ` · ${r.mode}` : ''}
                            </div>
                          ))
                        : '–'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
