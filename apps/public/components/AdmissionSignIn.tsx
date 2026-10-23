'use client';
import { useEffect, useState } from 'react';

const RESEND_AFTER = 30;

/**
 * Admission portal sign-in (docs/design/39, part 3): one box for a mobile number, an email or the
 * registration number; a six-digit code goes to the family's mobile and email by the ways the school
 * chose. The browser solves a proof-of-work challenge first; the token lives in an HttpOnly cookie.
 */
export function AdmissionSignIn({ school, returnTo }: { school: string; returnTo: string }) {
  const [identifier, setIdentifier] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'who' | 'code'>('who');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [minutes, setMinutes] = useState(10);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [wait, setWait] = useState(0);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);

  async function sha256Hex(text: string): Promise<string> {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  async function solve(challenge: string, difficulty: number): Promise<string> {
    const prefix = '0'.repeat(difficulty);
    for (let n = 0; n < 50_000_000; n += 1) {
      if (n % 2000 === 0) await new Promise((r) => setTimeout(r, 0));
      if ((await sha256Hex(`${challenge}:${n}`)).startsWith(prefix)) return String(n);
    }
    throw new Error('could not solve the challenge');
  }

  async function requestCode() {
    setError(null);
    if (identifier.trim().length < 4)
      return setError('Enter your mobile number, email or registration number.');
    setBusy('Checking your browser…');
    try {
      const ch = await fetch('/api/challenge', { method: 'POST' }).then((r) => r.json());
      const nonce = await solve(ch.challenge, ch.difficulty);
      setBusy('Sending the code…');
      const res = await fetch('/api/admission/code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          school,
          identifier: identifier.trim(),
          challenge: ch.challenge,
          nonce,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.type ?? 'failed');
      setSentTo(body.sentTo ?? []);
      setDevCode(body.devCode ?? null);
      if (body.expiresInMinutes) setMinutes(body.expiresInMinutes);
      setCode('');
      setWait(RESEND_AFTER);
      setStage('code');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setError(null);
    setBusy('Signing in…');
    try {
      const res = await fetch('/api/admission/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school, identifier: identifier.trim(), code }),
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
      {stage === 'who' ? (
        <>
          <label className="ep-field">
            <span className="ep-field__label">Mobile number, email or registration number</span>
            <input
              className="ep-input"
              autoComplete="username"
              value={identifier}
              maxLength={200}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void requestCode();
              }}
            />
            <span className="ep-field__help">
              New here? Use the mobile number or email you want the school to write to.
            </span>
          </label>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={() => void requestCode()}
            disabled={busy !== null}
          >
            {busy ?? 'Send code'}
          </button>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            We sent a 6-digit code to <strong>{sentTo.join(' and ') || 'you'}</strong>. It works for{' '}
            {minutes} minutes.
            {devCode ? <span className="ep-kicker"> Development code: {devCode}</span> : null}
          </p>
          <label className="ep-field">
            <span className="ep-field__label">Code</span>
            <input
              className="ep-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && code.length === 6) void verify();
              }}
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)', flexWrap: 'wrap' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              onClick={() => void verify()}
              disabled={busy !== null || code.length !== 6}
            >
              {busy ?? 'Sign in'}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => setStage('who')}
              disabled={busy !== null}
            >
              Change
            </button>
          </div>
          <div className="ep-field__help">
            No code? Mail can take a minute; look in the spam folder too.{' '}
            {wait > 0 ? (
              <span>You can ask for a new code in {wait} s.</span>
            ) : (
              <button
                type="button"
                className="ep-wiz__link"
                onClick={() => void requestCode()}
                disabled={busy !== null}
              >
                Send a new code
              </button>
            )}
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
