import { Button, SelectField } from '@edupro/ui';
import { PrintButton } from '@/components/PrintButton';
import { PupilMeta, SheetHead, dmy, rupees } from '@/components/fees/sheets';
import { apiFetch } from '@/lib/api';

interface Certificate {
  school: { name: string; address: string };
  financialYear: { id: string; name: string; from: string; to: string };
  student: {
    id: string;
    name: string;
    admissionNo: string;
    section: string | null;
    guardian: string | null;
  };
  rows: Array<{
    receivedOn: string;
    receiptNo: string | null;
    mode: string;
    head: string;
    amount: string;
  }>;
  total: string;
  totalWords: string;
  otherPaid: string;
  issuedOn: string;
  years: Array<{ id: string; name: string }>;
}

/** The fee certificate for income tax: fee paid in a financial year on the heads marked for it. */
export default async function TaxCertificatePage({
  params,
  searchParams,
}: {
  params: Promise<{ studentId: string }>;
  searchParams: Promise<{ fy?: string }>;
}) {
  const { studentId } = await params;
  const sp = await searchParams;
  const cert = await apiFetch<Certificate>(
    `/fees/students/${studentId}/tax-certificate${sp.fy ? `?financialYearId=${sp.fy}` : ''}`,
  );
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
          id="fy"
          name="fy"
          label="Financial year"
          defaultValue={cert.financialYear.id}
          options={cert.years.map((y) => ({ value: y.id, label: y.name }))}
        />
        <Button type="submit" variant="secondary">
          Show
        </Button>
        <PrintButton label="Print certificate" />
      </form>
      <section className="ep-print-sheet" aria-label="Fee certificate for income tax">
        <SheetHead school={cert.school} title="Fee certificate for income tax" />
        <PupilMeta
          student={cert.student}
          extra={[
            [
              'Financial year',
              `${cert.financialYear.name} (${dmy(cert.financialYear.from)} to ${dmy(cert.financialYear.to)})`,
            ],
            ['Issued on', dmy(cert.issuedOn)],
          ]}
        />
        <p>
          This is to certify that the following fee has been received by the school for the above
          student during the financial year.
        </p>
        {cert.rows.length === 0 ? (
          <p>
            <strong>No fee that counts for the certificate was received in this year.</strong>
          </p>
        ) : (
          <table className="ep-table ep-table--dense">
            <caption className="ep-sr-only">Fee received in the financial year</caption>
            <thead>
              <tr>
                <th scope="col">Date</th>
                <th scope="col">Receipt no.</th>
                <th scope="col">Mode</th>
                <th scope="col">Fee head</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Amount (₹)
                </th>
              </tr>
            </thead>
            <tbody>
              {cert.rows.map((r, i) => (
                <tr key={i}>
                  <td>{dmy(r.receivedOn)}</td>
                  <td>{r.receiptNo ?? ''}</td>
                  <td>{r.mode.toUpperCase()}</td>
                  <td>{r.head}</td>
                  <td style={{ textAlign: 'right' }}>{rupees(r.amount)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <th scope="row" colSpan={4}>
                  Total
                </th>
                <th style={{ textAlign: 'right' }}>{rupees(cert.total)}</th>
              </tr>
            </tfoot>
          </table>
        )}
        {cert.rows.length > 0 ? (
          <p style={{ marginTop: 'var(--sp-3)' }}>
            Amount in words: <strong>{cert.totalWords}</strong>
          </p>
        ) : null}
        <p className="ep-field__help ep-noprint">
          Other fee received in the year and not counted here (transport, annual charges and the
          like; late fee is never counted): ₹{rupees(cert.otherPaid)}. Which heads count is set
          under Fees → Class rules, payment modes → How heads print.
        </p>
        <div className="ep-print-sheet__sign">
          <span>Date: {dmy(cert.issuedOn)}</span>
          <span>Accounts officer</span>
          <span>Principal</span>
        </div>
      </section>
    </>
  );
}
