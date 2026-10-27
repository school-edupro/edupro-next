import { Badge, Card, PageHeader } from '@edupro/ui';
import { notFound } from 'next/navigation';
import { FileLinks } from '@/components/FileLinks';
import { AdmissionCounterCollect } from '@/components/fees/AdmissionCounterCollect';
import { CashierTabs } from '@/components/fees/CashierTabs';
import { rupees } from '@/lib/admission-desk';
import { apiFetch, getMe } from '@/lib/api';

interface Found {
  id: string;
  number: string | null;
  admissionNo: string | null;
  status: string;
  candidate: string | null;
  className: string;
  session: string;
  category: string | null;
  parent: string | null;
  mobile: string | null;
  due: {
    kind: 'registration' | 'admission';
    head: string;
    amount: number;
    note: string | null;
    lapsed: boolean;
  } | null;
  receipts: Array<{
    id: string;
    receiptNo: string;
    amount: number;
    date: string;
    head: string;
    mode: string;
    status: string;
  }>;
}
interface Today {
  total: number;
  data: Array<{
    id: string;
    registrationId: string;
    receiptNo: string;
    amount: number;
    head: string;
    mode: string;
    candidate: string | null;
    number: string | null;
    status: string;
  }>;
}

const MODE: Record<string, string> = {
  cash: 'Cash',
  upi: 'UPI',
  card: 'Card',
  cheque: 'Cheque',
  dd: 'Demand draft',
  bank: 'Bank transfer',
  online: 'Online',
};

/**
 * Fees → Cashier, Admission fees (docs/design/52, part 3): Accounts find a registration by number, name
 * or parent mobile / email and take the registration or admission fee in full, with the receipt. Only
 * the fee essentials show; the Admissions module is not needed.
 */
