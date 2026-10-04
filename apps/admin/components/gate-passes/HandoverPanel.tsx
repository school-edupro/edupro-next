'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { LiveCamera } from '@/components/visitors/LiveCamera';
import { handoverPass, sendPassOtp } from '@/lib/gate-pass-actions';

/**
 * The hand-over at the front desk: a live photo of the person collecting the child and, when that person
 * is not on the pupil's record, the one-time code sent to the parent's mobile.
 */
export function HandoverPanel({
  id,
  collector,
  otpNeeded,
}: {
  id: string;
  collector: string;
  otpNeeded: boolean;
}) {
  const router = useRouter();
  const [photo, setPhoto] = useState('');
  const [otp, setOtp] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const send = () =>
    start(async () => {
      setMsg(null);
      const r = await sendPassOtp(id);
      if (!r.ok) return setMsg(r.error);
      setSent(
        `${r.sent ? 'Code sent' : 'Code made (no SMS / WhatsApp template is ready, so it was not sent)'} to the parent’s mobile ending ${r.mobileEnd}. It works for ${String(r.minutes)} minutes.${r.devCode ? ` Development code: ${r.devCode}` : ''}`,
      );
    });
  const submit = () =>
    start(async () => {
      setMsg(null);
      if (!photo) return setMsg('Take the photo of the person collecting the child.');
      if (otpNeeded && !/^\d{6}$/.test(otp))
        return setMsg('Enter the 6-digit code the parent got.');
      const r = await handoverPass(id, photo, otp);
      if (!r.ok) return setMsg(r.error);
      router.push(`/engagement/gate-passes/${id}?ok=handed_over`);
      router.refresh();
    });

  return (
    <div className="ep-hd__form">
      <p style={{ margin: 0 }}>
        Compare <strong>{collector}</strong> with the photos above, then take a photo now.
      </p>
      <LiveCamera value={photo} onChange={setPhoto} />
      {otpNeeded ? (
        <div className="ep-hd__row">
          <div>
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={send}
              disabled={busy}
            >
              {sent ? 'Send the code again' : 'Send code to the parent'}
            </button>
            {sent ? (
              <p className="ep-field__help" role="status">
                {sent}
              </p>
            ) : (
              <p className="ep-field__help">
                This person is not on the pupil’s record, so the parent confirms with a one-time
                code.
              </p>
            )}
          </div>
          <label className="ep-field" htmlFor="ho-otp">
            <span className="ep-field__label">Code the parent got</span>
            <input
              id="ho-otp"
              className="ep-input"
              inputMode="numeric"
              maxLength={6}
              autoComplete="one-time-code"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
            />
          </label>
        </div>
      ) : null}
      {msg ? (
        <p className="ep-field__error" role="alert">
          {msg}
        </p>
      ) : null}
      <div>
        <button type="button" className="ep-btn ep-btn--primary" onClick={submit} disabled={busy}>
          Hand over the child
        </button>
      </div>
    </div>
  );
}
