import { Button, Card, InputField } from '@edupro/ui';
import { getTranslations } from 'next-intl/server';
import { env } from '@/lib/env';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string; error?: string }>;
}) {
  const params = await searchParams;
  const t = await getTranslations('login');
  const returnTo = params.returnTo && params.returnTo.startsWith('/') ? params.returnTo : '/';
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
      <Card elevated style={{ width: '100%', maxWidth: '420px' }}>
        <div className="ep-kicker">{t('kicker')}</div>
        <h1 className="ep-page-title" style={{ marginBottom: 'var(--sp-2)' }}>
          Edu<b style={{ color: 'var(--mob-cyan-600)' }}>Pro</b> Next
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-5)' }}>{t('intro')}</p>
        {params.error ? (
          <div
            className="ep-alert ep-alert--danger"
            role="alert"
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            {t('error', { error: params.error })}
          </div>
        ) : null}
        <a
          className="ep-btn ep-btn--primary"
          href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
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
              defaultValue="dev-admin"
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
