import { Button, Card, CodeLoginForm } from '@edupro/ui';
import { bff } from '@/lib/bff';

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{
    returnTo?: string;
    error?: string;
    otpError?: string;
    viewEnded?: string;
  }>;
}) {
  const params = await searchParams;
  const returnTo = params.returnTo && params.returnTo.startsWith('/') ? params.returnTo : '/';
  const codeOffered = await bff.otp.offered();
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
        <div className="ep-kicker">Mobilise</div>
        <h1 className="ep-page-title" style={{ marginBottom: 'var(--sp-2)' }}>
          EduPro Teacher
        </h1>
        <p style={{ color: 'var(--text-muted)', marginBottom: 'var(--sp-5)' }}>
          Sign in with the mobile number registered with the school.
        </p>
        {params.viewEnded ? (
          <div
            className="ep-alert ep-alert--info"
            role="status"
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            The view opened by the school has ended. You can close this tab.
          </div>
        ) : null}
        {params.error === 'handoff' ? (
          <div
            className="ep-alert ep-alert--danger"
            role="alert"
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            That link has expired or was already used. Open the portal again from the school&apos;s
            page.
          </div>
        ) : params.error ? (
          <div
            className="ep-alert ep-alert--danger"
            role="alert"
            style={{ marginBottom: 'var(--sp-4)' }}
          >
            Sign-in did not complete ({params.error}). Please try again.
          </div>
        ) : null}
        <a
          className="ep-btn ep-btn--primary"
          href={`/api/auth/login?returnTo=${encodeURIComponent(returnTo)}`}
          style={{ width: '100%' }}
        >
          Continue with One Auth
        </a>
        {codeOffered ? (
          <div style={{ marginTop: 'var(--sp-5)' }}>
            <CodeLoginForm returnTo={returnTo} error={params.otpError} />
          </div>
        ) : null}
        {bff.env.devBypass ? (
          <form
            method="post"
            action="/api/auth/dev"
            style={{ marginTop: 'var(--sp-5)', display: 'grid', gap: 'var(--sp-3)' }}
          >
            <div className="ep-alert ep-alert--warning">
              Development sign-in (AUTH_DEV_BYPASS). Not available in production.
            </div>
            <div className="ep-field">
              <label className="ep-field__label" htmlFor="sub">
                Sign in as
              </label>
              <select id="sub" name="sub" className="ep-select" required>
                {[
                  { sub: 'dev-teacher', label: 'Class Teacher VI-A' },
                  { sub: 'dev-subject', label: 'Subject Teacher VI-A, VI-B' },
                  { sub: 'dev-coordinator', label: 'Academic Coordinator' },
                  { sub: 'dev-principal', label: 'Principal' },
                  { sub: 'dev-warden', label: 'Warden (head warden, Girls Hostel)' },
                  { sub: 'dev-beta-teacher', label: 'Beta: Class Teacher III-A' },
                  { sub: 'dev-beta-subject', label: 'Beta: Maths Teacher I-A, II-A' },
                  { sub: 'dev-beta-coordinator', label: 'Beta: Academic Coordinator' },
                  { sub: 'dev-beta-principal', label: 'Beta: Principal' },
                ].map((r) => (
                  <option key={r.sub} value={r.sub}>
                    {r.sub} · {r.label}
                  </option>
                ))}
              </select>
            </div>
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit" variant="secondary">
              Sign in as developer
            </Button>
          </form>
        ) : null}
      </Card>
    </main>
  );
}
