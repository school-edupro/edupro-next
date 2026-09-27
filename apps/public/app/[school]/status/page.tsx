import { Badge, Card, PageHeader } from '@edupro/ui';
import { cookies } from 'next/headers';
import { OtpSignIn } from '@/components/OtpSignIn';
import { COOKIE, PublicApiError, langOf, publicFetch, t, type Application } from '@/lib/api';

const STATUS: Record<
  string,
  [string, string, 'neutral' | 'info' | 'success' | 'warning' | 'danger']
> = {
  draft: ['Draft', 'ड्राफ़्ट', 'neutral'],
  submitted: ['Submitted', 'जमा', 'info'],
  under_review: ['Under review', 'समीक्षा में', 'info'],
  shortlisted: ['Shortlisted', 'शॉर्टलिस्ट', 'warning'],
  selected: ['Selected', 'चयनित', 'success'],
  waitlisted: ['Waitlisted', 'प्रतीक्षा सूची', 'warning'],
  rejected: ['Not selected', 'चयनित नहीं', 'danger'],
  withdrawn: ['Withdrawn', 'वापस लिया', 'neutral'],
  admitted: ['Admitted', 'प्रवेश हुआ', 'success'],
};
const API_PATH = process.env.NEXT_PUBLIC_API_PATH ?? '/api/v1';

