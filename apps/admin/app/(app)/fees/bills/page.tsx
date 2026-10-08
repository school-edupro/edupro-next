import { Button, Card, FormRow, InputField, PageHeader, SelectField } from '@edupro/ui';
import { PrintButton } from '@/components/PrintButton';
import { PupilMeta, SheetHead, dmy, rupees } from '@/components/fees/sheets';
import { ApiError, apiFetch } from '@/lib/api';
import type { ClassRow, Page } from '@/lib/types';

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
  searchParams: Promise<{ classId?: string; studentId?: string; upTo?: string }>;
}) {
  const sp = await searchParams;
  const upTo = sp.upTo && /^\d{4}-\d{2}-\d{2}$/.test(sp.upTo) ? sp.upTo : today();
  const classes = await apiFetch<Page<ClassRow>>('/academics/classes?size=200').then((r) => r.data);
  let bills: Bill[] = [];
  let problem: string | null = null;
  try {
    if (sp.studentId)
      bills = [await apiFetch<Bill>(`/fees/students/${sp.studentId}/bill?upTo=${upTo}`)];
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
          title="Fee bills"
          description="The bill shows what is payable up to the date, head by head, with the late fee. Choose a class and print; pupils who owe nothing are left out."
        />
        <Card>
          <form method="get">
            <FormRow columns={4}>
              <SelectField
                id="classId"
                name="classId"
                label="Class"
                defaultValue={sp.classId ?? ''}
                options={[
                  { value: '', label: '—' },
                  ...classes.map((k) => ({ value: k.id, label: `${k.code} · ${k.name}` })),
                ]}
              />
              <InputField
                id="upTo"
                name="upTo"
                label="Dues up to"
                type="date"
                defaultValue={upTo}
              />
              <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--sp-3)' }}>
                <Button type="submit" variant="secondary">
                  Show bills
                </Button>
                {bills.length > 0 ? <PrintButton label={`Print ${bills.length} bill(s)`} /> : null}
              </div>
            </FormRow>
          </form>
          {problem ? (
            <p className="ep-alert ep-alert--danger" role="alert">
              {problem}
            </p>
          ) : null}
          {asked && !problem && bills.every((b) => b.instalments.length === 0) ? (
            <p className="ep-field__help">Nothing is payable up to {dmy(upTo)}.</p>
          ) : null}
        </Card>
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
                      <td>{n === 0 ? dmy(i.dueOn) : ''}</td>
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
