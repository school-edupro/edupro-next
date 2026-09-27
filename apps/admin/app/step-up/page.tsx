import { Button, Card, InputField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';
import { readSession } from '@/lib/session';

/** Shown when the API answers mfa-required (S5-01): explains why and starts a fresh sign-in. */
export default async function StepUpPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations('stepUp');
  const session = await readSession();
  const returnTo =
    params.returnTo && params.returnTo.startsWith('/') && !params.returnTo.startsWith('//')
      ? params.returnTo
      : '/';
  const devSub = session?.sub.startsWith('dev:') ? session.sub.slice(4).split(';')[0] : 'dev-admin';
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--surface-band)',
        padding: 'var(--sp-5)',
      }}
    >
      <Card elevated style={{ width: '100%', maxWidth: '460px' }}>
        <div className="ep-kicker">{t('kicker')}</div>
        <h1 className="ep-page-title" style={{ marginBottom: 'var(--sp-2)' }}>
          {t('title')}
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-5)' }}>{t('intro')}</p>
        <a
          className="ep-btn ep-btn--primary"
          href={`/api/auth/step-up?returnTo=${encodeURIComponent(returnTo)}`}
          style={{ width: '100%' }}
        >
          {t('continue')}
        </a>
        {env.devBypass ? (
          <form
            method="post"
            action="/api/auth/dev"
            style={{ marginTop: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}
          >
            <div className="ep-alert ep-alert--warning">{t('devNotice')}</div>
            <InputField
              id="sub"
              name="sub"
              label={t('devSubject')}
              defaultValue={devSub}
              required
            />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" variant="secondary">
              {t('devSubmit')}
            </Button>
          </form>
        ) : null}
      </Card>
    </main>
  );
}
