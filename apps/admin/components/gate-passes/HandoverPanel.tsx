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
  outsider,
}: {
  id: string;
  collector: string;
  otpNeeded: boolean;
  /** Someone not on the pupil's record collects: the remark is then required. */
  outsider: boolean;
}) {
  const router = useRouter();
  const [photo, setPhoto] = useState('');
  const [otp, setOtp] = useState('');
  const [remark, setRemark] = useState('');
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
      if (outsider && remark.trim().length < 3)
        return setMsg('Add a remark: this person is not on the pupil’s record.');
      const r = await handoverPass(id, photo, otp, remark);
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
      <label className="ep-field" htmlFor="ho-remark">
        <span className="ep-field__label">
          Remark by the front desk{outsider ? ' *' : ' (optional)'}
        </span>
        <input
          id="ho-remark"
          className="ep-input"
          maxLength={300}
          required={outsider}
          placeholder={outsider ? 'ID proof seen, parent spoken to…' : 'Anything to note'}
          value={remark}
          onChange={(e) => setRemark(e.target.value)}
        />
      </label>
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
