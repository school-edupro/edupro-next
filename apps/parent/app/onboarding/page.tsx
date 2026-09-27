import { Badge, Button, Card, PageHeader } from '@edupro/ui';
import { redirect } from 'next/navigation';
import { ApiError } from '@edupro/bff';
import { bff } from '@/lib/bff';
import { currentLang, t } from '@/lib/i18n';
import { acknowledge } from './actions';

interface Onboarding {
  notice: { version: number; title: string; body: string; bodyHi: string | null } | null;
  acknowledged: string | null;
  required: boolean;
  purposes: Array<{
    code: string;
    name: string;
    description: string;
    status: 'granted' | 'withdrawn' | null;
    isRequired: boolean;
  }>;
}

/** First visit after sign-in: the privacy notice to read and the consent choices (DPDP), S11. */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const sp = await searchParams;
  const lang = await currentLang();
  let ob: Onboarding;
  try {
    ob = await bff.api.fetch<Onboarding>('/engagement/onboarding');
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login?error=session-expired');
    if (error instanceof ApiError && error.status === 403) redirect('/');
    throw error;
  }
  if (!ob.notice) redirect('/');
  const body = lang === 'hi' && ob.notice.bodyHi ? ob.notice.bodyHi : ob.notice.body;
  return (
    <main style={{ padding: 'var(--sp-4)', maxWidth: 720, margin: '0 auto' }}>
      <PageHeader
        kicker={t(lang, 'Privacy notice')}
        title={ob.notice.title}
        description={
          ob.acknowledged
            ? `Acknowledged ${new Date(ob.acknowledged).toLocaleDateString('en-IN')}`
            : `Version ${ob.notice.version}`
        }
        actions={
          <a
            className="ep-btn ep-btn--ghost ep-btn--sm"
            href={`/api/lang?to=${lang === 'hi' ? 'en' : 'hi'}&back=/onboarding`}
          >
            {lang === 'hi' ? 'English' : 'हिन्दी'}
          </a>
        }
      />
      {sp.error ? (
        <div
          className="ep-alert ep-alert--danger"
          role="alert"
          style={{ marginBottom: 'var(--sp-3)' }}
        >
          {sp.error}
        </div>
      ) : null}
      <Card style={{ marginBottom: 'var(--sp-3)' }}>
        <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{body}</p>
      </Card>
      <form action={acknowledge}>
        <input type="hidden" name="version" value={ob.notice.version} />
        <Card title={t(lang, 'Your consents')} style={{ marginBottom: 'var(--sp-3)' }}>
          {ob.purposes.map((p) => (
            <div
              key={p.code}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                gap: 'var(--sp-2)',
                alignItems: 'center',
                padding: 'var(--sp-2) 0',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div>
                <div>
                  <strong>{p.name}</strong>{' '}
                  {p.isRequired ? <Badge tone="neutral">required</Badge> : null}
                </div>
                <div className="ep-kicker">{p.description}</div>
              </div>
              <select
                className="ep-input"
                name={`consent.${p.code}`}
                defaultValue={p.status ?? 'granted'}
                aria-label={p.name}
                disabled={p.isRequired}
                style={{ width: 130 }}
              >
                <option value="granted">{t(lang, 'Allow')}</option>
                <option value="withdrawn">{t(lang, 'Withdraw')}</option>
              </select>
            </div>
          ))}
        </Card>
        <Button type="submit">
          {ob.acknowledged ? t(lang, 'Continue') : t(lang, 'I have read the notice')}
        </Button>
      </form>
    </main>
  );
}
