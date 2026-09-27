'use client';
import { useState } from 'react';

/**
 * Mobile sign-in for applicants (S8-01): asks the server for a proof-of-work challenge, solves it in the
 * browser (a few hundred milliseconds), requests the code, then verifies it. Tokens live in an HttpOnly
 * cookie set by our route handlers; the browser never sees them.
 */
export function OtpSignIn({
  school,
  lang,
  returnTo,
}: {
  school: string;
  lang: 'en' | 'hi';
  returnTo: string;
}) {
  const t = (en: string, hi: string) => (lang === 'hi' ? hi : en);
  const [mobile, setMobile] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'mobile' | 'code'>('mobile');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);

  async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }

  async function solve(challenge: string, difficulty: number): Promise<string> {
    const prefix = '0'.repeat(difficulty);
    for (let n = 0; n < 50_000_000; n += 1) {
      if (n % 2000 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
      if ((await sha256Hex(`${challenge}:${n}`)).startsWith(prefix)) return String(n);
    }
    throw new Error('could not solve the challenge');
  }

  async function requestCode() {
    setError(null);
    if (!/^[6-9]\d{9}$/.test(mobile))
      return setError(t('Enter a 10-digit mobile number.', '10 अंकों का मोबाइल नंबर दर्ज करें।'));
    setBusy(t('Checking your browser…', 'आपका ब्राउज़र जाँचा जा रहा है…'));
    try {
      const ch = await fetch('/api/challenge', { method: 'POST' }).then((r) => r.json());
      const nonce = await solve(ch.challenge, ch.difficulty);
      setBusy(t('Sending the code…', 'कोड भेजा जा रहा है…'));
      const res = await fetch('/api/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school, mobile, challenge: ch.challenge, nonce }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.type ?? 'failed');
      if (body.devCode) setDevCode(body.devCode);
      setStage('code');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setError(null);
    setBusy(t('Signing in…', 'साइन इन हो रहा है…'));
    try {
      const res = await fetch('/api/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school, mobile, code, name }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.type ?? 'failed');
      window.location.href = returnTo;
    } catch (e) {
      setError((e as Error).message);
      setBusy(null);
    }
  }

  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {stage === 'mobile' ? (
        <>
          <label className="ep-field">
            <span className="ep-field__label">{t('Your name', 'आपका नाम')}</span>
            <input
              className="ep-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">{t('Mobile number', 'मोबाइल नंबर')}</span>
            <input
              className="ep-input"
              inputMode="numeric"
              value={mobile}
              onChange={(e) => setMobile(e.target.value.replace(/\D/g, '').slice(0, 10))}
            />
          </label>
          <button type="button" className="ep-btn" onClick={requestCode} disabled={busy !== null}>
            {busy ?? t('Send code', 'कोड भेजें')}
          </button>
        </>
      ) : (
        <>
          <p>
            {t('We sent a 6-digit code to', 'हमने 6 अंकों का कोड भेजा है')}{' '}
            <strong>{mobile}</strong>.
            {devCode ? (
              <>
                {' '}
                <span className="ep-kicker">
                  {t('Development code', 'विकास कोड')}: {devCode}
                </span>
              </>
            ) : null}
          </p>
          <label className="ep-field">
            <span className="ep-field__label">{t('Code', 'कोड')}</span>
            <input
              className="ep-input"
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn"
              onClick={verify}
              disabled={busy !== null || code.length !== 6}
            >
              {busy ?? t('Sign in', 'साइन इन')}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => setStage('mobile')}
              disabled={busy !== null}
            >
              {t('Change number', 'नंबर बदलें')}
            </button>
          </div>
        </>
      )}
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
