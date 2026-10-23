'use client';
import { useState } from 'react';

/** The admission enquiry form of the school's website (a proof-of-work first; no sign-in). */
export function AdmissionEnquiryForm({
  school,
  classes,
}: {
  school: string;
  classes: Array<{ id: string; name: string }>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

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

  async function submit(form: HTMLFormElement) {
    setError(null);
    const fd = new FormData(form);
    const v = Object.fromEntries([...fd.entries()].map(([k, x]) => [k, String(x).trim()]));
    if ((v.parentName ?? '').length < 2) return setError('Enter your name.');
    if (!v.mobile && !v.email)
      return setError('Enter your mobile number or email, so the school can reply.');
    if (v.mobile && !/^[6-9]\d{9}$/.test(v.mobile))
      return setError('Enter a 10-digit mobile number.');
    setBusy('Checking your browser…');
    try {
      const ch = await fetch('/api/challenge', { method: 'POST' }).then((r) => r.json());
      const nonce = await solve(ch.challenge, ch.difficulty);
      setBusy('Sending…');
      const res = await fetch('/api/admission/enquiry', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...v, school, challenge: ch.challenge, nonce }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.detail ?? body.type ?? 'Not sent');
      setDone(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  if (done)
    return (
      <div className="ep-alert ep-alert--success" role="status">
        Thank you. The admission office will call or write to you soon.
      </div>
    );
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit(e.currentTarget);
      }}
      style={{ display: 'grid', gap: 'var(--sp-3)' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
          gap: 'var(--sp-3)',
        }}
      >
        <label className="ep-field">
          <span className="ep-field__label">Your name</span>
          <input
            className="ep-input"
            name="parentName"
            required
            maxLength={120}
            autoComplete="name"
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Mobile number</span>
          <input
            className="ep-input"
            name="mobile"
            inputMode="numeric"
            maxLength={10}
            autoComplete="tel"
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Email</span>
          <input
            className="ep-input"
            name="email"
            type="email"
            maxLength={200}
            autoComplete="email"
          />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Child&apos;s name</span>
          <input className="ep-input" name="childName" maxLength={120} />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Child&apos;s date of birth</span>
          <input className="ep-input" name="childDob" type="date" />
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Class sought</span>
          <select className="ep-select" name="classId" defaultValue="">
            <option value="">Not sure</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="ep-field">
          <span className="ep-field__label">Where you live</span>
          <input className="ep-input" name="locality" maxLength={120} />
        </label>
      </div>
      <label className="ep-field">
        <span className="ep-field__label">Your question</span>
        <textarea className="ep-input" name="message" rows={3} maxLength={1000} />
      </label>
      {error ? (
        <div className="ep-alert ep-alert--danger" role="alert">
          {error}
        </div>
      ) : null}
      <div>
        <button className="ep-btn ep-btn--primary" type="submit" disabled={busy !== null}>
          {busy ?? 'Send the enquiry'}
        </button>
      </div>
    </form>
  );
}
