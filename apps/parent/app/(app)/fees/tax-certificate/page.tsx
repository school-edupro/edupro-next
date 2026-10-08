import { Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { ChildSwitch } from '@/components/ChildSwitch';
import { PrintButton } from '@/components/PrintButton';
import { bff } from '@/lib/bff';
import { chosenChild } from '@/lib/child';
import { currentLang, t } from '@/lib/i18n';

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
  issuedOn: string;
  years: Array<{ id: string; name: string }>;
}

const rupees = (v: string) =>
  Number(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dmy = (iso: string) => {
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
};

/** A parent's fee certificate for income tax, per child and financial year (0100). */
export default async function TaxCertificatePage({
  searchParams,
}: {
  searchParams: Promise<{ student?: string; fy?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  const kid = await chosenChild(sp.student);
  let cert: Certificate | null = null;
  if (kid) {
    try {
      cert = await bff.api.fetch<Certificate>(
        `/fees/mine/tax-certificate?studentId=${kid.id}${sp.fy ? `&financialYearId=${encodeURIComponent(sp.fy)}` : ''}`,
      );
    } catch (error) {
      if (error instanceof ApiError && error.status === 401)
        redirect('/login?error=session-expired');
      if (!(error instanceof ApiError)) throw error;
    }
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 820, margin: '0 auto' }}>
      <div className="ep-noprint">
        <PageHeader
          kicker={t(lang, 'Fees')}
          title={t(lang, 'Tax certificate')}
          description={t(
            lang,
            'Tuition fee paid in a financial year, for your income-tax return. Choose the year and print or save as PDF.',
          )}
          actions={
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/fees">
              {t(lang, 'Fees')}
            </a>
          }
        />
        <ChildSwitch lang={lang} back="/fees/tax-certificate" current={kid?.id} />
        {cert ? (
          <form
            method="get"
            style={{
              display: 'flex',
              gap: 'var(--sp-3)',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
              marginBottom: 'var(--sp-4)',
            }}
          >
            <input type="hidden" name="student" value={cert.student.id} />
            <label className="ep-field">
              <span className="ep-field__label">{t(lang, 'Financial year')}</span>
              <select className="ep-select" name="fy" defaultValue={cert.financialYear.id}>
                {cert.years.map((y) => (
                  <option key={y.id} value={y.id}>
                    {y.name}
                  </option>
                ))}
              </select>
            </label>
            <Button type="submit" variant="secondary">
              {t(lang, 'Show')}
            </Button>
            <PrintButton label={t(lang, 'Print / save as PDF')} />
          </form>
        ) : (
          <Card>
            {t(lang, 'The certificate is not available. Please contact the school office.')}
          </Card>
        )}
      </div>
      {cert ? (
        <section className="ep-print-sheet" aria-label={t(lang, 'Tax certificate')}>
          <div className="ep-print-sheet__head">
            <h2 className="ep-h3">{cert.school.name}</h2>
            {cert.school.address ? <p className="ep-field__help">{cert.school.address}</p> : null}
            <p>
              <strong>Fee certificate for income tax</strong>
            </p>
          </div>
          <div className="ep-print-sheet__meta">
            <div>
              Student: <strong>{cert.student.name}</strong>
            </div>
            <div>
              Admission no.: <strong>{cert.student.admissionNo}</strong>
            </div>
            <div>
              Class: <strong>{cert.student.section ?? '—'}</strong>
            </div>
            <div>
              Parent / guardian: <strong>{cert.student.guardian ?? '—'}</strong>
            </div>
            <div>
              Financial year:{' '}
              <strong>
                {cert.financialYear.name} ({dmy(cert.financialYear.from)} to{' '}
                {dmy(cert.financialYear.to)})
              </strong>
            </div>
            <div>
              Issued on: <strong>{dmy(cert.issuedOn)}</strong>
            </div>
          </div>
          <p>
            This is to certify that the following fee has been received by the school for the above
            student during the financial year.
          </p>
          {cert.rows.length === 0 ? (
            <p>
              <strong>No fee that counts for the certificate was received in this year.</strong>
            </p>
          ) : (
            <>
              <div className="ep-table-wrap">
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
              </div>
              <p style={{ marginTop: 'var(--sp-3)' }}>
                Amount in words: <strong>{cert.totalWords}</strong>
              </p>
            </>
          )}
          <p className="ep-field__help">
            This is a computer-generated certificate from the school’s fee records.
          </p>
        </section>
      ) : null}
    </main>
  );
}