export default async function AdmissionCounterPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; due?: string }>;
}) {
  const sp = await searchParams;
  const me = await getMe();
  const can = (p: string) => me.permissions.includes(p);
  if (!can('admissions.fee.collect')) notFound();
  const q = (sp.q ?? '').trim().slice(0, 80);
  const due = sp.due === '0' ? '0' : '1';
  const [found, today] = await Promise.all([
    apiFetch<{ data: Found[] }>(
      `/fees/admission-counter?${new URLSearchParams({ q, due }).toString()}`,
    ).then((r) => r.data),
    apiFetch<Today>('/fees/admission-counter/today'),
  ]);
  return (
    <>
      <PageHeader
        kicker="Fees"
        title="Cashier: admission fees"
        description="Registration and admission fees paid at the school: find the registration, take the fee in full and print the receipt."
      />
      <CashierTabs current="admission" pupils={can('fees.receipt.post')} admission />
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <form method="get" className="ep-lead-filter">
          <label className="ep-field">
            <span className="ep-field__label">Registration / admission no., name or mobile</span>
            <input
              className="ep-input"
              name="q"
              defaultValue={q}
              maxLength={80}
              placeholder="e.g. 00012, Aarav or 98765"
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">Show</span>
            <select className="ep-select" name="due" defaultValue={due}>
              <option value="1">Fee due only</option>
              <option value="0">Any registration</option>
            </select>
          </label>
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <button className="ep-btn ep-btn--primary" type="submit">
              Search
            </button>
            {q || due === '0' ? (
              <a className="ep-btn ep-btn--ghost" href="/fees/cashier/admission">
                Clear
              </a>
            ) : null}
          </span>
        </form>
      </Card>
      <Card style={{ marginBottom: 'var(--sp-4)' }}>
        <p className="ep-field__help" style={{ marginTop: 0 }}>
          {found.length === 0
            ? q
              ? `No registration found for “${q}”${due === '1' ? ' with a fee due' : ''}.`
              : 'No registration has a fee due now.'
            : `${String(found.length)} registration${found.length === 1 ? '' : 's'}${due === '1' ? ' with a fee due' : ''}${found.length === 50 ? ' (the latest 50; search to narrow)' : ''}.`}
        </p>
        {found.length ? (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Registrations (scrolls sideways)"
          >
            <table className="ep-table">
              <caption className="ep-sr-only">Registrations at the counter</caption>
              <thead>
                <tr>
                  <th scope="col">Candidate</th>
                  <th scope="col">Number</th>
                  <th scope="col">Class</th>
                  <th scope="col">Fee category</th>
                  <th scope="col">Fee due</th>
                  <th scope="col">Receipts</th>
                </tr>
              </thead>
              <tbody>
                {found.map((r) => (
                  <tr key={r.id}>
                    <td>
                      <strong>{r.candidate ?? '-'}</strong>
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {[r.parent, r.mobile].filter(Boolean).join(' · ')}
                      </div>
                    </td>
                    <td>
                      {r.admissionNo ?? r.number ?? 'Not yet given'}
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {r.status}
                      </div>
                    </td>
                    <td>
                      {r.className}
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {r.session}
                      </div>
                    </td>
                    <td>{r.category ?? 'General'}</td>
                    <td>
                      {r.due ? (
                        <>
                          {r.due.head}: <strong>{rupees(r.due.amount)}</strong>
                          {r.due.note ? (
                            <div className="ep-field__help" style={{ margin: 0 }}>
                              {r.due.note}
                            </div>
                          ) : null}
                          {r.due.lapsed ? (
                            <Badge tone="danger">Offer lapsed</Badge>
                          ) : (
                            <AdmissionCounterCollect
                              id={r.id}
                              kind={r.due.kind}
                              head={r.due.head}
                              amount={r.due.amount}
                              candidate={r.candidate ?? 'this registration'}
                            />
                          )}
                        </>
                      ) : (
                        <span className="ep-field__help">Nothing due</span>
                      )}
                    </td>
                    <td>
                      {r.receipts.length ? (
                        <ul className="ep-afc__receipts">
                          {r.receipts.map((m) => (
                            <li key={m.id}>
                              <span>
                                {m.receiptNo} · {rupees(m.amount)}
                                {m.status !== 'posted' ? ' (reversed)' : ''}
                              </span>
                              <FileLinks
                                href={`/api/admission-counter/${r.id}/receipts/${m.id}`}
                                label={`Receipt ${m.receiptNo}`}
                              />
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <span className="ep-field__help">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>
      <Card title={`Taken by you today: ${rupees(today.total)}`}>
        {today.data.length === 0 ? (
          <p style={{ margin: 0 }}>No admission fee taken by you today.</p>
        ) : (
          <div
            className="ep-table-wrap"
            tabIndex={0}
            role="region"
            aria-label="Today's admission receipts (scrolls sideways)"
          >
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Admission receipts taken by you today</caption>
              <thead>
                <tr>
                  <th scope="col">Receipt</th>
                  <th scope="col">Candidate</th>
                  <th scope="col">Fee</th>
                  <th scope="col">Mode</th>
                  <th scope="col" className="ep-num">
                    Amount
                  </th>
                  <th scope="col">File</th>
                </tr>
              </thead>
              <tbody>
                {today.data.map((x) => (
                  <tr key={x.id}>
                    <td>
                      {x.receiptNo}
                      {x.status !== 'posted' ? ' (reversed)' : ''}
                    </td>
                    <td>
                      {x.candidate ?? '-'}
                      <div className="ep-field__help" style={{ margin: 0 }}>
                        {x.number ?? ''}
                      </div>
                    </td>
                    <td>{x.head}</td>
                    <td>{MODE[x.mode] ?? x.mode}</td>
                    <td className="ep-num">{rupees(x.amount)}</td>
                    <td>
                      <FileLinks
                        href={`/api/admission-counter/${x.registrationId}/receipts/${x.id}`}
                        label={`Receipt ${x.receiptNo}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {can('fees.ledger.view') ? (
          <p className="ep-field__help" style={{ marginBottom: 0 }}>
            Every admission receipt by date, fee and mode:{' '}
            <a href="/admissions/fee-collection">Admission fee collection</a>.
          </p>
        ) : null}
      </Card>
    </>
  );
}
