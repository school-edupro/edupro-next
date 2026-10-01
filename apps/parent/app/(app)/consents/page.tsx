import { Badge, Button, Card, InputField, PageHeader } from '@edupro/ui';
import { ApiError } from '@edupro/bff';
import { redirect } from 'next/navigation';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { respondConsent } from '../appointments/actions';

interface Field {
  key: string;
  label: string;
  type: 'text' | 'choice' | 'yesno' | 'date' | 'signature';
  required?: boolean;
  options?: string[];
}
interface Form {
  id: string;
  code: string;
  title: string;
  description: string | null;
  fields: Field[];
  feeAmount: string | null;
  closesOn: string | null;
  children: Array<{
    student: { id: string; name: string };
    response: {
      id: string;
      signedName: string;
      signedAt: string;
      paymentIntentId: string | null;
      paidAt: string | null;
    } | null;
  }>;
}

/** Sprint 19: consent forms the school has opened to the family; sign per child, pay a fee when one applies. */
export default async function ConsentsPage({
  searchParams,
}: {
  searchParams: Promise<{
    ok?: string;
    pay?: string;
    paid?: string;
    error?: string;
    detail?: string;
  }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let forms: Form[];
  try {
    forms = (await bff.api.fetch<{ forms: Form[] }>('/engagement/mine/consent-forms')).forms;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403)
      return (
        <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
          <PageHeader kicker="EduPro" title={t(lang, 'Consent forms')} />
          <Card>
            {t(
              lang,
              'Your account is not linked to a student yet. Please contact the school office.',
            )}
          </Card>
        </main>
      );
    throw error;
  }
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker="EduPro"
        title={t(lang, 'Consent forms')}
        description={t(
          lang,
          'Trips, activities and permissions the school asks you to sign for each child.',
        )}
        actions={
          <a className="ep-btn ep-btn--ghost ep-btn--sm" href="/">
            {t(lang, 'Home')}
          </a>
        }
      />
      {sp.ok ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Thank you, your consent is recorded.')}
          {sp.pay ? (
            <form
              method="post"
              action="/consents/pay"
              style={{ display: 'inline', marginLeft: 'var(--sp-2)' }}
            >
              <input type="hidden" name="intentId" value={sp.pay} />
              <Button type="submit" size="sm">
                {t(lang, 'Pay the fee now')}
              </Button>
            </form>
          ) : null}
        </div>
      ) : null}
      {sp.paid === '1' ? (
        <div
          className="ep-alert ep-alert--success"
          role="status"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'Payment received. Thank you.')}
        </div>
      ) : sp.paid ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {t(lang, 'The payment did not go through. You can try again below.')}
        </div>
      ) : null}
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.detail || sp.error}
        </div>
      ) : null}
      {forms.length === 0 ? <Card>{t(lang, 'No consent forms are open right now.')}</Card> : null}
      {forms.map((f) => (
        <Card
          key={f.id}
          title={f.title}
          actions={
            f.feeAmount ? (
              <Badge tone="info">₹{Number(f.feeAmount).toLocaleString('en-IN')}</Badge>
            ) : undefined
          }
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {f.description ? <p>{f.description}</p> : null}
          {f.closesOn ? (
            <p className="ep-kicker">
              {t(lang, 'Closes on')} {f.closesOn}
            </p>
          ) : null}
          {f.children.map((ch) => (
            <div
              key={ch.student.id}
              style={{ padding: 'var(--sp-2) 0', borderTop: '1px solid var(--border-subtle)' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 'var(--sp-2)',
                  alignItems: 'center',
                }}
              >
                <strong>{ch.student.name}</strong>
                {ch.response ? (
                  <Badge tone={f.feeAmount && !ch.response.paidAt ? 'warning' : 'success'}>
                    {t(lang, 'Signed')} {ch.response.signedAt.slice(0, 10)}
                    {f.feeAmount
                      ? ch.response.paidAt
                        ? ` · ${t(lang, 'paid')}`
                        : ` · ${t(lang, 'fee pending')}`
                      : ''}
                  </Badge>
                ) : (
                  <Badge tone="neutral">{t(lang, 'Not signed')}</Badge>
                )}
              </div>
              {ch.response ? (
                f.feeAmount && !ch.response.paidAt && ch.response.paymentIntentId ? (
                  <form method="post" action="/consents/pay" style={{ marginTop: 'var(--sp-2)' }}>
                    <input type="hidden" name="intentId" value={ch.response.paymentIntentId} />
                    <Button type="submit" size="sm">
                      {t(lang, 'Pay the fee')}
                    </Button>
                  </form>
                ) : null
              ) : (
                <form action={respondConsent} style={{ marginTop: 'var(--sp-2)' }}>
                  <input type="hidden" name="formId" value={f.id} />
                  <input type="hidden" name="studentId" value={ch.student.id} />
                  <input
                    type="hidden"
                    name="yesnoKeys"
                    value={f.fields
                      .filter((x) => x.type === 'yesno')
                      .map((x) => x.key)
                      .join(',')}
                  />
                  {f.fields.map((x) =>
                    x.type === 'yesno' ? (
                      <label
                        key={x.key}
                        style={{
                          display: 'flex',
                          gap: 'var(--sp-1)',
                          alignItems: 'center',
                          margin: 'var(--sp-1) 0',
                        }}
                      >
                        <input type="checkbox" name={`a.${x.key}`} required={x.required} />{' '}
                        {x.label}
                      </label>
                    ) : x.type === 'choice' ? (
                      <label key={x.key} className="ep-field">
                        <span className="ep-field__label">{x.label}</span>
                        <select
                          className="ep-input"
                          name={`a.${x.key}`}
                          required={x.required}
                          defaultValue=""
                        >
                          <option value="" disabled>
                            —
                          </option>
                          {(x.options ?? []).map((o) => (
                            <option key={o} value={o}>
                              {o}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : (
                      <InputField
                        key={x.key}
                        id={`${ch.student.id}-${x.key}`}
                        name={`a.${x.key}`}
                        label={x.label}
                        type={x.type === 'date' ? 'date' : 'text'}
                        required={x.required}
                        maxLength={x.type === 'signature' ? 120 : 500}
                      />
                    ),
                  )}
                  <InputField
                    id={`${ch.student.id}-signed`}
                    name="signedName"
                    label={t(lang, 'Your full name (as signature)')}
                    required
                    minLength={2}
                    maxLength={120}
                  />
                  <Button type="submit" size="sm">
                    {f.feeAmount ? t(lang, 'Sign and pay') : t(lang, 'Sign')}
                  </Button>
                </form>
              )}
            </div>
          ))}
        </Card>
      ))}
    </main>
  );
}
