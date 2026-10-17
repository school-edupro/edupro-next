'use client';
import { useState } from 'react';

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

/**
 * Signing in on a consent form's public link (docs/design/28-consent-forms.md): a parent gives the
 * pupil's admission number and gets a code on the mobile the school has; an outsider gives a name and a
 * mobile or an email and gets the code there. The pass lives in an HttpOnly cookie set by our route.
 */
export function ConsentSignIn({
  school,
  token,
  families,
  outsiders,
}: {
  school: string;
  token: string;
  families: boolean;
  outsiders: boolean;
}) {
  const [mode, setMode] = useState<'family' | 'outsider'>(families ? 'family' : 'outsider');
  const [admissionNo, setAdmissionNo] = useState('');
  const [name, setName] = useState('');
  const [contact, setContact] = useState('');
  const [code, setCode] = useState('');
  const [stage, setStage] = useState<'who' | 'code'>('who');
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const who = () =>
    mode === 'family'
      ? { mode, admissionNo: admissionNo.trim() }
      : contact.includes('@')
        ? { mode, email: contact.trim().toLowerCase() }
        : { mode, mobile: contact.trim() };

  async function requestCode() {
    setError(null);
    if (mode === 'family' && !admissionNo.trim()) return setError('Enter the admission number.');
    if (mode === 'outsider') {
      if (name.trim().length < 2) return setError('Enter your name.');
      if (
        !/^[6-9]\d{9}$/.test(contact.trim()) &&
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.trim())
      )
        return setError('Enter a 10-digit mobile number or an email address.');
    }
    setBusy('Checking your browser…');
    try {
      const ch = await fetch('/api/challenge', { method: 'POST' }).then((r) => r.json());
      const nonce = await solve(ch.challenge, ch.difficulty);
      setBusy('Sending the code…');
      const res = await fetch('/api/consent/otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school, token, ...who(), challenge: ch.challenge, nonce }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.type ?? 'failed');
      if (body.devCode) setDevCode(body.devCode);
      setSentTo(body.to ?? []);
      setStage('code');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong; try again.');
    } finally {
      setBusy(null);
    }
  }

  async function verify() {
    setError(null);
    if (!/^\d{6}$/.test(code)) return setError('Enter the 6-digit code.');
    setBusy('Checking the code…');
    try {
      const res = await fetch('/api/consent/verify', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ school, token, ...who(), code, name: name.trim() || undefined }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.type ?? 'failed');
      window.location.reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong; try again.');
      setBusy(null);
    }
  }

  return (
    <div className="ep-cf" style={{ maxWidth: '30rem' }}>
      {stage === 'who' ? (
        <>
          {families && outsiders ? (
            <fieldset className="ep-field" style={{ border: 0, padding: 0, margin: 0 }}>
              <legend className="ep-field__label">I am</legend>
              <div className="ep-cf__options">
                <label className="ep-radio">
                  <input
                    type="radio"
                    className="ep-radio__input"
                    name="cs-mode"
                    checked={mode === 'family'}
                    onChange={() => setMode('family')}
                  />
                  <span className="ep-radio__dot" aria-hidden="true" />
                  <span className="ep-check__text">A parent of a pupil of the school</span>
                </label>
                <label className="ep-radio">
                  <input
                    type="radio"
                    className="ep-radio__input"
                    name="cs-mode"
                    checked={mode === 'outsider'}
                    onChange={() => setMode('outsider')}
                  />
                  <span className="ep-radio__dot" aria-hidden="true" />
                  <span className="ep-check__text">Someone else (guest, alumni, visitor)</span>
                </label>
              </div>
            </fieldset>
          ) : null}
          {mode === 'family' ? (
            <label className="ep-field" htmlFor="cs-adm">
              <span className="ep-field__label">Admission number of the pupil</span>
              <input
                id="cs-adm"
                className="ep-input"
                value={admissionNo}
                maxLength={40}
                autoComplete="off"
                onChange={(e) => setAdmissionNo(e.target.value)}
              />
              <span className="ep-field__help">
                The code goes to the parent mobile number the school has on file.
              </span>
            </label>
          ) : (
            <>
              <label className="ep-field" htmlFor="cs-name">
                <span className="ep-field__label">Your name</span>
                <input
                  id="cs-name"
                  className="ep-input"
                  value={name}
                  maxLength={120}
                  autoComplete="name"
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="ep-field" htmlFor="cs-contact">
                <span className="ep-field__label">Mobile number or email</span>
                <input
                  id="cs-contact"
                  className="ep-input"
                  value={contact}
                  maxLength={200}
                  autoComplete="tel"
                  inputMode="email"
                  onChange={(e) => setContact(e.target.value)}
                />
                <span className="ep-field__help">
                  We send a one-time code there to check it is yours.
                </span>
              </label>
            </>
          )}
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={Boolean(busy)}
              onClick={requestCode}
            >
              {busy ?? 'Send me a code'}
            </button>
          </div>
        </>
      ) : (
        <>
          <p style={{ margin: 0 }}>
            A 6-digit code was sent to {sentTo.join(' and ')}.
            {devCode ? ` (Development: ${devCode})` : ''}
          </p>
          <label className="ep-field" htmlFor="cs-code">
            <span className="ep-field__label">Code</span>
            <input
              id="cs-code"
              className="ep-input"
              value={code}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
            />
          </label>
          <div style={{ display: 'flex', gap: 'var(--sp-2)' }}>
            <button
              type="button"
              className="ep-btn ep-btn--primary"
              disabled={Boolean(busy)}
              onClick={verify}
            >
              {busy ?? 'Continue'}
            </button>
            <button
              type="button"
              className="ep-btn ep-btn--ghost"
              onClick={() => {
                setStage('who');
                setCode('');
              }}
            >
              Back
            </button>
          </div>
        </>
      )}
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert" style={{ margin: 0 }}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
