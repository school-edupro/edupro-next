import { Button, InputField, PageHeader } from '@edupro/ui';
import { PrintButton } from '@/components/PrintButton';
import { PupilMeta, SheetHead, dmy, rupees } from '@/components/fees/sheets';
import { ApiError, apiFetch } from '@/lib/api';

interface Bill {
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
  instalments: Array<{
    label: string;
    dueOn: string;
    challanOn: string | null;
    ledger: string;
    lines: Array<{ head: string; fee: string; discount: string; paid: string; balance: string }>;
    balance: string;
    lateFee: string;
  }>;
  totals: { fee: string; lateFee: string; payable: string; payableWords: string };
}

const today = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

/** Fee bills for print: one pupil, or every pupil of a class who owes something up to a date. */
export default async function FeeBillsPage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; studentId?: string; upTo?: string; view?: string }>;
}) {
  const sp = await searchParams;
  const upTo = sp.upTo && /^\d{4}-\d{2}-\d{2}$/.test(sp.upTo) ? sp.upTo : today();
  const parentView = sp.view === 'parent' && Boolean(sp.studentId);
  let bills: Bill[] = [];
  let problem: string | null = null;
  try {
    // the parent's view: only the instalments the school has opened to the family, as in the parent app
    if (sp.studentId)
      bills = [
        await apiFetch<Bill>(
          `/fees/students/${sp.studentId}/bill${parentView ? '' : `?upTo=${upTo}`}`,
        ),
      ];
    else if (sp.classId)
      bills = (await apiFetch<{ data: Bill[] }>(`/fees/bills?classId=${sp.classId}&upTo=${upTo}`))
        .data;
  } catch (error) {
    problem =
      error instanceof ApiError && typeof error.problem.detail === 'string'
        ? error.problem.detail
        : 'The bills could not be made.';
  }
  const asked = Boolean(sp.studentId || sp.classId);
  return (
    <>
      <div className="ep-noprint">
        <PageHeader
          kicker="Fees"
          title="Fee bills for print"
          description="What is payable up to the date, head by head, with the late fee. Pupils who owe nothing are left out. Bills are opened from Fees → Demands (a class) or from a pupil’s ledger."
        />
        <form
          method="get"
          style={{ display: 'flex', gap: 'var(--sp-3)', alignItems: 'flex-end', flexWrap: 'wrap' }}
        >
          <a
            className="ep-btn ep-btn--ghost"
            href={
              sp.studentId
                ? `/fees/ledger/${sp.studentId}`
                : `/fees/demands${sp.classId ? `?classId=${sp.classId}` : ''}`
            }
          >
            Back
          </a>
          {sp.classId ? <input type="hidden" name="classId" value={sp.classId} /> : null}
          {sp.studentId ? <input type="hidden" name="studentId" value={sp.studentId} /> : null}
          {!parentView ? (
            <>
              <InputField
                id="upTo"
                name="upTo"
                label="Dues up to"
                type="date"
                defaultValue={upTo}
              />
              <Button type="submit" variant="secondary">
                Show
              </Button>
            </>
          ) : null}
          {bills.some((b) => b.instalments.length > 0) ? (
            <PrintButton
              label={`Print ${bills.filter((b) => b.instalments.length > 0).length} bill(s)`}
            />
          ) : null}
        </form>
        {problem ? (
          <p className="ep-alert ep-alert--danger" role="alert">
            {problem}
          </p>
        ) : null}
        {!asked ? (
          <p className="ep-field__help">
            Open Fees → Demands, choose a class and press “Print fee bills”.
          </p>
        ) : null}
        {parentView ? (
          <p className="ep-field__help">
            Parent’s view: the instalments the school has opened to the family, head by head, as the
            parent app shows them today. Receipts are on the pupil’s ledger.
          </p>
        ) : null}
        {asked && !problem && bills.every((b) => b.instalments.length === 0) ? (
          <p className="ep-field__help">
            {parentView
              ? 'Nothing is payable for the parent today.'
              : `Nothing is payable up to ${dmy(upTo)}.`}
          </p>
        ) : null}
      </div>
      {bills
        .filter((b) => b.instalments.length > 0)
        .map((b) => (
          <section
            key={b.student.id}
            className="ep-print-sheet"
            aria-label={`Fee bill of ${b.student.name}`}
            style={{ marginTop: 'var(--sp-5)' }}
          >
            <SheetHead school={b.school} title={`Fee bill · Session ${b.year}`} />
            <PupilMeta student={b.student} extra={[['Bill date', dmy(b.billDate)]]} />
            <table className="ep-table ep-table--dense">
              <caption className="ep-sr-only">Fee payable by {b.student.name}</caption>
              <thead>
                <tr>
                  <th scope="col">Instalment</th>
                  <th scope="col">Last date</th>
                  <th scope="col">Particulars</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Fee
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Discount
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Paid
                  </th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Payable (₹)
                  </th>
                </tr>
              </thead>
              <tbody>
                {b.instalments.flatMap((i) => [
                  ...i.lines.map((l, n) => (
                    <tr key={`${i.dueOn}-${i.ledger}-${l.head}`}>
                      <td>
                        {n === 0 ? `${i.label}${i.ledger === 'hostel' ? ' (hostel)' : ''}` : ''}
                      </td>
                      <td>
                        {n === 0 ? dmy(i.dueOn) : ''}
                        {n === 0 && i.challanOn ? (
                          <div className="ep-field__help">Challan: {dmy(i.challanOn)}</div>
                        ) : null}
                      </td>
                      <td>{l.head}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(l.fee)}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(l.discount)}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(l.paid)}</td>
                      <td style={{ textAlign: 'right' }}>{rupees(l.balance)}</td>
                    </tr>
                  )),
                  Number(i.lateFee) > 0 ? (
                    <tr key={`${i.dueOn}-${i.ledger}-late`}>
                      <td />
                      <td />
                      <td>Late fee</td>
                      <td />
                      <td />
                      <td />
                      <td style={{ textAlign: 'right' }}>{rupees(i.lateFee)}</td>
                    </tr>
                  ) : null,
                ])}
              </tbody>
              <tfoot>
                <tr>
                  <th scope="row" colSpan={6}>
                    Total payable
                  </th>
                  <th style={{ textAlign: 'right' }}>{rupees(b.totals.payable)}</th>
                </tr>
              </tfoot>
            </table>
            <p style={{ marginTop: 'var(--sp-3)' }}>
              Amount in words: <strong>{b.totals.payableWords}</strong>
            </p>
            <p className="ep-field__help">
              Late fee is as on the bill date and may change with the date of payment.
            </p>
            <div className="ep-print-sheet__sign">
              <span>Parent’s signature</span>
              <span>Accounts office</span>
            </div>
          </section>
        ))}
    </>
  );
}
