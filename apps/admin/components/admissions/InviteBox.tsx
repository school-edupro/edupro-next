'use client';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { inviteLead } from '@/lib/admission-enquiry-actions';

/**
 * Invite the family to register (docs/design/46, part 3): the link goes by email / SMS / WhatsApp from
 * the school, and is shown here once to copy or share on WhatsApp (only its fingerprint is kept, so a
 * later visit shows it again only by inviting again).
 */
export function InviteBox({
  id,
  to,
  mobile,
  parentName,
  cycleId,
  cycles,
  invitedAt,
}: {
  id: string;
  /** where the school's message goes, for the text */
  to: string;
  mobile: string | null;
  parentName: string;
  cycleId: string | null;
  cycles: Array<{ id: string; name: string }>;
  invitedAt: string | null;
}) {
  const router = useRouter();
  const [session, setSession] = useState(cycleId ?? '');
  const [message, setMessage] = useState('');
  const [out, setOut] = useState<{ link: string; sent: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [pending, start] = useTransition();
  const wa = (link: string) =>
    `https://wa.me/${mobile ? `91${mobile}` : ''}?text=${encodeURIComponent(
      `Dear ${parentName}, register your child for admission here: ${link}`,
    )}`;
  return (
    <div className="ep-rp__act">
      <p style={{ margin: 0 }}>
        Sends a link to {to} (email, and SMS / WhatsApp where the school has the templates). The
        form starts with the child&apos;s name and date of birth; the registration counts for this
        enquiry.{invitedAt ? ` Last invited ${invitedAt}.` : ''}
      </p>
      <label className="ep-field">
        <span className="ep-field__label">Session</span>
        <select className="ep-select" value={session} onChange={(e) => setSession(e.target.value)}>
          <option value="">The open one</option>
          {cycles.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <label className="ep-field">
        <span className="ep-field__label">Own message (the link is added in the email)</span>
        <textarea
          className="ep-input"
          rows={2}
          maxLength={500}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
      </label>
      <div className="ep-form-actions">
        <button
          type="button"
          className="ep-btn ep-btn--secondary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setError('');
              setCopied(false);
              const r = await inviteLead(id, session || null, message);
              if (r.ok) {
                setOut({ link: r.link, sent: r.sent });
                router.refresh();
              } else setError(r.error);
            })
          }
        >
          {invitedAt || out ? 'Invite again' : 'Send the invitation'}
        </button>
      </div>
      {error ? (
        <p className="ep-alert ep-alert--danger" role="alert">
          {error}
        </p>
      ) : null}
      {out ? (
        <div className="ep-invite-link" role="status">
          <p style={{ margin: 0 }}>
            Invitation sent ({out.sent} message{out.sent === 1 ? '' : 's'}). The link, to send
            yourself or read out:
          </p>
          <input
            className="ep-input"
            readOnly
            aria-label="The invitation link"
            value={out.link}
            onFocus={(e) => e.currentTarget.select()}
          />
          <span className="ep-invite-link__acts">
            <button
              type="button"
              className="ep-btn ep-btn--secondary ep-btn--sm"
              onClick={() =>
                void navigator.clipboard?.writeText(out.link).then(() => setCopied(true))
              }
            >
              {copied ? 'Copied' : 'Copy link'}
            </button>
            <a
              className="ep-btn ep-btn--secondary ep-btn--sm"
              href={wa(out.link)}
              target="_blank"
              rel="noopener noreferrer"
            >
              Share on WhatsApp
            </a>
          </span>
          <span className="ep-field__help">
            Shown now only: a new invitation makes a new link (the old one stops working).
          </span>
        </div>
      ) : null}
    </div>
  );
}
