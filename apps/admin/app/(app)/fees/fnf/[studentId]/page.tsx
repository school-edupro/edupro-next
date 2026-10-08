import { Button, SelectField } from '@edupro/ui';
import { PrintButton } from '@/components/PrintButton';
import { PupilMeta, SheetHead, dmy, rupees } from '@/components/fees/sheets';
import { apiFetch } from '@/lib/api';
import type { FeePeriod } from '@/lib/types';

interface Fnf {
  school: { name: string; address: string };
  year: string;
  billDate: string;
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
  };
  lastMonth: { sequence: number; name: string };
  dues: Array<{ head: string; period: string; balance: string }>;
  lateFee: string;
  paidAhead: Array<{ head: string; period: string; paid: string }>;
  refundable: Array<{ head: string; paid: string }>;
  advance: string;
  notCharged: string;
  totals: {
    payable: string;
    refundable: string;
    net: string;
    netWords: string;
    direction: 'pay' | 'refund' | 'nil';
  };
}

/** The provisional bill of a pupil who is leaving: what is payable and what comes back. Nothing is posted. */
export default async function FnfPage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ lastSeq?: string }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const [bill, periods] = await Promise.all([
    apiFetch<Fnf>(`/fees/students/${studentId}/fnf${sp.lastSeq ? `?lastSeq=${sp.lastSeq}` : ''}`),
    apiFetch<{ data: FeePeriod[] }>('/fees/periods').then((r) => r.data),
  ]);
  const t = bill.totals;
  return (
    <>
      <form
        method="get"
        className="ep-noprint"
        style={{
          display: 'flex',
          gap: 'var(--sp-3)',
          alignItems: 'flex-end',
          marginBottom: 'var(--sp-4)',
          flexWrap: 'wrap',
        }}
      >
        <a className="ep-btn ep-btn--ghost" href={`/fees/ledger/${studentId}`}>
          Back to ledger
        </a>
        <SelectField
          id="lastSeq"
          name="lastSeq"
          label="Charge fee up to"
          defaultValue={String(bill.lastMonth.sequence)}
          options={periods.map((p) => ({ value: String(p.sequence), label: p.name }))}
        />
        <Button type="submit" variant="secondary">
          Work out
        </Button>
        <PrintButton label="Print provisional bill" />
      </form>
      <section className="ep-print-sheet" aria-label="Provisional bill for withdrawal">
        <SheetHead school={bill.school} title="Provisional bill for withdrawal (full and final)" />
        <PupilMeta
          student={bill.student}
          extra={[
            ['Session', bill.year],
            ['Fee charged up to', bill.lastMonth.name],
            ['Bill date', dmy(bill.billDate)],
          ]}
        />
        <table className="ep-table ep-table--dense">
          <caption className="ep-sr-only">Payable by the parent</caption>
          <thead>
            <tr>
              <th scope="col">A. Payable by the parent</th>
              <th scope="col">Month</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {bill.dues.map((d, i) => (
              <tr key={i}>
                <td>{d.head}</td>
                <td>{d.period}</td>
                <td style={{ textAlign: 'right' }}>{rupees(d.balance)}</td>
              </tr>
            ))}
            {Number(bill.lateFee) > 0 ? (
              <tr>
                <td>Late fee</td>
                <td />
                <td style={{ textAlign: 'right' }}>{rupees(bill.lateFee)}</td>
              </tr>
            ) : null}
            {bill.dues.length === 0 && Number(bill.lateFee) === 0 ? (
              <tr>
                <td colSpan={3}>Nothing is due.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Total payable (A)
              </th>
              <th style={{ textAlign: 'right' }}>{rupees(t.payable)}</th>
            </tr>
          </tfoot>
        </table>
        <table className="ep-table ep-table--dense" style={{ marginTop: 'var(--sp-4)' }}>
          <caption className="ep-sr-only">Refundable by the school</caption>
          <thead>
            <tr>
              <th scope="col">B. Refundable by the school</th>
              <th scope="col">Month</th>
              <th scope="col" style={{ textAlign: 'right' }}>
                Amount (₹)
              </th>
            </tr>
          </thead>
          <tbody>
            {bill.paidAhead.map((d, i) => (
              <tr key={`a${i}`}>
                <td>{d.head} (paid in advance)</td>
                <td>{d.period}</td>
                <td style={{ textAlign: 'right' }}>{rupees(d.paid)}</td>
              </tr>
            ))}
            {bill.refundable.map((d, i) => (
              <tr key={`r${i}`}>
                <td>{d.head} (refundable)</td>
                <td />
                <td style={{ textAlign: 'right' }}>{rupees(d.paid)}</td>
              </tr>
            ))}
            {Number(bill.advance) > 0 ? (
              <tr>
                <td>Excess paid (advance)</td>
                <td />
                <td style={{ textAlign: 'right' }}>{rupees(bill.advance)}</td>
              </tr>
            ) : null}
            {Number(t.refundable) === 0 ? (
              <tr>
                <td colSpan={3}>Nothing is refundable.</td>
              </tr>
            ) : null}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row" colSpan={2}>
                Total refundable (B)
              </th>
              <th style={{ textAlign: 'right' }}>{rupees(t.refundable)}</th>
            </tr>
          </tfoot>
        </table>
        <p style={{ marginTop: 'var(--sp-4)' }}>
          <strong>
            {t.direction === 'pay'
              ? `Net payable by the parent: ₹${rupees(t.net)}`
              : t.direction === 'refund'
                ? `Net refundable by the school: ₹${rupees(t.net)}`
                : 'Nothing is payable or refundable.'}
          </strong>
          {t.direction !== 'nil' ? ` (${t.netWords})` : ''}
        </p>
        <p className="ep-field__help">
          Provisional: fee of the months after {bill.lastMonth.name} (₹{rupees(bill.notCharged)}) is
          not charged. The final amount is settled by a receipt or a refund in the accounts office
          and may change with the date of settlement.
        </p>
        <div className="ep-print-sheet__sign">
          <span>Parent’s signature</span>
          <span>Accounts officer</span>
          <span>Principal</span>
        </div>
      </section>
    </>
  );
}