/** Applicant sign-in and the status of their applications (S8-05). */
export default async function StatusPage({
  params,
  searchParams,
}: {
  params: Promise<{ school: string }>;
  searchParams: Promise<{ lang?: string; submitted?: string; paid?: string }>;
}) {
  const { school } = await params;
  const sp = await searchParams;
  const lang = langOf(sp.lang);
  const token = (await cookies()).get(COOKIE)?.value;
  let apps: Application[] | null = null;
  let me: { name: string | null; mobile: string } | null = null;
  if (token) {
    try {
      [me, apps] = await Promise.all([
        publicFetch<{ name: string | null; mobile: string }>('/me'),
        publicFetch<{ data: Application[] }>('/me/applications').then((r) => r.data),
      ]);
    } catch (error) {
      if (!(error instanceof PublicApiError && error.status === 401)) throw error;
    }
  }
  return (
    <>
      <PageHeader
        kicker={school.toUpperCase()}
        title={t(lang, 'My applications', 'मेरे आवेदन')}
        description={
          me
            ? `${me.name ?? ''} · ${me.mobile}`
            : t(
                lang,
                'Sign in with the mobile you applied with.',
                'उस मोबाइल से साइन इन करें जिससे आपने आवेदन किया था।',
              )
        }
        actions={
          <span style={{ display: 'inline-flex', gap: 'var(--sp-2)' }}>
            <a className="ep-btn ep-btn--ghost ep-btn--sm" href={`/${school}?lang=${lang}`}>
              {t(lang, 'Cycles', 'चक्र')}
            </a>
            {me ? (
              <form method="post" action={`/api/logout?to=/${school}?lang=${lang}`}>
                <button type="submit" className="ep-btn ep-btn--ghost ep-btn--sm">
                  {t(lang, 'Sign out', 'साइन आउट')}
                </button>
              </form>
            ) : null}
          </span>
        }
      />
      {sp.submitted ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Application submitted. Your number is', 'आवेदन जमा हो गया। आपका क्रमांक है')}{' '}
          <strong>{sp.submitted}</strong>.
        </div>
      ) : null}
      {sp.paid === '1' ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(
            lang,
            'Payment received. The school will complete the admission.',
            'भुगतान प्राप्त हुआ। विद्यालय प्रवेश पूरा करेगा।',
          )}
        </div>
      ) : sp.paid && sp.paid !== '1' ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(
            lang,
            'The payment did not go through. You can try again.',
            'भुगतान नहीं हुआ। आप फिर से कोशिश कर सकते हैं।',
          )}
        </div>
      ) : null}
      {!me ? (
        <Card>
          <OtpSignIn school={school} lang={lang} returnTo={`/${school}/status?lang=${lang}`} />
        </Card>
      ) : (
        <>
          {apps && apps.length === 0 ? (
            <Card>{t(lang, 'No applications yet.', 'अभी कोई आवेदन नहीं।')}</Card>
          ) : null}
          {(apps ?? []).map((a) => {
            const [en, hi, tone] = STATUS[a.status] ?? [a.status, a.status, 'neutral'];
            return (
              <Card key={a.id} elevated style={{ marginBottom: 'var(--sp-3)' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    gap: 'var(--sp-2)',
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div
                      style={{
                        fontFamily: 'var(--font-heading)',
                        fontWeight: 600,
                        color: 'var(--text-heading)',
                      }}
                    >
                      {a.childName} · {t(lang, 'Class', 'कक्षा')} {a.classCode}
                    </div>
                    <div className="ep-kicker">
                      {a.applicationNo ?? t(lang, 'draft', 'ड्राफ़्ट')} · {a.cycleCode} ·{' '}
                      {t(lang, 'DOB', 'जन्म')} {a.childDob}
                    </div>
                  </div>
                  <Badge tone={tone}>{lang === 'hi' ? hi : en}</Badge>
                </div>
                {a.offer ? (
                  <div
                    style={{
                      marginTop: 'var(--sp-3)',
                      paddingTop: 'var(--sp-3)',
                      borderTop: '1px solid var(--border-subtle)',
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        gap: 'var(--sp-2)',
                        flexWrap: 'wrap',
                      }}
                    >
                      <div>
                        <strong>{t(lang, 'Admission offer', 'प्रवेश प्रस्ताव')}</strong>
                        <div className="ep-kicker">
                          {t(lang, 'Admission fee', 'प्रवेश शुल्क')} ₹{a.offer.admissionFee} ·{' '}
                          {t(lang, 'valid till', 'मान्य तक')}{' '}
                          {new Date(a.offer.expiresAt).toLocaleDateString('en-IN')}
                        </div>
                      </div>
                      <Badge tone={a.offer.status === 'accepted' ? 'success' : 'warning'}>
                        {a.offer.status === 'accepted'
                          ? t(lang, 'Fee paid', 'शुल्क जमा')
                          : t(lang, 'Fee pending', 'शुल्क बकाया')}
                      </Badge>
                    </div>
                    {a.offer.payment?.form && a.offer.payment.status !== 'succeeded' ? (
                      a.offer.payment.form.action.startsWith(`${API_PATH}/payments/payu/mock`) ? (
                        <form method="post" action="/api/pay" style={{ marginTop: 'var(--sp-3)' }}>
                          <input type="hidden" name="txnid" value={a.offer.payment.txnId} />
                          <input type="hidden" name="school" value={school} />
                          <input type="hidden" name="lang" value={lang} />
                          <button type="submit" className="ep-btn ep-btn--primary">
                            {t(lang, 'Pay admission fee', 'प्रवेश शुल्क भरें')} ₹
                            {a.offer.admissionFee}
                          </button>
                          <p className="ep-field__help">
                            {t(
                              lang,
                              'Development gateway: the payment is simulated.',
                              'विकास गेटवे: भुगतान नक़ली है।',
                            )}
                          </p>
                        </form>
                      ) : (
                        <form
                          method="post"
                          action={a.offer.payment.form.action}
                          style={{ marginTop: 'var(--sp-3)' }}
                        >
                          {Object.entries(a.offer.payment.form.fields).map(([k, v]) => (
                            <input key={k} type="hidden" name={k} value={v} />
                          ))}
                          <button type="submit" className="ep-btn ep-btn--primary">
                            {t(lang, 'Pay admission fee', 'प्रवेश शुल्क भरें')} ₹
                            {a.offer.admissionFee}
                          </button>
                        </form>
                      )
                    ) : null}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </>
      )}
    </>
  );
}
