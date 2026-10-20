'use client';
import { useState } from 'react';

/**
 * Careers page sign-in (docs/design/34-recruitment.md, part 2): the candidate chooses a code to the mobile
 * or to the email. The browser solves a proof-of-work challenge first, as on the admissions page; the
 * token lives in an HttpOnly cookie set by our route handler, never in the browser.
 */
export function CandidateSignIn({ school, returnTo }: { school: string; returnTo: string }) {
  const [channel, setChannel] = useState<'mobile' | 'email'>('mobile');
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'address' | 'code'>('address');
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
      if (n % 2000 === 0) await new Promise((r) => setTimeout(r, 0));
      if ((await sha256Hex(`${challenge}:${n}`)).startsWith(prefix)) return String(n);
    }
    throw new Error('could not solve the challenge');
  }

  async function requestCode() {
    setError(null);
    if (channel === 'mobile' && !/^[6-9]\d{9}$/.test(to))
      return setError('Enter a 10-digit mobile number.');
    if (channel === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to))
      return setError('Enter your email address.');
    setBusy('Checking your browser…');
    try {
      const ch = await fetch('/api/challenge', { method: 'POST' }).then((r) => r.json());
      const nonce = await solve(ch.challenge, ch.difficulty);
      setBusy('Sending the code…');
      const res = await fetch('/api/careers/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school, channel, to, challenge: ch.challenge, nonce }),
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
    setBusy('Signing in…');
    try {
      const res = await fetch('/api/careers/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school, channel, to, code, name }),
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
      {stage === 'address' ? (
        <>
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Send the code to</legend>
            <div style={{ display: 'flex', gap: 'var(--sp-4)' }}>
              {(['mobile', 'email'] as const).map((c) => (
                <label key={c} className="ep-check">
                  <input
                    type="radio"
                    name="cand-channel"
                    checked={channel === c}
                    onChange={() => {
                      setChannel(c);
                      setTo('');
                    }}
                  />{' '}
                  {c === 'mobile' ? 'My mobile' : 'My email'}
                </label>
              ))}
            </div>
          </fieldset>
          <label className="ep-field">
            <span className="ep-field__label">Your name</span>
            <input
              className="ep-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
            />
          </label>
          <label className="ep-field">
            <span className="ep-field__label">
              {channel === 'mobile' ? 'Mobile number' : 'Email address'}
            </span>
            {channel === 'mobile' ? (
              <input
                className="ep-input"
                inputMode="numeric"
                autoComplete="tel"
                value={to}
                onChange={(e) => setTo(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            ) : (
              <input
                className="ep-input"
                type="email"
                autoComplete="email"
                value={to}
                onChange={(e) => setTo(e.target.value.trim().toLowerCase())}
                maxLength={200}
              />
            )}
          </label>
          <button
            type="button"
            className="ep-btn ep-btn--primary"
            onClick={requestCode}
            disabled={busy !== null}
          >
            {busy ?? 'Send code'}
          </button>
        </>
      ) : (
        <>
          <p>
            We sent a 6-digit code to <strong>{to}</strong>.
            {devCode ? (
              <>
                {' '}
                <span className="ep-kicker">Development code: {devCode}</span>
              </>
            ) : null}
          </p>
          <label className="ep-field">
            <span className="ep-field__label">Code</span>
            <input
              className="ep-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              onClick={verify}
              disabled={busy !== null || code.length !== 6}
            >
              {busy ?? 'Sign in'}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => setStage('address')}
              disabled={busy !== null}
            >
              {channel === 'mobile' ? 'Change number' : 'Change email'}
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
