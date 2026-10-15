import { Button } from './Button';

/**
 * Sign-in with a code by email (0136), the same in the admin, teacher and parent apps. CodeLoginForm asks
 * the email or mobile number (the code alone); OtpCodeForm asks the 6-digit code, with "remember this
 * device", a new code and a way back. Both post to the app's /api/auth/otp/* routes.
 */
export function CodeLoginForm({ returnTo, error }: { returnTo: string; error?: string }) {
  return (
    <form
      method="post"
      action="/api/auth/otp/start"
      style={{ display: 'grid', gap: 'var(--sp-3)' }}
      aria-labelledby="code-login-title"
    >
      <h2 className="ep-h4" id="code-login-title" style={{ margin: 0 }}>
        Sign in with a code by email
      </h2>
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
      <div className="ep-field">
        <label className="ep-field__label" htmlFor="otp-login">
          Email or mobile number
        </label>
        <input
          id="otp-login"
          name="login"
          className="ep-input"
          required
          minLength={3}
          maxLength={120}
          autoComplete="username"
        />
        <span className="ep-field__help">
          A 6-digit code is sent to the email the school has for you.
        </span>
      </div>
      <input type="hidden" name="returnTo" value={returnTo} />
      <Button type="submit" variant="secondary">
        Send me a code
      </Button>
    </form>
  );
}

export function OtpCodeForm({
  sentTo,
  screenCode,
  secondFactor,
  error,
  resent,
}: {
  sentTo: string | null;
  screenCode?: string;
  /** After One Auth (two steps) rather than the code alone. */
  secondFactor: boolean;
  error?: string;
  resent?: boolean;
}) {
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-4)' }}>
      <p style={{ margin: 0 }}>
        {secondFactor ? 'One more step. ' : ''}
        {sentTo ? (
          <>
            We have sent a 6-digit code to <strong>{sentTo}</strong>. It works once, for 10 minutes.
          </>
        ) : screenCode ? (
          'There is no valid email on record for you, so the code is shown below. Ask the school office to correct your email.'
        ) : (
          'If this account can sign in with a code, a 6-digit code has been sent to its email.'
        )}
      </p>
      {screenCode ? (
        <div className="ep-alert ep-alert--warning" role="status">
          <div>
            <div>Your code</div>
            <strong style={{ fontSize: 'var(--fs-h3)', letterSpacing: '0.2em' }}>
              {screenCode}
            </strong>
            <div className="ep-field__help">
              Shown on screen while the school corrects emails. Do not share it.
            </div>
          </div>
        </div>
      ) : null}
      {resent ? (
        <div className="ep-alert ep-alert--info" role="status">
          A new code has been sent; the earlier one no longer works.
        </div>
      ) : null}
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
      <form
        method="post"
        action="/api/auth/otp/verify"
        style={{ display: 'grid', gap: 'var(--sp-3)' }}
      >
        <div className="ep-field">
          <label className="ep-field__label" htmlFor="otp-code">
            Code
          </label>
          <input
            id="otp-code"
            name="code"
            className="ep-input"
            required
            inputMode="numeric"
            pattern="[0-9]{6}"
            maxLength={6}
            autoComplete="one-time-code"
            autoFocus
            style={{ fontSize: 'var(--fs-h4)', letterSpacing: '0.3em' }}
          />
        </div>
        <label style={{ display: 'flex', gap: 'var(--sp-2)', alignItems: 'center' }}>
          <input type="checkbox" name="remember" />
          Remember this device for 30 days (not on a shared computer)
        </label>
        <Button type="submit">Verify and sign in</Button>
      </form>
      <div style={{ display: 'flex', gap: 'var(--sp-3)', flexWrap: 'wrap' }}>
        <form method="post" action="/api/auth/otp/resend">
          <Button type="submit" variant="ghost" size="sm">
            Send a new code
          </Button>
        </form>
        <form method="post" action="/api/auth/otp/cancel">
          <Button type="submit" variant="ghost" size="sm">
            Back to sign-in
          </Button>
        </form>
      </div>
    </div>
  );
}
