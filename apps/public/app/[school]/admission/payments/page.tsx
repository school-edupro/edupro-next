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
 * Payments & receipts by registration (docs/design/44, part 3): the family's totals first, then a
 * section per registration — the child, class, session and number; its registration and admission fee
 * (paid, due); what is due now with its way to pay; its receipts with View and Download.
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
  const live = (s: string) => s !== 'reversed';
  const regs = data.registrations.map((r) => {
    const paidOf = (admission: boolean) =>
      r.receipts
        .filter((x) => live(x.status) && /admission/i.test(x.head) === admission)
        .reduce((n, x) => n + x.amount, 0);
    const lines = [
      {
        what: w('Registration fee'),
        paid: paidOf(false),
        due: r.feeDue,
        by: r.closesAt,
        locked: Boolean(r.locked),
      },
      {
        what: w('Admission fee'),
        paid: paidOf(true),
        due: r.admissionFeeDue,
        by: r.offerExpiresAt,
        locked: false,
      },
    ].filter((l) => l.paid > 0 || l.due > 0);
    return {
      r,
      lines,
      due: r.feeDue + r.admissionFeeDue,
      paid: lines.reduce((n, l) => n + l.paid, 0),
    };
  });
  const totalDue = regs.reduce((n, x) => n + x.due, 0);
  const totalPaid = regs.reduce((n, x) => n + x.paid, 0);
  return (
    <>
      <div className="ep-adm-pagehead">
        {profile ? <p className="ep-kicker">{profile.name}</p> : null}
        <h1 className="ep-page-title">{w('Payments & receipts')}</h1>
      </div>

      <dl className="ep-adm-paytotals">
        <div className="ep-card">
          <dt>{w('Due now')}</dt>
          <dd>{rupees(totalDue)}</dd>
        </div>
        <div className="ep-card">
          <dt>{w('Paid')}</dt>
          <dd>{rupees(totalPaid)}</dd>
        </div>
        <div className="ep-card">
          <dt>{w('Registrations')}</dt>
          <dd>{regs.length}</dd>
        </div>
      </dl>

      {regs.length === 0 ? (
        <p className="ep-card ep-adm-open__none">{w('No registration yet.')}</p>
      ) : (
        regs.map(({ r, lines, due }) => {
          const name = r.candidate || w('New form');
          return (
            <section key={r.id} className="ep-card ep-adm-payreg" aria-labelledby={`pay-${r.id}`}>
              <div className="ep-adm-payreg__head">
                <h2 id={`pay-${r.id}`} className="fp-section-title">
                  {name} · {r.className}
                </h2>
                <span className="fp-list__meta">
                  {[r.session, r.number ? `${w('Registration no.')} ${r.number}` : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
                {due > 0 ? (
                  <Badge tone="warning">
                    {w('Due')} {rupees(due)}
                  </Badge>
                ) : (
                  <Badge tone="success">{w('Nothing due')}</Badge>
                )}
              </div>

              {lines.length === 0 ? (
                <p className="ep-field__help">
                  {w('Nothing paid or due for this registration yet.')}
                </p>
              ) : (
                <ul className="fp-list">
                  {lines.map((l) => (
                    <li key={l.what} className="ep-adm-pay__row">
                      <span>
                        <strong>{l.what}</strong>
                        {l.due > 0 ? (
                          <span className="fp-list__meta">
                            {l.paid > 0 ? ` · ${w('Paid')} ${rupees(l.paid)}` : ''}
                            {l.by ? ` · ${w('due by')} ${dmy(l.by)}` : ''}
                          </span>
                        ) : null}
                      </span>
                      <span className="ep-adm-pay__amt">{rupees(l.due > 0 ? l.due : l.paid)}</span>
                      {l.due > 0 ? (
                        l.locked ? (
                          <Badge tone="neutral">{w('Closed')}</Badge>
                        ) : (
                          <a
                            className="ep-btn ep-btn--primary ep-btn--sm"
                            href={`${base}/application/${r.id}?tab=payments`}
                            aria-label={`${w('Pay')} ${rupees(l.due)}: ${name}, ${l.what}`}
                          >
                            {w('Pay')}
                          </a>
                        )
                      ) : (
                        <Badge tone="success">{w('Paid')}</Badge>
                      )}
                    </li>
                  ))}
                </ul>
              )}

              {r.receipts.length ? (
                <div
                  className="ep-table-wrap"
                  tabIndex={0}
                  role="region"
                  aria-label={`${w('Receipts')}: ${name}`}
                >
                  <table className="ep-table">
                    <caption className="ep-sr-only">
                      {w('Receipts')}: {name}
                    </caption>
                    <thead>
                      <tr>
                        <th scope="col">{w('Receipt')}</th>
                        <th scope="col">{w('Date')}</th>
                        <th scope="col">{w('Amount')}</th>
                        <th scope="col">
                          <span className="ep-sr-only">{w('Open')}</span>
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...r.receipts]
                        .sort((a, b) => b.date.localeCompare(a.date))
                        .map((x) => (
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
              ) : null}
            </section>
          );
        })
      )}
    </>
  );
}
