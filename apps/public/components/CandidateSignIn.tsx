'use client';
import { useEffect, useState } from 'react';
import { maskAddress } from '@/lib/career-checks';
import type { CareerSignIn } from '@/lib/careers';

const RESEND_AFTER = 30;

/**
 * Careers page sign-in (docs/design/34-recruitment.md, part 2): the candidate chooses a code to the mobile
 * or to the email, among the ways the school can send by. The browser solves a proof-of-work challenge
 * first, as on the admissions page; the token lives in an HttpOnly cookie set by our route handler, never
 * in the browser. The code may be sent again after 30 seconds; the screen says where it went, how long it
 * lasts and what to do when it does not come.
 */
export function CandidateSignIn({
  school,
  returnTo,
  channels,
}: {
  school: string;
  returnTo: string;
  channels: CareerSignIn;
}) {
  // a way the school cannot send by is not offered (in development both are, the code shows on screen)
  const usable = (c: 'mobile' | 'email') => channels[c] || channels.dev;
  const [channel, setChannel] = useState<'mobile' | 'email'>(
    channels.email && !channels.mobile ? 'email' : 'mobile',
  );
  const [wait, setWait] = useState(0);
  const [notSent, setNotSent] = useState(false);
  const [minutes, setMinutes] = useState(channels.minutes);
  useEffect(() => {
    if (wait <= 0) return;
    const t = setTimeout(() => setWait((w) => w - 1), 1000);
    return () => clearTimeout(t);
  }, [wait]);
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
      setDevCode(body.devCode ?? null);
      setNotSent(body.sent === false);
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

  if (!usable('mobile') && !usable('email'))
    return (
      <div className="ep-alert ep-alert--warning" role="status">
        Online sign-in is not open at this school yet: please contact the school office.
      </div>
    );
  return (
    <div style={{ display: 'grid', gap: 'var(--sp-3)' }}>
      {stage === 'address' ? (
        <>
          <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="ep-field__label">Send the code to</legend>
            <div className="ep-wiz__choices">
              {(['mobile', 'email'] as const).map((c) => (
                <label key={c} className="ep-wiz__choice">
                  <input
                    type="radio"
                    name="cand-channel"
                    checked={channel === c}
                    disabled={!usable(c)}
                    onChange={() => {
                      setChannel(c);
                      setTo('');
                    }}
                  />
                  <span>{c === 'mobile' ? 'My mobile' : 'My email'}</span>
                </label>
              ))}
            </div>
            {channels.mobile !== channels.email ? (
              <span className="ep-field__help">
                This school sends codes {channels.email ? 'by email' : 'to mobiles'} only.
                {channels.dev
                  ? ' (Development: the other way works too; its code shows here.)'
                  : ''}
              </span>
            ) : null}
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
          <p style={{ margin: 0 }}>
            {notSent ? 'A code was made for' : 'We sent a 6-digit code to'}{' '}
            <strong>{maskAddress(to)}</strong>. It works for {minutes} minutes.
            {devCode ? (
              <>
                {' '}
                <span className="ep-kicker">
                  Development code: {devCode}
                  {notSent ? ' (not sent: the school cannot send by this way)' : ''}
                </span>
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
          <div className="ep-field__help">
            <p style={{ margin: '0 0 var(--sp-1)' }}>
              No code?{' '}
              {channel === 'email'
                ? 'Look in the spam or promotions folder; mail can take a minute.'
                : 'An SMS can take a minute; check the number is right.'}
              {usable(channel === 'email' ? 'mobile' : 'email') ? (
                <>
                  {' '}
                  <button
                    type="button"
                    className="ep-wiz__link"
                    onClick={() => {
                      setChannel(channel === 'email' ? 'mobile' : 'email');
                      setTo('');
                      setStage('address');
                    }}
                  >
                    {channel === 'email' ? 'Use my mobile instead' : 'Use my email instead'}
                  </button>
                </>
              ) : null}
            </p>
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
