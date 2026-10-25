import { Badge } from '@edupro/ui';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { ViewDownload } from '@/components/ViewDownload';
import {
  ADMISSION_COOKIE,
  admissionFetch,
  dmy,
  rupees,
  type PortalDashboard,
} from '@/lib/admission';
import { t } from '@/lib/i18n';
import { currentLang } from '@/lib/lang';
import { schoolProfile } from '@/lib/school';

/**
 * Payments & receipts (docs/design/42, part 4): across the family's registrations, what is due now (each
 * with its way to pay) and every receipt paid, with View and Download.
 */
export default async function AdmissionPaymentsPage({
  params,
}: {
  params: Promise<{ school: string }>;
}) {
  const { school } = await params;
  if (!(await cookies()).get(ADMISSION_COOKIE)?.value) redirect(`/${school}/admission#sign-in`);
  const data = await admissionFetch<PortalDashboard>('/me/dashboard').catch(() => null);
  if (!data) redirect(`/${school}/admission#sign-in`);
  const [lang, profile] = await Promise.all([currentLang(), schoolProfile(school)]);
  const w = (en: string) => t(lang, en);
  const base = `/${school}/admission`;
  const due = data.registrations.flatMap((r) => [
    ...(r.feeDue > 0
      ? [
          {
            r,
            what: w('Registration fee'),
            amount: r.feeDue,
            by: r.closesAt,
            locked: Boolean(r.locked),
          },
        ]
      : []),
    ...(r.admissionFeeDue > 0
      ? [
          {
            r,
            what: w('Admission fee'),
            amount: r.admissionFeeDue,
            by: r.offerExpiresAt,
            locked: false,
          },
        ]
      : []),
  ]);
  const paid = data.registrations
    .flatMap((r) => r.receipts.map((x) => ({ r, x })))
    .sort((a, b) => b.x.date.localeCompare(a.x.date));
  const total = due.reduce((n, d) => n + d.amount, 0);
  return (
    <>
      <div className="ep-adm-pagehead">
        {profile ? <p className="ep-kicker">{profile.name}</p> : null}
        <h1 className="ep-page-title">{w('Payments & receipts')}</h1>
      </div>

      <section className="ep-card ep-adm-pay" aria-labelledby="pay-due">
        <h2 id="pay-due" className="fp-section-title">
          {w('Due now')} {total ? `· ${rupees(total)}` : ''}
        </h2>
        {due.length === 0 ? (
          <p className="ep-field__help">{w('Nothing is due now.')}</p>
        ) : (
          <ul className="fp-list">
            {due.map((d) => (
              <li key={`${d.r.id}-${d.what}`} className="ep-adm-pay__row">
                <span>
                  <strong>{d.r.candidate || w('New form')}</strong> · {d.r.className} · {d.what}
                  {d.by ? (
                    <span className="fp-list__meta">
                      {' '}
                      {w('by')} {dmy(d.by)}
                    </span>
                  ) : null}
                </span>
                <span className="ep-adm-pay__amt">{rupees(d.amount)}</span>
                {d.locked ? (
                  <Badge tone="neutral">{w('Closed')}</Badge>
                ) : (
                  <a
                    className="ep-btn ep-btn--primary ep-btn--sm"
                    href={`${base}/application/${d.r.id}?tab=payments`}
                    aria-label={`${w('Pay')} ${rupees(d.amount)}: ${d.r.candidate || d.r.className}`}
                  >
                    {w('Pay')}
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="ep-card ep-adm-pay" aria-labelledby="pay-paid">
        <h2 id="pay-paid" className="fp-section-title">
          {w('Receipts')}
        </h2>
        {paid.length === 0 ? (
          <p className="ep-field__help">{w('No payment yet.')}</p>
        ) : (
          <div className="ep-table-wrap">
            <table className="ep-table">
              <caption className="ep-sr-only">{w('Receipts')}</caption>
              <thead>
                <tr>
                  <th scope="col">{w('Receipt')}</th>
                  <th scope="col">{w('Candidate')}</th>
                  <th scope="col">{w('Date')}</th>
                  <th scope="col">{w('Amount')}</th>
                  <th scope="col">
                    <span className="ep-sr-only">{w('Open')}</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {paid.map(({ r, x }) => (
                  <tr key={x.id}>
                    <td>
                      {x.head} {x.receiptNo}
                      {x.status === 'reversed' ? (
                        <>
                          {' '}
                          <Badge tone="neutral">{w('reversed')}</Badge>
                        </>
                      ) : null}
                    </td>
                    <td>
                      {r.candidate || '-'}
                      <div className="ep-kicker">{r.className}</div>
                    </td>
                    <td>{dmy(x.date)}</td>
                    <td>{rupees(x.amount)}</td>
                    <td>
                      <ViewDownload
                        href={`/api/admission/receipt/${r.id}/${x.id}`}
                        what={`${w('receipt')} ${x.receiptNo}`}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
